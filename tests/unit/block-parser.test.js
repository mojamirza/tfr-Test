/**
 * Unit tests for Block Parser.
 */
import { describe, it, expect } from 'vitest';
import { parseBlockElement, parseAllBlocks } from '../../src/shared/block-parser.js';
import { BlockType, InlineType } from '../../src/shared/block-types.js';

function el(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return doc.body.firstElementChild;
}

describe('parseBlockElement', () => {
  it('parses paragraph', () => {
    const result = parseBlockElement(el('<p>Hello world</p>'));
    expect(result).toEqual({ type: BlockType.PARAGRAPH, text: 'Hello world' });
  });

  it('parses heading with level', () => {
    const result = parseBlockElement(el('<h2>Title</h2>'));
    expect(result).toEqual({ type: BlockType.HEADING, level: 2, text: 'Title' });
  });

  it('parses divider', () => {
    expect(parseBlockElement(el('<hr>'))).toEqual({ type: BlockType.DIVIDER });
  });

  it('parses blockquote', () => {
    const result = parseBlockElement(el('<blockquote>Quote me</blockquote>'));
    expect(result.type).toBe(BlockType.BLOCKQUOTE);
    expect(result.text).toBe('Quote me');
    expect(result.expandable).toBe(false);
  });

  it('flags an expandable blockquote', () => {
    const result = parseBlockElement(el('<blockquote data-expandable>Long quote</blockquote>'));
    expect(result.type).toBe(BlockType.BLOCKQUOTE);
    expect(result.expandable).toBe(true);
  });

  it('parses code block with language', () => {
    const result = parseBlockElement(
      el('<pre><code class="language-python">print(1)</code></pre>'),
    );
    expect(result).toEqual({
      type: BlockType.CODE_BLOCK,
      language: 'python',
      text: 'print(1)',
    });
  });

  it('parses bullet list', () => {
    const result = parseBlockElement(el('<ul><li>A</li><li>B</li></ul>'));
    expect(result.type).toBe(BlockType.LIST);
    expect(result.style).toBe('bullet');
    expect(result.items).toEqual([{ text: 'A' }, { text: 'B' }]);
  });

  it('parses ordered list', () => {
    const result = parseBlockElement(el('<ol><li>First</li><li>Second</li></ol>'));
    expect(result.style).toBe('numbered');
  });

  it('parses checklist items with checkbox', () => {
    const result = parseBlockElement(
      el('<ul><li><input type="checkbox" checked> Done</li><li><input type="checkbox"> Todo</li></ul>'),
    );
    expect(result.items[0].done).toBe(true);
    expect(result.items[1].done).toBe(false);
  });

  it('parses table', () => {
    const result = parseBlockElement(
      el('<table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b</td></tr></table>'),
    );
    expect(result.type).toBe(BlockType.TABLE);
    expect(result.header).toEqual(['H1', 'H2']);
    expect(result.rows).toEqual([['a', 'b']]);
  });

  it('reads the table caption and style toggles', () => {
    const result = parseBlockElement(
      el(
        '<table data-caption="Rates" data-striped data-compact>' +
          '<tr><th>H</th></tr><tr><td>a</td></tr></table>',
      ),
    );
    expect(result.caption).toBe('Rates');
    expect(result.striped).toBe(true);
    expect(result.compact).toBe(true);
  });

  it('reads ordered-list extras: start, marker type, reversed and item values', () => {
    const result = parseBlockElement(
      el(
        '<ol start="3" data-list-type="A" data-reversed>' +
          '<li data-value="7">Seven</li><li>Six</li></ol>',
      ),
    );
    expect(result.start).toBe(3);
    expect(result.listType).toBe('A');
    expect(result.reversed).toBe(true);
    expect(result.items).toEqual([{ text: 'Seven', value: 7 }, { text: 'Six' }]);
  });

  it('parses details', () => {
    const result = parseBlockElement(
      el('<details><summary>Click</summary><p>Hidden</p></details>'),
    );
    expect(result.type).toBe(BlockType.DETAILS);
    expect(result.summary).toBe('Click');
  });

  it('parses math block and strips the $$ delimiters', () => {
    const result = parseBlockElement(el('<div class="tg-math">$$x^2$$</div>'));
    expect(result).toEqual({ type: BlockType.MATH_BLOCK, text: 'x^2' });
  });

  it('prefers the data-formula attribute for math blocks', () => {
    const result = parseBlockElement(
      el('<div class="tg-math" data-formula="a+b">$$rendered$$</div>'),
    );
    expect(result.text).toBe('a+b');
  });

  it('parses a task list as a checklist block', () => {
    const result = parseBlockElement(
      el(
        '<ul data-type="taskList"><li data-checked="true">Ship it</li>' +
          '<li data-checked="false">Write docs</li></ul>',
      ),
    );
    expect(result.type).toBe(BlockType.CHECKLIST);
    expect(result.items).toEqual([
      { text: 'Ship it', done: true },
      { text: 'Write docs', done: false },
    ]);
  });

  it('parses a pull quote with attribution', () => {
    const result = parseBlockElement(
      el('<blockquote data-pullquote data-attribution="Durov">Free forever</blockquote>'),
    );
    expect(result.type).toBe(BlockType.PULLQUOTE);
    expect(result.attribution).toBe('Durov');
    expect(result.text).toBe('Free forever');
  });

  it('parses images, video and audio', () => {
    expect(parseBlockElement(el('<img src="https://x/a.png" alt="cap">'))).toEqual({
      type: BlockType.PHOTO,
      url: 'https://x/a.png',
      caption: 'cap',
      credit: '',
      spoiler: false,
    });
    expect(parseBlockElement(el('<video src="https://x/v.mp4"></video>')).type).toBe(
      BlockType.VIDEO,
    );
    expect(parseBlockElement(el('<audio src="https://x/a.mp3"></audio>')).type).toBe(
      BlockType.AUDIO,
    );
  });

  it('parses a document file block', () => {
    expect(parseBlockElement(el('<tg-document src="https://x/a.pdf"></tg-document>'))).toEqual({
      type: BlockType.DOCUMENT,
      url: 'https://x/a.pdf',
      caption: '',
      credit: '',
      spoiler: false,
    });
  });

  it('reads the tg-spoiler attribute off media', () => {
    expect(
      parseBlockElement(el('<img src="https://x/a.png" data-spoiler alt="cap">')).spoiler,
    ).toBe(true);
  });

  it('parses an inline button row', () => {
    const buttons = JSON.stringify([
      { type: 'url', style: 'primary', label: 'Docs', value: 'https://tfr.dev' },
      { type: 'copy_text', label: 'Copy', value: 'hello' },
    ]);
    const result = parseBlockElement(el(`<div class="tg-buttons" data-align="left" data-buttons='${buttons}'></div>`));
    expect(result.type).toBe(BlockType.BUTTONS);
    expect(result.align).toBe('left');
    expect(result.buttons).toEqual([
      { type: 'url', style: 'primary', label: 'Docs', value: 'https://tfr.dev' },
      { type: 'copy_text', label: 'Copy', value: 'hello' },
    ]);
  });

  it('drops malformed button JSON instead of showing broken buttons', () => {
    const result = parseBlockElement(
      el('<div class="tg-buttons" data-buttons="[{broken"></div>'),
    );
    expect(result.buttons).toEqual([]);
  });

  it('parses the thinking placeholder', () => {
    expect(
      parseBlockElement(el('<div class="tg-thinking" data-text="Parsing…"></div>')),
    ).toEqual({ type: BlockType.THINKING, text: 'Parsing…' });
  });

  it('parses a slideshow gallery from data-images', () => {
    const result = parseBlockElement(
      el(
        '<div class="tg-gallery" data-kind="slideshow"' +
          ' data-images="https://x/a.jpg,https://x/b.jpg"></div>',
      ),
    );
    expect(result).toEqual({
      type: BlockType.SLIDESHOW,
      images: ['https://x/a.jpg', 'https://x/b.jpg'],
      caption: '',
      credit: '',
    });
  });

  it('parses a collage gallery from child images', () => {
    const result = parseBlockElement(
      el(
        '<div class="tg-gallery" data-kind="collage">' +
          '<img src="https://x/a.jpg"><img src="https://x/b.jpg"></div>',
      ),
    );
    expect(result).toEqual({
      type: BlockType.COLLAGE,
      images: ['https://x/a.jpg', 'https://x/b.jpg'],
      caption: '',
      credit: '',
    });
  });

  it('reads a media caption and its credit', () => {
    // The <figcaption> Rich HTML puts after the media, and the <cite> in it.
    expect(
      parseBlockElement(
        el('<video src="https://x/v.mp4" data-caption="Clip" data-credit="Ada"></video>'),
      ),
    ).toEqual({
      type: BlockType.VIDEO,
      url: 'https://x/v.mp4',
      caption: 'Clip',
      credit: 'Ada',
      spoiler: false,
    });

    expect(
      parseBlockElement(
        el(
          '<div class="tg-gallery" data-kind="slideshow" data-images="https://x/a.jpg"' +
            ' data-caption="Trip" data-credit="Ada"></div>',
        ),
      ),
    ).toEqual({
      type: BlockType.SLIDESHOW,
      images: ['https://x/a.jpg'],
      caption: 'Trip',
      credit: 'Ada',
    });
  });

  it('shows only the media the message will actually carry', () => {
    // The preview renders these straight into the app window. A URL the
    // serializer refuses must not appear in a preview of that message either.
    expect(parseBlockElement(el('<img src="javascript:alert(1)">')).url).toBe('');
    expect(parseBlockElement(el('<img src="file:///etc/passwd">')).url).toBe('');
    expect(parseBlockElement(el('<video src="data:video/mp4;base64,AAAA"></video>')).url).toBe('');
    // Schemeless is not a URL the message can carry, so it is not previewed.
    expect(parseBlockElement(el('<img src="a.jpg">')).url).toBe('');
    // …but the app's own local-media scheme is checked by protocol, and stays.
    expect(parseBlockElement(el('<img src="tfrfile://media/C%3A%2Fpic.png">')).url).toBe(
      'tfrfile://media/C%3A%2Fpic.png',
    );

    expect(
      parseBlockElement(
        el(
          '<div class="tg-gallery" data-kind="slideshow"' +
            ' data-images="https://x/ok.jpg,javascript:alert(1),file:///etc/passwd"></div>',
        ),
      ).images,
    ).toEqual(['https://x/ok.jpg']);
  });

  it('parses a map block', () => {
    const result = parseBlockElement(
      el('<div class="tg-map" data-lat="35.6892" data-lon="51.389"></div>'),
    );
    expect(result).toEqual({ type: BlockType.MAP, latitude: 35.6892, longitude: 51.389 });
  });

  it('keeps inline formatting as segments', () => {
    const result = parseBlockElement(el('<p>plain <strong>bold</strong></p>'));
    expect(result.text).toBe('plain bold');
    expect(result.inline).toEqual([
      { text: 'plain ', marks: [] },
      { text: 'bold', marks: ['bold'] },
    ]);
  });

  it('keeps inline buttons as inline segments so the preview can draw them', () => {
    const result = parseBlockElement(
      el(
        '<p>Pay <tg-button type="url" style="success" url="https://t.me/pay">Pay</tg-button> now</p>',
      ),
    );
    expect(result.text).toBe('Pay Pay now');
    expect(result.inline[1]).toEqual({
      text: 'Pay',
      marks: [InlineType.BUTTON],
      href: 'https://t.me/pay',
      button: expect.objectContaining({ type: 'url', style: 'success' }),
    });
  });

  it('omits the inline list when there is no formatting', () => {
    const result = parseBlockElement(el('<p>just text</p>'));
    expect(result.inline).toBeUndefined();
  });

  it('parses footer', () => {
    const result = parseBlockElement(el('<footer>Footnote</footer>'));
    expect(result).toEqual({ type: BlockType.FOOTER, text: 'Footnote' });
  });

  it('returns null for unknown elements', () => {
    expect(parseBlockElement(el('<span>x</span>'))).toBeNull();
  });
});

describe('parseAllBlocks', () => {
  it('parses multiple children', () => {
    const container = el('<div><h1>Title</h1><p>Body</p><hr></div>');
    const blocks = parseAllBlocks(container);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe(BlockType.HEADING);
    expect(blocks[1].type).toBe(BlockType.PARAGRAPH);
    expect(blocks[2].type).toBe(BlockType.DIVIDER);
  });

  it('returns empty for null container', () => {
    expect(parseAllBlocks(null)).toEqual([]);
  });
});
