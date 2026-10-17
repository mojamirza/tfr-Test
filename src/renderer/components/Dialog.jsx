/**
 * Dialog — promise-based panels replacing the browser `prompt()` / `confirm()`
 * (blocked in Electron and visually foreign).
 *
 * Four kinds:
 *   askText({ titleKey, placeholder|placeholderKey, value }) → Promise<string|null>
 *   askLink({ text, url })                     → Promise<{text, url}|null>
 *   askButtons({ align, buttons })             → Promise<{align, buttons}|null>
 *   askInlineButton({ …button, existing })     → Promise<button|null|{removed:true}>
 *   confirm({ titleKey, bodyKey, confirmKey }) → Promise<boolean>
 *
 * @module components/Dialog
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { BUTTON_KINDS, BUTTON_STYLES } from '../../shared/html-serializer.js';
import { useI18n } from '../i18n/index.js';

const DialogContext = createContext(null);

/**
 * Access the dialog helpers.
 * @returns {{
 *   askText: (opts?: object) => Promise<string|null>,
 *   askLink: (opts?: object) => Promise<{text: string, url: string}|null>,
 *   askButtons: (opts?: object) => Promise<{align: string, buttons: object[]}|null>,
 *   confirm: (opts?: object) => Promise<boolean>,
 * }}
 */
export function useDialogs() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialogs must be used within DialogProvider');
  return ctx;
}

/** A blank row in the buttons editor. */
const BLANK_ROW = Object.freeze({
  type: 'url',
  style: '',
  label: '',
  value: '',
  forwardText: '',
  requestWriteAccess: false,
  allowUserChats: false,
  allowBotChats: false,
  allowGroupChats: false,
  allowChannelChats: false,
});

/** The value field each button kind needs, for placeholder/localisation keys. */
const KIND_VALUE_KEYS = {
  url: 'premium.btnValueUrl',
  web_app: 'premium.btnValueUrl',
  login_url: 'premium.btnValueUrl',
  callback_data: 'premium.btnValueData',
  switch_inline_query: 'premium.btnValueQuery',
  switch_inline_query_current_chat: 'premium.btnValueQuery',
  switch_inline_query_chosen_chat: 'premium.btnValueQuery',
  copy_text: 'premium.btnValueText',
  disabled: '',
};

/**
 * The per-button editor fields, shared by the button-row dialog and the
 * inline-button dialog: kind + label, the value the kind needs, the style
 * swatches and the kind-specific extras.
 * @param {{
 *   row: object,
 *   onPatch: (patch: object) => void,
 *   t: (key: string) => string,
 * }} props
 */
function ButtonRowFields({ row, onPatch, t }) {
  const valueKey = KIND_VALUE_KEYS[row.type];
  return (
    <>
      <div className="btn-row-grid">
        <select
          className="dialog-input"
          aria-label={t('premium.btnType')}
          value={row.type}
          onChange={(event) => onPatch({ type: event.target.value })}
        >
          {Object.keys(BUTTON_KINDS).map((kind) => (
            <option key={kind} value={kind}>
              {t(`premium.kind.${kind}`)}
            </option>
          ))}
        </select>
        <input
          className="dialog-input"
          type="text"
          aria-label={t('premium.btnLabel')}
          placeholder={t('premium.btnLabel')}
          value={row.label}
          onChange={(event) => onPatch({ label: event.target.value })}
        />
      </div>
      {valueKey && (
        <input
          className="dialog-input"
          type="text"
          aria-label={t(valueKey)}
          placeholder={t(valueKey)}
          value={row.value}
          onChange={(event) => onPatch({ value: event.target.value })}
        />
      )}
      <div className="btn-row-swatches" role="group" aria-label={t('premium.btnStyle')}>
        <button
          type="button"
          className={`style-swatch${row.style === '' ? ' active' : ''}`}
          onClick={() => onPatch({ style: '' })}
        >
          <span className="swatch-dot" data-swatch="default" />
          {t('premium.styleDefault')}
        </button>
        {BUTTON_STYLES.map((style) => (
          <button
            key={style}
            type="button"
            className={`style-swatch${row.style === style ? ' active' : ''}`}
            onClick={() => onPatch({ style })}
          >
            <span className="swatch-dot" data-swatch={style} />
            {t(`premium.style.${style}`)}
          </button>
        ))}
      </div>
      <p className="style-note">{t('premium.linkStyleNote')}</p>
      {row.type === 'login_url' && (
        <input
          className="dialog-input"
          type="text"
          aria-label={t('premium.btnForwardText')}
          placeholder={t('premium.btnForwardText')}
          value={row.forwardText}
          onChange={(event) => onPatch({ forwardText: event.target.value })}
        />
      )}
      {row.type === 'login_url' && (
        <label className="btn-row-check">
          <input
            type="checkbox"
            checked={row.requestWriteAccess}
            onChange={(event) => onPatch({ requestWriteAccess: event.target.checked })}
          />
          {t('premium.btnWriteAccess')}
        </label>
      )}
      {row.type === 'switch_inline_query_chosen_chat' && (
        <div className="btn-row-checks">
          {[
            ['allowUserChats', 'premium.btnUserChats'],
            ['allowBotChats', 'premium.btnBotChats'],
            ['allowGroupChats', 'premium.btnGroupChats'],
            ['allowChannelChats', 'premium.btnChannelChats'],
          ].map(([flag, key]) => (
            <label className="btn-row-check" key={flag}>
              <input
                type="checkbox"
                checked={!!row[flag]}
                onChange={(event) => onPatch({ [flag]: event.target.checked })}
              />
              {t(key)}
            </label>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Provider rendering the active dialog.
 * @param {{ children: React.ReactNode }} props
 */
export function DialogProvider({ children }) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState(null);
  const [value, setValue] = useState('');
  const [linkText, setLinkText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [btnAlign, setBtnAlign] = useState('');
  const [btnRows, setBtnRows] = useState([]);
  const [btnSingle, setBtnSingle] = useState(null);
  const firstFieldRef = useRef(null);

  const askText = useCallback(
    (options = {}) =>
      new Promise((resolve) => {
        setValue(options.value || '');
        setDialog({ kind: 'text', options, resolve });
      }),
    [],
  );

  const askLink = useCallback(
    (options = {}) =>
      new Promise((resolve) => {
        setLinkText(options.text || '');
        setLinkUrl(options.url || '');
        setDialog({ kind: 'link', options, resolve });
      }),
    [],
  );

  const confirm = useCallback(
    (options = {}) =>
      new Promise((resolve) => {
        setDialog({ kind: 'confirm', options, resolve });
      }),
    [],
  );

  const askButtons = useCallback(
    (options = {}) =>
      new Promise((resolve) => {
        setBtnAlign(options.align || '');
        // Every stored field is preserved, so editing a row round-trips it.
        setBtnRows(
          (options.buttons || []).slice(0, 8).map((b) => ({ ...BLANK_ROW, ...b })),
        );
        setDialog({ kind: 'buttons', resolve });
      }),
    [],
  );

  const askInlineButton = useCallback(
    (options = {}) =>
      new Promise((resolve) => {
        // One button, the same fields a row editor shows — the picker for the
        // inline chip Telegram renders inside a paragraph (RichTextButton).
        setBtnSingle({ ...BLANK_ROW, ...(options || {}) });
        setDialog({ kind: 'inlineBtn', options, resolve });
      }),
    [],
  );

  const finish = useCallback(
    (result) => {
      if (dialog) dialog.resolve(result);
      setDialog(null);
      setValue('');
      setLinkText('');
      setLinkUrl('');
      setBtnRows([]);
      setBtnSingle(null);
    },
    [dialog],
  );

  /** The value a cancel/dismiss resolves to, per dialog kind. */
  const cancelled = dialog && dialog.kind === 'confirm' ? false : null;

  /** The value the confirm button resolves to, per dialog kind. */
  const accept = () => {
    if (!dialog) return;
    if (dialog.kind === 'confirm') finish(true);
    else if (dialog.kind === 'link') {
      if (!linkUrl.trim()) return;
      finish({ text: linkText, url: linkUrl });
    } else if (dialog.kind === 'buttons') {
      // Rows without a label are dropped, not sent as blank buttons.
      const buttons = btnRows
        .filter((row) => row.label.trim())
        .map((row) => ({
          type: row.type in BUTTON_KINDS ? row.type : 'url',
          style: row.style || '',
          label: row.label.trim(),
          value: row.value,
          forwardText: row.forwardText,
          requestWriteAccess: !!row.requestWriteAccess,
          allowUserChats: !!row.allowUserChats,
          allowBotChats: !!row.allowBotChats,
          allowGroupChats: !!row.allowGroupChats,
          allowChannelChats: !!row.allowChannelChats,
        }));
      finish({ align: btnAlign, buttons });
    } else if (dialog.kind === 'inlineBtn') {
      if (!btnSingle || !btnSingle.label.trim()) return;
      finish({
        type: btnSingle.type in BUTTON_KINDS ? btnSingle.type : 'url',
        style: btnSingle.style || '',
        label: btnSingle.label.trim(),
        value: btnSingle.value,
        forwardText: btnSingle.forwardText,
        requestWriteAccess: !!btnSingle.requestWriteAccess,
        allowUserChats: !!btnSingle.allowUserChats,
        allowBotChats: !!btnSingle.allowBotChats,
        allowGroupChats: !!btnSingle.allowGroupChats,
        allowChannelChats: !!btnSingle.allowChannelChats,
      });
    } else {
      // An empty field resolves to '', not null. `null` means "cancelled", and
      // the two are not the same answer: callers that edit an existing value —
      // a media caption, its credit, a quote's attribution — read `null` as
      // "leave it alone", so collapsing the two made those impossible to clear
      // once set. Callers that only want a new value still test for falsy and
      // are unaffected.
      finish(value);
    }
  };

  useEffect(() => {
    if (dialog && firstFieldRef.current) firstFieldRef.current.focus();
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(cancelled);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [dialog, finish, cancelled]);

  return (
    <DialogContext.Provider value={{ askText, askLink, askButtons, askInlineButton, confirm }}>
      {children}

      {dialog && (
        <div
          className="overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) finish(cancelled);
          }}
        >
          <div className={`dialog${dialog.kind === 'confirm' ? ' dialog-confirm' : ''}`}>
            <div className="dialog-title">
              {t(
                dialog.kind === 'link'
                  ? 'link.create'
                  : dialog.kind === 'buttons'
                    ? 'premium.buttons'
                    : dialog.kind === 'inlineBtn'
                      ? 'premium.inlineButton'
                      : dialog.options.titleKey || 'dialog.ok',
              )}
            </div>

            {dialog.kind === 'text' && (
              <input
                ref={firstFieldRef}
                className="dialog-input"
                type="text"
                value={value}
                placeholder={
                  dialog.options.placeholderKey
                    ? t(dialog.options.placeholderKey)
                    : dialog.options.placeholder || ''
                }
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && accept()}
              />
            )}

            {dialog.kind === 'link' && (
              <div className="dialog-fields">
                <label htmlFor="link-text">{t('link.text')}</label>
                <input
                  ref={firstFieldRef}
                  id="link-text"
                  className="dialog-input"
                  type="text"
                  value={linkText}
                  placeholder={t('link.textPlaceholder')}
                  onChange={(event) => setLinkText(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && accept()}
                />
                <label htmlFor="link-url">{t('link.url')}</label>
                <input
                  id="link-url"
                  className="dialog-input"
                  type="text"
                  value={linkUrl}
                  placeholder="https://t.me/…"
                  onChange={(event) => setLinkUrl(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && accept()}
                />
              </div>
            )}

            {dialog.kind === 'buttons' && (
              <div className="dialog-buttons">
                <div className="dialog-buttons-head">
                  <label htmlFor="btn-align">{t('premium.buttonsAlign')}</label>
                  <select
                    id="btn-align"
                    className="dialog-input"
                    value={btnAlign}
                    onChange={(event) => setBtnAlign(event.target.value)}
                  >
                    <option value="">{t('premium.alignDefault')}</option>
                    <option value="left">{t('premium.alignLeft')}</option>
                    <option value="center">{t('premium.alignCenter')}</option>
                    <option value="right">{t('premium.alignRight')}</option>
                  </select>
                </div>

                {btnRows.map((row, index) => {
                  const setValue = (patch) =>
                    setBtnRows((rows) =>
                      rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
                    );
                  return (
                    <div className="btn-row" key={index}>
                      <div className="btn-row-head">
                        <span
                          className="btn-row-preview"
                          data-style={row.style || ''}
                          title={t('premium.btnLabel')}
                        >
                          {row.label.trim() || t('premium.btnLabel')}
                        </span>
                        <span className="btn-row-flex" />
                        <button
                          type="button"
                          className="dialog-btn small"
                          onClick={() =>
                            setBtnRows((rows) => {
                              const next = [...rows];
                              next.splice(index + 1, 0, { ...BLANK_ROW, ...row, label: '' });
                              return next;
                            })
                          }
                        >
                          {t('premium.btnDuplicate')}
                        </button>
                        <button
                          type="button"
                          className="dialog-btn small danger"
                          onClick={() => setBtnRows((rows) => rows.filter((_, i) => i !== index))}
                        >
                          {t('premium.btnRemove')}
                        </button>
                      </div>
                      <ButtonRowFields row={row} onPatch={setValue} t={t} />
                    </div>
                  );
                })}

                <button
                  type="button"
                  className="dialog-btn block"
                  disabled={btnRows.length >= 8}
                  onClick={() => setBtnRows((rows) => [...rows, { ...BLANK_ROW }])}
                >
                  {t('premium.btnAdd')}
                </button>
              </div>
            )}

            {dialog.kind === 'inlineBtn' && btnSingle && (
              <div className="dialog-buttons">
                <div className="btn-row">
                  <div className="btn-row-head">
                    <span
                      className="btn-row-preview"
                      data-style={btnSingle.style || ''}
                      title={t('premium.btnLabel')}
                    >
                      {btnSingle.label.trim() || t('premium.btnLabel')}
                    </span>
                  </div>
                  <ButtonRowFields
                    row={btnSingle}
                    onPatch={(patch) =>
                      setBtnSingle((single) => (single ? { ...single, ...patch } : single))
                    }
                    t={t}
                  />
                </div>
                <p className="dialog-hint">{t('premium.inlineHint')}</p>
                {dialog.options.existing && (
                  <button
                    type="button"
                    className="dialog-btn block danger"
                    onClick={() => finish({ removed: true })}
                  >
                    {t('premium.btnRemove')}
                  </button>
                )}
              </div>
            )}

            {dialog.kind === 'confirm' && (
              <div className="dialog-body">{t(dialog.options.bodyKey || '')}</div>
            )}

            <div className="dialog-actions">
              <button type="button" className="dialog-btn" onClick={() => finish(cancelled)}>
                {t('dialog.cancel')}
              </button>
              <button
                type="button"
                className={`dialog-btn primary${dialog.options.danger ? ' danger' : ''}`}
                disabled={
                  (dialog.kind === 'link' && !linkUrl.trim()) ||
                  (dialog.kind === 'inlineBtn' && (!btnSingle || !btnSingle.label.trim()))
                }
                onClick={accept}
              >
                {t(
                  dialog.kind === 'link'
                    ? 'link.createBtn'
                    : dialog.options.confirmKey || 'dialog.ok',
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
