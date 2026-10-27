/**
 * TitleBar — frameless-window chrome: draggable strip, a connection dot with
 * settings/preview toggles on the leading side and the window controls on the
 * trailing side (hidden on macOS, where the native traffic lights are used).
 *
 * @module components/TitleBar
 */

import { useEffect, useState } from 'react';
import {
  CloseIcon,
  DraftsIcon,
  InspectorIcon,
  MaximizeIcon,
  MinimizeIcon,
  PreviewIcon,
  RestoreIcon,
  RtlIcon,
  SettingsIcon,
} from './Icons.jsx';
import { useI18n } from '../i18n/index.js';

/**
 * @param {{
 *   tokenSet: boolean,
 *   previewOpen: boolean,
 *   isRtl: boolean,
 *   draftsOpen: boolean,
 *   inspectorOpen: boolean,
 *   onToggleRtl: () => void,
 *   onTogglePreview: () => void,
 *   onToggleInspector: () => void,
 *   onOpenDrafts: () => void,
 *   onOpenSettings: () => void,
 * }} props
 */
export default function TitleBar({
  tokenSet,
  previewOpen,
  isRtl,
  draftsOpen,
  inspectorOpen,
  onToggleRtl,
  onTogglePreview,
  onToggleInspector,
  onOpenDrafts,
  onOpenSettings,
}) {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);
  const platform = (window.app && window.app.platform) || 'linux';
  // macOS traffic lights paint their own; Android has no window frame
  // either — the system owns minimize and close there.
  const showControls = platform !== 'darwin' && platform !== 'android';

  useEffect(() => {
    if (!window.app || !window.app.win) return undefined;
    let cancelled = false;
    window.app.win
      .isMaximized()
      .then((value) => {
        if (!cancelled) setMaximized(!!value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const win = (action) => async () => {
    if (!window.app || !window.app.win) return;
    if (action === 'maximize') {
      const next = await window.app.win.toggleMaximize();
      setMaximized(!!next);
      return;
    }
    window.app.win[action]();
  };

  return (
    <div className="titlebar">
      <div className="titlebar-lead">
        <button
          type="button"
          className="tl-btn"
          title={`${t('titlebar.settings')} — ${
            tokenSet ? t('titlebar.connected') : t('titlebar.notConfigured')
          }`}
          aria-label={t('titlebar.settings')}
          onClick={onOpenSettings}
        >
          <SettingsIcon size={15} />
          <span className={`tl-dot${tokenSet ? ' on' : ''}`} />
        </button>
        <button
          type="button"
          className={`tl-btn${previewOpen ? ' active' : ''}`}
          title={t('titlebar.preview')}
          aria-label={t('titlebar.preview')}
          onClick={onTogglePreview}
        >
          <PreviewIcon size={15} />
        </button>
        <button
          type="button"
          className={`tl-btn${inspectorOpen ? ' active' : ''}`}
          title={t('titlebar.inspector')}
          aria-label={t('titlebar.inspector')}
          onClick={onToggleInspector}
        >
          <InspectorIcon size={15} />
        </button>
        <button
          type="button"
          className={`tl-btn${draftsOpen ? ' active' : ''}`}
          title={t('drafts.title')}
          aria-label={t('drafts.title')}
          onClick={onOpenDrafts}
        >
          <DraftsIcon size={15} />
        </button>
        <button
          type="button"
          className={`tl-btn${isRtl ? ' active' : ''}`}
          title={t('block.rtl')}
          aria-label={t('block.rtl')}
          onClick={onToggleRtl}
        >
          <RtlIcon size={15} />
        </button>
      </div>

      <div className="titlebar-drag" />

      {showControls && (
        <div className="titlebar-controls">
          <button
            type="button"
            className="win-btn"
            title={t('window.minimize')}
            aria-label={t('window.minimize')}
            onClick={win('minimize')}
          >
            <MinimizeIcon />
          </button>
          <button
            type="button"
            className="win-btn"
            title={maximized ? t('window.restore') : t('window.maximize')}
            aria-label={maximized ? t('window.restore') : t('window.maximize')}
            onClick={win('maximize')}
          >
            {maximized ? <RestoreIcon /> : <MaximizeIcon />}
          </button>
          <button
            type="button"
            className="win-btn close"
            title={t('window.close')}
            aria-label={t('window.close')}
            onClick={win('close')}
          >
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  );
}
