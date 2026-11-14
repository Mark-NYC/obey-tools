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

/// Root view controller: Capacitor's bridge plus native navigation behaviour.
class ObeyBridgeViewController: CAPBridgeViewController {
    override func router() -> Router {
        return ObeyRouter()
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
