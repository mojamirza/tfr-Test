/**
 * Application-wide constants for TelegramFreeRich.
 * @module shared/constants
 */

/** Maximum characters allowed in a Telegram message. */
export const MAX_CHARS = 32768;

/** Warning threshold (percentage of max chars) to show orange counter. */
export const CHAR_WARN_THRESHOLD = 0.9;

/** HTTP request timeout for Telegram API (milliseconds). */
export const HTTP_TIMEOUT_MS = 30000;

/** Maximum response body size in bytes (1 MB). */
export const MAX_RESPONSE_BYTES = 1048576;

/** Default language code. */
export const DEFAULT_LANG = 'en';

/**
 * The four palettes of the theme system — one shared token contract, four
 * remaps. The order is the theme cards' order in Settings.
 */
export const THEME_IDS = ['night', 'black', 'graphite', 'day'];

/** Default theme id. */
export const DEFAULT_THEME = 'night';

/**
 * Normalize a stored theme id. Two legacy spellings predate the four-theme
 * system and map onto their closest palette: the old boolean pair
 * `dark`/`light` become `night`/`day`; anything unknown falls to the default.
 * @param {string} stored
 * @returns {string} one of THEME_IDS
 */
export function themeOf(stored) {
  if (stored === 'dark') return 'night';
  if (stored === 'light') return 'day';
  return THEME_IDS.includes(stored) ? stored : DEFAULT_THEME;
}

/** Supported languages. */
export const SUPPORTED_LANGS = ['en', 'fa'];

/** Telegram Bot API base URL. */
export const TG_API_BASE = 'https://api.telegram.org';

/** Maximum undo stack depth. */
export const MAX_UNDO_DEPTH = 100;

/** Debounce delay for input events (ms). */
export const INPUT_DEBOUNCE_MS = 150;

/** Toast display duration (ms). */
export const TOAST_DURATION_MS = 2500;
