/**
 * PublishSheet — the dedicated publish sheet next to Send. sendRichMessage
 * carries a set of parameters the editor had no surface for: the forum topic,
 * the direct-messages topic, a reply target, silent and protect-content
 * toggles, a message effect, and the business connection.
 *
 * The sheet edits a plain `publish` object App.jsx owns; on send the fields
 * ride into the request body through `buildRichMessageBody`'s sendParams, and
 * the article inspector's Request tab shows the exact result.
 *
 * @module components/PublishSheet
 */

import { CloseIcon } from './Icons.jsx';
import { useI18n } from '../i18n/index.js';

/** The numeric fields of the sheet, in display order. */
const NUMBER_FIELDS = [
  ['messageThreadId', 'publish.topicId', 'publish.topicIdHelp'],
  ['directMessagesTopicId', 'publish.dmTopicId', 'publish.dmTopicIdHelp'],
  ['replyToMessageId', 'publish.replyTo', 'publish.replyToHelp'],
];

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   publish: object,
 *   onChange: (patch: object) => void,
 *   onReset: () => void,
 * }} props
 */
export default function PublishSheet({ open, onClose, publish, onChange, onReset }) {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet publish-sheet">
        <div className="sheet-head">
          <h3>{t('publish.title')}</h3>
          <button type="button" className="sheet-close" onClick={onClose} aria-label={t('inspector.close')}>
            <CloseIcon />
          </button>
        </div>

        <div className="sheet-body">
          <p className="sheet-note">{t('publish.appliedTo')}</p>

          {NUMBER_FIELDS.map(([field, labelKey, helpKey]) => (
            <div className="publish-field" key={field}>
              <label htmlFor={`publish-${field}`}>{t(labelKey)}</label>
              <input
                id={`publish-${field}`}
                className="dialog-input"
                type="text"
                inputMode="numeric"
                value={publish[field] || ''}
                placeholder={t('publish.idPlaceholder')}
                onChange={(event) => onChange({ [field]: event.target.value.replace(/[^\d]/g, '') })}
              />
              <p className="dialog-hint">{t(helpKey)}</p>
            </div>
          ))}

          <div className="publish-field">
            <label className="btn-row-check">
              <input
                type="checkbox"
                checked={!!publish.silent}
                onChange={(event) => onChange({ silent: event.target.checked })}
              />
              {t('publish.silent')}
            </label>
            <p className="dialog-hint">{t('publish.silentHelp')}</p>
          </div>

          <div className="publish-field">
            <label className="btn-row-check">
              <input
                type="checkbox"
                checked={!!publish.protectContent}
                onChange={(event) => onChange({ protectContent: event.target.checked })}
              />
              {t('publish.protect')}
            </label>
            <p className="dialog-hint">{t('publish.protectHelp')}</p>
          </div>

          <div className="publish-field">
            <label htmlFor="publish-effect">{t('publish.effect')}</label>
            <input
              id="publish-effect"
              className="dialog-input"
              type="text"
              value={publish.messageEffectId || ''}
              placeholder={t('publish.effectPlaceholder')}
              onChange={(event) => onChange({ messageEffectId: event.target.value })}
            />
            <p className="dialog-hint">{t('publish.effectHelp')}</p>
          </div>

          <div className="publish-field">
            <label htmlFor="publish-business">{t('publish.business')}</label>
            <input
              id="publish-business"
              className="dialog-input"
              type="text"
              value={publish.businessConnectionId || ''}
              placeholder={t('settings.businessIdPlaceholder')}
              onChange={(event) => onChange({ businessConnectionId: event.target.value })}
            />
            <p className="dialog-hint">{t('publish.businessHelp')}</p>
          </div>

          <div className="sheet-actions">
            <button type="button" className="dialog-btn" onClick={onReset}>
              {t('publish.reset')}
            </button>
            <button type="button" className="dialog-btn primary" onClick={onClose}>
              {t('dialog.ok')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
