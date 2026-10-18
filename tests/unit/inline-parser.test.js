/**
 * Unit tests for the inline (RichText) parser.
 */
import { describe, it, expect } from 'vitest';
import {
  detectEntity,
  hasFormatting,
  parseInlineSegments,
  segmentsToText,
} from '../../src/shared/inline-parser.js';
import { InlineType } from '../../src/shared/block-types.js';

function el(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.firstElementChild;
}

describe('parseInlineSegments', () => {
  it('returns a single plain segment for unformatted text', () => {
    expect(parseInlineSegments(el('<p>hello</p>'))).toEqual([{ text: 'hello', marks: [] }]);
  });

  it('maps every tag to its inline type', () => {
    const segments = parseInlineSegments(
      el(
        '<p><strong>b</strong><em>i</em><u>u</u><s>s</s><code>c</code>' +
          '<mark>m</mark><sub>sub</sub><sup>sup</sup></p>',
      ),
    );
    expect(segments.map((s) => s.marks[0])).toEqual([
      InlineType.BOLD,
      InlineType.ITALIC,
      InlineType.UNDERLINE,
      InlineType.STRIKETHROUGH,
      InlineType.CODE,
      InlineType.MARKED,
      InlineType.SUBSCRIPT,
      InlineType.SUPERSCRIPT,
    ]);
  });

  it('nests marks in document order', () => {
    const segments = parseInlineSegments(el('<p><strong><em>both</em></strong></p>'));
    expect(segments).toEqual([{ text: 'both', marks: [InlineType.BOLD, InlineType.ITALIC] }]);
  });

  it('captures link targets', () => {
    const segments = parseInlineSegments(el('<p><a href="https://t.me/x">chat</a></p>'));
    expect(segments).toEqual([
      { text: 'chat', marks: [InlineType.LINK], href: 'https://t.me/x' },
    ]);
  });

  it('keeps the text but drops a target the message could not carry', () => {
    // These segments become real <a href> elements in the preview, inside the
    // window that holds the bot token. `javascript:` there would run there.
    for (const href of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>x</script>',
      'file:///etc/passwd',
      'vbscript:msgbox',
      // Accepted by the editor's link extension, refused on the wire — so it
      // must not look like a working link in a preview of that message.
      'ftp://host/file',
      'xmpp:someone@example.com',
    ]) {
      const segments = parseInlineSegments(el(`<p><a href="${href}">click</a></p>`));
      expect(segments, href).toEqual([{ text: 'click', marks: [InlineType.LINK] }]);
    }
  });

  it('keeps every scheme the message can carry', () => {
    for (const href of [
      'https://x/a',
      'http://x/a',
      'mailto:a@b.c',
      'tel:+15551234',
      'tg://resolve?domain=x',
      '#anchor',
    ]) {
      const segments = parseInlineSegments(el(`<p><a href="${href}">click</a></p>`));
      expect(segments[0].href, href).toBe(href);
    }
  });

  it('recognises spoiler and inline math spans', () => {
    const segments = parseInlineSegments(
      el('<p><span data-spoiler>shh</span><span data-inline-math>a^2</span></p>'),
    );
    expect(segments[0].marks).toEqual([InlineType.SPOILER]);
    expect(segments[1].marks).toEqual([InlineType.MATH]);
  });

  describe('inline buttons (Bot API 10.3 RichTextButton)', () => {
    it('carries the button record on its own segment', () => {
      const segments = parseInlineSegments(
        el(
          '<p>hi <tg-button type="url" style="danger" url="https://t.me/bot">Open chat</tg-button>!</p>',
        ),
      );
      // The label lies flat inline with the text around it…
      expect(segments.map((s) => s.text)).toEqual(['hi ', 'Open chat', '!']);
      const [seg] = segments.slice(1, 2);
      expect(seg.marks).toEqual([InlineType.BUTTON]);
      expect(seg.button).toEqual({
        type: 'url',
        style: 'danger',
        label: 'Open chat',
        value: 'https://t.me/bot',
        forwardText: '',
        requestWriteAccess: false,
        allowUserChats: false,
        allowBotChats: false,
        allowGroupChats: false,
        allowChannelChats: false,
      });
    });

    it('gives url-kind buttons an openable href, in the schemes the kind allows', () => {
      const allowed = parseInlineSegments(
        el('<p><tg-button type="url" url="tg://user?id=1">me</tg-button></p>'),
      );
      expect(allowed[0].href).toBe('tg://user?id=1');
      const skipped = parseInlineSegments(
        el('<p><tg-button type="url" url="mailto:a@b.c">nope</tg-button></p>'),
      );
      expect(skipped[0].href).toBeUndefined();
    });

    it('keeps the link look only on callback buttons, like the wire serializer', () => {
      const callback = parseInlineSegments(
        el('<p><tg-button type="callback_data" style="link" data="go">go</tg-button></p>'),
      );
      expect(callback[0].button.style).toBe('link');
      const url = parseInlineSegments(
        el('<p><tg-button type="url" style="link" url="https://t.me/bot">links</tg-button></p>'),
      );
      expect(url[0].button.style).toBe('');
    });

    it('does not merge adjacent buttons or let them nest', () => {
      const segments = parseInlineSegments(
        el(
          '<p><tg-button type="copy_text" text="A">A</tg-button><tg-button type="copy_text" text="B">B</tg-button></p>',
        ),
      );
      expect(segments.map((s) => s.text)).toEqual(['A', 'B']);
      expect(segments[0].button.value).toBe('A');
      expect(segments[1].button.value).toBe('B');
    });

    it('drops buttons with no label', () => {
      const segments = parseInlineSegments(
        el('<p><tg-button type="url" url="https://t.me/bot"></tg-button></p>'),
      );
      expect(segments).toEqual([]);
    });
  });

  it('ignores unstyled spans', () => {
    expect(parseInlineSegments(el('<p><span>x</span></p>'))).toEqual([{ text: 'x', marks: [] }]);
  });

  it('turns <br> into a newline in the same segment', () => {
    expect(parseInlineSegments(el('<p>a<br>b</p>'))).toEqual([{ text: 'a\nb', marks: [] }]);
  });

  it('merges adjacent runs that share the same marks', () => {
    const segments = parseInlineSegments(el('<p><strong>a</strong><strong>b</strong></p>'));
    expect(segments).toEqual([{ text: 'ab', marks: [InlineType.BOLD] }]);
  });

  it('drops empty text nodes', () => {
    expect(parseInlineSegments(el('<p><strong></strong>x</p>'))).toEqual([
      { text: 'x', marks: [] },
    ]);
  });

  it('handles a null root', () => {
    expect(parseInlineSegments(null)).toEqual([]);
  });
});

describe('hasFormatting', () => {
  it('is false for plain segments', () => {
    expect(hasFormatting([{ text: 'a', marks: [] }])).toBe(false);
  });

  it('is true when a mark or link is present', () => {
    expect(hasFormatting([{ text: 'a', marks: ['bold'] }])).toBe(true);
    expect(hasFormatting([{ text: 'a', marks: [], href: 'https://x' }])).toBe(true);
  });
});

describe('segmentsToText', () => {
  it('concatenates segment text', () => {
    expect(segmentsToText([{ text: 'ab' }, { text: 'cd' }])).toBe('abcd');
  });
});

describe('detectEntity', () => {
  it('detects Telegram entities', () => {
    expect(detectEntity('@durov')).toBe(InlineType.MENTION);
    expect(detectEntity('#tag')).toBe(InlineType.HASHTAG);
    expect(detectEntity('/start')).toBe(InlineType.BOT_COMMAND);
    expect(detectEntity('a@b.com')).toBe(InlineType.EMAIL);
    expect(detectEntity('+98 912 345 6789')).toBe(InlineType.PHONE);
  });

  it('returns null for ordinary text', () => {
    expect(detectEntity('just words')).toBeNull();
    expect(detectEntity('@ab')).toBeNull();
  });
});
