// Nova Beauty — real Windows Service host.
// Starts the bundled Node.js server, restarts it if it exits, and logs its output.
// Build:  installer\build-service.bat     Debug run (no service):  NovaService.exe --console
using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Threading;

public class NovaService : ServiceBase
{
    private Process node;
    private volatile bool stopping;
    private Thread supervisor;
    private readonly string appDir;
    private readonly string homeDir;
    private readonly string logFile;

    public NovaService()
    {
        ServiceName = "NovaBeauty";
        CanStop = true;
        AutoLog = true;
        string env = Environment.GetEnvironmentVariable("NOVA_APP_DIR");
        appDir = !string.IsNullOrEmpty(env) ? env : AppDomain.CurrentDomain.BaseDirectory;
        string home = Environment.GetEnvironmentVariable("NOVA_HOME_DIR");
        if (string.IsNullOrEmpty(home))
#if USERMODE
            home = Path.Combine(Environment.GetEnvironmentVariable("LocalAppData") ?? Path.GetTempPath(), "NovaBeauty");
#else
            home = Path.Combine(Environment.GetEnvironmentVariable("ProgramData") ?? @"C:\ProgramData", "NovaBeauty");
#endif
        homeDir = home;
        logFile = Path.Combine(homeDir, "logs", "service.log");
    }

#if USERMODE
    static void Main(string[] args)
    {
        // Per-user host (no admin, no Windows service): runs the server hidden while the user is logged in.
        bool first;
        using (Mutex mx = new Mutex(true, "Nova.Beauty.User.Host", out first))
        {
            if (!first) return;
            EventWaitHandle stop = new EventWaitHandle(false, EventResetMode.ManualReset, "Nova.Beauty.User.Stop");
            NovaService s = new NovaService();
            s.Begin();
            stop.WaitOne();
            s.End();
        }
    }
#else
    static void Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--console")
        {
            NovaService s = new NovaService();
            s.Begin();
            Console.WriteLine("Nova Beauty is running (console mode). Press Enter to stop.");
            Console.ReadLine();
            s.End();
        }
        else
        {
            ServiceBase.Run(new NovaService());
        }
    }
#endif

    protected override void OnStart(string[] args) { Begin(); }
    protected override void OnStop() { End(); }

    private void Begin()
    {
        stopping = false;
        supervisor = new Thread(Loop);
        supervisor.IsBackground = true;
        supervisor.Start();
    }

    private void End()
    {
        stopping = true;
        try
        {
            if (node != null && !node.HasExited)
            {
                node.Kill();
                node.WaitForExit(5000);
            }
        }
        catch (Exception) { }
    }

    private void Loop()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(logFile));
            FileInfo fi = new FileInfo(logFile);
            if (fi.Exists && fi.Length > 5 * 1024 * 1024) File.Move(logFile, logFile + ".old");
        }
        catch (Exception) { }

        while (!stopping)
        {
            try
            {
                string nodeExe = Path.Combine(appDir, "node", "node.exe");
                if (!File.Exists(nodeExe)) nodeExe = "node";
                string script = Path.Combine(Path.Combine(appDir, "server"), "server.js");

                ProcessStartInfo psi = new ProcessStartInfo(nodeExe, "\"" + script + "\"");
                psi.WorkingDirectory = appDir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                SetDefault(psi, "NOVA_MODE", "installed");
                SetDefault(psi, "NOVA_HOME_DIR", homeDir);
                SetDefault(psi, "NOVA_DATA_DIR", Path.Combine(homeDir, "data"));
                psi.EnvironmentVariables["NOVA_SUPERVISED"] = "1";
                try
                {
                    string pf = Path.Combine(homeDir, "port.txt");
                    if (File.Exists(pf)) { string pt = File.ReadAllText(pf).Trim(); if (pt.Length > 0 && pt.Length <= 5) psi.EnvironmentVariables["PORT"] = pt; }
                }
                catch (Exception) { }

                node = Process.Start(psi);
                node.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { Append(e.Data); };
                node.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { Append(e.Data); };
                node.BeginOutputReadLine();
                node.BeginErrorReadLine();
                Append("node started, pid " + node.Id);
                node.WaitForExit();
                Append("node exited with code " + node.ExitCode);
            }
            catch (Exception ex)
            {
                Append("failed to start node: " + ex.Message);
            }
            if (stopping) break;
            Thread.Sleep(3000);
        }
    }

    private static void SetDefault(ProcessStartInfo psi, string name, string value)
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable(name))) psi.EnvironmentVariables[name] = value;
    }

    private void Append(string line)
    {
        if (string.IsNullOrEmpty(line)) return;
        try
        {
            lock (this)
            {
                File.AppendAllText(logFile, DateTime.Now.ToString("s") + " " + line + Environment.NewLine);
            }
        }
        catch (Exception) { }
    }
}
