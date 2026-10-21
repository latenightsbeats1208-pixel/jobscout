// ============================================================================
// installer/mac/launcher/AppUI.swift — interface du lanceur macOS
//
// Mode normal (AppKit, sans nib) : fenêtre d'état de 420 × 170 (« JobScout
// démarre… » puis « JobScout est prêt »), menus construits par code, menu du
// Dock, badge « … » pendant l'attente, alertes E1 à E6. Fermer la fenêtre la
// masque seulement : seul ⌘Q (ou Dock › Quitter) arrête JobScout.
//
// Mode --non-interactive (HeadlessUI) : aucune fenêtre ni alerte ; les
// messages partent sur stderr et dans le journal (main.swift), chaque alerte
// vaut « Quitter », et le code de sortie dit ce qui s'est passé.
//
// Isolation : les protocoles délégués d'AppKit sont @MainActor. Pour que la
// classe AppController reste non isolée (appelée depuis le lanceur, qui vit
// lui aussi sur la file principale mais sans annotation d'acteur), seules les
// méthodes déléguées vivent dans AppDelegateProxy, qui ne fait que relayer.
// Swift 6 en mode de langage 5, vérification de concurrence minimale.
// ============================================================================
import AppKit
import Foundation

// MARK: - Actions sur le bureau

enum Desktop {
    static func open(_ url: String) {
        guard let u = URL(string: url) else { return }
        NSWorkspace.shared.open(u)
    }

    static func openPath(_ path: String) {
        guard !path.isEmpty else { return }
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }

    /// Journal du serveur dans Console, sinon dans l'application par défaut.
    static func openLog(_ path: String) {
        guard !path.isEmpty else { return }
        let log = URL(fileURLWithPath: path)
        let console = URL(fileURLWithPath: "/System/Applications/Utilities/Console.app")
        if FileManager.default.fileExists(atPath: console.path) {
            NSWorkspace.shared.open([log], withApplicationAt: console,
                                    configuration: NSWorkspace.OpenConfiguration(),
                                    completionHandler: nil)
        } else {
            NSWorkspace.shared.open(log)
        }
    }
}

// MARK: - Sans interface (--non-interactive)

final class HeadlessUI: LauncherUI {
    private unowned let launcher: Launcher
    private var slowAnnounced = false

    init(launcher: Launcher) {
        self.launcher = launcher
    }

    func showStarting(elapsed: Int, slow: Bool) {
        if elapsed == 0 { slowAnnounced = false }
        if slow && !slowAnnounced {
            slowAnnounced = true
            stderrLine(Texts.slow)
        }
    }

    func showReady(url: String) {}
    func setWaitingBadge(_ waiting: Bool) {}

    /// stderr et journal sont déjà écrits par le lanceur : « Quitter » d'office.
    func alert(_ spec: AlertSpec) -> AlertAction { return .quit }

    func requestTermination(cause: String) {
        let launcher = self.launcher
        launcher.shutdown(cause: cause) {
            exit(launcher.exitCodeOnTerminate)
        }
    }

    func activateOtherInstance(bundleId: String) {}
    func openURL(_ url: String) { Desktop.open(url) }
    func openPath(_ path: String) { Desktop.openPath(path) }
    func openLog(_ path: String) { Desktop.openLog(path) }
}

// MARK: - Délégué AppKit

/// Seul porteur des protocoles délégués (@MainActor) : relaie vers
/// AppController. N'est appelé que par AppKit, sur le fil principal.
final class AppDelegateProxy: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private unowned let owner: AppController

    nonisolated init(owner: AppController) {
        self.owner = owner
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        owner.didFinishLaunching()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        return owner.shouldTerminate()
    }

    func applicationWillTerminate(_ notification: Notification) {
        owner.willTerminate()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        owner.reopen()
        return false
    }

    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        return owner.dockMenu()
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil) // masquer, jamais arrêter
        return false
    }
}

// MARK: - Interface AppKit

final class AppController: NSObject, LauncherUI {
    let launcher: Launcher
    private(set) lazy var delegateProxy = AppDelegateProxy(owner: self)

    private var window: NSWindow?
    private var stack: NSStackView?
    private var spinner: NSProgressIndicator?
    private var titleLabel: NSTextField?
    private var detailLabel: NSTextField?
    private var noteLabel: NSTextField?
    private var buttonsRow: NSStackView?
    private var pendingCause: String?
    private var lastElapsed = -1

    init(launcher: Launcher) {
        self.launcher = launcher
        super.init()
    }

    // MARK: Cycle de vie (relayé par AppDelegateProxy)

    func didFinishLaunching() {
        NSApplication.shared.mainMenu = buildMainMenu()
        NSApplication.shared.activate(ignoringOtherApps: true)
        launcher.start()
    }

    func shouldTerminate() -> NSApplication.TerminateReply {
        let cause = pendingCause ?? "Quitter"
        pendingCause = nil
        launcher.shutdown(cause: cause) {
            NSApplication.shared.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func willTerminate() {
        window?.orderOut(nil)
        let code = launcher.exitCodeOnTerminate
        if code != ExitCode.normal { exit(code) }
    }

    /// Clic sur l'icône du Dock (ou nouvelle ouverture depuis le Finder) :
    /// rouvre la fenêtre ET le navigateur.
    func reopen() {
        showWindow()
        if let u = launcher.readyURL { Desktop.open(u) }
    }

    // MARK: LauncherUI

    func showStarting(elapsed: Int, slow: Bool) {
        // Fenêtre montrée une fois par démarrage (premier appel, ou relance
        // après E6), pas à chaque seconde : l'utilisateur peut la masquer.
        let first = window == nil || lastElapsed < 0 || elapsed < lastElapsed
        lastElapsed = elapsed
        ensureWindow()
        titleLabel?.stringValue = Texts.starting
        detailLabel?.stringValue = Texts.elapsed(elapsed)
        noteLabel?.stringValue = slow ? Texts.slow : ""
        noteLabel?.isHidden = !slow
        buttonsRow?.isHidden = true
        spinner?.isHidden = false
        spinner?.startAnimation(nil)
        fitWindow()
        if first { showWindow() }
    }

    func showReady(url: String) {
        lastElapsed = -1
        ensureWindow()
        titleLabel?.stringValue = Texts.ready
        detailLabel?.stringValue = Texts.opensIn(url)
        noteLabel?.stringValue = Texts.closeNote
        noteLabel?.isHidden = false
        buttonsRow?.isHidden = false
        spinner?.stopAnimation(nil)
        spinner?.isHidden = true
        fitWindow()
    }

    func setWaitingBadge(_ waiting: Bool) {
        NSApplication.shared.dockTile.badgeLabel = waiting ? "…" : nil
    }

    func alert(_ spec: AlertSpec) -> AlertAction {
        NSApplication.shared.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.alertStyle = spec.critical ? .critical : .warning
        a.messageText = spec.title
        a.informativeText = spec.message
        for b in spec.buttons { a.addButton(withTitle: b.label) }
        let response = a.runModal()
        let index = response.rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
        return index >= 0 && index < spec.buttons.count ? spec.buttons[index] : .quit
    }

    func requestTermination(cause: String) {
        pendingCause = cause
        NSApplication.shared.terminate(nil)
    }

    func activateOtherInstance(bundleId: String) {
        let me = getpid()
        for app in NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
            where app.processIdentifier != me {
            app.activate(options: [])
        }
    }

    func openURL(_ url: String) { Desktop.open(url) }
    func openPath(_ path: String) { Desktop.openPath(path) }
    func openLog(_ path: String) { Desktop.openLog(path) }

    // MARK: Fenêtre

    private func ensureWindow() {
        if window != nil { return }
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 170),
                         styleMask: [.titled, .closable, .miniaturizable],
                         backing: .buffered, defer: false)
        w.title = "JobScout"
        w.isRestorable = false
        w.isReleasedWhenClosed = false
        w.delegate = delegateProxy

        let spin = NSProgressIndicator()
        spin.style = .spinning
        spin.controlSize = .small
        spin.isIndeterminate = true
        spin.isDisplayedWhenStopped = false

        let title = NSTextField(labelWithString: Texts.starting)
        title.font = NSFont.boldSystemFont(ofSize: 15)

        let titleRow = NSStackView(views: [spin, title])
        titleRow.orientation = .horizontal
        titleRow.alignment = .centerY
        titleRow.spacing = 8

        let detail = NSTextField(wrappingLabelWithString: "")
        detail.isSelectable = true // l'adresse peut être copiée (⌘C)
        detail.preferredMaxLayoutWidth = 380

        let note = NSTextField(wrappingLabelWithString: "")
        note.font = NSFont.systemFont(ofSize: NSFont.smallSystemFontSize)
        note.textColor = NSColor.secondaryLabelColor
        note.preferredMaxLayoutWidth = 380

        let open = NSButton(title: Texts.openInBrowser, target: self, action: #selector(openInBrowser(_:)))
        open.keyEquivalent = "\r"
        let quit = NSButton(title: Texts.quitApp, target: self, action: #selector(quitFromWindow(_:)))
        let buttons = NSStackView(views: [open, quit])
        buttons.orientation = .horizontal
        buttons.spacing = 12
        buttons.isHidden = true

        let column = NSStackView(views: [titleRow, detail, note, buttons])
        column.orientation = .vertical
        column.alignment = .leading
        column.spacing = 8
        column.edgeInsets = NSEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)
        column.translatesAutoresizingMaskIntoConstraints = false

        let content = NSView(frame: NSRect(x: 0, y: 0, width: 420, height: 170))
        content.addSubview(column)
        NSLayoutConstraint.activate([
            column.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            column.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            column.topAnchor.constraint(equalTo: content.topAnchor),
            column.widthAnchor.constraint(equalToConstant: 420),
        ])
        w.contentView = content
        w.center()

        window = w
        stack = column
        spinner = spin
        titleLabel = title
        detailLabel = detail
        noteLabel = note
        buttonsRow = buttons
    }

    /// 420 × 170 au moins ; plus haut si le texte l'exige.
    private func fitWindow() {
        guard let w = window, let column = stack else { return }
        column.layoutSubtreeIfNeeded()
        let height = max(170, ceil(column.fittingSize.height))
        if abs(w.contentLayoutRect.height - height) > 0.5 {
            w.setContentSize(NSSize(width: 420, height: height))
        }
    }

    private func showWindow() {
        ensureWindow()
        NSApplication.shared.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }

    // MARK: Menus

    private func item(_ title: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
        i.target = self
        return i
    }

    private func buildMainMenu() -> NSMenu {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu(title: "JobScout")
        appMenu.addItem(item("À propos de JobScout", #selector(showAbout(_:))))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(item("Ouvrir JobScout", #selector(openJobScout(_:)), key: "o"))
        appMenu.addItem(item("Dossier de données", #selector(openDataFolder(_:))))
        appMenu.addItem(item("Journal du serveur", #selector(openServerLog(_:))))
        appMenu.addItem(item("Page des versions", #selector(openReleases(_:))))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "Masquer JobScout", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "Quitter JobScout", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appItem.submenu = appMenu

        // Édition : copier l'adresse affichée dans la fenêtre.
        let editItem = NSMenuItem()
        main.addItem(editItem)
        let editMenu = NSMenu(title: "Édition")
        editMenu.addItem(NSMenuItem(title: "Copier", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "Tout sélectionner", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editItem.submenu = editMenu

        // Fenêtre : rouvrir la fenêtre d'état une fois masquée.
        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let windowMenu = NSMenu(title: "Fenêtre")
        windowMenu.addItem(item("État de JobScout", #selector(showStatusWindow(_:))))
        windowMenu.addItem(NSMenuItem(title: "Réduire", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
        windowMenu.addItem(NSMenuItem(title: "Fermer", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
        windowItem.submenu = windowMenu
        NSApplication.shared.windowsMenu = windowMenu

        return main
    }

    func dockMenu() -> NSMenu {
        let m = NSMenu()
        m.addItem(item("Ouvrir JobScout", #selector(openJobScout(_:))))
        m.addItem(item("Dossier de données", #selector(openDataFolder(_:))))
        m.addItem(item("Journal du serveur", #selector(openServerLog(_:))))
        return m
    }

    // MARK: Actions

    @objc func showAbout(_ sender: Any?) {
        NSApplication.shared.activate(ignoringOtherApps: true)
        NSApplication.shared.orderFrontStandardAboutPanel(nil) // version et licence MIT (Info.plist)
    }

    /// Ouvrir JobScout : le navigateur si le serveur est prêt, sinon la fenêtre d'état.
    @objc func openJobScout(_ sender: Any?) {
        if let u = launcher.readyURL {
            Desktop.open(u)
        } else {
            showWindow()
        }
    }

    @objc func openInBrowser(_ sender: Any?) {
        openJobScout(sender)
    }

    @objc func quitFromWindow(_ sender: Any?) {
        NSApplication.shared.terminate(nil)
    }

    @objc func openDataFolder(_ sender: Any?) {
        Desktop.openPath(launcher.dataDir)
    }

    @objc func openServerLog(_ sender: Any?) {
        Desktop.openLog(launcher.logPath)
    }

    @objc func openReleases(_ sender: Any?) {
        if let u = launcher.config?.releasesURL { Desktop.open(u) }
    }

    @objc func showStatusWindow(_ sender: Any?) {
        showWindow()
    }
}
