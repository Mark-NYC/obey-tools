import UIKit
import WebKit
import Capacitor

/// Resolves in-app URLs the same way GitHub Pages serves https://obey.tools,
/// so the website's extensionless links ("commands-of-christ", "/bible-study/")
/// work unchanged inside the app.
///
/// Capacitor's default router sends every extensionless path to /index.html
/// (single-page-app behaviour), which would silently turn every link on this
/// multi-page site into a jump back to Home.
///
/// Keep in sync with `route()` in app/tests/offline-smoke.mjs.
struct ObeyRouter: Router {
    var basePath: String = ""

    func route(for path: String) -> String {
        if path.isEmpty || path == "/" { return basePath + "/index.html" }
        if isFile(path) { return basePath + path }

        if URL(fileURLWithPath: path).pathExtension.isEmpty {
            let trimmed = path.hasSuffix("/") ? String(path.dropLast()) : path
            // "/x/" is the folder index; "/x" prefers x.html (GitHub Pages order).
            if path.hasSuffix("/") && isFile(trimmed + "/index.html") { return basePath + trimmed + "/index.html" }
            if isFile(trimmed + ".html") { return basePath + trimmed + ".html" }
            if isFile(trimmed + "/index.html") { return basePath + trimmed + "/index.html" }
            return basePath + "/index.html"
        }
        return basePath + path
    }

    private func isFile(_ relative: String) -> Bool {
        let full = URL(fileURLWithPath: basePath + relative).standardizedFileURL.path
        // Never resolve outside the bundled web folder.
        guard full.hasPrefix(URL(fileURLWithPath: basePath).standardizedFileURL.path) else { return false }
        var isDir: ObjCBool = false
        return FileManager.default.fileExists(atPath: full, isDirectory: &isDir) && !isDir.boolValue
    }
}

/// Native safety copy of the web layer's saved data (people, progress,
/// assessments). The web shell (app-shell.js) writes it to
/// Library/obey-local-data-backup.json after every change. If iOS ever clears
/// WebKit storage, the shell restores missing keys from this copy at the next
/// launch. It never overwrites a key that still exists.
enum ObeyLocalBackup {
    static let fileName = "obey-local-data-backup.json"

    /// JavaScript run at document start on every page:
    /// window.__OBEY_BACKUP_STATUS = "ok" | "none" | "error", plus the items when "ok".
    static func userScriptSource() -> String {
        guard let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else {
            return "window.__OBEY_BACKUP_STATUS='error';"
        }
        let url = library.appendingPathComponent(fileName)
        guard FileManager.default.fileExists(atPath: url.path) else {
            return "window.__OBEY_BACKUP_STATUS='none';"
        }
        guard let data = try? Data(contentsOf: url),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let items = root["items"] as? [String: String],
              let itemsJSON = try? JSONSerialization.data(withJSONObject: items),
              let itemsString = String(data: itemsJSON, encoding: .utf8) else {
            // Unreadable backup: tell the shell not to overwrite it.
            return "window.__OBEY_BACKUP_STATUS='error';"
        }
        return "window.__OBEY_BACKUP_STATUS='ok';window.__OBEY_BACKUP=\(itemsString);"
    }
}

/// Root view controller: Capacitor's bridge plus native navigation behaviour.
class ObeyBridgeViewController: CAPBridgeViewController {
    override func router() -> Router {
        return ObeyRouter()
    }

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        let script = WKUserScript(source: ObeyLocalBackup.userScriptSource(),
                                  injectionTime: .atDocumentStart,
                                  forMainFrameOnly: true)
        configuration.userContentController.addUserScript(script)
        return configuration
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let webView = webView else { return }
        // Edge swipe goes back/forward between pages, like Safari and native apps.
        webView.allowsBackForwardNavigationGestures = true
        // Safe areas are handled in CSS (viewport-fit=cover + env()).
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        // Match the page background so there is never a white flash between pages.
        let background = UIColor(red: 248 / 255, green: 248 / 255, blue: 248 / 255, alpha: 1)
        webView.isOpaque = false
        webView.backgroundColor = background
        webView.scrollView.backgroundColor = background
        view.backgroundColor = background
    }
}
