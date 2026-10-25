/**
 * Settings — bot token, chat ID, edit target, language and theme.
 * The token is written straight to the main process (OS-encrypted) and is never
 * held in renderer state; the panel only ever knows whether one exists.
 * The chat-ID list is the renderer's own: a small, locally persisted history
 * of the IDs already used, so switching targets is a click, not a retype.
 *
 * @module components/Settings
 */

import { useEffect, useRef, useState } from 'react';

/** Mirrors the main process defaults (a stock v2rayN SOCKS5 endpoint). */
const DEFAULT_PROXY_FORM = {
  mode: 'system',
  scheme: 'socks5',
  host: '127.0.0.1',
  port: 10808,
  username: '',
  hasPassword: false,
};

/** The locally persisted chat-ID history, and how many it may hold. */
const SAVED_CHATS_KEY = 'tfr-saved-chats';
const SAVED_CHATS_MAX = 12;
import { THEME_IDS } from '../../shared/constants.js';
import { CloseIcon } from './Icons.jsx';
import { useI18n } from '../i18n/index.js';

/**
 * One palette previewed literally: a miniature of the chrome each theme
 * paints — title bar, two text lines and the round send button. The card
 * does not read the live tokens (that would only preview the running
 * theme); it carries the four palettes' own surface and accent values.
 *
 * @param {{ id: string }} props
 */
function ThemeCard({ id }) {
  const { t } = useI18n();
  const swatch = THEME_SWATCHES[id];
  return (
    <>
      <span className="theme-card-surface" style={{ background: swatch.bg }} aria-hidden="true">
        <span className="theme-card-bar" style={{ background: swatch.titlebar }} />
        <span className="theme-card-line" style={{ background: swatch.text }} />
        <span className="theme-card-line short" style={{ background: swatch.faint }} />
        <span className="theme-card-fab" style={{ background: swatch.accent }} />
      </span>
      <span className="theme-card-name">{t(`settings.theme.${id}`)}</span>
    </>
  );
}

/** The literal palette values the previews paint — kept beside the tokens. */
const THEME_SWATCHES = {
  night: {
    bg: '#17212b',
    titlebar: '#253140',
    text: 'rgba(255, 255, 255, 0.75)',
    faint: 'rgba(255, 255, 255, 0.3)',
    accent: '#4ea4f6',
  },
  black: {
    bg: '#07090b',
    titlebar: '#14171c',
    text: 'rgba(255, 255, 255, 0.75)',
    faint: 'rgba(255, 255, 255, 0.28)',
    accent: '#3ba0f9',
  },
  graphite: {
    bg: '#202226',
    titlebar: '#2a2d32',
    text: 'rgba(245, 245, 247, 0.72)',
    faint: 'rgba(245, 245, 247, 0.28)',
    accent: '#0a84ff',
  },
  day: {
    bg: '#ffffff',
    titlebar: '#eef1f4',
    text: 'rgba(23, 33, 43, 0.72)',
    faint: 'rgba(23, 33, 43, 0.26)',
    accent: '#3390ec',
  },
};

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   settings: object,
 *   onSaved: (settings: object, options?: { announce?: boolean }) => void,
 *   theme: string,
 *   onThemeChange: (theme: string) => void,
 *   lang: string,
 *   onLangChange: (lang: string) => void,
 * }} props
 */
export default function Settings({
  open,
  onClose,
  settings,
  onSaved,
  theme,
  onThemeChange,
  lang,
  onLangChange,
}) {
  const { t } = useI18n();
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [editId, setEditId] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [status, setStatus] = useState({ text: '', type: '' });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [proxy, setProxy] = useState(DEFAULT_PROXY_FORM);
  const [proxyPassword, setProxyPassword] = useState('');
  const [proxyStatus, setProxyStatus] = useState({ text: '', type: '' });
  const [checkingProxy, setCheckingProxy] = useState(false);
  // The saved chat-ID chips — plain localStorage, updated at once: they are
  // not part of the form's own "Save" payload, so closing the panel without
  // saving never loses a chip change either way.
  const [savedChats, setSavedChats] = useState([]);

  // Read through a ref so the effect below can fill the form from the current
  // settings without re-running every time they change.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Fill the form when the panel opens, and only then. Depending on `settings`
  // as well used to make "Test connection" wipe the form mid-test: the test
  // saves the token, the parent stores the new settings, and the new object
  // re-ran this effect — clearing the token field, the proxy password and any
  // unsaved edits to the chat, edit and business IDs while the user watched.
  useEffect(() => {
    if (!open) return;
    const current = settingsRef.current;
    setToken('');
    setChatId(current.chatId || '');
    setEditId(current.editId || '');
    setBusinessId(current.businessConnectionId || '');
    setStatus({ text: '', type: '' });
    setProxyStatus({ text: '', type: '' });
    setProxyPassword('');
    setProxy({ ...DEFAULT_PROXY_FORM, ...(current.proxy || {}) });
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED_CHATS_KEY) || '[]');
      setSavedChats(Array.isArray(saved) ? saved.filter((id) => typeof id === 'string' && id) : []);
    } catch {
      setSavedChats([]);
    }
  }, [open]);

  if (!open) return null;

  /** Replace the chip list in state and on disk in one move. */
  function updateSavedChats(list) {
    setSavedChats(list);
    try {
      localStorage.setItem(SAVED_CHATS_KEY, JSON.stringify(list));
    } catch {
      // Quota — the chips stay for the session only.
    }
  }

  /** A chip click loads the ID into the chat field. */
  function pickSavedChat(id) {
    setChatId(id);
  }

  /** The chip's ✕ — gone from the list and the storage at once. */
  function removeSavedChat(id) {
    updateSavedChats(savedChats.filter((saved) => saved !== id));
  }

  async function handleSave() {
    setSaving(true);
    const payload = {
      chatId,
      lang,
      businessConnectionId: businessId.trim(),
      proxy: proxyPayload(),
    };
    if (token) payload.token = token;

    try {
      const result = await window.app.saveSettings(payload);
      if (!result.ok) {
        setStatus({ text: result.description || t('toast.networkError'), type: 'error' });
        setSaving(false);
        return;
      }
      // A used chat ID joins the saved list automatically — trimmed,
      // deduplicated, newest keeps its old place and the list is capped.
      const used = chatId.trim();
      if (used) {
        updateSavedChats([...savedChats.filter((saved) => saved !== used), used].slice(-SAVED_CHATS_MAX));
      }
      onSaved({
        tokenSet: !!token || settings.tokenSet,
        chatId,
        editId,
        lang,
        businessConnectionId: businessId.trim(),
        proxy: result.proxy || proxy,
      });
      onClose();
    } catch {
      setStatus({ text: t('toast.networkError'), type: 'error' });
    }
    setSaving(false);
  }

  /** The proxy fields to send; an untouched password keeps the stored one. */
  function proxyPayload() {
    const payload = {
      mode: proxy.mode,
      scheme: proxy.scheme,
      host: proxy.host,
      port: Number(proxy.port) || 0,
      username: proxy.username || '',
    };
    if (proxyPassword) payload.password = proxyPassword;
    return payload;
  }

  /** Save the proxy first, then ask the main process what the path looks like. */
  async function handleProxyTest() {
    setCheckingProxy(true);
    setProxyStatus({ text: t('proxy.checking'), type: '' });
    try {
      const saved = await window.app.saveSettings({ proxy: proxyPayload() });
      if (!saved.ok) {
        setProxyStatus({ text: saved.description || t('toast.networkError'), type: 'error' });
        setCheckingProxy(false);
        return;
      }
      const result = await window.app.testProxy();
      setProxyStatus(
        result.reachable
          ? { text: `✓ ${t('proxy.reachable')} — ${result.resolved}`, type: 'ok' }
          : { text: `✗ ${result.resolved} — ${result.description || ''}`, type: 'error' },
      );
    } catch {
      setProxyStatus({ text: t('toast.networkError'), type: 'error' });
    }
    setCheckingProxy(false);
  }

  async function handleTest() {
    setTesting(true);
    setStatus({ text: t('settings.testing'), type: '' });

    try {
      if (token) {
        const saved = await window.app.saveSettings({ token });
        if (!saved.ok) {
          setStatus({ text: saved.description || t('toast.networkError'), type: 'error' });
          setTesting(false);
          return;
        }
        // The parent needs to know a token now exists, or the send button will
        // still say "configure a token". It is not a save of the whole panel
        // though — the other fields are still unsaved — so it stays quiet.
        onSaved({ ...settings, tokenSet: true }, { announce: false });
      }
      const data = await window.app.testConnection();
      if (data.ok) {
        setStatus({ text: `✓ @${data.result.username}`, type: 'ok' });
      } else {
        setStatus({ text: `✗ ${data.description}`, type: 'error' });
      }
    } catch {
      setStatus({ text: t('toast.networkError'), type: 'error' });
    }
    setTesting(false);
  }

  return (
    <div
      className="overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="sheet">
        <div className="sheet-head">
          <h3>{t('settings.title')}</h3>
          <button
            type="button"
            className="sheet-close"
            onClick={onClose}
            aria-label={t('window.close')}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="sheet-body">
          <label htmlFor="set-token">
            {settings.tokenSet ? t('settings.tokenSaved') : t('settings.token')}
          </label>
          <input
            id="set-token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={
              settings.tokenSet ? t('settings.tokenKeep') : t('settings.tokenPlaceholder')
            }
            autoComplete="off"
          />

          <label htmlFor="set-chat">{t('settings.chatId')}</label>
          <input
            id="set-chat"
            type="text"
            value={chatId}
            onChange={(event) => setChatId(event.target.value)}
            placeholder={t('settings.chatIdPlaceholder')}
            autoComplete="off"
          />

          {savedChats.length > 0 && (
            /* One click switches target — no delete-one-type-the-other round
               trip. The ✕ prunes the list; "Save" appends whatever the field
               then holds, so a fresh ID is remembered by the same action. */
            <div className="chat-chips">
              <span className="chat-chips-label">{t('settings.savedChats')}</span>
              <div className="chat-chips-row">
                {savedChats.map((id) => (
                  <span key={id} className="chat-chip">
                    <button
                      type="button"
                      className="chat-chip-id"
                      title={t('settings.savedChatsUse')}
                      onClick={() => pickSavedChat(id)}
                    >
                      {id}
                    </button>
                    <button
                      type="button"
                      className="chat-chip-x"
                      aria-label={t('settings.savedChatsRemove')}
                      title={t('settings.savedChatsRemove')}
                      onClick={() => removeSavedChat(id)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <label htmlFor="set-edit">{t('settings.editId')}</label>
          <input
            id="set-edit"
            type="text"
            value={editId}
            onChange={(event) => setEditId(event.target.value)}
            placeholder={t('settings.editIdPlaceholder')}
            autoComplete="off"
          />

          <label htmlFor="set-business">{t('settings.businessId')}</label>
          <input
            id="set-business"
            type="text"
            value={businessId}
            onChange={(event) => setBusinessId(event.target.value)}
            placeholder={t('settings.businessIdPlaceholder')}
            autoComplete="off"
          />
          <p className="sheet-note">{t('settings.businessIdHelp')}</p>

          <div className="sheet-section">{t('proxy.section')}</div>
          <p className="sheet-note">{t('proxy.help')}</p>

          <label htmlFor="set-proxy-mode">{t('proxy.mode')}</label>
          <select
            id="set-proxy-mode"
            value={proxy.mode}
            onChange={(event) => setProxy({ ...proxy, mode: event.target.value })}
          >
            <option value="system">{t('proxy.mode.system')}</option>
            <option value="manual">{t('proxy.mode.manual')}</option>
            <option value="direct">{t('proxy.mode.direct')}</option>
          </select>

          {proxy.mode === 'manual' && (
            <>
              <div className="sheet-row">
                <div className="sheet-field">
                  <label htmlFor="set-proxy-scheme">{t('proxy.scheme')}</label>
                  <select
                    id="set-proxy-scheme"
                    value={proxy.scheme}
                    onChange={(event) => setProxy({ ...proxy, scheme: event.target.value })}
                  >
                    <option value="socks5">SOCKS5</option>
                    <option value="socks4">SOCKS4</option>
                    <option value="http">HTTP</option>
                    <option value="https">HTTPS</option>
                  </select>
                </div>
                <div className="sheet-field">
                  <label htmlFor="set-proxy-host">{t('proxy.host')}</label>
                  <input
                    id="set-proxy-host"
                    type="text"
                    value={proxy.host}
                    placeholder="127.0.0.1"
                    onChange={(event) => setProxy({ ...proxy, host: event.target.value })}
                    autoComplete="off"
                  />
                </div>
                <div className="sheet-field sheet-field-port">
                  <label htmlFor="set-proxy-port">{t('proxy.port')}</label>
                  <input
                    id="set-proxy-port"
                    type="number"
                    value={proxy.port}
                    placeholder="10808"
                    onChange={(event) => setProxy({ ...proxy, port: event.target.value })}
                  />
                </div>
              </div>

              <div className="proxy-presets">
                <span>{t('proxy.presets')}</span>
                <button
                  type="button"
                  className="proxy-preset"
                  onClick={() => setProxy({ ...proxy, scheme: 'socks5', host: '127.0.0.1', port: 10808 })}
                >
                  v2rayN SOCKS5 · 10808
                </button>
                <button
                  type="button"
                  className="proxy-preset"
                  onClick={() => setProxy({ ...proxy, scheme: 'http', host: '127.0.0.1', port: 10809 })}
                >
                  v2rayN HTTP · 10809
                </button>
              </div>

              <div className="sheet-row">
                <div className="sheet-field">
                  <label htmlFor="set-proxy-user">{t('proxy.username')}</label>
                  <input
                    id="set-proxy-user"
                    type="text"
                    value={proxy.username}
                    onChange={(event) => setProxy({ ...proxy, username: event.target.value })}
                    autoComplete="off"
                  />
                </div>
                <div className="sheet-field">
                  <label htmlFor="set-proxy-pass">{t('proxy.password')}</label>
                  <input
                    id="set-proxy-pass"
                    type="password"
                    value={proxyPassword}
                    placeholder={proxy.hasPassword ? t('settings.tokenKeep') : ''}
                    onChange={(event) => setProxyPassword(event.target.value)}
                    autoComplete="off"
                  />
                </div>
              </div>
            </>
          )}

          <button
            type="button"
            className="dialog-btn"
            onClick={handleProxyTest}
            disabled={checkingProxy}
          >
            {checkingProxy ? t('proxy.checking') : t('proxy.check')}
          </button>
          {proxyStatus.text && <div className={`sheet-status ${proxyStatus.type}`}>{proxyStatus.text}</div>}

          <div className="sheet-section">{t('settings.appearance')}</div>

          <div className="sheet-row">
            <div className="sheet-field">
              <label htmlFor="set-lang">{t('settings.language')}</label>
              <select
                id="set-lang"
                value={lang}
                onChange={(event) => onLangChange(event.target.value)}
              >
                <option value="en">English</option>
                <option value="fa">فارسی</option>
              </select>
            </div>
            <div className="sheet-field">
              <span className="sheet-label" id="theme-label">
                {t('settings.theme')}
              </span>
              <div
                className="theme-picker"
                role="radiogroup"
                aria-labelledby="theme-label"
              >
                {THEME_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={id === theme}
                    className={`theme-card${id === theme ? ' active' : ''}`}
                    onClick={() => onThemeChange(id)}
                  >
                    <ThemeCard id={id} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {status.text && <div className={`sheet-status ${status.type}`}>{status.text}</div>}

          <p className="sheet-note">{t('settings.security')}</p>

          <div className="sheet-actions">
            <button type="button" className="dialog-btn" onClick={handleTest} disabled={testing}>
              {testing ? t('settings.testing') : t('settings.testConnection')}
            </button>
            <button
              type="button"
              className="dialog-btn primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? t('settings.saving') : t('settings.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
