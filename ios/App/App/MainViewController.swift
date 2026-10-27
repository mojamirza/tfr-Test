//
//  MainViewController.swift
//  App
//
//  The Capacitor entry view controller. Two app-specific contributions:
//
//  1. The TfrBridge plugin is registered eagerly in capacitorDidLoad —
//     it is an app-local plugin, so the npm auto-scan never sees it.
//  2. The web view configuration gains a handler for `tfrfile://`, the
//     local-media scheme the renderer embeds in the editor and preview.
//     TfrMediaSchemeHandler (in TfrBridgePlugin.swift) serves only the
//     app's own private media folders.
//

import Capacitor
import WebKit

class MainViewController: CAPBridgeViewController {

    override func webViewConfiguration(
        for instanceConfiguration: InstanceConfiguration
    ) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.setURLSchemeHandler(TfrMediaSchemeHandler(), forURLScheme: "tfrfile")
        return configuration
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(TfrBridgePlugin())
    }
}
