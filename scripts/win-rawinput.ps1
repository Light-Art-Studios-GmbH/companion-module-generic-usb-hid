# Windows Raw Input helper for the Companion module "usb-hid-trigger".
# Registers for keyboard / mouse (and optionally HID) raw input with RIDEV_INPUTSINK
# and prints one JSON object per line to stdout. Started by src/win-rawinput.js.
#
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -STA -File win-rawinput.ps1 -ParentPid 1234 -Usages "1:6,1:2"
param(
	[int]$ParentPid = 0,
	[string]$Usages = "1:6,1:2"
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$source = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class RawInputWindow : NativeWindow
{
	[StructLayout(LayoutKind.Sequential)]
	public struct RAWINPUTDEVICE { public ushort usUsagePage; public ushort usUsage; public uint dwFlags; public IntPtr hwndTarget; }
	[StructLayout(LayoutKind.Sequential)]
	public struct RAWINPUTHEADER { public uint dwType; public uint dwSize; public IntPtr hDevice; public IntPtr wParam; }
	[StructLayout(LayoutKind.Sequential)]
	public struct RAWKEYBOARD { public ushort MakeCode; public ushort Flags; public ushort Reserved; public ushort VKey; public uint Message; public uint ExtraInformation; }
	[StructLayout(LayoutKind.Sequential)]
	public struct RAWMOUSE { public ushort usFlags; public ushort pad; public ushort usButtonFlags; public ushort usButtonData; public uint ulRawButtons; public int lLastX; public int lLastY; public uint ulExtraInformation; }
	[StructLayout(LayoutKind.Sequential)]
	public struct RAWINPUTDEVICELIST { public IntPtr hDevice; public uint dwType; }

	[DllImport("user32.dll", SetLastError = true)]
	static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] pRawInputDevices, uint uiNumDevices, uint cbSize);
	[DllImport("user32.dll", SetLastError = true)]
	static extern uint GetRawInputData(IntPtr hRawInput, uint uiCommand, IntPtr pData, ref uint pcbSize, uint cbSizeHeader);
	[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "GetRawInputDeviceInfoW")]
	static extern uint GetRawInputDeviceInfo(IntPtr hDevice, uint uiCommand, IntPtr pData, ref uint pcbSize);
	[DllImport("user32.dll", SetLastError = true)]
	static extern uint GetRawInputDeviceList(IntPtr pRawInputDeviceList, ref uint puiNumDevices, uint cbSize);

	const int WM_INPUT = 0x00FF;
	const uint RID_INPUT = 0x10000003;
	const uint RIDI_DEVICENAME = 0x20000007;
	const uint RIDI_DEVICEINFO = 0x2000000b;
	const uint RIDEV_INPUTSINK = 0x00000100;
	const uint RIM_TYPEMOUSE = 0, RIM_TYPEKEYBOARD = 1, RIM_TYPEHID = 2;

	readonly System.Collections.Generic.Dictionary<IntPtr, string> names = new System.Collections.Generic.Dictionary<IntPtr, string>();
	readonly System.Collections.Generic.Dictionary<IntPtr, string> infos = new System.Collections.Generic.Dictionary<IntPtr, string>();

	public static string J(string s)
	{
		if (s == null) return "";
		return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
	}

	public void Emit(string json)
	{
		Console.Out.WriteLine(json);
		Console.Out.Flush();
	}

	static string Ts()
	{
		return ",\"ts\":" + (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
	}

	public void Register(string usages)
	{
		CreateHandle(new CreateParams());
		var parts = usages.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
		var devs = new RAWINPUTDEVICE[parts.Length];
		for (int i = 0; i < parts.Length; i++)
		{
			var pu = parts[i].Split(':');
			devs[i].usUsagePage = ushort.Parse(pu[0]);
			devs[i].usUsage = ushort.Parse(pu[1]);
			devs[i].dwFlags = RIDEV_INPUTSINK;
			devs[i].hwndTarget = this.Handle;
		}
		if (!RegisterRawInputDevices(devs, (uint)devs.Length, (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE))))
			throw new Exception("RegisterRawInputDevices failed, error " + Marshal.GetLastWin32Error());
	}

	string DeviceName(IntPtr h)
	{
		string n;
		if (names.TryGetValue(h, out n)) return n;
		uint size = 0;
		GetRawInputDeviceInfo(h, RIDI_DEVICENAME, IntPtr.Zero, ref size);
		n = "";
		if (size > 0)
		{
			IntPtr buf = Marshal.AllocHGlobal((int)size * 2 + 2);
			try
			{
				uint r = GetRawInputDeviceInfo(h, RIDI_DEVICENAME, buf, ref size);
				if (r != uint.MaxValue) n = Marshal.PtrToStringUni(buf) ?? "";
			}
			finally { Marshal.FreeHGlobal(buf); }
		}
		names[h] = n;
		return n;
	}

	// returns JSON fragment with vid/pid/usagePage/usage where available
	string DeviceInfo(IntPtr h)
	{
		string s;
		if (infos.TryGetValue(h, out s)) return s;
		s = "";
		uint size = 32;
		IntPtr buf = Marshal.AllocHGlobal((int)size);
		try
		{
			Marshal.WriteInt32(buf, 0, 32);
			uint r = GetRawInputDeviceInfo(h, RIDI_DEVICEINFO, buf, ref size);
			if (r != uint.MaxValue && r > 0)
			{
				byte[] b = new byte[32];
				Marshal.Copy(buf, b, 0, 32);
				uint type = BitConverter.ToUInt32(b, 4);
				if (type == RIM_TYPEHID)
				{
					s = string.Format(",\"vid\":{0},\"pid\":{1},\"up\":{2},\"u\":{3}",
						BitConverter.ToUInt32(b, 8), BitConverter.ToUInt32(b, 12),
						BitConverter.ToUInt16(b, 20), BitConverter.ToUInt16(b, 22));
				}
				else s = string.Format(",\"devtype\":{0}", type);
			}
		}
		finally { Marshal.FreeHGlobal(buf); }
		infos[h] = s;
		return s;
	}

	public void ListDevices()
	{
		uint count = 0;
		uint cb = (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICELIST));
		GetRawInputDeviceList(IntPtr.Zero, ref count, cb);
		if (count == 0) { Emit("{\"t\":\"devices\",\"list\":[]}"); return; }
		IntPtr buf = Marshal.AllocHGlobal((int)(count * cb));
		try
		{
			uint n = GetRawInputDeviceList(buf, ref count, cb);
			var sb = new StringBuilder("{\"t\":\"devices\",\"list\":[");
			for (int i = 0; i < n; i++)
			{
				var e = (RAWINPUTDEVICELIST)Marshal.PtrToStructure(new IntPtr(buf.ToInt64() + i * cb), typeof(RAWINPUTDEVICELIST));
				if (i > 0) sb.Append(",");
				sb.Append("{\"type\":").Append(e.dwType).Append(",\"name\":\"").Append(J(DeviceName(e.hDevice))).Append("\"").Append(DeviceInfo(e.hDevice)).Append("}");
			}
			sb.Append("]}");
			Emit(sb.ToString());
		}
		finally { Marshal.FreeHGlobal(buf); }
	}

	protected override void WndProc(ref Message m)
	{
		if (m.Msg == WM_INPUT)
		{
			try { HandleInput(m.LParam); }
			catch (Exception ex) { Emit("{\"t\":\"error\",\"msg\":\"" + J(ex.Message) + "\"}"); }
		}
		base.WndProc(ref m);
	}

	void HandleInput(IntPtr lParam)
	{
		uint size = 0;
		uint hdrSize = (uint)Marshal.SizeOf(typeof(RAWINPUTHEADER));
		GetRawInputData(lParam, RID_INPUT, IntPtr.Zero, ref size, hdrSize);
		if (size == 0) return;
		IntPtr buf = Marshal.AllocHGlobal((int)size);
		try
		{
			if (GetRawInputData(lParam, RID_INPUT, buf, ref size, hdrSize) != size) return;
			var hdr = (RAWINPUTHEADER)Marshal.PtrToStructure(buf, typeof(RAWINPUTHEADER));
			IntPtr body = new IntPtr(buf.ToInt64() + hdrSize);
			string dev = J(DeviceName(hdr.hDevice));
			if (hdr.dwType == RIM_TYPEKEYBOARD)
			{
				var kb = (RAWKEYBOARD)Marshal.PtrToStructure(body, typeof(RAWKEYBOARD));
				if (kb.VKey == 255) return; // fake key
				bool down = (kb.Flags & 1) == 0;
				bool e0 = (kb.Flags & 2) != 0;
				Emit("{\"t\":\"key\",\"dev\":\"" + dev + "\",\"vk\":" + kb.VKey + ",\"sc\":" + kb.MakeCode + ",\"e0\":" + (e0 ? "true" : "false") + ",\"down\":" + (down ? "true" : "false") + Ts() + "}");
			}
			else if (hdr.dwType == RIM_TYPEMOUSE)
			{
				var ms = (RAWMOUSE)Marshal.PtrToStructure(body, typeof(RAWMOUSE));
				if (ms.usButtonFlags == 0) return; // movement only
				Emit("{\"t\":\"mouse\",\"dev\":\"" + dev + "\",\"flags\":" + ms.usButtonFlags + Ts() + "}");
			}
			else if (hdr.dwType == RIM_TYPEHID)
			{
				uint sizeHid = (uint)Marshal.ReadInt32(body, 0);
				uint cnt = (uint)Marshal.ReadInt32(body, 4);
				byte[] data = new byte[sizeHid * cnt];
				Marshal.Copy(new IntPtr(body.ToInt64() + 8), data, 0, data.Length);
				var hex = new StringBuilder(data.Length * 2);
				foreach (byte b in data) hex.Append(b.ToString("x2"));
				Emit("{\"t\":\"hid\",\"dev\":\"" + dev + "\",\"size\":" + sizeHid + ",\"count\":" + cnt + ",\"data\":\"" + hex + "\"" + DeviceInfo(hdr.hDevice) + Ts() + "}");
			}
		}
		finally { Marshal.FreeHGlobal(buf); }
	}
}
'@

try {
	Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms -ErrorAction Stop
	$win = New-Object RawInputWindow
	$win.Register($Usages)
	$win.ListDevices()
	$win.Emit('{"t":"ready","usages":"' + $Usages + '"}')
} catch {
	$msg = $_.Exception.Message.Replace('\', '\\').Replace('"', '\"')
	[Console]::Out.WriteLine('{"t":"fatal","msg":"' + $msg + '"}')
	[Console]::Out.Flush()
	exit 2
}

# exit when the parent (Companion module process) is gone
if ($ParentPid -gt 0) {
	$timer = New-Object System.Windows.Forms.Timer
	$timer.Interval = 5000
	$timer.Add_Tick({
		try { $null = [System.Diagnostics.Process]::GetProcessById($ParentPid) } catch { [System.Windows.Forms.Application]::Exit() }
	})
	$timer.Start()
}
[System.Windows.Forms.Application]::Run()
