/**
 * Unit tests for the send-analysis module — the capability checks that run
 * BEFORE a send and either block it with a reason or ride one advisory toast,
 * plus the shared `analyzeSend` prepare that both the real send flow and the
 * article inspector run. The rules mirror the live Bot API docs (drafts carry
 * no media, Web App buttons live in private chats and not on behalf of a
 * business account, switch_inline drops for business connections and
 * direct-messages chats, message effects are private-chat only, LoginUrl
 * needs @BotFather, switch_inline needs inline mode, 16 nesting levels).
 */
import { describe, it, expect } from 'vitest';
import {
  analyzeSend,
  collectSendIssues,
} from '../../src/renderer/lib/send-analysis.js';
import {
  buildChecklistBody,
  buildDraftBody,
  buildEditBody,
  buildRichMessageBody,
} from '../../src/shared/html-serializer.js';

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
    it('a web_app button needs a private chat — rejected, not just advised', () => {
      const html = doc('<tg-buttons><tg-button type="web_app" data-style="primary">App</tg-button></tg-buttons>');
      expect(collectSendIssues({ html, chatId: '12345', mode: 'send' })).toEqual([]);
      expect(
        collectSendIssues({ html, chatId: '-1001234', mode: 'send' }),
      ).toEqual([{ key: 'toast.warn.webAppPrivate', blocking: true }]);
      expect(
        collectSendIssues({ html, chatId: '@channelname', mode: 'send' }),
      ).toEqual([{ key: 'toast.warn.webAppPrivate', blocking: true }]);
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

  describe('business connections and message scope', () => {
    const appButton = '<tg-button type="web_app" url="https://telegram.org">App</tg-button>';
    const inlineButton = '<tg-button type="switch_inline_query" query="q">Share</tg-button>';

    it('a web_app button cannot ride a business-connection message — Telegram rejects it', () => {
      const html = doc(`<tg-buttons>${appButton}</tg-buttons>`);
      expect(
        collectSendIssues({
          html, chatId: '12345', mode: 'send',
          sendParams: { businessConnectionId: 'biz_conn_1' },
        }),
      ).toEqual([{ key: 'toast.warn.businessApp', blocking: true }]);
    });

    it('switch_inline buttons drop on business-connection messages', () => {
      const html = doc(`<tg-buttons>${inlineButton}</tg-buttons>`);
      expect(
        collectSendIssues({
          html, chatId: '12345', mode: 'send',
          sendParams: { businessConnectionId: 'biz_conn_1' },
        }),
      ).toEqual([{ key: 'toast.warn.businessInline', blocking: true }]);
    });

    it('switch_inline buttons drop in direct-messages chats too', () => {
      const html = doc(`<tg-buttons>${inlineButton}</tg-buttons>`);
      expect(
        collectSendIssues({
          html, chatId: '12345', mode: 'send',
          sendParams: { directMessagesTopicId: '77' },
        }),
      ).toEqual([{ key: 'toast.warn.businessInline', blocking: true }]);
    });

    it('the inline-in-text chip is checked the same as row buttons', () => {
      const html = doc(`<p>Text ${appButton} more text</p>`);
      expect(
        collectSendIssues({
          html, chatId: '12345', mode: 'send',
          sendParams: { businessConnectionId: 'biz_conn_1' },
        }),
      ).toEqual([{ key: 'toast.warn.businessApp', blocking: true }]);
    });

    it('message effects are documented private-chat only', () => {
      const html = doc('<p>Hello</p>');
      expect(
        collectSendIssues({
          html, chatId: '12345', mode: 'send',
          sendParams: { messageEffectId: 'effect_1' },
        }),
      ).toEqual([]);
      expect(
        collectSendIssues({
          html, chatId: '-1001234', mode: 'send',
          sendParams: { messageEffectId: 'effect_1' },
        }),
      ).toEqual([{ key: 'toast.warn.effectPrivate', blocking: true }]);
    });

    it('without a business connection the old advisories keep their shape', () => {
      const html = doc(`<tg-buttons>${inlineButton}</tg-buttons>`);
      expect(
        collectSendIssues({
          html, chatId: '-1001234', mode: 'send',
          sendParams: {},
        }),
      ).toEqual([{ key: 'toast.warn.inlineQuery', blocking: false }]);
    });
  });
});

describe('analyzeSend — the prepare the send flow and the inspector share', () => {
  const base = {
    editorHtml: '<p>Hello</p>',
    chatId: '12345',
    mode: 'send',
    isRtl: false,
    skipEntities: false,
    publish: {},
  };

  it('a plain send prepares exactly the sendRichMessage body the builders shape', () => {
    const prepared = analyzeSend(base);
    // The whole point of the shared step: hand-built equals shared-built.
    expect(prepared.requests({})).toEqual([
      {
        kind: 'rich',
        method: 'sendRichMessage',
        body: buildRichMessageBody(
          prepared.message.html,
          '12345',
          { isRtl: false, skipEntityDetection: false, sendParams: {} },
        ),
      },
    ]);
    expect(prepared.checklistStep).toBe(false);
  });

  it('a draft prepares a sendRichMessageDraft that keeps a tg-thinking block', () => {
    const draftEditor = '<div class="tg-thinking" data-text="Dry run"></div><p>Latest</p>';
    const prepared = analyzeSend({ ...base, editorHtml: draftEditor, mode: 'draft', draftId: 3 });
    const steps = prepared.requests({});
    expect(steps.map((step) => step.method)).toEqual(['sendRichMessageDraft']);
    // The outbound draft really carries the placeholder — the serializer ran
    // with keepThinking, so the inspector preview shows the alias too.
    expect(JSON.stringify(steps[0].body)).toContain('tg-thinking');
    expect(steps[0].body).toEqual(
      buildDraftBody(
        prepared.message.html,
        '12345',
        3,
        { isRtl: false, skipEntityDetection: false, sendParams: {} },
      ),
    );
    // The prepare also mirrors the send flow's draft-only media check.
    const mediaDraft = analyzeSend({ ...base, editorHtml: '<p>x</p><img src="https://a/b.jpg">', mode: 'draft' });
    expect(mediaDraft.issues).toEqual([{ key: 'toast.draftNoMedia', blocking: true }]);
  });

  it('an edit prepares editMessageText against the given message id', () => {
    const prepared = analyzeSend({ ...base, mode: 'edit', editId: '4242' });
    const [step] = prepared.requests({});
    expect(step.method).toBe('editMessageText');
    expect(step.body).toEqual(
      buildEditBody(
        prepared.message.html,
        '12345',
        '4242',
        { isRtl: false, skipEntityDetection: false, sendParams: {} },
      ),
    );
  });

  describe('the interactive checklist step', () => {
    const tasks = '<ul data-type="taskList"><li>Buy milk</li><li>Post news</li></ul>';
    const checklistBase = {
      ...base,
      editorHtml: `<p>Today</p>${tasks}`,
      businessId: 'biz_conn_1',
    };

    it('a business connection aimed at a private chat adds sendChecklist first', () => {
      const prepared = analyzeSend({ ...checklistBase });
      expect(prepared.interactiveChecklist).toBe(true);
      expect(prepared.checklistStep).toBe(true);
      expect(prepared.doneIgnored).toBe(false);

      const steps = prepared.requests({ title: 'Errands' });
      expect(steps.map((step) => step.method)).toEqual(['sendChecklist', 'sendRichMessage']);
      expect(steps[0].body).toEqual(
        buildChecklistBody(prepared.message.checklist, '12345', {
          title: 'Errands',
          businessConnectionId: 'biz_conn_1',
        }),
      );
      // The title rides the checklist only when the flow resolves it.
      expect(steps[0].body.checklist.title).toBe('Errands');
    });

    it('a business connection elsewhere keeps the checklist inline instead', () => {
      const prepared = analyzeSend({ ...checklistBase, chatId: '@channelname' });
      expect(prepared.interactiveChecklist).toBe(false);
      expect(prepared.checklistStep).toBe(false);
      expect(prepared.requests({}).map((step) => step.method)).toEqual(['sendRichMessage']);
    });

    it('a pre-ticked task flags the ignored-done notice for the flow to toast', () => {
      const done =
        '<ul data-type="taskList">'
        + '<li>Buy milk</li><li><input type="checkbox" checked>Already done</li></ul>';
      const prepared = analyzeSend({ ...checklistBase, editorHtml: `<p>Today</p>${done}` });
      expect(prepared.checklistStep).toBe(true);
      expect(prepared.doneIgnored).toBe(true);
      // And the body never carries the tick — only markChecklistTasksAsDone can.
      const [step] = prepared.requests({ title: 'Errands' });
      for (const task of step.body.checklist.tasks) {
        expect(task.done).toBeUndefined();
      }
    });
  });

  it('the publish sheet resolves the business id: sheet first, Settings fallback', () => {
    const sheet = analyzeSend({ ...base, publish: { businessConnectionId: 'sheet_conn' } });
    expect(sheet.sendParams.businessConnectionId).toBe('sheet_conn');

    const fallback = analyzeSend(base);
    expect(fallback.sendParams.businessConnectionId).toBe('');
    const settingsId = analyzeSend({ ...base, businessId: 'biz_conn_1' });
    expect(settingsId.sendParams.businessConnectionId).toBe('biz_conn_1');
  });

  it('the same publish sheet reaches the request body untouched', () => {
    const publish = {
      silent: true,
      protectContent: true,
      messageThreadId: '12',
      businessConnectionId: '',
    };
    const prepared = analyzeSend({ ...base, publish, businessId: 'biz_conn_1' });
    const [step] = prepared.requests({});
    expect(step.body.disable_notification).toBe(true);
    expect(step.body.protect_content).toBe(true);
    expect(step.body.message_thread_id).toBe(12);
    expect(step.body.business_connection_id).toBe('biz_conn_1');
  });
});
