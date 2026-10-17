/**
 * TelegramFreeRich — Electron Main Process
 * Handles: window management, encrypted settings, Telegram API proxy.
 * Security: token NEVER leaves main process.
 */

const { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, session, shell } =
  require('electron');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');
const {
  isValidToken,
  isValidChatId,
  isValidDraftId,
  isValidDraftName,
  isValidLang,
  isValidMethod,
  isValidBusinessConnectionId,
  isValidAttachment,
  localMediaUrlToPath,
} = require('./security/validation');
const { attachNavigationGuards } = require('./security/navigation');
const {
  buildSessionProxyConfig,
  isValidProxyConfig,
  normalizeProxyConfig,
  publicProxyConfig,
} = require('./net/proxy');
const { createRequester } = require('./net/request');

const TELEGRAM_PROBE_URL = 'https://api.telegram.org/';

let mainWindow;
let secureToken = '';
let secureChatId = '';
let secureLang = 'en';
let secureBusinessId = '';
let secureProxy = normalizeProxyConfig();

// ===================== Encrypted Settings =====================

function getSettingsPath() {
  const dir = app.getPath('userData');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'settings.enc');
}

function loadSecureSettings() {
  const filePath = getSettingsPath();
  if (!fs.existsSync(filePath)) return;
  try {
    const raw = fs.readFileSync(filePath);
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('[Settings] Encryption not available on this system');
      return;
    }
    const decrypted = safeStorage.decryptString(raw);
    const parsed = JSON.parse(decrypted);
    secureToken = parsed.token || '';
    secureChatId = parsed.chatId || '';
    secureLang = parsed.lang || 'en';
    secureBusinessId = parsed.businessConnectionId || '';
    secureProxy = normalizeProxyConfig(parsed.proxy);
  } catch (e) {
    console.error('[Settings] Failed to load:', e.message);
  }
}

function saveSecureSettings() {
  const filePath = getSettingsPath();
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('[Settings] Encryption not available — settings not saved');
      return false;
    }
    const data = JSON.stringify({
      token: secureToken,
      chatId: secureChatId,
      lang: secureLang,
      businessConnectionId: secureBusinessId,
      proxy: secureProxy,
    });
    const encrypted = safeStorage.encryptString(data);
    fs.writeFileSync(filePath, encrypted);
    return true;
  } catch (e) {
    console.error('[Settings] Failed to save:', e.message);
    return false;
  }
}

// ===================== Proxy =====================

/**
 * Apply the stored proxy configuration to the default session.
 * Every Telegram request rides on this session, so "system" mode picks up
 * whatever v2rayN (or any other client) set as the OS proxy.
 * @returns {Promise<void>}
 */
async function applyProxy() {
  try {
    await session.defaultSession.setProxy(buildSessionProxyConfig(secureProxy));
  } catch (e) {
    console.error('[Proxy] Failed to apply:', e.message);
  }
}

/**
 * Ask Chromium which proxy it would use for the Telegram API.
 * @returns {Promise<string>} e.g. `PROXY 127.0.0.1:10809` or `DIRECT`
 */
async function resolveTelegramProxy() {
  try {
    return await session.defaultSession.resolveProxy(TELEGRAM_PROBE_URL);
  } catch (e) {
    return `error: ${e.message}`;
  }
}

// ===================== HTTP Request =====================

/**
 * Telegram requests ride Chromium's stack, so they follow the proxy resolved
 * above — that is what makes a system proxy (v2rayN and friends) work.
 *
 * The session is fetched per request, never here: `session.defaultSession`
 * throws "Session can only be received when app is ready" if it is read while
 * this module is still loading, which crashed the app on startup.
 */
const tgRequest = createRequester({
  net,
  getSession: () => session.defaultSession,
  getProxy: () => secureProxy,
});

// ===================== Window =====================

function createWindow() {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 520,
    height: 700,
    minWidth: 420,
    minHeight: 480,
    backgroundColor: '#212d3b',
    // Frameless on Windows/Linux (the renderer draws its own title bar);
    // hidden title bar with native traffic lights on macOS.
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 12, y: 8 } : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // In dev with Vite, load from localhost; otherwise load built file
  const isDev = process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // Prefer Vite build output, fall back to source HTML
    const built = path.join(__dirname, '..', '..', 'build', 'renderer', 'index.html');
    const source = path.join(__dirname, '..', 'renderer', 'index.html');
    mainWindow.loadFile(fs.existsSync(built) ? built : source);
  }

  attachNavigationGuards(mainWindow.webContents, {
    isDev,
    openExternal: (url) => shell.openExternal(url),
    onBlocked: (what, url) => console.warn('[Security]', what, url),
  });
}

/** Bring the existing window forward instead of opening a second copy. */
function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/* ── Local media scheme ──
 *
 * Media picked from the device is shown in the editor and preview through
 * `tfrfile://media/<encoded-absolute-path>` URLs. The scheme must be
 * registered as standard+secure BEFORE the app is ready (below), and the
 * handler must exist before the window loads. Serving the bytes from the
 * main process keeps the renderer free of `fs`.
 */
const MEDIA_SCHEME = 'tfrfile';

/** One extension → MIME map, just wide enough for user media. */
const MEDIA_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/x-m4v',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
};

/**
 * Serve one picked file. The whole path rides inside the URL, so the
 * editor document and the saved drafts survive restarts without any
 * session-level registry.
 */
function serveLocalMedia(request) {
  const file = localMediaUrlToPath(request.url);
  if (!file) return new Response('Bad media URL', { status: 400 });
  try {
    const data = fs.readFileSync(file);
    const mime = MEDIA_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return new Response(data, { headers: { 'content-type': mime } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

// Register the scheme privileges before the app is ready, as Electron demands.
// `standard` keeps the URL well-formed in the renderer; `secure` marks it as a
// trustworthy context; `stream` lets <video>/<audio> play instead of buffering
// the whole file into one response.
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

// One process only. Two copies of the app hold the same installed files open,
// which is how a Windows upgrade ends up with "TelegramFreeRich cannot be
// closed" — the installer closes one and the other keeps the lock.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusMainWindow);

  app.whenReady().then(async () => {
    protocol.handle(MEDIA_SCHEME, serveLocalMedia);
    loadSecureSettings();
    await applyProxy();
    createWindow();
  });
}

// Answer proxy authentication challenges with the stored credentials.
app.on('login', (event, _webContents, _details, authInfo, callback) => {
  if (!authInfo.isProxy) return;
  event.preventDefault();
  callback(secureProxy.username, secureProxy.password);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ===================== IPC Handlers =====================

/**
 * Telegram API call — token is added here, NEVER in renderer.
 */
ipcMain.handle('tg-api', async (_event, { method, body }) => {
  if (!secureToken) {
    return { ok: false, description: 'Bot token not configured' };
  }
  if (!isValidMethod(method)) {
    return { ok: false, description: 'Invalid API method' };
  }
  if (!body || typeof body !== 'object') {
    return { ok: false, description: 'Invalid request body' };
  }

  try {
    const url = `https://api.telegram.org/bot${secureToken}/${method}`;
    // Local media picked on the device rides as `_files` beside the fields it
    // belongs to; it becomes multipart form-data, not JSON. Anything malformed
    // is dropped so a hand-tampered body can never point the read at a
    // relative path — `fs` here is absolute-path only.
    const rawAttachments = Array.isArray(body._files) ? body._files : null;
    const attachments = rawAttachments
      ? rawAttachments.filter((entry) => isValidAttachment(entry) && fs.existsSync(entry.path))
      : null;
    if (rawAttachments) delete body._files;
    return await tgRequest(url, body, attachments);
  } catch (e) {
    return { ok: false, description: e.message || 'Network error' };
  }
});

/**
 * Save settings — encrypted via safeStorage. Token is validated.
 */
ipcMain.handle(
  'save-settings',
  async (_event, { token, chatId, lang, businessConnectionId, proxy }) => {
    if (token !== undefined) {
      if (typeof token === 'string' && token.length > 0 && !isValidToken(token)) {
        return { ok: false, description: 'Invalid bot token format' };
      }
      secureToken = token || '';
    }
    if (chatId !== undefined) {
      if (typeof chatId === 'string' && chatId.length > 0 && !isValidChatId(chatId)) {
        return { ok: false, description: 'Invalid chat ID format' };
      }
      secureChatId = chatId || '';
    }
    if (lang !== undefined) {
      if (!isValidLang(lang)) {
        return { ok: false, description: 'Invalid language' };
      }
      secureLang = lang;
    }
    if (businessConnectionId !== undefined) {
      const id = typeof businessConnectionId === 'string' ? businessConnectionId.trim() : '';
      if (id.length > 0 && !isValidBusinessConnectionId(id)) {
        return { ok: false, description: 'Invalid business connection ID' };
      }
      secureBusinessId = id;
    }
    if (proxy !== undefined) {
      const candidate = normalizeProxyConfig({
        ...proxy,
        // An omitted password means "keep the stored one".
        password: typeof proxy.password === 'string' ? proxy.password : secureProxy.password,
      });
      if (!isValidProxyConfig(candidate)) {
        return { ok: false, description: 'Invalid proxy configuration' };
      }
      secureProxy = candidate;
      await applyProxy();
    }

    const saved = saveSecureSettings();
    return saved
      ? { ok: true, proxy: publicProxyConfig(secureProxy) }
      : { ok: false, description: 'Failed to encrypt/save settings' };
  },
);

/**
 * Load settings — returns everything EXCEPT the token (security).
 */
ipcMain.handle('load-settings', async () => {
  return {
    tokenSet: !!secureToken,
    chatId: secureChatId,
    lang: secureLang,
    businessConnectionId: secureBusinessId,
    proxy: publicProxyConfig(secureProxy),
  };
});

/**
 * Report which proxy Chromium resolves for the Telegram API, and whether a
 * plain HTTPS request to it gets through. Used by the Settings panel so a
 * blocked connection can be told apart from a bad token.
 */
ipcMain.handle('proxy-test', async () => {
  const resolved = await resolveTelegramProxy();
  try {
    await tgRequest(`${TELEGRAM_PROBE_URL}bot0:invalid/getMe`, null);
    // Telegram answered — even a 401 body means the tunnel works.
    return { ok: true, reachable: true, resolved, mode: secureProxy.mode };
  } catch (e) {
    return {
      ok: false,
      reachable: false,
      resolved,
      mode: secureProxy.mode,
      description: e.message,
    };
  }
});

/**
 * Test connection — uses internal token, never exposes it.
 * Uses GET (getMe has no body).
 */
ipcMain.handle('tg-test', async () => {
  if (!secureToken) {
    return { ok: false, description: 'Bot token not configured' };
  }
  try {
    const url = `https://api.telegram.org/bot${secureToken}/getMe`;
    return await tgRequest(url, null);
  } catch (e) {
    return { ok: false, description: e.message || 'Network error' };
  }
});

/**
 * Window controls for the renderer-drawn title bar.
 */
ipcMain.handle('window-control', async (event, { action } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (!win) return false;

  switch (action) {
    case 'minimize':
      win.minimize();
      return true;
    case 'toggle-maximize':
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return win.isMaximized();
    case 'close':
      win.close();
      return true;
    case 'is-maximized':
      return win.isMaximized();
    default:
      return false;
  }
});

// ===================== Local Drafts =====================

/**
 * Saved messages live beside the encrypted settings as plain JSON — the *body*
 * of a draft is not a secret (the token is what safeStorage guards), and a
 * plain file keeps drafts readable after an OS keychain change.
 */

/** The hard size caps a single saved draft may carry. */
const DRAFT_CAPS = {
  NAME: 80,
  HTML: 4 * 32768 + 8192,
};

function getDraftsPath() {
  const dir = app.getPath('userData');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'drafts.json');
}

function loadDrafts() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getDraftsPath(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeDrafts(list) {
  try {
    fs.writeFileSync(getDraftsPath(), JSON.stringify(list, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[Drafts] Failed to save:', e.message);
    return false;
  }
}

/** The list entry sent back to the renderer — never the body itself. */
const draftSummary = (draft) => ({
  id: draft.id,
  name: draft.name,
  savedAt: draft.savedAt,
  isRtl: !!draft.isRtl,
});

ipcMain.handle('drafts-list', async () => {
  return { ok: true, drafts: loadDrafts().map(draftSummary) };
});

ipcMain.handle('drafts-save', async (_event, { name, html, isRtl } = {}) => {
  if (!isValidDraftName(name)) {
    return { ok: false, description: 'Invalid draft name' };
  }
  if (typeof html !== 'string' || !html.trim() || html.length > DRAFT_CAPS.HTML) {
    return { ok: false, description: 'Nothing to save in this draft' };
  }
  const drafts = loadDrafts();
  const draft = {
    id: randomUUID(),
    name: String(name).trim().slice(0, DRAFT_CAPS.NAME),
    html: String(html).slice(0, DRAFT_CAPS.HTML),
    isRtl: !!isRtl,
    savedAt: Date.now(),
  };
  writeDrafts([draft, ...drafts].slice(0, 100));
  return { ok: true, drafts: loadDrafts().map(draftSummary) };
});

ipcMain.handle('drafts-load', async (_event, { id } = {}) => {
  if (!isValidDraftId(id)) {
    return { ok: false, description: 'Invalid draft ID' };
  }
  const draft = loadDrafts().find((entry) => entry.id === id);
  if (!draft) return { ok: false, description: 'Draft not found' };
  return { ok: true, draft };
});

ipcMain.handle('drafts-delete', async (_event, { id } = {}) => {
  if (!isValidDraftId(id)) {
    return { ok: false, description: 'Invalid draft ID' };
  }
  const remaining = loadDrafts().filter((entry) => entry.id !== id);
  const removed = writeDrafts(remaining);
  if (!removed) return { ok: false, description: 'Failed to save draft file' };
  return { ok: true, drafts: remaining.map(draftSummary) };
});

/** The file filters each media picker offers. */
const PICK_FILTERS = {
  media: [
    { name: 'Media', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi'] },
  ],
  audio: [
    { name: 'Audio', extensions: ['mp3', 'ogg', 'oga', 'wav', 'm4a', 'flac', 'opus', 'aac'] },
  ],
  document: [{ name: 'All files', extensions: ['*'] }],
};

/** Rich messages cap a document at 50 MB; be no more permissive than Telegram. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * The device file picker behind "insert media". Native dialog, multi-select;
 * the renderer turns the returned absolute paths into `tfrfile://` URLs.
 */
ipcMain.handle('pick-media', async (_event, { kind = 'media', source } = {}) => {
  const filters = PICK_FILTERS[kind] || PICK_FILTERS.media;
  let files = [];
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: source || 'Choose files',
      properties: ['openFile', 'multiSelections'],
      filters,
    });
    if (result.canceled) return { ok: true, files: [] };
    files = result.filePaths || [];
  } catch (e) {
    return { ok: false, description: e.message || 'Dialog failed' };
  }

  // Nothing that could not actually be read leaves here: drop missing files
  // and anything beyond Telegram's size cap, and say so when all were dropped.
  const usable = [];
  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      if (stat.isFile() && stat.size > 0 && stat.size <= MAX_UPLOAD_BYTES) usable.push(file);
    } catch {
      /* unreadable — silently dropped, like a dialog cancel */
    }
  }
  if (files.length && !usable.length) {
    return { ok: false, description: 'No file could be added (missing or too large)' };
  }
  return { ok: true, files: usable };
});
