/**
 * TableBubble — the floating bar that appears while the caret sits inside a
 * table. Four reshaping gestures as quiet icons, one Layout popover for the
 * per-cell and per-table styling, and one danger action:
 *
 *     [ +row −row │ +column −column │ ⊞ layout ▾ │ 🗑 ]
 *
 * Column widths are dragged directly on the table borders (the Table
 * extension is configured with `resizable`). The Layout popover is two
 * sections: the CELL half sets per-cell `align`/`valign` with one segmented
 * control per axis, and the TABLE half carries the table options Rich HTML
 * documents on the `<table>` tag — `striped`, `compact` and the caption, as
 * real switches with the caption's current text shown on its row.
 *
 * @module components/TableBubble
 */

import { useEffect, useRef, useState } from 'react';
import { BubbleMenu } from '@tiptap/react';
import {
  AlignCellBottomIcon,
  AlignCellCenterIcon,
  AlignCellLeftIcon,
  AlignCellMiddleIcon,
  AlignCellRightIcon,
  AlignCellTopIcon,
  CellLayoutIcon,
  ColAddIcon,
  ColRemoveIcon,
  RowAddIcon,
  RowRemoveIcon,
  TrashIcon,
} from './Icons.jsx';
import { useI18n } from '../i18n/index.js';

const ALIGNS = ['left', 'center', 'right'];
const ALIGN_ICONS = [AlignCellLeftIcon, AlignCellCenterIcon, AlignCellRightIcon];

const VALIGNS = ['top', 'middle', 'bottom'];
const VALIGN_ICONS = [AlignCellTopIcon, AlignCellMiddleIcon, AlignCellBottomIcon];

/** The segment glyph of one alignment state. */
function AlignIcon({ index, vertical = false }) {
  const Icon = vertical ? VALIGN_ICONS[index] : ALIGN_ICONS[index];
  return <Icon size={16} />;
}

/**
 * One switch row of the table section — a real pill switch instead of a dot,
 * so on and off read at a glance.
 * @param {{
 *   label: string,
 *   on: boolean,
 *   onClick: () => void,
 * }} props
 */
function ToggleRow({ label, on, onClick }) {
  return (
    <button
      type="button"
      className="table-bubble-switch"
      data-on={on}
      aria-pressed={on}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <span className="table-bubble-switch-label">{label}</span>
      <span className="table-bubble-pill">
        <span className="table-bubble-knob" />
      </span>
    </button>
  );
}

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
            {/* The cell half: one segmented control per axis, with the active
                edge filled — much easier to read than unicode glyphs. */}
            <div className="table-bubble-label">{t('table.sectionCell')}</div>
            <div className="table-bubble-row">
              <span className="table-bubble-hint">{t('table.alignHoriz')}</span>
              <div className="table-bubble-seg" role="group" aria-label={t('table.cellAlign')}>
                {ALIGNS.map((value, index) => (
                  <button
                    key={value}
                    type="button"
                    className={`table-bubble-seg-btn${cellAlign === value ? ' active' : ''}`}
                    title={t(`table.align${value.charAt(0).toUpperCase()}${value.slice(1)}`)}
                    aria-label={t(`table.align${value.charAt(0).toUpperCase()}${value.slice(1)}`)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setCellAttr('align', cellAlign, value)}
                  >
                    <AlignIcon index={index} />
                  </button>
                ))}
              </div>
            </div>
            <div className="table-bubble-row">
              <span className="table-bubble-hint">{t('table.alignVert')}</span>
              <div className="table-bubble-seg" role="group" aria-label={t('table.cellValign')}>
                {VALIGNS.map((value, index) => (
                  <button
                    key={value}
                    type="button"
                    className={`table-bubble-seg-btn${cellValign === value ? ' active' : ''}`}
                    title={t(`table.valign${value.charAt(0).toUpperCase()}${value.slice(1)}`)}
                    aria-label={t(`table.valign${value.charAt(0).toUpperCase()}${value.slice(1)}`)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setCellAttr('valign', cellValign, value)}
                  >
                    <AlignIcon vertical index={index} />
                  </button>
                ))}
              </div>
            </div>

            {/* The table half: real switches with the caption's current text. */}
            <div className="table-bubble-label">{t('table.sectionTable')}</div>
            <div className="table-bubble-toggles">
              <ToggleRow
                label={t('table.striped')}
                on={!!table.striped}
                onClick={() => editor.chain().focus().toggleTableStriped().run()}
              />
              <ToggleRow
                label={t('table.compact')}
                on={!!table.compact}
                onClick={() => editor.chain().focus().toggleTableCompact().run()}
              />
              <button
                type="button"
                className="table-bubble-caption"
                data-on={!!table.caption}
                title={table.caption || ''}
                onMouseDown={(event) => event.preventDefault()}
                onClick={askCaption}
              >
                <span className="table-bubble-switch-label">{t('table.caption')}</span>
                <span className="table-bubble-caption-text">
                  {table.caption || t('table.captionNone')}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </BubbleMenu>
  );
}
