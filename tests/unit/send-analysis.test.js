/**
 * Unit tests for the send-analysis collector — the capability checks that
 * run BEFORE a send and either block it with a reason or ride one advisory
 * toast. The rules mirror the live Bot API docs (drafts carry no media,
 * Web App buttons live in private chats, LoginUrl needs @BotFather,
 * switch_inline needs inline mode, 16 nesting levels).
 */
import { describe, it, expect } from 'vitest';
import { collectSendIssues } from '../../src/renderer/lib/send-analysis.js';

/** Wrap html in a body exactly the way the serializer output looks. */
const doc = (html) => `<body>${html}</body>`;

describe('collectSendIssues', () => {
  it('a clean rich send raises nothing', () => {
    const html = doc('<h2>Hi</h2><p>Plain <b>bold</b> text with <a href="https://t.me">a link</a>.</p>');
    expect(collectSendIssues({ html, chatId: '@channel', mode: 'send' })).toEqual([]);
  });

  describe('drafts and media never mix', () => {
    const cases = [
      ['a local photo', '<img src="tfrfile://pic_a1b2">'],
      ['a picked video', '<video src="tfrfile://vid_c3d4"></video>'],
      ['an uploaded audio', '<audio src="https://example.com/a.mp3"></audio>'],
      ['a document', '<tg-document src="https://example.com/x.pdf"></tg-document>'],
      ['a slideshow', '<tg-slideshow><img src="https://a/1.jpg"><video src="https://a/2.mp4"></video></tg-slideshow>'],
      ['a collage', '<tg-collage><img src="https://a/1.jpg"><img src="https://a/2.jpg"></tg-collage>'],
    ];
    for (const [what, media] of cases) {
      it(`blocks a draft whose document carries ${what}`, () => {
        const issues = collectSendIssues({
          html: doc(`<p>Before</p>${media}<p>After</p>`),
          chatId: '12345',
          mode: 'draft',
        });
        expect(issues).toEqual([{ key: 'toast.draftNoMedia', blocking: true }]);
      });
    }

    it('a draft with text and tg-thinking is fine — the placeholder is draft-only', () => {
      const html = doc('<p>Actually</p><tg-thinking longer="60"><p>Hmm</p></tg-thinking>');
      expect(collectSendIssues({ html, chatId: '@channel', mode: 'draft' })).toEqual([]);
    });

    it('the same document sends fine as a rich message', () => {
      const html = doc('<p>Before</p><img src="https://example.com/a.jpg"><p>After</p>');
      expect(collectSendIssues({ html, chatId: '12345', mode: 'send' })).toEqual([]);
    });
  });

  describe('the 16-level nesting bound', () => {
    it('blocks content nested deeper than the documented limit', () => {
      const deep = doc('<blockquote>'.repeat(16) + '<p>too deep</p>' + '</blockquote>'.repeat(16));
      const issues = collectSendIssues({ html: deep, chatId: '@channel', mode: 'send' });
      expect(issues).toEqual([{ key: 'toast.limit.nesting', blocking: true }]);
    });

    it('fifteen nested blocks plus content sit at the 16-level edge — allowed', () => {
      const ok = doc('<blockquote>'.repeat(15) + '<p>edge</p>' + '</blockquote>'.repeat(15));
      expect(collectSendIssues({ html: ok, chatId: '@channel', mode: 'send' })).toEqual([]);
    });

    it('a nesting violation wins over button advisories but both are reported', () => {
      const real = doc('<blockquote>'.repeat(16) + '<p>x</p>' + '</blockquote>'.repeat(16)
        + '<tg-buttons><tg-button type="login_url" data-style="primary">Login</tg-button></tg-buttons>');
      const issues = collectSendIssues({ html: real, chatId: '6789', mode: 'send' });
      expect(issues).toEqual([
        { key: 'toast.limit.nesting', blocking: true },
        { key: 'toast.warn.loginurl', blocking: false },
      ]);
    });
  });

  describe('button chat scopes', () => {
    it('a web_app button needs a private chat — numeric ids only', () => {
      const html = doc('<tg-buttons><tg-button type="web_app" data-style="primary">App</tg-button></tg-buttons>');
      expect(collectSendIssues({ html, chatId: '12345', mode: 'send' })).toEqual([]);
      expect(
        collectSendIssues({ html, chatId: '-1001234', mode: 'send' }),
      ).toEqual([{ key: 'toast.warn.webAppPrivate', blocking: false }]);
      expect(
        collectSendIssues({ html, chatId: '@channelname', mode: 'send' }),
      ).toEqual([{ key: 'toast.warn.webAppPrivate', blocking: false }]);
    });

    it('a login_url button gets the BotFather advisory anywhere', () => {
      const html = doc('<tg-buttons><tg-button type="login_url">Sign in</tg-button></tg-buttons>');
      expect(collectSendIssues({ html, chatId: '12345', mode: 'send' })).toEqual([
        { key: 'toast.warn.loginurl', blocking: false },
      ]);
    });

    it('inline-query buttons get the inline-mode advisory', () => {
      for (const type of ['switch_inline_query', 'switch_inline_query_chosen_chat']) {
        const html = doc(`<tg-buttons><tg-button type="${type}">Share</tg-button></tg-buttons>`);
        expect(collectSendIssues({ html, chatId: '12345', mode: 'send' }), type).toEqual([
          { key: 'toast.warn.inlineQuery', blocking: false },
        ]);
      }
    });

    it('advisories are deduplicated — two offending buttons, one note', () => {
      const html = doc(
        '<tg-button type="login_url">A</tg-button>'
        + '<tg-button type="login_url">B</tg-button>',
      );
      expect(collectSendIssues({ html, chatId: '12345', mode: 'send' })).toEqual([
        { key: 'toast.warn.loginurl', blocking: false },
      ]);
    });

    it('both advisories on one row stay distinct', () => {
      const html = doc(
        '<tg-buttons><tg-button type="login_url">A</tg-button>'
        + '<tg-button type="switch_inline_query">B</tg-button></tg-buttons>',
      );
      expect(collectSendIssues({ html, chatId: '-1001234', mode: 'send' })).toEqual([
        { key: 'toast.warn.loginurl', blocking: false },
        { key: 'toast.warn.inlineQuery', blocking: false },
      ]);
    });
  });
});
