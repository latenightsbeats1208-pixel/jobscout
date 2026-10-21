// ============================================================================
// installer/mac/launcher/Supervisor.swift — couche système du lanceur macOS
//
// Tout ce qui touche au noyau, sans AppKit : configuration lue dans
// Info.plist, emplacement du paquet, dossier de données, verrou d'instance
// unique (flock), journal, choix du port, environnement de node, lancement par
// posix_spawn dans un groupe de processus, surveillance de sa sortie, arrêt
// du groupe, balayage des processus restants, runtime.json et contrôle de
// disponibilité (/api/update).
//
// Contraintes de compilation (voir build-launcher-mac.mjs) : Swift 6 en mode
// de langage 5, cible macOS 11, aucune dépendance externe, et ni async/await
// ni Swift Concurrency (la bibliothèque de rétroportage n'est pas embarquée) :
// seulement GCD, des callbacks URLSession, posix_spawn et DispatchSource.
// ============================================================================
import Darwin
import Foundation

// MARK: - Erreurs et utilitaires

/// Échec d'une étape, avec un texte lisible (journal, stderr, alerte).
struct LaunchError: Error {
    let text: String
    init(_ text: String) { self.text = text }
}

enum Sys {
    /// Texte de errno (strerror), en anglais comme le reste des messages système.
    static func errorText(_ code: Int32 = errno) -> String {
        guard let text = strerror(code) else { return "errno \(code)" }
        return String(cString: text) + " (errno \(code))"
    }

    /// Chemin réel (liens résolus), ou nil si le fichier n'existe pas.
    static func realPath(_ path: String) -> String? {
        guard let resolved = Darwin.realpath(path, nil) else { return nil }
        defer { free(resolved) }
        return String(cString: resolved)
    }

    /// Le processus existe-t-il (zombie compris) ? kill(pid, 0) n'envoie rien.
    static func isAlive(_ pid: pid_t) -> Bool {
        if pid <= 0 { return false }
        if kill(pid, 0) == 0 { return true }
        return errno == EPERM
    }

    static func signalName(_ sig: Int32) -> String {
        switch sig {
        case SIGTERM: return "SIGTERM"
        case SIGINT: return "SIGINT"
        case SIGHUP: return "SIGHUP"
        case SIGKILL: return "SIGKILL"
        case SIGPIPE: return "SIGPIPE"
        case SIGSEGV: return "SIGSEGV"
        case SIGABRT: return "SIGABRT"
        case SIGBUS: return "SIGBUS"
        case SIGILL: return "SIGILL"
        case SIGTRAP: return "SIGTRAP"
        default: return "signal \(sig)"
        }
    }

    /// Statut de waitpid → texte (WIFEXITED / WTERMSIG ne sont pas importés en Swift).
    static func describeStatus(_ status: Int32) -> String {
        if status < 0 { return "statut inconnu" }
        let sig = status & 0x7f
        if sig == 0 { return "code \((status >> 8) & 0xff)" }
        return "tué par \(signalName(sig))"
    }

    /// Le processus courant est-il traduit par Rosetta ?
    static func isTranslated() -> Bool {
        var value: Int32 = 0
        var size = MemoryLayout<Int32>.size
        if sysctlbyname("sysctl.proc_translated", &value, &size, nil, 0) != 0 { return false }
        return value == 1
    }

    /// Architecture de la tranche en cours d'exécution.
    static var sliceArch: String {
        #if arch(arm64)
        return "arm64"
        #elseif arch(x86_64)
        return "x86_64"
        #else
        return "inconnue"
        #endif
    }

    static var macOSVersion: String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return v.patchVersion > 0
            ? "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)"
            : "\(v.majorVersion).\(v.minorVersion)"
    }

    /// Durée en secondes, une décimale, virgule française : « 0,8 ».
    static func seconds(_ t: TimeInterval) -> String {
        return String(format: "%.1f", t).replacingOccurrences(of: ".", with: ",")
    }

    static func isoNow() -> String {
        return ISO8601DateFormatter().string(from: Date())
    }
}

/// Écrit une ligne sur stderr, sans tampon (lisible même en cas de exit()).
func stderrLine(_ text: String) {
    writeAll(2, text + "\n")
}

/// Écrit une ligne sur stdout, sans tampon.
func stdoutLine(_ text: String) {
    writeAll(1, text + "\n")
}

/// write(2) complet (reprise sur EINTR et écriture partielle).
func writeAll(_ fd: Int32, _ text: String) {
    let bytes = Array(text.utf8)
    if bytes.isEmpty { return }
    var offset = 0
    while offset < bytes.count {
        let n = bytes.withUnsafeBufferPointer { buf -> Int in
            guard let base = buf.baseAddress else { return 0 }
            return Darwin.write(fd, base + offset, buf.count - offset)
        }
        if n > 0 {
            offset += n
        } else if n < 0 && errno == EINTR {
            continue
        } else {
            return
        }
    }
}

// MARK: - libproc (proc_pidpath, proc_listallpids)

/// Fonctions de libproc, résolues par dlsym : libproc.h ne fait pas partie de
/// tous les module maps du SDK, alors que les fonctions sont toujours dans
/// libSystem. Le self-test vérifie qu'elles répondent (proc_pidpath(getpid())).
enum LibProc {
    private typealias PidPathFn = @convention(c) (Int32, UnsafeMutableRawPointer?, UInt32) -> Int32
    private typealias ListAllPidsFn = @convention(c) (UnsafeMutableRawPointer?, Int32) -> Int32

    /// RTLD_DEFAULT vaut ((void *) -2) sous macOS ; la macro n'est pas importée.
    private static let defaultHandle = UnsafeMutableRawPointer(bitPattern: -2)

    private static let pidPathFn: PidPathFn? = {
        guard let sym = dlsym(defaultHandle, "proc_pidpath") else { return nil }
        return unsafeBitCast(sym, to: PidPathFn.self)
    }()

    private static let listAllPidsFn: ListAllPidsFn? = {
        guard let sym = dlsym(defaultHandle, "proc_listallpids") else { return nil }
        return unsafeBitCast(sym, to: ListAllPidsFn.self)
    }()

    static var available: Bool { return pidPathFn != nil && listAllPidsFn != nil }

    /// Chemin de l'exécutable du processus (liens résolus par le noyau), ou nil.
    static func pidPath(_ pid: pid_t) -> String? {
        guard let fn = pidPathFn else { return nil }
        var buffer = [CChar](repeating: 0, count: 4096) // PROC_PIDPATHINFO_MAXSIZE
        let n = buffer.withUnsafeMutableBytes { raw -> Int32 in
            return fn(pid, raw.baseAddress, UInt32(raw.count))
        }
        guard n > 0 else { return nil }
        return String(cString: buffer)
    }

    /// Tous les pid du système.
    static func allPids() -> [pid_t] {
        guard let fn = listAllPidsFn else { return [] }
        let estimate = fn(nil, 0)
        guard estimate > 0 else { return [] }
        var pids = [pid_t](repeating: 0, count: Int(estimate) + 128)
        let count = pids.withUnsafeMutableBytes { raw -> Int32 in
            return fn(raw.baseAddress, Int32(raw.count))
        }
        guard count > 0 else { return [] }
        return Array(pids.prefix(min(Int(count), pids.count))).filter { $0 > 0 }
    }
}

/// uid, ppid et groupe d'un processus (sysctl KERN_PROC_PID).
struct ProcessIdentity {
    let uid: uid_t
    let ppid: pid_t
    let pgid: pid_t

    static func of(_ pid: pid_t) -> ProcessIdentity? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
        guard sysctl(&mib, 4, &info, &size, nil, 0) == 0, size > 0 else { return nil }
        return ProcessIdentity(
            uid: info.kp_eproc.e_ucred.cr_uid,
            ppid: info.kp_eproc.e_ppid,
            pgid: info.kp_eproc.e_pgid
        )
    }
}

enum ProcessTable {
    /// Envoie `sig` à tout processus de l'utilisateur courant (sauf soi) dont
    /// l'exécutable vérifie `matches`. Renvoie les pid touchés.
    static func sweep(signal sig: Int32, matches: (String) -> Bool) -> [pid_t] {
        let me = getuid()
        let selfPid = getpid()
        var hit: [pid_t] = []
        for pid in LibProc.allPids() where pid != selfPid {
            guard let exe = LibProc.pidPath(pid), matches(exe) else { continue }
            guard let id = ProcessIdentity.of(pid), id.uid == me else { continue }
            if kill(pid, sig) == 0 { hit.append(pid) }
        }
        return hit
    }

    /// Attend que tous les pid aient disparu (au plus `timeout` secondes).
    @discardableResult
    static func waitGone(_ pids: [pid_t], timeout: TimeInterval) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if !pids.contains(where: { Sys.isAlive($0) }) { return true }
            usleep(50_000)
        }
        return !pids.contains(where: { Sys.isAlive($0) })
    }

    /// Arrête un processus qui n'est pas notre enfant (serveur d'un lancement
    /// précédent) : SIGTERM à son groupe s'il en est le chef, SIGKILL après
    /// `grace` secondes.
    static func stopForeign(pid: pid_t, grace: TimeInterval) {
        let leader = getpgid(pid) == pid
        let target: pid_t = leader ? -pid : pid
        _ = kill(target, SIGTERM)
        let end = Date().addingTimeInterval(grace)
        while Date() < end && Sys.isAlive(pid) { usleep(50_000) }
        if Sys.isAlive(pid) { _ = kill(target, SIGKILL) }
        if leader { _ = kill(-pid, SIGKILL) } // restes du groupe
        waitGone([pid], timeout: 2)
    }
}

// MARK: - Configuration (Info.plist)

/// Valeurs lues dans Info.plist (générées depuis installer/mac/mac.json par
/// bundle.mjs). Une clé absente ou invalide = paquet incomplet (E5).
struct BundleConfig {
    let bundleId: String
    let version: String
    let dataDirName: String
    let portFirst: Int
    let portLast: Int
    let releasesURL: String

    static func load(_ info: [String: Any]) -> Result<BundleConfig, LaunchError> {
        func string(_ key: String) -> String? {
            guard let raw = info[key] as? String else { return nil }
            let v = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            return v.isEmpty ? nil : v
        }
        func integer(_ key: String) -> Int? {
            if let n = info[key] as? NSNumber { return n.intValue }
            if let s = info[key] as? String { return Int(s) }
            return nil
        }
        guard let id = string("CFBundleIdentifier") else {
            return .failure(LaunchError("Info.plist : CFBundleIdentifier absent"))
        }
        guard let version = string("CFBundleShortVersionString"), isVersion(version) else {
            return .failure(LaunchError("Info.plist : CFBundleShortVersionString absent ou différent de X.Y.Z"))
        }
        guard let dir = string("JobScoutDataDirName"), !dir.contains("/"), dir != ".", dir != ".." else {
            return .failure(LaunchError("Info.plist : JobScoutDataDirName absent ou invalide"))
        }
        guard let first = integer("JobScoutPortFirst"), let last = integer("JobScoutPortLast"),
              first >= 1024, first <= last, last <= 65535 else {
            return .failure(LaunchError("Info.plist : JobScoutPortFirst et JobScoutPortLast absents ou invalides"))
        }
        guard let releases = string("JobScoutReleasesURL"), releases.hasPrefix("https://") else {
            return .failure(LaunchError("Info.plist : JobScoutReleasesURL absent ou non https"))
        }
        return .success(BundleConfig(bundleId: id, version: version, dataDirName: dir,
                                     portFirst: first, portLast: last, releasesURL: releases))
    }

    static func isVersion(_ v: String) -> Bool {
        let parts = v.split(separator: ".", omittingEmptySubsequences: false)
        return parts.count == 3 && parts.allSatisfy { !$0.isEmpty && $0.allSatisfy { $0.isASCII && $0.isNumber } }
    }
}

// MARK: - Paquet : emplacement et intégrité

enum Placement {
    /// Raison de refuser l'emplacement du paquet (E1), ou nil s'il convient.
    /// Disque téléchargé (/Volumes/…), translocation de Gatekeeper, ou tout
    /// volume en lecture seule (image disque montée ailleurs que /Volumes).
    static func refusalReason(bundlePath: String) -> String? {
        if bundlePath.hasPrefix("/Volumes/") { return "disque /Volumes" }
        if bundlePath.contains("/AppTranslocation/") { return "translocation de Gatekeeper" }
        var fs = statfs()
        if statfs(bundlePath, &fs) == 0 && (fs.f_flags & UInt32(MNT_RDONLY)) != 0 {
            return "volume en lecture seule"
        }
        return nil
    }
}

/// Pièces indispensables du paquet.
struct BundleLayout {
    let bundlePath: String
    let nodePath: String      // Contents/MacOS/node (chemin utilisé pour le lancement)
    let nodeRealPath: String  // le même, liens résolus (comparaison avec proc_pidpath)
    let appDir: String        // Contents/Resources/app
    let guardPath: String     // Contents/Resources/parent-guard.cjs

    static func inspect(bundleURL: URL) -> Result<BundleLayout, LaunchError> {
        let contents = bundleURL.appendingPathComponent("Contents", isDirectory: true)
        let node = contents.appendingPathComponent("MacOS/node").path
        let app = contents.appendingPathComponent("Resources/app", isDirectory: true).path
        let guardFile = contents.appendingPathComponent("Resources/parent-guard.cjs").path
        let fm = FileManager.default
        guard fm.fileExists(atPath: node) else {
            return .failure(LaunchError("Contents/MacOS/node absent"))
        }
        guard fm.isExecutableFile(atPath: node) else {
            return .failure(LaunchError("Contents/MacOS/node non exécutable"))
        }
        guard fm.fileExists(atPath: app + "/server.js") else {
            return .failure(LaunchError("Contents/Resources/app/server.js absent"))
        }
        guard fm.fileExists(atPath: guardFile) else {
            return .failure(LaunchError("Contents/Resources/parent-guard.cjs absent"))
        }
        return .success(BundleLayout(bundlePath: bundleURL.path, nodePath: node,
                                     nodeRealPath: Sys.realPath(node) ?? node,
                                     appDir: app, guardPath: guardFile))
    }
}

// MARK: - Dossier de données

enum DataDirectory {
    /// JOBSCOUT_DATA_DIR s'il est défini et absolu (tests, usage avancé), sinon
    /// ~/Library/Application Support/<JobScoutDataDirName>.
    static func resolve(name: String, environment: [String: String]) -> (path: String, note: String?) {
        if let raw = environment["JOBSCOUT_DATA_DIR"]?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty {
            if raw.hasPrefix("/") { return (raw, "dossier de données imposé par JOBSCOUT_DATA_DIR") }
            let base = defaultBase()
            return (base + "/" + name, "JOBSCOUT_DATA_DIR ignoré : chemin relatif")
        }
        return (defaultBase() + "/" + name, nil)
    }

    private static func defaultBase() -> String {
        if let url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            return url.path
        }
        return NSHomeDirectory() + "/Library/Application Support"
    }

    /// Crée le dossier (0700) avec logs/ et browsers/, exclut browsers/ de
    /// Time Machine et vérifie qu'on peut y écrire. Renvoie le chemin réel.
    static func prepare(_ path: String, notes: inout [String]) -> Result<String, LaunchError> {
        do {
            try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
        } catch {
            return .failure(LaunchError("création impossible : \(error.localizedDescription)"))
        }
        if chmod(path, 0o700) != 0 {
            return .failure(LaunchError("droits 0700 impossibles : \(Sys.errorText())"))
        }
        for sub in ["logs", "browsers"] {
            let p = path + "/" + sub
            if mkdir(p, 0o700) != 0 && errno != EEXIST {
                return .failure(LaunchError("création de \(sub)/ impossible : \(Sys.errorText())"))
            }
        }
        var browsers = URL(fileURLWithPath: path + "/browsers", isDirectory: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        do {
            try browsers.setResourceValues(values)
        } catch {
            notes.append("browsers/ non exclu de Time Machine : \(error.localizedDescription)")
        }
        // Essai d'écriture réel (un dossier peut exister sans être inscriptible).
        let probe = path + "/.essai-ecriture-\(getpid())"
        let fd = Darwin.open(probe, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0o600)
        if fd < 0 {
            return .failure(LaunchError("écriture impossible : \(Sys.errorText())"))
        }
        let written = Darwin.write(fd, "ok", 2)
        let writeErrno = errno
        Darwin.close(fd)
        unlink(probe)
        if written != 2 {
            return .failure(LaunchError("écriture impossible : \(Sys.errorText(writeErrno))"))
        }
        guard let real = Sys.realPath(path) else {
            return .failure(LaunchError("chemin réel introuvable"))
        }
        return .success(real)
    }
}

// MARK: - Verrou d'instance unique

/// flock(LOCK_EX|LOCK_NB) sur <données>/launcher.lock. Le noyau relâche le
/// verrou à la mort du processus, même par SIGKILL. Un verrou par dossier de
/// données : chaque compte macOS a le sien.
final class LockFile {
    enum Outcome {
        case acquired(LockFile)
        case busy
        case failed(String)
    }

    private var fd: Int32

    private init(fd: Int32) { self.fd = fd }

    static func acquire(path: String) -> Outcome {
        let fd = Darwin.open(path, O_RDWR | O_CREAT | O_CLOEXEC, 0o600)
        if fd < 0 { return .failed("ouverture de \(path) : \(Sys.errorText())") }
        if flock(fd, LOCK_EX | LOCK_NB) != 0 {
            let e = errno
            Darwin.close(fd)
            if e == EWOULDBLOCK { return .busy }
            return .failed("flock : \(Sys.errorText(e))")
        }
        // pid du titulaire, pour le diagnostic seulement (le verrou fait foi).
        _ = ftruncate(fd, 0)
        writeAll(fd, "\(getpid())\n")
        return .acquired(LockFile(fd: fd))
    }

    /// Rend le verrou (self-test ; en service, la fin du processus suffit).
    func release() {
        if fd >= 0 {
            Darwin.close(fd)
            fd = -1
        }
    }
}

// MARK: - Journal

/// logs/server.log, en ajout, 0600. node y écrit directement sa sortie
/// (descripteurs 1 et 2) : le journal survit à la mort du lanceur. Les lignes
/// du lanceur commencent par « [lanceur] ». Le descripteur n'est jamais
/// fermé (la fin du processus s'en charge) : aucune écriture tardive ne peut
/// partir dans un autre fichier qui aurait réutilisé son numéro.
final class LogFile {
    let path: String
    let fd: Int32

    private init(path: String, fd: Int32) {
        self.path = path
        self.fd = fd
    }

    /// server.log → server.previous.log, puis nouveau server.log.
    static func rotateAndOpen(directory: String) -> Result<LogFile, LaunchError> {
        let current = directory + "/server.log"
        let previous = directory + "/server.previous.log"
        if access(current, F_OK) == 0 && Darwin.rename(current, previous) != 0 {
            return .failure(LaunchError("renommage de server.log : \(Sys.errorText())"))
        }
        let fd = Darwin.open(current, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0o600)
        if fd < 0 { return .failure(LaunchError("ouverture de server.log : \(Sys.errorText())")) }
        _ = fchmod(fd, 0o600)
        return .success(LogFile(path: current, fd: fd))
    }

    func line(_ text: String) {
        writeAll(fd, text + "\n")
    }

    /// Taille actuelle du fichier (début de la sortie d'un essai de lancement).
    func endOffset() -> off_t {
        var st = stat()
        if fstat(fd, &st) == 0 { return st.st_size }
        return 0
    }

    /// Dernières lignes écrites depuis `offset` (au plus les 256 derniers Ko).
    func tail(since offset: off_t, maxLines: Int) -> [String] {
        let rfd = Darwin.open(path, O_RDONLY | O_CLOEXEC)
        if rfd < 0 { return [] }
        defer { Darwin.close(rfd) }
        var st = stat()
        guard fstat(rfd, &st) == 0 else { return [] }
        let start = max(offset, st.st_size - 256 * 1024)
        if start >= st.st_size { return [] }
        if lseek(rfd, start, SEEK_SET) < 0 { return [] }
        var data = Data()
        var chunk = [UInt8](repeating: 0, count: 65536)
        while true {
            let n = chunk.withUnsafeMutableBytes { raw -> Int in
                return Darwin.read(rfd, raw.baseAddress, raw.count)
            }
            if n > 0 {
                data.append(chunk, count: n)
            } else if n < 0 && errno == EINTR {
                continue
            } else {
                break
            }
        }
        let text = String(decoding: data, as: UTF8.self)
        let lines = text.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
        return Array(lines.suffix(maxLines))
    }
}

// MARK: - runtime.json

struct RuntimeInfo {
    let url: String?
    let pid: pid_t?
    let serverPid: pid_t?
}

/// État d'exécution publié pour une seconde instance et pour la recette :
/// {"url","pid","serverPid","version","startedAt"}, écrit de façon atomique.
enum RuntimeFile {
    static func path(_ dir: String) -> String { return dir + "/runtime.json" }

    static func read(directory: String) -> RuntimeInfo? {
        guard let data = FileManager.default.contents(atPath: path(directory)),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        func pidValue(_ key: String) -> pid_t? {
            guard let n = obj[key] as? NSNumber else { return nil }
            let v = n.int64Value
            return v > 0 && v < Int64(Int32.max) ? pid_t(v) : nil
        }
        var url: String? = nil
        // Seule une adresse locale est rouverte : jamais une URL arbitraire.
        if let u = obj["url"] as? String, isLocalURL(u) { url = u }
        return RuntimeInfo(url: url, pid: pidValue("pid"), serverPid: pidValue("serverPid"))
    }

    static func isLocalURL(_ u: String) -> Bool {
        let prefix = "http://127.0.0.1:"
        guard u.hasPrefix(prefix) else { return false }
        let port = u.dropFirst(prefix.count)
        return !port.isEmpty && port.count <= 5 && port.allSatisfy { $0.isASCII && $0.isNumber }
    }

    static func write(directory: String, url: String, pid: pid_t, serverPid: pid_t,
                      version: String, startedAt: String) -> LaunchError? {
        let fields: [String: Any] = [
            "url": url,
            "pid": Int(pid),
            "serverPid": Int(serverPid),
            "version": version,
            "startedAt": startedAt,
        ]
        let data: Data
        do {
            data = try JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys, .withoutEscapingSlashes])
        } catch {
            return LaunchError("runtime.json : \(error.localizedDescription)")
        }
        let target = path(directory)
        let temp = target + ".tmp-\(getpid())"
        let fd = Darwin.open(temp, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0o600)
        if fd < 0 { return LaunchError("runtime.json : \(Sys.errorText())") }
        let written = data.withUnsafeBytes { raw -> Int in
            return Darwin.write(fd, raw.baseAddress, raw.count)
        }
        _ = fsync(fd)
        Darwin.close(fd)
        if written != data.count {
            unlink(temp)
            return LaunchError("runtime.json : écriture incomplète")
        }
        if Darwin.rename(temp, target) != 0 {
            let e = errno
            unlink(temp)
            return LaunchError("runtime.json : \(Sys.errorText(e))")
        }
        return nil
    }

    static func remove(directory: String) {
        _ = unlink(path(directory))
    }
}

// MARK: - Port

enum Ports {
    enum Verdict {
        case free(note: String?)
        case busy(String)
    }

    struct Choice {
        let port: Int
        let notes: [String]
    }

    /// Premier port libre de [from, last] (à partir de `first`), sinon le port
    /// attribué par le système (bind sur le port 0).
    static func choose(first: Int, last: Int, from start: Int) -> Choice {
        var notes: [String] = []
        let low = max(first, start)
        if low <= last {
            for p in low...last {
                switch probe(p) {
                case .free(let note):
                    if let n = note { notes.append("port \(p) : \(n)") }
                    return Choice(port: p, notes: notes)
                case .busy(let why):
                    notes.append("port \(p) occupé (\(why))")
                }
            }
        }
        if let e = ephemeralPort() {
            notes.append("ports \(first) à \(last) occupés : port \(e) attribué par le système")
            return Choice(port: e, notes: notes)
        }
        notes.append("aucun port attribué par le système : essai sur \(last)")
        return Choice(port: last, notes: notes)
    }

    /// Un port est libre si bind(127.0.0.1:p) réussit SANS SO_REUSEADDR et si
    /// connect(127.0.0.1:p) est refusé.
    ///
    /// Raffinement : sous macOS (BSD), un bind sans SO_REUSEADDR échoue aussi
    /// tant qu'il reste des connexions terminées du serveur précédent (TIME_WAIT,
    /// environ 30 s sur la boucle locale), alors que node, lui, se lie quand
    /// même (libuv pose SO_REUSEADDR). Dans ce seul cas, le bind est refait avec
    /// SO_REUSEADDR : il échoue encore si un autre programme écoute sur
    /// 127.0.0.1:p, et le connect refusé reste exigé (il détecte un serveur qui
    /// écoute sur toutes les adresses). Sans cela, relancer JobScout juste après
    /// l'avoir quitté changerait de port, donc d'adresse dans le navigateur.
    static func probe(_ port: Int) -> Verdict {
        var note: String? = nil
        let plain = tryBind(port: port, reuseAddress: false)
        if plain != 0 {
            if plain != EADDRINUSE { return .busy("bind : \(Sys.errorText(plain))") }
            if tryBind(port: port, reuseAddress: true) != 0 { return .busy("déjà utilisé") }
            note = "connexions terminées en attente (TIME_WAIT) : réutilisable, comme le fait node"
        }
        switch connectState(port: port, timeoutMs: 500) {
        case .refused: return .free(note: note)
        case .accepted: return .busy("un autre programme répond")
        case .timeout: return .busy("connexion sans réponse")
        case .failed(let e): return .busy("connect : \(Sys.errorText(e))")
        }
    }

    static func loopback(port: Int) -> sockaddr_in {
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = in_port_t(UInt16(truncatingIfNeeded: port).bigEndian)
        addr.sin_addr = in_addr(s_addr: UInt32(0x7f00_0001).bigEndian)
        return addr
    }

    static func bindSocket(_ fd: Int32, _ addr: sockaddr_in) -> Int32 {
        var a = addr
        return withUnsafePointer(to: &a) { ptr -> Int32 in
            return ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa -> Int32 in
                return Darwin.bind(fd, sa, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
    }

    /// 0 si le bind réussit, sinon errno.
    static func tryBind(port: Int, reuseAddress: Bool) -> Int32 {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        if fd < 0 { return errno }
        defer { Darwin.close(fd) }
        if reuseAddress {
            var one: Int32 = 1
            _ = setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, socklen_t(MemoryLayout<Int32>.size))
        }
        let rc = bindSocket(fd, loopback(port: port))
        return rc == 0 ? 0 : errno
    }

    enum ConnectState {
        case refused, accepted, timeout
        case failed(Int32)
    }

    /// connect non bloquant vers 127.0.0.1:p, borné à `timeoutMs`.
    static func connectState(port: Int, timeoutMs: Int32) -> ConnectState {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        if fd < 0 { return .failed(errno) }
        defer { Darwin.close(fd) }
        var one: Int32 = 1
        _ = setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
        let flags = fcntl(fd, F_GETFL)
        _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK)
        var addr = loopback(port: port)
        let rc = withUnsafePointer(to: &addr) { ptr -> Int32 in
            return ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa -> Int32 in
                return Darwin.connect(fd, sa, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        if rc == 0 { return .accepted }
        let e = errno
        if e == ECONNREFUSED { return .refused }
        if e != EINPROGRESS { return .failed(e) }
        var pfd = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
        let ready = poll(&pfd, 1, timeoutMs)
        if ready == 0 { return .timeout }
        if ready < 0 { return .failed(errno) }
        var soError: Int32 = 0
        var len = socklen_t(MemoryLayout<Int32>.size)
        if getsockopt(fd, SOL_SOCKET, SO_ERROR, &soError, &len) != 0 { return .failed(errno) }
        if soError == 0 { return .accepted }
        if soError == ECONNREFUSED { return .refused }
        return .failed(soError)
    }

    /// Port attribué par le système (bind 127.0.0.1:0).
    static func ephemeralPort() -> Int? {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        if fd < 0 { return nil }
        defer { Darwin.close(fd) }
        if bindSocket(fd, loopback(port: 0)) != 0 { return nil }
        var addr = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        let rc = withUnsafeMutablePointer(to: &addr) { ptr -> Int32 in
            return ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa -> Int32 in
                return getsockname(fd, sa, &len)
            }
        }
        if rc != 0 { return nil }
        let port = Int(UInt16(bigEndian: addr.sin_port))
        return port > 0 ? port : nil
    }

    /// Socket à l'écoute (self-test) : sur 127.0.0.1 ou sur toutes les adresses,
    /// avec SO_REUSEADDR comme node. Renvoie le descripteur, ou -1.
    static func listenForTest(port: Int, anyAddress: Bool) -> Int32 {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        if fd < 0 { return -1 }
        var one: Int32 = 1
        _ = setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, socklen_t(MemoryLayout<Int32>.size))
        var addr = loopback(port: port)
        if anyAddress { addr.sin_addr = in_addr(s_addr: 0) }
        if bindSocket(fd, addr) != 0 || Darwin.listen(fd, 16) != 0 {
            Darwin.close(fd)
            return -1
        }
        return fd
    }
}

// MARK: - Environnement de node

enum ServerEnvironment {
    /// Variables héritées qui ne doivent jamais atteindre node.
    static let removed = [
        "NODE_OPTIONS", "NODE_PATH", "HOSTNAME", "PORT", "JOBSCOUT_VERSION",
        "JOBSCOUT_DB_PATH", "JOBSCOUT_DOCS_PATH", "PLAYWRIGHT_BROWSERS_PATH",
    ]
    static let requiredPath = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]

    /// Environnement hérité, nettoyé, puis complété. On ne pose jamais
    /// JOBSCOUT_UPDATE_URL ni JOBSCOUT_VERSION (la version vient de
    /// version.json dans le paquet).
    static func build(inherited: [String: String], port: Int, dataDir: String) -> [String: String] {
        var env = inherited
        for key in removed { env.removeValue(forKey: key) }
        // Le serveur standalone de Next écoute sur 0.0.0.0 par défaut : forcé.
        env["HOSTNAME"] = "127.0.0.1"
        env["PORT"] = String(port)
        env["NODE_ENV"] = "production"
        env["NEXT_TELEMETRY_DISABLED"] = "1"
        env["JOBSCOUT_DATA_DIR"] = dataDir
        env["JOBSCOUT_DB_PATH"] = dataDir + "/jobscout.db"
        env["JOBSCOUT_DOCS_PATH"] = dataDir + "/documents"
        env["PLAYWRIGHT_BROWSERS_PATH"] = dataDir + "/browsers"
        env["JOBSCOUT_PARENT_GUARD"] = "1"
        if (env["HOME"] ?? "").isEmpty { env["HOME"] = NSHomeDirectory() }
        var parts = (env["PATH"] ?? "").split(separator: ":").map(String.init).filter { !$0.isEmpty }
        for dir in requiredPath where !parts.contains(dir) { parts.append(dir) }
        env["PATH"] = parts.joined(separator: ":")
        return env
    }
}

// MARK: - Processus serveur

/// node lancé par posix_spawn, chef de son propre groupe de processus.
final class ServerProcess {
    let pid: pid_t
    private let lock = NSLock()
    private var status: Int32?
    private var stdinWrite: Int32
    private var source: DispatchSourceProcess?

    private init(pid: pid_t, stdinWrite: Int32) {
        self.pid = pid
        self.stdinWrite = stdinWrite
    }

    /// Tout abandon d'instance referme le côté écriture du tube. Sans verrou :
    /// en deinit, aucune autre référence ne subsiste.
    deinit {
        source?.cancel()
        if stdinWrite >= 0 { Darwin.close(stdinWrite) }
    }

    /// argv = [executable] + arguments ; stdin = côté lecture d'un tube dont
    /// seul le lanceur garde le côté écriture ; stdout et stderr = journal ;
    /// répertoire courant = workingDirectory.
    static func spawn(executable: String, arguments: [String], environment: [String: String],
                      workingDirectory: String, logFd: Int32) -> Result<ServerProcess, LaunchError> {
        var fds: [Int32] = [-1, -1]
        if pipe(&fds) != 0 { return .failure(LaunchError("pipe : \(Sys.errorText())")) }
        let readEnd = fds[0]
        let writeEnd = fds[1]
        // Par sécurité : aucun des deux côtés ne doit fuir dans un autre exec.
        _ = fcntl(readEnd, F_SETFD, FD_CLOEXEC)
        _ = fcntl(writeEnd, F_SETFD, FD_CLOEXEC)

        var actions: posix_spawn_file_actions_t? = nil
        posix_spawn_file_actions_init(&actions)
        defer { posix_spawn_file_actions_destroy(&actions) }
        posix_spawn_file_actions_adddup2(&actions, readEnd, 0)
        posix_spawn_file_actions_adddup2(&actions, logFd, 1)
        posix_spawn_file_actions_adddup2(&actions, logFd, 2)
        posix_spawn_file_actions_addchdir_np(&actions, workingDirectory)

        var attr: posix_spawnattr_t? = nil
        posix_spawnattr_init(&attr)
        defer { posix_spawnattr_destroy(&attr) }
        let flags = POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT
            | POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_SETSIGMASK
        posix_spawnattr_setflags(&attr, Int16(flags))
        posix_spawnattr_setpgroup(&attr, 0)
        var defaults = sigset_t()
        sigemptyset(&defaults)
        for sig in [SIGPIPE, SIGTERM, SIGINT, SIGHUP, SIGCHLD] { sigaddset(&defaults, sig) }
        posix_spawnattr_setsigdefault(&attr, &defaults)
        var mask = sigset_t()
        sigemptyset(&mask)
        posix_spawnattr_setsigmask(&attr, &mask)

        var argv: [UnsafeMutablePointer<CChar>?] = ([executable] + arguments).map { strdup($0) }
        argv.append(nil)
        var envp: [UnsafeMutablePointer<CChar>?] = environment.map { strdup("\($0.key)=\($0.value)") }
        envp.append(nil)
        defer {
            for p in argv { free(p) }
            for p in envp { free(p) }
        }

        var pid: pid_t = 0
        let rc = posix_spawn(&pid, executable, &actions, &attr, argv, envp)
        Darwin.close(readEnd)
        if rc != 0 {
            Darwin.close(writeEnd)
            return .failure(LaunchError("posix_spawn de \(executable) : \(Sys.errorText(rc))"))
        }
        return .success(ServerProcess(pid: pid, stdinWrite: writeEnd))
    }

    /// Surveille la sortie (kqueue via DispatchSource), en plus du relevé
    /// périodique par `reap()` (un processus déjà sorti n'émettrait rien).
    func watch(queue: DispatchQueue, onExit: @escaping (Int32) -> Void) {
        let src = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: queue)
        src.setEventHandler { [weak self] in
            guard let self = self, let st = self.reap() else { return }
            onExit(st)
        }
        source = src
        src.resume()
    }

    func stopWatching() {
        source?.cancel()
        source = nil
    }

    /// waitpid non bloquant. Renvoie le statut si node est sorti (et l'a déjà été).
    @discardableResult
    func reap() -> Int32? {
        lock.lock()
        defer { lock.unlock() }
        if let st = status { return st }
        var st: Int32 = 0
        let r = waitpid(pid, &st, WNOHANG)
        if r == pid {
            status = st
            return st
        }
        if r == -1 && errno == ECHILD {
            status = -1
            return -1
        }
        return nil
    }

    var hasExited: Bool { return reap() != nil }

    /// Signal au groupe de node (node, « cli.js install »…). Si le groupe
    /// n'existe plus et que node n'a pas été relevé, à node seul.
    func signalGroup(_ sig: Int32) {
        if kill(-pid, sig) != 0 && errno == ESRCH && !hasExited {
            _ = kill(pid, sig)
        }
    }

    /// Attente bloquante de la sortie de node (au plus `timeout` secondes).
    func waitExit(timeout: TimeInterval) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if reap() != nil { return true }
            usleep(50_000)
        }
        return reap() != nil
    }

    /// Ferme le côté écriture du tube : fin de stdin pour la garde parent.
    func closeStdin() {
        lock.lock()
        defer { lock.unlock() }
        if stdinWrite >= 0 {
            Darwin.close(stdinWrite)
            stdinWrite = -1
        }
    }
}

// MARK: - Contrôle de disponibilité

/// GET http://127.0.0.1:<p>/api/update. Prêt seulement si HTTP 200 ET
/// `current` = version du paquet : un autre serveur sur le port n'est jamais
/// pris pour JobScout.
final class ReadinessProbe {
    enum Outcome {
        case ready
        case notYet(String?)
    }

    private let session: URLSession
    private(set) var inFlight = false

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.connectionProxyDictionary = [:]   // jamais de proxy pour 127.0.0.1
        config.timeoutIntervalForRequest = 2.5
        config.timeoutIntervalForResource = 2.5
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.httpShouldSetCookies = false
        config.waitsForConnectivity = false
        session = URLSession(configuration: config)
    }

    /// `completion` est appelée sur la file principale avec l'URL sondée.
    func check(baseURL: String, expectedVersion: String, completion: @escaping (String, Outcome) -> Void) {
        guard !inFlight, let url = URL(string: baseURL + "/api/update") else { return }
        inFlight = true
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 2.5)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let task = session.dataTask(with: request) { data, response, error in
            var outcome = Outcome.notYet(nil)
            if error == nil, let http = response as? HTTPURLResponse {
                if http.statusCode == 200 {
                    if let d = data,
                       let obj = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
                       let current = obj["current"] as? String {
                        outcome = current == expectedVersion
                            ? .ready
                            : .notYet("/api/update annonce la version \(current) au lieu de \(expectedVersion)")
                    } else {
                        outcome = .notYet("/api/update répond 200 sans champ « current »")
                    }
                }
            }
            DispatchQueue.main.async {
                self.inFlight = false
                completion(baseURL, outcome)
            }
        }
        task.resume()
    }

    func invalidate() {
        session.invalidateAndCancel()
    }
}
