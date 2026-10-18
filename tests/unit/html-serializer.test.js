/**
 * Unit tests for the Rich HTML serializer.
 *
 * These pin the wire format documented for Bot API 10.1: `sendRichMessage`
 * takes `rich_message: { html | markdown }` — never a `blocks` array — and the
 * HTML may only use the documented tag vocabulary.
 */
import { describe, it, expect } from 'vitest';
import {
  LIMITS,
  buildChecklistBody,
  buildDraftBody,
  buildEditBody,
  buildInputRichMessage,
  buildRichMessageBody,
  checkChecklist,
  checkLimits,
  checkNestingDepth,
  escapeText,
  isPrivateChatId,
  LINK_SCHEMES,
  localFileUrl,
  localUrlToPath,
  mediaKindOf,
  MEDIA_SCHEMES,
  rewriteLocalMedia,
  safeUrl,
  serializeEditorHtml,
} from '../../src/shared/html-serializer.js';

/** @param {string} editorHtml */
const ser = (editorHtml) => serializeEditorHtml(editorHtml);
/** @param {string} editorHtml */
const html = (editorHtml) => ser(editorHtml).html;

describe('inline formatting', () => {
  it('maps every editor mark to its API tag', () => {
    expect(html('<p><strong>b</strong></p>')).toBe('<p><b>b</b></p>');
    expect(html('<p><em>i</em></p>')).toBe('<p><i>i</i></p>');
    expect(html('<p><u>u</u></p>')).toBe('<p><u>u</u></p>');
    expect(html('<p><s>s</s></p>')).toBe('<p><s>s</s></p>');
    expect(html('<p><code>c</code></p>')).toBe('<p><code>c</code></p>');
    expect(html('<p><mark>m</mark></p>')).toBe('<p><mark>m</mark></p>');
    expect(html('<p><sub>x</sub><sup>y</sup></p>')).toBe('<p><sub>x</sub><sup>y</sup></p>');
  });

  it('turns the spoiler span into <tg-spoiler>', () => {
    expect(html('<p><span data-spoiler="">shh</span></p>')).toBe('<p><tg-spoiler>shh</tg-spoiler></p>');
  });

  it('turns inline math into <tg-math>', () => {
    expect(html('<p><span data-inline-math="">a^2</span></p>')).toBe('<p><tg-math>a^2</tg-math></p>');
  });

  it('keeps nesting order', () => {
    expect(html('<p><strong><em>x</em></strong></p>')).toBe('<p><b><i>x</i></b></p>');
  });

  it('unwraps spans it does not know', () => {
    expect(html('<p><span style="color:red">x</span></p>')).toBe('<p>x</p>');
  });

  it('turns <br> into a newline', () => {
    expect(html('<p>a<br>b</p>')).toBe('<p>a\nb</p>');
  });

  it('escapes text', () => {
    expect(html('<p>a &lt; b &amp; c</p>')).toBe('<p>a &lt; b &amp; c</p>');
    expect(escapeText('<script>')).toBe('&lt;script&gt;');
  });
});

describe('links', () => {
  it('keeps http, https, mailto, tel, tg and anchors', () => {
    for (const url of [
      'https://t.me/x',
      'http://a.test',
      'mailto:a@b.c',
      'tel:+123456789',
      'tg://user?id=1',
      '#anchor',
    ]) {
      expect(html(`<p><a href="${url}">t</a></p>`), url).toBe(`<p><a href="${url}">t</a></p>`);
    }
  });

  it('drops the anchor but keeps the text for unsafe schemes', () => {
    expect(html('<p><a href="javascript:alert(1)">t</a></p>')).toBe('<p>t</p>');
    expect(html('<p><a href="data:text/html,x">t</a></p>')).toBe('<p>t</p>');
  });

  it('escapes quotes in the href', () => {
    expect(html('<p><a href="https://a/?q=&quot;x&quot;">t</a></p>')).toContain('&quot;');
  });
});

describe('blocks', () => {
  it('keeps headings, paragraphs, footers and dividers', () => {
    expect(html('<h2>T</h2>')).toBe('<h2>T</h2>');
    expect(html('<h6>T</h6>')).toBe('<h6>T</h6>');
    expect(html('<footer>f</footer>')).toBe('<footer>f</footer>');
    expect(html('<hr>')).toBe('<hr/>');
  });

  it('unwraps a lone paragraph inside a list item', () => {
    expect(html('<ul><li><p>a</p></li></ul>')).toBe('<ul><li>a</li></ul>');
    expect(html('<ul><li><p>a</p><p>b</p></li></ul>')).toBe('<ul><li><p>a</p><p>b</p></li></ul>');
  });

  it('keeps lists and preserves an ordered list start', () => {
    expect(html('<ul><li>a</li><li>b</li></ul>')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(html('<ol start="3"><li>a</li></ol>')).toBe('<ol start="3"><li>a</li></ol>');
  });

  it('writes a code block with its language', () => {
    expect(html('<pre><code class="language-js">x = 1;</code></pre>')).toBe(
      '<pre><code class="language-js">x = 1;</code></pre>',
    );
  });

  it('writes a code block without a language', () => {
    expect(html('<pre><code>plain</code></pre>')).toBe('<pre>plain</pre>');
  });

  it('escapes code block contents', () => {
    expect(html('<pre><code>a &lt; b</code></pre>')).toBe('<pre>a &lt; b</pre>');
  });

  it('keeps a quote and turns a pull quote into <aside>', () => {
    expect(html('<blockquote><p>q</p></blockquote>')).toBe('<blockquote><p>q</p></blockquote>');
    expect(html('<blockquote data-pullquote=""><p>q</p></blockquote>')).toBe(
      '<aside><p>q</p></aside>',
    );
  });

  it('adds <cite> for an attribution, on both quote kinds', () => {
    expect(html('<blockquote data-pullquote="" data-attribution="Durov"><p>q</p></blockquote>')).toBe(
      '<aside><p>q</p><cite>Durov</cite></aside>',
    );
    expect(html('<blockquote data-attribution="Durov"><p>q</p></blockquote>')).toBe(
      '<blockquote><p>q</p><cite>Durov</cite></blockquote>',
    );
  });

  it('escapes the attribution', () => {
    expect(html('<blockquote data-attribution="a &lt; b"><p>q</p></blockquote>')).toBe(
      '<blockquote><p>q</p><cite>a &lt; b</cite></blockquote>',
    );
  });

  it('leaves out an empty <cite>', () => {
    expect(html('<blockquote data-attribution=""><p>q</p></blockquote>')).toBe(
      '<blockquote><p>q</p></blockquote>',
    );
  });

  it('writes <details> collapsed unless the author chose expanded', () => {
    expect(html('<details><summary>More</summary><p>body</p></details>')).toBe(
      '<details><summary>More</summary><p>body</p></details>',
    );
    expect(html('<details data-open><summary>More</summary><p>body</p></details>')).toBe(
      '<details open><summary>More</summary><p>body</p></details>',
    );
  });

  it('writes a block formula', () => {
    expect(html('<div class="tg-math" data-formula="E=mc^2">$$E=mc^2$$</div>')).toBe(
      '<tg-math-block>E=mc^2</tg-math-block>',
    );
  });

  it('strips the $$ fence when there is no data-formula', () => {
    expect(html('<div class="tg-math">$$x^2$$</div>')).toBe('<tg-math-block>x^2</tg-math-block>');
  });

  it('drops empty blocks', () => {
    expect(html('<p></p>')).toBe('');
  });

  it('unwraps unknown elements but keeps their content', () => {
    expect(html('<section><p>x</p></section>')).toBe('<p>x</p>');
  });
});

describe('tables', () => {
  it('writes rows with header cells and a bordered table', () => {
    expect(
      html('<table><tbody><tr><th><p>H</p></th><td><p>c</p></td></tr></tbody></table>'),
    ).toBe('<table bordered><tr><th>H</th><td>c</td></tr></table>');
  });

  it('keeps inline formatting inside cells but flattens blocks', () => {
    expect(html('<table><tr><td><p><strong>b</strong></p></td></tr></table>')).toBe(
      '<table bordered><tr><td><b>b</b></td></tr></table>',
    );
  });

  it('caps columns at the documented maximum', () => {
    const cells = Array.from({ length: 25 }, (_, i) => `<td>${i}</td>`).join('');
    const out = html(`<table><tr>${cells}</tr></table>`);
    expect((out.match(/<td>/g) || []).length).toBe(LIMITS.TABLE_COLUMNS);
  });

  it('drops an empty table', () => {
    expect(html('<table></table>')).toBe('');
  });
});

describe('media', () => {
  it('writes photo, video and audio blocks', () => {
    expect(html('<img src="https://a/p.jpg">')).toBe('<img src="https://a/p.jpg"/>');
    expect(html('<video src="https://a/v.mp4"></video>')).toBe(
      '<video src="https://a/v.mp4"></video>',
    );
    expect(html('<audio src="https://a/s.mp3"></audio>')).toBe(
      '<audio src="https://a/s.mp3"></audio>',
    );
  });

  it('captions media with <figcaption>, and its credit with <cite>', () => {
    expect(html('<img src="https://a/p.jpg" data-caption="A view">')).toBe(
      '<img src="https://a/p.jpg"/><figcaption>A view</figcaption>',
    );
    expect(
      html('<video src="https://a/v.mp4" data-caption="Clip" data-credit="Ada"></video>'),
    ).toBe(
      '<video src="https://a/v.mp4"></video><figcaption>Clip<cite>Ada</cite></figcaption>',
    );
    // A credit with no caption is still a caption element.
    expect(html('<audio src="https://a/s.mp3" data-credit="Ada"></audio>')).toBe(
      '<audio src="https://a/s.mp3"></audio><figcaption><cite>Ada</cite></figcaption>',
    );
  });

  it('captions a gallery from inside the wrapper', () => {
    expect(
      html(
        '<div class="tg-gallery" data-kind="slideshow" data-images="https://a.jpg"' +
          ' data-caption="Trip" data-credit="Ada"></div>',
      ),
    ).toBe(
      '<tg-slideshow><img src="https://a.jpg"/>' +
        '<figcaption>Trip<cite>Ada</cite></figcaption></tg-slideshow>',
    );
  });

  it('writes no <figcaption> when there is nothing to say', () => {
    expect(html('<img src="https://a/p.jpg" data-caption="" data-credit="">')).toBe(
      '<img src="https://a/p.jpg"/>',
    );
  });

  it('escapes the caption and the credit', () => {
    expect(html('<img src="https://a/p.jpg" data-caption="a &lt; b" data-credit="c &amp; d">')).toBe(
      '<img src="https://a/p.jpg"/><figcaption>a &lt; b<cite>c &amp; d</cite></figcaption>',
    );
  });

  it('accepts only http(s) media, per the documented restriction', () => {
    expect(html('<img src="file:///tmp/a.png">')).toBe('');
    expect(html('<img src="javascript:alert(1)">')).toBe('');
    expect(html('<img src="tg://user?id=1">')).toBe('');
  });

  it('writes galleries as collage or slideshow', () => {
    expect(
      html('<div class="tg-gallery" data-kind="collage" data-images="https://a.jpg,https://b.jpg"></div>'),
    ).toBe('<tg-collage><img src="https://a.jpg"/><img src="https://b.jpg"/></tg-collage>');
    expect(
      html('<div class="tg-gallery" data-kind="slideshow" data-images="https://a.jpg"></div>'),
    ).toBe('<tg-slideshow><img src="https://a.jpg"/></tg-slideshow>');
  });

  it('falls back to child images for a gallery', () => {
    expect(html('<div class="tg-gallery" data-kind="collage"><img src="https://a.jpg"></div>')).toBe(
      '<tg-collage><img src="https://a.jpg"/></tg-collage>',
    );
  });

  it('mixes photos and videos in a slideshow, like the docs example', () => {
    // Telegram documents `<tg-slideshow><img/><video/></tg-slideshow>` and its
    // collage twin — every item used to ride an <img>, sending a video as a
    // photo upload.
    expect(
      html(
        '<div class="tg-gallery" data-kind="slideshow" data-images="https://a/p.jpg,https://a/v.mp4"></div>',
      ),
    ).toBe('<tg-slideshow><img src="https://a/p.jpg"/><video src="https://a/v.mp4"></video></tg-slideshow>');
    expect(
      html(
        '<div class="tg-gallery" data-kind="collage" data-images="https://a/v.webm,https://a/p.jpg"></div>',
      ),
    ).toBe('<tg-collage><video src="https://a/v.webm"></video><img src="https://a/p.jpg"/></tg-collage>');
  });

  it('classifies gallery entries from the file extension', () => {
    expect(mediaKindOf('https://a/v.mp4')).toBe('video');
    expect(mediaKindOf('https://a/anim.gif')).toBe('video');
    expect(mediaKindOf('https://a/song.mp3')).toBe('audio');
    expect(mediaKindOf('https://a/note.ogg')).toBe('voice');
    expect(mediaKindOf('https://a/p.jpg')).toBe('photo');
    expect(mediaKindOf('https://a/no-extension')).toBe('photo');
    // A locally picked file carries its name encoded inside the scheme URL.
    expect(mediaKindOf('tfrfile://media/C%3A%2Fclips%2Fcl.MOV')).toBe('video');
    expect(mediaKindOf('tfrfile://media/C%3A%2Fanim.gif')).toBe('video');
    expect(mediaKindOf('tfrfile://media/C%3A%2Faudio/tones.ogg')).toBe('voice');
  });

  it('uploads a local gallery video as video, not photo', () => {
    // The real flow: serialize first (the editor html keeps `tfrfile://` srcs),
    // then rewriteLocalMedia builds the upload channel per entry kind.
    const message = ser(
      '<div class="tg-gallery" data-kind="slideshow" data-images="' +
        `${localFileUrl('C:\\v.mp4')},${localFileUrl('C:\\p.jpg')}"></div>`,
    );
    const richMessage = buildInputRichMessage(message.html);
    expect(richMessage.html).toBe(
      '<tg-slideshow><video src="tg://video?id=m1"></video><img src="tg://photo?id=m2"></tg-slideshow>',
    );
    expect(richMessage.media).toEqual([
      { id: 'm1', media: { type: 'video', media: 'attach://m1' } },
      { id: 'm2', media: { type: 'photo', media: 'attach://m2' } },
    ]);
  });

  it('writes a map with lat/long and the documented zoom 0-24', () => {
    // 14 is the zoom in Telegram's own example — the default when unset.
    expect(html('<div class="tg-map" data-lat="35.6892" data-lon="51.389"></div>')).toBe(
      '<tg-map lat="35.6892" long="51.389" zoom="14"/>',
    );
    expect(
      html('<div class="tg-map" data-lat="35.6892" data-lon="51.389" data-zoom="3"></div>'),
    ).toBe('<tg-map lat="35.6892" long="51.389" zoom="3"/>');
    // Outside 0-24 clamps instead of sending a rejected attribute.
    expect(
      html('<div class="tg-map" data-lat="35.6892" data-lon="51.389" data-zoom="99"></div>'),
    ).toBe('<tg-map lat="35.6892" long="51.389" zoom="24"/>');
  });

  it("carries the map's optional size inside the documented bounds", () => {
    // InputRichBlockMap: 0-10000 each, 10000 in total, ratio at most 20.
    const sized = '<div class="tg-map" data-lat="35.7" data-lon="51.4" data-width="600" data-height="400"></div>';
    expect(html(sized)).toBe('<tg-map lat="35.7" long="51.4" zoom="14" width="600" height="400"/>');
    // 6000×300 = ratio 20 — exactly on the bound, still carried.
    expect(
      html('<div class="tg-map" data-lat="35.7" data-lon="51.4" data-width="6000" data-height="300"></div>'),
    ).toContain('width="6000" height="300"');
    // Ratio 21 over the line — both sizes are dropped, not clamped.
    expect(
      html('<div class="tg-map" data-lat="35.7" data-lon="51.4" data-width="6300" data-height="300"></div>'),
    ).toBe('<tg-map lat="35.7" long="51.4" zoom="14"/>');
    // 10000 + 1000 = over the total.
    expect(
      html('<div class="tg-map" data-lat="35.7" data-lon="51.4" data-width="10000" data-height="1000"></div>'),
    ).toBe('<tg-map lat="35.7" long="51.4" zoom="14"/>');
  });

  it('wraps a captioned map in a figure, like the docs example', () => {
    expect(
      html(
        '<div class="tg-map" data-lat="35.7" data-lon="51.4" data-caption="Downtown">' +
          '<figcaption>Downtown</figcaption></div>',
      ),
    ).toBe(
      '<figure><tg-map lat="35.7" long="51.4" zoom="14"/><figcaption>Downtown</figcaption></figure>',
    );
  });

  it('drops a map without coordinates', () => {
    expect(html('<div class="tg-map"></div>')).toBe('');
  });

  it('drops a map pointing off the globe', () => {
    // Telegram refuses it, and the error it returns names no block.
    expect(html('<div class="tg-map" data-lat="999" data-lon="0"></div>')).toBe('');
    expect(html('<div class="tg-map" data-lat="0" data-lon="-181"></div>')).toBe('');
    expect(html('<div class="tg-map" data-lat="-90" data-lon="180"></div>')).toBe(
      '<tg-map lat="-90" long="180" zoom="14"/>',
    );
  });

  it('counts media', () => {
    const out = ser('<img src="https://a.jpg"><div class="tg-gallery" data-images="https://b.jpg,https://c.jpg"></div>');
    expect(out.media).toBe(3);
  });
});

describe('premium entities', () => {
  it('writes the expandable quote flag', () => {
    expect(html('<blockquote data-expandable><p>Long quote</p></blockquote>')).toBe(
      '<blockquote expandable><p>Long quote</p></blockquote>',
    );
  });

  it('writes an empty anchor block, and drops it inside a table cell', () => {
    expect(html('<span data-tg-anchor="chapter-1"></span>')).toBe('<a name="chapter-1"></a>');
    expect(
      html('<table><tr><td><span data-tg-anchor="x"></span></td></tr></table>'),
    ).toBe('<table bordered><tr><td></td></tr></table>');
  });

  it('carries the ordered-list attributes', () => {
    expect(html('<ol start="3" data-list-type="a" data-reversed><li><p>one</p></li></ol>')).toBe(
      '<ol start="3" type="a" reversed><li>one</li></ol>',
    );
    expect(html('<ol><li data-value="7" data-list-type="i">Seven</li></ol>')).toBe(
      '<ol><li value="7" type="i">Seven</li></ol>',
    );
  });

  it('carries the documented `<tg-reference>`, `<tg-emoji>` and `<tg-time>`', () => {
    expect(html('<span data-tg-reference="note-1">footnote</span>')).toBe(
      '<tg-reference name="note-1">footnote</tg-reference>',
    );
    expect(html('<span data-emoji-id="5368324170671202286">👍</span>')).toBe(
      '<tg-emoji emoji-id="5368324170671202286">👍</tg-emoji>',
    );
    // An emoji without its id is nothing Telegram could resolve.
    expect(html('<span data-emoji-id="">👍</span>')).toBe('');
    expect(html('<span data-tg-time="1647531900" data-time-format="wDT">22:45</span>')).toBe(
      '<tg-time unix="1647531900" format="wDT">22:45</tg-time>',
    );
    expect(html('<span data-tg-time="1647531900">22:45</span>')).toBe(
      '<tg-time unix="1647531900">22:45</tg-time>',
    );
  });

  it('reads table caption, toggles and cell options back out', () => {
    expect(
      html(
        '<table data-caption="Rates" data-striped><tr><th colspan="2" data-align="center" data-valign="bottom">H</th></tr>' +
          '<tr><td data-align="right">a</td></tr></table>',
      ),
    ).toBe(
      '<table bordered striped><caption>Rates</caption>' +
        '<tr><th colspan="2" align="center" valign="bottom">H</th></tr>' +
        '<tr><td align="right">a</td></tr></table>',
    );
  });
});

describe('inline buttons', () => {
  const row = (buttons, extra = '') =>
    html(`<div class="tg-buttons" data-buttons='${buttons}'${extra}></div>`);

  it('writes a validated `<tg-button-row>`', () => {
    expect(
      row(
        JSON.stringify([{ type: 'url', style: 'primary', label: 'Docs', value: 'https://tfr.dev' }]),
        ' data-align="left"',
      ),
    ).toBe(
      '<tg-button-row align="left">' +
        '<tg-button type="url" style="primary" url="https://tfr.dev">Docs</tg-button>' +
        '</tg-button-row>',
    );
  });

  it('writes each documented button kind with the attribute it reads', () => {
    const buttons = [
      { type: 'callback_data', label: 'Go', value: 'do-thing' },
      { type: 'web_app', label: 'Open', value: 'https://app.example.com' },
      { type: 'login_url', label: 'Sign in', value: 'https://signin.example.com', forwardText: 'Log in', requestWriteAccess: true },
      { type: 'switch_inline_query_chosen_chat', label: 'Share', value: 'hi', allowUserChats: true, allowChannelChats: true },
      { type: 'copy_text', label: 'Copy', value: 'some text' },
      { type: 'disabled', label: 'Locked' },
    ];
    expect(row(JSON.stringify(buttons))).toBe(
      '<tg-button-row>' +
        '<tg-button type="callback_data" data="do-thing">Go</tg-button>' +
        '<tg-button type="web_app" url="https://app.example.com">Open</tg-button>' +
        '<tg-button type="login_url" url="https://signin.example.com" forward-text="Log in" request-write-access>Sign in</tg-button>' +
        '<tg-button type="switch_inline_query_chosen_chat" query="hi" allow-user-chats allow-channel-chats>Share</tg-button>' +
        '<tg-button type="copy_text" text="some text">Copy</tg-button>' +
        '<tg-button type="disabled">Locked</tg-button>' +
        '</tg-button-row>',
    );
  });

  it('refuses buttons the spec would reject', () => {
    // A `web_app` may only open https.
    expect(
      row(JSON.stringify([{ type: 'web_app', label: 'O', value: 'http://app.example.com' }])),
    ).toBe('');
    // A `url` button with an unsafe scheme is dropped too.
    expect(row(JSON.stringify([{ type: 'url', label: 'x', value: 'javascript:alert(1)' }]))).toBe(
      '',
    );
    // And a row with no valid buttons at all is not sent.
    expect(row(JSON.stringify([{ label: ' ' }]))).toBe('');
    expect(row('not json')).toBe('');
    expect(row('[not an array of objects]')).toBe('');
  });

  it('counts the row and its buttons as blocks', () => {
    const out = ser(
      `<div class="tg-buttons" data-buttons='${JSON.stringify([
        { type: 'url', label: 'A', value: 'https://a' },
        { type: 'url', label: 'B', value: 'https://b' },
      ])}'></div>`,
    );
    expect(out.blocks).toBe(3);
  });

  it('keeps the link style only on callback buttons (10.3)', () => {
    // "The style 'link' is allowed only for callback buttons" — for anything
    // else the style is not carried at all rather than risking an API error.
    const mk = (type, value) =>
      row(JSON.stringify([{ type, style: 'link', label: 'x', value }]));
    expect(mk('callback_data', 'v')).toBe(
      '<tg-button-row><tg-button type="callback_data" style="link" data="v">x</tg-button></tg-button-row>',
    );
    expect(mk('url', 'https://v.example')).toBe(
      '<tg-button-row><tg-button type="url" url="https://v.example">x</tg-button></tg-button-row>',
    );
    expect(mk('switch_inline_query', 'v')).toBe(
      '<tg-button-row><tg-button type="switch_inline_query" query="v">x</tg-button></tg-button-row>',
    );
  });
});

describe('inline `<tg-button>` in text (10.3 RichTextButton)', () => {
  it('serializes a chip riding inside a paragraph', () => {
    expect(
      html(
        '<p>Inline buttons: <tg-button type="url" style="success" url="https://t.me/test">open</tg-button></p>',
      ),
    ).toBe(
      '<p>Inline buttons: <tg-button type="url" style="success" url="https://t.me/test">open</tg-button></p>',
    );
  });

  it('rebuilds the element from its attributes every time', () => {
    // Even if the editor hands over a paragraph the wire never sees extra
    // attributes: the button is serialized from a validated record.
    expect(
      html(
        '<p><tg-button type="copy_text" text="sync me" style="primary"> Описание </tg-button></p>',
      ),
    ).toBe('<p><tg-button type="copy_text" style="primary" text="sync me">Описание</tg-button></p>');
  });

  it('drops an unusable chip but keeps the text around it', () => {
    expect(html('<p>before <tg-button type="url" url="javascript:x">go</tg-button> after</p>')).toBe(
      '<p>before  after</p>',
    );
  });

  it('survives inside a table cell, where buttons are still inline', () => {
    expect(
      html(
        '<table><tbody><tr><td><tg-button type="url" url="https://x.y">go</tg-button></td></tr></tbody></table>',
      ),
    ).toBe(
      '<table bordered><tr><td><tg-button type="url" url="https://x.y">go</tg-button></td></tr></table>',
    );
  });

  it('does not count toward the block limit — it is a RichText node', () => {
    const out = ser('<p><tg-button type="disabled">do nothing</tg-button></p>');
    expect(out.blocks).toBe(1);
  });
});

describe('thinking placeholder', () => {
  it('is dropped from plain sends — Telegram rejects the tag outside a draft stream', () => {
    const out = ser('<p>Working…</p><div class="tg-thinking" data-text="Dry-run"></div>');
    expect(out.html).toBe('<p>Working…</p>');
    expect(out.thinkingDropped).toBe(1);
    expect(out.blocks).toBe(1);
  });

  it('reports every dropped placeholder', () => {
    const out = ser(
      '<div class="tg-thinking" data-text="A"></div><div class="tg-thinking" data-text="B"></div>',
    );
    expect(out.html).toBe('');
    expect(out.thinkingDropped).toBe(2);
  });

  it('rides `sendRichMessageDraft` when keepThinking is on', () => {
    const draft = serializeEditorHtml('<div class="tg-thinking" data-text="a &lt; b"></div>', {
      keepThinking: true,
    });
    expect(draft.html).toBe('<tg-thinking>a &lt; b</tg-thinking>');
    expect(draft.thinkingDropped).toBe(0);
    expect(draft.blocks).toBe(1);
  });
});

describe('media spoilers', () => {
  it('wraps spoilered media in a figure with the tg-spoiler attribute', () => {
    expect(html('<img src="https://a/p.jpg" data-spoiler data-caption="Surprise">')).toBe(
      '<figure><img src="https://a/p.jpg" tg-spoiler/><figcaption>Surprise</figcaption></figure>',
    );
    expect(html('<video src="https://a/v.mp4" data-spoiler></video>')).toBe(
      '<figure><video src="https://a/v.mp4" tg-spoiler></video></figure>',
    );
  });

  it('writes documents with their src and caption', () => {
    expect(html('<tg-document src="https://a/f.pdf" data-caption="Report"></tg-document>')).toBe(
      '<tg-document src="https://a/f.pdf"></tg-document><figcaption>Report</figcaption>',
    );
    // A document keeps whatever src it carries — the URL check happens when
    // the attachment is uploaded, not at serialization time.
    expect(html(`<tg-document src="${localFileUrl('C:/x/f.pdf')}"></tg-document>`)).toBe(
      '<tg-document src="tfrfile://media/C%3A%2Fx%2Ff.pdf"></tg-document>',
    );
    expect(html('<tg-document src="javascript:alert(1)"></tg-document>')).toBe('');
  });
});

describe('local media — picked from the device', () => {
  const winPath = 'C:\\Users\\me\\Pictures\\cat.jpg';
  const localUrl = localFileUrl(winPath);

  it('rides the editor as a scheme URL the renderer can actually display', () => {
    expect(localUrl).toBe('tfrfile://media/C%3A%2FUsers%2Fme%2FPictures%2Fcat.jpg');
    // Paths come back POSIX-normalised — every consumer (fs in main, the
    // protocol handler) accepts forward slashes on Windows as well.
    expect(localUrlToPath(localUrl)).toBe('C:/Users/me/Pictures/cat.jpg');
    expect(localUrlToPath('https://a/x.jpg')).toBe('');
    expect(localUrlToPath('tfrfile://media/%2Fnope%2Fpic.png?ignored#frag')).toBe('/nope/pic.png');
  });

  it('is allowed through the editor media URL gate, but never as a link', () => {
    expect(safeUrl(localUrl, MEDIA_SCHEMES)).toBe(localUrl);
    expect(safeUrl(localUrl, LINK_SCHEMES)).toBe('');
    expect(ser(`<img src="${localUrl}">`).media).toBe(1);
  });

  it('rewrites picked files into tg:// references with the media list', () => {
    const { html: wire, files } = rewriteLocalMedia(
      `<img src="${localUrl}"><video src="${localFileUrl('C:\\clip.mp4')}"></video>`,
    );
    expect(wire).toBe('<img src="tg://photo?id=m1"><video src="tg://video?id=m2"></video>');
    expect(files).toEqual([
      { id: 'm1', path: 'C:/Users/me/Pictures/cat.jpg', type: 'photo' },
      { id: 'm2', path: 'C:/clip.mp4', type: 'video' },
    ]);
  });

  it('uploads the same file once even when it is used twice', () => {
    const { files } = rewriteLocalMedia(
      `<img src="${localUrl}"><img src="${localUrl}">`,
    );
    expect(files).toEqual([{ id: 'm1', path: 'C:/Users/me/Pictures/cat.jpg', type: 'photo' }]);
  });

  it('classifies the media the uploading InputMedia expects', () => {
    const { html: wire, files } = rewriteLocalMedia(
      `<video src="${localFileUrl('C:\\anim.gif')}"></video>` +
        `<audio src="${localFileUrl('C:\\note.ogg')}"></audio>` +
        `<audio src="${localFileUrl('C:\\song.mp3')}"></audio>` +
        `<tg-document src="${localFileUrl('C:\\r.pdf')}"></tg-document>`,
    );
    expect(wire).toBe(
      '<video src="tg://video?id=m1"></video><audio src="tg://audio?id=m2"></audio>' +
        '<audio src="tg://audio?id=m3"></audio><tg-document src="tg://document?id=m4"></tg-document>',
    );
    expect(files.map((f) => f.type)).toEqual(['animation', 'voice', 'audio', 'document']);
  });

  it('builds the rich_message media list and the upload manifest', () => {
    const richMessage = buildInputRichMessage(
      `<img src="${localUrl}" alt="cap">`,
      { isRtl: true },
    );
    expect(richMessage.html.startsWith('<img src="tg://photo?id=m1"')).toBe(true);
    expect(richMessage.media).toEqual([{ id: 'm1', media: { type: 'photo', media: 'attach://m1' } }]);
    expect(richMessage._files).toEqual([{ name: 'm1', path: 'C:/Users/me/Pictures/cat.jpg' }]);
    expect(richMessage.is_rtl).toBe(true);

    // A message without local media stays exactly as before — no media field.
    const plain = buildInputRichMessage('<p>text</p>');
    expect(plain).toEqual({ html: '<p>text</p>' });
  });

  it('sendRichMessage bodies hoist the upload manifest to the top level', () => {
    // The main process reads `body._files` — a manifest inside `rich_message`
    // is invisible to it: the attachments never rode the multipart request and
    // Telegram answered "Can't parse InputRichMessageMedia: media not found".
    const body = buildRichMessageBody(`<img src="${localUrl}">`, '12345');
    expect(body.rich_message.media).toHaveLength(1);
    expect(body._files).toEqual([{ name: 'm1', path: 'C:/Users/me/Pictures/cat.jpg' }]);
    expect(body.rich_message._files).toBeUndefined();
  });

  it('draft and edit bodies carry the manifest the same way', () => {
    const draft = buildDraftBody(`<img src="${localUrl}">`, '12345', 7);
    expect(draft.draft_id).toBe(7);
    expect(draft._files).toHaveLength(1);
    expect(draft.rich_message._files).toBeUndefined();

    const edit = buildEditBody(`<img src="${localUrl}">`, '12345', '42');
    expect(edit.message_id).toBe(42);
    expect(edit._files).toHaveLength(1);
    expect(edit.rich_message._files).toBeUndefined();
  });

  it('leaves the editor-only form untouched — remote URLs are not rewritten', () => {
    const remote = html('<img src="https://a/p.jpg">');
    const { html: wire, files } = rewriteLocalMedia(remote);
    expect(wire).toBe(remote);
    expect(files).toBeNull();
  });
});

describe('nesting preflight', () => {
  const nest = (depth) => {
    let markup = 'x';
    for (let i = 0; i < depth; i += 1) markup = `<blockquote>${markup}</blockquote>`;
    return markup;
  };

  it('counts every level of nested formatting and blocks', () => {
    expect(checkNestingDepth('<p>text</p>')).toEqual({ ok: true, depth: 1, limit: 16 });
    expect(checkNestingDepth('<p><strong>b</strong><em>i</em></p>').depth).toBe(2);
    expect(checkNestingDepth(nest(4)).depth).toBe(4);
  });

  it('rejects worse than the documented 16 levels', () => {
    const boundary = checkNestingDepth(nest(16));
    expect(boundary.ok).toBe(true);
    expect(boundary.depth).toBe(16);
    const tooDeep = checkNestingDepth(nest(17));
    expect(tooDeep.ok).toBe(false);
    expect(tooDeep.depth).toBe(17);
  });
});

describe('publish (send) options', () => {
  it('writes every set publish parameter into the sendRichMessage body', () => {
    const body = buildRichMessageBody('<p>x</p>', '@chat', {
      sendParams: {
        messageThreadId: '77',
        directMessagesTopicId: 5,
        replyToMessageId: '1001',
        silent: true,
        protectContent: true,
        messageEffectId: '5159385339981119903',
        businessConnectionId: 'bc:test',
      },
    });
    expect(body.message_thread_id).toBe(77);
    expect(body.direct_messages_topic_id).toBe(5);
    expect(body.reply_parameters).toEqual({ message_id: 1001 });
    expect(body.disable_notification).toBe(true);
    expect(body.protect_content).toBe(true);
    expect(body.message_effect_id).toBe('5159385339981119903');
    expect(body.business_connection_id).toBe('bc:test');
  });

  it('carries only what the author set', () => {
    const body = buildRichMessageBody('<p>x</p>', '@chat', { sendParams: {} });
    expect(body.message_thread_id).toBeUndefined();
    expect(body.disable_notification).toBeUndefined();
    expect(body.protect_content).toBeUndefined();
    expect(body.reply_parameters).toBeUndefined();
    expect(body.message_effect_id).toBeUndefined();
  });

  it("gives drafts the topic field only, per the method's parameter list", () => {
    const draft = buildDraftBody('<p>x</p>', '123', 7, {
      sendParams: { messageThreadId: '77', silent: true, protectContent: true },
    });
    expect(draft.message_thread_id).toBe(77);
    expect(draft.disable_notification).toBeUndefined();
    expect(draft.direct_messages_topic_id).toBeUndefined();
  });
});

describe('checklists', () => {
  it('pulls task items out of the body', () => {
    const out = ser(
      '<p>intro</p><ul data-type="taskList"><li data-checked="true">done</li>' +
        '<li data-checked="false">todo</li></ul>',
    );
    expect(out.html).toBe('<p>intro</p>');
    expect(out.checklist).toEqual([
      { text: 'done', done: true },
      { text: 'todo', done: false },
    ]);
  });

  it('recognises checkbox inputs too', () => {
    const out = ser('<ul><li><input type="checkbox" checked> a</li><li><input type="checkbox"> b</li></ul>');
    expect(out.checklist.map((i) => i.done)).toEqual([true, false]);
    expect(out.html).toBe('');
  });

  it('leaves ordinary lists alone', () => {
    const out = ser('<ul><li>a</li></ul>');
    expect(out.checklist).toEqual([]);
    expect(out.html).toBe('<ul><li>a</li></ul>');
  });

  it('renders task items as Rich HTML checkboxes inside the body', () => {
    // `<li><input type="checkbox">` is documented Rich HTML, so Telegram draws
    // real checkboxes — in a channel too, unlike sendChecklist.
    const out = serializeEditorHtml(
      '<p>intro</p><ul data-type="taskList"><li data-checked="true">done</li>' +
        '<li data-checked="false">todo</li></ul>',
      { inlineChecklist: true },
    );
    expect(out.html).toBe(
      '<p>intro</p><ul><li><input type="checkbox" checked>done</li>' +
        '<li><input type="checkbox">todo</li></ul>',
    );
    expect(out.inlinedChecklist).toBe(true);
    // Still reported, so the caller can say which form was sent.
    expect(out.checklist).toEqual([
      { text: 'done', done: true },
      { text: 'todo', done: false },
    ]);
  });

  it('does not claim an inlined checklist when the document has none', () => {
    const out = serializeEditorHtml('<p>hi</p>', { inlineChecklist: true });
    expect(out.inlinedChecklist).toBe(false);
    expect(out.html).toBe('<p>hi</p>');
  });

  it('reads the markup TipTap actually emits for a task list', () => {
    // TaskItem wraps the text in a <div><p>, next to a <label> holding the
    // checkbox — the label contributes no text, so the item text is clean.
    const tiptap =
      '<ul data-type="taskList">' +
      '<li data-checked="true" data-type="taskItem">' +
      '<label><input type="checkbox" checked="checked"><span></span></label>' +
      '<div><p>hello</p></div></li>' +
      '<li data-checked="false" data-type="taskItem">' +
      '<label><input type="checkbox"><span></span></label>' +
      '<div><p>world</p></div></li></ul>';
    expect(ser(tiptap).checklist).toEqual([
      { text: 'hello', done: true },
      { text: 'world', done: false },
    ]);
    expect(serializeEditorHtml(tiptap, { inlineChecklist: true }).html).toBe(
      '<ul><li><input type="checkbox" checked>hello</li>' +
        '<li><input type="checkbox">world</li></ul>',
    );
  });

  it('escapes task text when inlining', () => {
    const out = serializeEditorHtml('<ul data-type="taskList"><li>a &lt; b</li></ul>', {
      inlineChecklist: true,
    });
    expect(out.html).toBe('<ul><li><input type="checkbox">a &lt; b</li></ul>');
  });
});

describe('request bodies', () => {
  it('sends html inside rich_message, never blocks', () => {
    const body = buildRichMessageBody('<p>hi</p>', '@chan');
    expect(body).toEqual({ chat_id: '@chan', rich_message: { html: '<p>hi</p>' } });
    expect(body.rich_message.blocks).toBeUndefined();
    expect(Object.keys(body.rich_message)).toEqual(['html']);
  });

  it('adds is_rtl and skip_entity_detection only when asked', () => {
    expect(buildInputRichMessage('<p>x</p>', { isRtl: true, skipEntityDetection: true })).toEqual({
      html: '<p>x</p>',
      is_rtl: true,
      skip_entity_detection: true,
    });
    expect(buildInputRichMessage('<p>x</p>', {})).toEqual({ html: '<p>x</p>' });
  });

  it('builds a draft body with a numeric chat and a non-zero draft id', () => {
    const body = buildDraftBody('<p>x</p>', '12345', 1);
    expect(body).toEqual({ chat_id: 12345, draft_id: 1, rich_message: { html: '<p>x</p>' } });
    expect(body.draft_id).not.toBe(0);
  });

  it('builds an edit body with a numeric message id', () => {
    expect(buildEditBody('<p>x</p>', '@chan', '42')).toEqual({
      chat_id: '@chan',
      message_id: 42,
      rich_message: { html: '<p>x</p>' },
    });
  });

  it('builds a checklist as InputChecklist: a title plus tasks with ids', () => {
    // "items" with a "done" flag is not a shape the API accepts; it answered
    // `can't parse InputChecklist: Can't find field "title"`.
    const body = buildChecklistBody([{ text: 'a', done: true }, { text: 'b' }], '12345', {
      title: 'Groceries',
      businessConnectionId: 'biz_1',
    });
    expect(body).toEqual({
      chat_id: '12345',
      business_connection_id: 'biz_1',
      checklist: {
        title: 'Groceries',
        tasks: [
          { id: 1, text: 'a' },
          { id: 2, text: 'b' },
        ],
      },
    });
  });

  it('gives every task a positive unique id', () => {
    const tasks = buildChecklistBody([{ text: 'a' }, { text: 'b' }, { text: 'c' }], '1').checklist
      .tasks;
    const ids = tasks.map((task) => task.id);
    expect(ids).toEqual([1, 2, 3]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.min(...ids)).toBeGreaterThan(0);
  });

  it('drops the done flag — a task cannot be sent already ticked', () => {
    const tasks = buildChecklistBody([{ text: 'a', done: true }], '1').checklist.tasks;
    expect(tasks[0]).toEqual({ id: 1, text: 'a' });
    expect('done' in tasks[0]).toBe(false);
  });

  it('omits business_connection_id when there is none to send', () => {
    expect(buildChecklistBody([{ text: 'a' }], '1')).not.toHaveProperty(
      'business_connection_id',
    );
  });

  it('caps tasks and task text at the documented limits', () => {
    const many = Array.from({ length: LIMITS.CHECKLIST_TASKS + 5 }, (_, i) => ({
      text: `t${i}`,
    }));
    expect(buildChecklistBody(many, '1').checklist.tasks).toHaveLength(LIMITS.CHECKLIST_TASKS);

    const long = buildChecklistBody([{ text: 'x'.repeat(200) }], '1').checklist.tasks[0];
    expect(long.text).toHaveLength(LIMITS.CHECKLIST_TASK_CHARS);
  });
});

describe('checkChecklist', () => {
  it('accepts a checklist inside every limit', () => {
    expect(checkChecklist([{ text: 'a' }])).toEqual({ ok: true });
  });

  it('reports why a checklist cannot be sent', () => {
    expect(checkChecklist([]).reason).toBe('empty');
    expect(
      checkChecklist(Array.from({ length: LIMITS.CHECKLIST_TASKS + 1 }, () => ({ text: 'a' })))
        .reason,
    ).toBe('tasks');
    expect(checkChecklist([{ text: 'x'.repeat(LIMITS.CHECKLIST_TASK_CHARS + 1) }]).reason).toBe(
      'taskChars',
    );
  });
});

describe('limits', () => {
  it('accepts a message inside every limit', () => {
    expect(checkLimits({ chars: 10, blocks: 2, media: 0 })).toEqual({ ok: true });
  });

  it('reports which limit was exceeded', () => {
    expect(checkLimits({ chars: LIMITS.CHARS + 1, blocks: 1, media: 0 }).reason).toBe('chars');
    expect(checkLimits({ chars: 1, blocks: LIMITS.BLOCKS + 1, media: 0 }).reason).toBe('blocks');
    expect(checkLimits({ chars: 1, blocks: 1, media: LIMITS.MEDIA + 1 }).reason).toBe('media');
  });

  it('counts blocks and characters', () => {
    const out = ser('<h1>Title</h1><p>Body</p><hr>');
    expect(out.blocks).toBe(3);
    expect(out.chars).toBe('TitleBody'.length);
  });
});

describe('helpers', () => {
  it('detects a private chat id', () => {
    expect(isPrivateChatId('123456789')).toBe(true);
    expect(isPrivateChatId('@channel')).toBe(false);
    expect(isPrivateChatId('-1001234567890')).toBe(false);
  });

  it('safeUrl refuses unknown schemes', () => {
    expect(safeUrl('https://a')).toBe('https://a');
    expect(safeUrl('javascript:x')).toBe('');
    expect(safeUrl('/relative')).toBe('');
    expect(safeUrl('')).toBe('');
  });
});

describe('a full document', () => {
  it('serializes the demo message the app ships in its screenshot', () => {
    const out = ser(
      '<h2>Bot API 10.1</h2>' +
        '<p>Formatting is <strong>free</strong> through the Bot API.</p>' +
        '<ul><li>Headings, quotes, tables</li></ul>' +
        '<ul data-type="taskList"><li data-checked="false">Ship it</li></ul>' +
        '<pre><code class="language-js">sendRichMessage({})</code></pre>',
    );
    expect(out.html).toBe(
      '<h2>Bot API 10.1</h2>' +
        '<p>Formatting is <b>free</b> through the Bot API.</p>' +
        '<ul><li>Headings, quotes, tables</li></ul>' +
        '<pre><code class="language-js">sendRichMessage({})</code></pre>',
    );
    expect(out.checklist).toEqual([{ text: 'Ship it', done: false }]);
    expect(checkLimits(out).ok).toBe(true);
  });
});
