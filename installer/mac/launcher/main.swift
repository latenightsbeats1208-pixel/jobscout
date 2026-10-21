// ============================================================================
// installer/mac/launcher/main.swift — lanceur macOS de JobScout
// (Contents/MacOS/JobScout dans JobScout.app)
//
// Rôle : équivalent Mac du lanceur Windows (installer/launcher/
// JobScoutLauncher.cs). Il démarre le serveur local avec le node embarqué,
// attend qu'il réponde, ouvre le navigateur, et l'arrête à la fermeture.
//
// Démarrage, dans l'ordre :
//    1. emplacement : refus depuis le disque téléchargé ou la translocation (E1, code 64) ;
//    2. intégrité : Info.plist complet, MacOS/node exécutable, server.js et
//       parent-guard.cjs présents (E5, code 69) ;
//    3. dossier de données : ~/Library/Application Support/JobScout (ou
//       JOBSCOUT_DATA_DIR absolu), 0700, logs/ et browsers/ (E4, code 66) ;
//    4. verrou flock : déjà ouvert → rouvre l'URL publiée, code 2 ;
//    5. état périmé : ancien serveur et Chromium d'un lancement précédent arrêtés ;
//    6. journal logs/server.log (l'ancien devient server.previous.log) ;
//    7. port : 3477 à 3500 (bind sans SO_REUSEADDR et connect refusé), sinon système ;
//    8. environnement de node (HOSTNAME=127.0.0.1 forcé, données, Playwright) ;
//    9. posix_spawn de MacOS/node --require parent-guard.cjs server.js, dans un
//       groupe de processus, stdin = tube dont seul le lanceur tient l'écriture ;
//   10. attente : GET /api/update toutes les 400 ms pendant 120 s, prêt seulement
//       si HTTP 200 et current = CFBundleShortVersionString (E2 code 70, E3 code 71) ;
//   11. runtime.json (atomique) ; 12. activité (pas de veille, pas d'App Nap) ;
//   13. navigateur (sauf --no-browser), fenêtre « JobScout est prêt ».
//
// Arrêt (⌘Q, Dock, fermeture de session, SIGTERM/SIGINT/SIGHUP) : SIGTERM au
// groupe de node, SIGKILL après 5 s, balayage (Chromium sous <données>/browsers/,
// tout MacOS/node de ce paquet), suppression de runtime.json, code 0.
//
// Options :
//   --no-browser       n'ouvre pas le navigateur ;
//   --non-interactive  sans AppKit (dispatchMain) : messages sur stderr et dans
//                      le journal, sortie par un code (recette automatisée) ;
//   --self-test        contrôles sans serveur (port, verrou, proc_pidpath,
//                      Info.plist…), code 0 si tout passe, 1 sinon.
//
// Codes de sortie : 0 arrêt normal, 1 self-test en échec, 2 déjà ouvert,
// 64 mauvais emplacement, 66 données non inscriptibles, 69 paquet incomplet,
// 70 serveur arrêté, 71 délai dépassé.
//
// Compilé par build-launcher-mac.mjs (swiftc, universel arm64 + x86_64, macOS 11).
// ============================================================================
import AppKit
import Darwin
import Foundation

// MARK: - Codes de sortie

enum ExitCode {
    static let normal: Int32 = 0
    static let selfTestFailed: Int32 = 1
    static let alreadyRunning: Int32 = 2
    static let badLocation: Int32 = 64
    static let dataNotWritable: Int32 = 66
    static let incomplete: Int32 = 69
    static let serverStopped: Int32 = 70
    static let timeout: Int32 = 71
}

// MARK: - Options

struct LaunchOptions {
    var noBrowser = false
    var nonInteractive = false
    var selfTest = false
    var ignored: [String] = []

    static func parse(_ args: [String]) -> LaunchOptions {
        var o = LaunchOptions()
        for a in args {
            switch a {
            case "--no-browser": o.noBrowser = true
            case "--non-interactive": o.nonInteractive = true
            case "--self-test": o.selfTest = true
            default: o.ignored.append(a) // -psn_… (anciens macOS), -NS… YES (Xcode)
            }
        }
        return o
    }

    var summary: String {
        var parts: [String] = []
        if noBrowser { parts.append("--no-browser") }
        if nonInteractive { parts.append("--non-interactive") }
        return parts.isEmpty ? "aucune" : parts.joined(separator: " ")
    }
}

// MARK: - Textes

enum Texts {
    static let starting = "JobScout démarre…"
    static func elapsed(_ s: Int) -> String { return "Temps écoulé : \(s) s" }
    static let slow = "Le premier démarrage peut prendre jusqu'à une minute : macOS vérifie l'application."
    static let ready = "JobScout est prêt"
    static func opensIn(_ url: String) -> String { return "Il s'ouvre dans votre navigateur : \(url)" }
    static let openInBrowser = "Ouvrir dans le navigateur"
    static let quitApp = "Quitter JobScout"
    static let closeNote = "Fermer cette fenêtre n'arrête pas JobScout. Pour l'arrêter : menu JobScout › Quitter JobScout (⌘Q)."
    static func alreadyOpen(_ url: String) -> String { return "JobScout est déjà ouvert : \(url)" }
    static let alreadyStarting = "JobScout est déjà ouvert : il est encore en train de démarrer."
}

enum AlertAction {
    case quit, openApplications, openLog, relaunch

    var label: String {
        switch self {
        case .quit: return "Quitter"
        case .openApplications: return "Ouvrir le dossier Applications"
        case .openLog: return "Ouvrir le journal"
        case .relaunch: return "Relancer"
        }
    }
}

/// Alertes E1 à E6 (textes de la conception, §3.13).
struct AlertSpec {
    let id: String
    let title: String
    let message: String
    let buttons: [AlertAction]
    let critical: Bool

    static let e1 = AlertSpec(
        id: "E1",
        title: "Glissez d'abord JobScout dans Applications",
        message: "JobScout est ouvert depuis le disque téléchargé ou depuis un emplacement temporaire. "
            + "Glissez l'icône JobScout sur le dossier Applications, puis ouvrez-le depuis Applications.",
        buttons: [.openApplications, .quit], critical: false)

    static let e2 = AlertSpec(
        id: "E2",
        title: "JobScout n'a pas pu démarrer",
        message: "Le serveur local s'est arrêté pendant le démarrage. Le journal en indique la cause.",
        buttons: [.openLog, .quit], critical: true)

    static let e3 = AlertSpec(
        id: "E3",
        title: "JobScout met trop de temps à démarrer",
        message: "Le serveur local n'a pas répondu en 120 secondes. Le journal en indique la cause.",
        buttons: [.openLog, .quit], critical: true)

    static func e4(_ path: String) -> AlertSpec {
        return AlertSpec(
            id: "E4",
            title: "JobScout ne peut pas écrire dans son dossier de données",
            message: path,
            buttons: [.quit], critical: true)
    }

    static let e5 = AlertSpec(
        id: "E5",
        title: "L'application est incomplète.",
        message: "Retéléchargez JobScout.",
        buttons: [.quit], critical: true)

    static let e6 = AlertSpec(
        id: "E6",
        title: "JobScout s'est arrêté de façon inattendue",
        message: "Le serveur local s'est arrêté. Le journal en indique la cause.",
        buttons: [.relaunch, .openLog, .quit], critical: true)
}

// MARK: - Interface (AppKit ou sans interface)

/// Implémentée par AppController (AppKit) et HeadlessUI (--non-interactive).
/// Toujours appelée sur la file principale.
protocol LauncherUI: AnyObject {
    func showStarting(elapsed: Int, slow: Bool)
    func showReady(url: String)
    func setWaitingBadge(_ waiting: Bool)
    /// Alerte modale (AppKit) ; sans interface : « Quitter » d'office.
    func alert(_ spec: AlertSpec) -> AlertAction
    /// ⌘Q, signal : AppKit passe par applicationShouldTerminate.
    func requestTermination(cause: String)
    func activateOtherInstance(bundleId: String)
    func openURL(_ url: String)
    func openPath(_ path: String)
    func openLog(_ path: String)
}

// MARK: - Lanceur

final class Launcher {
    private enum Phase { case idle, starting, ready, failed }
    private enum StopState { case notRequested, running, done }

    let options: LaunchOptions
    var ui: LauncherUI?

    private(set) var config: BundleConfig?
    private(set) var layout: BundleLayout?
    private(set) var dataDir = ""
    private(set) var log: LogFile?
    private(set) var url = ""

    private var phase = Phase.idle
    private var stopState = StopState.notRequested
    private var stopWaiters: [() -> Void] = []
    private var lock: LockFile?
    private var server: ServerProcess?
    private var port = 0
    private var attempt = 0
    private var spawnOffset: off_t = 0
    private var startDate = Date()
    private var deadline = Date()
    private var ticker: DispatchSourceTimer?
    private var watchdog: DispatchSourceTimer?
    private var probe: ReadinessProbe?
    private var activity: NSObjectProtocol?
    private var automaticTerminationDisabled = false
    private var signalSources: [DispatchSourceSignal] = []
    private var exitHandled = false
    private var lastProbeNote: String?
    private var pendingNotes: [String] = []

    /// Code de sortie après une terminaison AppKit (70 si l'on quitte après E6).
    var exitCodeOnTerminate = ExitCode.normal

    static let maxAttempts = 3
    static let startupTimeout: TimeInterval = 120
    static let slowAfter: TimeInterval = 30

    init(options: LaunchOptions) {
        self.options = options
    }

    var readyURL: String? { return phase == .ready ? url : nil }
    var logPath: String { return dataDir.isEmpty ? "" : dataDir + "/logs/server.log" }

    // MARK: Démarrage (étapes 1 à 5)

    func start() {
        installSignalHandlers()
        if !options.ignored.isEmpty { pendingNotes.append("arguments ignorés : \(options.ignored.joined(separator: " "))") }

        // 1. Emplacement. On ne copie jamais l'app soi-même : une copie faite par
        // l'app resterait en quarantaine et serait translocalisée.
        let bundlePath = Bundle.main.bundlePath
        if let why = Placement.refusalReason(bundlePath: bundlePath) {
            stderrLine("[lanceur] emplacement refusé (\(why)) : \(bundlePath)")
            if presentAlert(AlertSpec.e1) == .openApplications { ui?.openPath("/Applications") }
            finish(ExitCode.badLocation)
        }

        // 2. Intégrité (Info.plist, node, server.js, garde parent).
        let cfg: BundleConfig
        switch BundleConfig.load(Bundle.main.infoDictionary ?? [:]) {
        case .success(let c): cfg = c
        case .failure(let e): incomplete(e.text)
        }
        config = cfg
        let lay: BundleLayout
        switch BundleLayout.inspect(bundleURL: Bundle.main.bundleURL) {
        case .success(let l): lay = l
        case .failure(let e): incomplete(e.text)
        }
        layout = lay

        // 3. Dossier de données.
        let resolved = DataDirectory.resolve(name: cfg.dataDirName, environment: ProcessInfo.processInfo.environment)
        if let note = resolved.note { pendingNotes.append(note) }
        var notes: [String] = []
        switch DataDirectory.prepare(resolved.path, notes: &notes) {
        case .success(let real): dataDir = real
        case .failure(let e): dataNotWritable(resolved.path, e.text)
        }
        pendingNotes += notes

        // 4. Verrou d'instance unique.
        switch LockFile.acquire(path: dataDir + "/launcher.lock") {
        case .acquired(let l): lock = l
        case .busy: alreadyRunning(bundleId: cfg.bundleId)
        case .failed(let text): dataNotWritable(dataDir, text)
        }

        ui?.showStarting(elapsed: 0, slow: false)
        ui?.setWaitingBadge(true)

        // 5. État périmé (jusqu'à 3 s d'attente : hors de la file principale).
        let dir = dataDir
        let node = lay.nodeRealPath
        DispatchQueue.global(qos: .userInitiated).async {
            let staleNotes = Launcher.cleanStaleState(dataDir: dir, nodeRealPath: node)
            DispatchQueue.main.async {
                self.pendingNotes += staleNotes
                if self.stopState != .notRequested { return } // arrêt demandé entre-temps
                self.startServer()
            }
        }
    }

    /// Ancien serveur (si runtime.json désigne NOTRE node) et Chromium d'un
    /// lancement précédent arrêtés, runtime.json supprimé.
    private static func cleanStaleState(dataDir: String, nodeRealPath: String) -> [String] {
        var notes: [String] = []
        if let rt = RuntimeFile.read(directory: dataDir), let spid = rt.serverPid {
            if let exe = LibProc.pidPath(spid), exe == nodeRealPath {
                notes.append("serveur d'un lancement précédent encore actif (pid \(spid)) : arrêt")
                ProcessTable.stopForeign(pid: spid, grace: 3)
            }
        }
        let browsers = dataDir + "/browsers/"
        let killed = ProcessTable.sweep(signal: SIGKILL) { $0.hasPrefix(browsers) }
        if !killed.isEmpty {
            notes.append("navigateurs d'un lancement précédent arrêtés : \(killed.map { String($0) }.joined(separator: ", "))")
            ProcessTable.waitGone(killed, timeout: 2)
        }
        if access(RuntimeFile.path(dataDir), F_OK) == 0 {
            notes.append("runtime.json périmé supprimé")
            RuntimeFile.remove(directory: dataDir)
        }
        return notes
    }

    // MARK: Serveur (étapes 6 à 13)

    private func startServer() {
        guard let cfg = config else { return }
        phase = .starting
        stopState = .notRequested
        exitHandled = false
        lastProbeNote = nil
        attempt = 0
        startDate = Date()
        deadline = startDate.addingTimeInterval(Launcher.startupTimeout)

        // 6. Journal.
        switch LogFile.rotateAndOpen(directory: dataDir + "/logs") {
        case .success(let l): log = l
        case .failure(let e): dataNotWritable(dataDir + "/logs", e.text)
        }
        let translated = Sys.isTranslated() ? ", sous Rosetta" : ""
        logLine("\(Sys.isoNow()) JobScout \(cfg.version), macOS \(Sys.macOSVersion) (\(Sys.sliceArch)\(translated)), dossier \(dataDir)")
        logLine("options : \(options.summary) ; mode \(options.nonInteractive ? "sans interface" : "fenêtre")")
        let inherited = ProcessInfo.processInfo.environment
        let dropped = ServerEnvironment.removed.filter { inherited[$0] != nil }
        if !dropped.isEmpty { logLine("variables héritées retirées : \(dropped.joined(separator: ", "))") }
        for n in pendingNotes { logLine(n) }
        pendingNotes.removeAll()

        ui?.showStarting(elapsed: 0, slow: false)
        ui?.setWaitingBadge(true)

        // 7. Port.
        let choice = Ports.choose(first: cfg.portFirst, last: cfg.portLast, from: cfg.portFirst)
        for n in choice.notes { logLine(n) }
        port = choice.port
        spawnAttempt()
        if phase == .starting { startTicker() }
    }

    /// 8 et 9 : environnement, puis posix_spawn.
    private func spawnAttempt() {
        guard let lay = layout, let log = log else { return }
        attempt += 1
        url = "http://127.0.0.1:\(port)"
        let env = ServerEnvironment.build(inherited: ProcessInfo.processInfo.environment, port: port, dataDir: dataDir)
        spawnOffset = log.endOffset()
        logLine("démarrage du serveur sur \(url) (essai \(attempt)/\(Launcher.maxAttempts))")
        switch ServerProcess.spawn(executable: lay.nodePath,
                                   arguments: ["--require", lay.guardPath, "server.js"],
                                   environment: env,
                                   workingDirectory: lay.appDir,
                                   logFd: log.fd) {
        case .success(let s):
            server = s
            logLine("node lancé, pid \(s.pid)")
            s.watch(queue: .main) { [weak self] status in self?.serverExited(status) }
        case .failure(let e):
            logLine("lancement de node impossible : \(e.text)")
            failStartup(AlertSpec.e2, code: ExitCode.serverStopped)
        }
    }

    /// 10. Attente : sonde toutes les 400 ms, fenêtre, délai.
    private func startTicker() {
        ticker?.cancel()
        probe?.invalidate()
        probe = ReadinessProbe()
        let t = DispatchSource.makeTimerSource(queue: .main)
        t.schedule(deadline: .now(), repeating: .milliseconds(400))
        t.setEventHandler { [weak self] in self?.tick() }
        ticker = t
        t.resume()
    }

    private func tick() {
        guard phase == .starting, let cfg = config else { return }
        let elapsed = Date().timeIntervalSince(startDate)
        ui?.showStarting(elapsed: Int(elapsed), slow: elapsed >= Launcher.slowAfter)
        if let s = server, let status = s.reap() {
            serverExited(status)
            return
        }
        if Date() >= deadline {
            startupTimedOut()
            return
        }
        guard let p = probe, !p.inFlight else { return }
        p.check(baseURL: url, expectedVersion: cfg.version) { [weak self] probed, outcome in
            self?.probeAnswered(probed, outcome)
        }
    }

    private func probeAnswered(_ probed: String, _ outcome: ReadinessProbe.Outcome) {
        guard phase == .starting, probed == url else { return }
        switch outcome {
        case .ready:
            becomeReady()
        case .notYet(let note):
            if let n = note, n != lastProbeNote {
                lastProbeNote = n
                logLine(n)
            }
        }
    }

    /// 11 à 13 : runtime.json, activité, navigateur.
    private func becomeReady() {
        guard let cfg = config, let s = server else { return }
        phase = .ready
        ticker?.cancel()
        ticker = nil
        probe?.invalidate()
        probe = nil
        let took = Date().timeIntervalSince(startDate)

        if let e = RuntimeFile.write(directory: dataDir, url: url, pid: getpid(), serverPid: s.pid,
                                     version: cfg.version, startedAt: Sys.isoNow()) {
            logLine("runtime.json non écrit : \(e.text)")
        }
        // Parité avec « caffeinate -i » : pas de veille automatique, pas d'App Nap.
        if activity == nil {
            activity = ProcessInfo.processInfo.beginActivity(options: .userInitiated, reason: "JobScout est ouvert")
        }
        if !automaticTerminationDisabled {
            ProcessInfo.processInfo.disableAutomaticTermination("JobScout est ouvert")
            automaticTerminationDisabled = true
        }
        logLine("prêt en \(Sys.seconds(took)) s sur \(url)")
        stderrLine("JobScout est prêt : \(url)")
        ui?.setWaitingBadge(false)
        ui?.showReady(url: url)
        if !options.noBrowser { ui?.openURL(url) }
        startWatchdog()
    }

    /// Relevé de sortie de secours (en plus du DispatchSource de processus).
    private func startWatchdog() {
        watchdog?.cancel()
        let t = DispatchSource.makeTimerSource(queue: .main)
        t.schedule(deadline: .now() + .seconds(1), repeating: .seconds(1))
        t.setEventHandler { [weak self] in
            guard let self = self, let s = self.server, let st = s.reap() else { return }
            self.serverExited(st)
        }
        watchdog = t
        t.resume()
    }

    // MARK: Pannes

    private func serverExited(_ status: Int32) {
        if exitHandled || stopState != .notRequested { return }
        switch phase {
        case .starting:
            exitHandled = true
            server?.stopWatching()
            logLine("node s'est arrêté pendant le démarrage (\(Sys.describeStatus(status)))")
            let tail = log?.tail(since: spawnOffset, maxLines: 40) ?? []
            if attempt < Launcher.maxAttempts, tail.contains(where: { $0.contains("EADDRINUSE") }), let cfg = config {
                // Course sur le port entre le test et l'écoute de node : port suivant.
                // Même ordre que stopEverything() : SIGKILL au groupe, puis
                // fermeture du côté écriture du tube (sinon il reste ouvert
                // dans le lanceur jusqu'à sa sortie).
                server?.signalGroup(SIGKILL)
                server?.closeStdin()
                server = nil
                let next = Ports.choose(first: cfg.portFirst, last: cfg.portLast, from: port + 1)
                for n in next.notes { logLine(n) }
                logLine("port \(port) pris entre-temps (EADDRINUSE) : essai sur le port \(next.port)")
                port = next.port
                exitHandled = false
                spawnAttempt()
                return
            }
            failStartup(AlertSpec.e2, code: ExitCode.serverStopped)
        case .ready:
            exitHandled = true
            serverCrashed(status)
        case .idle, .failed:
            return
        }
    }

    private func startupTimedOut() {
        logLine("délai de \(Int(Launcher.startupTimeout)) s dépassé : \(url)/api/update n'a jamais répondu la version attendue")
        failStartup(AlertSpec.e3, code: ExitCode.timeout)
    }

    /// E2 ou E3 : arrêt du groupe et balayage, PUIS alerte, puis sortie.
    private func failStartup(_ spec: AlertSpec, code: Int32) {
        phase = .failed
        ui?.setWaitingBadge(false)
        stopEverything(cause: "échec du démarrage (\(spec.id))") {
            if self.presentAlert(spec) == .openLog { self.ui?.openLog(self.logPath) }
            self.finish(code)
        }
    }

    /// Le serveur meurt seul (après « prêt ») : E6.
    private func serverCrashed(_ status: Int32) {
        phase = .failed
        logLine("le serveur s'est arrêté de façon inattendue (\(Sys.describeStatus(status)))")
        stopEverything(cause: "serveur arrêté") {
            if self.options.nonInteractive {
                _ = self.presentAlert(AlertSpec.e6)
                self.finish(ExitCode.serverStopped)
            }
            self.askAfterCrash()
        }
    }

    private func askAfterCrash() {
        switch presentAlert(AlertSpec.e6) {
        case .relaunch:
            logLine("relance demandée")
            startServer()
        case .openLog:
            ui?.openLog(logPath)
            DispatchQueue.main.async { self.askAfterCrash() }
        default:
            exitCodeOnTerminate = ExitCode.serverStopped
            ui?.requestTermination(cause: "Quitter après E6")
        }
    }

    // MARK: Arrêt

    /// Arrêt demandé (⌘Q, Dock, fermeture de session, signal). `completion`
    /// est toujours appelée de façon asynchrone sur la file principale.
    func shutdown(cause: String, completion: @escaping () -> Void) {
        switch stopState {
        case .done:
            DispatchQueue.main.async(execute: completion)
        case .running:
            stopWaiters.append(completion)
        case .notRequested:
            stopWaiters.append(completion)
            logLine("arrêt demandé : \(cause)")
            stopEverything(cause: cause) {}
        }
    }

    /// 1. SIGTERM au groupe ; 2. attente 5 s ; 3. sinon SIGKILL, 2 s ;
    /// 4. balayage : Chromium sous <données>/browsers/ et tout MacOS/node de ce
    /// paquet ; 5. runtime.json supprimé, fin de l'activité, ligne
    /// « [lanceur] arrêt (cause, x,y s) ». Les attentes se font hors de la file
    /// principale ; `then` puis les autres demandeurs sont appelés ensuite.
    private func stopEverything(cause: String, then: @escaping () -> Void) {
        stopState = .running
        let t0 = Date()
        ticker?.cancel()
        ticker = nil
        watchdog?.cancel()
        watchdog = nil
        probe?.invalidate()
        probe = nil
        let srv = server
        srv?.stopWatching()
        let nodeReal = layout?.nodeRealPath
        let browsers = dataDir.isEmpty ? nil : dataDir + "/browsers/"
        let journal = log
        DispatchQueue.global(qos: .userInitiated).async {
            if let s = srv {
                if !s.hasExited {
                    s.signalGroup(SIGTERM)
                    if !s.waitExit(timeout: 5) {
                        journal?.line("[lanceur] node ne s'est pas arrêté en 5 s : SIGKILL au groupe")
                        s.signalGroup(SIGKILL)
                        _ = s.waitExit(timeout: 2)
                    }
                }
                s.signalGroup(SIGKILL) // restes éventuels du groupe
                s.closeStdin()
            }
            let swept = ProcessTable.sweep(signal: SIGKILL) { exe in
                if let b = browsers, exe.hasPrefix(b) { return true }
                if let n = nodeReal, exe == n { return true }
                return false
            }
            if !swept.isEmpty {
                journal?.line("[lanceur] balayage : \(swept.count) processus arrêtés (\(swept.map { String($0) }.joined(separator: ", ")))")
                ProcessTable.waitGone(swept, timeout: 2)
            }
            DispatchQueue.main.async {
                self.server = nil
                if self.lock != nil && !self.dataDir.isEmpty { RuntimeFile.remove(directory: self.dataDir) }
                if let a = self.activity {
                    ProcessInfo.processInfo.endActivity(a)
                    self.activity = nil
                }
                if self.automaticTerminationDisabled {
                    ProcessInfo.processInfo.enableAutomaticTermination("JobScout est ouvert")
                    self.automaticTerminationDisabled = false
                }
                self.logLine("arrêt (\(cause), \(Sys.seconds(Date().timeIntervalSince(t0))) s)")
                self.stopState = .done
                then()
                let waiters = self.stopWaiters
                self.stopWaiters.removeAll()
                for w in waiters { w() }
            }
        }
    }

    // MARK: Signaux

    /// SIGTERM, SIGINT, SIGHUP : ignorés puis repris par DispatchSource → arrêt.
    func installSignalHandlers() {
        guard signalSources.isEmpty else { return }
        for sig in [SIGTERM, SIGINT, SIGHUP] {
            signal(sig, SIG_IGN)
            let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            src.setEventHandler { [weak self] in
                self?.ui?.requestTermination(cause: "signal \(Sys.signalName(sig))")
            }
            src.resume()
            signalSources.append(src)
        }
    }

    // MARK: Sorties anticipées

    private func incomplete(_ detail: String) -> Never {
        stderrLine("[lanceur] paquet incomplet : \(detail)")
        _ = presentAlert(AlertSpec.e5)
        finish(ExitCode.incomplete)
    }

    private func dataNotWritable(_ path: String, _ detail: String) -> Never {
        stderrLine("[lanceur] dossier de données : \(detail)")
        _ = presentAlert(AlertSpec.e4(path))
        finish(ExitCode.dataNotWritable)
    }

    private func alreadyRunning(bundleId: String) -> Never {
        if let u = RuntimeFile.read(directory: dataDir)?.url {
            if !options.noBrowser { ui?.openURL(u) }
            stderrLine(Texts.alreadyOpen(u))
        } else {
            stderrLine(Texts.alreadyStarting)
        }
        ui?.activateOtherInstance(bundleId: bundleId)
        finish(ExitCode.alreadyRunning)
    }

    /// Message d'alerte : stderr et journal dans tous les modes, puis l'interface.
    private func presentAlert(_ spec: AlertSpec) -> AlertAction {
        stderrLine("JobScout : \(spec.title)")
        stderrLine(spec.message)
        logLine("\(spec.id) : \(spec.title) — \(spec.message)")
        return ui?.alert(spec) ?? .quit
    }

    private func finish(_ code: Int32) -> Never {
        logLine("fin, code \(code)")
        exit(code)
    }

    private func logLine(_ text: String) {
        log?.line("[lanceur] " + text)
    }
}

// MARK: - Self-test (--self-test)

/// Contrôles sans serveur, pour la recette (B9) et juste après la compilation.
/// N'écrit rien dans le vrai dossier de données : verrou testé dans un dossier
/// temporaire. Code 0 si tout passe, 1 sinon.
enum SelfTest {
    static func run() -> Int32 {
        var passed = 0
        var total = 0
        func check(_ name: String, _ body: () -> (Bool, String)) {
            total += 1
            let (ok, detail) = body()
            stdoutLine("[self-test] \(ok ? "OK" : "ÉCHEC") \(name) : \(detail)")
            if ok { passed += 1 }
        }
        func info(_ name: String, _ detail: String) {
            stdoutLine("[self-test] info \(name) : \(detail)")
        }

        stdoutLine("[self-test] lanceur \(Sys.sliceArch)\(Sys.isTranslated() ? " (Rosetta)" : ""), macOS \(Sys.macOSVersion)")

        var config: BundleConfig?
        check("Info.plist") {
            guard Bundle.main.bundleURL.pathExtension == "app" else {
                return (false, "le lanceur n'est pas dans un paquet .app (\(Bundle.main.bundlePath))")
            }
            switch BundleConfig.load(Bundle.main.infoDictionary ?? [:]) {
            case .success(let c):
                config = c
                return (true, "\(c.bundleId) \(c.version), ports \(c.portFirst) à \(c.portLast), données « \(c.dataDirName) »")
            case .failure(let e):
                return (false, e.text)
            }
        }

        check("proc_pidpath") {
            guard LibProc.available else { return (false, "proc_pidpath ou proc_listallpids introuvable (dlsym)") }
            guard let mine = LibProc.pidPath(getpid()) else { return (false, "proc_pidpath(getpid()) a échoué") }
            guard let exe = Bundle.main.executablePath, let expected = Sys.realPath(exe) else {
                return (false, "chemin de l'exécutable introuvable")
            }
            return mine == expected ? (true, mine) : (false, "\(mine) ≠ \(expected)")
        }

        check("table des processus") {
            let pids = LibProc.allPids()
            guard pids.contains(getpid()) else { return (false, "proc_listallpids ne contient pas le processus courant (\(pids.count) pid)") }
            guard let me = ProcessIdentity.of(getpid()) else { return (false, "sysctl KERN_PROC_PID a échoué") }
            guard me.uid == getuid(), me.ppid == getppid(), me.pgid == getpgrp() else {
                return (false, "uid/ppid/pgid incohérents (\(me.uid)/\(me.ppid)/\(me.pgid))")
            }
            return (true, "\(pids.count) processus listés, uid, ppid et groupe cohérents")
        }

        check("port") {
            let first = config?.portFirst ?? 3477
            let last = config?.portLast ?? 3500
            let c = Ports.choose(first: first, last: last, from: first)
            guard c.port >= first && c.port <= last else {
                return (false, "aucun port libre entre \(first) et \(last) : \(c.notes.joined(separator: " ; "))")
            }
            // Un serveur à l'écoute sur ce port (adresse locale, puis toutes
            // adresses) doit être vu comme occupé.
            for wildcard in [false, true] {
                let fd = Ports.listenForTest(port: c.port, anyAddress: wildcard)
                if fd < 0 { return (false, "écoute de test impossible sur le port \(c.port)") }
                let verdict = Ports.probe(c.port)
                Darwin.close(fd)
                if case .free = verdict {
                    return (false, "port \(c.port) vu libre alors qu'un serveur y écoute (\(wildcard ? "0.0.0.0" : "127.0.0.1"))")
                }
            }
            // Libéré, il redevient utilisable (TIME_WAIT toléré comme le fait node).
            if case .busy(let why) = Ports.probe(c.port) {
                return (false, "port \(c.port) encore vu occupé après fermeture (\(why))")
            }
            return (true, "\(c.port) choisi entre \(first) et \(last) ; un serveur à l'écoute est détecté")
        }

        check("verrou") {
            let dir = NSTemporaryDirectory() + "jobscout-self-test-\(getpid())"
            mkdir(dir, 0o700)
            defer { try? FileManager.default.removeItem(atPath: dir) }
            let path = dir + "/launcher.lock"
            guard case .acquired(let first) = LockFile.acquire(path: path) else {
                return (false, "premier verrou refusé")
            }
            guard case .busy = LockFile.acquire(path: path) else {
                first.release()
                return (false, "second verrou accordé alors que le premier est tenu")
            }
            first.release()
            guard case .acquired(let again) = LockFile.acquire(path: path) else {
                return (false, "verrou non rendu après fermeture")
            }
            again.release()
            return (true, "exclusif (flock), rendu à la fermeture")
        }

        check("environnement de node") {
            let polluted = [
                "HOSTNAME": "0.0.0.0", "PORT": "1", "NODE_OPTIONS": "--require /inexistant",
                "NODE_PATH": "/inexistant", "JOBSCOUT_VERSION": "0.0.0", "JOBSCOUT_DB_PATH": "/x.db",
                "JOBSCOUT_DOCS_PATH": "/x", "PLAYWRIGHT_BROWSERS_PATH": "/x", "PATH": "/opt/outil/bin",
                "HOME": "",
            ]
            let env = ServerEnvironment.build(inherited: polluted, port: 3477, dataDir: "/d")
            var bad: [String] = []
            let expected: [String: String] = [
                "HOSTNAME": "127.0.0.1", "PORT": "3477", "NODE_ENV": "production",
                "NEXT_TELEMETRY_DISABLED": "1", "JOBSCOUT_DATA_DIR": "/d",
                "JOBSCOUT_DB_PATH": "/d/jobscout.db", "JOBSCOUT_DOCS_PATH": "/d/documents",
                "PLAYWRIGHT_BROWSERS_PATH": "/d/browsers", "JOBSCOUT_PARENT_GUARD": "1",
            ]
            for (k, v) in expected where env[k] != v { bad.append("\(k)=\(env[k] ?? "∅")") }
            for k in ["NODE_OPTIONS", "NODE_PATH", "JOBSCOUT_VERSION", "JOBSCOUT_UPDATE_URL"] where env[k] != nil {
                bad.append("\(k) présent")
            }
            let path = (env["PATH"] ?? "").split(separator: ":").map(String.init)
            if path.first != "/opt/outil/bin" || !ServerEnvironment.requiredPath.allSatisfy({ path.contains($0) }) {
                bad.append("PATH=\(env["PATH"] ?? "∅")")
            }
            if (env["HOME"] ?? "").isEmpty { bad.append("HOME vide") }
            return bad.isEmpty ? (true, "HOSTNAME forcé, variables héritées retirées, PATH complété")
                               : (false, bad.joined(separator: ", "))
        }

        check("runtime.json") {
            let dir = NSTemporaryDirectory() + "jobscout-self-test-rt-\(getpid())"
            mkdir(dir, 0o700)
            defer { try? FileManager.default.removeItem(atPath: dir) }
            if let e = RuntimeFile.write(directory: dir, url: "http://127.0.0.1:3477", pid: getpid(),
                                         serverPid: getpid(), version: config?.version ?? "0.0.0",
                                         startedAt: Sys.isoNow()) {
                return (false, e.text)
            }
            guard let rt = RuntimeFile.read(directory: dir), rt.url == "http://127.0.0.1:3477",
                  rt.pid == getpid(), rt.serverPid == getpid() else {
                return (false, "relecture différente de l'écriture")
            }
            var st = stat()
            guard stat(RuntimeFile.path(dir), &st) == 0, (st.st_mode & 0o777) == 0o600 else {
                return (false, "droits différents de 0600")
            }
            return (true, "écrit de façon atomique en 0600 et relu à l'identique")
        }

        let placement = Placement.refusalReason(bundlePath: Bundle.main.bundlePath)
        info("emplacement", placement.map { "refusé au lancement (\($0))" } ?? "accepté")
        switch BundleLayout.inspect(bundleURL: Bundle.main.bundleURL) {
        case .success(let l): info("paquet", "node, server.js et parent-guard.cjs présents (\(l.nodeRealPath))")
        case .failure(let e): info("paquet", "\(e.text) (normal hors paquet complet)")
        }
        if let c = config {
            let d = DataDirectory.resolve(name: c.dataDirName, environment: ProcessInfo.processInfo.environment)
            info("dossier de données", "\(d.path) (non créé par le self-test)")
        }

        stdoutLine("[self-test] \(passed)/\(total) contrôles OK")
        return passed == total ? 0 : 1
    }
}

// MARK: - Point d'entrée

let launchOptions = LaunchOptions.parse(Array(CommandLine.arguments.dropFirst()))

// Le lanceur ne doit jamais mourir d'une écriture dans un tube fermé.
signal(SIGPIPE, SIG_IGN)

if launchOptions.selfTest {
    exit(SelfTest.run())
}

let launcher = Launcher(options: launchOptions)

if launchOptions.nonInteractive {
    let headless = HeadlessUI(launcher: launcher)
    launcher.ui = headless
    DispatchQueue.main.async { launcher.start() }
    dispatchMain()
} else {
    let controller = AppController(launcher: launcher)
    launcher.ui = controller
    let app = NSApplication.shared
    app.delegate = controller.delegateProxy
    _ = app.setActivationPolicy(.regular)
    app.run()
}
