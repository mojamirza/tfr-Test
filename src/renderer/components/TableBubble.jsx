/**
 * TableBubble — the floating bar that appears while the caret sits inside a
 * table. Four reshaping gestures as quiet icons, one Layout popover for the
 * per-cell and per-table styling, and one danger action:
 *
 *     [ +row −row │ +column −column │ ⊞ layout ▾ │ 🗑 ]
 *
 * Column widths are dragged directly on the table borders (the Table
 * extension is configured with `resizable`). The Layout popover carries the
 * table options Rich HTML documents on the `<table>` tag: per-cell
 * `align`/`valign`, the `striped` and `compact` toggles, and its caption.
 *
 * @module components/TableBubble
 */

import { useEffect, useRef, useState } from 'react';
import { BubbleMenu } from '@tiptap/react';
import {
  CellLayoutIcon,
  ColAddIcon,
  ColRemoveIcon,
  RowAddIcon,
  RowRemoveIcon,
  TrashIcon,
} from './Icons.jsx';
import { useI18n } from '../i18n/index.js';

const ALIGNS = ['left', 'center', 'right'];
const ALIGN_LABEL = { left: '◧', center: '▣', right: '◨' };

const VALIGNS = ['top', 'middle', 'bottom'];
const VALIGN_LABEL = { top: '⌃', middle: '⎯', bottom: '⌄' };

/** One quiet icon button of the bar. */
function BubbleBtn({ icon, title, onClick, active = false, disabled = false, danger = false }) {
  return (
    <button
      type="button"
      className={`table-bubble-icon${active ? ' active' : ''}${danger ? ' danger' : ''}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

/**
 * The shape of the table under the caret — the minus buttons turn grey when
 * the table is already as small as it can be.
 * @param {object} editor
 * @returns {{ rows: number, cols: number }|null}
 */
function tableShape(editor) {
  const $from = editor.state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'table') {
      const rows = node.childCount;
      return { rows, cols: rows ? (node.firstChild ? node.firstChild.childCount : 0) : 0 };
    }
  }
  return null;
}

/**
 * @param {{ editor: object|null, ctx: object }} props
 */
export default function TableBubble({ editor, ctx }) {
  const { t } = useI18n();
  const [layoutOpen, setLayoutOpen] = useState(false);
  const popRef = useRef(null);

  useEffect(() => {
    if (!layoutOpen) return undefined;
    const onDown = (event) => {
      if (popRef.current && !popRef.current.contains(event.target)) setLayoutOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [layoutOpen]);

  if (!editor) return null;

  const run = (fn) => () => {
    setLayoutOpen(false);
    fn(editor.chain().focus()).run();
  };

  const attrs = (name) => editor.getAttributes(name) || {};

  const cellAlign = attrs('tableHeader').align || attrs('tableCell').align || '';
  const cellValign = attrs('tableHeader').valign || attrs('tableCell').valign || '';
  const table = attrs('table');
  const shape = tableShape(editor);

  const addRow = run((c) => c.addRowAfter());
  const removeRow = run((c) => c.deleteRow());
  const addCol = run((c) => c.addColumnAfter());
  const removeCol = run((c) => c.deleteColumn());
  const deleteTable = run((c) => c.deleteTable());

  /**
   * The caption travels in a `data-caption` attribute, so it is asked for with
   * the app dialog rather than edited in place.
   */
  const askCaption = async () => {
    setLayoutOpen(false);
    const caption = await ctx.askText({
      titleKey: 'table.caption',
      placeholderKey: 'dialog.captionPlaceholder',
      value: table.caption || '',
    });
    if (caption === null) return;
    editor.chain().focus().setTableCaption(caption.trim()).run();
  };

  const setCellAttr = (attr, current, value) =>
    run((c) => (attr === 'align' ? c.setCellAlign(current === value ? '' : value)
      : c.setCellValign(current === value ? '' : value)))();

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableBubble"
      shouldShow={({ editor: ed }) => ed.isActive('table')}
      tippyOptions={{ placement: 'top', duration: 120 }}
    >
      <div className="table-bubble">
        <BubbleBtn icon={<RowAddIcon />} title={t('table.addRow')} onClick={addRow} />
        <BubbleBtn
          icon={<RowRemoveIcon />}
          title={t('table.deleteRow')}
          onClick={removeRow}
          disabled={!shape || shape.rows <= 1}
        />
        <span className="table-bubble-sep" />
        <BubbleBtn icon={<ColAddIcon />} title={t('table.addColumn')} onClick={addCol} />
        <BubbleBtn
          icon={<ColRemoveIcon />}
          title={t('table.deleteColumn')}
          onClick={removeCol}
          disabled={!shape || shape.cols <= 1}
        />
        <span className="table-bubble-sep" />
        <BubbleBtn
          icon={<CellLayoutIcon />}
          title={t('table.layout')}
          onClick={() => setLayoutOpen((open) => !open)}
          active={layoutOpen}
        />
        <span className="table-bubble-sep" />
        <BubbleBtn icon={<TrashIcon />} title={t('table.delete')} onClick={deleteTable} danger />

        {layoutOpen && (
          <div className="table-bubble-pop" ref={popRef}>
            <div className="table-bubble-label">{t('table.cellAlign')}</div>
            <div className="table-bubble-grid" role="group" aria-label={t('table.cellAlign')}>
              {ALIGNS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`table-bubble-icon${cellAlign === value ? ' active' : ''}`}
                  title={t(`table.align${value.charAt(0).toUpperCase()}${value.slice(1)}`)}
                  aria-label={t(`table.align${value.charAt(0).toUpperCase()}${value.slice(1)}`)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setCellAttr('align', cellAlign, value)}
                >
                  {ALIGN_LABEL[value]}
                </button>
              ))}
              {VALIGNS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`table-bubble-icon${cellValign === value ? ' active' : ''}`}
                  title={t(`table.valign${value.charAt(0).toUpperCase()}${value.slice(1)}`)}
                  aria-label={t(`table.valign${value.charAt(0).toUpperCase()}${value.slice(1)}`)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setCellAttr('valign', cellValign, value)}
                >
                  {VALIGN_LABEL[value]}
                </button>
              ))}
            </div>
            <div className="table-bubble-opts">
              <button
                type="button"
                className={`table-bubble-toggle${table.striped ? ' active' : ''}`}
                onClick={run((c) => c.toggleTableStriped())}
              >
                <span className="table-bubble-dot" data-on={!!table.striped} />
                {t('table.striped')}
              </button>
              <button
                type="button"
                className={`table-bubble-toggle${table.compact ? ' active' : ''}`}
                onClick={run((c) => c.toggleTableCompact())}
              >
                <span className="table-bubble-dot" data-on={!!table.compact} />
                {t('table.compact')}
              </button>
              <button
                type="button"
                className={`table-bubble-toggle${table.caption ? ' active' : ''}`}
                onClick={askCaption}
              >
                <span className="table-bubble-dot" data-on={!!table.caption} />
                {t('table.caption')}
              </button>
            </div>
          </div>
        )}
      </div>
    </BubbleMenu>
  );
}
