/**
 * Input validation for IPC handlers.
 * Pure functions — no Electron dependency so unit-testable.
 */

/**
 * Validate a Telegram Bot token format.
 * Format: digits:alphanumeric_string (e.g. "123456:ABC-DEF...")
 * @param {string} token
 * @returns {boolean}
 */
function isValidToken(token) {
  return typeof token === 'string' && /^\d+:[A-Za-z0-9_-]{35,}$/.test(token);
}

/**
 * Validate a Telegram chat ID.
 * Accepts numeric IDs (e.g. "-1001234567890") or @usernames (e.g. "@channel").
 * @param {string} chatId
 * @returns {boolean}
 */
function isValidChatId(chatId) {
  return typeof chatId === 'string' && (/^-?\d+$/.test(chatId) || /^@[\w]{5,}$/.test(chatId));
}

/**
 * Validate a language code.
 * @param {string} lang
 * @returns {boolean}
 */
function isValidLang(lang) {
  return typeof lang === 'string' && ['en', 'fa'].includes(lang);
}

/**
 * The Telegram methods the renderer is allowed to ask the main process to call.
 *
 * An allowlist rather than a shape check: every call is signed with the stored
 * bot token, so anything reachable here is reachable with the user's bot
 * identity. A pattern like /^[a-zA-Z]+$/ would also admit `getUpdates` (read
 * everything the bot receives), `setWebhook` (redirect it) and
 * `banChatMember` — none of which this app has any reason to send.
 */
const ALLOWED_METHODS = Object.freeze([
  'sendRichMessage',
  'sendRichMessageDraft',
  'editMessageText',
  'sendChecklist',
  'getMe',
]);

/**
 * Validate a Telegram API method name against the allowlist.
 * @param {string} method
 * @returns {boolean}
 */
function isValidMethod(method) {
  return typeof method === 'string' && ALLOWED_METHODS.includes(method);
}

const path = require('path');

/**
 * Validate a business connection ID — the opaque token `sendChecklist` needs.
 * Telegram does not document its shape, so this only bounds the length and
 * keeps it to the characters its IDs are made of.
 * @param {string} id
 * @returns {boolean}
 */
function isValidBusinessConnectionId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{4,128}$/.test(id);
}

/**
 * Validate a local-draft id — a UUID the main process minted when it saved.
 * @param {string} id
 * @returns {boolean}
 */
function isValidDraftId(id) {
  return (
    typeof id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
  );
}

/**
 * Validate a local-draft name — bounded length, no control characters.
 * @param {*} name
 * @returns {boolean}
 */
function isValidDraftName(name) {
  return (
    typeof name === 'string' &&
    name.trim().length > 0 &&
    name.length <= 80 &&
    // No control characters — [...] would trip ESLint's no-control-regex fire
    // guard against the same range, so the test stays explicit and readable.
    !String(name)
      .split('')
      .some((ch) => ch.codePointAt(0) < 0x20)
  );
}

/**
 * The local-media URL the renderer embeds — `tfrfile://media/<encoded path>` —
 * decoded back to an absolute path. Keep in step with `localUrlToPath` in the
 * shared rich-HTML serializer (that module is ESM, main is CommonJS, so the
 * ten lines are mirrored here rather than imported).
 * @param {string} url
 * @returns {string}
 */
function localMediaUrlToPath(url) {
  const prefix = 'tfrfile://media/';
  if (typeof url !== 'string' || !url.startsWith(prefix)) return '';
  try {
    return decodeURIComponent(url.slice(prefix.length)).replace(/[?#].*$/, '');
  } catch {
    return '';
  }
}

/**
 * Validate one multipart attachment entry the renderer asks main to upload —
 * bounded filename charset (the spec's media-id alphabet), nothing weird in
 * the path. Existence and size are checked by the caller, where `fs` sits.
 * @param {*} entry
 * @returns {boolean}
 */
function isValidAttachment(entry) {
  return (
    !!entry &&
    typeof entry === 'object' &&
    typeof entry.name === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(entry.name) &&
    typeof entry.path === 'string' &&
    path.isAbsolute(entry.path) &&
    entry.path.length > 0 &&
    entry.path.length <= 1024
  );
}

module.exports = {
  ALLOWED_METHODS,
  isValidToken,
  isValidChatId,
  isValidLang,
  isValidMethod,
  isValidBusinessConnectionId,
  isValidDraftId,
  isValidDraftName,
  localMediaUrlToPath,
  isValidAttachment,
};
