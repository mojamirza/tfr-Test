/**
 * Toolbar — the rounded strip above the editor, four labelled groups:
 *
 *   Text      ( ↶ )( ↷ ) | ( Aa )( B )( 🔗 )
 *   Blocks    ( list )( table )( Σ )( collage )
 *   Media     ( 🖼 )
 *   Publish   ( ⊞ )( ⊗ inline )( ➤ publish options )
 *
 * Four captions instead of a wall of icons: writing lives in Text, structure
 * in Blocks, files and locations in Media, and the send-time interactive
 * layer (button rows, inline chips, the publish sheet) in Publish. The
 * long-tail inserts — @mention, custom emoji, date-time, thinking — stay in
 * the wand's palette, which the composer keeps one click away.
 *
 * Aa, B, list and media open a vertical menu; the rest act straight away.
 *
 * @module components/Toolbar
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import ActionMenu from './ActionMenu.jsx';
import Popover from './Popover.jsx';
import {
  BoldIcon,
  BulletListIcon,
  FormulaIcon,
  ImageIcon,
  LinkIcon,
  RedoIcon,
  SendIcon,
  TableIcon,
  TextStyleIcon,
  UndoIcon,
} from './Icons.jsx';
import {
  FORMAT_ACTIONS,
  LIST_ACTIONS,
  MEDIA_ACTIONS,
  PREMIUM_ACTIONS,
  TEXT_STYLE_ACTIONS,
  EXTRA_ACTIONS,
  insertFormula,
  insertLink,
  insertTable,
} from '../lib/editor-actions.js';
import { useI18n } from '../i18n/index.js';

/**
 * Palette features that get a visible toolbar button, by group. They are
 * drawn from the palette's own action records, so the toolbar and the wand
 * share one code path — label, icon, active state and run are all the same
 * registry entry.
 */
const GROUP_INSERTS = {
  blocks: ['collage'],
  publish: ['buttons', 'inlineButton'],
};

/**
 * A single outlined toolbar pill.
 * @param {{
 *   icon: Function,
 *   label: string,
 *   onClick: (event: React.MouseEvent) => void,
 *   active?: boolean,
 *   disabled?: boolean,
 *   wide?: boolean,
 *   buttonRef?: React.Ref<HTMLButtonElement>,
 * }} props
 */
function TbButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  disabled = false,
  wide = false,
  buttonRef,
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`tb-btn${wide ? ' wide' : ''}${active ? ' active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      <Icon size={20} />
    </button>
  );
}

/**
 * One labelled cluster of buttons — the caption sits above the row so the
 * groups read as areas, not as a stream of glyphs.
 * @param {{ label: string, children: React.ReactNode }} props
 */
function TbGroup({ label, children }) {
  return (
    <div className="tb-group">
      <span className="tb-group-label">{label}</span>
      <div className="tb-group-buttons">{children}</div>
    </div>
  );
}

/**
 * @param {{ editor: object|null, ctx: object, onPublishOptions: () => void }} props
 */
export default function Toolbar({ editor, ctx, onPublishOptions }) {
  const { t } = useI18n();
  const [menu, setMenu] = useState(null);
  const formattingRef = useRef(null);
  const styleRef = useRef(null);
  const listRef = useRef(null);
  const mediaRef = useRef(null);

  const close = useCallback(() => setMenu(null), []);
  const toggle = useCallback((id) => setMenu((prev) => (prev === id ? null : id)), []);

  /** Run a menu action, closing the menu first. */
  const run = useCallback(
    (action) => {
      close();
      if (!editor) return;
      Promise.resolve(action.run(editor, ctx)).catch((e) => {
        // The toast is for the author; the console line is for the bug
        // report — a wiring typo must not hide as a bare "network error".
        console.error('[Action]', action.id || action.i18nKey, e);
        ctx.notify('toast.networkError', 'error');
      });
    },
    [editor, ctx, close],
  );

  /** Run a direct (menu-less) toolbar command. */
  const direct = useCallback(
    (fn) => {
      close();
      if (!editor) return;
      Promise.resolve(fn(editor, ctx)).catch(() => ctx.notify('toast.networkError', 'error'));
    },
    [editor, ctx, close],
  );

  const menus = [
    { id: 'formatting', actions: TEXT_STYLE_ACTIONS, anchor: formattingRef, align: 'start' },
    { id: 'style', actions: FORMAT_ACTIONS, anchor: styleRef, align: 'start' },
    { id: 'list', actions: LIST_ACTIONS, anchor: listRef, align: 'start' },
    { id: 'media', actions: MEDIA_ACTIONS, anchor: mediaRef, align: 'center' },
  ];

  /** The palette features with a visible button, resolved once. */
  const inserts = useMemo(() => {
    const all = [...PREMIUM_ACTIONS, ...EXTRA_ACTIONS];
    return GROUP_INSERTS.publish
      .concat(GROUP_INSERTS.blocks)
      .map((id) => all.find((action) => action.id === id))
      .filter(Boolean);
  }, []);

  const insertById = useMemo(
    () => Object.fromEntries(inserts.map((action) => [action.id, action])),
    [inserts],
  );

  const canUndo = !!editor && editor.can().undo();
  const canRedo = !!editor && editor.can().redo();

  /** The registry insert button for one palette feature. */
  const insertButton = (id) => {
    const action = insertById[id];
    if (!action) return null;
    return (
      <TbButton
        key={action.id}
        icon={action.icon}
        label={t(action.i18nKey)}
        active={!!editor && !!action.isActive && action.isActive(editor)}
        disabled={!!editor && !!action.enabled && !action.enabled(editor)}
        onClick={() => run(action)}
      />
    );
  };

  return (
    <div className="tfr-toolbar">
      <TbGroup label={t('toolbar.groupText')}>
        <TbButton
          icon={UndoIcon}
          label={t('toolbar.undo')}
          disabled={!canUndo}
          onClick={() => editor && editor.chain().focus().undo().run()}
        />
        <TbButton
          icon={RedoIcon}
          label={t('toolbar.redo')}
          disabled={!canRedo}
          onClick={() => editor && editor.chain().focus().redo().run()}
        />
        <TbButton
          buttonRef={formattingRef}
          icon={TextStyleIcon}
          label={t('toolbar.formatting')}
          wide
          active={menu === 'formatting'}
          onClick={() => toggle('formatting')}
        />
        <TbButton
          buttonRef={styleRef}
          icon={BoldIcon}
          label={t('toolbar.textStyle')}
          active={menu === 'style'}
          onClick={() => toggle('style')}
        />
        <TbButton
          icon={LinkIcon}
          label={t('toolbar.link')}
          active={!!editor && editor.isActive('link')}
          onClick={() => direct(insertLink)}
        />
      </TbGroup>

      <span className="tb-sep" />

      <TbGroup label={t('toolbar.groupBlocks')}>
        <TbButton
          buttonRef={listRef}
          icon={BulletListIcon}
          label={t('toolbar.lists')}
          active={menu === 'list'}
          onClick={() => toggle('list')}
        />
        <TbButton
          icon={TableIcon}
          label={t('toolbar.table')}
          active={!!editor && editor.isActive('table')}
          onClick={() => direct(insertTable)}
        />
        <TbButton
          icon={FormulaIcon}
          label={t('toolbar.formula')}
          onClick={() => direct(insertFormula)}
        />
        {insertButton('collage')}
      </TbGroup>

      <span className="tb-sep" />

      <TbGroup label={t('toolbar.groupMedia')}>
        <TbButton
          buttonRef={mediaRef}
          icon={ImageIcon}
          label={t('toolbar.media')}
          active={menu === 'media'}
          onClick={() => toggle('media')}
        />
      </TbGroup>

      <span className="tb-sep" />

      <TbGroup label={t('toolbar.groupPublish')}>
        {insertButton('buttons')}
        {insertButton('inlineButton')}
        <TbButton
          icon={SendIcon}
          label={t('send.publishOptions')}
          onClick={onPublishOptions}
        />
      </TbGroup>

      {menus.map((config) => (
        <Popover
          key={config.id}
          open={menu === config.id}
          anchorEl={config.anchor.current}
          align={config.align}
          onClose={close}
        >
          <ActionMenu actions={config.actions} editor={editor} ctx={ctx} onRun={run} />
        </Popover>
      ))}
    </div>
  );
}
