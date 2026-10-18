/**
 * send-analysis — the capability checks Telegram applies to a send, raised
 * here BEFORE the API does so the author sees a readable reason instead of an
 * opaque `Bad Request`.
 *
 * The rules come straight from the method and button docs:
 * - sendRichMessageDraft carries no media: "Direct upload of new files and
 *   explicit upload of files by a URL isn't supported."
 * - WebAppInfo buttons "can be used in private chats only".
 * - LoginUrl buttons must have their domain whitelisted with @BotFather.
 * - switch_inline_query buttons need a bot with inline mode enabled, and the
 *   `…_chosen_chat` variant does not work for business-connection messages.
 * - Rich messages allow "Up to 16 levels of nested formatting and blocks".
 *
 * Blocking issues stop the send; the rest are advisory and also surface in
 * the article inspector.
 *
 * @module lib/send-analysis
 */

import { checkNestingDepth, isPrivateChatId } from '../../shared/html-serializer.js';

/**
 * Collect the issues a send would hit, deduplicated, first occurrence wins.
 * @param {{
 *   html: string,
 *   chatId: string,
 *   mode: string,
 * }} params
 * @returns {Array<{ key: string, blocking: boolean }>}
 */
export function collectSendIssues({ html, chatId, mode }) {
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

  const isPrivate = isPrivateChatId(chatId);
  for (const button of doc.querySelectorAll('tg-button[type]')) {
    const type = button.getAttribute('type');
    if (type === 'web_app' && !isPrivate) push('toast.warn.webAppPrivate', false);
    else if (type === 'login_url') push('toast.warn.loginurl', false);
    else if (type && type.startsWith('switch_inline_query')) {
      push('toast.warn.inlineQuery', false);
    }
  }

  return issues;
}
