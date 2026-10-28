# Changelog

## [5.9.1] - 2026-10-28

### Fixed — iPadOS / Android chrome clearance

- **The title bar no longer hides under the status bar.** On iPadOS the web
  view fills the whole screen, so the time/date (and the battery/wifi cluster)
  sat on top of the settings button and the tools. The viewport now opts into
  `viewport-fit=cover` and the shell pads itself inside the safe-area insets —
  chrome sits below the status bar, content clears the home indicator at the
  bottom. On desktop every `env()` resolves to 0, so nothing moves there;
  Android's edge-to-edge enforcement (targetSdk 36) benefits from the same fix

## [5.9.0] - 2026-10-27

### Added — iOS / iPadOS (sideloaded, no Mac required)

- **The app builds for iOS now.** A `.github/workflows/ios.yml` workflow runs
  on GitHub's **free macOS runner** (public repo, free minutes): it builds the
  renderer, syncs it into the Capacitor iOS shell, compiles the whole thing
  with `xcodebuild` **unsigned**, and uploads a `TelegramFreeRich-unsigned.ipa`
  artifact. No Apple developer account anywhere in the loop
- **The Electron main process is rebuilt natively as `TfrBridgePlugin`**
  (Swift, `ios/App/App/`): the Telegram client is URLSession — token attached
  in the plugin, the same hand-built multipart uploads as the desktop
  (`net/request.js` contract mirrored field-for-field), the same system /
  manual / direct proxy modes through the URLSession proxy dictionary, and
  the desktop's evidence-based proxy error hints
- **Settings encrypted for real** — AES-256-GCM via CryptoKit, the key
  generated inside the **Keychain** and never landing in a file;
  `loadSettings` still never returns the token
- **All ten IPC channels re-implemented**: drafts file, connection tests,
  decrypted settings, the system document picker (picked files are copied into
  the app's private `Documents/tfr` folder), and no-op window controls
- **Local media on-device** — a `WKURLSchemeHandler` registered in
  `MainViewController` answers `tfrfile://media/…` from the app's own folders
  only, stricter-path-checked than the desktop's absolute-path rule, and the
  renderer's Capacitor bridge is now shared (`bridge-capacitor.js`) by both
  Android and iOS
- **Install it yourself**: run the workflow, download the .ipa, sign it with
  your ordinary Apple ID through **Sideloadly** (Windows), enable Developer
  Mode on the iPad — 7-day re-sign cycle, documented in both READMEs

## [5.8.0] - 2026-10-27

### Added — Android

- **The app is on Android now.** The same renderer ships as an APK through
  Capacitor: `npm run android` → `android/app/build/outputs/apk/debug/app-debug.apk`.
  The Electron main process is rebuilt natively as `TfrBridgePlugin` (Java):
  the Telegram client is OkHttp — token attached in the plugin, the same
  multipart uploads, the same system / manual / direct proxy modes — settings
  are AES-256-GCM with the key generated inside AndroidKeyStore, and the
  method allowlist, field regexes and the 50 MB upload cap mirror the
  desktop's exactly
- **`window.app` on Android** is a 1:1 restatement of the preload bridge — ten
  channels, including the local drafts file and the SAF document picker (files
  are copied into the app's private cache and served to the editor and preview
  through an intercepted `tfrfile://` scheme, stricter-path-checked than the
  desktop's)
- **Cleaned house** — every installer older than the current release was
  removed from `dist/` (about 1.5 GB freed)

## [5.7.8] - 2026-10-25

### Added — a chat-ID history and a scheduler

- **Saved chat IDs.** The chat-ID field in Settings keeps a history: every
  ID that survives a *Save* joins a chip list under the field — click a
  chip to load it, ✕ to prune it. No more delete-one-and-type-the-other
  round trip. The list lives in localStorage (capped at twelve, newest
  kept) and survives restarts
- **Scheduled messages, like Telegram's send options.** Right-click the
  send button and pick **Schedule…**: a date and time panel (native
  calendar + clock pickers, checked against the clock before it closes —
  a queued entry is never a past one), then the message is validated with
  the exact send plan and leaves the composer into the queue
- **The local queue is honest about what the Bot API can do.** No send
  method through API 10.3 carries a `schedule_date` (verified against the
  live method pages and the full changelog), so — like Telegram's own
  clients — the queue is local: entries persist across restarts, fire
  while the app runs, oldest first, and a failed send stays queued to
  face the next tick
- **Scheduled queue sheet.** From the same send menu: every queued entry
  with its due time, target chat and first words — **send now**, retry or
  drop an entry

## [5.7.7] - 2026-10-22

### Added — the formula editor typesets as you type

- **Insert formula grew a live preview.** The sigma button now opens a
  dedicated LaTeX editor: a monospaced, readable-height source field
  beside a KaTeX window that re-renders every keystroke — the same math
  Telegram's clients draw for `<tg-math-block>`. A malformed source
  displays as-is instead of throwing, Ctrl+Enter inserts, and the panel
  stays open until the source has content (a blank confirm does nothing)
- **Editing a formula that exists.** With the caret inside a math block,
  the dialog opens carrying that block's source and confirm rewrites it
  in place — no delete-and-retype round-trip
- **The chat preview typesets too.** The live Telegram-style preview
  renders inline `<tg-math>` and block `<tg-math-block>` through the same
  KaTeX pass, so the preview bubble matches what arrives in the chat
- **The writing column widened** — the centered document measure grows
  from 860px to 1000px (side padding 32px), a visibly larger writing
  space on wide windows that still reads comfortably across a line

## [5.7.6] - 2026-10-22

### Fixed — the fascia is one surface now

- **The buttons bar stopped being a separate card.** Title row and
  formatting tools now live inside a single merged glass top bar — no
  second strip between it and the article
- **The glass finally behaves like glass.** The workspace pulls itself up
  underneath the top bar (measured live, resizable toolbar included) and
  pads its scroller back down, so the editor content slides beneath the
  fascia and the blur acts on real text rather than an empty canvas; the
  preview and inspector columns start beneath the glass edge
- The material gained the off-axis light sweep Apple paints on Liquid
  Glass, and the buttons on the fascia answer the pointer with a brighter
  top specular — the interactive() behavior, translated

## [5.7.5] - 2026-10-22

### Added — Liquid Glass, tinted

- **The chrome went glass.** The top bar, the formatting strip and the
  bottom bar now render Apple's iOS 26 Liquid-Glass material: a translucent
  face carrying the running palette's accent tint, the top specular light
  with a faint bend around the other three edges, and the hairline where
  the fascia meets the content. Where nothing sits behind the strips the
  tint and light carry the material; where panels float, the blur does
  real refractive work
- **Every floating surface joined it** — dialogs, sheets, the crash card,
  send-mode and insert menus, the table bubble and its layout popover, and
  toasts are glass over the blurred workspace, one shared specular stack so
  they all read as a single material rather than adjacent tricks; the
  backdrop gained blur(28px) with a saturation lift, per the skill's own
  palette notes
- Content surfaces stay deliberately solid (editor, inspector, preview,
  inputs): glass is reserved for chrome and floats, per the liquid-glass
  material rules — text-on-glass readability intact in all four palettes,
  the Day glass on white verified against its ink contrast

## [5.7.4] - 2026-10-22

### Changed — four palettes, one app
- **The theme system grew from a toggle into a wardrobe** — Night (the navy
  the app was built in) is joined by **Black**, a true OLED palette that
  ends at zero; **Graphite**, Apple's neutral charcoal with the iOS
  dark-blue as the only accent; and **Day**, Telegram's Day voice on
  Apple's light grays. A theme is a complete remap of the same token
  contract, so stylesheets read their look and never care which palette
  runs; the stored `dark`/`light` spellings upgrade in place
- **The Settings picker became miniature canvases** — each theme rides a
  card that paints its own chrome at small scale (title bar, text lines,
  the round send button), the active palette rings in its accent; the one
  deliberately expressive piece of the settings sheet, everything around
  it stays quiet

### Changed — the material Apple would sign
- **Every dialog, sheet and popover now enters the way it behaves** — the
  overlay fades with a deeper blur, dialogs and sheets rise 12px and
  settle on one shared ease, popovers pop like Telegram Desktop's menus,
  toggled panels fade instead of flickering into place; all of it answers
  an interaction rather than decorating one, and prefers-reduced-motion
  collapses the lot
- Surfaces drop the hard borders where elevation says more: deeper
  two-stage shadow tokens per palette, per-theme scrollbar tints, tighter
  optical tracking on dialog and sheet titles

## [5.7.3] - 2026-10-20

### Fixed — a saved draft now sends as soon as it loads
- **Send and Clear answered nothing after a restore** — TipTap's
  `setContent` does not run the editor's own update event, so the state
  mirror the rest of the app reads stayed stale: loading a saved local draft
  (or booting with a restored autosave) left Send reporting "nothing to
  send" and the Clear button silently idle, until one character was moved.
  Loading now mirrors the editor's document state by hand
  (`mirrorEditorState`), so the very next Send sends exactly what the
  draft shows
- **The marker-style picker opened nothing and toasted "Network error"** —
  the picker dialog traveled from the actions registry through the action
  `ctx`, and the app's single `ctx` line-up predated it: `ctx.askChoice`
  resolved to `undefined`, the await threw, and the action wrapper's
  catch-all turned the TypeError into the misleading network toast. The
  helper is wired now, the two action runners log the real error to the
  console beside the author-facing toast, and the wiring guard test
  derives its contract from the action source (every `ctx.*` the actions
  await must exist on the app's real ctx), so a missing helper can no
  longer hide behind the mock ctxs of the unit tests

### Fixed — the window shows what the wire carries
- **Ordered marker styles were invisible on the composing surface** — the
  editor spelled the style `data-list-type`, and only the serializer
  translated it into the wire's `type` on the way out: a list sent as
  `a A i I` came back from the picker with correct markers in the message
  but dull decimal ones in the window. The node now renders the real
  `type` attribute (declared in both themes' CSS), and the preview already
  mirrored the style — picked markers appear in the composer the moment
  they are chosen, exactly like Telegram's
- **Reversed direction and per-item numbers round-trip and render** — the
  same both-dialects pair: the node parses the wire's bare `reversed` and
  `value` when a sent message is loaded for editing (they used to drop),
  and renders them so the browser's own markers count down and jump to
  explicit item numbers inside the window
- **The confirm dialog's "Clear" button was red on red** — the quiet
  danger text-button rule came later in the cascade than the primary
  fill's white text and won it: the Clear (and Delete-draft) confirm
  buttons painted red letters on the red fill, readable as silence. The
  saturated fill keeps its white text now; the red font stays on the quiet
  "Remove …" buttons

### Added — the wait for borderless tables is over
- **Borderless tables** — Telegram's Rich HTML carries two table forms and
  the wire only ever emitted one. The table Layout popover gains a
  **Borderless** switch alongside striped/compact: the serialized table
  drops its `bordered` attribute (a plain `<table>`), and the painter
  strips cell outlines and the header tint in the editor, the preview and
  (through the parser) the inspector's outline — the default table remains
  bordered, and old messages serialize exactly as before

### Changed — the marker style is picked, not typed
- **The ordered-list marker styles are now a picker** — the doc's five
  marker styles (numbers, lowercase letters, uppercase letters, lowercase
  Roman numerals, uppercase Roman numerals) come as a pick-one dialog row
  list with the current pick highlighted; no more `a/A/i/I` typing and its
  "use one of a, A, i, I" toast — the class of typo is gone, and the
  "Numbers" row is the plain numbered `<ol`

### Changed — one composer detail back to Telegram blue
- **The send FAB is Telegram's blue again** — the only saturated surface
  in the shell drifted to a salmon gradient; it rides the accent token in
  both themes now, matching the composer's round send button in Telegram
  Desktop night and day

### Changed — the inspector icon stopped dressing like the preview
- **Article inspector got its own glyph** — it sat next to the preview
  toggle as the same split-pane shape; it is the article's structure list
  now (a bullet column with outline rows), unmistakable beside the
  split-pane preview glyph at pill size

## [5.7.2] - 2026-10-19

### Fixed — the inspector now previews the same request a send runs
- **Request parity** — the inspector used to build its own `sendRichMessage`
  body regardless of the mode and re-serialize without the live options:
  drafts lost their `<tg-thinking>` block in the preview, edit modes showed a
  send body, and the interactive-checklist step was invisible. A shared
  `analyzeSend` now serializes once with the mode's exact options (thinking
  rides drafts, the interactive checklist only for a business connection on a
  private chat), collects the capability issues and exposes the send steps in
  order — a possible `sendChecklist` first, then the rich/draft/edit body.
  The send flow consumes the very same object, so the preview and the wire
  agree by construction

### Added — preflight for business-connection button rules
- The analyzer now receives the send parameters, and surfaces Telegram's
  documented button restrictions as **blocking** issues: Web App buttons
  cannot ride a message sent on behalf of a business account (neither can the
  inline-query buttons, which also drop in direct-messages chats), and
  *message_effect_id* is private-chat only while the publish sheet offers the
  field for any chat. A Web App button outside a private chat is likewise
  blocking now — Telegram rejects it instead of hiding it
- The block meter follows the live limits page closely: "Up to 500 blocks,
  **including nested blocks**" — a slideshow or collage now charges itself
  plus every media entry, and a table charges every row it emits, so an
  article near the limit can no longer look valid locally and fail at send

## [5.7.1] - 2026-10-18

### Fixed — the buttons-row dialog took the window down
- **Clicking the toolbar's buttons-row button crashed the app** — the shared
  dialog actions row read `dialog.options.danger`/`.confirmKey`, but the
  buttons-row, map, details and code-language dialogs were created without an
  `options` field; React unmounted at the title line before any panel could
  render. The inline-button-in-text dialog worked because it happened to pass
  `options`. Every `dialog.options` read is now null-safe, the four factories
  pass an explicit `options: {}`, and a new mounted-render test file
  (`dialog-render.test.js`) opens **every** dialog kind through the real
  provider so a crash like this can never ship silently again — the vitest run
  also gained the app's own React plugin, since no component test could even
  import `.jsx` sources before

### Changed — the table Layout popover, redrawn
- The per-cell/per-table popover is now two labelled sections: **Cell** sets
  horizontal and vertical alignment with one segmented control per axis (real
  stroke icons instead of unicode glyphs, the active edge filled), and
  **Table** carries the striped, compact and caption options as true pill
  switches; the caption row shows the caption's current text ("None set" when
  empty) and the toggles stay open so several options can be set in one pass

### Note — what Telegram does not let buttons do
- Checked against the live docs: the `align` attribute exists only on
  `tg-button-row` (already selectable in the row dialog); **the alignment of a
  button's label text and the button's size are not part of the Rich HTML
  grammar** — chips are laid out by Telegram itself, so the app will not fake
  editor-only styling that would mislead about the final message

## [5.7.0] - 2026-10-18

### Fixed — six spec-level gaps, each checked against the live Bot API docs
- **Drafts with media are now blocked with a reason** — Telegram's `sendRichMessageDraft` page is
  explicit: *"Direct upload of new files and explicit upload of files by a URL isn't supported."*
  Any media element in the document stops the draft send with a readable explanation instead of
  an opaque `Bad Request`
- **Mixed-media slideshows and collages really mix** — the serializer emitted every gallery entry
  as `<img>`, so a second video was uploaded as a photo and Telegram's own documented example
  (`<tg-slideshow><img/><video/></tg-slideshow>`) was rejected. Gallery entries are now
  `{ kind, src }` pairs: `<img>`, `<video>` and `<audio>` each serialize per kind, a locally
  picked `.mp4` uploads through its video channel and the same kind inference powers the preview
- **Collapsible blocks can start collapsed** — the serializer and preview forced `open` on every
  `<details>`, so an author could not ship a collapsed-by-default block. A new **Initially
  expanded** toggle in the details dialog writes the choice; the wire carries `open` only when
  the author asked, and the preview honours it (while the editor stays expanded to edit)
- **The 16-level nesting limit is enforced before sending** — Telegram documents "up to 16 levels
  of nested formatting and blocks"; content that passed the char/block/media checks could still
  nest too deep and die at the API. A DOM-tree preflight (`checkNestingDepth`) stops the send
  with an explanation, and the inspector shows the live depth
- **Code blocks can finally pick their language** — the serializer understood
  `<code class="language-…">` but no UI could produce it. A searchable language picker (42 common
  languages, plain text first, custom values typeable) labels the block; an empty pick clears the
  label, and re-picking re-labels the block under the caret
- **Maps are no longer zoom-13-only** — `InputRichBlockMap` documents zoom 0-24 (the old code
  hard-capped 13/20 and pinned 13), plus optional width/height ("must not exceed 10000 in total…,
  ratio at most 20") and a caption. The map dialog takes coordinates, zoom, size and caption with
  the bounds checked at authoring time; the serializer clamps zoom, drops an out-of-bounds size
  pair whole, and wraps a captioned map in `<figure>` like the docs example

### Added — the publish layer and the article inspector
- **Publish options sheet** — the sendRichMessage parameters the editor never exposed: forum
  **topic ID** (`message_thread_id`), **direct-messages topic** (`direct_messages_topic_id`),
  **reply target** (`reply_parameters`), **send silently**, **protect contents**, **message
  effect** and **business connection**. Fields ride the request only when set; drafts carry the
  documented topic field only; edit bodies stay untouched
- **Article inspector** — a right-side panel: the block **outline**, live **counts** (characters,
  blocks, media and nesting depth against the documented bounds), the **capability notes** a send
  would raise, and a read-only **request preview** — the exact body (Rich HTML and `sendParams`)
  the app is about to hand to Telegram
- **Capability warnings before sending** — one combined toast for what Telegram would reject or
  misread: Web App buttons in a non-private chat, Login URLs that still need a @BotFather
  whitelist, inline-query buttons and their chat scoping, on top of the draft-media and nesting
  guards (blocking) — all collected in one place (`send-analysis.js`) shared by the inspector

### Changed — a toolbar you can read
- The icon-dense strip is now four labelled groups — **Text** (history, formatting, text style,
  link), **Blocks** (lists, table, formula, collage), **Media**, **Publish** (buttons row, inline
  chip, publish options) — with the group caption above each row; @mention, custom emoji,
  formatted time and the thinking placeholder moved back into the searchable palette
- The publish sheet opens from the send menu as well as the toolbar

### Updated
- The README screenshot still said "Bot API 10.1" and showed a `{ blocks }` JSON dump — it now
  shows the labelled toolbar, the inspector with its Rich HTML/request preview, and 10.3 badges
- Both READMEs document the new window layout, publish sheet, inspector, mixed slideshows, code
  languages, map fields and the send-time guards; tests badge counts the current 430

## [5.6.0] - 2026-10-17

### Added — the Premium article features, driven from the Bot API
The rich-message API lets a bot carry almost everything Telegram's own Premium composer can.
Every one of these is editable in the app, serialized as documented Rich HTML, previewed live and
covered by tests:

- **Inline keyboard buttons** — `<tg-button-row>` rows with URL, callback data, Mini App, login,
  switch-inline (including the chosen-chat filters), copy-text and disabled kinds, Telegram's four
  styles, and row alignment; a structured dialog edits the whole row in place
- **Inline buttons inside text** (Bot API 10.3) — `<tg-button …>` (`RichTextButton`) can ride
  inside a paragraph instead of a `<tg-button-row>` block: one button, same kinds and styles,
  edited through its own compact dialog; the wand's "Inline button in text" inserts it, clicking
  the chip and invoking the palette edits or removes it
- The button serializer enforces the documented 10.3 rule that the `link` style may only travel
  on callback buttons — for any other kind the style is dropped rather than risking an API error
- The live preview draws in-text buttons at last: a colored `primary`/`success`/`danger` chip or the
  quiet `link` look rides inside the running paragraph where Telegram will place it, and a `url`
  button is clickable, opening its link like Telegram's clients do
- **Custom (Premium) emoji** — `<tg-emoji emoji-id>` with a Unicode fallback
- **Formatted date-time** — `<tg-time unix format>`, accepted as a unix timestamp or any parseable
  date, with the documented `w`/`D`/`T`-family format string
- **Anchors and references** — `<a name>` markers and `<tg-reference name>` spans joined by the
  footnote `#name` links
- **Inline mentions** — `tg://user?id=` links with a typed label
- **Thinking placeholder** — `<tg-thinking>` for draft-mode replies
- **Expandable quote** — the `expandable` flag on `<blockquote>`
- **Ordered-list extras** — `start`, the `a A i I` marker style, reversed numbering and explicit
  per-item values
- **Table extras** — caption, striped and compact rows (10.3's `is_compact`), per-cell
  `colspan`/`rowspan` and horizontal/vertical alignment
- **Document media** — `<tg-document src>` file tiles (10.3), alongside photo/video/audio, with
  `tg://document?id=` upload references
- **Media spoilers** — the `tg-spoiler` attribute blurs media in editor and preview alike
- **`skip_entity_detection`** — a toggle in the send menu that sends the flag, keeping hashtags and
  phone numbers as plain text
- The whole rich-message surface is re-checked against **Bot API 10.3**: the button classes
  (`RichMessageButton`, `RichTextButton`, the row `InputRichBlockButtons`), `is_compact`,
  expandable quotation and the document forms are all covered

### Added — media straight from the device
- **Pick photos, videos, audio and documents from local storage** — a native file dialog backs the
  media menu; several picked files become a slideshow, and a picked `.gif` uploads as an animation
  while a raw `.ogg` uploads as a voice note
- Uploads ride the documented `rich_message.media` list: each local file becomes a `tg://…?id=`
  reference and is attached as multipart `form-data`, hand-built over the Chromium network stack so
  system-proxy setups keep working
- The editor and preview display local files through the app's own `tfrfile://` protocol — no
  upload is needed to see them, and drafts keep the reference so they survive restarts

### Added — local drafts
- **Save and load drafts** with their exact Rich HTML and RTL flag through new IPC channels;
  drafts are capped (40 characters per name, 1 MiB of HTML, 100 drafts) and validated in the main
  process
- The current message is **autosaved** locally and offered back after a restart
- Deleting a draft is confirmed by a visible toast, so success and failure are both audible

### Changed — a full visual redesign
- A modern-minimal language across the app: ghost icon buttons on tinted active states instead
  of outlined pills, layered surfaces with one soft shadow scale, glass popovers (backdrop blur)
  for menus and the table bubble — now a floating pill — a floating card toolbar with group
  dividers, a centered document column in the editor, a gradient send button with a glow,
  rounder dialogs and sheets, and a flat title bar
- The toolbar now surfaces the wand's features directly: the buttons row, the 10.3 inline
  button, custom emoji, mention, formatted time, the thinking placeholder and collage each sit
  as a visible own button — the wand palette keeps them (and the long tail: anchors, references,
  URL media) for searching; the strip wraps onto further rows on narrow windows so no control
  ever scrolls out of reach

### Fixed — tables in right-to-left messages
- Table cells now follow the writing direction (`text-align: start`) instead of being pinned left,
  so a Persian header reads from the right edge
- The column-resize handle is mirrored to the trailing edge in RTL mode — previously it sat on the
  wrong border and dragged the wrong neighbour

### Fixed — the message broke against the real Telegram API
- **Every image, video, audio or document picked from the device failed to send** with
  "Bad Request: Can't parse InputRichMessageMedia: media not found": the upload manifest was built
  *inside* the `rich_message` object, but the main process reads it from the top-level body — so
  the files never rode the multipart request and Telegram got `attach://` references with nothing
  behind them. The manifest now rides the top level (and, incidentally, absolute local paths no
  longer leak into the JSON that reaches Telegram). Tests had pinned the broken shape; they now
  pin the main-process contract for all three send paths (send, draft, edit)
- **The inline button dialog never opened at all** — the app's action context was wired with the
  other dialogs but not `askInlineButton`, so clicking the feature (toolbar ⊞ or the palette) only
  ever threw and toasted a "network error". Every dialog helper the action registry uses is now
  wired, and a static renderer-wiring test keeps the two in step from now on
- **`<tg-thinking>` made Telegram refuse the whole message** with `rich_message_block_unsupported`:
  the tag is documented for `sendRichMessageDraft` streams only, but plain sends carried it too.
  It now rides drafts alone; a normal send strips the placeholder and says so in a toast
- A renderer error used to tear the screen down to a black, dead window. The app now mounts behind
  an error boundary — a crash shows a readable report with the message, the stack and a Reload
  button, and logs uncaught errors and promise rejections to the console
- A `.gif` URL sent a still `<img>` frame; Telegram documents an animation as
  `<video src="…animation.gif">`, so GIFs now follow the animation path (matching how a locally
  picked GIF already uploaded)

### Fixed — cleared content resurrecting itself
- Clearing the editor purges the autosave copy immediately; previously a pending write could
  survive the clear and resurrect the message on the next launch

### Fixed — the button row lost its alignment on every HTML round-trip
- The buttons-row node rendered only its chips; the stored `align` never reached the editor DOM,
  so saving/reloading a message (autosave, local draft, copy-paste) silently reset row alignment
  to default. The date-time node lost its `format` the same way — both now render what they parse
- The editor's inline chip stores its theme in `data-style`, not the DOM `style` attribute,
  which browsers normalise into empty CSS

## [5.5.0] - 2026-07-27

A full review of the codebase. No new features — ten defects found and fixed, each one verified
rather than assumed. The three that can bite a user in normal use are first.

### Fixed — a caption, a credit or a quote's source could be added but never removed
- Emptying the field and pressing OK resolved to "cancelled" rather than to "empty", so the action
  returned early and left the old value in place. Clearing a media caption, its credit, or a
  quote's attribution was impossible once set
- The same bug swallowed an empty checklist title: the send was silently abandoned instead of using
  the fallback title that exists for exactly that case

### Fixed — "Test connection" wiped the settings form while you watched
- Testing saves the token, which updated the stored settings, which re-ran the effect that fills
  the form — clearing the token field, the proxy password, and any unsaved edits to the chat, edit
  and business IDs, mid-test. The form is now filled when the panel opens, and only then
- Testing also announced "Settings saved", which was misleading: only the token is stored. It now
  reports the test result and nothing else

### Fixed — a cleared Edit ID came back on the next launch
- The ID was written to storage when set but never removed when cleared, so emptying the field
  looked like it worked and then reverted at startup. In Edit mode the app would go on rewriting
  whichever message that stale ID pointed at

### Fixed — the window could be navigated away from the app, taking the bot token with it
- The preload bridge belongs to the window, not to the page: navigate that window anywhere and the
  new page keeps `window.app.api()`, which signs every call with the stored token. Electron
  navigates a window by default when a link or file is dropped onto it
- The window now stays on its own page. Links meant for a browser (`http`, `https`, `mailto`) are
  handed to the real browser; `target="_blank"` opens there instead of in a frameless Electron
  window with no address bar; `<webview>` is refused

### Fixed — the renderer could ask the main process for any Telegram method
- The method name was checked against `/^[a-zA-Z]{3,64}$/`, which admits `getUpdates` (read
  everything the bot receives), `setWebhook` (redirect it) and `banChatMember`. Every call is signed
  with the user's token, so anything reachable was reachable as them. Replaced with an allowlist of
  the five methods the app actually sends

### Fixed — the preview showed links and media the message would not carry
- The preview parsed `href` and `src` straight out of the editor with no filter, while the
  serializer next to it applied a scheme allowlist. So an `ftp:` link looked like a working link in
  a preview of a message that would not contain it, and a `file:` image was rendered from disk
- Both parsers now use the serializer's own lists, so the preview shows what will be sent. Media
  with no usable URL is left out rather than drawn as a broken image
- The editor gained the same filter: pasting HTML from a web page brought its `<img src="file://…">`
  along, which the app's own CSP would then load

### Fixed — non-ASCII text from Telegram could come back mangled
- Response chunks were appended to a string one at a time, so a UTF-8 character split across a
  chunk boundary became two replacement characters — visible on any Persian bot name or error
  message, and enough to break the JSON parse when the split landed inside a string. Chunks are now
  decoded once, at the end
- An unparseable response now reports the HTTP status with it, so a captive portal or a block page
  can be told apart from a genuine API error

### Fixed — a map could point off the globe
- `parseFloat` accepted `999, 999` and `35 degrees, 51`; the coordinates went to Telegram and came
  back as an API error naming no block. Latitude and longitude are now range-checked where they are
  typed, and again before they reach the wire

### Fixed — the link filter was a denylist
- `sanitizeUrl` refused `javascript:`, `data:` and `vbscript:` by prefix. A denylist has to
  anticipate every dangerous scheme and misses the ones written to defeat it. It is now the same
  allowlist the serializer uses, and a bare `example.com` is read as `https://example.com` rather
  than dropped later on the wire

### Removed
- The `open-file` IPC handler and its `openFile` bridge method. Nothing in the renderer had ever
  called them; they were an unused way into the main process

### Verified
- The navigation guard driven in a real Electron window: before the fix, a page the window was
  navigated to reached `window.app.api()` and the main process ran the call for it. After, the
  navigation does not happen, `window.open` opens no window, and the app's own page still works
- The malicious-paste path driven through the real editor: `<a href="javascript:…">` and
  `<img src="file:///etc/passwd">` are both refused, `https://t.me/ok` and a real image are kept,
  and no console errors
- The UTF-8 fix reproduced against the old code, which turned `ربات` into `��بات`
- The app boots, the UI renders, Persian text types correctly, the bridge exposes exactly seven
  members, and the settings panel opens with every field
- 305 unit tests (up from 265), lint clean

## [5.4.0] - 2026-07-26

### Added — media can carry a caption
- Rich HTML captions a media item with a `<figcaption>` that follows it, and that caption may name
  its own source in a `<cite>`:
  `<video src="…"></video><figcaption>Clip title<cite>The Author</cite></figcaption>`
- **Media ▸ Caption…** asks for the caption, then for its credit, and writes both onto the photo,
  video, audio file or gallery the caret is on. Greyed out elsewhere, ticked once something is set,
  and clearing both fields removes the `<figcaption>` again
- A gallery's caption goes inside the wrapper, which is where the documented example puts it:
  `<tg-slideshow><img …/><figcaption>Trip<cite>Ada</cite></figcaption></tg-slideshow>`
- Like the quote attribution, the text lives in an attribute rather than in the editable body, so
  it survives editing; the editor shows it under the media and the live preview renders a real
  `<figcaption>`

### Fixed — a message of nothing but media could not be sent
- The send guard refused anything with zero characters, so a photo on its own, a gallery on its own
  or a map on its own was rejected as "nothing to send" — media carries no text. The guard now only
  refuses a document that produces no blocks at all, which the existing check after serialization
  already covered

### Verified
- Driven in a real Electron window: the media menu lists **Caption…**, both prompts appear with
  their translated hints, the editor document becomes
  `<img data-caption="A view from the pass" data-credit="Ada Lovelace" src="…">`, the preview shows
  the caption with its cite, and the send payload is
  `<img src="…"/><figcaption>A view from the pass<cite>Ada Lovelace</cite></figcaption>`
- 265 unit tests

## [5.3.0] - 2026-07-26

### Added — a quote can name its source
- Rich HTML documents `<blockquote>text<cite>Author</cite></blockquote>`, and the same `<cite>` on
  `<aside>`. The serializer already emitted it from a `data-attribution` attribute — but nothing
  could ever set that attribute, so no quote ever carried one. A plain `<blockquote>` did not even
  have the attribute to set
- **Aa ▸ Attribution…** asks who said it and writes it onto the quote the caret is in — either
  kind. It is greyed out outside a quote, shows a tick once a source is named, and clearing the
  field removes the `<cite>` again
- The attribution is drawn from the attribute rather than kept in the editable text, so it cannot
  be half-deleted while editing, and the live preview renders it as a real `<cite>`
- `block-parser.js` now reads the attribution off a plain quote too, not only a pull quote

### Internal
- `askText` accepts `placeholderKey` beside `placeholder`, so a translated hint can be shown where
  the existing callers pass a literal example
- 258 unit tests: the new menu entry and its enablement, the trimmed/cancelled prompt, `<cite>` on
  both quote kinds, escaping, and an empty attribution emitting no `<cite>`

### Verified
- Driven in a real Electron window: the Aa menu lists **Attribution…** after Pull quote, the editor
  document becomes `<blockquote data-attribution="Pavel Durov">`, the preview shows the cite, and
  the send payload is
  `<blockquote><p>Bots deserve rights too</p><cite>Pavel Durov</cite></blockquote>`

## [5.2.1] - 2026-07-26

Same application code as 5.2.0. Only the release notes changed: 5.2.0 shipped before the workflow
could compose them, and a published release's body cannot be rewritten afterwards — so this tag
carries the notes and the screenshots that 5.2.0's release page is missing.

### The slideshow carousel, in the editor and in the preview

| A slideshow, frame 1 of 3 | The same slideshow on the video frame |
|---|---|
| ![Slideshow carousel](https://raw.githubusercontent.com/Aporis3674/TelegramFreeRich/v5.2.1/docs/slideshow.png) | ![Video that cannot be previewed](https://raw.githubusercontent.com/Aporis3674/TelegramFreeRich/v5.2.1/docs/slideshow-video.png) |

A collage stays a grid — tiles, no arrows:

![Collage](https://raw.githubusercontent.com/Aporis3674/TelegramFreeRich/v5.2.1/docs/collage.png)

- A slideshow is **one frame at a time** now, with `‹` / `›` buttons, a `2 / 3` counter and
  clickable dots, wrapping around at either end. It was a row of thumbnails scrolling sideways
- **A video in a gallery no longer draws a broken image.** Every entry used to be rendered as
  `<img>`, so a video or audio URL always showed the browser's broken-image icon even though
  Telegram renders it perfectly once sent. Entries are `<img>` / `<video controls>` /
  `<audio controls>` by extension, and when the media genuinely will not load in the app window the
  tile says what the file is — a ▶ / ♪ / 🖼 glyph, the file name, and *"Not previewable here —
  Telegram will show it"*
- The editor's gallery is drawn by a TipTap node view, so the wire format is untouched
- Full detail in the [5.2.0 entry](#520---2026-07-26) below

## [5.2.0] - 2026-07-26

| A slideshow, frame 1 of 3 | The same slideshow on the video frame |
|---|---|
| ![Slideshow carousel](https://raw.githubusercontent.com/Aporis3674/TelegramFreeRich/v5.2.0/docs/slideshow.png) | ![Video that cannot be previewed](https://raw.githubusercontent.com/Aporis3674/TelegramFreeRich/v5.2.0/docs/slideshow-video.png) |

A collage stays a grid — tiles, no arrows:

![Collage](https://raw.githubusercontent.com/Aporis3674/TelegramFreeRich/v5.2.0/docs/collage.png)

### Slideshows are a carousel now, in the editor and in the preview
- A slideshow used to be a row of thumbnails scrolling sideways in both panes. It is now a proper
  carousel: **one frame at a time**, with `‹` / `›` buttons, a `2 / 3` counter and clickable dots.
  Wrapping around at either end
- The editor's gallery is drawn by a TipTap **node view**, so only what you *see* changed —
  `renderHTML` still emits `div.tg-gallery[data-kind][data-images]`, which is what `getHTML()` and
  the serializer read. The wire format is untouched
- The preview carousel keeps its position while you keep typing, instead of resetting on every
  keystroke
- **A collage stays a grid**, because that is what a collage is — no arrows there, just tiles

### Fixed — a video in a gallery showed a broken image
- Every gallery entry was rendered as `<img>`, so a video or audio URL always drew the browser's
  broken-image icon even though Telegram renders it perfectly once sent. Entries are now
  `<img>` / `<video controls>` / `<audio controls>` by file extension
- When the media genuinely will not load in the app window — a Telegram CDN link often refuses —
  the tile says what the file is: a ▶ / ♪ / 🖼 glyph, the file name, and
  *"Not previewable here — Telegram will show it"*. No more broken-image icon standing in for a
  file that is perfectly fine

### Verified
- Driven in a real Electron window with a three-item slideshow (two images and a video URL):
  editor and preview both report `1 / 3`, two nav buttons and three dots; stepping forward moves
  both to `2 / 3` and shows the labelled tile for the video. The collage renders three tiles with
  no nav buttons. The editor HTML is unchanged throughout
- Screenshots in `docs/`

## [5.1.6] - 2026-07-26

### Docs
- **Several table-of-contents links in both READMEs went nowhere.** GitHub's heading slugs are
  unpredictable once emoji, Persian text and zero-width joiners are in the heading — `#-پنجرهٔ-برنامه`,
  `#-چطور-کار-می‌کند`, `#️-what-you-can-send` and two more never resolved. Both files now carry
  explicit `<a id="…">` anchors with the same ASCII ids in either language
- New **When something goes wrong** section in both languages: what each proxy error means, how to
  tell a Telegram `Bad Request` apart from a network failure, `chat not found`, `not enough rights`,
  the Windows uninstall dialog, and how to reset the encrypted settings
- Corrected details that had gone stale: the packaging row now names the Windows portable build,
  `npm run build` shows both artifacts it produces, `Settings.jsx` is described with the business
  connection and proxy it now holds, the validation allowlists include the business connection ID,
  `installer/installer.nsh` appears in the project layout, and the live-preview bullet no longer
  claims to render "the exact blocks that will be sent" — the send path is HTML
- New `tests/unit/docs.test.js`: fails on a dead in-document link, a duplicate anchor, a README
  version that disagrees with `package.json`, a link to a file that does not exist, an unbalanced
  `<details>` block, or the two READMEs drifting apart in sections or badges
- 253 unit tests

## [5.1.5] - 2026-07-26

### Fixed — a checklist can be sent to a channel after all
- 5.1.4 treated `sendChecklist` as the only way to send a checklist and, since that method is
  business-account-only, fell back to a plain `☑` / `☐` text list. That was wrong: **Rich HTML has
  its own task-list form**, `<ul><li><input type="checkbox" checked>done</li></ul>`, so a checklist
  travels inside an ordinary rich message — in a channel, a group or a private chat — and Telegram
  draws real checkboxes with the ticks preserved
- That is now the normal path, with nothing to configure. Verified in a real Electron window: the
  app emits `rich_message.html = "<ul><li><input type=\"checkbox\">buy milk</li></ul>"`
- `sendChecklist` stays for what it actually is — Telegram's *interactive* checklist, whose boxes
  readers tick themselves — used only when a business connection ID is configured and the chat is
  private. The Settings help text and both READMEs now say which is which
- The apologetic "sent as a ☑ / ☐ list" notice is gone; the only remaining note is when a business
  connection is configured but the chat is not private

## [5.1.4] - 2026-07-26

### Fixed — checklists could not be sent
- Telegram answered `Bad Request: can't parse InputChecklist: Can't find field "title"`. The body
  was `checklist: { items: [{ text, done }] }`, which is not a shape the API has. `InputChecklist`
  is `{ title, tasks }`, and each `InputChecklistTask` is `{ id, text }` with a **positive id
  unique within the checklist**
- `buildChecklistBody` now emits exactly that, caps the list at the documented **30 tasks** and
  each task at **100 characters**, and drops `done`: there is no way to send a task pre-ticked —
  `markChecklistTasksAsDone` is what ticks one afterwards. The app says so before sending when
  items were checked in the editor
- The app asks for the checklist title, since the API requires one

### Added — checklists work without a business account too
- `sendChecklist` only works for **a bot acting on behalf of a connected business account, in a
  private chat**. That is a Telegram restriction, not a payload problem, so a plain bot token can
  never send an interactive checklist
- Settings gained **Business connection ID** (optional, stored encrypted beside the bot token).
  With it set and a private chat, a real checklist is sent
- Without it, the task list is rendered into the message body as a `☑` / `☐` list instead of
  failing, and a toast says which of the two conditions was missing
- Both READMEs gained a **Checklists** section spelling out the three cases

### Verified
- Driven in a real Electron window with a stubbed API: with a business connection the app emits
  `{"chat_id":"12345","checklist":{"title":"Shopping","tasks":[{"id":1,"text":"buy milk"}]},"business_connection_id":"…"}`;
  without one it emits `rich_message.html = "<ul><li>☐ buy milk</li></ul>"` and shows the
  explanatory toast
- 240 unit tests, including the markup TipTap actually emits for a task list

## [5.1.3] - 2026-07-26

### Fixed (Critical) — every send failed with `net::ERR_INVALID_ARGUMENT`
- The request layer set `Content-Length` by hand on POSTs. Chromium computes that header from
  the body it is given and **rejects a manually supplied one**, so every send — rich message,
  draft, edit, checklist — was refused locally before it ever reached the network. GET requests
  carry no body and no such header, which is why **Check connection to Telegram kept reporting
  success while nothing could be sent**
- Only `Content-Type` is set now. Reproduced and then confirmed fixed in a real Electron 35
  runtime: with the header, an identical POST fails `net::ERR_INVALID_ARGUMENT`; without it the
  request leaves the process and fails only on the network beyond it
- `request.test.js` now records the headers the requester sets and fails if a POST carries
  anything besides `Content-Type`

## [5.1.2] - 2026-07-26

### Fixed (Critical) — the app crashed on launch
- Every launch died with **"Uncaught Exception: TypeError: Session can only be received when app
  is ready"** before a window appeared. `src/main/main.js` built the Telegram requester at module
  scope and passed it `session.defaultSession`, but Electron throws on that property until
  `app.whenReady()` has fired — so the crash happened while the main process was still loading
  its modules. Introduced in 5.1.0 with the proxy work; **5.1.0 and 5.1.1 cannot start at all**
- `createRequester` now takes a `getSession` getter and reads the session per request, when the
  app is long past ready. Verified in a real Electron 35 runtime: the requester is constructed
  before ready without throwing, then resolves the session and sends
- `packaging.test.js` fails if any line in `main.js` reaches `session.defaultSession` without
  deferring it, and `request.test.js` asserts the getter is untouched at construction time

## [5.1.1] - 2026-07-26

### Fixed — the Windows installer refused to upgrade an existing install
- Installing over an older version failed with **"Failed to uninstall old application files.
  Please try running the installer again.: 2"** and **"TelegramFreeRich cannot be closed"**.
  Before copying files, the new installer runs the *old* version's uninstaller; that uninstaller
  exits with code 2 when it believes `TelegramFreeRich.exe` is still running, and electron-builder
  turns any non-zero code into a hard abort. One leftover process — a crashed copy, a Chromium
  helper, or a second window the app used to allow — made the app permanently un-upgradable
- New `installer/installer.nsh`: the installer now closes the app itself (a polite `taskkill`
  first, so settings are flushed, then `/F /T` for the helper processes) *before* the old
  uninstaller looks for it, and a failed uninstall is written to the details log instead of
  aborting the installation — the new files overwrite the old ones either way
- The app now takes a **single-instance lock**. Launching it again focuses the open window
  instead of starting a second process that holds the same installed files open

### Added
- **Portable Windows build** (`TelegramFreeRich-*-portable.exe`) — no installer, no uninstaller,
  nothing in the registry. The escape hatch when a machine will not cooperate with NSIS

### Packaging
- NSIS options made explicit: per-user install (no admin rights), elevation allowed, settings
  kept on uninstall, desktop and Start-menu shortcuts, and installer filenames without spaces
  (`TelegramFreeRich-Setup-5.1.1.exe`)
- `directories.buildResources` moved to `installer/`, which is committed — the previous default
  was the git-ignored `build/`, where the renderer bundle is written
- 225 unit tests; the new `packaging.test.js` pins each of these settings, because a broken
  installer cannot be caught by any test that runs on Linux

### CI
- The release job now runs only for `v*` tags, so a manual `workflow_dispatch` is a safe dry
  build of both platforms

## [5.1.0] - 2026-07-26

### Added — proxy support for blocked countries
- Every Telegram request now goes through Electron's `net` module (Chromium's network stack)
  instead of Node's `https`. Node ignores the operating system's proxy settings, so with a VPN
  client on "Set system proxy" — the normal v2rayN setup where Telegram is blocked — requests
  used to leave unproxied and time out
- Settings → **Connection** with three modes: **System proxy** (default), **Manual proxy** and
  **No proxy**. Manual mode has one-click presets for v2rayN's SOCKS5 (`127.0.0.1:10808`) and
  HTTP (`127.0.0.1:10809`) endpoints, plus optional credentials
- **Check connection to Telegram** reports the proxy Chromium resolved and whether
  `api.telegram.org` answered, so a blocked network is distinguishable from a bad token
- Proxy failures now name the cause: a dead tunnel reports
  `ERR_PROXY_CONNECTION_FAILED — check the proxy (socks5://127.0.0.1:10808)`, and a
  TLS-intercepting proxy says so instead of showing a bare certificate error
- Proxy credentials are answered through Electron's `login` event and stored encrypted beside
  the bot token; the renderer only learns whether a password exists

### Internal
- New `src/main/net/proxy.js` (pure configuration helpers) and `src/main/net/request.js`
  (injectable requester with timeout, 1 MB cap and proxy-aware errors)
- 214 unit tests; the request layer is covered with a fake `net`, and the proxy modes were
  verified in a real Electron runtime (`system` resolved the OS proxy, `manual` resolved
  `SOCKS5 127.0.0.1:10808`, `direct` resolved `DIRECT`)

## [5.0.0] - 2026-07-26

### Fixed (Critical) — messages could not be sent at all
- `sendRichMessage` was called with `rich_message: { blocks: [...] }`, a shape the API does not
  accept. `InputRichMessage` carries **exactly one of `html` or `markdown`**; the `RichBlock`
  array is the *receiving* shape, returned inside `Message.rich_message`. Every send failed,
  which is what the "error when sending a heading" report came down to
- New `src/shared/html-serializer.js` walks the editor DOM into Telegram's documented **Rich
  HTML** vocabulary and builds the request bodies:
  - marks → `<b> <i> <u> <s> <code> <mark> <sub> <sup>`, spoiler → `<tg-spoiler>`,
    inline formula → `<tg-math>`
  - blocks → `<p> <h1>…<h6> <ul> <ol> <li> <pre> <blockquote> <footer> <hr/> <table> <details>`,
    pull quote → `<aside>`, formula → `<tg-math-block>`
  - media → `<img> <video> <audio>`, gallery → `<tg-collage>` / `<tg-slideshow>`,
    location → `<tg-map lat long zoom/>`
  - anything undocumented is unwrapped or dropped; links keep only `http`, `https`, `mailto`,
    `tel`, `tg` and `#anchor`, media only `http(s)`
- `sendRichMessageDraft` now sends the required non-zero `draft_id` and refuses non-private
  chats, as the API demands
- `editMessageText` sends `chat_id` + `message_id` + `rich_message`
- Documented limits are checked before sending: 32,768 characters, 500 blocks, 50 media files,
  20 table columns — each with its own message
- Removed `src/shared/block-serializer.js`; the block model stays only where it is correct —
  driving the live preview, which mirrors what Telegram sends back

### Tooling
- 179 unit tests, 48 of them pinning the Rich HTML output tag by tag
- Verified end to end in a headless build: the app now emits
  `{"chat_id":"…","rich_message":{"html":"<h1>…"}}`

### Breaking
- The renderer no longer produces a block array for sending; anything reading
  `block-serializer.js` must move to `html-serializer.js`

## [4.1.1] - 2026-07-26

### Fixed
- **Live preview rendered one character per line.** The table bubble menu and the preview bubble
  both used a `.bubble` class; the menu's `display: flex` leaked into the preview and squeezed
  every block into a column. The menu is now `.table-bubble`.

### Tooling
- New `tests/unit/styles.test.js`: fails when two stylesheets own the same class, when braces are
  unbalanced, or when a rule survives with no component using it — it caught two dead rules
  (`.menu-sep`, `.palette-foot`) on its first run
- 151 unit tests

### Packaging
- Renderer now builds to `build/renderer`. electron-builder excludes its own output directory
  from the packaged app, so with the renderer inside `dist/` the installers risked shipping
  without a UI; `app.asar` is now verified to contain `build/renderer/index.html`
- `package.json` gained author, license, homepage and repository — without the repository field
  electron-builder aborted a Linux build with "Cannot read properties of null (reading
  'channel')"
- App icon set to `logo.png` (512×512); Linux target declares category and maintainer;
  `build.publish` is null because the workflow uploads the release

### CI
- Build & Release now runs a verify job (lint + tests) and then a two-platform matrix —
  NSIS installer on Windows, AppImage on Linux — attaching both to the GitHub release
- The workflow can also be triggered manually (`workflow_dispatch`)

### Docs
- README and README_fa rewritten: hero screenshot, Premium-vs-bot comparison, three-step quick
  start, toolbar map, folded reference tables, security diagram and project layout

## [4.1.0] - 2026-07-26

### UI — toolbar rebuilt to the Telegram menu spec
- Seven formatting buttons after the history group: **Aa**, **B**, list, table, link, media, Σ
- **Aa → Formatting**: Heading (second level with H1–H6), Text, Quote, Pull quote, Code block,
  Footer, Divider
- **B → Text style**: Bold, Italic, Underline, Strikethrough, Spoiler, Subscript, Superscript,
  Marked
- **List**: Ordered list, Bullet list, Check list, Details (Details moved here from the Aa menu)
- **Table** inserts an editable 3×3 table in one click; a floating bar adds/removes rows and
  columns while the caret is inside the table
- **Link** opens a proper "Create link" panel with Text and URL fields plus Create / Cancel
- **Media** narrowed to Photo or video (two or more URLs become a slideshow), Audio file,
  Location
- **Σ** asks for a formula and inserts a math block
- Menus support a second level, with a back row at the top
- Removed the emoji button and the whole emoji picker: custom emoji are a Premium-only entity
  bots cannot send through the rich-message API
- Removed every violet Premium star badge — from the toolbar, the menus and the palette
- The right-to-left switch moved from the Aa menu to the title bar, next to settings and preview
- Monospace, inline formula, collage and clear-formatting stay reachable from the insert palette

### Tooling
- 147 unit tests; the action-registry suite now covers each menu's exact contents and order

## [4.0.0] - 2026-07-26

### UI — Telegram Desktop composer
- Window rebuilt to match Telegram Desktop's rich-text composer: frameless window with a
  renderer-drawn title bar, hairline-outlined pill toolbar and a single salmon send button.
  The toolbar carries no badges; violet Premium stars mark the individual features inside the
  menus instead
- Toolbar groups: undo/redo, then `Aa` (text style), `B` (formatting), lists, table, link,
  media, formula, with the emoji picker trailing
- New dropdown menu system (`Popover` + `ActionMenu`) with icons, shortcut hints, active
  checkmarks and separators
- Emoji picker: search, category strip, 480+ emoji dataset
- Insert palette behind the wand button — searchable list of every block and inline format
- Bottom bar: insert palette, character counter, clear, send; right-click send to choose
  rich message / draft / edit
- Live preview is now a collapsible side panel rendered as React elements (no
  `dangerouslySetInnerHTML`), showing checklists, galleries, maps, spoilers and inline math
- Custom promise-based prompt/confirm dialogs replace browser `prompt()` / `confirm()`
- Light theme reworked alongside the dark Telegram Night palette
- Persian UI mirrors the entire window (RTL), separate from the per-message RTL flag
- Window controls (minimize / maximize / close) via a validated `window-control` IPC channel;
  native traffic lights kept on macOS

### Editor
- Editor instance moved into React state and passed down as a prop — the `window.__tfrEditor`
  global is gone, so toolbar state reflects the real selection
- Extensions actually wired up: Link, Image, TaskList/TaskItem, Subscript, Superscript,
  Spoiler, InlineMath, PullQuote, Details, Footer, MathBlock, MediaBlock, GalleryBlock, MapBlock
- Single action registry (`lib/editor-actions.js`) drives the menus, the palette and the tests
- Keyboard shortcuts: Ctrl+Enter send, Ctrl+K link, Ctrl+P preview, Ctrl+, settings
  (Ctrl+Enter is left to the editor inside code blocks)

### Data model
- New `shared/inline-parser.js`: inline DOM is parsed into `{ text, marks[], href? }` segments
  instead of being flattened with `textContent`
- Serializer emits nested `RichText*` objects as `rich_text` next to the plain `text`
- Parser now understands task lists (→ `sendChecklist`), pull quotes, images, video, audio,
  slideshows, collages, maps, and reads math from `data-formula`
- Math blocks no longer carry the `$$` delimiters into the API payload

### Tooling
- 141 unit tests (was 62): inline parser, action registry, i18n parity, emoji dataset, plus
  the new block types
- i18n gained a React provider (`I18nProvider` / `useI18n`) and a pure `translate()`; locale
  files are key-for-key identical and covered by a test
- Removed the dead `renderer/app.js`, `ActionBar.jsx`, `SettingsPanel.jsx` and `TipTapEditor.jsx`
- Version unified at 4.0.0 across package.json, README and CHANGELOG

## [3.0.0] - 2026-07-24

### Security (Critical)
- Token NEVER stored or used in renderer — all API calls via secure IPC
- Removed all direct `fetch()` calls with bot token from renderer
- Removed plaintext token storage from `localStorage`
- Input validation for token, chatId, lang, and API method names
- HTTP timeout (30s) and response size limit (1MB) on Telegram requests
- CSP meta tag added to HTML
- URL scheme sanitization against `javascript:` / `data:` XSS

### Architecture
- Block State model: `BlockManager`, `block-parser`, `block-serializer`
- DOM → Block JSON → Telegram `InputRichBlock*` pipeline
- Checklist separated into its own `sendChecklist` API path
- Shared modules under `src/shared/` (types, utils, constants)

### UI
- React 19 + TipTap editor foundation
- Split-pane live preview panel
- RTL toggle
- i18n strings for English and Persian
- Toolbar regrouped (inline / block / media)

### Tooling
- ESLint + Prettier + EditorConfig
- Vitest unit tests (block manager, parser, serializer, utils, validation)
- Vite for React renderer build
- CI workflow: lint + test on PR/push
- Build workflow: Windows + Linux after tests pass

### Breaking
- Version bumped to 3.0.0
- Renderer settings no longer include raw token
- Production path expects Vite build output under `dist/renderer`

## [2.1.0] - 2026-07-23

### Security (Critical)
- Token now stored via `electron safeStorage` (OS-level encryption, not plain text)
- Settings saved to `userData/settings.enc` — encrypted on disk
- Token NEVER leaves main process after initial save
- Renderer no longer holds or passes token to API calls
- Input field shows `•••••••• (saved encrypted)` instead of plain token

### Architecture
- All Telegram HTTP requests moved to main process only
- `window.app.api(method, body)` — main process adds token internally
- New IPC channels: `save-settings`, `load-settings`, `tg-test`
- `loadSettings()` returns token existence flag (not the token itself)
- Removed `localStorage` usage for sensitive settings

### Removed
- `window.tgAPI.send(token, ...)` — token parameter no longer passed from renderer
- Plain-text settings in `localStorage`

## [1.0.0] - 2026-07-23

### Added
- Desktop Electron shell for Telegram Bot API rich messages
- Dark/Light theme toggle
- Settings panel with Bot Token, Chat ID, and Test Connection
- Keyboard shortcuts (Ctrl+B, Ctrl+I, Ctrl+U)
- Send modes: Rich Message, Draft, Edit
- Character counter (32,768 max)
- Toast notifications
- Clear All button

### Tech Stack
- Electron 35 (Desktop shell)
- Vanilla HTML + CSS + JavaScript
- electron-builder (NSIS installer)

### Supported Platforms
- Windows (x64 installer)
- Linux (AppImage)
