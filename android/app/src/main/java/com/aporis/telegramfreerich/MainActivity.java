package com.aporis.telegramfreerich;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

/**
 * MainActivity — the Capacitor shell. The TfrBridge plugin is registered
 * before the bridge starts (a Capacitor requirement) and the WebView's
 * client is swapped for a subclass that answers `tfrfile://media/…`
 * requests from the plugin's static server, so picked media displays in
 * the editor and preview exactly as it does on the desktop.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins must be registered before super.onCreate initializes the
        // bridge — documented Capacitor order.
        registerPlugin(TfrBridgePlugin.class);
        super.onCreate(savedInstanceState);

        // The bridge creates its own client inside super.onCreate; replacing
        // it afterwards keeps every Capacitor handler and only adds the
        // media-scheme branch.
        bridge.getWebView().setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                WebResourceResponse media = TfrBridgePlugin.serveMedia(
                        getApplicationContext(), request.getUrl().toString());
                if (media != null) return media;
                return super.shouldInterceptRequest(view, request);
            }
        });
    }
}
