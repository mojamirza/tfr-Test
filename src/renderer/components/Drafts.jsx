/**
 * Drafts — locally saved messages.
 *
 * "Draft" means two different things in this app, and the naming keeps them
 * apart: `sendRichMessageDraft` is Telegram's *server-side* draft (a send
 * mode), while this sheet is the **local** one — a message saved on disk with
 * its exact Rich HTML and RTL flag, loadable any time, on any launch.
 *
 * @module components/Drafts
 */

import { useDialogs } from './Dialog.jsx';
import { CloseIcon, FileIcon, TrashIcon } from './Icons.jsx';
import { useI18n } from '../i18n/index.js';

/**
 * Format a saved-at timestamp as a local, short date-time.
 * @param {number} ts
 * @returns {string}
 */
function stamp(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   drafts: Array<{ id: string, name: string, savedAt: number, isRtl: boolean }>,
 *   saving: boolean,
 *   onSave: () => void,
 *   onLoad: (draft: object) => void,
 *   onDelete: (draft: object) => void,
 * }} props
 */
export default function Drafts({ open, onClose, drafts, saving, onSave, onLoad, onDelete }) {
  const { t } = useI18n();
  const { confirm } = useDialogs();

  if (!open) return null;

  const remove = async (draft) => {
    const ok = await confirm({
      titleKey: 'drafts.deleteTitle',
      bodyKey: 'drafts.deleteBody',
      confirmKey: 'drafts.deleteConfirm',
      danger: true,
    });
    if (ok) onDelete(draft);
  };

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-head">
          <h3>{t('drafts.title')}</h3>
          <button type="button" className="sheet-close" onClick={onClose} aria-label={t('window.close')}>
            <CloseIcon />
          </button>
        </div>

        <div className="sheet-body">
          <p className="sheet-note">{t('drafts.help')}</p>

          <div className="sheet-actions">
            <button type="button" className="dialog-btn primary" disabled={saving} onClick={onSave}>
              {saving ? t('drafts.saving') : t('drafts.save')}
            </button>
          </div>

          {drafts.length === 0 ? (
            <p className="drafts-empty">{t('drafts.empty')}</p>
          ) : (
            <ul className="drafts-list">
              {drafts.map((draft) => (
                <li key={draft.id} className="drafts-item">
                  <button
                    type="button"
                    className="drafts-open"
                    title={t('drafts.open')}
                    onClick={() => onLoad(draft)}
                  >
                    <FileIcon size={18} />
                    <span className="drafts-name">{draft.name}</span>
                    <span className="drafts-meta">
                      {stamp(draft.savedAt)}
                      {draft.isRtl ? ` · RTL` : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="drafts-delete"
                    title={t('drafts.delete')}
                    aria-label={t('drafts.delete')}
                    onClick={() => remove(draft)}
                  >
                    <TrashIcon size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
