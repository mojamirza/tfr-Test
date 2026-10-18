/**
 * send-analysis — the capability checks Telegram applies to a send, raised
 * here BEFORE the API does so the author sees a readable reason instead of an
 * opaque `Bad Request`. It also owns the one "prepare the request" step both
 * a real send and the article inspector go through, so the preview can never
 * drift from what the wire will actually carry.
 *
 * The rules come straight from the method and button docs:
 * - sendRichMessageDraft carries no media: "Direct upload of new files and
 *   explicit upload of files by a URL isn't supported."
 * - WebAppInfo buttons are "available only in private chats between a user
 *   and the bot" and are "not supported for messages sent on behalf of a
 *   business account".
 * - The switch_inline_query buttons are not supported for messages sent
 *   "in channel direct messages chats and on behalf of a business account".
 * - message_effect_id is "for private chats only".
 * - LoginUrl buttons must have their domain whitelisted with @BotFather.
 * - switch_inline_query buttons need a bot with inline mode enabled.
 * - Rich messages allow "Up to 16 levels of nested formatting and blocks".
 *
 * Blocking issues stop the send; the rest are advisory and also surface in
 * the article inspector.
 *
 * @module lib/send-analysis
 */

import {
  buildChecklistBody,
  buildDraftBody,
  buildEditBody,
  buildRichMessageBody,
  checkNestingDepth,
  isPrivateChatId,
  serializeEditorHtml,
} from '../../shared/html-serializer.js';

/**
 * Collect the issues a send would hit, deduplicated, first occurrence wins.
 * @param {{
 *   html: string,
 *   chatId: string,
 *   mode: string,
 *   sendParams?: object,
 * }} params
 * @returns {Array<{ key: string, blocking: boolean }>}
 */
export function collectSendIssues({ html, chatId, mode, sendParams }) {
  const issues = [];
  const push = (key, blocking) => {
    if (!issues.some((issue) => issue.key === key)) issues.push({ key, blocking });
  };

  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');

  // Drafts and media never mix — any upload, local or by URL, is refused.
  if (mode === 'draft') {
    const media = doc.querySelector(
      'img, video, audio, tg-document, tg-slideshow, tg-collage',
    );
    if (media) push('toast.draftNoMedia', true);
  }

  // Formatting and blocks may nest at most 16 levels deep.
  if (!checkNestingDepth(html).ok) push('toast.limit.nesting', true);

  const params = sendParams || {};
  const businessId = String(params.businessConnectionId || '').trim();
  const dmTopic = Number(params.directMessagesTopicId || 0) > 0;
  const effectId = String(params.messageEffectId || '').trim();

  const isPrivate = isPrivateChatId(chatId);
  for (const button of doc.querySelectorAll('tg-button[type]')) {
    const type = button.getAttribute('type');
    if (type === 'web_app') {
      // "Available only in private chats between a user and the bot" — the
      // web hook Telegram documents right next to the business rule.
      if (!isPrivate) push('toast.warn.webAppPrivate', true);
      else if (businessId) push('toast.warn.businessApp', true);
    } else if (type === 'login_url') {
      push('toast.warn.loginurl', false);
    } else if (type && type.startsWith('switch_inline_query')) {
      // Business-connection messages and channel direct-messages chats both
      // drop these buttons — Telegram says "not supported" for either.
      if (businessId || dmTopic) push('toast.warn.businessInline', true);
      else push('toast.warn.inlineQuery', false);
    }
  }

  // Message effects are documented "for private chats only" on the method —
  // the publish sheet offers the field, so the sheet's context is checked.
  if (effectId && !isPrivate) push('toast.warn.effectPrivate', true);

  return issues;
}

/**
 * The single prepare step for both of the request's consumers — a real send
 * and the article inspector's preview — so serialization options, capability
 * issues and request bodies agree by construction instead of by two
 * hand-copied call sites.
 *
 * Serialization follows the mode: `<tg-thinking>` streams only in a draft,
 * and the interactive checkList is used only when a business connection is
 * aimed at a private chat (sendChecklist's documented requirement). The
 * returned `requests({ title })` builds the wire bodies in send order — a
 * possible `sendChecklist` step first, then the rich/edit/draft step — with
 * the checklist title resolved just before sending, exactly like the flow
 * does.
 *
 * @param {{
 *   editorHtml?: string,
 *   chatId?: string,
 *   mode?: string,
 *   editId?: string|number,
 *   draftId?: number,
 *   isRtl?: boolean,
 *   skipEntities?: boolean,
 *   publish?: object,
 *   businessId?: string,
 * }} [input]
 * @returns {{
 *   message: object,
 *   issues: Array<{ key: string, blocking: boolean }>,
 *   sendParams: object,
 *   interactiveChecklist: boolean,
 *   checklistStep: boolean,
 *   doneIgnored: boolean,
 *   requests: (options?: { title?: string }) => Array<{ kind: string, method: string, body: object }>,
 * }}
 */
export function analyzeSend(input = {}) {
  const {
    editorHtml = '',
    chatId = '',
    mode = 'send',
    editId = '',
    draftId = 1,
    isRtl = false,
    skipEntities = false,
    publish = {},
    businessId = '',
  } = input;

  // The publish sheet's business field wins until cleared, then Settings'.
  const sendParams = {
    ...publish,
    businessConnectionId: publish.businessConnectionId || businessId,
  };

  // The *interactive* checklist is a separate method that only works for a
  // bot acting for a connected business account in a private chat.
  const interactiveChecklist = !!sendParams.businessConnectionId && isPrivateChatId(chatId);
  const message = serializeEditorHtml(editorHtml, {
    // Every other task list renders as Rich HTML's `<input type="checkbox">`.
    inlineChecklist: !interactiveChecklist,
    // `<tg-thinking>` streams in draft mode only — plain sends drop it.
    keepThinking: mode === 'draft',
  });

  const issues = collectSendIssues({ html: message.html, chatId, mode, sendParams });
  const checklistStep = interactiveChecklist && message.checklist.length > 0;

  /**
   * Build the wire steps in send order. The checklist title is resolved in
   * the flow (asked, or the fallback) and handed in here; an absent title
   * previews the body as it would carry before the ask.
   * @param {{ title?: string }} [options]
   * @returns {Array<{ kind: string, method: string, body: object }>}
   */
  const requests = ({ title = '' } = {}) => {
    const steps = [];
    // The publish sheet's parameters ride as sendParams; the body builders
    // write each documented field only when it is set.
    const options = { isRtl, skipEntityDetection: skipEntities, sendParams };
    if (checklistStep) {
      steps.push({
        kind: 'checklist',
        method: 'sendChecklist',
        body: buildChecklistBody(message.checklist, chatId, {
          title,
          businessConnectionId: sendParams.businessConnectionId,
        }),
      });
    }
    if (message.html) {
      if (mode === 'draft') {
        steps.push({
          kind: 'rich',
          method: 'sendRichMessageDraft',
          body: buildDraftBody(message.html, chatId, draftId, options),
        });
      } else if (mode === 'edit') {
        steps.push({
          kind: 'rich',
          method: 'editMessageText',
          body: buildEditBody(message.html, chatId, editId, options),
        });
      } else {
        steps.push({
          kind: 'rich',
          method: 'sendRichMessage',
          body: buildRichMessageBody(message.html, chatId, options),
        });
      }
    }
    return steps;
  };

  return {
    message,
    issues,
    sendParams,
    interactiveChecklist,
    checklistStep,
    // The interactive form cannot carry a pre-ticked task — the notice only
    // matters when the send really uses it.
    doneIgnored: checklistStep && message.checklist.some((item) => item.done),
    requests,
  };
}
