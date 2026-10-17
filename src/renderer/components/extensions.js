/**
 * Custom TipTap extensions covering the Telegram Bot API 10.1 rich blocks and
 * rich-text entities that no upstream extension provides.
 *
 * Each node/mark renders to HTML that `src/shared/block-parser.js` can read
 * back, so the editor DOM stays the single source of truth for serialization.
 *
 * @module components/extensions
 */

import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import { mediaKindForUrl } from '../lib/editor-actions.js';
import { BUTTON_KINDS, BUTTON_STYLES, MEDIA_SCHEMES, safeUrl } from '../../shared/html-serializer.js';

/* ─────────────────────── Gallery node view helpers ─────────────────────── */

/** Glyph standing in for a media file that the app cannot preview. */
export const KIND_GLYPH = { video: '▶', audio: '♪', photo: '🖼' };

/**
 * The last path segment of a URL, short enough to sit under a glyph.
 * @param {string} url
 * @returns {string}
 */
export function fileNameOf(url) {
  const clean = String(url).split(/[?#]/)[0];
  const name = clean.slice(clean.lastIndexOf('/') + 1) || clean;
  return name.length > 30 ? `${name.slice(0, 29)}…` : name;
}

/**
 * A tile shown when the media itself will not load in the app window.
 *
 * A Telegram CDN link often refuses to play here while Telegram renders it
 * perfectly once sent — so this says what the file is instead of showing a
 * broken-image icon.
 *
 * @param {string} url
 * @param {(key: string) => string} t
 * @returns {HTMLElement}
 */
function fallbackTile(url, t) {
  const kind = mediaKindForUrl(url);
  const box = document.createElement('div');
  box.className = 'tg-gallery-fallback';
  box.title = url;

  const glyph = document.createElement('span');
  glyph.className = 'tg-gallery-glyph';
  glyph.textContent = KIND_GLYPH[kind] || KIND_GLYPH.photo;

  const name = document.createElement('span');
  name.className = 'tg-gallery-name';
  name.textContent = fileNameOf(url);

  const note = document.createElement('span');
  note.className = 'tg-gallery-note';
  note.textContent = t('gallery.noPreview');

  box.append(glyph, name, note);
  return box;
}

/**
 * The media element for one gallery entry, falling back to a labelled tile if
 * the browser cannot load it.
 * @param {string} url
 * @param {(key: string) => string} t
 * @returns {HTMLElement}
 */
function mediaTile(url, t) {
  const kind = mediaKindForUrl(url);
  const el = document.createElement(kind === 'photo' ? 'img' : kind);
  el.src = url;
  if (kind !== 'photo') {
    el.controls = true;
    el.preload = 'metadata';
  } else {
    el.alt = '';
  }
  el.addEventListener('error', () => {
    if (el.parentNode) el.replaceWith(fallbackTile(url, t));
  });
  return el;
}

/**
 * @param {string} className
 * @param {string} label
 * @param {string} glyph
 * @param {() => void} onClick
 * @returns {HTMLButtonElement}
 */
function navButton(className, label, glyph, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.setAttribute('aria-label', label);
  button.textContent = glyph;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

/* ───────────────────────────── Marks ───────────────────────────── */

/** Spoiler mark — `RichTextSpoiler`. */
export const Spoiler = Mark.create({
  name: 'spoiler',

  parseHTML() {
    return [{ tag: 'span[data-spoiler]' }, { tag: 'span.tg-spoiler' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-spoiler': '', class: 'tg-spoiler' }),
      0,
    ];
  },

  addCommands() {
    return {
      setSpoiler:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      toggleSpoiler:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
      unsetSpoiler:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return { 'Mod-Shift-p': () => this.editor.commands.toggleSpoiler() };
  },
});

/** Inline math mark — `RichTextMath`. */
export const InlineMath = Mark.create({
  name: 'inlineMath',

  parseHTML() {
    return [{ tag: 'span[data-inline-math]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-inline-math': '', class: 'tg-math-inline' }),
      0,
    ];
  },

  addCommands() {
    return {
      toggleInlineMath:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
      insertInlineMath:
        (formula = '') =>
        ({ commands }) =>
          commands.insertContent(`<span data-inline-math="">${formula}</span>`),
    };
  },
});

/* ───────────────────────────── Nodes ───────────────────────────── */

/** Pull quote / aside block — `InputRichBlockAside`. */
export const PullQuote = Node.create({
  name: 'pullQuote',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      attribution: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-attribution') || '',
        renderHTML: (attrs) =>
          attrs.attribution ? { 'data-attribution': attrs.attribution } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'blockquote[data-pullquote]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'blockquote',
      mergeAttributes(HTMLAttributes, { 'data-pullquote': '', class: 'tg-pullquote' }),
      0,
    ];
  },

  addCommands() {
    return {
      setPullQuote:
        () =>
        ({ commands }) =>
          commands.wrapIn(this.name),
      togglePullQuote:
        () =>
        ({ commands }) =>
          commands.toggleWrap(this.name),
    };
  },
});

/**
 * Who said it — the `<cite>` a quote may carry.
 *
 * Rich HTML documents `<blockquote>text<cite>Author</cite></blockquote>` and the
 * same for `<aside>`, so both quote kinds can name a source. `PullQuote` above
 * declares its own `attribution`; this adds the matching one to the plain
 * blockquote that StarterKit provides, and one command that writes to whichever
 * of the two the caret is in.
 */
export const QuoteAttribution = Extension.create({
  name: 'quoteAttribution',

  addGlobalAttributes() {
    return [
      {
        types: ['blockquote'],
        attributes: {
          attribution: {
            default: '',
            parseHTML: (element) => element.getAttribute('data-attribution') || '',
            renderHTML: (attrs) =>
              attrs.attribution ? { 'data-attribution': attrs.attribution } : {},
          },
          // `<blockquote expandable>` — the collapsed quotation Rich HTML
          // documents next to the ordinary one.
          expandable: {
            default: false,
            parseHTML: (element) => element.hasAttribute('data-expandable'),
            renderHTML: (attrs) => (attrs.expandable ? { 'data-expandable': '' } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setQuoteAttribution:
        (attribution = '') =>
        ({ commands, editor }) =>
          commands.updateAttributes(editor.isActive('pullQuote') ? 'pullQuote' : 'blockquote', {
            attribution,
          }),
      toggleQuoteExpandable:
        () =>
        ({ commands, editor }) => {
          if (editor.isActive('pullQuote')) return false;
          const current = !!(editor.getAttributes('blockquote') || {}).expandable;
          return commands.updateAttributes('blockquote', { expandable: !current });
        },
    };
  },
});

/**
 * The `<figcaption>` a media item may carry.
 *
 * Rich HTML puts the caption after the media it belongs to, and the caption may
 * name its own source:
 *
 *   <video src="…"/><figcaption>Clip title<cite>The Author</cite></figcaption>
 *
 * TipTap's Image and the gallery node get the pair here; MediaBlock declares it
 * itself, above.
 */
export const MediaCaption = Extension.create({
  name: 'mediaCaption',

  addGlobalAttributes() {
    return [
      {
        types: ['image', 'galleryBlock'],
        attributes: {
          caption: {
            default: '',
            parseHTML: (element) => element.getAttribute('data-caption') || '',
            renderHTML: (attrs) => (attrs.caption ? { 'data-caption': attrs.caption } : {}),
          },
          credit: {
            default: '',
            parseHTML: (element) => element.getAttribute('data-credit') || '',
            renderHTML: (attrs) => (attrs.credit ? { 'data-credit': attrs.credit } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setMediaCaption:
        (caption = '', credit = '') =>
        ({ commands, editor }) => {
          const node = ['image', 'mediaBlock', 'galleryBlock'].find((name) =>
            editor.isActive(name),
          );
          return node ? commands.updateAttributes(node, { caption, credit }) : false;
        },
    };
  },
});

/** Collapsible block — `InputRichBlockDetails`. */
export const Details = Node.create({
  name: 'details',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      summary: {
        default: 'Details',
        parseHTML: (element) => {
          const summary = element.querySelector('summary');
          return summary ? summary.textContent : 'Details';
        },
        renderHTML: (attrs) => ({ 'data-summary': attrs.summary || '' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'details' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'details',
      mergeAttributes(HTMLAttributes, { open: 'open' }),
      ['summary', { contenteditable: 'false' }, node.attrs.summary || 'Details'],
      ['div', { class: 'details-content' }, 0],
    ];
  },

  addCommands() {
    return {
      setDetails:
        (summary = 'Details') =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { summary },
            content: [{ type: 'paragraph' }],
          }),
    };
  },
});

/** Footer block — `InputRichBlockFooter`. */
export const Footer = Node.create({
  name: 'footer',
  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'footer' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['footer', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setFooter:
        () =>
        ({ commands }) =>
          commands.setNode(this.name),
      toggleFooter:
        () =>
        ({ commands }) =>
          commands.toggleNode(this.name, 'paragraph'),
    };
  },
});

/** Block math — `InputRichBlockMath`. */
export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      formula: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-formula') || element.textContent || '',
        renderHTML: (attrs) => ({ 'data-formula': attrs.formula || '' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div.tg-math' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const formula = node.attrs.formula || '';
    return ['div', mergeAttributes(HTMLAttributes, { class: 'tg-math' }), `$$${formula}$$`];
  },

  addCommands() {
    return {
      setMathBlock:
        (formula = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { formula } }),
    };
  },
});

/** Video / audio block — `InputRichBlockVideo` and `InputRichBlockAudio`. */
export const MediaBlock = Node.create({
  name: 'mediaBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      kind: { default: 'video' },
      src: { default: '' },
      caption: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-caption') || '',
        renderHTML: (attrs) => (attrs.caption ? { 'data-caption': attrs.caption } : {}),
      },
      credit: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-credit') || '',
        renderHTML: (attrs) => (attrs.credit ? { 'data-credit': attrs.credit } : {}),
      },
      spoiler: {
        default: false,
        parseHTML: (el) => el.hasAttribute('data-spoiler'),
        renderHTML: (attrs) => (attrs.spoiler ? { 'data-spoiler': '' } : {}),
      },
    };
  },

  parseHTML() {
    return [
      // Same filter as the gallery, and for the same reason: the editor must
      // not show media the serializer will drop.
      {
        tag: 'video[src]',
        getAttrs: (el) => ({ kind: 'video', src: safeUrl(el.getAttribute('src'), MEDIA_SCHEMES) }),
      },
      {
        tag: 'audio[src]',
        getAttrs: (el) => ({ kind: 'audio', src: safeUrl(el.getAttribute('src'), MEDIA_SCHEMES) }),
      },
      // `<tg-document src>` — a general file block the browser cannot show.
      {
        tag: 'tg-document[src]',
        getAttrs: (el) => ({
          kind: 'document',
          src: safeUrl(el.getAttribute('src'), MEDIA_SCHEMES),
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    if (node.attrs.kind === 'document') {
      // An unknown element is fine: it renders, gets styled by class, and the
      // serializer reads the `tg-document` tag straight off it.
      return [
        'tg-document',
        mergeAttributes(HTMLAttributes, {
          src: node.attrs.src,
          class: 'tg-media-document',
        }),
        `📄 ${fileNameOf(node.attrs.src || '')}`,
      ];
    }
    const tag = node.attrs.kind === 'audio' ? 'audio' : 'video';
    return [
      tag,
      mergeAttributes(HTMLAttributes, {
        src: node.attrs.src,
        controls: 'true',
        class: `tg-${tag}`,
      }),
    ];
  },

  addCommands() {
    return {
      setMediaBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

/** Slideshow / collage block — `InputRichBlockSlideshow` and `InputRichBlockCollage`. */
export const GalleryBlock = Node.create({
  name: 'galleryBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addOptions() {
    // The node view is plain DOM, so it cannot use the React i18n hook; the
    // editor is configured with a getter that reads the current language.
    return { t: (key) => key };
  },

  addAttributes() {
    return {
      kind: {
        default: 'slideshow',
        parseHTML: (el) => el.getAttribute('data-kind') || 'slideshow',
        renderHTML: (attrs) => ({ 'data-kind': attrs.kind }),
      },
      images: {
        default: [],
        // Filtered on the way in, with the list the serializer uses. Pasted
        // gallery markup would otherwise show tiles in the editor for URLs the
        // message silently drops.
        parseHTML: (el) =>
          (el.getAttribute('data-images') || '')
            .split(',')
            .map((src) => safeUrl(src.trim(), MEDIA_SCHEMES))
            .filter(Boolean),
        renderHTML: (attrs) => ({ 'data-images': (attrs.images || []).join(',') }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div.tg-gallery' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const images = node.attrs.images || [];
    return [
      'div',
      mergeAttributes(HTMLAttributes, { class: 'tg-gallery' }),
      ...images.map((src) => ['img', { src, alt: '' }]),
    ];
  },

  /**
   * A slideshow is one frame at a time with ‹ › controls; a collage keeps its
   * grid, because that is what a collage is. Either way the node view only
   * changes what is *shown* — `renderHTML` above is what `getHTML()` and the
   * serializer read, so the wire format is untouched.
   */
  addNodeView() {
    const t = this.options.t;

    return ({ node: initialNode }) => {
      let current = initialNode;
      let index = 0;

      const dom = document.createElement('div');
      const stage = document.createElement('div');
      stage.className = 'tg-gallery-stage';

      const render = () => {
        const images = current.attrs.images || [];
        const kind = current.attrs.kind === 'collage' ? 'collage' : 'slideshow';
        const single = images.length < 2;

        dom.className = 'tg-gallery';
        dom.setAttribute('data-kind', kind);
        dom.setAttribute('data-images', images.join(','));
        dom.replaceChildren(stage);

        if (index > images.length - 1) index = Math.max(0, images.length - 1);

        if (kind === 'collage') {
          stage.replaceChildren(...images.map((url) => mediaTile(url, t)));
          return;
        }

        stage.replaceChildren(...(images.length ? [mediaTile(images[index], t)] : []));
        if (single) return;

        const step = (delta) => {
          index = (index + delta + images.length) % images.length;
          render();
        };

        const count = document.createElement('span');
        count.className = 'tg-gallery-count';
        count.textContent = `${index + 1} / ${images.length}`;

        const dots = document.createElement('div');
        dots.className = 'tg-gallery-dots';
        images.forEach((_, i) => {
          const dot = navButton(
            `tg-gallery-dot${i === index ? ' active' : ''}`,
            String(i + 1),
            '',
            () => {
              index = i;
              render();
            },
          );
          dots.append(dot);
        });

        dom.append(
          navButton('tg-gallery-nav prev', t('gallery.prev'), '‹', () => step(-1)),
          navButton('tg-gallery-nav next', t('gallery.next'), '›', () => step(1)),
          count,
          dots,
        );
      };

      render();

      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== current.type.name) return false;
          current = updated;
          render();
          return true;
        },
        // The node view redraws itself; ProseMirror must not read its DOM back.
        ignoreMutation: () => true,
        // Let the controls take their own clicks, but leave every other event
        // to ProseMirror so the block can still be selected and deleted.
        stopEvent: (event) => {
          const target = event.target;
          return !!(target && target.closest && target.closest('button'));
        },
      };
    };
  },

  addCommands() {
    return {
      setGalleryBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

/** Map block — `InputRichBlockMap`. */
export const MapBlock = Node.create({
  name: 'mapBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latitude: {
        default: 0,
        parseHTML: (el) => parseFloat(el.getAttribute('data-lat')) || 0,
        renderHTML: (attrs) => ({ 'data-lat': String(attrs.latitude) }),
      },
      longitude: {
        default: 0,
        parseHTML: (el) => parseFloat(el.getAttribute('data-lon')) || 0,
        renderHTML: (attrs) => ({ 'data-lon': String(attrs.longitude) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div.tg-map' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { latitude, longitude } = node.attrs;
    return [
      'div',
      mergeAttributes(HTMLAttributes, { class: 'tg-map' }),
      `📍 ${latitude}, ${longitude}`,
    ];
  },

  addCommands() {
    return {
      setMapBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

/* ───────────────────── Premium entities & article extras ───────────────────── */

/**
 * Custom emoji — `RichTextCustomEmoji`, the Premium entity the Rich HTML
 * format exposes as `<tg-emoji emoji-id="…">fallback</tg-emoji>`.
 *
 * The emoji itself lives on Telegram's servers, so the editor shows the
 * fallback text in a highlighted chip; the chip travels as the fallback on the
 * wire, which is exactly what clients without the pack display.
 */
export const CustomEmoji = Node.create({
  name: 'customEmoji',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      emojiId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-emoji-id') || '',
        renderHTML: (attrs) => ({ 'data-emoji-id': attrs.emojiId || '' }),
      },
      fallback: {
        default: '✨',
        parseHTML: (el) => el.textContent || '✨',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-emoji-id]' }];
  },

  renderHTML({ node }) {
    return [
      'span',
      { 'data-emoji-id': node.attrs.emojiId || '', class: 'tg-emoji' },
      node.attrs.fallback || '✨',
    ];
  },

  addCommands() {
    return {
      insertCustomEmoji:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

/**
 * Date-time — `RichTextDateTime`, `<tg-time unix="…" format="…">text</tg-time>`.
 * Telegram renders a live date in the reader's own timezone; the inner text is
 * the fallback other clients show.
 */
export const DateTimeEntity = Node.create({
  name: 'dateTimeEntity',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      unix: {
        default: 0,
        parseHTML: (el) => parseInt(el.getAttribute('data-tg-time'), 10) || 0,
        renderHTML: (attrs) => ({ 'data-tg-time': String(attrs.unix || 0) }),
      },
      format: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-time-format') || '',
        renderHTML: (attrs) => (attrs.format ? { 'data-time-format': attrs.format } : {}),
      },
      text: {
        default: '',
        parseHTML: (el) => el.textContent || '',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-tg-time]' }];
  },

  renderHTML({ node }) {
    const shown = node.attrs.text || new Date((node.attrs.unix || 0) * 1000).toISOString();
    const attrs = { 'data-tg-time': String(node.attrs.unix || 0), class: 'tg-time' };
    // Same rule as the button row: anything the parse reads must render back,
    // or the format dies on the editor HTML round-trip.
    if (node.attrs.format) attrs['data-time-format'] = node.attrs.format;
    return ['span', attrs, shown];
  },

  addCommands() {
    return {
      insertDateTime:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

/**
 * Anchor — the empty `<a name="…"></a>` block Rich HTML documents. Targets the
 * in-document links produced with an ordinary `<a href="#name">`.
 */
export const AnchorEntity = Node.create({
  name: 'anchorEntity',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-tg-anchor') || '',
        renderHTML: (attrs) => ({ 'data-tg-anchor': attrs.name || '' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-tg-anchor]' }];
  },

  renderHTML({ node }) {
    return [
      'span',
      { 'data-tg-anchor': node.attrs.name || '', class: 'tg-anchor' },
      '⚓',
    ];
  },

  addCommands() {
    return {
      insertAnchor:
        (name = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { name } }),
    };
  },
});

/**
 * Reference — `<tg-reference name="…">text</tg-reference>`, text another link
 * can point at by name, the counterpart of a footnote definition.
 */
export const ReferenceMark = Mark.create({
  name: 'reference',

  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-tg-reference') || '',
        renderHTML: (attrs) => ({ 'data-tg-reference': attrs.name || '' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-tg-reference]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-tg-reference': '', class: 'tg-reference' }),
      0,
    ];
  },

  addCommands() {
    return {
      setReference:
        (name = '') =>
        ({ commands }) =>
          commands.setMark(this.name, { name }),
      toggleReference:
        (name = '') =>
        ({ commands }) =>
          commands.toggleMark(this.name, { name }),
      unsetReference:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return { 'Mod-Shift-r': () => this.editor.commands.unsetReference() };
  },
});

/**
 * Button row — `<tg-button-row align="…"><tg-button …>label</tg-button></tg-button-row>`.
 *
 * The buttons are stored as data in the node's attributes (the editor shows a
 * chip preview of each one) so the serialized row is rebuilt from source every
 * time — no half-edited button markup can survive.
 */
export const ButtonsRow = Node.create({
  name: 'buttonsRow',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      align: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-align') || '',
        renderHTML: (attrs) => (attrs.align ? { 'data-align': attrs.align } : {}),
      },
      buttons: {
        default: [],
        parseHTML: (el) => {
          try {
            const parsed = JSON.parse(el.getAttribute('data-buttons') || '[]');
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        },
        renderHTML: (attrs) => ({ 'data-buttons': JSON.stringify(attrs.buttons || []) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div.tg-buttons' }];
  },

  renderHTML({ node }) {
    const buttons = Array.isArray(node.attrs.buttons) ? node.attrs.buttons : [];
    const attrs = { class: 'tg-buttons', 'data-buttons': JSON.stringify(buttons) };
    // The stored align rides on the DOM too, or it could not survive the
    // HTML round-trip the autosave and the serializer both use.
    if (node.attrs.align) attrs['data-align'] = node.attrs.align;
    return [
      'div',
      attrs,
      ...buttons.map((b) => [
        'span',
        // The style rides as data so the editor chip can tint itself blue,
        // green or red the way Telegram colors the real buttons.
        { class: 'tg-btn-chip', 'data-style': String((b && b.style) || '') },
        String((b && b.label) || ''),
      ]),
    ];
  },

  addCommands() {
    return {
      setButtonsRow:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

/**
 * Inline button — `<tg-button …>label</tg-button>` riding *inside* a paragraph
 * (the Bot API 10.3 `RichTextButton`), as opposed to the `buttonsRow` block
 * that lays its chips out on their own line.
 *
 * The node renders the literal wire element: the shared serializer reads
 * `tg-button` nodes directly when building the outgoing message, and the
 * editor chip takes its tint from the same attributes the Telegram apps use.
 * A `link` style is legal only on callback buttons, so the parser accepts it
 * here but the serializer is the one that enforces the rule.
 */
export const InlineButton = Node.create({
  name: 'inlineButton',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      type: {
        default: 'url',
        parseHTML: (el) => {
          const declared = el.getAttribute('type') || '';
          return declared in BUTTON_KINDS ? declared : 'url';
        },
        renderHTML: (attrs) => ({ type: attrs.type || 'url' }),
      },
      style: {
        default: '',
        parseHTML: (el) => {
          // The editor chip carries it as data-style (the DOM `style`
          // attribute is reserved for CSS by the browser and normalises
          // non-CSS values away); pasted wire markup uses `style`.
          const declared = el.getAttribute('data-style') || el.getAttribute('style') || '';
          return BUTTON_STYLES.includes(declared) ? declared : '';
        },
      },
      label: {
        default: '',
        parseHTML: (el) => (el.textContent || '').trim(),
      },
      value: {
        default: '',
        parseHTML: (el) => {
          const key = BUTTON_KINDS[el.getAttribute('type') || ''] || '';
          return key ? el.getAttribute(key) || '' : '';
        },
        renderHTML: (attrs) => {
          const key = BUTTON_KINDS[attrs.type || 'url'] || '';
          return key && attrs.value ? { [key]: String(attrs.value) } : {};
        },
      },
      forwardText: {
        default: '',
        parseHTML: (el) => el.getAttribute('forward-text') || '',
        renderHTML: (attrs) => (attrs.forwardText ? { 'forward-text': attrs.forwardText } : {}),
      },
      requestWriteAccess: {
        default: false,
        parseHTML: (el) => el.hasAttribute('request-write-access'),
        renderHTML: (attrs) => (attrs.requestWriteAccess ? { 'request-write-access': '' } : {}),
      },
      allowUserChats: {
        default: false,
        parseHTML: (el) => el.hasAttribute('allow-user-chats'),
        renderHTML: (attrs) => (attrs.allowUserChats ? { 'allow-user-chats': '' } : {}),
      },
      allowBotChats: {
        default: false,
        parseHTML: (el) => el.hasAttribute('allow-bot-chats'),
        renderHTML: (attrs) => (attrs.allowBotChats ? { 'allow-bot-chats': '' } : {}),
      },
      allowGroupChats: {
        default: false,
        parseHTML: (el) => el.hasAttribute('allow-group-chats'),
        renderHTML: (attrs) => (attrs.allowGroupChats ? { 'allow-group-chats': '' } : {}),
      },
      allowChannelChats: {
        default: false,
        parseHTML: (el) => el.hasAttribute('allow-channel-chats'),
        renderHTML: (attrs) => (attrs.allowChannelChats ? { 'allow-channel-chats': '' } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'tg-button' }];
  },

  renderHTML({ node }) {
    const attrs = node.attrs || {};
    // Keep the class + data-style of the row buttons so the theme rules that
    // tint them tint the inline chip too; the wire `style` value itself is
    // rebuilt by the serialiser from the node, never read off the DOM.
    const key = BUTTON_KINDS[attrs.type || 'url'] || '';
    const chip = {
      type: attrs.type || 'url',
      class: 'tg-btn-chip',
      'data-style': String(attrs.style || ''),
    };
    if (attrs.value) chip[key] = String(attrs.value);
    if (attrs.forwardText) chip['forward-text'] = attrs.forwardText;
    if (attrs.requestWriteAccess) chip['request-write-access'] = '';
    if (attrs.allowUserChats) chip['allow-user-chats'] = '';
    if (attrs.allowBotChats) chip['allow-bot-chats'] = '';
    if (attrs.allowGroupChats) chip['allow-group-chats'] = '';
    if (attrs.allowChannelChats) chip['allow-channel-chats'] = '';
    return ['tg-button', chip, String(attrs.label || '')];
  },

  addCommands() {
    return {
      setInlineButton:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
      updateInlineButton:
        (attrs) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, attrs),
      removeInlineButton:
        () =>
        ({ commands }) =>
          commands.deleteSelection(),
    };
  },
});

/**
 * Thinking placeholder — `<tg-thinking>…</tg-thinking>`, a draft-only block
 * Telegram renders while a streamed reply is being written.
 */
export const ThinkingBlock = Node.create({
  name: 'thinkingBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      text: {
        default: 'Thinking...',
        parseHTML: (el) => el.getAttribute('data-text') || 'Thinking...',
        renderHTML: (attrs) => ({ 'data-text': attrs.text || 'Thinking...' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div.tg-thinking' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { class: 'tg-thinking' }),
      `💭 ${node.attrs.text || 'Thinking...'}`,
    ];
  },

  addCommands() {
    return {
      setThinkingBlock:
        (text = 'Thinking...') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { text } }),
    };
  },
});

/**
 * Table extras — the parts of the Rich HTML table spec TipTap's own Table
 * extension has no vocabulary for: a `<caption>`, the `striped`/`compact`
 * toggles, and per-cell `align`/`valign`.
 */
export const TableExtras = Extension.create({
  name: 'tableExtras',

  addGlobalAttributes() {
    return [
      {
        types: ['table'],
        attributes: {
          caption: {
            default: '',
            parseHTML: (el) => el.getAttribute('data-caption') || '',
            renderHTML: (attrs) => (attrs.caption ? { 'data-caption': attrs.caption } : {}),
          },
          striped: {
            default: false,
            parseHTML: (el) => el.hasAttribute('data-striped'),
            renderHTML: (attrs) => (attrs.striped ? { 'data-striped': '' } : {}),
          },
          compact: {
            default: false,
            parseHTML: (el) => el.hasAttribute('data-compact'),
            renderHTML: (attrs) => (attrs.compact ? { 'data-compact': '' } : {}),
          },
        },
      },
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          align: {
            default: '',
            parseHTML: (el) => el.getAttribute('data-align') || '',
            renderHTML: (attrs) => (attrs.align ? { 'data-align': attrs.align } : {}),
          },
          valign: {
            default: '',
            parseHTML: (el) => el.getAttribute('data-valign') || '',
            renderHTML: (attrs) => (attrs.valign ? { 'data-valign': attrs.valign } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setTableCaption:
        (caption = '') =>
        ({ commands }) =>
          commands.updateAttributes('table', { caption }),
      toggleTableStriped:
        () =>
        ({ commands, editor }) =>
          commands.updateAttributes('table', { striped: !(editor.getAttributes('table') || {}).striped }),
      toggleTableCompact:
        () =>
        ({ commands, editor }) =>
          commands.updateAttributes('table', { compact: !(editor.getAttributes('table') || {}).compact }),
      setCellAlign:
        (align = '') =>
        ({ commands, editor }) =>
          commands.updateAttributes(editor.isActive('tableHeader') ? 'tableHeader' : 'tableCell', {
            align,
          }),
      setCellValign:
        (valign = '') =>
        ({ commands, editor }) =>
          commands.updateAttributes(editor.isActive('tableHeader') ? 'tableHeader' : 'tableCell', {
            valign,
          }),
    };
  },
});

/**
 * Ordered-list extras — the `type` marker style, `reversed` direction and
 * per-item explicit `value` Rich HTML documents for `<ol>` and `<li>`.
 */
export const ListAttributes = Extension.create({
  name: 'listAttributes',

  addGlobalAttributes() {
    return [
      {
        types: ['orderedList', 'listItem'],
        attributes: {
          listType: {
            default: '',
            parseHTML: (el) => el.getAttribute('data-list-type') || '',
            renderHTML: (attrs) => (attrs.listType ? { 'data-list-type': attrs.listType } : {}),
          },
          value: {
            default: 0,
            parseHTML: (el) => parseInt(el.getAttribute('data-value'), 10) || 0,
            renderHTML: (attrs) => (attrs.value > 0 ? { 'data-value': String(attrs.value) } : {}),
          },
        },
      },
      {
        types: ['orderedList'],
        attributes: {
          reversed: {
            default: false,
            parseHTML: (el) => el.hasAttribute('data-reversed'),
            renderHTML: (attrs) => (attrs.reversed ? { 'data-reversed': '' } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setOrderedListType:
        (listType = '') =>
        ({ commands }) =>
          commands.updateAttributes('orderedList', { listType }),
      toggleOrderedListReversed:
        () =>
        ({ commands, editor }) =>
          commands.updateAttributes('orderedList', {
            reversed: !(editor.getAttributes('orderedList') || {}).reversed,
          }),
      setListItemValue:
        (value = 0) =>
        ({ commands }) =>
          commands.updateAttributes('listItem', { value: Number(value) || 0 }),
    };
  },
});

/**
 * Media spoiler — the `tg-spoiler` attribute Rich HTML puts on media inside a
 * `<figure>`, so a photo or video is hidden behind a blur until tapped.
 */
export const MediaSpoiler = Extension.create({
  name: 'mediaSpoiler',

  addGlobalAttributes() {
    return [
      {
        types: ['image'],
        attributes: {
          spoiler: {
            default: false,
            parseHTML: (el) => el.hasAttribute('data-spoiler'),
            renderHTML: (attrs) => (attrs.spoiler ? { 'data-spoiler': '' } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      toggleMediaSpoiler:
        () =>
        ({ commands, editor }) => {
          const node = ['image', 'mediaBlock'].find((name) => editor.isActive(name));
          if (!node) return false;
          const current = !!(editor.getAttributes(node) || {}).spoiler;
          return commands.updateAttributes(node, { spoiler: !current });
        },
    };
  },
});
