/**
 * Capacitor bridge — rebuilds the `window.app` surface natively.
 *
 * On Electron, `src/main/preload.js` exposes the app through the secure
 * contextBridge. In the Capacitor apps (the Android APK and the sideloaded
 * iOS .ipa) there is no preload; this module wires the same ten channels
 * onto a Capacitor plugin whose native side does the real work: the
 * Telegram HTTP client (token attached natively, multipart uploads, proxy
 * support), the Keychain/Keystore-encrypted settings, the local drafts file
 * and the Android SAF / iOS document pickers.
 *
 * Imported before App renders, so `window.app` exists by first paint.
 * On desktop (`Capacitor.isNativePlatform()` false) it does nothing and
 * the preload bridge stays authoritative.
 *
 * @module renderer/lib/bridge-capacitor
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

// Only guard against double-definition (the module is imported once, but the
// guard keeps the Electron preload bridge safe if that ever changes).
if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && !window.app) {
  const bridge = registerPlugin('TfrBridge');
  const wc = (action) => bridge.windowControl({ action });

  window.app = {
    /** The renderer draws its title bar controls on top of the window; on
        Android and iOS they are hidden, so the platform string just says so
        ('android' or 'ios'). */
    platform: Capacitor.getPlatform(),

    /** Window controls — meaningful only on desktop. minimize backgrounds the
        task on Android and resolves false on iOS; the rest are no-ops because
        the system owns the window life cycle on both platforms. */
    win: {
      minimize: () => wc('minimize'),
      toggleMaximize: () => wc('toggle-maximize'),
      close: () => wc('close'),
      isMaximized: () => wc('is-maximized'),
    },

    /** Telegram Bot API — the token rides on the native side. */
    api: (method, body) => bridge.tgApi({ method, body }),

    /** Keychain (iOS) / Keystore (Android)-encrypted settings; the token
        never comes back. */
    saveSettings: (settings) => bridge.saveSettings(settings),
    loadSettings: () => bridge.loadSettings(),
    testConnection: () => bridge.testConnection(),
    testProxy: () => bridge.testProxy(),

    /** Locally saved drafts (a plain JSON file in private app storage). */
    draftsList: () => bridge.draftsList(),
    draftsSave: (payload) => bridge.draftsSave(payload),
    draftsLoad: (id) => bridge.draftsLoad({ id }),
    draftsDelete: (id) => bridge.draftsDelete({ id }),

    /** The system document picker. Picked files are copied into the app's
        private storage and returned as absolute paths; the renderer wraps
        those in `tfrfile://` URLs the native layer serves to the web view. */
    pickMedia: (kind, title) => bridge.pickMedia({ kind, source: title }),
  };
}
