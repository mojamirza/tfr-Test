/**
 * Android bridge — rebuilds the `window.app` surface natively.
 *
 * On Electron, `src/main/preload.js` exposes the app through the secure
 * contextBridge. In the Capacitor APK there is no preload; this module
 * wires the same ten channels onto a Capacitor plugin whose Java side
 * does the real work: the Telegram HTTP client (token attached natively,
 * multipart uploads, proxy support), the Keystore-encrypted settings,
 * the local drafts file and the Android file picker.
 *
 * Imported before App renders, so `window.app` exists by first paint.
 * On desktop (`Capacitor.isNativePlatform()` false) it does nothing and
 * the preload bridge stays authoritative.
 *
 * @module renderer/lib/bridge-android
 */

import { registerPlugin } from '@capacitor/core';

// Only guard against double-definition (the module is imported once, but the
// guard keeps the Electron preload bridge safe if that ever changes).
if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && !window.app) {
  const bridge = registerPlugin('TfrBridge');
  const wc = (action) => bridge.windowControl({ action });

  window.app = {
    /** The renderer draws its title bar controls on top of the window;
        on Android they are hidden, so the platform string just says so. */
    platform: 'android',

    /** Window controls — meaningful only on desktop. minimize returns the
        task to the background; close is a no-op because the system already
        owns the window life cycle on Android. */
    win: {
      minimize: () => wc('minimize'),
      toggleMaximize: () => wc('toggle-maximize'),
      close: () => wc('close'),
      isMaximized: () => wc('is-maximized'),
    },

    /** Telegram Bot API — the token rides on the native side. */
    api: (method, body) => bridge.tgApi({ method, body }),

    /** Keystore-encrypted settings; the token never comes back. */
    saveSettings: (settings) => bridge.saveSettings(settings),
    loadSettings: () => bridge.loadSettings(),
    testConnection: () => bridge.testConnection(),
    testProxy: () => bridge.testProxy(),

    /** Locally saved drafts (a plain JSON file in app storage). */
    draftsList: () => bridge.draftsList(),
    draftsSave: (payload) => bridge.draftsSave(payload),
    draftsLoad: (id) => bridge.draftsLoad({ id }),
    draftsDelete: (id) => bridge.draftsDelete({ id }),

    /** The Android document picker. Picked files are copied into the
        app's private cache and returned as absolute paths; the renderer
        wraps those in `tfrfile://` URLs the native WebViewClient serves. */
    pickMedia: (kind, title) => bridge.pickMedia({ kind, source: title }),
  };
}
