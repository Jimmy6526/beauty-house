// أداة ترخيص محلات التجميل — native launcher.
// Starts the local license server hidden, opens it in an app-style browser window and stamps that window with
// the tool's own icon + a dedicated taskbar identity (so the taskbar shows the key icon, not the browser's).
// Build: tools\keygen\build-launcher.bat  (uses the csc.exe that ships with Windows)
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

static class LicenseTool
{
    const int PORT = 47199;
    const string TITLE = "أداة ترخيص محلات التجميل";
    const string AUMID = "Nova.Beauty.LicenseTool";

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
    delegate bool EnumProc(IntPtr h, IntPtr p);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr LoadImage(IntPtr inst, string file, uint type, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore ps);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern void SetCurrentProcessExplicitAppUserModelID(string id);

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint c);
        [PreserveSig] int GetAt(uint i, out PropertyKey k);
        [PreserveSig] int GetValue(ref PropertyKey k, out PropVariant v);
        [PreserveSig] int SetValue(ref PropertyKey k, ref PropVariant v);
        [PreserveSig] int Commit();
    }
    [StructLayout(LayoutKind.Sequential, Pack = 4)] struct PropertyKey { public Guid fmtid; public uint pid; }
    [StructLayout(LayoutKind.Explicit, Size = 24)] struct PropVariant { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }

    static string dir, ico, exe;
    static IntPtr big = IntPtr.Zero, small = IntPtr.Zero;

    [STAThread]
    static void Main()
    {
        bool first;
        using (var mx = new Mutex(true, "Nova.Beauty.LicenseTool.Launcher", out first))
        {
            if (!first) { FocusExisting(); return; }
            dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            exe = Path.Combine(dir, "LicenseTool.exe");
            ico = Path.Combine(dir, "keygen.ico");
            try { SetCurrentProcessExplicitAppUserModelID(AUMID); } catch { }
            try { Run(); }
            catch (Exception e) { MessageBox.Show(e.Message, TITLE, MessageBoxButtons.OK, MessageBoxIcon.Error, MessageBoxDefaultButton.Button1, MessageBoxOptions.RtlReading | MessageBoxOptions.RightAlign); }
        }
    }

    static void FocusExisting()
    {
        IntPtr h = FindWindow();
        if (h != IntPtr.Zero) { ShowWindow(h, 9); SetForegroundWindow(h); }
    }

    static void Run()
    {
        string url = "http://127.0.0.1:" + PORT;
        if (!ServerIsOurs())
        {
            if (PortOpen()) throw new Exception("المنفذ " + PORT + " مشغول ببرنامج آخر. أغلقه ثم أعد تشغيل الأداة.");
            string node = FindNode();
            if (node == null) throw new Exception("لم يتم العثور على Node.js على هذا الجهاز.\nثبّته من nodejs.org ثم أعد المحاولة.");
            var psi = new ProcessStartInfo(node, "keygen.js ui --auto-exit") { WorkingDirectory = dir, UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
            Process.Start(psi);
            for (int i = 0; i < 60 && !ServerIsOurs(); i++) Thread.Sleep(250);
            if (!ServerIsOurs()) throw new Exception("تعذّر تشغيل خادم الأداة. شغّل tools\\keygen\\run-keygen.bat لرؤية الخطأ.");
        }

        IntPtr h = FindWindow();
        if (h == IntPtr.Zero)
        {
            string browser = FindBrowser();
            if (browser == null) { Process.Start(url); return; }
            string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NovaLicenseTool", "profile");
            Process.Start(new ProcessStartInfo(browser,
                "--app=" + url + " --user-data-dir=\"" + profile + "\" --no-first-run --no-default-browser-check --start-maximized") { UseShellExecute = false });
            for (int i = 0; i < 120 && h == IntPtr.Zero; i++) { Thread.Sleep(250); h = FindWindow(); }
        }
        if (h == IntPtr.Zero) return;

        ShowWindow(h, 3); // SW_MAXIMIZE: fill the whole screen
        LoadIcons();
        // keep stamping while the window lives (the browser may reset its icon when the page title/favicon changes)
        while (IsWindow(h))
        {
            Stamp(h);
            Thread.Sleep(2500);
            if (!IsWindow(h)) { h = FindWindow(); if (h == IntPtr.Zero) break; }
        }
    }

    static void LoadIcons()
    {
        if (!File.Exists(ico)) return;
        big = LoadImage(IntPtr.Zero, ico, 1, 64, 64, 0x10);
        small = LoadImage(IntPtr.Zero, ico, 1, 16, 16, 0x10);
    }

    static void Stamp(IntPtr h)
    {
        if (small != IntPtr.Zero) SendMessage(h, 0x80, (IntPtr)0, small);
        if (big != IntPtr.Zero) SendMessage(h, 0x80, (IntPtr)1, big);
        try
        {
            Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
            IPropertyStore ps;
            if (SHGetPropertyStoreForWindow(h, ref iid, out ps) != 0 || ps == null) return;
            Guid fmt = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
            SetStr(ps, fmt, 5, AUMID);
            SetStr(ps, fmt, 2, "\"" + exe + "\"");
            SetStr(ps, fmt, 3, ico + ",0");
            SetStr(ps, fmt, 4, TITLE);
            ps.Commit();
            Marshal.ReleaseComObject(ps);
        }
        catch { }
    }

    static void SetStr(IPropertyStore ps, Guid fmt, uint pid, string value)
    {
        var key = new PropertyKey { fmtid = fmt, pid = pid };
        var pv = new PropVariant { vt = 31, p = Marshal.StringToCoTaskMemUni(value) };
        ps.SetValue(ref key, ref pv);
        Marshal.FreeCoTaskMem(pv.p);
    }

    static IntPtr FindWindow()
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, p) =>
        {
            if (!IsWindowVisible(h)) return true;
            var sb = new StringBuilder(256);
            GetWindowText(h, sb, 256);
            if (sb.ToString().Contains(TITLE)) { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    static bool PortOpen()
    {
        try { using (var c = new System.Net.Sockets.TcpClient()) { var r = c.BeginConnect("127.0.0.1", PORT, null, null); return r.AsyncWaitHandle.WaitOne(400) && c.Connected; } }
        catch { return false; }
    }

    static bool ServerIsOurs()
    {
        if (!PortOpen()) return false;
        try { using (var w = new WebClient()) return w.DownloadString("http://127.0.0.1:" + PORT + "/api/state").Contains("hasKeys"); }
        catch { return false; }
    }

    static string FindNode()
    {
        foreach (string d in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            try { string p = Path.Combine(d.Trim().Trim('"'), "node.exe"); if (File.Exists(p)) return p; } catch { }
        }
        foreach (string p in new[] {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe") })
            if (File.Exists(p)) return p;
        return null;
    }

    static string FindBrowser()
    {
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string la = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        foreach (string p in new[] {
            Path.Combine(pf86, "Microsoft", "Edge", "Application", "msedge.exe"), Path.Combine(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(pf, "Google", "Chrome", "Application", "chrome.exe"), Path.Combine(pf86, "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(la, "Google", "Chrome", "Application", "chrome.exe") })
            if (File.Exists(p)) return p;
        return null;
    }
}
