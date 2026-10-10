// نوفا للتجميل — Nova Beauty : custom installer / uninstaller (WPF, compiled with the csc.exe that ships with Windows).
//   Setup build:      defines nothing, embeds payload.zip           -> NovaBeauty-Setup-x.y.z.exe
//   Uninstaller:      /define:UNINSTALLER (no payload)              -> uninstall.exe (shipped inside the payload)
// Command line (setup):  --silent  [--user] [--dir "path"] [--port N] [--no-desktop] [--no-startmenu] [--no-autostart]
// Developer helpers:     --snapshot <screen> <out.png> [dark]   renders a screen to PNG without installing anything.
// C# 5 only (the compiler in .NET Framework 4.x).
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Win32;
using IOPath = System.IO.Path;

namespace NovaSetup
{
    // ------------------------------------------------------------------------------------------------
    //  Options + core install logic (no UI)
    // ------------------------------------------------------------------------------------------------
    public class Opts
    {
        public bool AllUsers = true;
        public string Dir;
        public bool Desktop = true, StartMenu = true, AutoStart = true, Launch = true;
        public int Port = 5173;
    }

    public static class Core
    {
        public const string Id = "NovaBeauty";
        public const string Version = "1.0.0";
        public const string Publisher = "المهندس محمد جمال الدين";
        public const string NameAr = "نوفا للتجميل";
        public const string NameEn = "Nova Beauty";
        public const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\NovaBeauty";
        public static readonly string LogFile = IOPath.Combine(IOPath.GetTempPath(), "NovaSetup.log");

        public static void L(string s)
        {
            try { File.AppendAllText(LogFile, DateTime.Now.ToString("s") + " " + s + "\r\n"); } catch (Exception) { }
        }

        public static bool IsAdmin()
        {
            try { return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator); }
            catch (Exception) { return false; }
        }

        public static string DefaultDir(bool all)
        {
            if (all) return IOPath.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "NovaBeauty");
            return IOPath.Combine(IOPath.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs"), "NovaBeauty");
        }

        public static string HomeDir(bool all)
        {
            if (all) return IOPath.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "NovaBeauty");
            return IOPath.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NovaBeauty");
        }

        public static Stream Res(string name) { return Assembly.GetExecutingAssembly().GetManifestResourceStream(name); }

        public static bool HasPayload() { return Res("payload.zip") != null; }

        public static long PayloadBytes()
        {
            try
            {
                Stream s = Res("payload.zip");
                if (s == null) return 100L * 1024 * 1024;
                using (ZipArchive za = new ZipArchive(s, ZipArchiveMode.Read))
                {
                    long t = 0;
                    foreach (ZipArchiveEntry e in za.Entries) t += e.Length;
                    return t;
                }
            }
            catch (Exception) { return 100L * 1024 * 1024; }
        }

        public static long FreeBytes(string dir)
        {
            try
            {
                string root = IOPath.GetPathRoot(IOPath.GetFullPath(dir));
                if (string.IsNullOrEmpty(root) || root.StartsWith(@"\\")) return -1;
                return new DriveInfo(root).AvailableFreeSpace;
            }
            catch (Exception) { return -1; }
        }

        public static string Size(long b)
        {
            if (b < 0) return "غير معروفة";
            double mb = b / 1048576.0;
            if (mb < 1024) return Math.Round(mb) + " MB";
            return Math.Round(mb / 1024.0, 1) + " GB";
        }

        public static int Exec(string file, string args, int timeoutMs)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(file, args);
                psi.UseShellExecute = false; psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
                using (Process p = Process.Start(psi))
                {
                    p.StandardOutput.ReadToEnd();
                    if (!p.WaitForExit(timeoutMs)) { try { p.Kill(); } catch (Exception) { } return -2; }
                    return p.ExitCode;
                }
            }
            catch (Exception ex) { L("exec failed: " + file + " " + args + " : " + ex.Message); return -1; }
        }

        public static string ExecOut(string file, string args)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(file, args);
                psi.UseShellExecute = false; psi.CreateNoWindow = true; psi.RedirectStandardOutput = true;
                using (Process p = Process.Start(psi)) { string o = p.StandardOutput.ReadToEnd(); p.WaitForExit(15000); return o; }
            }
            catch (Exception) { return ""; }
        }

        static string Sc { get { return IOPath.Combine(Environment.SystemDirectory, "sc.exe"); } }

        public static bool ServiceExists() { return Exec(Sc, "query " + Id, 15000) == 0; }

        public static void StopService()
        {
            if (!ServiceExists()) return;
            Exec(Sc, "stop " + Id, 20000);
            for (int i = 0; i < 40; i++)
            {
                if (ExecOut(Sc, "query " + Id).Contains("STOPPED")) break;
                Thread.Sleep(500);
            }
        }

        public static void StopUserHost(string dir)
        {
            try { EventWaitHandle ev = EventWaitHandle.OpenExisting("Nova.Beauty.User.Stop"); ev.Set(); Thread.Sleep(1500); }
            catch (Exception) { }
            KillIn(dir);
        }

        // Kill node.exe / NovaUser.exe that run from the install folder (never touches other node processes).
        public static void KillIn(string dir)
        {
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return;
            string[] names = new string[] { "node", "NovaUser", "NovaService" };
            foreach (string n in names)
            {
                foreach (Process p in Process.GetProcessesByName(n))
                {
                    try
                    {
                        string f = p.MainModule.FileName;
                        if (f.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) { p.Kill(); p.WaitForExit(4000); }
                    }
                    catch (Exception) { }
                }
            }
        }

        public static string BrowserExe()
        {
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string la = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string[] c = new string[] {
                IOPath.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"), IOPath.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"),
                IOPath.Combine(pf, @"Google\Chrome\Application\chrome.exe"), IOPath.Combine(pf86, @"Google\Chrome\Application\chrome.exe"),
                IOPath.Combine(la, @"Google\Chrome\Application\chrome.exe") };
            foreach (string p in c) if (File.Exists(p)) return p;
            return null;
        }

        // Opens a page of the app in a clean app-mode window (Edge/Chrome), falling back to the default browser.
        public static void OpenApp(int port, string page)
        {
            string url = "http://localhost:" + port + "/" + page;
            try
            {
                string b = BrowserExe();
                if (b != null) Process.Start(new ProcessStartInfo(b, "--app=" + url) { UseShellExecute = false });
                else Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch (Exception ex) { L("open app failed: " + ex.Message); }
        }

        static void MakeLink(string lnk, string target, string args, string icon, string desc, string workDir)
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            object sh = Activator.CreateInstance(t);
            object l = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { lnk });
            Type lt = l.GetType();
            lt.InvokeMember("TargetPath", BindingFlags.SetProperty, null, l, new object[] { target });
            lt.InvokeMember("Arguments", BindingFlags.SetProperty, null, l, new object[] { args });
            lt.InvokeMember("Description", BindingFlags.SetProperty, null, l, new object[] { desc });
            lt.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, l, new object[] { workDir });
            if (icon != null) lt.InvokeMember("IconLocation", BindingFlags.SetProperty, null, l, new object[] { icon + ",0" });
            lt.InvokeMember("Save", BindingFlags.InvokeMethod, null, l, null);
        }

        static void AppShortcut(string lnk, int port, string page, string icon, string desc, string dir)
        {
            string b = BrowserExe();
            string url = "http://localhost:" + port + "/" + page;
            if (b != null) MakeLink(lnk, b, "--app=" + url, icon, desc, dir);
            else MakeLink(lnk, IOPath.Combine(Environment.GetEnvironmentVariable("WINDIR"), "explorer.exe"), url, icon, desc, dir);
        }

        public static string DesktopDir(bool all)
        {
            return Environment.GetFolderPath(all ? Environment.SpecialFolder.CommonDesktopDirectory : Environment.SpecialFolder.DesktopDirectory);
        }
        public static string StartMenuDir(bool all)
        {
            return IOPath.Combine(Environment.GetFolderPath(all ? Environment.SpecialFolder.CommonPrograms : Environment.SpecialFolder.Programs), NameEn);
        }
        public const string LnkApp = "نوفا للتجميل.lnk";
        public const string LnkLic = "نوفا للتجميل - إدارة الترخيص.lnk";

        static void SafeDelete(string f) { try { if (File.Exists(f)) File.Delete(f); } catch (Exception) { } }

        public static void WaitHttp(int port, int seconds)
        {
            DateTime end = DateTime.Now.AddSeconds(seconds);
            while (DateTime.Now < end)
            {
                try
                {
                    HttpWebRequest rq = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/license/status");
                    rq.Timeout = 2000; rq.AllowAutoRedirect = false;
                    using (HttpWebResponse r = (HttpWebResponse)rq.GetResponse()) { return; }
                }
                catch (WebException ex) { if (ex.Response != null) return; }
                catch (Exception) { }
                Thread.Sleep(700);
            }
            throw new Exception("تم نسخ الملفات لكن الخدمة لم تستجب بعد. جرّب فتح التطبيق بعد دقيقة، وإن استمرت المشكلة راجع السجل.");
        }

        // ----------------------------------------------------------------------------------- install
        public static void Install(Opts o, Action<double, string> report)
        {
            L("install start: all=" + o.AllUsers + " dir=" + o.Dir + " port=" + o.Port);
            string dir = IOPath.GetFullPath(o.Dir);
            string home = HomeDir(o.AllUsers);
            if (o.AllUsers && !IsAdmin()) throw new Exception("التثبيت لجميع المستخدمين يتطلب صلاحية المدير.");
            Stream payload = Res("payload.zip");
            if (payload == null) throw new Exception("ملف التثبيت تالف (الحزمة غير موجودة).");
            long need = PayloadBytes();
            long free = FreeBytes(dir);
            if (free >= 0 && free < need + 50L * 1048576) throw new Exception("المساحة الحرة غير كافية على القرص المحدد.");

            report(2, "جارٍ التحضير للتثبيت…");
            Directory.CreateDirectory(dir);
            report(4, "جارٍ إيقاف النسخة السابقة (إن وُجدت)…");
            StopService();
            StopUserHost(dir);
            KillIn(dir);

            // extract
            using (ZipArchive za = new ZipArchive(payload, ZipArchiveMode.Read))
            {
                long done = 0; long total = Math.Max(1, need);
                byte[] buf = new byte[81920];
                foreach (ZipArchiveEntry e in za.Entries)
                {
                    if (e.FullName.EndsWith("/") || e.Name.Length == 0) continue;
                    string dest = IOPath.GetFullPath(IOPath.Combine(dir, e.FullName.Replace('/', '\\')));
                    if (!dest.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) throw new Exception("مسار غير آمن داخل الحزمة.");
                    Directory.CreateDirectory(IOPath.GetDirectoryName(dest));
                    for (int attempt = 0; ; attempt++)
                    {
                        try
                        {
                            using (Stream src = e.Open())
                            using (FileStream dst = new FileStream(dest, FileMode.Create, FileAccess.Write, FileShare.None))
                            {
                                int n;
                                while ((n = src.Read(buf, 0, buf.Length)) > 0)
                                {
                                    dst.Write(buf, 0, n);
                                    done += n;
                                    report(6 + 74.0 * done / total, "جارٍ فك حزم الملفات… " + e.Name);
                                }
                            }
                            break;
                        }
                        catch (IOException)
                        {
                            if (attempt >= 6) throw;
                            KillIn(dir); Thread.Sleep(700);
                        }
                    }
                }
            }
            L("files extracted");

            report(82, "جارٍ تكوين إعدادات النظام…");
            Directory.CreateDirectory(IOPath.Combine(home, @"data\branding"));
            Directory.CreateDirectory(IOPath.Combine(home, "logs"));
            string ico = IOPath.Combine(dir, "nova.ico");
            string brandIco = IOPath.Combine(home, @"data\branding\app.ico");
            try { if (!File.Exists(brandIco) && File.Exists(ico)) File.Copy(ico, brandIco); } catch (Exception) { }
            string portFile = IOPath.Combine(home, "port.txt");
            try { if (o.Port != 5173) File.WriteAllText(portFile, o.Port.ToString()); else SafeDelete(portFile); } catch (Exception) { }
            if (o.AllUsers)
                Exec(IOPath.Combine(Environment.SystemDirectory, "icacls.exe"), "\"" + home + "\" /inheritance:r /grant:r *S-1-5-32-544:(OI)(CI)F *S-1-5-18:(OI)(CI)F", 30000);

            string iconForLinks = File.Exists(brandIco) ? brandIco : ico;

            if (o.AllUsers)
            {
                report(86, "جارٍ تثبيت خدمة ويندوز الخلفية…");
                string bin = "\\\"" + IOPath.Combine(dir, "NovaService.exe") + "\\\"";
                string start = o.AutoStart ? "auto" : "demand";
                if (!ServiceExists()) Exec(Sc, "create " + Id + " binPath= \"" + bin + "\" start= " + start + " DisplayName= \"Nova Beauty Service\"", 20000);
                else Exec(Sc, "config " + Id + " binPath= \"" + bin + "\" start= " + start, 20000);
                Exec(Sc, "description " + Id + " \"Nova Beauty salon management server\"", 15000);
                Exec(Sc, "failure " + Id + " reset= 86400 actions= restart/5000/restart/5000/restart/30000", 15000);
                Exec(Sc, "start " + Id, 30000);
            }
            else
            {
                report(86, "جارٍ تشغيل النظام للمستخدم الحالي…");
                string host = IOPath.Combine(dir, "NovaUser.exe");
                try
                {
                    using (RegistryKey rk = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
                    {
                        if (o.AutoStart) rk.SetValue(Id, "\"" + host + "\""); else rk.DeleteValue(Id, false);
                    }
                }
                catch (Exception ex) { L("autostart: " + ex.Message); }
                Process.Start(new ProcessStartInfo(host) { WorkingDirectory = dir, UseShellExecute = false });
            }

            report(90, "جارٍ إنشاء الاختصارات…");
            try
            {
                if (o.Desktop)
                {
                    AppShortcut(IOPath.Combine(DesktopDir(o.AllUsers), LnkApp), o.Port, "", iconForLinks, "نظام نوفا للتجميل لإدارة الصالونات ومحلات التجميل", dir);
                    AppShortcut(IOPath.Combine(DesktopDir(o.AllUsers), LnkLic), o.Port, "activate.html", iconForLinks, "إدارة ترخيص وتفعيل نظام نوفا للتجميل", dir);
                }
                if (o.StartMenu)
                {
                    string sm = StartMenuDir(o.AllUsers);
                    Directory.CreateDirectory(sm);
                    AppShortcut(IOPath.Combine(sm, LnkApp), o.Port, "", iconForLinks, "نظام نوفا للتجميل", dir);
                    AppShortcut(IOPath.Combine(sm, LnkLic), o.Port, "activate.html", iconForLinks, "إدارة الترخيص", dir);
                    MakeLink(IOPath.Combine(sm, "إلغاء تثبيت نوفا للتجميل.lnk"), IOPath.Combine(dir, "uninstall.exe"), "", ico, "إلغاء تثبيت نوفا للتجميل", dir);
                }
            }
            catch (Exception ex) { L("shortcuts: " + ex.Message); }

            report(94, "جارٍ تسجيل البرنامج في ويندوز…");
            try
            {
                RegistryKey root = o.AllUsers ? Registry.LocalMachine : Registry.CurrentUser;
                using (RegistryKey k = root.CreateSubKey(UninstallKey))
                {
                    k.SetValue("DisplayName", NameEn + " - " + NameAr);
                    k.SetValue("DisplayVersion", Version);
                    k.SetValue("Publisher", Publisher);
                    k.SetValue("InstallLocation", dir);
                    k.SetValue("DisplayIcon", ico);
                    k.SetValue("UninstallString", "\"" + IOPath.Combine(dir, "uninstall.exe") + "\"");
                    k.SetValue("EstimatedSize", (int)(need / 1024), RegistryValueKind.DWord);
                    k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                    k.SetValue("NovaAllUsers", o.AllUsers ? 1 : 0, RegistryValueKind.DWord);
                    k.SetValue("NovaPort", o.Port, RegistryValueKind.DWord);
                    k.SetValue("HelpLink", "mailto:jamalmohamed942@gmail.com");
                }
            }
            catch (Exception ex) { L("registry: " + ex.Message); }

            report(96, "جارٍ التحقق من تشغيل النظام…");
            WaitHttp(o.Port, 30);
            report(100, "اكتمل التثبيت");
            L("install done");
        }

        // ----------------------------------------------------------------------------------- uninstall
        public class InstallInfo { public bool AllUsers; public string Dir; public int Port = 5173; }

        public static InstallInfo FindInstall()
        {
            foreach (int pass in new int[] { 0, 1 })
            {
                RegistryKey root = pass == 0 ? Registry.LocalMachine : Registry.CurrentUser;
                try
                {
                    using (RegistryKey k = root.OpenSubKey(UninstallKey))
                    {
                        if (k == null) continue;
                        InstallInfo i = new InstallInfo();
                        i.AllUsers = pass == 0;
                        i.Dir = Convert.ToString(k.GetValue("InstallLocation"));
                        object p = k.GetValue("NovaPort"); if (p != null) i.Port = Convert.ToInt32(p);
                        if (!string.IsNullOrEmpty(i.Dir)) return i;
                    }
                }
                catch (Exception) { }
            }
            return null;
        }

        static void DeleteTree(string dir)
        {
            for (int i = 0; i < 6; i++)
            {
                try { if (Directory.Exists(dir)) Directory.Delete(dir, true); return; }
                catch (Exception) { KillIn(dir); Thread.Sleep(700); }
            }
        }

        public static void Uninstall(InstallInfo info, bool deleteData, Action<double, string> report)
        {
            L("uninstall start: " + info.Dir + " all=" + info.AllUsers + " deleteData=" + deleteData);
            report(5, "جارٍ إيقاف النظام…");
            if (info.AllUsers)
            {
                StopService();
                Exec(Sc, "delete " + Id, 20000);
            }
            StopUserHost(info.Dir);
            KillIn(info.Dir);
            report(35, "جارٍ حذف الاختصارات…");
            SafeDelete(IOPath.Combine(DesktopDir(info.AllUsers), LnkApp));
            SafeDelete(IOPath.Combine(DesktopDir(info.AllUsers), LnkLic));
            try { string sm = StartMenuDir(info.AllUsers); if (Directory.Exists(sm)) Directory.Delete(sm, true); } catch (Exception) { }
            report(50, "جارٍ إزالة التسجيل من ويندوز…");
            try { (info.AllUsers ? Registry.LocalMachine : Registry.CurrentUser).DeleteSubKeyTree(UninstallKey, false); } catch (Exception) { }
            try { using (RegistryKey rk = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true)) { if (rk != null) rk.DeleteValue(Id, false); } } catch (Exception) { }
            report(65, "جارٍ حذف ملفات البرنامج…");
            DeleteTree(info.Dir);
            if (deleteData)
            {
                report(88, "جارٍ حذف بيانات النظام…");
                DeleteTree(HomeDir(info.AllUsers));
            }
            report(100, "اكتمل إلغاء التثبيت");
            L("uninstall done");
        }
    }

    // ------------------------------------------------------------------------------------------------
    //  WPF UI
    // ------------------------------------------------------------------------------------------------
    public static class Ui
    {
        public const string Xaml = @"
<Window xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml'
        Width='820' Height='660' WindowStyle='None' AllowsTransparency='True' Background='Transparent' ResizeMode='NoResize'
        WindowStartupLocation='CenterScreen' FlowDirection='RightToLeft' UseLayoutRounding='True' SnapsToDevicePixels='True'
        TextOptions.TextFormattingMode='Ideal' TextOptions.TextRenderingMode='ClearType'>
  <Window.Resources>
    <Style x:Key='BtnPrimary' TargetType='Button'>
      <Setter Property='Foreground' Value='White'/><Setter Property='FontWeight' Value='Bold'/><Setter Property='FontSize' Value='17'/>
      <Setter Property='Cursor' Value='Hand'/><Setter Property='Padding' Value='30,13'/><Setter Property='Focusable' Value='True'/>
      <Setter Property='Template'><Setter.Value><ControlTemplate TargetType='Button'>
        <Border x:Name='bd' CornerRadius='16' Background='{DynamicResource AccentGrad}' Padding='{TemplateBinding Padding}' RenderTransformOrigin='0.5,0.5'>
          <Border.Effect><DropShadowEffect Color='#C03A72' BlurRadius='24' ShadowDepth='7' Opacity='.38'/></Border.Effect>
          <ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/>
        </Border>
        <ControlTemplate.Triggers>
          <Trigger Property='IsMouseOver' Value='True'><Setter TargetName='bd' Property='Opacity' Value='0.92'/></Trigger>
          <Trigger Property='IsPressed' Value='True'><Setter TargetName='bd' Property='RenderTransform'><Setter.Value><ScaleTransform ScaleX='0.98' ScaleY='0.98'/></Setter.Value></Setter></Trigger>
          <Trigger Property='IsEnabled' Value='False'><Setter TargetName='bd' Property='Opacity' Value='0.45'/></Trigger>
        </ControlTemplate.Triggers>
      </ControlTemplate></Setter.Value></Setter>
    </Style>
    <Style x:Key='BtnSecondary' TargetType='Button'>
      <Setter Property='Foreground' Value='{DynamicResource Text2}'/><Setter Property='FontWeight' Value='Bold'/><Setter Property='FontSize' Value='15'/>
      <Setter Property='Cursor' Value='Hand'/><Setter Property='Padding' Value='24,11'/>
      <Setter Property='Template'><Setter.Value><ControlTemplate TargetType='Button'>
        <Border x:Name='bd' CornerRadius='14' Background='Transparent' BorderBrush='{DynamicResource Border2}' BorderThickness='1.5' Padding='{TemplateBinding Padding}'>
          <ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/>
        </Border>
        <ControlTemplate.Triggers>
          <Trigger Property='IsMouseOver' Value='True'><Setter TargetName='bd' Property='Background' Value='{DynamicResource Tint}'/></Trigger>
        </ControlTemplate.Triggers>
      </ControlTemplate></Setter.Value></Setter>
    </Style>
    <Style x:Key='BtnLink' TargetType='Button'>
      <Setter Property='Foreground' Value='{DynamicResource Primary}'/><Setter Property='FontWeight' Value='SemiBold'/><Setter Property='FontSize' Value='14'/>
      <Setter Property='Cursor' Value='Hand'/><Setter Property='Padding' Value='10,6'/>
      <Setter Property='Template'><Setter.Value><ControlTemplate TargetType='Button'>
        <Border x:Name='bd' CornerRadius='10' Background='Transparent' Padding='{TemplateBinding Padding}'>
          <ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/>
        </Border>
        <ControlTemplate.Triggers><Trigger Property='IsMouseOver' Value='True'><Setter TargetName='bd' Property='Background' Value='{DynamicResource Tint}'/></Trigger></ControlTemplate.Triggers>
      </ControlTemplate></Setter.Value></Setter>
    </Style>
    <Style x:Key='BtnTop' TargetType='Button'>
      <Setter Property='Foreground' Value='White'/><Setter Property='FontSize' Value='15'/><Setter Property='Cursor' Value='Hand'/><Setter Property='Width' Value='38'/><Setter Property='Height' Value='32'/>
      <Setter Property='Template'><Setter.Value><ControlTemplate TargetType='Button'>
        <Border x:Name='bd' CornerRadius='10' Background='#22FFFFFF'><ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center'/></Border>
        <ControlTemplate.Triggers><Trigger Property='IsMouseOver' Value='True'><Setter TargetName='bd' Property='Background' Value='#44FFFFFF'/></Trigger></ControlTemplate.Triggers>
      </ControlTemplate></Setter.Value></Setter>
    </Style>
    <Style x:Key='Check' TargetType='CheckBox'>
      <Setter Property='Foreground' Value='{DynamicResource Text}'/><Setter Property='FontSize' Value='14.5'/><Setter Property='Cursor' Value='Hand'/>
      <Setter Property='Template'><Setter.Value><ControlTemplate TargetType='CheckBox'>
        <StackPanel Orientation='Horizontal' Background='Transparent'>
          <Border x:Name='box' Width='22' Height='22' CornerRadius='7' BorderThickness='1.8' BorderBrush='{DynamicResource Border2}' Background='{DynamicResource Surface}' VerticalAlignment='Center'>
            <Path x:Name='tick' Data='M 5,11 L 9.5,15.5 L 17,7' Stroke='White' StrokeThickness='2.4' StrokeStartLineCap='Round' StrokeEndLineCap='Round' StrokeLineJoin='Round' Visibility='Collapsed'/>
          </Border>
          <ContentPresenter Margin='10,0,0,0' VerticalAlignment='Center'/>
        </StackPanel>
        <ControlTemplate.Triggers>
          <Trigger Property='IsChecked' Value='True'><Setter TargetName='box' Property='Background' Value='{DynamicResource Accent}'/><Setter TargetName='box' Property='BorderBrush' Value='{DynamicResource Accent}'/><Setter TargetName='tick' Property='Visibility' Value='Visible'/></Trigger>
          <Trigger Property='IsMouseOver' Value='True'><Setter TargetName='box' Property='BorderBrush' Value='{DynamicResource Accent}'/></Trigger>
        </ControlTemplate.Triggers>
      </ControlTemplate></Setter.Value></Setter>
    </Style>
    <Style x:Key='Card' TargetType='RadioButton'>
      <Setter Property='Cursor' Value='Hand'/><Setter Property='Foreground' Value='{DynamicResource Text}'/>
      <Setter Property='Template'><Setter.Value><ControlTemplate TargetType='RadioButton'>
        <Border x:Name='bd' CornerRadius='16' BorderThickness='2' BorderBrush='{DynamicResource Border}' Background='{DynamicResource Surface}' Padding='14,12'>
          <ContentPresenter/>
        </Border>
        <ControlTemplate.Triggers>
          <Trigger Property='IsChecked' Value='True'><Setter TargetName='bd' Property='BorderBrush' Value='{DynamicResource Accent}'/><Setter TargetName='bd' Property='Background' Value='{DynamicResource Tint}'/></Trigger>
          <Trigger Property='IsMouseOver' Value='True'><Setter TargetName='bd' Property='BorderBrush' Value='{DynamicResource Border2}'/></Trigger>
        </ControlTemplate.Triggers>
      </ControlTemplate></Setter.Value></Setter>
    </Style>
    <Style x:Key='Bar' TargetType='ProgressBar'>
      <Setter Property='Minimum' Value='0'/><Setter Property='Maximum' Value='100'/><Setter Property='Height' Value='12'/>
      <Setter Property='Template'><Setter.Value><ControlTemplate TargetType='ProgressBar'>
        <Grid>
          <Border CornerRadius='6' Background='{DynamicResource Track}'/>
          <Border x:Name='PART_Track'><Border x:Name='PART_Indicator' HorizontalAlignment='Left' CornerRadius='6' Background='{DynamicResource AccentGrad}'/></Border>
        </Grid>
      </ControlTemplate></Setter.Value></Setter>
    </Style>
  </Window.Resources>

  <Grid Margin='20'>
    <Border x:Name='Shell' CornerRadius='26' Background='{DynamicResource Bg}' BorderBrush='{DynamicResource Border}' BorderThickness='1' ClipToBounds='False'>
      <Border.Effect><DropShadowEffect Color='#30102A' BlurRadius='34' ShadowDepth='6' Opacity='.42'/></Border.Effect>
      <Grid x:Name='Inner'>
        <Grid.RowDefinitions><RowDefinition Height='188'/><RowDefinition Height='*'/></Grid.RowDefinitions>

        <!-- banner -->
        <Border x:Name='Banner' Grid.Row='0' CornerRadius='25,25,0,0'>
          <Border.Background><LinearGradientBrush StartPoint='0,0' EndPoint='1,1'><GradientStop Color='#6A2658' Offset='0'/><GradientStop Color='#3B1535' Offset='0.55'/><GradientStop Color='#1C0B1A' Offset='1'/></LinearGradientBrush></Border.Background>
          <Grid>
            <Ellipse Width='300' Height='300' HorizontalAlignment='Left' VerticalAlignment='Top' Margin='-90,-130,0,0'><Ellipse.Fill><RadialGradientBrush><GradientStop Color='#66E0568C' Offset='0'/><GradientStop Color='#00E0568C' Offset='1'/></RadialGradientBrush></Ellipse.Fill></Ellipse>
            <Ellipse Width='280' Height='280' HorizontalAlignment='Right' VerticalAlignment='Bottom' Margin='0,0,-70,-120'><Ellipse.Fill><RadialGradientBrush><GradientStop Color='#55E7C278' Offset='0'/><GradientStop Color='#00E7C278' Offset='1'/></RadialGradientBrush></Ellipse.Fill></Ellipse>
            <StackPanel VerticalAlignment='Center' HorizontalAlignment='Center' Margin='0,18,0,0'>
              <Border Width='78' Height='78' CornerRadius='39' Background='White' HorizontalAlignment='Center' BorderBrush='#E7C278' BorderThickness='3'>
                <Border.Effect><DropShadowEffect Color='#000000' BlurRadius='20' ShadowDepth='5' Opacity='.35'/></Border.Effect>
                <Image x:Name='Logo' Margin='2' RenderOptions.BitmapScalingMode='HighQuality'/>
              </Border>
              <TextBlock x:Name='BannerTitle' Text='نظام نوفا للتجميل' Foreground='White' FontSize='24' FontWeight='Bold' HorizontalAlignment='Center' Margin='0,8,0,0'/>
              <TextBlock x:Name='BannerSub' Text='لإدارة الصالونات ومحلات التجميل · الإصدار 1.0.0' Foreground='#EBD3E1' FontSize='13' HorizontalAlignment='Center'/>
            </StackPanel>
          </Grid>
        </Border>

        <!-- top bar (over the banner) -->
        <Grid Grid.Row='0' Height='50' VerticalAlignment='Top' Background='Transparent' x:Name='TopBar'>
          <StackPanel Orientation='Horizontal' HorizontalAlignment='Left' Margin='14,10,0,0'>
            <Button x:Name='BtnClose' Style='{StaticResource BtnTop}' Content='✕' ToolTip='إغلاق'/>
            <Button x:Name='BtnMin' Style='{StaticResource BtnTop}' Content='—' Margin='6,0,0,0' ToolTip='تصغير'/>
            <Button x:Name='BtnTheme' Style='{StaticResource BtnTop}' Content='☾' Margin='6,0,0,0' ToolTip='الوضع الليلي / النهاري'/>
          </StackPanel>
        </Grid>

        <!-- content -->
        <Grid Grid.Row='1' x:Name='Content'>

          <!-- HOME -->
          <Grid x:Name='ScreenHome' Margin='44,22,44,16'>
            <Grid.RowDefinitions><RowDefinition Height='Auto'/><RowDefinition Height='Auto'/><RowDefinition Height='*'/><RowDefinition Height='Auto'/><RowDefinition Height='Auto'/></Grid.RowDefinitions>
            <TextBlock Grid.Row='0' x:Name='HomeTagline' TextAlignment='Center' TextWrapping='Wrap' Foreground='{DynamicResource Text}' FontSize='16' LineHeight='27'
                       Text='نقطة بيع · حجوزات · مخزون · تقارير — كل ما يحتاجه صالونك في برنامج واحد يعمل بدون إنترنت.'/>
            <WrapPanel Grid.Row='1' HorizontalAlignment='Center' Margin='0,14,0,0' x:Name='Chips'/>
            <StackPanel Grid.Row='2' VerticalAlignment='Center' HorizontalAlignment='Center'>
              <Button x:Name='BtnInstall' Style='{StaticResource BtnPrimary}' Content='تثبيت سريع' MinWidth='320'/>
              <TextBlock x:Name='TermsLine' TextAlignment='Center' Foreground='{DynamicResource Text2}' FontSize='12.5' Margin='0,14,0,0'>
                <Run Text='بالضغط على تثبيت، أنت توافق على '/><Hyperlink x:Name='LinkEula' Foreground='{DynamicResource Accent}'><Run Text='اتفاقية الترخيص وشروط الاستخدام'/></Hyperlink>
              </TextBlock>
            </StackPanel>
            <Grid Grid.Row='3' Margin='0,6,0,0'>
              <Button x:Name='BtnCustom' Style='{StaticResource BtnLink}' Content='⚙  خيارات مخصصة' HorizontalAlignment='Right'/>
              <TextBlock x:Name='SpaceHint' Foreground='{DynamicResource TextMuted}' FontSize='12.5' VerticalAlignment='Center' HorizontalAlignment='Left'/>
            </Grid>
            <TextBlock Grid.Row='4' x:Name='CreditHome' TextAlignment='Center' Foreground='{DynamicResource TextMuted}' FontSize='11' Margin='0,8,0,0' Text='تصميم وتطوير: المهندس محمد جمال الدين  ·  &#x200E;+249965269898  ·  jamalmohamed942@gmail.com'/>
          </Grid>

          <!-- OPTIONS -->
          <Grid x:Name='ScreenOptions' Margin='40,18,40,16' Visibility='Collapsed'>
            <Grid.RowDefinitions><RowDefinition Height='Auto'/><RowDefinition Height='Auto'/><RowDefinition Height='Auto'/><RowDefinition Height='Auto'/><RowDefinition Height='*'/><RowDefinition Height='Auto'/></Grid.RowDefinitions>
            <TextBlock Grid.Row='0' Text='خيارات التثبيت' FontSize='20' FontWeight='Bold' Foreground='{DynamicResource Text}'/>
            <Grid Grid.Row='1' Margin='0,12,0,0'>
              <Grid.ColumnDefinitions><ColumnDefinition Width='*'/><ColumnDefinition Width='12'/><ColumnDefinition Width='*'/></Grid.ColumnDefinitions>
              <RadioButton x:Name='RadAll' Grid.Column='0' Style='{StaticResource Card}' GroupName='mode' IsChecked='True'>
                <StackPanel><TextBlock Text='لجميع المستخدمين' FontWeight='Bold' FontSize='15'/><TextBlock Text='Program Files · خدمة ويندوز تعمل تلقائياً · يتطلب صلاحية المدير (UAC)' Foreground='{DynamicResource Text2}' FontSize='12' TextWrapping='Wrap' Margin='0,3,0,0'/></StackPanel>
              </RadioButton>
              <RadioButton x:Name='RadUser' Grid.Column='2' Style='{StaticResource Card}' GroupName='mode'>
                <StackPanel><TextBlock Text='للمستخدم الحالي فقط' FontWeight='Bold' FontSize='15'/><TextBlock Text='%LocalAppData% · بدون صلاحيات المدير · يعمل عند تسجيل دخولك' Foreground='{DynamicResource Text2}' FontSize='12' TextWrapping='Wrap' Margin='0,3,0,0'/></StackPanel>
              </RadioButton>
            </Grid>
            <StackPanel Grid.Row='2' Margin='0,14,0,0'>
              <TextBlock Text='مسار التثبيت' FontWeight='Bold' FontSize='13' Foreground='{DynamicResource Text}' Margin='0,0,0,6'/>
              <Grid>
                <Grid.ColumnDefinitions><ColumnDefinition Width='*'/><ColumnDefinition Width='Auto'/></Grid.ColumnDefinitions>
                <Border CornerRadius='12' BorderBrush='{DynamicResource Border2}' BorderThickness='1.5' Background='{DynamicResource Surface}'>
                  <TextBox x:Name='TxtDir' BorderThickness='0' Background='Transparent' Foreground='{DynamicResource Text}' FontSize='13.5' Padding='12,9' FlowDirection='LeftToRight' VerticalContentAlignment='Center' CaretBrush='{DynamicResource Accent}'/>
                </Border>
                <Button x:Name='BtnBrowse' Grid.Column='1' Style='{StaticResource BtnSecondary}' Content='تصفّح…' Margin='10,0,0,0' Padding='20,9'/>
              </Grid>
              <TextBlock x:Name='SpaceLine' FontSize='12.5' Margin='0,6,0,0' FontWeight='SemiBold'/>
            </StackPanel>
            <StackPanel Grid.Row='3' Margin='0,12,0,0'>
              <TextBlock Text='المكوّنات الإضافية' FontWeight='Bold' FontSize='13' Foreground='{DynamicResource Text}' Margin='0,0,0,8'/>
              <UniformGrid Columns='2' Rows='2'>
                <CheckBox x:Name='ChkDesktop' Style='{StaticResource Check}' Content='اختصارات على سطح المكتب' IsChecked='True' Margin='0,0,0,10'/>
                <CheckBox x:Name='ChkStart' Style='{StaticResource Check}' Content='اختصارات في قائمة ابدأ' IsChecked='True' Margin='0,0,0,10'/>
                <CheckBox x:Name='ChkAuto' Style='{StaticResource Check}' Content='تشغيل النظام تلقائياً مع ويندوز' IsChecked='True'/>
                <CheckBox x:Name='ChkLaunch' Style='{StaticResource Check}' Content='فتح النظام بعد انتهاء التثبيت' IsChecked='True'/>
              </UniformGrid>
            </StackPanel>
            <StackPanel Grid.Row='5' Orientation='Horizontal' HorizontalAlignment='Left'>
              <Button x:Name='BtnOptInstall' Style='{StaticResource BtnPrimary}' Content='تثبيت' Padding='44,11' FontSize='16'/>
              <Button x:Name='BtnOptBack' Style='{StaticResource BtnSecondary}' Content='رجوع' Margin='12,0,0,0'/>
            </StackPanel>
          </Grid>

          <!-- PROGRESS -->
          <Grid x:Name='ScreenProgress' Margin='56,24,56,20' Visibility='Collapsed'>
            <Grid.RowDefinitions><RowDefinition Height='Auto'/><RowDefinition Height='Auto'/><RowDefinition Height='Auto'/><RowDefinition Height='*'/><RowDefinition Height='Auto'/></Grid.RowDefinitions>
            <Grid Grid.Row='0'>
              <TextBlock x:Name='ProgTitle' Text='جارٍ تثبيت نوفا للتجميل' FontSize='19' FontWeight='Bold' Foreground='{DynamicResource Text}' HorizontalAlignment='Right'/>
              <TextBlock x:Name='ProgPct' Text='0%' FontSize='30' FontWeight='Bold' Foreground='{DynamicResource Accent}' HorizontalAlignment='Left' FlowDirection='LeftToRight'/>
            </Grid>
            <ProgressBar x:Name='Bar' Grid.Row='1' Style='{StaticResource Bar}' Margin='0,10,0,0'/>
            <TextBlock x:Name='ProgMsg' Grid.Row='2' Text='' FontSize='13' Foreground='{DynamicResource Text2}' Margin='0,10,0,0' TextTrimming='CharacterEllipsis'/>
            <Border Grid.Row='3' Margin='0,20,0,0' CornerRadius='18' Background='{DynamicResource Tint}' Padding='22,16' VerticalAlignment='Center'>
              <StackPanel>
                <TextBlock Text='هل تعلم؟' FontWeight='Bold' FontSize='13' Foreground='{DynamicResource Accent}'/>
                <TextBlock x:Name='TipText' FontSize='16' Foreground='{DynamicResource Text}' TextWrapping='Wrap' LineHeight='26' Margin='0,4,0,0' MinHeight='56'/>
              </StackPanel>
            </Border>
            <TextBlock Grid.Row='4' Text='لا تُغلق هذه النافذة أثناء التثبيت' FontSize='12' Foreground='{DynamicResource TextMuted}' HorizontalAlignment='Center' Margin='0,10,0,0'/>
          </Grid>

          <!-- SUCCESS -->
          <Grid x:Name='ScreenDone' Margin='56,18,56,20' Visibility='Collapsed'>
            <StackPanel VerticalAlignment='Center' HorizontalAlignment='Center'>
              <Grid Width='96' Height='96' HorizontalAlignment='Center'>
                <Ellipse x:Name='DoneRing' Fill='{DynamicResource SuccessTint}' RenderTransformOrigin='0.5,0.5'><Ellipse.RenderTransform><ScaleTransform x:Name='DoneScale' ScaleX='0.4' ScaleY='0.4'/></Ellipse.RenderTransform></Ellipse>
                <Path x:Name='DoneTick' Data='M 28,50 L 43,65 L 70,34' Stroke='{DynamicResource Success}' StrokeThickness='7' StrokeStartLineCap='Round' StrokeEndLineCap='Round' StrokeLineJoin='Round' StrokeDashArray='12 12' StrokeDashOffset='12'/>
              </Grid>
              <TextBlock x:Name='DoneTitle' Text='اكتمل التثبيت بنجاح' FontSize='24' FontWeight='Bold' Foreground='{DynamicResource Text}' HorizontalAlignment='Center' Margin='0,16,0,0'/>
              <TextBlock x:Name='DoneSub' TextAlignment='Center' TextWrapping='Wrap' MaxWidth='520' FontSize='14' LineHeight='24' Foreground='{DynamicResource Text2}' Margin='0,8,0,0'
                         Text='نظام نوفا للتجميل جاهز للعمل. لديك فترة تجريبية كاملة لمدة 14 يوماً، ويمكنك تفعيل الترخيص في أي وقت من أيقونة «إدارة الترخيص».'/>
              <Button x:Name='BtnLaunch' Style='{StaticResource BtnPrimary}' Content='تشغيل التطبيق الآن' MinWidth='300' Margin='0,26,0,0'/>
              <Button x:Name='BtnFinish' Style='{StaticResource BtnLink}' Content='إغلاق' HorizontalAlignment='Center' Margin='0,10,0,0'/>
            </StackPanel>
          </Grid>

          <!-- ERROR -->
          <Grid x:Name='ScreenError' Margin='56,18,56,20' Visibility='Collapsed'>
            <StackPanel VerticalAlignment='Center' HorizontalAlignment='Center'>
              <Border Width='84' Height='84' CornerRadius='42' Background='{DynamicResource DangerTint}' HorizontalAlignment='Center'><TextBlock Text='!' FontSize='46' FontWeight='Bold' Foreground='{DynamicResource Danger}' HorizontalAlignment='Center' VerticalAlignment='Center'/></Border>
              <TextBlock x:Name='ErrTitle' Text='تعذّر إكمال العملية' FontSize='22' FontWeight='Bold' Foreground='{DynamicResource Text}' HorizontalAlignment='Center' Margin='0,14,0,0'/>
              <TextBlock x:Name='ErrMsg' TextAlignment='Center' TextWrapping='Wrap' MaxWidth='540' FontSize='14' LineHeight='24' Foreground='{DynamicResource Text2}' Margin='0,8,0,0'/>
              <StackPanel Orientation='Horizontal' HorizontalAlignment='Center' Margin='0,22,0,0'>
                <Button x:Name='BtnErrLog' Style='{StaticResource BtnSecondary}' Content='عرض السجل'/>
                <Button x:Name='BtnErrClose' Style='{StaticResource BtnPrimary}' Content='إغلاق' Padding='36,11' FontSize='15' Margin='12,0,0,0'/>
              </StackPanel>
            </StackPanel>
          </Grid>

          <!-- UNINSTALL CONFIRM -->
          <Grid x:Name='ScreenUninstall' Margin='56,22,56,20' Visibility='Collapsed'>
            <StackPanel VerticalAlignment='Center'>
              <TextBlock Text='إلغاء تثبيت نوفا للتجميل' FontSize='22' FontWeight='Bold' Foreground='{DynamicResource Text}' HorizontalAlignment='Center'/>
              <TextBlock x:Name='UnText' TextAlignment='Center' TextWrapping='Wrap' FontSize='14' LineHeight='24' Foreground='{DynamicResource Text2}' Margin='0,8,0,0'
                         Text='سيتم إيقاف النظام وحذف ملفات البرنامج والاختصارات من هذا الجهاز.'/>
              <Border CornerRadius='16' Background='{DynamicResource Tint}' Padding='18,14' Margin='0,18,0,0'>
                <CheckBox x:Name='ChkDeleteData' Style='{StaticResource Check}' Content='احذف أيضاً بياناتي (قاعدة البيانات، الصور، النسخ الاحتياطية، الترخيص)'/>
              </Border>
              <TextBlock Text='اتركه بدون تحديد للاحتفاظ ببياناتك عند إعادة التثبيت لاحقاً.' FontSize='12' Foreground='{DynamicResource TextMuted}' HorizontalAlignment='Center' Margin='0,8,0,0'/>
              <StackPanel Orientation='Horizontal' HorizontalAlignment='Center' Margin='0,24,0,0'>
                <Button x:Name='BtnUnGo' Style='{StaticResource BtnPrimary}' Content='إلغاء التثبيت' Padding='40,12' FontSize='16'/>
                <Button x:Name='BtnUnCancel' Style='{StaticResource BtnSecondary}' Content='إلغاء' Margin='12,0,0,0'/>
              </StackPanel>
            </StackPanel>
          </Grid>

          <!-- EULA overlay -->
          <Grid x:Name='ScreenEula' Visibility='Collapsed' Background='{DynamicResource Scrim}'>
            <Border Margin='34,18,34,18' CornerRadius='20' Background='{DynamicResource Surface}' BorderBrush='{DynamicResource Border}' BorderThickness='1' Padding='22,18'>
              <Grid>
                <Grid.RowDefinitions><RowDefinition Height='Auto'/><RowDefinition Height='*'/><RowDefinition Height='Auto'/></Grid.RowDefinitions>
                <TextBlock Text='اتفاقية الترخيص وشروط الاستخدام' FontSize='17' FontWeight='Bold' Foreground='{DynamicResource Text}'/>
                <ScrollViewer Grid.Row='1' Margin='0,10,0,10' VerticalScrollBarVisibility='Auto'><TextBlock x:Name='EulaText' TextWrapping='Wrap' FontSize='13.5' LineHeight='24' Foreground='{DynamicResource Text2}'/></ScrollViewer>
                <Button x:Name='BtnEulaClose' Grid.Row='2' Style='{StaticResource BtnPrimary}' Content='موافق وإغلاق' HorizontalAlignment='Left' Padding='34,9' FontSize='14'/>
              </Grid>
            </Border>
          </Grid>
        </Grid>
      </Grid>
    </Border>
  </Grid>
</Window>";

        static SolidColorBrush B(string hex) { return (SolidColorBrush)new BrushConverter().ConvertFromString(hex); }

        public static void ApplyTheme(Window w, bool dark)
        {
            ResourceDictionary r = w.Resources;
            r["Bg"] = B(dark ? "#1A1119" : "#FFFFFF");
            r["Surface"] = B(dark ? "#241923" : "#FFFFFF");
            r["Tint"] = B(dark ? "#35202F" : "#F8EDF3");
            r["Border"] = B(dark ? "#3A2B39" : "#F0E2E9");
            r["Border2"] = B(dark ? "#5A4558" : "#E0C9D4");
            r["Track"] = B(dark ? "#3A2B39" : "#F0E2E9");
            r["Text"] = B(dark ? "#F8EEF3" : "#2B1B26");
            r["Text2"] = B(dark ? "#CDB6C4" : "#6F5A68");
            r["TextMuted"] = B(dark ? "#988294" : "#9C879A");
            r["Primary"] = B(dark ? "#E6A9CB" : "#6E2A55");
            r["Accent"] = B(dark ? "#F0719F" : "#C03A72");
            r["Success"] = B(dark ? "#4ADE80" : "#1F8A5B");
            r["SuccessTint"] = B(dark ? "#123322" : "#E3F4EC");
            r["Danger"] = B(dark ? "#F1786D" : "#C0362C");
            r["DangerTint"] = B(dark ? "#3A1512" : "#FCE8E6");
            r["Scrim"] = B(dark ? "#CC0E080D" : "#D9FFFFFF");
            LinearGradientBrush g = new LinearGradientBrush();
            g.StartPoint = new Point(0, 0); g.EndPoint = new Point(1, 1);
            g.GradientStops.Add(new GradientStop((Color)ColorConverter.ConvertFromString("#D4528A"), 0));
            g.GradientStops.Add(new GradientStop((Color)ColorConverter.ConvertFromString("#B8346B"), 1));
            r["AccentGrad"] = g;
        }

        public static void LoadFont(Window w)
        {
            try
            {
                string dir = IOPath.Combine(IOPath.GetTempPath(), "NovaSetupFonts");
                Directory.CreateDirectory(dir);
                string[] names = new string[] { "Cairo-Regular.ttf", "Cairo-Bold.ttf" };
                bool ok = true;
                foreach (string n in names)
                {
                    string f = IOPath.Combine(dir, n);
                    Stream s = Core.Res(n);
                    if (s == null) { ok = false; continue; }
                    if (!File.Exists(f) || new FileInfo(f).Length != s.Length)
                        using (FileStream fs = File.Create(f)) { s.CopyTo(fs); }
                }
                if (ok) w.FontFamily = new FontFamily(new Uri("file:///" + dir.Replace('\\', '/') + "/"), "./#Cairo");
                else w.FontFamily = new FontFamily("Segoe UI, Tahoma");
            }
            catch (Exception) { w.FontFamily = new FontFamily("Segoe UI, Tahoma"); }
        }

        public static BitmapImage LogoImage()
        {
            Stream s = Core.Res("logo.png");
            if (s == null) return null;
            BitmapImage bi = new BitmapImage();
            bi.BeginInit(); bi.CacheOption = BitmapCacheOption.OnLoad; bi.StreamSource = s; bi.EndInit(); bi.Freeze();
            return bi;
        }

        public static string EulaText()
        {
            try { using (StreamReader r = new StreamReader(Core.Res("eula.txt"), Encoding.UTF8)) return r.ReadToEnd(); }
            catch (Exception) { return ""; }
        }
    }

    // ------------------------------------------------------------------------------------------------
    //  Main window logic
    // ------------------------------------------------------------------------------------------------
    public class App
    {
        Window w;
        bool dark;
        Opts opts = new Opts();
        bool dirEdited;
        bool uninstallMode;
        Core.InstallInfo uninfo;
        string[] tips = new string[] {
            "نقطة بيع سريعة بالصور، وتدعم الدفع النقدي والتحويلات والدفع المقسّم.",
            "جدولة الحجوزات ومتابعة أداء كل موظفة لحظياً من لوحة واحدة.",
            "مخزون دقيق مع تنبيهات تلقائية قبل نفاد المنتجات.",
            "تقارير مالية ومصروفات ورواتب قابلة للطباعة والتصدير.",
            "نسخة احتياطية تلقائية يومية لبياناتك، مع إمكانية الاستعادة بضغطة.",
            "ارفع شعار منشأتك مرة واحدة ليتحول تلقائياً إلى أيقونة النظام."
        };
        int tipIdx;
        DispatcherTimer tipTimer;
        string lastScreen = "home";
        string[] feat = new string[] { "يعمل دون إنترنت", "نسخ احتياطي يومي", "ترخيص مرتبط بجهازك", "تجربة 14 يوماً" };

        T Get<T>(string name) where T : class { return w.FindName(name) as T; }

        public App(Dictionary<string, string> args)
        {
            w = (Window)XamlReader.Parse(Ui.Xaml);
            Ui.LoadFont(w);
            dark = args.ContainsKey("dark");
            try { using (RegistryKey k = Registry.CurrentUser.CreateSubKey(@"Software\NovaBeauty\Setup")) { if (!args.ContainsKey("light") && !args.ContainsKey("dark") && k != null) dark = Convert.ToString(k.GetValue("theme")) == "dark"; } } catch (Exception) { }
            Ui.ApplyTheme(w, dark);
            BitmapImage logo = Ui.LogoImage();
            if (logo != null) { Get<Image>("Logo").Source = logo; w.Icon = logo; }
            Get<TextBlock>("EulaText").Text = Ui.EulaText();
            UpdateThemeGlyph();

            foreach (string f in feat)
            {
                Border b = new Border();
                b.CornerRadius = new CornerRadius(14); b.Padding = new Thickness(11, 3, 11, 3); b.Margin = new Thickness(4, 3, 4, 3);
                b.SetResourceReference(Border.BackgroundProperty, "Tint");
                TextBlock t = new TextBlock(); t.Text = "✓  " + f; t.FontSize = 12; t.FontWeight = FontWeights.SemiBold;
                t.SetResourceReference(TextBlock.ForegroundProperty, "Primary");
                b.Child = t; Get<WrapPanel>("Chips").Children.Add(b);
            }

            // window chrome
            Border banner = Get<Border>("Banner");
            banner.SizeChanged += delegate
            {
                double W = banner.ActualWidth, H = banner.ActualHeight, R = 25;
                StreamGeometry g = new StreamGeometry();
                using (StreamGeometryContext c = g.Open())
                {
                    c.BeginFigure(new Point(0, R), true, true);
                    c.ArcTo(new Point(R, 0), new Size(R, R), 0, false, SweepDirection.Clockwise, true, false);
                    c.LineTo(new Point(W - R, 0), true, false);
                    c.ArcTo(new Point(W, R), new Size(R, R), 0, false, SweepDirection.Clockwise, true, false);
                    c.LineTo(new Point(W, H), true, false);
                    c.LineTo(new Point(0, H), true, false);
                }
                g.Freeze(); banner.Clip = g;
            };
            w.MouseLeftButtonDown += delegate(object s, MouseButtonEventArgs e) { if (e.GetPosition(w).Y < 70 && e.OriginalSource is FrameworkElement && !(e.OriginalSource is Button)) { try { w.DragMove(); } catch (Exception) { } } };
            Get<Button>("BtnClose").Click += delegate { OnClose(); };
            Get<Button>("BtnMin").Click += delegate { w.WindowState = WindowState.Minimized; };
            Get<Button>("BtnTheme").Click += delegate
            {
                dark = !dark; Ui.ApplyTheme(w, dark); UpdateThemeGlyph();
                try { using (RegistryKey k = Registry.CurrentUser.CreateSubKey(@"Software\NovaBeauty\Setup")) { k.SetValue("theme", dark ? "dark" : "light"); } } catch (Exception) { }
            };
            w.Closing += delegate(object s, CancelEventArgs e) { if (busy) e.Cancel = true; };

            // home
            Get<Button>("BtnInstall").Click += delegate { StartInstall(); };
            Get<Button>("BtnCustom").Click += delegate { Show("options"); };
            Get<Hyperlink>("LinkEula").Click += delegate { Get<Grid>("ScreenEula").Visibility = Visibility.Visible; };
            Get<Button>("BtnEulaClose").Click += delegate { Get<Grid>("ScreenEula").Visibility = Visibility.Collapsed; };

            // options
            Get<RadioButton>("RadAll").Checked += delegate { if (!dirEdited) SetDir(true); RefreshSpace(); };
            Get<RadioButton>("RadUser").Checked += delegate { if (!dirEdited) SetDir(false); RefreshSpace(); };
            Get<TextBox>("TxtDir").TextChanged += delegate { RefreshSpace(); };
            Get<TextBox>("TxtDir").PreviewTextInput += delegate { dirEdited = true; };
            Get<Button>("BtnBrowse").Click += delegate
            {
                using (System.Windows.Forms.FolderBrowserDialog d = new System.Windows.Forms.FolderBrowserDialog())
                {
                    d.Description = "اختر المجلد الذي سيُثبَّت فيه نوفا للتجميل";
                    if (d.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                    {
                        string p = d.SelectedPath;
                        if (!p.EndsWith("NovaBeauty", StringComparison.OrdinalIgnoreCase)) p = IOPath.Combine(p, "NovaBeauty");
                        Get<TextBox>("TxtDir").Text = p; dirEdited = true;
                    }
                }
            };
            Get<Button>("BtnOptBack").Click += delegate { Show("home"); };
            Get<Button>("BtnOptInstall").Click += delegate { StartInstall(); };

            // success / error
            Get<Button>("BtnLaunch").Click += delegate { Core.OpenApp(opts.Port, ""); w.Close(); };
            Get<Button>("BtnFinish").Click += delegate { w.Close(); };
            Get<Button>("BtnErrClose").Click += delegate { w.Close(); };
            Get<Button>("BtnErrLog").Click += delegate { try { Process.Start(new ProcessStartInfo(Core.LogFile) { UseShellExecute = true }); } catch (Exception) { } };

            // uninstall
            Get<Button>("BtnUnCancel").Click += delegate { w.Close(); };
            Get<Button>("BtnUnGo").Click += delegate { StartUninstall(); };

            SetDir(true);
            opts.Port = args.ContainsKey("port") ? Convert.ToInt32(args["port"]) : 5173;
            Get<TextBlock>("SpaceHint").Text = "المساحة المطلوبة: " + Core.Size(Core.PayloadBytes());
            w.ContentRendered += delegate { };
        }

        public Window Win { get { return w; } }
        bool busy;

        void UpdateThemeGlyph() { Get<Button>("BtnTheme").Content = dark ? "☀" : "☾"; Get<Button>("BtnTheme").ToolTip = dark ? "التحويل إلى الوضع النهاري" : "التحويل إلى الوضع الليلي"; }

        void OnClose() { if (!busy) w.Close(); }

        void SetDir(bool all) { Get<TextBox>("TxtDir").Text = Core.DefaultDir(all); }

        void RefreshSpace()
        {
            TextBlock t = Get<TextBlock>("SpaceLine");
            if (t == null) return;
            string d = Get<TextBox>("TxtDir").Text;
            long need = Core.PayloadBytes();
            long free;
            try { free = string.IsNullOrWhiteSpace(d) ? -1 : Core.FreeBytes(d); } catch (Exception) { free = -1; }
            string txt = "المساحة المطلوبة: " + Core.Size(need) + "   ·   المتاحة: " + Core.Size(free);
            t.Text = txt;
            string key = free < 0 ? "Text2" : free < need + 50L * 1048576 ? "Danger" : "Success";
            t.SetResourceReference(TextBlock.ForegroundProperty, key);
        }

        public void Show(string screen)
        {
            lastScreen = screen;
            string[] all = new string[] { "ScreenHome", "ScreenOptions", "ScreenProgress", "ScreenDone", "ScreenError", "ScreenUninstall" };
            string target = screen == "home" ? "ScreenHome" : screen == "options" ? "ScreenOptions" : screen == "progress" ? "ScreenProgress" :
                            screen == "done" ? "ScreenDone" : screen == "error" ? "ScreenError" : "ScreenUninstall";
            foreach (string n in all) Get<Grid>(n).Visibility = n == target ? Visibility.Visible : Visibility.Collapsed;
            Grid g = Get<Grid>(target);
            g.Opacity = 0;
            g.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(260)));
            bool compact = screen == "options" || screen == "progress" || screen == "error" || screen == "uninstall";
            Get<Grid>("Inner").RowDefinitions[0].Height = new GridLength(compact ? 124 : 188);
            Get<TextBlock>("BannerSub").Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
            Border lg = (Border)Get<Image>("Logo").Parent; lg.Width = lg.Height = compact ? 54 : 78; lg.CornerRadius = new CornerRadius(compact ? 27 : 39);
            Get<TextBlock>("BannerTitle").FontSize = compact ? 20 : 24;
            if (screen == "options") RefreshSpace();
            if (screen == "done") PlayDone();
        }

        void PlayDone()
        {
            ScaleTransform sc = (ScaleTransform)w.FindName("DoneScale");
            BackEase be = new BackEase(); be.Amplitude = 0.5; be.EasingMode = EasingMode.EaseOut;
            DoubleAnimation a = new DoubleAnimation(0.4, 1, TimeSpan.FromMilliseconds(520)); a.EasingFunction = be;
            sc.BeginAnimation(ScaleTransform.ScaleXProperty, a); sc.BeginAnimation(ScaleTransform.ScaleYProperty, a);
            System.Windows.Shapes.Path tick = Get<System.Windows.Shapes.Path>("DoneTick");
            DoubleAnimation d = new DoubleAnimation(12, 0, TimeSpan.FromMilliseconds(520)); d.BeginTime = TimeSpan.FromMilliseconds(260);
            tick.BeginAnimation(System.Windows.Shapes.Shape.StrokeDashOffsetProperty, d);
        }

        void SetProgress(double pct, string msg)
        {
            ProgressBar bar = Get<ProgressBar>("Bar");
            bar.BeginAnimation(ProgressBar.ValueProperty, new DoubleAnimation(pct, TimeSpan.FromMilliseconds(260)));
            Get<TextBlock>("ProgPct").Text = Math.Round(pct) + "%";
            if (msg != null) Get<TextBlock>("ProgMsg").Text = msg;
        }

        void StartTips()
        {
            TextBlock t = Get<TextBlock>("TipText");
            t.Text = tips[0];
            tipTimer = new DispatcherTimer(); tipTimer.Interval = TimeSpan.FromSeconds(3.6);
            tipTimer.Tick += delegate
            {
                DoubleAnimation o = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(260));
                o.Completed += delegate
                {
                    tipIdx = (tipIdx + 1) % tips.Length; t.Text = tips[tipIdx];
                    t.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(320)));
                };
                t.BeginAnimation(UIElement.OpacityProperty, o);
            };
            tipTimer.Start();
        }

        Opts ReadOpts(bool fromOptionsScreen)
        {
            Opts o = new Opts();
            o.Port = opts.Port;
            if (fromOptionsScreen)
            {
                o.AllUsers = Get<RadioButton>("RadAll").IsChecked == true;
                o.Dir = Get<TextBox>("TxtDir").Text.Trim();
                o.Desktop = Get<CheckBox>("ChkDesktop").IsChecked == true;
                o.StartMenu = Get<CheckBox>("ChkStart").IsChecked == true;
                o.AutoStart = Get<CheckBox>("ChkAuto").IsChecked == true;
                o.Launch = Get<CheckBox>("ChkLaunch").IsChecked == true;
            }
            else { o.AllUsers = true; o.Dir = Core.DefaultDir(true); }
            return o;
        }

        public void RunInstall(Opts o)
        {
            opts = o; busy = true;
            Get<TextBlock>("ProgTitle").Text = "جارٍ تثبيت نوفا للتجميل";
            Show("progress"); SetProgress(0, "جارٍ التحضير…"); StartTips();
            Thread th = new Thread(delegate()
            {
                Exception err = null;
                try { Core.Install(o, delegate(double p, string m) { w.Dispatcher.BeginInvoke(new Action(delegate { SetProgress(p, m); })); }); }
                catch (Exception ex) { err = ex; Core.L("ERROR: " + ex); }
                w.Dispatcher.BeginInvoke(new Action(delegate
                {
                    busy = false;
                    if (tipTimer != null) tipTimer.Stop();
                    if (err != null)
                    {
                        Get<TextBlock>("ErrTitle").Text = "تعذّر إكمال التثبيت";
                        Get<TextBlock>("ErrMsg").Text = err.Message;
                        Show("error");
                    }
                    else
                    {
                        Show("done");
                        if (o.Launch) { DispatcherTimer t = new DispatcherTimer(); t.Interval = TimeSpan.FromMilliseconds(1400); t.Tick += delegate { t.Stop(); Core.OpenApp(o.Port, ""); }; t.Start(); }
                    }
                }));
            });
            th.IsBackground = true; th.SetApartmentState(ApartmentState.STA); th.Start();
        }

        void StartInstall()
        {
            bool fromOpts = lastScreen == "options";
            Opts o = ReadOpts(fromOpts);
            if (string.IsNullOrWhiteSpace(o.Dir)) { MessageBox.Show("حدّد مسار التثبيت."); return; }
            if (o.AllUsers && !Core.IsAdmin())
            {
                // relaunch elevated (UAC), the elevated instance goes straight to the progress screen
                try
                {
                    StringBuilder sb = new StringBuilder("--auto --all --dir \"" + o.Dir + "\" --port " + o.Port);
                    if (!o.Desktop) sb.Append(" --no-desktop");
                    if (!o.StartMenu) sb.Append(" --no-startmenu");
                    if (!o.AutoStart) sb.Append(" --no-autostart");
                    if (!o.Launch) sb.Append(" --no-launch");
                    if (dark) sb.Append(" --dark");
                    ProcessStartInfo psi = new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, sb.ToString());
                    psi.UseShellExecute = true; psi.Verb = "runas";
                    Process.Start(psi);
                    w.Close();
                }
                catch (Win32Exception) { MessageBox.Show("لم تتم الموافقة على صلاحية المدير. اختر «للمستخدم الحالي فقط» لتثبيت بدون صلاحيات، أو أعد المحاولة.", "نوفا للتجميل", MessageBoxButton.OK, MessageBoxImage.Information); }
                return;
            }
            RunInstall(o);
        }

        // --------------------------------------------------------------------------- uninstall
        public void ShowUninstall(Core.InstallInfo info)
        {
            uninstallMode = true; uninfo = info;
            Get<TextBlock>("BannerTitle").Text = "إلغاء تثبيت نوفا للتجميل";
            Get<TextBlock>("BannerSub").Text = "الإصدار " + Core.Version;
            Show("uninstall");
        }

        void StartUninstall()
        {
            bool del = Get<CheckBox>("ChkDeleteData").IsChecked == true;
            busy = true;
            Get<TextBlock>("ProgTitle").Text = "جارٍ إلغاء التثبيت";
            Show("progress"); SetProgress(0, "جارٍ التحضير…"); StartTips();
            Thread th = new Thread(delegate()
            {
                Exception err = null;
                try { Core.Uninstall(uninfo, del, delegate(double p, string m) { w.Dispatcher.BeginInvoke(new Action(delegate { SetProgress(p, m); })); }); }
                catch (Exception ex) { err = ex; Core.L("ERROR: " + ex); }
                w.Dispatcher.BeginInvoke(new Action(delegate
                {
                    busy = false; if (tipTimer != null) tipTimer.Stop();
                    if (err != null) { Get<TextBlock>("ErrTitle").Text = "تعذّر إلغاء التثبيت"; Get<TextBlock>("ErrMsg").Text = err.Message; Show("error"); }
                    else
                    {
                        Get<TextBlock>("DoneTitle").Text = "تم إلغاء التثبيت";
                        Get<TextBlock>("DoneSub").Text = del ? "تم حذف النظام وبياناته من هذا الجهاز." : "تم حذف النظام. بياناتك محفوظة ويمكنك استعادتها عند إعادة التثبيت.";
                        Get<Button>("BtnLaunch").Visibility = Visibility.Collapsed;
                        Show("done");
                    }
                }));
            });
            th.IsBackground = true; th.Start();
        }
    }

    // ------------------------------------------------------------------------------------------------
    //  Entry point
    // ------------------------------------------------------------------------------------------------
    public static class Program
    {
        static Dictionary<string, string> Parse(string[] a)
        {
            Dictionary<string, string> d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < a.Length; i++)
            {
                if (!a[i].StartsWith("--")) continue;
                string k = a[i].Substring(2);
                if (i + 1 < a.Length && !a[i + 1].StartsWith("--")) { d[k] = a[i + 1]; i++; } else d[k] = "1";
            }
            return d;
        }

        static void Render(App app, string screen, string png)
        {
            Window w = app.Win;
            if (screen == "uninstall") app.ShowUninstall(new Core.InstallInfo { AllUsers = false, Dir = "C:\\x" }); else app.Show(screen == "eula" ? "home" : screen);
            if (screen == "progress") { }
            w.WindowStartupLocation = WindowStartupLocation.Manual; w.Left = 40; w.Top = 20; w.ShowInTaskbar = false; w.Topmost = true;
            w.ContentRendered += delegate
            {
                DispatcherTimer t = new DispatcherTimer(); t.Interval = TimeSpan.FromMilliseconds(1600);
                t.Tick += delegate
                {
                    t.Stop();
                    if (screen == "eula") ((Grid)w.FindName("ScreenEula")).Visibility = Visibility.Visible;
                    DispatcherTimer t2 = new DispatcherTimer(); t2.Interval = TimeSpan.FromMilliseconds(500);
                    t2.Tick += delegate
                    {
                        t2.Stop();
                        // real screen capture (RenderTargetBitmap mirrors RTL content)
                        Matrix m = PresentationSource.FromVisual(w).CompositionTarget.TransformToDevice;
                        Point p = w.PointToScreen(new Point(0, 0));
                        int pw = (int)(w.ActualWidth * m.M11), ph = (int)(w.ActualHeight * m.M22);
                        using (System.Drawing.Bitmap bmp = new System.Drawing.Bitmap(pw, ph))
                        using (System.Drawing.Graphics g = System.Drawing.Graphics.FromImage(bmp))
                        {
                            g.CopyFromScreen((int)p.X, (int)p.Y, 0, 0, new System.Drawing.Size(pw, ph));
                            bmp.Save(png, System.Drawing.Imaging.ImageFormat.Png);
                        }
                        Application.Current.Shutdown();
                    };
                    t2.Start();
                };
                t.Start();
            };
        }

        // Deletes this temp copy, the (now idle) uninstall.exe in the install folder, and the folder itself if empty.
        static void SelfClean(string self, string dir)
        {
            try
            {
                string cmd = "/c ping 127.0.0.1 -n 4 >nul & del /f /q \"" + self + "\"";
                if (!string.IsNullOrEmpty(dir)) cmd += " & del /f /q \"" + IOPath.Combine(dir, "uninstall.exe") + "\" & rmdir \"" + dir + "\"";
                Process.Start(new ProcessStartInfo("cmd.exe", cmd) { CreateNoWindow = true, UseShellExecute = false });
            }
            catch (Exception) { }
        }

        [STAThread]
        public static int Main(string[] argv)
        {
            Dictionary<string, string> a = Parse(argv);

#if UNINSTALLER
            Core.InstallInfo info = Core.FindInstall();
            string me = Assembly.GetExecutingAssembly().Location;
            // run from a temp copy so the install folder (which contains this exe) can be removed
            if (info != null && !a.ContainsKey("tmp") && me.StartsWith(info.Dir, StringComparison.OrdinalIgnoreCase))
            {
                string tmp = IOPath.Combine(IOPath.GetTempPath(), "nova-uninstall-" + Guid.NewGuid().ToString("N").Substring(0, 6) + ".exe");
                File.Copy(me, tmp, true);
                ProcessStartInfo p0 = new ProcessStartInfo(tmp, string.Join(" ", argv) + " --tmp");
                p0.UseShellExecute = true;
                if (info.AllUsers && !Core.IsAdmin() && !a.ContainsKey("silent")) p0.Verb = "runas";
                try { Process p = Process.Start(p0); if (a.ContainsKey("silent")) { p.WaitForExit(); return p.ExitCode; } } catch (Win32Exception) { }
                return 0;
            }
            if (a.ContainsKey("silent"))
            {
                int rc = 0;
                if (info != null)
                {
                    if (info.AllUsers && !Core.IsAdmin()) return 5;
                    Core.Uninstall(info, a.ContainsKey("deletedata"), delegate(double p, string m) { });
                }
                if (a.ContainsKey("tmp"))
                {
                    SelfClean(me, info == null ? null : info.Dir);
                }
                return rc;
            }
            if (info != null && info.AllUsers && !Core.IsAdmin())
            {
                ProcessStartInfo p1 = new ProcessStartInfo(me, "--tmp"); p1.UseShellExecute = true; p1.Verb = "runas";
                try { Process.Start(p1); } catch (Win32Exception) { }
                return 0;
            }
#else
            if (a.ContainsKey("silent"))
            {
                Opts so = new Opts();
                so.AllUsers = !a.ContainsKey("user");
                so.Dir = a.ContainsKey("dir") ? a["dir"] : Core.DefaultDir(so.AllUsers);
                so.Desktop = !a.ContainsKey("no-desktop"); so.StartMenu = !a.ContainsKey("no-startmenu"); so.AutoStart = !a.ContainsKey("no-autostart");
                if (a.ContainsKey("port")) so.Port = Convert.ToInt32(a["port"]);
                if (so.AllUsers && !Core.IsAdmin()) { Console.Error.WriteLine("needs admin"); return 5; }
                try { Core.Install(so, delegate(double p, string m) { }); return 0; }
                catch (Exception ex) { Core.L("silent install failed: " + ex); return 1; }
            }
#endif
            Application app = new Application();
            App ui = new App(a);
            app.ShutdownMode = ShutdownMode.OnMainWindowClose;

            if (a.ContainsKey("snapshot"))
            {
                string screen = a["snapshot"];
                string png = a.ContainsKey("out") ? a["out"] : "snap.png";
                Render(ui, screen, png);
                return app.Run(ui.Win);
            }

#if UNINSTALLER
            if (info == null) { MessageBox.Show("لم يتم العثور على تثبيت لنوفا للتجميل على هذا الجهاز.", "نوفا للتجميل"); return 0; }
            ui.ShowUninstall(info);
            app.Run(ui.Win);
            if (a.ContainsKey("tmp"))
            {
                SelfClean(Assembly.GetExecutingAssembly().Location, info.Dir);
            }
            return 0;
#else
            if (a.ContainsKey("auto"))
            {
                Opts o = new Opts();
                o.AllUsers = a.ContainsKey("all");
                o.Dir = a.ContainsKey("dir") ? a["dir"] : Core.DefaultDir(o.AllUsers);
                o.Desktop = !a.ContainsKey("no-desktop"); o.StartMenu = !a.ContainsKey("no-startmenu"); o.AutoStart = !a.ContainsKey("no-autostart"); o.Launch = !a.ContainsKey("no-launch");
                if (a.ContainsKey("port")) o.Port = Convert.ToInt32(a["port"]);
                ui.Win.ContentRendered += delegate { ui.RunInstall(o); };
            }
            else
            {
                ui.Show("home");
            }
            return app.Run(ui.Win);
#endif
        }
    }
}
