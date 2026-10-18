/**
 * App — application shell.
 *
 *   ┌ titlebar ──────────────────────────────────── ─ □ ✕ ┐
 *   │ [Aa][B][list][table][link][media][Σ]                  │
 *   │                                                       │
 *   │  editor                              │  preview       │
 *   │                                                       │
 *   │ (✦A)                        chars   (🗑)         (➤)  │
 *   └───────────────────────────────────────────────────────┘
 *
 * @module App
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent } from '@tiptap/react';

import BottomBar from './components/BottomBar.jsx';
import { DialogProvider, useDialogs } from './components/Dialog.jsx';
import Drafts from './components/Drafts.jsx';
import Inspector from './components/Inspector.jsx';
import Preview from './components/Preview.jsx';
import PublishSheet from './components/PublishSheet.jsx';
import Settings from './components/Settings.jsx';
import TitleBar from './components/TitleBar.jsx';
import { ToastProvider, useToast } from './components/Toast.jsx';
import TableBubble from './components/TableBubble.jsx';
import Toolbar from './components/Toolbar.jsx';
import useTfrEditor from './components/useTfrEditor.js';
import { I18nProvider, useI18n } from './i18n/index.js';
import {
  buildChecklistBody,
  buildDraftBody,
  buildEditBody,
  buildRichMessageBody,
  checkChecklist,
  checkLimits,
  isPrivateChatId,
  serializeEditorHtml,
} from '../shared/html-serializer.js';
import { DEFAULT_LANG, DEFAULT_THEME } from '../shared/constants.js';
import { insertLink } from './lib/editor-actions.js';
import { collectSendIssues } from './lib/send-analysis.js';

const THEME_KEY = 'tfr-theme';
const LANG_KEY = 'tfr-lang';
const EDIT_ID_KEY = 'tfr-edit-id';
const RTL_KEY = 'tfr-rtl';
const ENTITIES_KEY = 'tfr-skip-entities';
const AUTOSAVE_KEY = 'tfr-autosave';

/** Draft streaming needs a stable non-zero id so updates animate in place. */
const DRAFT_ID = 1;

/**
 * @param {{ lang: string, onLangChange: (lang: string) => void }} props
 */
function Shell({ lang, onLangChange }) {
  const { t, dir } = useI18n();
  const toast = useToast();
  const {
    askText,
    askLink,
    askButtons,
    askInlineButton,
    askCodeLanguage,
    askMap,
    askDetails,
    confirm,
  } = useDialogs();

  /**
   * The native device picker behind "insert media". Its title follows the UI
   * language; the part list is the renderer's view of what was picked.
   * @param {'media'|'audio'|'document'} kind
   */
  const askDeviceFiles = useCallback(
    (kind) => window.app.pickMedia(kind, tRef.current('dialog.mediaTitle')),
    [],
  );

  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || DEFAULT_THEME);
  const [settings, setSettings] = useState(() => ({
    tokenSet: false,
    chatId: '',
    editId: localStorage.getItem(EDIT_ID_KEY) || '',
    lang,
  }));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [isRtl, setIsRtl] = useState(() => localStorage.getItem(RTL_KEY) === '1');
  const [skipEntities, setSkipEntities] = useState(
    () => localStorage.getItem(ENTITIES_KEY) === '1',
  );
  const [html, setHtml] = useState('');
  const [charCount, setCharCount] = useState(0);
  const [mode, setMode] = useState('rich');
  const [sending, setSending] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [draftsSaving, setDraftsSaving] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  // The publish sheet's send parameters — sendRichMessage's optional fields
  // the editor body builders write only when set. The business connection
  // starts as whatever Settings holds, and stays editable here per send.
  const [publish, setPublish] = useState({
    messageThreadId: '',
    directMessagesTopicId: '',
    replyToMessageId: '',
    silent: false,
    protectContent: false,
    messageEffectId: '',
    businessConnectionId: '',
  });

  const tRef = useRef(t);
  tRef.current = t;

  const handleUpdate = useCallback((nextHtml, text) => {
    setHtml(nextHtml);
    setCharCount(text.length);
  }, []);

  const editor = useTfrEditor({
    placeholder: () => tRef.current('editor.placeholder'),
    onUpdate: handleUpdate,
    // Read through the ref so the gallery labels follow a language change.
    t: (key) => tRef.current(key),
  });

  /* ── persisted preferences ── */

  useEffect(() => {
    document.body.classList.toggle('light', theme === 'light');
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  useEffect(() => {
    localStorage.setItem(RTL_KEY, isRtl ? '1' : '0');
  }, [isRtl]);

  useEffect(() => {
    localStorage.setItem(ENTITIES_KEY, skipEntities ? '1' : '0');
  }, [skipEntities]);

  /* ── autosave + restore ──
   *
   * The message being written is mirrored to localStorage, so an accidental
   * restart keeps it. It is written from `html`/`isRtl` with the same format
   * the editor produced, and offered back on the next launch.
   */

  const restoreAutosave = useCallback(
    (data) => {
      if (!editor || !data || (!data.html || !data.html.trim())) return;
      editor.commands.setContent(data.html);
      if (data.isRtl) setIsRtl(true);
      toast(tRef.current('drafts.restored'), 'info');
    },
    [editor, toast],
  );

  useEffect(() => {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null');
    } catch {
      data = null;
    }
    if (data && data.html && data.html.trim()) restoreAutosave(data);
    // Ran once, on mount, after the editor exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    // One timer per state, cleaned up on every change — a typed-then-cleared
    // field always ends empty, and quitting the app right after Clear cannot
    // resurrect the message a stale pending write used to save.
    const timer = setTimeout(() => {
      try {
        if (html && html.trim()) {
          localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ html, isRtl }));
        } else {
          localStorage.removeItem(AUTOSAVE_KEY);
        }
      } catch {
        // A full quota must never cost the user their keystrokes.
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [html, isRtl]);

  // Removed, not skipped, when it is cleared. Only writing on a non-empty value
  // meant an emptied field came back on the next launch, and "Edit" mode then
  // silently rewrote whichever message that stale ID pointed at.
  useEffect(() => {
    if (settings.editId) localStorage.setItem(EDIT_ID_KEY, settings.editId);
    else localStorage.removeItem(EDIT_ID_KEY);
  }, [settings.editId]);

  // Load chat ID / token presence / language from the main process on mount.
  useEffect(() => {
    if (!window.app || !window.app.loadSettings) return;
    window.app
      .loadSettings()
      .then((loaded) => {
        setSettings((prev) => ({ ...prev, ...loaded }));
        if (loaded.lang && loaded.lang !== lang) onLangChange(loaded.lang);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The sheet's business connection follows Settings until touched here.
  useEffect(() => {
    if (settings.businessConnectionId) {
      setPublish((prev) => ({
        ...prev,
        businessConnectionId: prev.businessConnectionId || settings.businessConnectionId,
      }));
    }
  }, [settings.businessConnectionId]);

  /* ── services handed to the action registry ── */

  const notify = useCallback((key, type) => toast(tRef.current(key), type), [toast]);

  const toggleRtl = useCallback(() => {
    setIsRtl((prev) => {
      notify(prev ? 'toast.rtlOff' : 'toast.rtlOn');
      return !prev;
    });
  }, [notify]);

  const ctx = useMemo(
    () => ({
      askText,
      askLink,
      askButtons,
      askInlineButton,
      askCodeLanguage,
      askMap,
      askDetails,
      confirm,
      notify,
      askFiles: askDeviceFiles,
    }),
    [
      askText,
      askLink,
      askButtons,
      askInlineButton,
      askCodeLanguage,
      askMap,
      askDetails,
      confirm,
      notify,
      askDeviceFiles,
    ],
  );

  const patchPublish = useCallback(
    (patch) => setPublish((prev) => ({ ...prev, ...patch })),
    [],
  );

  const resetPublish = useCallback(() => {
    setPublish({
      messageThreadId: '',
      directMessagesTopicId: '',
      replyToMessageId: '',
      silent: false,
      protectContent: false,
      messageEffectId: '',
      businessConnectionId: settings.businessConnectionId || '',
    });
    notify('toast.settingsSaved', 'success');
  }, [settings.businessConnectionId, notify]);

  /* ── send ── */

  const handleSend = useCallback(async () => {
    if (!settings.tokenSet) {
      notify('toast.configureToken', 'error');
      setSettingsOpen(true);
      return;
    }
    if (!settings.chatId) {
      notify('toast.setChatId', 'error');
      setSettingsOpen(true);
      return;
    }
    // Not `charCount === 0`: a message of nothing but a photo, a gallery or a
    // map has no characters at all and is still perfectly sendable. Whether
    // anything survived serialization is checked below instead.
    if (!html.trim()) {
      notify('toast.nothingToSend', 'error');
      return;
    }
    if (mode === 'edit' && !settings.editId) {
      notify('toast.needEditId', 'error');
      setSettingsOpen(true);
      return;
    }

    // Drafts stream into a private chat only, and need a non-zero draft_id.
    if (mode === 'draft' && !isPrivateChatId(settings.chatId)) {
      notify('toast.draftPrivateOnly', 'error');
      return;
    }

    setSending(true);
    try {
      // A task list normally rides inside the message as Rich HTML's own
      // `<input type="checkbox">` list, which works in any chat. Telegram's
      // *interactive* checklist is a separate method, and it only works for a
      // bot acting for a connected business account in a private chat — so it
      // is used exactly when both of those hold.
      const businessId = settings.businessConnectionId || '';
      const asChecklist = !!businessId && isPrivateChatId(settings.chatId);
      const message = serializeEditorHtml(html, {
        inlineChecklist: !asChecklist,
        // `<tg-thinking>` streams in draft mode only — plain sends drop it.
        keepThinking: mode === 'draft',
      });
      const limits = checkLimits(message);
      if (!limits.ok) {
        notify(`toast.limit.${limits.reason}`, 'error');
        setSending(false);
        return;
      }

      if (message.thinkingDropped) {
        notify('toast.thinkingDropped', 'info');
      }

      // Capability checks, before Telegram can answer with an opaque error:
      // drafts carry no media, content may not nest deeper than 16 levels,
      // and some button kinds only work in particular chats. Blocking issues
      // stop the send; the rest ride one advisory toast — the article
      // inspector lists them with room to breathe.
      const issues = collectSendIssues({ html: message.html, chatId: settings.chatId, mode });
      const blocking = issues.find((issue) => issue.blocking);
      if (blocking) {
        notify(blocking.key, 'error');
        setSending(false);
        return;
      }
      const advisories = issues.filter((issue) => !issue.blocking);
      if (advisories.length) {
        toast(advisories.map((issue) => tRef.current(issue.key)).join('  •  '), 'info');
      }

      // Only worth a word when the user configured a business connection and
      // still did not get the interactive form: the chat is the reason.
      if (message.inlinedChecklist && businessId) {
        notify('toast.checklistPrivateOnly', 'info');
      }

      if (asChecklist && message.checklist.length > 0) {
        const valid = checkChecklist(message.checklist);
        if (!valid.ok) {
          notify(`toast.checklist.${valid.reason}`, 'error');
          setSending(false);
          return;
        }
        // Telegram takes a title above the tasks, and there is no way to send a
        // task pre-ticked — only markChecklistTasksAsDone can do that later.
        const title = await askText({
          titleKey: 'dialog.checklistTitle',
          placeholder: tRef.current('dialog.checklistTitlePlaceholder'),
        });
        if (title === null) {
          setSending(false);
          return;
        }
        if (message.checklist.some((item) => item.done)) {
          notify('toast.checklistDoneIgnored', 'info');
        }
        const result = await window.app.api(
          'sendChecklist',
          buildChecklistBody(message.checklist, settings.chatId, {
            title: title.trim() || tRef.current('dialog.checklistTitleFallback'),
            businessConnectionId: businessId,
          }),
        );
        if (!result.ok) {
          toast(`${tRef.current('toast.networkError')}: ${result.description}`, 'error');
        } else if (!message.html) {
          notify('toast.checklistSent', 'success');
        }
      }

      if (message.html) {
        // The publish sheet's parameters ride as sendParams; the body builder
        // writes each documented field only when the author set it.
        const options = {
          isRtl,
          skipEntityDetection: skipEntities,
          sendParams: {
            ...publish,
            businessConnectionId: publish.businessConnectionId || businessId,
          },
        };
        let result;
        if (mode === 'draft') {
          result = await window.app.api(
            'sendRichMessageDraft',
            buildDraftBody(message.html, settings.chatId, DRAFT_ID, options),
          );
        } else if (mode === 'edit') {
          result = await window.app.api(
            'editMessageText',
            buildEditBody(message.html, settings.chatId, settings.editId, options),
          );
        } else {
          result = await window.app.api(
            'sendRichMessage',
            buildRichMessageBody(message.html, settings.chatId, options),
          );
        }

        if (result.ok) {
          notify(
            mode === 'draft' ? 'toast.draftSent' : mode === 'edit' ? 'toast.edited' : 'toast.sent',
            'success',
          );
        } else {
          toast(`${tRef.current('toast.networkError')}: ${result.description}`, 'error');
        }
      } else if (message.checklist.length === 0) {
        notify('toast.nothingToSend', 'error');
      }
    } catch {
      notify('toast.networkError', 'error');
    }
    setSending(false);
  }, [settings, html, mode, isRtl, skipEntities, publish, notify, toast, askText]);

  /* ── local drafts ── */

  const refreshDrafts = useCallback(async () => {
    if (!window.app || !window.app.draftsList) return;
    try {
      const result = await window.app.draftsList();
      if (result.ok) setDrafts(result.drafts || []);
    } catch {
      // The panel simply shows an empty list.
    }
  }, []);

  // The list is loaded when the sheet is opened, not at startup: nothing else
  // needs it, and the file may be large.
  const openDrafts = useCallback(() => {
    setDraftsOpen(true);
    refreshDrafts();
  }, [refreshDrafts]);

  const saveDraft = useCallback(async () => {
    if (!html.trim()) {
      notify('toast.nothingToSend', 'error');
      return;
    }
    const name = await askText({
      titleKey: 'drafts.save',
      placeholderKey: 'drafts.namePlaceholder',
      value: '',
    });
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      notify('drafts.needName', 'error');
      return;
    }
    setDraftsSaving(true);
    try {
      const result = await window.app.draftsSave({ name: trimmed, html, isRtl });
      if (result.ok) {
        setDrafts(result.drafts || []);
        notify('drafts.saved', 'success');
      } else {
        notify('toast.networkError', 'error');
      }
    } catch {
      notify('toast.networkError', 'error');
    }
    setDraftsSaving(false);
  }, [html, isRtl, askText, notify]);

  const loadDraft = useCallback(
    async (draft) => {
      if (!draft || !editor) return;
      try {
        const result = await window.app.draftsLoad(draft.id);
        if (result.ok && result.draft) {
          editor.commands.setContent(result.draft.html || '');
          setIsRtl(!!result.draft.isRtl);
          setDraftsOpen(false);
          notify('drafts.loaded', 'success');
        } else {
          notify('toast.networkError', 'error');
        }
      } catch {
        notify('toast.networkError', 'error');
      }
    },
    [editor, notify],
  );

  const deleteDraft = useCallback(
    async (draft) => {
      try {
        const result = await window.app.draftsDelete(draft.id);
        if (result.ok) {
          setDrafts(result.drafts || []);
          // Audible proof the trash did something — the sheet stays open.
          notify('drafts.deleted', 'success');
        } else {
          notify('toast.networkError', 'error');
        }
      } catch {
        notify('toast.networkError', 'error');
      }
    },
    // The list stays as-is on failure, so the item remains deletable.
    [notify],
  );

  const handleClear = useCallback(async () => {
    if (charCount === 0 && !html.trim()) return;
    const ok = await confirm({
      titleKey: 'dialog.clearTitle',
      bodyKey: 'dialog.clearBody',
      confirmKey: 'dialog.clearConfirm',
      danger: true,
    });
    if (!ok || !editor) return;
    // Kill the autosave copy first, so a prompt quit after Clear cannot
    // resurrect the message — then empty the document itself.
    localStorage.removeItem(AUTOSAVE_KEY);
    editor.chain().focus().clearContent(true).run();
    setHtml('');
    setCharCount(0);
    notify('toast.cleared');
  }, [charCount, html, confirm, editor, notify]);

  /* ── shortcuts ── */

  useEffect(() => {
    const onKeyDown = (event) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      if (event.key === 'Enter') {
        // Inside a code block Ctrl+Enter belongs to the editor (exit code block).
        if (editor && editor.isActive('codeBlock')) return;
        event.preventDefault();
        handleSend();
      } else if (event.key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
      } else if (!event.shiftKey && event.key.toLowerCase() === 'p') {
        // Ctrl+Shift+P stays with the editor (spoiler).
        event.preventDefault();
        setPreviewOpen((v) => !v);
      } else if (event.key.toLowerCase() === 'k' && editor) {
        event.preventDefault();
        insertLink(editor, ctx);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSend, editor, ctx]);

  return (
    <>
      <TitleBar
        tokenSet={settings.tokenSet}
        previewOpen={previewOpen}
        draftsOpen={draftsOpen}
        inspectorOpen={inspectorOpen}
        isRtl={isRtl}
        onToggleRtl={toggleRtl}
        onTogglePreview={() => setPreviewOpen((v) => !v)}
        onToggleInspector={() => setInspectorOpen((v) => !v)}
        onOpenDrafts={openDrafts}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <Toolbar editor={editor} ctx={ctx} onPublishOptions={() => setPublishOpen(true)} />

      <main
        className={`workspace${previewOpen ? ' with-preview' : ''}${
          inspectorOpen ? ' with-inspector' : ''
        }`}
      >
        <div className="editor-pane" dir={isRtl ? 'rtl' : 'ltr'}>
          <EditorContent editor={editor} />
          <TableBubble editor={editor} ctx={ctx} />
        </div>
        {previewOpen && <Preview html={html} isRtl={isRtl} onClose={() => setPreviewOpen(false)} />}
        {inspectorOpen && (
          <Inspector
            open
            onClose={() => setInspectorOpen(false)}
            editorHtml={html}
            sendParams={{ chatId: settings.chatId, mode, publish }}
          />
        )}
      </main>

      <BottomBar
        editor={editor}
        ctx={ctx}
        charCount={charCount}
        mode={mode}
        onModeChange={setMode}
        skipEntities={skipEntities}
        onSkipEntitiesChange={setSkipEntities}
        sending={sending}
        onSend={handleSend}
        onClear={handleClear}
        onOpenPublish={() => setPublishOpen(true)}
      />

      <Drafts
        open={draftsOpen}
        onClose={() => setDraftsOpen(false)}
        drafts={drafts}
        saving={draftsSaving}
        onSave={saveDraft}
        onLoad={loadDraft}
        onDelete={deleteDraft}
      />
      <PublishSheet
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        publish={publish}
        onChange={patchPublish}
        onReset={resetPublish}
      />
      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSaved={(next, { announce = true } = {}) => {
          setSettings(next);
          if (announce) notify('toast.settingsSaved', 'success');
        }}
        theme={theme}
        onThemeChange={setTheme}
        lang={lang}
        onLangChange={onLangChange}
      />
    </>
  );
}

export default function App() {
  const [lang, setLang] = useState(() => localStorage.getItem(LANG_KEY) || DEFAULT_LANG);

  return (
    <I18nProvider lang={lang}>
      <ToastProvider>
        <DialogProvider>
          <Shell lang={lang} onLangChange={setLang} />
        </DialogProvider>
      </ToastProvider>
    </I18nProvider>
  );
}
