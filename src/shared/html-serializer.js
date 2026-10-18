/**
 * HTML serializer — turns the editor's DOM into the *Rich HTML style* that
 * `InputRichMessage.html` accepts.
 *
 * This is the wire format Bot API 10.1 actually documents for sending:
 *
 *   sendRichMessage → rich_message: { html | markdown, is_rtl?, skip_entity_detection? }
 *
 * Exactly one of `html` / `markdown` may be present, and there is no `blocks`
 * array on the sending side — `RichMessage.blocks` is what a bot *receives* back
 * inside `Message.rich_message`.
 *
 * Everything not in the documented tag list is unwrapped or dropped, so the
 * payload can never carry markup Telegram would reject.
 *
 * @module shared/html-serializer
 */

/* global DOMParser */

/** Documented limits for a single rich message. */
export const LIMITS = Object.freeze({
  CHARS: 32768,
  BLOCKS: 500,
  MEDIA: 50,
  TABLE_COLUMNS: 20,
  MAP_ZOOM_MIN: 13,
  MAP_ZOOM_MAX: 20,
  CHECKLIST_TASKS: 30,
  CHECKLIST_TASK_CHARS: 100,
  // Not a documented limit — inline keyboards in Telegram hold at most this
  // many buttons per row, and the editor dialog enforces the same bound.
  BUTTONS_PER_ROW: 8,
});

/** Inline tags that map straight through, editor tag → API tag. */
const INLINE_MAP = {
  STRONG: 'b',
  B: 'b',
  EM: 'i',
  I: 'i',
  U: 'u',
  INS: 'u',
  S: 's',
  DEL: 's',
  STRIKE: 's',
  CODE: 'code',
  MARK: 'mark',
  SUB: 'sub',
  SUP: 'sup',
};

/** Block tags that map straight through. */
const BLOCK_MAP = {
  P: 'p',
  H1: 'h1',
  H2: 'h2',
  H3: 'h3',
  H4: 'h4',
  H5: 'h5',
  H6: 'h6',
  FOOTER: 'footer',
  UL: 'ul',
  OL: 'ol',
  LI: 'li',
};

/**
 * URL schemes allowed on links, and the stricter set allowed on media.
 * Exported because the preview parsers apply the same lists — a URL the
 * message will not carry should not appear in the preview either.
 *
 * `tfrfile:` is the app's own scheme for media picked from the local disk. It
 * transports the absolute file path in the editor document and the preview,
 * which both run in the app where the scheme is registered; when the message
 * is built the scheme is rewritten to `tg://...?id=` references backed by a
 * real upload (see `rewriteLocalMedia`).
 */
export const LINK_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:', 'tg:'];
export const MEDIA_SCHEMES = ['http:', 'https:', 'tfrfile:'];

/** The scheme and host the editor uses to display a locally picked file. */
export const LOCAL_MEDIA_SCHEME = 'tfrfile://media/';

/** Telegram's upload channel for each media kind of a rich message. */
const MEDIA_REF_SCHEME = {
  photo: 'tg://photo?id=',
  video: 'tg://video?id=',
  animation: 'tg://video?id=',
  document: 'tg://document?id=',
  audio: 'tg://audio?id=',
  voice: 'tg://audio?id=',
};

/**
 * Turn an absolute path on disk into the editor's media URL.
 * @param {string} absolutePath
 * @returns {string}
 */
export function localFileUrl(absolutePath) {
  const posix = String(absolutePath || '').trim().replace(/\\/g, '/');
  return LOCAL_MEDIA_SCHEME + encodeURIComponent(posix);
}

/**
 * Turn the editor's media URL back into an absolute path.
 * @param {string} url
 * @returns {string}
 */
export function localUrlToPath(url) {
  if (!String(url || '').startsWith(LOCAL_MEDIA_SCHEME)) return '';
  const decoded = decodeURIComponent(String(url).slice(LOCAL_MEDIA_SCHEME.length));
  return decoded.replace(/[?#].*$/, '');
}

/**
 * The InputMedia type a local media file uploads as. A `.gif` rides a
 * `video` block but uploads as an animation, and a raw `.ogg` is a voice
 * note — matching how Telegram classifies the same files sent directly.
 * @param {string} path
 * @param {string} tag
 * @returns {'photo'|'video'|'animation'|'document'|'audio'|'voice'}
 */
export function localUploadType(path, tag) {
  const ext = (String(path).split('.').pop() || '').toLowerCase();
  if (tag === 'tg-document') return 'document';
  if (tag === 'img') return 'photo';
  if (tag === 'video') return ext === 'gif' ? 'animation' : 'video';
  if (tag === 'audio') return ['ogg', 'oga'].includes(ext) ? 'voice' : 'audio';
  return 'photo';
}

/**
 * Rewire media picked from the local disk into what the Bot API expects:
 * each `tfrfile://` src becomes a `tg://photo?id=` link, and the paths climb
 * out in `files` for the main process to attach as multipart uploads. Ids are
 * `m1`, `m2`, … — only `A-Z a-z 0-9 _ -`, 1–64 chars, as the spec requires —
 * and the same file picked twice uploads once and is referenced twice.
 *
 * @param {string} html
 * @returns {{ html: string, files: Array<{ id: string, path: string, type: string }>|null }}
 */
export function rewriteLocalMedia(html) {
  if (!String(html || '').includes('tfrfile://')) return { html, files: null };
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const files = [];
  const byPath = new Map();

  const TAGS = 'img, video, audio, tg-document';
  doc.querySelectorAll(TAGS).forEach((el) => {
    const src = el.getAttribute('src') || '';
    if (!src.startsWith(LOCAL_MEDIA_SCHEME)) return;
    const path = localUrlToPath(src);
    if (!path) return;
    if (!byPath.has(path)) {
      const id = `m${byPath.size + 1}`;
      const entry = { id, path, type: localUploadType(path, el.tagName.toLowerCase()) };
      byPath.set(path, entry);
      files.push(entry);
    }
    const entry = byPath.get(path);
    el.setAttribute('src', `${MEDIA_REF_SCHEME[entry.type]}${entry.id}`);
  });

  return { html: doc.body.innerHTML, files };
}

/**
 * Escape text for HTML output.
 * @param {string} text
 * @returns {string}
 */
export function escapeText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escape a value for use inside a double-quoted attribute.
 * @param {string} value
 * @returns {string}
 */
function escapeAttr(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

/**
 * Keep a URL only when its scheme is allowed.
 * @param {string} raw
 * @param {string[]} schemes
 * @returns {string} The URL, or '' when it is not acceptable.
 */
export function safeUrl(raw, schemes = LINK_SCHEMES) {
  const url = String(raw || '').trim();
  if (!url) return '';
  // In-document anchors are addresses, not schemes.
  if (schemes === LINK_SCHEMES && url.startsWith('#')) return url;
  const scheme = (url.match(/^([a-zA-Z][\w+.-]*:)/) || [])[1];
  if (!scheme) return '';
  return schemes.includes(scheme.toLowerCase()) ? url : '';
}

/**
 * Serialize the editor's HTML into Telegram's Rich HTML.
 *
 * Task lists have two destinations, and `inlineChecklist` picks between them:
 *
 *  - **on** (the normal case) — the task list is written into the message body
 *    as Rich HTML's own `<li><input type="checkbox">` list. Works in any chat,
 *    channels included, and keeps the checked state.
 *  - **off** — the items are lifted out of the body and returned separately for
 *    `sendChecklist`, Telegram's *interactive* checklist. That method only works
 *    for a bot acting for a connected business account in a private chat.
 *
 * Either way the items are reported, so the caller knows what it is sending.
 *
 * @param {string} editorHtml - `editor.getHTML()` output.
 * @param {object} [options]
 * @param {(html: string) => Document} [options.parse] - Injected for tests.
 * @param {boolean} [options.inlineChecklist] - Render task lists into the body.
 * @returns {{
 *   html: string,
 *   checklist: Array<{ text: string, done: boolean }>,
 *   inlinedChecklist: boolean,
 *   thinkingDropped: number,
 *   blocks: number,
 *   media: number,
 *   chars: number,
 * }}
 */
export function serializeEditorHtml(editorHtml, options = {}) {
  const parse =
    options.parse || ((html) => new DOMParser().parseFromString(html, 'text/html'));
  const doc = parse(`<div id="tfr-root">${editorHtml || ''}</div>`);
  const root = doc.getElementById
    ? doc.getElementById('tfr-root')
    : doc.body && doc.body.firstChild;

  const state = {
    blocks: 0,
    media: 0,
    checklist: [],
    inlineChecklist: !!options.inlineChecklist,
    // `<tg-thinking>` is documented for `sendRichMessageDraft` streams only —
    // a plain `sendRichMessage` carrying it answers the API error
    // `rich_message_block_unsupported`. The default strips the placeholder
    // from the payload and reports how many were left out, so the caller can
    // tell the user; draft mode keeps them.
    keepThinking: !!options.keepThinking,
    thinkingDropped: 0,
  };
  const html = root ? childrenToHtml(root, state) : '';
  const text = root ? root.textContent || '' : '';

  return {
    html: html.trim(),
    checklist: state.checklist,
    inlinedChecklist: state.inlineChecklist && state.checklist.length > 0,
    thinkingDropped: state.thinkingDropped,
    blocks: state.blocks,
    media: state.media,
    chars: text.length,
  };
}

/**
 * @param {Element} parent
 * @param {object} state
 * @param {boolean} [inlineOnly] - Table cells accept inline formatting only.
 * @returns {string}
 */
function childrenToHtml(parent, state, inlineOnly = false) {
  let out = '';
  for (const node of parent.childNodes) out += nodeToHtml(node, state, inlineOnly);
  return out;
}

/**
 * @param {Node} node
 * @param {object} state
 * @param {boolean} inlineOnly
 * @returns {string}
 */
function nodeToHtml(node, state, inlineOnly) {
  if (node.nodeType === 3) return escapeText(node.nodeValue || '');
  if (node.nodeType !== 1) return '';

  const el = /** @type {Element} */ (node);
  const tag = el.tagName;

  // ── inline ──
  if (INLINE_MAP[tag]) {
    // <code> inside <pre> is handled by the PRE branch.
    const inner = childrenToHtml(el, state, inlineOnly);
    return inner ? `<${INLINE_MAP[tag]}>${inner}</${INLINE_MAP[tag]}>` : '';
  }

  if (tag === 'BR') return '\n';

  if (tag === 'A') {
    const href = safeUrl(el.getAttribute('href') || '');
    const inner = childrenToHtml(el, state, inlineOnly);
    if (!inner) return '';
    return href ? `<a href="${escapeAttr(href)}">${inner}</a>` : inner;
  }

  if (tag === 'SPAN') {
    const inner = childrenToHtml(el, state, inlineOnly);

    if (el.hasAttribute('data-spoiler')) return `<tg-spoiler>${inner}</tg-spoiler>`;
    if (el.hasAttribute('data-inline-math')) return `<tg-math>${inner}</tg-math>`;

    // `<tg-reference name="…">` — text another link can point at by name.
    if (el.hasAttribute('data-tg-reference')) {
      const name = (el.getAttribute('data-tg-reference') || '').trim();
      return name ? `<tg-reference name="${escapeAttr(name)}">${inner}</tg-reference>` : inner;
    }

    // `<tg-emoji emoji-id="…">👍</tg-emoji>` — the Premium custom emoji entity.
    // The fallback text travels with it, exactly as the format documents.
    if (el.hasAttribute('data-emoji-id')) {
      const id = (el.getAttribute('data-emoji-id') || '').trim();
      return id ? `<tg-emoji emoji-id="${escapeAttr(id)}">${inner.trim()}</tg-emoji>` : '';
    }

    // `<tg-time unix="…" format="…">22:45 tomorrow</tg-time>` — a live
    // date-time chip, with the plain text shown where it is not supported.
    if (el.hasAttribute('data-tg-time')) {
      const unix = parseInt(el.getAttribute('data-tg-time'), 10);
      if (!Number.isFinite(unix)) return '';
      const format = (el.getAttribute('data-time-format') || '').trim();
      const attrs = ` unix="${unix}"${format ? ` format="${escapeAttr(format)}"` : ''}`;
      return `<tg-time${attrs}>${inner}</tg-time>`;
    }

    // `<a name="…"></a>` — an empty anchor block to link to with `#name`.
    // Not meaningful inside a table cell, where blocks are not allowed.
    if (el.hasAttribute('data-tg-anchor')) {
      const name = (el.getAttribute('data-tg-anchor') || '').trim();
      if (inlineOnly || !name) return '';
      state.blocks += 1;
      return `<a name="${escapeAttr(name)}"></a>`;
    }

    return inner;
  }

  // `<tg-button …>` — the 10.3 inline button (RichTextButton): a clickable
  // chip riding inside a paragraph, not a `<tg-button-row>` block. Allowed in
  // table cells too, so it serializes before the inlineOnly unwrap below.
  if (tag === 'TG-BUTTON') {
    return buttonToHtml(elToRawButton(el)) || '';
  }

  // Inside a table cell nothing below this point is allowed — unwrap it.
  if (inlineOnly) return childrenToHtml(el, state, true);

  // ── blocks ──
  if (BLOCK_MAP[tag]) {
    if (tag === 'UL' && isTaskList(el)) {
      const before = state.checklist.length;
      collectChecklist(el, state);
      if (!state.inlineChecklist) return '';
      return checklistToHtml(state.checklist.slice(before), state);
    }
    state.blocks += 1;
    // A list item holding a single paragraph reads better without the wrapper.
    const source = tag === 'LI' ? unwrapLoneParagraph(el) : el;
    const inner = childrenToHtml(source, state);
    if (!inner.trim() && tag !== 'LI') return '';
    const name = BLOCK_MAP[tag];
    let open = `<${name}`;
    if (tag === 'OL') {
      // The documented list attributes: a start number, a marker style and
      // a reversed direction.
      const start = el.getAttribute('start');
      if (start) open += ` start="${escapeAttr(start)}"`;
      const listType = (el.getAttribute('data-list-type') || '').trim();
      if (/^[aAiI]$/.test(listType)) open += ` type="${listType}"`;
      if (el.hasAttribute('data-reversed')) open += ' reversed';
    }
    if (tag === 'LI') {
      const value = parseInt(el.getAttribute('data-value'), 10);
      if (Number.isFinite(value) && value > 0) open += ` value="${value}"`;
      const listType = (el.getAttribute('data-list-type') || '').trim();
      if (/^[aAiI]$/.test(listType)) open += ` type="${listType}"`;
    }
    open += '>';
    return `${open}${inner}</${name}>`;
  }

  if (tag === 'HR') {
    state.blocks += 1;
    return '<hr/>';
  }

  if (tag === 'BLOCKQUOTE') {
    state.blocks += 1;
    const inner = childrenToHtml(el, state);
    const credit = el.getAttribute('data-attribution');
    const cite = credit ? `<cite>${escapeText(credit)}</cite>` : '';
    // A pull quote is <aside> in the API dialect.
    if (el.hasAttribute('data-pullquote')) return `<aside>${inner}${cite}</aside>`;
    // `<blockquote expandable>` — collapsed to one line until tapped.
    const expandable = el.hasAttribute('data-expandable') ? ' expandable' : '';
    return `<blockquote${expandable}>${inner}${cite}</blockquote>`;
  }

  if (tag === 'PRE') {
    state.blocks += 1;
    const codeEl = el.querySelector('code');
    const language = (((codeEl && codeEl.className) || '').match(/language-([\w+#-]+)/) || [])[1];
    const body = escapeText((codeEl || el).textContent || '');
    return language
      ? `<pre><code class="language-${escapeAttr(language)}">${body}</code></pre>`
      : `<pre>${body}</pre>`;
  }

  if (tag === 'TABLE') return tableToHtml(el, state);

  if (tag === 'DETAILS') {
    state.blocks += 1;
    const summaryEl = el.querySelector('summary');
    const summary = escapeText(
      (summaryEl && summaryEl.textContent) || el.getAttribute('data-summary') || 'Details',
    );
    let inner = '';
    for (const child of el.childNodes) {
      if (child === summaryEl) continue;
      inner += nodeToHtml(child, state, false);
    }
    return `<details open><summary>${summary}</summary>${inner}</details>`;
  }

  if (tag === 'IMG') {
    const src = safeUrl(el.getAttribute('src') || '', MEDIA_SCHEMES);
    if (!src) return '';
    state.blocks += 1;
    state.media += 1;
    const body = `<img src="${escapeAttr(src)}"${el.hasAttribute('data-spoiler') ? ' tg-spoiler' : ''}/>${figcaptionOf(el)}`;
    // The spec documents the spoiler attribute on media inside a <figure>.
    return el.hasAttribute('data-spoiler') ? `<figure>${body}</figure>` : body;
  }

  if (tag === 'VIDEO' || tag === 'AUDIO') {
    const src = safeUrl(el.getAttribute('src') || '', MEDIA_SCHEMES);
    if (!src) return '';
    state.blocks += 1;
    state.media += 1;
    const name = tag.toLowerCase();
    const body = `<${name} src="${escapeAttr(src)}"${el.hasAttribute('data-spoiler') ? ' tg-spoiler' : ''}></${name}>${figcaptionOf(el)}`;
    return el.hasAttribute('data-spoiler') ? `<figure>${body}</figure>` : body;
  }

  // `<tg-document src="…"></tg-document>` — a general file block.
  if (tag === 'TG-DOCUMENT') {
    const src = safeUrl(el.getAttribute('src') || '', MEDIA_SCHEMES);
    if (!src) return '';
    state.blocks += 1;
    state.media += 1;
    return `<tg-document src="${escapeAttr(src)}"></tg-document>${figcaptionOf(el)}`;
  }

  if (tag === 'DIV' && el.classList) {
    if (el.classList.contains('tg-math')) {
      state.blocks += 1;
      const formula = el.getAttribute('data-formula') || (el.textContent || '').replace(/^\$\$|\$\$$/g, '');
      return `<tg-math-block>${escapeText(formula)}</tg-math-block>`;
    }
    if (el.classList.contains('tg-gallery')) return galleryToHtml(el, state);
    if (el.classList.contains('tg-buttons')) return buttonsToHtml(el, state);
    if (el.classList.contains('tg-thinking')) {
      // Draft-only block: Telegram's HTML parser rejects it outside a
      // `sendRichMessageDraft` stream with `rich_message_block_unsupported`,
      // so a plain send drops it instead of risking the error.
      if (!state.keepThinking) {
        state.thinkingDropped += 1;
        return '';
      }
      state.blocks += 1;
      const text = (el.getAttribute('data-text') || 'Thinking...').trim() || 'Thinking...';
      return `<tg-thinking>${escapeText(text)}</tg-thinking>`;
    }
    if (el.classList.contains('tg-map')) {
      const lat = parseFloat(el.getAttribute('data-lat'));
      const lon = parseFloat(el.getAttribute('data-lon'));
      // Range as well as NaN: a point off the globe is refused by Telegram, and
      // the error it sends back says nothing about which block caused it.
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return '';
      state.blocks += 1;
      return `<tg-map lat="${lat}" long="${lon}" zoom="${LIMITS.MAP_ZOOM_MIN}"/>`;
    }
  }

  // Anything else: keep the content, drop the wrapper.
  return childrenToHtml(el, state, inlineOnly);
}

/**
 * A list item whose only child is a paragraph renders as bare text.
 * @param {Element} li
 * @returns {Element}
 */
function unwrapLoneParagraph(li) {
  const children = Array.from(li.children);
  if (children.length === 1 && children[0].tagName === 'P') return children[0];
  return li;
}

/**
 * @param {Element} el
 * @returns {boolean}
 */
function isTaskList(el) {
  if (el.getAttribute('data-type') === 'taskList') return true;
  const items = el.querySelectorAll('li');
  for (const li of items) {
    if (li.querySelector('input[type="checkbox"]') || li.hasAttribute('data-checked')) return true;
  }
  return false;
}

/**
 * Pull task items out of the document for the separate checklist API.
 * @param {Element} el
 * @param {object} state
 */
function collectChecklist(el, state) {
  for (const li of el.querySelectorAll(':scope > li')) {
    const checkbox = li.querySelector('input[type="checkbox"]');
    const done = checkbox
      ? checkbox.checked || checkbox.getAttribute('checked') !== null
      : li.getAttribute('data-checked') === 'true';
    const text = (li.textContent || '').trim();
    if (text) state.checklist.push({ text, done: !!done });
  }
}

/**
 * Render collected task items as Rich HTML's own task list.
 *
 * A list item holding `<input type="checkbox">` is part of the documented Rich
 * HTML vocabulary, so Telegram draws real checkboxes — in a channel, a group or
 * a private chat alike, with the checked state preserved. This is the ordinary
 * way to put a checklist in a message; `sendChecklist` is the separate,
 * business-account-only *interactive* checklist.
 *
 * @param {Array<{ text: string, done: boolean }>} items
 * @param {object} state
 * @returns {string}
 */
function checklistToHtml(items, state) {
  if (!items.length) return '';
  state.blocks += 1 + items.length;
  const rows = items
    .map(
      (item) =>
        `<li><input type="checkbox"${item.done ? ' checked' : ''}>${escapeText(item.text)}</li>`,
    )
    .join('');
  return `<ul>${rows}</ul>`;
}

/**
 * The `<figcaption>` a media element or gallery may carry.
 *
 * Rich HTML puts the caption *after* the media it belongs to, and the caption
 * may name a source of its own:
 *
 *   <video src="…"/><figcaption>Clip title<cite>The Author</cite></figcaption>
 *
 * @param {Element} el
 * @returns {string}
 */
function figcaptionOf(el) {
  const caption = (el.getAttribute('data-caption') || '').trim();
  const credit = (el.getAttribute('data-credit') || '').trim();
  if (!caption && !credit) return '';
  const cite = credit ? `<cite>${escapeText(credit)}</cite>` : '';
  return `<figcaption>${escapeText(caption)}${cite}</figcaption>`;
}

/**
 * Serialize a `<table>`.
 *
 * Everything the Rich HTML spec supports on a table is carried across: a
 * caption, the `striped`/`compact` toggles, and per-cell `colspan`, `rowspan`,
 * `align` and `valign`. Cells keep inline formatting only.
 *
 * @param {Element} el
 * @param {object} state
 * @returns {string}
 */
function tableToHtml(el, state) {
  const rows = Array.from(el.querySelectorAll('tr'));
  if (!rows.length) return '';
  state.blocks += 1;

  let open = '<table bordered';
  if (el.hasAttribute('data-striped')) open += ' striped';
  if (el.hasAttribute('data-compact')) open += ' compact';
  open += '>';

  const caption = (el.getAttribute('data-caption') || '').trim();
  if (caption) open += `<caption>${escapeText(caption)}</caption>`;

  let body = '';
  for (const tr of rows) {
    const cells = Array.from(tr.querySelectorAll('th, td')).slice(0, LIMITS.TABLE_COLUMNS);
    if (!cells.length) continue;
    let row = '';
    for (const cell of cells) {
      let attrs = '';
      const colspan = parseInt(cell.getAttribute('colspan'), 10);
      if (Number.isFinite(colspan) && colspan > 1) attrs += ` colspan="${colspan}"`;
      const rowspan = parseInt(cell.getAttribute('rowspan'), 10);
      if (Number.isFinite(rowspan) && rowspan > 1) attrs += ` rowspan="${rowspan}"`;
      // Cell alignment set through the table bubble menu rides in as data
      // attributes; only the values the spec documents go on the wire.
      const align = (cell.getAttribute('data-align') || '').trim();
      if (/^(left|center|right)$/.test(align)) attrs += ` align="${align}"`;
      const valign = (cell.getAttribute('data-valign') || '').trim();
      if (/^(top|middle|bottom)$/.test(valign)) attrs += ` valign="${valign}"`;
      const name = cell.tagName === 'TH' ? 'th' : 'td';
      // Table cells carry inline formatting only.
      row += `<${name}${attrs}>${childrenToHtml(cell, state, true)}</${name}>`;
    }
    body += `<tr>${row}</tr>`;
  }
  return body ? `${open}${body}</table>` : '';
}

/** The button kinds Rich HTML accepts, with the attribute each one reads. */
export const BUTTON_KINDS = Object.freeze({
  url: 'url',
  callback_data: 'data',
  web_app: 'url',
  login_url: 'url',
  switch_inline_query: 'query',
  switch_inline_query_current_chat: 'query',
  switch_inline_query_chosen_chat: 'query',
  copy_text: 'text',
  disabled: '',
});

export const BUTTON_STYLES = Object.freeze(['primary', 'success', 'link', 'danger']);

/** Schemes a `url` button may point at — inline mentions included. */
export const BUTTON_URL_SCHEMES = Object.freeze(['http:', 'https:', 'tg:']);

/** The `switch_inline_query_chosen_chat` allow-flags and their attributes. */
const CHOSEN_CHAT_FLAGS = Object.freeze([
  ['allowUserChats', 'allow-user-chats'],
  ['allowBotChats', 'allow-bot-chats'],
  ['allowGroupChats', 'allow-group-chats'],
  ['allowChannelChats', 'allow-channel-chats'],
]);

/**
 * Rebuild an editor button record from a literal `<tg-button …>` element — the
 * shape the editor's inline-button node renders, so wire HTML pasted or
 * round-tripped through the clipboard keeps its fields. The style lives in
 * `data-style` on editor markup (the DOM `style` attribute is CSS) and in the
 * wire `style` attribute on pasted markup.
 *
 * Exported because the preview's inline parser shares this reading — it needs
 * the same `{ type, style, label, value, … }` record to draw the chip.
 *
 * @param {Element} el
 * @returns {object}
 */
export function elToRawButton(el) {
  const declared = el.getAttribute('type') || '';
  const kind = declared in BUTTON_KINDS ? declared : 'url';
  const valueKey = BUTTON_KINDS[kind];
  const wireStyle = el.getAttribute('style') || '';
  return {
    type: kind,
    style: el.getAttribute('data-style') || wireStyle,
    label: el.textContent || '',
    value: valueKey ? el.getAttribute(valueKey) || '' : '',
    forwardText: el.getAttribute('forward-text') || '',
    requestWriteAccess: el.hasAttribute('request-write-access'),
    allowUserChats: el.hasAttribute('allow-user-chats'),
    allowBotChats: el.hasAttribute('allow-bot-chats'),
    allowGroupChats: el.hasAttribute('allow-group-chats'),
    allowChannelChats: el.hasAttribute('allow-channel-chats'),
  };
}

/**
 * Serialize one button from its editor record `{ type, style, label, value, … }`.
 *
 * Every field is validated against the documented shapes here — a button the
 * spec would reject is dropped rather than sent, the same policy the media and
 * link handling follow. Per the 10.3 docs, the `link` style (a borderless
 * regular link) is allowed only on callback buttons; elsewhere it is not
 * carried rather than risking an API error.
 *
 * @param {object} raw
 * @returns {string|null} The `<tg-button …>` tag, or null when unusable.
 */
function buttonToHtml(raw) {
  const label = String((raw && raw.label) || '').trim();
  if (!label) return null;
  const kind = raw && raw.type in BUTTON_KINDS ? raw.type : 'url';

  let attrs = ` type="${kind}"`;
  const style = raw && raw.style && BUTTON_STYLES.includes(raw.style) ? raw.style : '';
  if (style && !(style === 'link' && kind !== 'callback_data')) {
    attrs += ` style="${escapeAttr(style)}"`;
  }

  const value = String((raw && raw.value) || '');
  // `url`, `web_app` and `login_url` all point at a link — the schemes they
  // may use differ, and `web_app` is strictly https (Telegram's rule for
  // Mini Apps).
  const schemeAllowlist =
    kind === 'web_app' || kind === 'login_url'
      ? ['https:']
      : kind === 'url'
        ? BUTTON_URL_SCHEMES
        : null;

  if (schemeAllowlist) {
    const url = safeUrl(value.trim(), schemeAllowlist);
    if (!url) return null;
    attrs += ` url="${escapeAttr(url)}"`;
    if (kind === 'login_url') {
      const forward = String((raw && raw.forwardText) || '').trim();
      if (forward) attrs += ` forward-text="${escapeAttr(forward)}"`;
      if (raw && raw.requestWriteAccess) attrs += ' request-write-access';
    }
  } else if (kind === 'callback_data') {
    const data = value.trim();
    if (!data) return null;
    attrs += ` data="${escapeAttr(data)}"`;
  } else if (kind === 'copy_text') {
    if (!value) return null;
    attrs += ` text="${escapeAttr(value)}"`;
  } else if (kind.startsWith('switch_inline_query')) {
    attrs += ` query="${escapeAttr(value)}"`;
  }
  // `disabled` carries no target at all — the label is the whole button.

  if (kind === 'switch_inline_query_chosen_chat') {
    for (const [flag, attr] of CHOSEN_CHAT_FLAGS) {
      if (raw && raw[flag]) attrs += ` ${attr}`;
    }
  }

  return `<tg-button${attrs}>${escapeText(label)}</tg-button>`;
}

/**
 * Serialize a button row (`div.tg-buttons`).
 *
 * The buttons live in a `data-buttons` JSON attribute as
 * `{ type, style, label, value, … }`.
 *
 * @param {Element} el
 * @param {object} state
 * @returns {string}
 */
function buttonsToHtml(el, state) {
  let buttons;
  try {
    buttons = JSON.parse(el.getAttribute('data-buttons') || '[]');
  } catch {
    return '';
  }
  if (!Array.isArray(buttons)) return '';

  const list = [];
  for (const raw of buttons.slice(0, LIMITS.BUTTONS_PER_ROW)) {
    const tag = buttonToHtml(raw);
    if (tag) list.push(tag);
  }
  if (!list.length) return '';

  state.blocks += 1 + list.length;
  const align = (el.getAttribute('data-align') || '').trim();
  const alignAttr = ['left', 'center', 'right'].includes(align) ? ` align="${align}"` : '';
  return `<tg-button-row${alignAttr}>${list.join('')}</tg-button-row>`;
}

/**
 * @param {Element} el
 * @param {object} state
 * @returns {string}
 */
function galleryToHtml(el, state) {
  const attr = el.getAttribute('data-images') || '';
  const listed = attr.split(',').filter(Boolean);
  const sources = (
    listed.length
      ? listed
      : Array.from(el.querySelectorAll('img')).map((img) => img.getAttribute('src') || '')
  )
    .map((src) => safeUrl(src, MEDIA_SCHEMES))
    .filter(Boolean);

  if (!sources.length) return '';
  const wrapper = el.getAttribute('data-kind') === 'collage' ? 'tg-collage' : 'tg-slideshow';
  state.blocks += 1;
  state.media += sources.length;
  const images = sources.map((src) => `<img src="${escapeAttr(src)}"/>`).join('');
  return `<${wrapper}>${images}${figcaptionOf(el)}</${wrapper}>`;
}

/* ═══════════════════════════ Request bodies ═══════════════════════════ */

/**
 * Build the `InputRichMessage` object.
 * @param {string} html
 * @param {{ isRtl?: boolean, skipEntityDetection?: boolean }} [options]
 * @returns {object}
 */
export function buildInputRichMessage(html, options = {}) {
  // Media picked from the local disk travels in the editor as `tfrfile://`
  // URLs; here each becomes a `tg://photo?id=` reference and its path climbs
  // out onto `_files` — an internal manifest the body builders hoist to the
  // top level for the main process, which attaches the real uploads as
  // multipart parts named `m1`, `m2`, … and then strips the field.
  const { html: wireHtml, files } = rewriteLocalMedia(html);
  const richMessage = { html: wireHtml };
  if (files && files.length) {
    richMessage.media = files.map(({ id, type }) => ({
      id,
      media: { type, media: `attach://${id}` },
    }));
    richMessage._files = files.map(({ id, path }) => ({ name: id, path }));
  }
  if (options.isRtl) richMessage.is_rtl = true;
  if (options.skipEntityDetection) richMessage.skip_entity_detection = true;
  return richMessage;
}

/**
 * `_files` is an internal manifest, not part of `InputRichMessage`: the main
 * process reads it from the *top-level* body to know which local files to
 * attach as multipart parts, and strips it before anything goes on the wire.
 * Left inside `rich_message` it would ride the JSON to Telegram — absolute
 * local paths in plain sight — while the actual uploads never reached the
 * request, and the API answered
 * "Bad Request: Can't parse InputRichMessageMedia: media not found".
 *
 * @param {object} body
 * @param {object} richMessage
 * @returns {object} the same body, with the manifest hoisted when present
 */
function hoistAttachments(body, richMessage) {
  if (Array.isArray(richMessage._files) && richMessage._files.length) {
    body._files = richMessage._files;
    delete richMessage._files;
  }
  return body;
}

/**
 * Body for `sendRichMessage`.
 * @param {string} html
 * @param {string} chatId
 * @param {object} [options]
 * @returns {object}
 */
export function buildRichMessageBody(html, chatId, options = {}) {
  const richMessage = buildInputRichMessage(html, options);
  return hoistAttachments({ chat_id: chatId, rich_message: richMessage }, richMessage);
}

/**
 * Body for `sendRichMessageDraft`.
 * Drafts are private-chat only and need a non-zero draft_id.
 * @param {string} html
 * @param {string|number} chatId
 * @param {number} draftId
 * @param {object} [options]
 * @returns {object}
 */
export function buildDraftBody(html, chatId, draftId, options = {}) {
  const richMessage = buildInputRichMessage(html, options);
  return hoistAttachments(
    { chat_id: Number(chatId), draft_id: draftId, rich_message: richMessage },
    richMessage,
  );
}

/**
 * Body for `editMessageText` with rich content.
 * @param {string} html
 * @param {string} chatId
 * @param {string|number} messageId
 * @param {object} [options]
 * @returns {object}
 */
export function buildEditBody(html, chatId, messageId, options = {}) {
  const richMessage = buildInputRichMessage(html, options);
  return hoistAttachments(
    { chat_id: chatId, message_id: Number(messageId) || messageId, rich_message: richMessage },
    richMessage,
  );
}

/**
 * Body for `sendChecklist`.
 *
 * `InputChecklist` is `{ title, tasks }`, and each `InputChecklistTask` is
 * `{ id, text }` with a positive id unique within the checklist. There is no
 * per-task "done" flag on the sending side — a task can only be ticked
 * afterwards, through `markChecklistTasksAsDone` — so `done` is dropped here.
 *
 * `business_connection_id` is required by the method: a checklist is always
 * sent on behalf of a connected business account.
 *
 * @param {Array<{ text: string, done: boolean }>} items
 * @param {string} chatId
 * @param {{ title?: string, businessConnectionId?: string }} [options]
 * @returns {object}
 */
export function buildChecklistBody(items, chatId, options = {}) {
  const body = {
    chat_id: chatId,
    checklist: {
      title: options.title || '',
      tasks: (items || []).slice(0, LIMITS.CHECKLIST_TASKS).map((item, index) => ({
        id: index + 1,
        text: (item.text || '').slice(0, LIMITS.CHECKLIST_TASK_CHARS),
      })),
    },
  };
  if (options.businessConnectionId) {
    body.business_connection_id = options.businessConnectionId;
  }
  return body;
}

/**
 * Check a checklist against the documented limits before sending.
 * @param {Array<{ text: string }>} items
 * @returns {{ ok: boolean, reason?: 'empty'|'tasks'|'taskChars' }}
 */
export function checkChecklist(items) {
  const list = items || [];
  if (list.length === 0) return { ok: false, reason: 'empty' };
  if (list.length > LIMITS.CHECKLIST_TASKS) return { ok: false, reason: 'tasks' };
  for (const item of list) {
    if ((item.text || '').length > LIMITS.CHECKLIST_TASK_CHARS) {
      return { ok: false, reason: 'taskChars' };
    }
  }
  return { ok: true };
}

/**
 * Check a serialized message against the documented limits.
 * @param {{ chars: number, blocks: number, media: number }} stats
 * @returns {{ ok: boolean, reason?: 'chars'|'blocks'|'media' }}
 */
export function checkLimits(stats) {
  if (stats.chars > LIMITS.CHARS) return { ok: false, reason: 'chars' };
  if (stats.blocks > LIMITS.BLOCKS) return { ok: false, reason: 'blocks' };
  if (stats.media > LIMITS.MEDIA) return { ok: false, reason: 'media' };
  return { ok: true };
}

/**
 * Whether a chat ID addresses a private chat (drafts require one).
 * @param {string} chatId
 * @returns {boolean}
 */
export function isPrivateChatId(chatId) {
  return /^\d+$/.test(String(chatId || '').trim());
}
