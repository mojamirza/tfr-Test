/**
 * ScheduleSheet — the local scheduler queue.
 *
 * The Bot API carries no server-side scheduling for bots, so entries in
 * this list are held locally — with their exact pre-computed request
 * steps — and the app fires each at its due moment while it runs. The
 * sheet lists what is waiting and lets an entry be sent early or dropped.
 *
 * @module components/ScheduleSheet
 */

import { useDialogs } from './Dialog.jsx';
import { ClockIcon, CloseIcon, SendIcon, TrashIcon } from './Icons.jsx';
import { useI18n } from '../i18n/index.js';

/**
 * Format a due timestamp as a local, short date-time.
 * @param {number} at Unix seconds.
 * @returns {string}
 */
function stamp(at) {
  if (!at) return '';
  const date = new Date(at * 1000);
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
 *   schedules: Array<{ id: string, at: number, chatId: string, label: string }>,
 *   onSendNow: (entry: object) => void,
 *   onRemove: (entry: object) => void,
 * }} props
 */
export default function ScheduleSheet({ open, onClose, schedules, onSendNow, onRemove }) {
  const { t } = useI18n();
  const { confirm } = useDialogs();

  if (!open) return null;

  const remove = async (entry) => {
    const ok = await confirm({
      titleKey: 'schedule.deleteTitle',
      bodyKey: 'schedule.deleteBody',
      confirmKey: 'schedule.deleteConfirm',
      danger: true,
    });
    if (ok) onRemove(entry);
  };

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-head">
          <h3>{t('schedule.title')}</h3>
          <button type="button" className="sheet-close" onClick={onClose} aria-label={t('window.close')}>
            <CloseIcon />
          </button>
        </div>

        <div className="sheet-body">
          <p className="sheet-note">{t('schedule.note')}</p>

          {schedules.length === 0 ? (
            <p className="drafts-empty">{t('schedule.empty')}</p>
          ) : (
            <ul className="sched-list">
              {schedules.map((entry) => (
                <li key={entry.id} className="sched-item">
                  <span className="sched-open" title={t('schedule.hint')}>
                    <ClockIcon size={18} />
                    <span className="sched-text">
                      <span className="sched-when">{stamp(entry.at)}</span>
                      <span className="sched-meta">
                        {entry.chatId}
                        {entry.label ? ` · ${entry.label}` : ''}
                      </span>
                    </span>
                  </span>
                  <button
                    type="button"
                    className="sched-fire"
                    title={t('schedule.fireTitle')}
                    aria-label={t('schedule.fireTitle')}
                    onClick={() => onSendNow(entry)}
                  >
                    <SendIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="sched-remove"
                    title={t('schedule.remove')}
                    aria-label={t('schedule.remove')}
                    onClick={() => remove(entry)}
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
