/**
 * Inspector — the right-side "article inspector": everything a Telegram
 * message is made of, seen while you write.
 *
 *   Outline    the blocks in order (headings, quotes, media, buttons…)
 *   Counts     the documented limits, live: characters, blocks, media, and
 *              the nesting depth Telegram caps at 16 levels
 *   Notes      the capability warnings a send would raise
 *   Preview    the exact Rich HTML that would go on the wire, or the
 *              serialized request body
 *
 * @module components/Inspector
 */

import { useMemo, useState } from 'react';
import { BlockType } from '../../shared/block-types.js';
import { parseAllBlocks } from '../../shared/block-parser.js';
import {
  buildRichMessageBody,
  checkNestingDepth,
  LIMITS,
  serializeEditorHtml,
} from '../../shared/html-serializer.js';
import { collectSendIssues } from '../lib/send-analysis.js';
import { CloseIcon } from './Icons.jsx';
import { useI18n } from '../i18n/index.js';

/** One-letter outline labels, keyed by block type; unknown types fall back. */
const OUTLINE_KEYS = {
  [BlockType.PARAGRAPH]: 'block.text',
  [BlockType.CODE_BLOCK]: 'block.codeBlock',
  [BlockType.BLOCKQUOTE]: 'block.blockquote',
  [BlockType.PULLQUOTE]: 'block.pullquote',
  [BlockType.DETAILS]: 'block.details',
  [BlockType.FOOTER]: 'block.footer',
  [BlockType.DIVIDER]: 'block.divider',
  [BlockType.LIST]: 'block.orderedList',
  [BlockType.TABLE]: 'table.insert',
  [BlockType.SLIDESHOW]: 'gallery.slideshow',
  [BlockType.COLLAGE]: 'media.collage',
  [BlockType.MAP]: 'media.location',
  [BlockType.BUTTONS]: 'premium.buttons',
  [BlockType.THINKING]: 'premium.thinking',
};

/** A heading block reports its real level, but the outline keys stay clean. */

/**
 * The first words of a block — enough to recognise it in the outline.
 * @param {object} block
 * @returns {string}
 */
function blockTitleOf(block) {
  const text =
    block.summary ||
    block.text ||
    block.caption ||
    block.content ||
    (Array.isArray(block.items) && (block.items[0] || {}).text) ||
    (block.blocks && block.blocks.length && block.blocks[0].text) ||
    '';
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 30);
}

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   editorHtml: string,
 *   sendParams: object,
 * }} props
 */
export default function Inspector({ open, onClose, editorHtml, sendParams }) {
  const { t } = useI18n();
  const [tab, setTab] = useState('outline');

  const analysis = useMemo(() => {
    if (!open) return null;
    try {
      const message = serializeEditorHtml(editorHtml);
      const nesting = checkNestingDepth(message.html);
      const doc = new DOMParser().parseFromString(`<body>${message.html}</body>`, 'text/html');
      const outline = parseAllBlocks(doc.body).map((block, index) => {
        const key = OUTLINE_KEYS[block.type];
        return {
          // Reconciliation key: index plus the first text — enough uniqueness
          // for a static list.
          id: `${block.type}-${index}`,
          type: block.type,
          label: key ? t(key) : block.type,
          text: blockTitleOf(block),
        };
      });
      const issues = collectSendIssues({
        html: message.html,
        chatId: sendParams.chatId,
        mode: sendParams.mode,
      });
      let request = '';
      try {
        const body = buildRichMessageBody(message.html, sendParams.chatId || '', {
          sendParams: sendParams.publish,
        });
        request = JSON.stringify(body, null, 2);
      } catch {
        request = '';
      }
      return { message, nesting, outline, issues, request };
    } catch {
      return {
        message: { html: '', chars: 0, blocks: 0, media: 0 },
        nesting: { depth: 0, ok: true },
        outline: [],
        issues: [],
        request: '',
      };
    }
  }, [open, editorHtml, sendParams, t]);

  if (!open) return null;

  const stats = analysis.message;

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <span className="inspector-title">{t('inspector.title')}</span>
        <button
          type="button"
          className="inspector-close"
          title={t('inspector.close')}
          aria-label={t('inspector.close')}
          onClick={onClose}
        >
          <CloseIcon size={14} />
        </button>
      </div>

      <div className="inspector-tabs" role="tablist">
        {[
          ['outline', 'inspector.outline'],
          ['request', 'inspector.request'],
        ].map(([id, key]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`inspector-tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {tab === 'outline' && (
        <>
          <div className="inspector-stats">
            <span className="inspector-stat" title={t('inspector.chars')}>
              {stats.chars.toLocaleString()}
              <small>/{LIMITS.CHARS.toLocaleString()}</small>
            </span>
            <span className="inspector-stat" title={t('inspector.blocks')}>
              {stats.blocks}
              <small>/{LIMITS.BLOCKS}</small>
            </span>
            <span className="inspector-stat" title={t('inspector.mediaCount')}>
              {stats.media}
              <small>/{LIMITS.MEDIA}</small>
            </span>
            <span
              className={`inspector-stat${analysis.nesting.ok ? '' : ' bad'}`}
              title={t('inspector.depth')}
            >
              {analysis.nesting.depth}
              <small>/{LIMITS.NESTING}</small>
            </span>
          </div>

          {analysis.outline.length ? (
            <ul className="inspector-outline">
              {analysis.outline.map((item) => (
                <li key={item.id} className="inspector-line">
                  <code>{item.label}</code>
                  {item.text && <span className="inspector-line-text">{item.text}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="inspector-empty">{t('inspector.empty')}</p>
          )}

          <p className="inspector-notes-title">{t('inspector.notes')}</p>
          {analysis.issues.length ? (
            <ul className="inspector-notes" dir="auto">
              {analysis.issues.map((issue) => (
                <li key={issue.key}>{t(issue.key)}</li>
              ))}
            </ul>
          ) : (
            <p className="inspector-notes-empty">{t('inspector.noNotes')}</p>
          )}
        </>
      )}

      {tab === 'request' && (
        <div className="inspector-preview-pane">
          <pre className="inspector-preview" wrap="soft">{analysis.request || '—'}</pre>
        </div>
      )}
    </aside>
  );
}
