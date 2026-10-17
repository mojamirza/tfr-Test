/**
 * Editor action registry — the single source of truth for every command the UI
 * can run. The seven toolbar menus, the table bubble menu and the insert palette
 * all read from this file, so a feature is declared exactly once.
 *
 * Every action is a plain object:
 *   id       unique key, also used as the React key
 *   i18nKey  translation key for the visible label
 *   icon     component from ./components/Icons.jsx
 *   children optional sub-list (renders as a second menu level, e.g. Heading)
 *   run      (editor, ctx) => void | Promise<void>
 *   isActive (editor) => boolean — optional, drives the checkmark/active state
 *   enabled  (editor) => boolean — optional, greys the item out
 *   hint     optional shortcut string shown right-aligned in menus
 *
 * `ctx` is supplied by App.jsx and provides UI services the pure registry must
 * not own: { askText, askLink, notify }.
 *
 * @module lib/editor-actions
 */

import {
  AnchorIcon,
  AudioIcon,
  BoldIcon,
  BulletListIcon,
  ButtonsIcon,
  ChecklistIcon,
  ClearFormatIcon,
  ClockIcon,
  CodeBlockIcon,
  CodeIcon,
  CollageIcon,
  DetailsIcon,
  DividerIcon,
  FileIcon,
  FooterIcon,
  FormulaIcon,
  HeadingIcon,
  HighlightIcon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  MapIcon,
  MathInlineIcon,
  MentionIcon,
  OrderedListIcon,
  ParagraphIcon,
  PullQuoteIcon,
  QuoteIcon,
  SmileyIcon,
  SpoilerIcon,
  StrikeIcon,
  SubscriptIcon,
  SuperscriptIcon,
  TableIcon,
  ThinkingIcon,
  UnderlineIcon,
} from '../components/Icons.jsx';
import { sanitizeUrl } from '../../shared/utils.js';
import { localFileUrl, localUrlToPath, LOCAL_MEDIA_SCHEME } from '../../shared/html-serializer.js';

/** Convenience: run a chained command on a focused editor. */
const chain = (editor) => editor.chain().focus();

/* ═════════════════════ 1. Formatting — the "Aa" button ═════════════════════ */

/**
 * The source currently named by the quote the caret sits in.
 * @param {object} editor
 * @returns {string}
 */
function quoteAttribution(editor) {
  if (!editor) return '';
  const node = editor.isActive('pullQuote') ? 'pullQuote' : 'blockquote';
  return (editor.getAttributes(node) || {}).attribution || '';
}

/**
 * Whether the blockquote under the caret carries the expandable flag.
 * @param {object} editor
 * @returns {boolean}
 */
function quoteExpandable(editor) {
  if (!editor) return false;
  return !!(editor.getAttributes('blockquote') || {}).expandable;
}

/** Heading levels, shown as a second menu level under "Heading". */
export const HEADING_ACTIONS = [1, 2, 3, 4, 5, 6].map((level) => ({
  id: `heading${level}`,
  i18nKey: `block.heading${level}`,
  icon: (props) => HeadingIcon({ ...props, level }),
  run: (editor) => chain(editor).toggleHeading({ level }).run(),
  isActive: (editor) => editor.isActive('heading', { level }),
}));

export const TEXT_STYLE_ACTIONS = [
  {
    id: 'heading',
    i18nKey: 'block.heading',
    icon: (props) => HeadingIcon({ ...props, level: '' }),
    children: HEADING_ACTIONS,
    isActive: (editor) => editor.isActive('heading'),
  },
  {
    id: 'paragraph',
    i18nKey: 'block.text',
    icon: ParagraphIcon,
    run: (editor) => chain(editor).setParagraph().run(),
    isActive: (editor) => editor.isActive('paragraph'),
  },
  {
    id: 'blockquote',
    i18nKey: 'block.blockquote',
    icon: QuoteIcon,
    run: (editor) => chain(editor).toggleBlockquote().run(),
    isActive: (editor) => editor.isActive('blockquote') && !quoteExpandable(editor),
  },
  {
    id: 'expandableQuote',
    i18nKey: 'block.expandableQuote',
    icon: QuoteIcon,
    run: (editor) =>
      // Wrapped so the caret does not have to sit on the quote: if it already
      // is, flip the flag; otherwise wrap a new expandable quote around it.
      editor.isActive('blockquote')
        ? chain(editor).toggleQuoteExpandable().run()
        : chain(editor).toggleBlockquote().toggleQuoteExpandable().run(),
    isActive: (editor) => quoteExpandable(editor),
  },
  {
    id: 'pullquote',
    i18nKey: 'block.pullquote',
    icon: PullQuoteIcon,
    run: (editor) => chain(editor).togglePullQuote().run(),
    isActive: (editor) => editor.isActive('pullQuote'),
  },
  {
    // Rich HTML lets a quote name its source in a <cite>; this writes it.
    id: 'attribution',
    i18nKey: 'block.attribution',
    icon: QuoteIcon,
    enabled: (editor) => editor.isActive('blockquote') || editor.isActive('pullQuote'),
    isActive: (editor) => !!quoteAttribution(editor),
    run: async (editor, ctx) => {
      const current = quoteAttribution(editor);
      const name = await ctx.askText({
        titleKey: 'block.attribution',
        placeholderKey: 'dialog.attributionPlaceholder',
        value: current,
      });
      if (name === null) return;
      chain(editor).setQuoteAttribution(name.trim()).run();
    },
  },
  {
    id: 'codeBlock',
    i18nKey: 'block.codeBlock',
    icon: CodeBlockIcon,
    run: (editor) => chain(editor).toggleCodeBlock().run(),
    isActive: (editor) => editor.isActive('codeBlock'),
  },
  {
    id: 'footer',
    i18nKey: 'block.footer',
    icon: FooterIcon,
    run: (editor) => chain(editor).setFooter().run(),
    isActive: (editor) => editor.isActive('footer'),
  },
  {
    id: 'divider',
    i18nKey: 'block.divider',
    icon: DividerIcon,
    run: (editor) => chain(editor).setHorizontalRule().run(),
  },
];

/* ═════════════════════ 2. Text style — the "B" button ═════════════════════ */

export const FORMAT_ACTIONS = [
  {
    id: 'bold',
    i18nKey: 'format.bold',
    icon: BoldIcon,
    hint: 'Ctrl+B',
    run: (editor) => chain(editor).toggleBold().run(),
    isActive: (editor) => editor.isActive('bold'),
  },
  {
    id: 'italic',
    i18nKey: 'format.italic',
    icon: ItalicIcon,
    hint: 'Ctrl+I',
    run: (editor) => chain(editor).toggleItalic().run(),
    isActive: (editor) => editor.isActive('italic'),
  },
  {
    id: 'underline',
    i18nKey: 'format.underline',
    icon: UnderlineIcon,
    hint: 'Ctrl+U',
    run: (editor) => chain(editor).toggleUnderline().run(),
    isActive: (editor) => editor.isActive('underline'),
  },
  {
    id: 'strike',
    i18nKey: 'format.strike',
    icon: StrikeIcon,
    hint: 'Ctrl+Shift+X',
    run: (editor) => chain(editor).toggleStrike().run(),
    isActive: (editor) => editor.isActive('strike'),
  },
  {
    id: 'spoiler',
    i18nKey: 'format.spoiler',
    icon: SpoilerIcon,
    hint: 'Ctrl+Shift+P',
    run: (editor) => chain(editor).toggleSpoiler().run(),
    isActive: (editor) => editor.isActive('spoiler'),
  },
  {
    id: 'subscript',
    i18nKey: 'format.subscript',
    icon: SubscriptIcon,
    run: (editor) => chain(editor).toggleSubscript().run(),
    isActive: (editor) => editor.isActive('subscript'),
  },
  {
    id: 'superscript',
    i18nKey: 'format.superscript',
    icon: SuperscriptIcon,
    run: (editor) => chain(editor).toggleSuperscript().run(),
    isActive: (editor) => editor.isActive('superscript'),
  },
  {
    id: 'marked',
    i18nKey: 'format.marked',
    icon: HighlightIcon,
    run: (editor) => chain(editor).toggleHighlight().run(),
    isActive: (editor) => editor.isActive('highlight'),
  },
];

/* ═════════════════════ 3. Lists — the list button ═════════════════════ */

export const LIST_ACTIONS = [
  {
    id: 'orderedList',
    i18nKey: 'block.orderedList',
    icon: OrderedListIcon,
    run: (editor) => chain(editor).toggleOrderedList().run(),
    isActive: (editor) => editor.isActive('orderedList'),
  },
  {
    id: 'bulletList',
    i18nKey: 'block.bulletList',
    icon: BulletListIcon,
    run: (editor) => chain(editor).toggleBulletList().run(),
    isActive: (editor) => editor.isActive('bulletList'),
  },
  {
    id: 'checklist',
    i18nKey: 'block.checklist',
    icon: ChecklistIcon,
    note: 'block.checklistNote',
    run: (editor) => chain(editor).toggleTaskList().run(),
    isActive: (editor) => editor.isActive('taskList'),
  },
  {
    id: 'details',
    i18nKey: 'block.details',
    icon: DetailsIcon,
    run: (editor) => chain(editor).setDetails().run(),
    isActive: (editor) => editor.isActive('details'),
  },
  {
    // `<ol type="a|A|i|I">` — the marker style Rich HTML supports on ordered
    // lists; a caret anywhere in the list is enough.
    id: 'listType',
    i18nKey: 'block.listType',
    icon: OrderedListIcon,
    enabled: (editor) => editor.isActive('orderedList'),
    isActive: (editor) => !!(editor.getAttributes('orderedList') || {}).listType,
    run: async (editor, ctx) => {
      const current = (editor.getAttributes('orderedList') || {}).listType || '';
      const type = await ctx.askText({
        titleKey: 'block.listType',
        placeholderKey: 'dialog.listTypePlaceholder',
        value: current,
      });
      if (type === null) return;
      const value = type.trim();
      if (value && !/^[aAiI]$/.test(value)) {
        ctx.notify('toast.invalidListType', 'error');
        return;
      }
      chain(editor).setOrderedListType(value).run();
    },
  },
  {
    id: 'listReversed',
    i18nKey: 'block.listReversed',
    icon: OrderedListIcon,
    enabled: (editor) => editor.isActive('orderedList'),
    isActive: (editor) => !!(editor.getAttributes('orderedList') || {}).reversed,
    run: (editor) => chain(editor).toggleOrderedListReversed().run(),
  },
  {
    // `<li value="7">` — an explicit number for the item under the caret.
    id: 'listValue',
    i18nKey: 'block.listValue',
    icon: OrderedListIcon,
    enabled: (editor) => editor.isActive('listItem'),
    run: async (editor, ctx) => {
      const current = String((editor.getAttributes('listItem') || {}).value || '');
      const raw = await ctx.askText({
        titleKey: 'block.listValue',
        placeholderKey: 'dialog.listValuePlaceholder',
        value: current,
      });
      if (raw === null) return;
      const value = parseInt(raw.trim(), 10);
      if (raw.trim() && (!Number.isFinite(value) || value < 1)) {
        ctx.notify('toast.invalidCoords', 'error');
        return;
      }
      chain(editor).setListItemValue(value).run();
    },
  },
];

/* ═════════════════════ 4. Table — direct insert + bubble menu ═════════════ */

/**
 * Insert a ready-to-edit 3×3 table with a header row.
 * @param {object} editor
 */
export function insertTable(editor) {
  chain(editor).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
}

/** Row/column controls shown in the bubble menu while the caret is in a table. */
export const TABLE_ACTIONS = [
  {
    id: 'addRow',
    i18nKey: 'table.addRow',
    icon: TableIcon,
    run: (editor) => chain(editor).addRowAfter().run(),
  },
  {
    id: 'addColumn',
    i18nKey: 'table.addColumn',
    icon: TableIcon,
    run: (editor) => chain(editor).addColumnAfter().run(),
  },
  {
    id: 'deleteRow',
    i18nKey: 'table.deleteRow',
    icon: TableIcon,
    run: (editor) => chain(editor).deleteRow().run(),
  },
  {
    id: 'deleteColumn',
    i18nKey: 'table.deleteColumn',
    icon: TableIcon,
    run: (editor) => chain(editor).deleteColumn().run(),
  },
  {
    id: 'deleteTable',
    i18nKey: 'table.delete',
    icon: TableIcon,
    danger: true,
    run: (editor) => chain(editor).deleteTable().run(),
  },
];

/* ─── Cell alignment — shown in the bubble menu, serialized as align/valign ─── */

const inTable = (editor) =>
  !!editor && (editor.isActive('tableCell') || editor.isActive('tableHeader'));

const cellAlignAttrs = (editor) => (editor.getAttributes('tableCell') || {}).align || '';
const cellValignAttrs = (editor) => (editor.getAttributes('tableCell') || {}).valign || '';
const headerAlignAttrs = (editor) => (editor.getAttributes('tableHeader') || {}).align || '';
const headerValignAttrs = (editor) => (editor.getAttributes('tableHeader') || {}).valign || '';

/**
 * The `align` value currently set on the cell (or header) under the caret.
 * @param {object} editor
 * @returns {string}
 */
export function cellAlign(editor) {
  if (!editor || !inTable(editor)) return '';
  return headerAlignAttrs(editor) || cellAlignAttrs(editor);
}

/**
 * The `valign` value currently set on the cell (or header) under the caret.
 * @param {object} editor
 * @returns {string}
 */
export function cellValign(editor) {
  if (!editor || !inTable(editor)) return '';
  return headerValignAttrs(editor) || cellValignAttrs(editor);
}

export const TABLE_CELL_ACTIONS = [
  {
    id: 'alignLeft',
    i18nKey: 'table.alignLeft',
    icon: TableIcon,
    isActive: (editor) => cellAlign(editor) === 'left',
    run: (editor) =>
      chain(editor).setCellAlign(cellAlign(editor) === 'left' ? '' : 'left').run(),
  },
  {
    id: 'alignCenter',
    i18nKey: 'table.alignCenter',
    icon: TableIcon,
    isActive: (editor) => cellAlign(editor) === 'center',
    run: (editor) =>
      chain(editor).setCellAlign(cellAlign(editor) === 'center' ? '' : 'center').run(),
  },
  {
    id: 'alignRight',
    i18nKey: 'table.alignRight',
    icon: TableIcon,
    isActive: (editor) => cellAlign(editor) === 'right',
    run: (editor) =>
      chain(editor).setCellAlign(cellAlign(editor) === 'right' ? '' : 'right').run(),
  },
  {
    id: 'valignTop',
    i18nKey: 'table.valignTop',
    icon: TableIcon,
    isActive: (editor) => cellValign(editor) === 'top',
    run: (editor) => chain(editor).setCellValign(cellValign(editor) === 'top' ? '' : 'top').run(),
  },
  {
    id: 'valignMiddle',
    i18nKey: 'table.valignMiddle',
    icon: TableIcon,
    isActive: (editor) => cellValign(editor) === 'middle',
    run: (editor) =>
      chain(editor).setCellValign(cellValign(editor) === 'middle' ? '' : 'middle').run(),
  },
  {
    id: 'valignBottom',
    i18nKey: 'table.valignBottom',
    icon: TableIcon,
    isActive: (editor) => cellValign(editor) === 'bottom',
    run: (editor) =>
      chain(editor).setCellValign(cellValign(editor) === 'bottom' ? '' : 'bottom').run(),
  },
  {
    id: 'tableStriped',
    i18nKey: 'table.striped',
    icon: TableIcon,
    isActive: (editor) => !!(editor.getAttributes('table') || {}).striped,
    run: (editor) => chain(editor).toggleTableStriped().run(),
  },
  {
    id: 'tableCompact',
    i18nKey: 'table.compact',
    icon: TableIcon,
    isActive: (editor) => !!(editor.getAttributes('table') || {}).compact,
    run: (editor) => chain(editor).toggleTableCompact().run(),
  },
  {
    id: 'tableCaption',
    i18nKey: 'table.caption',
    icon: TableIcon,
    run: async (editor, ctx) => {
      const current = (editor.getAttributes('table') || {}).caption || '';
      const caption = await ctx.askText({
        titleKey: 'table.caption',
        placeholderKey: 'dialog.captionPlaceholder',
        value: current,
      });
      if (caption === null) return;
      chain(editor).setTableCaption(caption.trim()).run();
    },
  },
];

/* ═════════════════════ 5. Link — the chain button ═════════════════════ */

/**
 * Open the "Create link" panel and apply the result.
 * With a selection, the panel's Text field is prefilled and the selection is
 * replaced; without one, the entered text is inserted as a link.
 * @param {object} editor
 * @param {object} ctx
 */
export async function insertLink(editor, ctx) {
  const { from, to, empty } = editor.state.selection;
  const selected = empty ? '' : editor.state.doc.textBetween(from, to, ' ');
  const existing = editor.getAttributes('link').href || '';

  const result = await ctx.askLink({ text: selected, url: existing });
  if (!result) return;

  const href = sanitizeUrl((result.url || '').trim());
  if (!href) {
    ctx.notify('toast.unsafeUrl', 'error');
    return;
  }
  const label = (result.text || '').trim() || href;

  chain(editor)
    .insertContent({
      type: 'text',
      text: label,
      marks: [{ type: 'link', attrs: { href } }],
    })
    .run();
}

/** Registry entry so the palette can reach the link panel too. */
export const LINK_ACTION = {
  id: 'link',
  i18nKey: 'toolbar.link',
  icon: LinkIcon,
  hint: 'Ctrl+K',
  run: (editor, ctx) => insertLink(editor, ctx),
  isActive: (editor) => editor.isActive('link'),
};

/* ═════════════════════ 6. Media — the photo button ═════════════════════ */

const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v|avi)(\?|#|$)/i;
const AUDIO_EXT = /\.(mp3|ogg|oga|wav|m4a|flac|opus|aac)(\?|#|$)/i;

/**
 * Guess which rich block a media URL belongs to. A locally picked file keeps
 * its kind too — its name rides encoded inside the `tfrfile://` URL.
 * @param {string} url
 * @returns {'video'|'audio'|'photo'}
 */
export function mediaKindForUrl(url) {
  if (String(url).startsWith(LOCAL_MEDIA_SCHEME)) return mediaKindForUrl(localUrlToPath(url));
  if (VIDEO_EXT.test(url)) return 'video';
  if (AUDIO_EXT.test(url)) return 'audio';
  return 'photo';
}

/** The media node the caret is on, if any. */
const CAPTIONABLE = ['image', 'mediaBlock', 'galleryBlock'];

/**
 * The caption and credit currently on the selected media.
 * @param {object} editor
 * @returns {{ caption: string, credit: string }}
 */
function mediaCaption(editor) {
  if (!editor) return { caption: '', credit: '' };
  const node = CAPTIONABLE.find((name) => editor.isActive(name));
  const attrs = node ? editor.getAttributes(node) || {} : {};
  return { caption: attrs.caption || '', credit: attrs.credit || '' };
}

/**
 * Split a comma-separated list of URLs and drop unsafe ones.
 * @param {string} raw
 * @returns {string[]}
 */
export function parseUrlList(raw) {
  return String(raw || '')
    .split(',')
    .map((url) => sanitizeUrl(url.trim()))
    .filter(Boolean);
}

/**
 * Read a "lat, long" pair, or null when it is not one.
 *
 * The range matters: `parseFloat` is happy with `999, 999`, which used to reach
 * Telegram and come back as an opaque API error long after the user had stopped
 * thinking about the coordinates they typed.
 *
 * @param {string} raw
 * @returns {{ latitude: number, longitude: number }|null}
 */
export function parseCoords(raw) {
  const parts = String(raw || '').split(',');
  if (parts.length !== 2) return null;
  // Number(), not parseFloat(): parseFloat('35 degrees') is 35.
  const [latitude, longitude] = parts.map((part) => {
    const text = part.trim();
    return text === '' ? NaN : Number(text);
  });
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export const MEDIA_ACTIONS = [
  {
    id: 'photoOrVideo',
    i18nKey: 'media.photoOrVideo',
    icon: ImageIcon,
    note: 'media.photoOrVideoNote',
    run: async (editor, ctx) => {
      // The device picker is the primary path; cancelling without a choice
      // falls through to the classic URL prompt, so a pasted remote link is
      // still one gesture away.
      let urls = [];
      if (ctx.askFiles) {
        const picked = await ctx.askFiles('media');
        if (!picked) return;
        if (picked.ok === false) {
          ctx.notify('toast.mediaPickFailed', 'error');
          return;
        }
        urls = (picked.files || []).map(localFileUrl);
      }
      if (!urls.length) {
        const raw = await ctx.askText({
          titleKey: 'media.photoOrVideo',
          placeholder: 'https://a.jpg, https://b.mp4',
        });
        if (!raw) return;
        urls = parseUrlList(raw);
        if (!urls.length) {
          ctx.notify('toast.unsafeUrl', 'error');
          return;
        }
      }
      // Two or more files become a slideshow, exactly like Telegram groups them.
      if (urls.length > 1) {
        chain(editor).setGalleryBlock({ kind: 'slideshow', images: urls }).run();
        return;
      }
      const [url] = urls;
      const kind = mediaKindForUrl(url);
      if (kind === 'photo') chain(editor).setImage({ src: url }).run();
      else chain(editor).setMediaBlock({ kind, src: url }).run();
    },
  },
  {
    id: 'audioFile',
    i18nKey: 'media.audioFile',
    icon: AudioIcon,
    run: async (editor, ctx) => {
      if (ctx.askFiles) {
        const picked = await ctx.askFiles('audio');
        if (!picked) return;
        if (picked.ok === false) {
          ctx.notify('toast.mediaPickFailed', 'error');
          return;
        }
        const [file] = picked.files || [];
        if (file) {
          chain(editor).setMediaBlock({ kind: 'audio', src: localFileUrl(file) }).run();
          return;
        }
      }
      const raw = await ctx.askText({
        titleKey: 'media.audioFile',
        placeholder: 'https://example.com/song.mp3',
      });
      if (!raw) return;
      const [url] = parseUrlList(raw);
      if (!url) {
        ctx.notify('toast.unsafeUrl', 'error');
        return;
      }
      chain(editor).setMediaBlock({ kind: 'audio', src: url }).run();
    },
  },
  {
    // `<tg-document src="…">` — a general file: PDF, ZIP, anything Telegram
    // would send through sendDocument, embedded in the article itself.
    id: 'documentFile',
    i18nKey: 'media.document',
    icon: FileIcon,
    run: async (editor, ctx) => {
      if (ctx.askFiles) {
        const picked = await ctx.askFiles('document');
        if (!picked) return;
        if (picked.ok === false) {
          ctx.notify('toast.mediaPickFailed', 'error');
          return;
        }
        const [file] = picked.files || [];
        if (file) {
          chain(editor).setMediaBlock({ kind: 'document', src: localFileUrl(file) }).run();
          return;
        }
      }
      const raw = await ctx.askText({
        titleKey: 'media.document',
        placeholder: 'https://example.com/report.pdf',
      });
      if (!raw) return;
      const [url] = parseUrlList(raw);
      if (!url) {
        ctx.notify('toast.unsafeUrl', 'error');
        return;
      }
      chain(editor).setMediaBlock({ kind: 'document', src: url }).run();
    },
  },
  {
    // The `tg-spoiler` attribute on media — hidden behind a blur until tapped.
    id: 'mediaSpoiler',
    i18nKey: 'media.spoiler',
    icon: SpoilerIcon,
    enabled: (editor) => editor.isActive('image') || editor.isActive('mediaBlock'),
    isActive: (editor) =>
      [editor.getAttributes('image'), editor.getAttributes('mediaBlock')].some(
        (attrs) => !!attrs.spoiler,
      ),
    run: (editor) => chain(editor).toggleMediaSpoiler().run(),
  },
  {
    id: 'location',
    i18nKey: 'media.location',
    icon: MapIcon,
    run: async (editor, ctx) => {
      const raw = await ctx.askText({
        titleKey: 'media.locationPrompt',
        placeholder: '35.6892, 51.3890',
      });
      if (!raw) return;
      const coords = parseCoords(raw);
      if (!coords) {
        ctx.notify('toast.invalidCoords', 'error');
        return;
      }
      chain(editor).setMapBlock(coords).run();
    },
  },
  {
    // Rich HTML captions media with a <figcaption> that follows it, and the
    // caption may name a source of its own in a <cite>.
    id: 'caption',
    i18nKey: 'media.caption',
    icon: QuoteIcon,
    enabled: (editor) => CAPTIONABLE.some((name) => editor.isActive(name)),
    isActive: (editor) => {
      const { caption, credit } = mediaCaption(editor);
      return !!(caption || credit);
    },
    run: async (editor, ctx) => {
      const current = mediaCaption(editor);
      const caption = await ctx.askText({
        titleKey: 'media.caption',
        placeholderKey: 'dialog.captionPlaceholder',
        value: current.caption,
      });
      if (caption === null) return;
      const credit = await ctx.askText({
        titleKey: 'media.captionCredit',
        placeholderKey: 'dialog.captionCreditPlaceholder',
        value: current.credit,
      });
      if (credit === null) return;
      chain(editor).setMediaCaption(caption.trim(), credit.trim()).run();
    },
  },
];

/* ═════════════════════ 7. Formula — the sigma button ═════════════════════ */

/**
 * Ask for a formula and insert it as a block.
 * @param {object} editor
 * @param {object} ctx
 */
export async function insertFormula(editor, ctx) {
  const formula = await ctx.askText({
    titleKey: 'toolbar.formula',
    placeholder: 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}',
  });
  if (!formula) return;
  chain(editor).setMathBlock(formula).run();
}

export const FORMULA_ACTION = {
  id: 'formula',
  i18nKey: 'toolbar.formula',
  icon: FormulaIcon,
  run: (editor, ctx) => insertFormula(editor, ctx),
};

/* ═════ Palette-only extras — reachable from the insert palette (wand) ═════ */

/**
 * Ask for a Premium custom emoji (an ID from a sticker pack or the message
 * payload) and its fallback text, then insert
 * `<tg-emoji emoji-id="…">fallback</tg-emoji>`.
 * @param {object} editor
 * @param {object} ctx
 */
export async function insertCustomEmoji(editor, ctx) {
  const emojiId = await ctx.askText({
    titleKey: 'premium.emoji',
    placeholder: '5368324170671202286',
  });
  if (!emojiId) return;
  const fallback = await ctx.askText({
    titleKey: 'premium.emojiFallback',
    placeholder: '👍',
  });
  if (fallback === null) return;
  chain(editor)
    .insertCustomEmoji({ emojiId: emojiId.trim(), fallback: fallback.trim() || '✨' })
    .run();
}

/**
 * Ask for a Unix timestamp (or any date the browser can parse) plus an
 * optional date-time format, and insert
 * `<tg-time unix="…" format="…">fallback</tg-time>`.
 * @param {object} editor
 * @param {object} ctx
 */
export async function insertDateTime(editor, ctx) {
  const raw = await ctx.askText({
    titleKey: 'premium.time',
    placeholder: '1647531900 or 2022-03-15 22:45',
  });
  if (!raw) return;
  const input = raw.trim();
  const unix = /^\d+$/.test(input)
    ? parseInt(input, 10)
    : Math.floor(Date.parse(input) / 1000);
  if (!Number.isFinite(unix) || unix < 0) {
    ctx.notify('toast.invalidTime', 'error');
    return;
  }
  const format = await ctx.askText({
    titleKey: 'premium.timeFormat',
    placeholderKey: 'premium.timeFormatHint',
  });
  if (format === null) return;
  const text = await ctx.askText({
    titleKey: 'premium.timeFallback',
    placeholder: '22:45 tomorrow',
  });
  if (text === null) return;
  chain(editor)
    .insertDateTime({ unix, format: format.trim(), text: text.trim() })
    .run();
}

/**
 * Ask for an anchor name and drop `<a name="…"></a>` where the caret is.
 * @param {object} editor
 * @param {object} ctx
 */
export async function insertAnchor(editor, ctx) {
  const name = await ctx.askText({
    titleKey: 'premium.anchor',
    placeholderKey: 'dialog.anchorPlaceholder',
  });
  if (!name) return;
  const clean = name.trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
  chain(editor).insertAnchor(clean).run();
}

/**
 * Mark the selection as `<tg-reference name="…">` — text a footnote link can
 * point at, the counterpart of the anchor above.
 * @param {object} editor
 * @param {object} ctx
 */
export async function insertReference(editor, ctx) {
  const current = (editor.getAttributes('reference') || {}).name || '';
  const name = await ctx.askText({
    titleKey: 'premium.reference',
    placeholderKey: 'dialog.anchorPlaceholder',
    value: current,
  });
  if (name === null) return;
  const clean = name.trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!clean) {
    chain(editor).unsetReference().run();
    return;
  }
  chain(editor).toggleReference(clean).run();
}

/**
 * Insert `<a href="tg://user?id=…">` — the inline mention of a Telegram user.
 * @param {object} editor
 * @param {object} ctx
 */
export async function insertMention(editor, ctx) {
  const userId = await ctx.askText({
    titleKey: 'premium.mention',
    placeholder: '777000',
  });
  if (!userId) return;
  const id = userId.trim();
  if (!/^\d+$/.test(id)) {
    ctx.notify('toast.invalidId', 'error');
    return;
  }
  const label = await ctx.askText({
    titleKey: 'premium.mentionLabel',
    placeholder: 'Support',
  });
  if (label === null) return;
  const text = label.trim() || `@user${id}`;
  chain(editor)
    .insertContent({
      type: 'text',
      text,
      marks: [{ type: 'link', attrs: { href: `tg://user?id=${id}` } }],
    })
    .run();
}

/**
 * Inline mention — `<a href="tg://user?id=…">`. Declared before the
 * `PREMIUM_ACTIONS` list that embeds it.
 */
export const MENTION_ACTION = {
  id: 'mention',
  i18nKey: 'premium.mention',
  icon: MentionIcon,
  run: (editor, ctx) => insertMention(editor, ctx),
};

/** The Premium article features, in palette order. */
export const PREMIUM_ACTIONS = [
  {
    id: 'buttons',
    i18nKey: 'premium.buttons',
    icon: ButtonsIcon,
    run: async (editor, ctx) => {
      const current = editor.isActive('buttonsRow')
        ? editor.getAttributes('buttonsRow') || {}
        : {};
      const result = await ctx.askButtons({
        align: current.align || '',
        buttons: current.buttons || [],
      });
      if (!result) return;
      if (!result.buttons.length) {
        // An edited row whose buttons were all removed gets deleted.
        if (editor.isActive('buttonsRow')) chain(editor).deleteSelection().run();
        return;
      }
      if (editor.isActive('buttonsRow')) {
        chain(editor).updateAttributes('buttonsRow', result).run();
      } else {
        chain(editor).setButtonsRow(result).run();
      }
    },
    isActive: (editor) => editor.isActive('buttonsRow'),
  },
  {
    id: 'inlineButton',
    i18nKey: 'premium.inlineButton',
    icon: ButtonsIcon,
    run: async (editor, ctx) => {
      const current = editor.isActive('inlineButton')
        ? editor.getAttributes('inlineButton') || {}
        : null;
      const result = await ctx.askInlineButton(
        current ? { ...current, existing: true } : {},
      );
      if (!result) return;
      // A confirmed "Remove" (only shown when editing an existing chip).
      if (result.removed) {
        if (current) chain(editor).removeInlineButton().run();
        return;
      }
      if (current) {
        chain(editor).updateInlineButton(result).run();
      } else {
        chain(editor).setInlineButton(result).run();
      }
    },
    isActive: (editor) => editor.isActive('inlineButton'),
  },
  {
    id: 'customEmoji',
    i18nKey: 'premium.emoji',
    icon: SmileyIcon,
    run: (editor, ctx) => insertCustomEmoji(editor, ctx),
  },
  MENTION_ACTION,
  {
    id: 'dateTime',
    i18nKey: 'premium.time',
    icon: ClockIcon,
    run: (editor, ctx) => insertDateTime(editor, ctx),
  },
  {
    id: 'thinking',
    i18nKey: 'premium.thinking',
    icon: ThinkingIcon,
    note: 'premium.thinkingNote',
    run: async (editor, ctx) => {
      const current = editor.isActive('thinkingBlock')
        ? (editor.getAttributes('thinkingBlock') || {}).text || ''
        : 'Thinking...';
      const text = await ctx.askText({
        titleKey: 'premium.thinking',
        value: current,
      });
      if (text === null) return;
      const value = text.trim() || 'Thinking...';
      if (editor.isActive('thinkingBlock')) {
        chain(editor).updateAttributes('thinkingBlock', { text: value }).run();
      } else {
        chain(editor).setThinkingBlock(value).run();
      }
    },
    isActive: (editor) => editor.isActive('thinkingBlock'),
  },
  {
    id: 'anchor',
    i18nKey: 'premium.anchor',
    icon: AnchorIcon,
    run: (editor, ctx) => insertAnchor(editor, ctx),
  },
  {
    id: 'reference',
    i18nKey: 'premium.reference',
    icon: AnchorIcon,
    enabled: (editor) => !editor.state.selection.empty,
    isActive: (editor) => editor.isActive('reference'),
    run: (editor, ctx) => insertReference(editor, ctx),
  },
];

export const EXTRA_ACTIONS = [
  {
    id: 'code',
    i18nKey: 'format.code',
    icon: CodeIcon,
    hint: 'Ctrl+E',
    run: (editor) => chain(editor).toggleCode().run(),
    isActive: (editor) => editor.isActive('code'),
  },
  {
    id: 'clearFormat',
    i18nKey: 'format.clear',
    icon: ClearFormatIcon,
    run: (editor) => chain(editor).unsetAllMarks().run(),
  },
  {
    id: 'mathInline',
    i18nKey: 'formula.inline',
    icon: MathInlineIcon,
    run: async (editor, ctx) => {
      const formula = await ctx.askText({ titleKey: 'formula.inline', placeholder: 'a^2 + b^2' });
      if (!formula) return;
      chain(editor).insertInlineMath(formula).run();
    },
  },
  {
    id: 'collage',
    i18nKey: 'media.collage',
    icon: CollageIcon,
    run: async (editor, ctx) => {
      const raw = await ctx.askText({
        titleKey: 'media.collage',
        placeholder: 'https://a.jpg, https://b.jpg',
      });
      if (!raw) return;
      const images = parseUrlList(raw);
      if (!images.length) {
        ctx.notify('toast.unsafeUrl', 'error');
        return;
      }
      chain(editor).setGalleryBlock({ kind: 'collage', images }).run();
    },
  },
  {
    id: 'insertTable',
    i18nKey: 'table.insert',
    icon: TableIcon,
    run: (editor) => insertTable(editor),
  },
];

/* ═════════════════════════ Palette helpers ═════════════════════════ */

/**
 * Flat list of every action, used by the insert palette (the wand button).
 * Second-level items (heading levels) are flattened in; the parent is dropped.
 * @returns {Array<object>}
 */
export function allActions() {
  const flat = [];
  for (const action of TEXT_STYLE_ACTIONS) {
    if (action.children) flat.push(...action.children);
    else flat.push(action);
  }
  return [
    ...FORMAT_ACTIONS,
    LINK_ACTION,
    ...flat,
    ...LIST_ACTIONS,
    ...MEDIA_ACTIONS,
    FORMULA_ACTION,
    ...PREMIUM_ACTIONS,
    ...EXTRA_ACTIONS,
  ];
}

/**
 * Filter actions by a search query against their translated labels.
 * @param {Array<object>} actions
 * @param {string} query
 * @param {(key: string) => string} translate
 * @returns {Array<object>}
 */
export function filterActions(actions, query, translate) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return actions;
  return actions.filter((action) => {
    const label = translate(action.i18nKey).toLowerCase();
    return label.includes(q) || action.id.toLowerCase().includes(q);
  });
}

/**
 * Resolve whether an action is currently enabled.
 * @param {object} action
 * @param {object|null} editor
 * @returns {boolean}
 */
export function isActionEnabled(action, editor) {
  if (!editor) return false;
  if (typeof action.enabled !== 'function') return true;
  return !!action.enabled(editor);
}

/**
 * Resolve whether an action is currently active (checked).
 * @param {object} action
 * @param {object|null} editor
 * @param {object} [ctx]
 * @returns {boolean}
 */
export function isActionActive(action, editor, ctx) {
  if (typeof action.isActive !== 'function') return false;
  try {
    return !!action.isActive(editor, ctx);
  } catch {
    return false;
  }
}
