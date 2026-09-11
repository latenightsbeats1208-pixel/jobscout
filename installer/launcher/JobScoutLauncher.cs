// ============================================================================
// JobScoutLauncher.cs — launcher natif de JobScout (compilé en JobScout.exe)
//
// Remplace l'ancien scripts/Start-JobScout.ps1 : pas de fenêtre PowerShell,
// pas de dépendance à la politique d'exécution, arrêt propre garanti.
//
// Ce qu'il fait :
//   1. prépare les données utilisateur sous %LOCALAPPDATA%\JobScout
//      (le répertoire d'installation reste en lecture seule) ;
//   2. choisit un port libre à partir de 3477 ;
//   3. lance runtime\node.exe app\server.js, console masquée, lié à 127.0.0.1 ;
//   4. attend que le serveur réponde, puis ouvre le navigateur par défaut ;
//   5. reste en zone de notification : « Ouvrir », « Dossier de données »,
//      « Journal du serveur », « Quitter JobScout » ;
//   6. tue le serveur à la fermeture — y compris si le launcher est tué, grâce
//      à un Job Object Windows marqué KILL_ON_JOB_CLOSE.
//
// Journal : logs\server.log dans le dossier de données, en UTF-8. node écrit
// sa sortie en UTF-8 quel que soit le codepage de la console ; le launcher la
// relit donc explicitement en UTF-8 (StandardOutputEncoding) et l'écrit en
// UTF-8 — sinon « ▲ Next.js » devient « â–² Next.js » dans le journal.
//
// Ressource de version (FileVersion, ProductName, FileDescription) : générée
// par build-launcher.mjs depuis version.json et le variant, compilée avec ce
// fichier.
//
// Compilé par installer/launcher/build-launcher.mjs avec csc.exe (.NET
// Framework 4, présent sur tout Windows 10/11 — aucun runtime à installer).
//
// Variant de build : build-launcher.mjs passe `/define:JOBSCOUT_VARIANT_TEST`
// pour l'installeur de test (installer/build.mjs --variant test). Le nom
// affiché devient « JobScout Test », les données vont dans
// %LOCALAPPDATA%\JobScout Test et le mutex est distinct : l'exécutable de test
// coexiste avec un JobScout standard sans rien partager. Sans define, le
// launcher standard est compilé à l'identique.
// ============================================================================
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace JobScout
{
    static class Program
    {
#if JOBSCOUT_VARIANT_TEST
        const string AppName = "JobScout Test";
        const string MutexName = "Local\\JobScoutTestLauncherSingleton";
#else
        const string AppName = "JobScout";
        const string MutexName = "Local\\JobScoutLauncherSingleton";
#endif
        const int FirstPort = 3477;
        const int PortAttempts = 24;
        const int StartupTimeoutSeconds = 120;

        static Process _server;
        static NotifyIcon _tray;
        static string _url;
        static string _dataDir;
        static string _logPath;
        // Journal en UTF-8 sans BOM (lisible par Notepad et par les outils).
        static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);

        [STAThread]
        static void Main(string[] args)
        {
            bool createdNew;
            using (var mutex = new Mutex(true, MutexName, out createdNew))
            {
                _dataDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppName);
                Directory.CreateDirectory(_dataDir);
                Directory.CreateDirectory(Path.Combine(_dataDir, "logs"));
                _logPath = Path.Combine(_dataDir, "logs", "server.log");

                if (!createdNew)
                {
                    // Déjà lancé : on rouvre simplement l'onglet.
                    string running = ReadRunningUrl();
                    if (running != null) OpenBrowser(running);
                    else Info(AppName + " est déjà en cours de démarrage.");
                    return;
                }

                Application.EnableVisualStyles();
                try { Run(args); }
                catch (Exception ex)
                {
                    Error(AppName + " n'a pas pu démarrer :\n\n" + ex.Message);
                    Shutdown();
                }
            }
        }

        static void Run(string[] args)
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            string nodeExe = Path.Combine(baseDir, "runtime", "node.exe");
            string appDir = Path.Combine(baseDir, "app");
            string serverJs = Path.Combine(appDir, "server.js");

            if (!File.Exists(nodeExe))
                throw new FileNotFoundException("Runtime introuvable : " + nodeExe);
            if (!File.Exists(serverJs))
                throw new FileNotFoundException("Serveur introuvable : " + serverJs);

            int port = FindFreePort();
            _url = "http://127.0.0.1:" + port + "/";

            JobObject.Create();

            var psi = new ProcessStartInfo
            {
                FileName = nodeExe,
                Arguments = "\"" + serverJs + "\"",
                WorkingDirectory = appDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                // node émet de l'UTF-8 sur ses tubes : sans ceci .NET relit la
                // sortie dans le codepage ANSI et le journal part en mojibake.
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            // Le serveur n'écoute QUE sur la boucle locale : rien n'est exposé au réseau.
            psi.EnvironmentVariables["HOSTNAME"] = "127.0.0.1";
            psi.EnvironmentVariables["PORT"] = port.ToString();
            psi.EnvironmentVariables["NODE_ENV"] = "production";
            // Toutes les données utilisateur vivent hors du répertoire d'installation.
            psi.EnvironmentVariables["JOBSCOUT_DATA_DIR"] = _dataDir;
            psi.EnvironmentVariables["JOBSCOUT_DB_PATH"] = Path.Combine(_dataDir, "jobscout.db");
            psi.EnvironmentVariables["JOBSCOUT_DOCS_PATH"] = Path.Combine(_dataDir, "documents");
            psi.EnvironmentVariables["PLAYWRIGHT_BROWSERS_PATH"] = Path.Combine(_dataDir, "browsers");

            using (var log = new StreamWriter(_logPath, false, Utf8NoBom) { AutoFlush = true })
            {
                log.WriteLine("[" + DateTime.Now + "] démarrage sur " + _url);
            }

            _server = new Process { StartInfo = psi, EnableRaisingEvents = true };
            _server.OutputDataReceived += (s, e) => AppendLog(e.Data);
            _server.ErrorDataReceived += (s, e) => AppendLog(e.Data);
            _server.Start();
            _server.BeginOutputReadLine();
            _server.BeginErrorReadLine();
            JobObject.Assign(_server);

            if (!WaitForServer(_url, StartupTimeoutSeconds))
            {
                Shutdown();
                throw new Exception(
                    "Le serveur n'a pas répondu en " + StartupTimeoutSeconds + " secondes.\n" +
                    "Journal : " + _logPath);
            }

            WriteRunningUrl(_url);
            SetupTray();
            if (Array.IndexOf(args, "--no-browser") < 0) OpenBrowser(_url);

            Application.ApplicationExit += (s, e) => Shutdown();
            Application.Run();
        }

        // ---------------------------------------------------------------- port
        static int FindFreePort()
        {
            for (int i = 0; i < PortAttempts; i++)
            {
                int candidate = FirstPort + i;
                if (IsPortFree(candidate)) return candidate;
            }
            // Dernier recours : port éphémère attribué par le système.
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int p = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return p;
        }

        static bool IsPortFree(int port)
        {
            TcpListener listener = null;
            try
            {
                listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
                return true;
            }
            catch (SocketException) { return false; }
            finally { if (listener != null) listener.Stop(); }
        }

        static bool WaitForServer(string url, int seconds)
        {
            var until = DateTime.UtcNow.AddSeconds(seconds);
            while (DateTime.UtcNow < until)
            {
                if (_server != null && _server.HasExited) return false;
                if (Probe(url)) return true;
                Thread.Sleep(400);
            }
            return false;
        }

        static bool Probe(string url)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = 2500;
                req.AllowAutoRedirect = false;
                req.Method = "GET";
                using (var res = (HttpWebResponse)req.GetResponse())
                    return (int)res.StatusCode < 500;
            }
            catch (WebException we)
            {
                // Une redirection ou un 404 prouvent que le serveur répond.
                var res = we.Response as HttpWebResponse;
                return res != null && (int)res.StatusCode < 500;
            }
            catch { return false; }
        }

        // ---------------------------------------------------------------- tray
        static void SetupTray()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("Ouvrir " + AppName, null, (s, e) => OpenBrowser(_url));
            menu.Items.Add("Dossier de données", null, (s, e) => OpenPath(_dataDir));
            menu.Items.Add("Journal du serveur", null, (s, e) => OpenPath(_logPath));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quitter " + AppName, null, (s, e) => Application.Exit());

            _tray = new NotifyIcon
            {
                Icon = LoadAppIcon(),
                Text = AppName + " — " + _url,
                Visible = true,
                ContextMenuStrip = menu,
            };
            _tray.DoubleClick += (s, e) => OpenBrowser(_url);
        }

        static Icon LoadAppIcon()
        {
            try
            {
                string ico = Path.Combine(
                    AppDomain.CurrentDomain.BaseDirectory, "jobscout.ico");
                if (File.Exists(ico)) return new Icon(ico);
            }
            catch { }
            return SystemIcons.Application;
        }

        // ------------------------------------------------------------- helpers
        static void AppendLog(string line)
        {
            if (line == null) return;
            try { File.AppendAllText(_logPath, line + Environment.NewLine, Utf8NoBom); }
            catch { }
        }

        static string RunningFile()
        {
            return Path.Combine(_dataDir, "runtime.json");
        }

        static void WriteRunningUrl(string url)
        {
            try
            {
                File.WriteAllText(RunningFile(),
                    "{\"url\":\"" + url + "\",\"pid\":" +
                    Process.GetCurrentProcess().Id + "}");
            }
            catch { }
        }

        static string ReadRunningUrl()
        {
            try
            {
                string raw = File.ReadAllText(RunningFile());
                int a = raw.IndexOf("http");
                if (a < 0) return null;
                int b = raw.IndexOf('"', a);
                return b < 0 ? null : raw.Substring(a, b - a);
            }
            catch { return null; }
        }

        static void OpenBrowser(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
            catch (Exception ex) { Error("Impossible d'ouvrir le navigateur :\n" + ex.Message); }
        }

        static void OpenPath(string target)
        {
            try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); }
            catch { }
        }

        static void Shutdown()
        {
            try { if (_tray != null) { _tray.Visible = false; _tray.Dispose(); _tray = null; } }
            catch { }
            try { File.Delete(RunningFile()); }
            catch { }
            try
            {
                if (_server != null && !_server.HasExited)
                {
                    // Le Job Object tue déjà l'arborescence ; on demande d'abord poliment.
                    _server.Kill();
                    _server.WaitForExit(4000);
                }
            }
            catch { }
            JobObject.Close();
        }

        static void Info(string msg)
        {
            MessageBox.Show(msg, AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        static void Error(string msg)
        {
            MessageBox.Show(msg, AppName + " — erreur", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    /// <summary>
    /// Job Object Windows : le serveur node est rattaché au launcher. Si le
    /// launcher disparaît (fermeture, kill, crash), Windows tue le serveur —
    /// pas de processus node orphelin qui garderait le port et la base ouverts.
    /// </summary>
    static class JobObject
    {
        static IntPtr _handle = IntPtr.Zero;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr CreateJobObject(IntPtr a, string lpName);
        [DllImport("kernel32.dll")]
        static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint len);
        [DllImport("kernel32.dll")]
        static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll")]
        static extern bool CloseHandle(IntPtr h);

        const int ExtendedLimitInformation = 9;
        const uint LimitKillOnJobClose = 0x2000;

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct IO_COUNTERS
        {
            public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
            public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        public static void Create()
        {
            try
            {
                _handle = CreateJobObject(IntPtr.Zero, null);
                if (_handle == IntPtr.Zero) return;
                var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                info.BasicLimitInformation.LimitFlags = LimitKillOnJobClose;
                int len = Marshal.SizeOf(info);
                IntPtr ptr = Marshal.AllocHGlobal(len);
                try
                {
                    Marshal.StructureToPtr(info, ptr, false);
                    SetInformationJobObject(_handle, ExtendedLimitInformation, ptr, (uint)len);
                }
                finally { Marshal.FreeHGlobal(ptr); }
            }
            catch { _handle = IntPtr.Zero; }
        }

        public static void Assign(Process p)
        {
            try { if (_handle != IntPtr.Zero) AssignProcessToJobObject(_handle, p.Handle); }
            catch { }
        }

        public static void Close()
        {
            try { if (_handle != IntPtr.Zero) { CloseHandle(_handle); _handle = IntPtr.Zero; } }
            catch { }
        }
    }
}
