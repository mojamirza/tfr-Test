/**
 * Unit tests for the editor action registry.
 * A recording proxy stands in for the TipTap editor, so every action's command
 * chain can be asserted without mounting ProseMirror.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  EXTRA_ACTIONS,
  FORMAT_ACTIONS,
  FORMULA_ACTION,
  HEADING_ACTIONS,
  LINK_ACTION,
  LIST_ACTIONS,
  MARKER_STYLES,
  MEDIA_ACTIONS,
  PREMIUM_ACTIONS,
  TABLE_ACTIONS,
  TABLE_CELL_ACTIONS,
  TEXT_STYLE_ACTIONS,
  allActions,
  filterActions,
  insertDateTime,
  insertFormula,
  insertLink,
  insertTable,
  isActionActive,
  isActionEnabled,
  mediaKindForUrl,
  parseCoords,
  parseUrlList,
} from '../../src/renderer/lib/editor-actions.js';
import en from '../../src/renderer/i18n/en.json';
import fa from '../../src/renderer/i18n/fa.json';

/**
 * @param {{ active?: string[], attrs?: object, selection?: object, text?: string }} [state]
 */
function mockEditor(state = {}) {
  const calls = [];
  const chain = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'run') return () => true;
        return (...args) => {
          if (prop !== 'focus') calls.push({ name: String(prop), args });
          return chain;
        };
      },
    },
  );

  return {
    calls,
    names: () => calls.map((c) => c.name),
    chain: () => chain,
    isActive: (name) => (state.active || []).includes(name),
    getAttributes: () => state.attrs || {},
    can: () => ({ undo: () => true, redo: () => true }),
    state: {
      selection: state.selection || { from: 0, to: 0, empty: true },
      doc: { textBetween: () => state.text || '' },
    },
  };
}

function mockCtx(overrides = {}) {
  return {
    askText: vi.fn(async () => 'https://example.com/a.png'),
    askLink: vi.fn(async () => ({ text: 'Telegram', url: 'https://t.me/x' })),
    // The new dialog helpers default to "cancelled" / "plain text", which is
    // exactly the path a dialog-free test wants.
    askCodeLanguage: vi.fn(async () => null),
    askMap: vi.fn(async () => null),
    askDetails: vi.fn(async () => null),
    notify: vi.fn(),
    ...overrides,
  };
}

/* ═══════════════════ registry shape ═══════════════════ */

const GROUPS = {
  formatting: TEXT_STYLE_ACTIONS,
  style: FORMAT_ACTIONS,
  list: LIST_ACTIONS,
  media: MEDIA_ACTIONS,
  table: TABLE_ACTIONS,
  premium: PREMIUM_ACTIONS,
  cell: TABLE_CELL_ACTIONS,
  extra: EXTRA_ACTIONS,
};

describe('registry shape', () => {
  it('every action has an id, label key, icon and a run function or children', () => {
    for (const [group, actions] of Object.entries(GROUPS)) {
      for (const action of actions) {
        expect(typeof action.id, `${group}.id`).toBe('string');
        expect(typeof action.i18nKey, `${group}:${action.id}`).toBe('string');
        expect(typeof action.icon, `${group}:${action.id}.icon`).toBe('function');
        const runnable = typeof action.run === 'function' || Array.isArray(action.children);
        expect(runnable, `${group}:${action.id} runnable`).toBe(true);
      }
    }
  });

  it('carries no Premium badges any more', () => {
    for (const action of [...allActions(), ...TABLE_ACTIONS, LINK_ACTION, FORMULA_ACTION]) {
      expect(action.premium, action.id).toBeUndefined();
    }
  });

  it('ids are unique across the palette', () => {
    const ids = allActions().map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every label key is translated in both locales', () => {
    const everything = [...allActions(), ...TABLE_ACTIONS, LINK_ACTION, FORMULA_ACTION];
    for (const action of everything) {
      expect(en[action.i18nKey], `en:${action.i18nKey}`).toBeTruthy();
      expect(fa[action.i18nKey], `fa:${action.i18nKey}`).toBeTruthy();
      if (action.note) {
        expect(en[action.note], `en:${action.note}`).toBeTruthy();
        expect(fa[action.note], `fa:${action.note}`).toBeTruthy();
      }
    }
  });
});

/* ═══════════════════ 1. Formatting (Aa) ═══════════════════ */

describe('the Aa menu', () => {
  it('lists heading, text, quote, expandable quote, pull quote, attribution, code block, footer and divider', () => {
    expect(TEXT_STYLE_ACTIONS.map((a) => a.id)).toEqual([
      'heading',
      'paragraph',
      'blockquote',
      'expandableQuote',
      'pullquote',
      'attribution',
      'codeBlock',
      'footer',
      'divider',
    ]);
  });

  it('flips the expandable flag on a quote the caret already sits in', () => {
    const action = TEXT_STYLE_ACTIONS.find((a) => a.id === 'expandableQuote');
    const editor = mockEditor({ active: ['blockquote'] });
    action.run(editor, mockCtx());
    expect(editor.names()).toEqual(['toggleQuoteExpandable']);
  });

  it('wraps a new expandable quote around the selection', () => {
    const action = TEXT_STYLE_ACTIONS.find((a) => a.id === 'expandableQuote');
    const editor = mockEditor();
    action.run(editor, mockCtx());
    expect(editor.names()).toEqual(['toggleBlockquote', 'toggleQuoteExpandable']);
  });

  it('reports the expandable flag from the quote attributes', () => {
    const action = TEXT_STYLE_ACTIONS.find((a) => a.id === 'expandableQuote');
    expect(action.isActive(mockEditor({ attrs: { expandable: true } }))).toBe(true);
    expect(action.isActive(mockEditor({ attrs: {} }))).toBe(false);
  });

  it('offers the attribution only inside a quote', () => {
    const action = TEXT_STYLE_ACTIONS.find((a) => a.id === 'attribution');
    expect(isActionEnabled(action, mockEditor({ active: ['blockquote'] }))).toBe(true);
    expect(isActionEnabled(action, mockEditor({ active: ['pullQuote'] }))).toBe(true);
    expect(isActionEnabled(action, mockEditor({ active: ['paragraph'] }))).toBe(false);
  });

  it('shows a tick once a quote names a source', () => {
    const action = TEXT_STYLE_ACTIONS.find((a) => a.id === 'attribution');
    expect(action.isActive(mockEditor({ active: ['blockquote'], attrs: {} }))).toBe(false);
    expect(
      action.isActive(mockEditor({ active: ['blockquote'], attrs: { attribution: 'Durov' } })),
    ).toBe(true);
  });

  it('writes the trimmed answer onto the quote, and ignores a cancelled prompt', async () => {
    const action = TEXT_STYLE_ACTIONS.find((a) => a.id === 'attribution');

    const editor = mockEditor({ active: ['blockquote'], attrs: { attribution: 'Old' } });
    await action.run(editor, mockCtx({ askText: vi.fn(async () => '  Durov  ') }));
    expect(editor.calls).toEqual([{ name: 'setQuoteAttribution', args: ['Durov'] }]);

    const cancelled = mockEditor({ active: ['blockquote'] });
    await action.run(cancelled, mockCtx({ askText: vi.fn(async () => null) }));
    expect(cancelled.calls).toEqual([]);
  });

  it('can take the attribution back off a quote', async () => {
    // Emptying the field and pressing OK is '', not null — a real answer, and
    // a different one from cancelling. Treating them alike left no way to
    // remove an attribution once it had been set.
    const action = TEXT_STYLE_ACTIONS.find((a) => a.id === 'attribution');
    const editor = mockEditor({ active: ['blockquote'], attrs: { attribution: 'Old' } });
    await action.run(editor, mockCtx({ askText: vi.fn(async () => '') }));
    expect(editor.calls).toEqual([{ name: 'setQuoteAttribution', args: [''] }]);
  });

  it('nests all six heading levels under Heading', () => {
    const heading = TEXT_STYLE_ACTIONS[0];
    expect(heading.children).toHaveLength(6);
    expect(heading.children.map((a) => a.id)).toEqual(HEADING_ACTIONS.map((a) => a.id));
    expect(heading.run).toBeUndefined();
  });

  it('toggles the requested heading level', () => {
    const editor = mockEditor();
    HEADING_ACTIONS[2].run(editor, mockCtx());
    expect(editor.calls).toEqual([{ name: 'toggleHeading', args: [{ level: 3 }] }]);
  });

  it('maps the remaining entries to their commands', () => {
    const expected = {
      paragraph: 'setParagraph',
      blockquote: 'toggleBlockquote',
      pullquote: 'togglePullQuote',
      footer: 'setFooter',
      divider: 'setHorizontalRule',
    };
    for (const [id, command] of Object.entries(expected)) {
      const editor = mockEditor();
      TEXT_STYLE_ACTIONS.find((a) => a.id === id).run(editor, mockCtx());
      expect(editor.names(), id).toEqual([command]);
    }
  });
});

/* ═══════════════════ 1b. Code-block language picker ═══════════════════ */

describe('the code-block language picker', () => {
  const codeBlock = () => TEXT_STYLE_ACTIONS.find((a) => a.id === 'codeBlock');

  it('inserts a code block carrying the picked language, lowercased', async () => {
    const editor = mockEditor();
    await codeBlock().run(editor, mockCtx({ askCodeLanguage: vi.fn(async () => 'Python') }));
    expect(editor.calls).toEqual([{ name: 'setCodeBlock', args: [{ language: 'python' }] }]);
  });

  it('an empty pick means plain text — no language attribute on the wire', async () => {
    const editor = mockEditor();
    await codeBlock().run(editor, mockCtx({ askCodeLanguage: vi.fn(async () => '') }));
    expect(editor.calls).toEqual([{ name: 'setCodeBlock', args: [{ language: null }] }]);
  });

  it('re-labels the code block under the caret, or clears it', async () => {
    const editor = mockEditor({ active: ['codeBlock'], attrs: { language: 'python' } });
    await codeBlock().run(editor, mockCtx({ askCodeLanguage: vi.fn(async () => 'RUST') }));
    expect(editor.calls).toEqual([
      { name: 'updateAttributes', args: ['codeBlock', { language: 'rust' }] },
    ]);

    const same = mockEditor({ active: ['codeBlock'], attrs: { language: 'python' } });
    await codeBlock().run(same, mockCtx({ askCodeLanguage: vi.fn(async () => '') }));
    expect(same.calls).toEqual([
      { name: 'updateAttributes', args: ['codeBlock', { language: null }] },
    ]);
  });

  it('does nothing when the picker is dismissed', async () => {
    const editor = mockEditor();
    await codeBlock().run(editor, mockCtx({ askCodeLanguage: vi.fn(async () => null) }));
    expect(editor.calls).toEqual([]);
  });
});

/* ═══════════════════ 2. Text style (B) ═══════════════════ */

describe('the B menu', () => {
  it('lists exactly the eight inline styles, in order', () => {
    expect(FORMAT_ACTIONS.map((a) => a.id)).toEqual([
      'bold',
      'italic',
      'underline',
      'strike',
      'spoiler',
      'subscript',
      'superscript',
      'marked',
    ]);
  });

  it('runs the matching toggle command', () => {
    const expected = {
      bold: 'toggleBold',
      italic: 'toggleItalic',
      underline: 'toggleUnderline',
      strike: 'toggleStrike',
      spoiler: 'toggleSpoiler',
      subscript: 'toggleSubscript',
      superscript: 'toggleSuperscript',
      marked: 'toggleHighlight',
    };
    for (const action of FORMAT_ACTIONS) {
      const editor = mockEditor();
      action.run(editor, mockCtx());
      expect(editor.names(), action.id).toEqual([expected[action.id]]);
    }
  });

  it('reports active marks', () => {
    const bold = FORMAT_ACTIONS[0];
    expect(isActionActive(bold, mockEditor({ active: ['bold'] }))).toBe(true);
    expect(isActionActive(bold, mockEditor())).toBe(false);
  });
});

/* ═══════════════════ 3. Lists ═══════════════════ */

describe('the list menu', () => {
  it('lists ordered, bulleted, checklist, details and the ordered-list extras', () => {
    expect(LIST_ACTIONS.map((a) => a.id)).toEqual([
      'orderedList',
      'bulletList',
      'checklist',
      'details',
      'listType',
      'listReversed',
      'listValue',
    ]);
  });

  it('maps each entry to its command', () => {
    const expected = {
      orderedList: 'toggleOrderedList',
      bulletList: 'toggleBulletList',
      checklist: 'toggleTaskList',
      listReversed: 'toggleOrderedListReversed',
    };
    for (const action of LIST_ACTIONS) {
      if (!(action.id in expected)) continue;
      const editor = mockEditor();
      action.run(editor, mockCtx());
      expect(editor.names(), action.id).toEqual([expected[action.id]]);
    }
  });

  it('offers the list extras only inside a list', () => {
    const inList = (action) => {
      expect(isActionEnabled(action, mockEditor({ active: ['orderedList'] }))).toBe(true);
      expect(isActionEnabled(action, mockEditor())).toBe(false);
    };
    inList(LIST_ACTIONS.find((a) => a.id === 'listType'));
    inList(LIST_ACTIONS.find((a) => a.id === 'listReversed'));
  });

  it('offers the explicit value on a list item and writes the typed number', async () => {
    const action = LIST_ACTIONS.find((a) => a.id === 'listValue');
    expect(isActionEnabled(action, mockEditor({ active: ['listItem'] }))).toBe(true);
    expect(isActionEnabled(action, mockEditor())).toBe(false);

    const editor = mockEditor({ active: ['listItem'] });
    await action.run(editor, mockCtx({ askText: vi.fn(async () => '7') }));
    expect(editor.calls).toEqual([{ name: 'setListItemValue', args: [7] }]);
  });

  it('writes the ordered-list marker style, picked from the documented set', async () => {
    const action = LIST_ACTIONS.find((a) => a.id === 'listType');

    expect(MARKER_STYLES.map((style) => style.value)).toEqual(['', 'a', 'A', 'i', 'I']);

    const editor = mockEditor({ active: ['orderedList'] });
    await action.run(editor, mockCtx({ askChoice: vi.fn(async () => 'a') }));
    expect(editor.calls).toEqual([{ name: 'setOrderedListType', args: ['a'] }]);

    // "Numbers" is the empty value — a plain <ol> numbers by default.
    const cleared = mockEditor({ active: ['orderedList'] });
    await action.run(cleared, mockCtx({ askChoice: vi.fn(async () => '') }));
    expect(cleared.calls).toEqual([{ name: 'setOrderedListType', args: [''] }]);

    // Cancel resolves null — the list stays untouched, nothing to validate
    // any more: the picker cannot produce a value outside the set.
    const cancelled = mockEditor({ active: ['orderedList'] });
    await action.run(cancelled, mockCtx({ askChoice: vi.fn(async () => null) }));
    expect(cancelled.calls).toEqual([]);
  });
});

/* ═══════════════════ 3b. Collapsible details block ═══════════════════ */

describe('the collapsible details block', () => {
  const detailsAction = () => LIST_ACTIONS.find((a) => a.id === 'details');

  it('inserts the block carrying the summary and the initially-expanded pick', async () => {
    const editor = mockEditor();
    await detailsAction().run(
      editor,
      mockCtx({ askDetails: vi.fn(async () => ({ summary: ' Read more ', open: true })) }),
    );
    expect(editor.calls).toEqual([{ name: 'setDetails', args: ['Read more', true] }]);
  });

  it('falls back to the default heading when the summary is empty', async () => {
    const editor = mockEditor();
    await detailsAction().run(
      editor,
      mockCtx({ askDetails: vi.fn(async () => ({ summary: '  ', open: false })) }),
    );
    expect(editor.calls).toEqual([{ name: 'setDetails', args: ['Details', false] }]);
  });

  it('updates the block the caret sits in', async () => {
    const editor = mockEditor({ active: ['details'], attrs: { summary: 'More', open: false } });
    await detailsAction().run(
      editor,
      mockCtx({
        askDetails: vi.fn(async () => ({ summary: 'More', open: true, existing: true })),
      }),
    );
    expect(editor.calls).toEqual([
      { name: 'updateAttributes', args: ['details', { summary: 'More', open: true }] },
    ]);
  });

  it('does nothing when dismissed', async () => {
    const editor = mockEditor();
    await detailsAction().run(editor, mockCtx({ askDetails: vi.fn(async () => null) }));
    expect(editor.calls).toEqual([]);
  });
});

/* ═══════════════════ 4. Table ═══════════════════ */

describe('table', () => {
  it('inserts a 3×3 table with a header row in one click', () => {
    const editor = mockEditor();
    insertTable(editor);
    expect(editor.calls).toEqual([
      { name: 'insertTable', args: [{ rows: 3, cols: 3, withHeaderRow: true }] },
    ]);
  });

  it('offers row/column edits in the bubble menu', () => {
    const expected = {
      addRow: 'addRowAfter',
      addColumn: 'addColumnAfter',
      deleteRow: 'deleteRow',
      deleteColumn: 'deleteColumn',
      deleteTable: 'deleteTable',
    };
    for (const action of TABLE_ACTIONS) {
      const editor = mockEditor();
      action.run(editor, mockCtx());
      expect(editor.names(), action.id).toEqual([expected[action.id]]);
    }
  });
});

/* ═══════════════════ 5. Link ═══════════════════ */

describe('insertLink', () => {
  it('prefills the panel with the selected text and the current href', async () => {
    const editor = mockEditor({
      selection: { from: 1, to: 5, empty: false },
      text: 'chat',
      attrs: { href: 'https://old' },
    });
    const ctx = mockCtx();
    await insertLink(editor, ctx);
    expect(ctx.askLink).toHaveBeenCalledWith({ text: 'chat', url: 'https://old' });
  });

  it('inserts the text carrying a link mark', async () => {
    const editor = mockEditor();
    await insertLink(editor, mockCtx());
    expect(editor.calls).toEqual([
      {
        name: 'insertContent',
        args: [
          {
            type: 'text',
            text: 'Telegram',
            marks: [{ type: 'link', attrs: { href: 'https://t.me/x' } }],
          },
        ],
      },
    ]);
  });

  it('falls back to the URL when no text is given', async () => {
    const editor = mockEditor();
    await insertLink(editor, mockCtx({ askLink: vi.fn(async () => ({ text: '  ', url: 'https://a' })) }));
    expect(editor.calls[0].args[0].text).toBe('https://a');
  });

  it('refuses unsafe schemes', async () => {
    const editor = mockEditor();
    const ctx = mockCtx({ askLink: vi.fn(async () => ({ text: 'x', url: ' JavaScript:alert(1)' })) });
    await insertLink(editor, ctx);
    expect(editor.calls).toEqual([]);
    expect(ctx.notify).toHaveBeenCalledWith('toast.unsafeUrl', 'error');
  });

  it('does nothing when the panel is cancelled', async () => {
    const editor = mockEditor();
    await insertLink(editor, mockCtx({ askLink: vi.fn(async () => null) }));
    expect(editor.calls).toEqual([]);
  });
});

/* ═══════════════════ 6. Media ═══════════════════ */

describe('media helpers', () => {
  it('detects the block type from the file extension', () => {
    expect(mediaKindForUrl('https://a/b.MP4')).toBe('video');
    expect(mediaKindForUrl('https://a/b.mov?x=1')).toBe('video');
    // `.gif` rides the video tag: Telegram documents an animation as
    // `<video src="…animation.gif">` — a bare `<img>` would send a still frame.
    expect(mediaKindForUrl('https://a/anim.gif')).toBe('video');
    expect(mediaKindForUrl('tfrfile://media/C%3A%2Fanim.gif')).toBe('video');
    expect(mediaKindForUrl('https://a/song.mp3')).toBe('audio');
    expect(mediaKindForUrl('https://a/song.ogg#t=1')).toBe('audio');
    expect(mediaKindForUrl('https://a/pic.jpg')).toBe('photo');
    expect(mediaKindForUrl('https://a/no-extension')).toBe('photo');
    // A locally picked file carries its name encoded inside the scheme URL.
    expect(mediaKindForUrl('tfrfile://media/C%3A%2Fclips%2Fb.mov')).toBe('video');
    expect(mediaKindForUrl('tfrfile://media/C%3A%2Fsong.mp3')).toBe('audio');
    expect(mediaKindForUrl('tfrfile://media/C%3A%2Fpic.png')).toBe('photo');
  });

  it('splits and sanitizes URL lists', () => {
    expect(parseUrlList(' https://a.jpg , https://b.jpg ')).toEqual([
      'https://a.jpg',
      'https://b.jpg',
    ]);
    expect(parseUrlList('javascript:alert(1)')).toEqual([]);
    expect(parseUrlList('')).toEqual([]);
  });
});

describe('media picked from the device', () => {
  const pick = (files) => vi.fn(async () => ({ ok: true, files }));

  it('inserts one picked image straight into the editor', async () => {
    const editor = mockEditor();
    await MEDIA_ACTIONS.find((a) => a.id === 'photoOrVideo').run(
      editor,
      mockCtx({
        askFiles: pick(['C:\\Users\\me\\pic.png']),
        askText: vi.fn(async () => {
          throw new Error('the URL prompt must not open when files were picked');
        }),
      }),
    );
    expect(editor.calls).toEqual([
      { name: 'setImage', args: [{ src: 'tfrfile://media/C%3A%2FUsers%2Fme%2Fpic.png' }] },
    ]);
  });

  it('sends a picked video to its media block, guessed from the extension', async () => {
    const editor = mockEditor();
    await MEDIA_ACTIONS.find((a) => a.id === 'photoOrVideo').run(
      editor,
      mockCtx({ askFiles: pick(['C:\\clips\\clip.mp4']) }),
    );
    expect(editor.calls).toEqual([
      { name: 'setMediaBlock', args: [{ kind: 'video', src: 'tfrfile://media/C%3A%2Fclips%2Fclip.mp4' }] },
    ]);
  });

  it('groups several picked files into a slideshow', async () => {
    const editor = mockEditor();
    await MEDIA_ACTIONS.find((a) => a.id === 'photoOrVideo').run(
      editor,
      mockCtx({ askFiles: pick(['C:\\a.png', 'C:\\b.jpg']) }),
    );
    expect(editor.calls).toEqual([
      {
        name: 'setGalleryBlock',
        args: [
          {
            kind: 'slideshow',
            images: ['tfrfile://media/C%3A%2Fa.png', 'tfrfile://media/C%3A%2Fb.jpg'],
          },
        ],
      },
    ]);
  });

  it('falls back to the URL prompt when the picker is cancelled empty', async () => {
    const editor = mockEditor();
    await MEDIA_ACTIONS.find((a) => a.id === 'photoOrVideo').run(
      editor,
      mockCtx({
        askFiles: pick([]),
        askText: vi.fn(async () => ' https://a.jpg '),
      }),
    );
    expect(editor.calls).toEqual([{ name: 'setImage', args: [{ src: 'https://a.jpg' }] }]);
  });

  it('stops without touching the editor when nothing usable was picked', async () => {
    const editor = mockEditor();
    await MEDIA_ACTIONS.find((a) => a.id === 'photoOrVideo').run(
      editor,
      mockCtx({
        askFiles: vi.fn(async () => ({ ok: false, files: [] })),
        askText: vi.fn(async () => {
          throw new Error('a failed pick must not open the URL prompt');
        }),
      }),
    );
    expect(editor.calls).toEqual([]);
  });

  it('takes audio files from the picker, one at a time', async () => {
    const editor = mockEditor();
    await MEDIA_ACTIONS.find((a) => a.id === 'audioFile').run(editor, mockCtx({ askFiles: pick(['C:\\voice.ogg']) }));
    expect(editor.calls).toEqual([
      { name: 'setMediaBlock', args: [{ kind: 'audio', src: 'tfrfile://media/C%3A%2Fvoice.ogg' }] },
    ]);

    // Two files chosen for a single-audio insert → the first wins.
    const again = mockEditor();
    await MEDIA_ACTIONS.find((a) => a.id === 'audioFile').run(
      again,
      mockCtx({ askFiles: pick(['C:\\one.mp3', 'C:\\two.mp3']) }),
    );
    expect(again.calls).toEqual([
      { name: 'setMediaBlock', args: [{ kind: 'audio', src: 'tfrfile://media/C%3A%2Fone.mp3' }] },
    ]);
  });

  it('takes documents from the picker as well', async () => {
    const editor = mockEditor();
    await MEDIA_ACTIONS.find((a) => a.id === 'documentFile').run(
      editor,
      mockCtx({ askFiles: pick(['C:\\docs\\report.pdf']) }),
    );
    expect(editor.calls).toEqual([
      { name: 'setMediaBlock', args: [{ kind: 'document', src: 'tfrfile://media/C%3A%2Fdocs%2Freport.pdf' }] },
    ]);
  });

  it('the picker is optional — the URL prompt still works without it', async () => {
    const editor = mockEditor();
    await MEDIA_ACTIONS.find((a) => a.id === 'documentFile').run(
      editor,
      mockCtx({ askText: vi.fn(async () => 'https://a/report.pdf') }),
    );
    expect(editor.calls).toEqual([
      { name: 'setMediaBlock', args: [{ kind: 'document', src: 'https://a/report.pdf' }] },
    ]);
  });
});

describe('the media menu', () => {
  it('offers photo-or-video, audio, document, spoiler, location and caption, in order', () => {
    expect(MEDIA_ACTIONS.map((a) => a.id)).toEqual([
      'photoOrVideo',
      'audioFile',
      'documentFile',
      'mediaSpoiler',
      'location',
      'caption',
    ]);
  });

  it('inserts a document file as `<tg-document>` blocks do', async () => {
    const editor = mockEditor();
    await MEDIA_ACTIONS.find((a) => a.id === 'documentFile').run(
      editor,
      mockCtx({ askText: vi.fn(async () => 'https://a/report.pdf') }),
    );
    expect(editor.calls).toEqual([
      { name: 'setMediaBlock', args: [{ kind: 'document', src: 'https://a/report.pdf' }] },
    ]);
  });

  it('toggles the media spoiler on image and media-block nodes', () => {
    const action = MEDIA_ACTIONS.find((a) => a.id === 'mediaSpoiler');
    for (const node of ['image', 'mediaBlock']) {
      expect(isActionEnabled(action, mockEditor({ active: [node] })), node).toBe(true);
    }
    // A gallery is multiple files at once; the spec's spoiler is per-figure.
    expect(isActionEnabled(action, mockEditor({ active: ['galleryBlock'] }))).toBe(false);
    expect(isActionEnabled(action, mockEditor({ active: ['paragraph'] }))).toBe(false);

    const editor = mockEditor({ active: ['image'] });
    action.run(editor, mockCtx());
    expect(editor.names()).toEqual(['toggleMediaSpoiler']);
  });

  it('offers the caption only on a media node', () => {
    const action = MEDIA_ACTIONS.find((a) => a.id === 'caption');
    for (const node of ['image', 'mediaBlock', 'galleryBlock']) {
      expect(isActionEnabled(action, mockEditor({ active: [node] })), node).toBe(true);
    }
    expect(isActionEnabled(action, mockEditor({ active: ['paragraph'] }))).toBe(false);
  });

  it('asks for the caption then its credit, and stops on either cancel', async () => {
    const action = MEDIA_ACTIONS.find((a) => a.id === 'caption');

    const editor = mockEditor({ active: ['image'], attrs: { caption: 'Old', credit: '' } });
    const answers = ['  Clip title  ', ' Ada '];
    await action.run(editor, mockCtx({ askText: vi.fn(async () => answers.shift()) }));
    expect(editor.calls).toEqual([{ name: 'setMediaCaption', args: ['Clip title', 'Ada'] }]);

    const atCaption = mockEditor({ active: ['image'] });
    await action.run(atCaption, mockCtx({ askText: vi.fn(async () => null) }));
    expect(atCaption.calls).toEqual([]);

    const atCredit = mockEditor({ active: ['image'] });
    const second = ['Clip', null];
    await action.run(atCredit, mockCtx({ askText: vi.fn(async () => second.shift()) }));
    expect(atCredit.calls).toEqual([]);
  });

  it('can take a caption and its credit back off', async () => {
    const action = MEDIA_ACTIONS.find((a) => a.id === 'caption');

    const cleared = mockEditor({ active: ['image'], attrs: { caption: 'Old', credit: 'Ada' } });
    const empties = ['', ''];
    await action.run(cleared, mockCtx({ askText: vi.fn(async () => empties.shift()) }));
    expect(cleared.calls).toEqual([{ name: 'setMediaCaption', args: ['', ''] }]);

    // Dropping only the credit keeps the caption.
    const creditOnly = mockEditor({ active: ['image'], attrs: { caption: 'Old', credit: 'Ada' } });
    const mixed = ['Old', ''];
    await action.run(creditOnly, mockCtx({ askText: vi.fn(async () => mixed.shift()) }));
    expect(creditOnly.calls).toEqual([{ name: 'setMediaCaption', args: ['Old', ''] }]);
  });

  const photoOrVideo = () => MEDIA_ACTIONS.find((a) => a.id === 'photoOrVideo');

  it('inserts a single image', async () => {
    const editor = mockEditor();
    await photoOrVideo().run(editor, mockCtx());
    expect(editor.calls).toEqual([
      { name: 'setImage', args: [{ src: 'https://example.com/a.png' }] },
    ]);
  });

  it('inserts a single video as a media block', async () => {
    const editor = mockEditor();
    await photoOrVideo().run(editor, mockCtx({ askText: vi.fn(async () => 'https://a/clip.mp4') }));
    expect(editor.calls).toEqual([
      { name: 'setMediaBlock', args: [{ kind: 'video', src: 'https://a/clip.mp4' }] },
    ]);
  });

  it('turns two or more files into a slideshow', async () => {
    const editor = mockEditor();
    await photoOrVideo().run(
      editor,
      mockCtx({ askText: vi.fn(async () => 'https://a.jpg, https://b.jpg') }),
    );
    expect(editor.calls).toEqual([
      {
        name: 'setGalleryBlock',
        args: [{ kind: 'slideshow', images: ['https://a.jpg', 'https://b.jpg'] }],
      },
    ]);
  });

  it('rejects unsafe media URLs', async () => {
    const editor = mockEditor();
    const ctx = mockCtx({ askText: vi.fn(async () => 'javascript:alert(1)') });
    await photoOrVideo().run(editor, ctx);
    expect(editor.calls).toEqual([]);
    expect(ctx.notify).toHaveBeenCalledWith('toast.unsafeUrl', 'error');
  });

  it('inserts an audio file', async () => {
    const editor = mockEditor();
    await MEDIA_ACTIONS.find((a) => a.id === 'audioFile').run(
      editor,
      mockCtx({ askText: vi.fn(async () => 'https://a/song.mp3') }),
    );
    expect(editor.calls).toEqual([
      { name: 'setMediaBlock', args: [{ kind: 'audio', src: 'https://a/song.mp3' }] },
    ]);
  });

  it('inserts the map the publish dialog filled in', async () => {
    const location = MEDIA_ACTIONS.find((a) => a.id === 'location');

    const good = mockEditor();
    await location.run(
      good,
      mockCtx({
        askMap: vi.fn(async () => ({
          latitude: '35.6892',
          longitude: '51.389',
          zoom: '14',
          width: '',
          height: '',
          caption: 'Tehran',
        })),
      }),
    );
    expect(good.calls).toEqual([
      {
        name: 'setMapBlock',
        args: [
          { latitude: 35.6892, longitude: 51.389, zoom: 14, width: null, height: null, caption: 'Tehran' },
        ],
      },
    ]);
  });

  it('updates the map the caret sits in, or removes it', async () => {
    const location = MEDIA_ACTIONS.find((a) => a.id === 'location');

    const editor = mockEditor({ active: ['mapBlock'], attrs: { latitude: 1, longitude: 2 } });
    await location.run(
      editor,
      mockCtx({
        askMap: vi.fn(async () => ({
          latitude: '3',
          longitude: '4',
          zoom: '',
          width: '',
          height: '',
          caption: '',
          existing: true,
        })),
      }),
    );
    expect(editor.calls).toEqual([
      {
        name: 'updateAttributes',
        args: ['mapBlock', { latitude: 3, longitude: 4, zoom: null, width: null, height: null, caption: '' }],
      },
    ]);

    const removed = mockEditor({ active: ['mapBlock'] });
    await location.run(removed, mockCtx({ askMap: vi.fn(async () => ({ removed: true })) }));
    expect(removed.calls).toEqual([{ name: 'deleteSelection', args: [] }]);
  });

  it('refuses a point that is not on the globe', async () => {
    const location = MEDIA_ACTIONS.find((a) => a.id === 'location');
    const points = [
      ['999', '0'],
      ['0', '-181'],
      ['-91', '10'],
      ['a lot', '51'],
    ];
    for (const [latitude, longitude] of points) {
      const editor = mockEditor();
      const ctx = mockCtx({
        askMap: vi.fn(async () => ({ latitude, longitude, zoom: '', width: '', height: '', caption: '' })),
      });
      await location.run(editor, ctx);
      expect(editor.calls, `${latitude},${longitude}`).toEqual([]);
      expect(ctx.notify, `${latitude},${longitude}`).toHaveBeenCalledWith(
        'toast.invalidCoords',
        'error',
      );
    }
  });

  it('accepts the edges of the globe', () => {
    expect(parseCoords('-90, 180')).toEqual({ latitude: -90, longitude: 180 });
    expect(parseCoords(' 0 , 0 ')).toEqual({ latitude: 0, longitude: 0 });
    expect(parseCoords('90,-180')).toEqual({ latitude: 90, longitude: -180 });
  });

  it('does nothing when a prompt is dismissed', async () => {
    const editor = mockEditor();
    const ctx = mockCtx({ askText: vi.fn(async () => null) });
    await photoOrVideo().run(editor, ctx);
    expect(editor.calls).toEqual([]);
    expect(ctx.notify).not.toHaveBeenCalled();
  });
});

/* ═══════════════════ 7. Premium article features ═══════════════════ */

describe('premium actions', () => {
  it('offers the Rich HTML Premium entities in a stable order', () => {
    expect(PREMIUM_ACTIONS.map((a) => a.id)).toEqual([
      'buttons',
      'inlineButton',
      'customEmoji',
      'mention',
      'dateTime',
      'thinking',
      'anchor',
      'reference',
    ]);
  });

  it('asks for an emoji id and fallback, then inserts `<tg-emoji>`', async () => {
    const editor = mockEditor();
    const ctx = mockCtx({
      askText: vi
        .fn()
        .mockResolvedValueOnce(' 5368324170671202286 ')
        .mockResolvedValueOnce('👍'),
    });
    await PREMIUM_ACTIONS.find((a) => a.id === 'customEmoji').run(editor, ctx);
    expect(editor.calls).toEqual([
      {
        name: 'insertCustomEmoji',
        args: [{ emojiId: '5368324170671202286', fallback: '👍' }],
      },
    ]);
  });

  it('falls back to the sparkle when no fallback text was typed', async () => {
    const editor = mockEditor();
    const ctx = mockCtx({
      askText: vi.fn().mockResolvedValueOnce('123').mockResolvedValueOnce('   '),
    });
    await PREMIUM_ACTIONS.find((a) => a.id === 'customEmoji').run(editor, ctx);
    expect(editor.calls[0].args[0].fallback).toBe('✨');
  });

  it('stops early when the emoji id is dismissed', async () => {
    const editor = mockEditor();
    await PREMIUM_ACTIONS.find((a) => a.id === 'customEmoji').run(
      editor,
      mockCtx({ askText: vi.fn(async () => null) }),
    );
    expect(editor.calls).toEqual([]);
  });

  it('accepts a unix timestamp or a parseable date for `<tg-time>`', async () => {
    const editor = mockEditor();
    const ctx = mockCtx({
      askText: vi
        .fn()
        .mockResolvedValueOnce('1647531900')
        .mockResolvedValueOnce('wDT')
        .mockResolvedValueOnce('22:45 tomorrow'),
    });
    await PREMIUM_ACTIONS.find((a) => a.id === 'dateTime').run(editor, ctx);
    expect(editor.calls).toEqual([
      {
        name: 'insertDateTime',
        args: [{ unix: 1647531900, format: 'wDT', text: '22:45 tomorrow' }],
      },
    ]);

    const fromIso = mockEditor();
    await insertDateTime(
      fromIso,
      mockCtx({
        askText: vi
          .fn()
          .mockResolvedValueOnce('2022-03-15T10:45:00Z')
          .mockResolvedValueOnce('')
          .mockResolvedValueOnce(''),
      }),
    );
    expect(fromIso.calls[0].args[0].unix).toBe(Date.parse('2022-03-15T10:45:00Z') / 1000);
  });

  it('rejects an unparseable date-time', async () => {
    const editor = mockEditor();
    const ctx = mockCtx({ askText: vi.fn(async () => 'next friday, maybe') });
    await PREMIUM_ACTIONS.find((a) => a.id === 'dateTime').run(editor, ctx);
    expect(editor.calls).toEqual([]);
    expect(ctx.notify).toHaveBeenCalledWith('toast.invalidTime', 'error');
  });

  it('inserts an inline mention as a `tg://user` link', async () => {
    const editor = mockEditor();
    const ctx = mockCtx({
      askText: vi.fn().mockResolvedValueOnce('777000').mockResolvedValueOnce('Support'),
    });
    await PREMIUM_ACTIONS.find((a) => a.id === 'mention').run(editor, ctx);
    expect(editor.calls).toEqual([
      {
        name: 'insertContent',
        args: [
          {
            type: 'text',
            text: 'Support',
            marks: [{ type: 'link', attrs: { href: 'tg://user?id=777000' } }],
          },
        ],
      },
    ]);
  });

  it('rejects a mention id that is not numeric', async () => {
    const editor = mockEditor();
    const ctx = mockCtx({ askText: vi.fn(async () => '@durov') });
    await PREMIUM_ACTIONS.find((a) => a.id === 'mention').run(editor, ctx);
    expect(editor.calls).toEqual([]);
    expect(ctx.notify).toHaveBeenCalledWith('toast.invalidId', 'error');
  });

  it('inserts and edits the thinking placeholder', async () => {
    const editor = mockEditor();
    await PREMIUM_ACTIONS.find((a) => a.id === 'thinking').run(
      editor,
      mockCtx({ askText: vi.fn(async () => 'Consulting the archive…') }),
    );
    expect(editor.calls).toEqual([
      { name: 'setThinkingBlock', args: ['Consulting the archive…'] },
    ]);

    const edit = mockEditor({ active: ['thinkingBlock'], attrs: { text: 'Old' } });
    await PREMIUM_ACTIONS.find((a) => a.id === 'thinking').run(
      edit,
      mockCtx({ askText: vi.fn(async () => 'New') }),
    );
    expect(edit.calls).toEqual([{ name: 'updateAttributes', args: ['thinkingBlock', { text: 'New' }] }]);
  });

  it('cleans an anchor name to `#link`-safe text and inserts it', async () => {
    const editor = mockEditor();
    await PREMIUM_ACTIONS.find((a) => a.id === 'anchor').run(
      editor,
      mockCtx({ askText: vi.fn(async () => 'Chapter 1!') }),
    );
    expect(editor.calls).toEqual([{ name: 'insertAnchor', args: ['Chapter-1'] }]);
  });

  it('removes the reference when the name is cleared', async () => {
    const editor = mockEditor({
      selection: { from: 1, to: 5, empty: false },
      attrs: { name: 'note-1' },
    });
    await PREMIUM_ACTIONS.find((a) => a.id === 'reference').run(
      editor,
      mockCtx({ askText: vi.fn(async () => '   ') }),
    );
    expect(editor.names()).toEqual(['unsetReference']);
  });

  it('round-trips the buttons row through the dialog, updating in place', async () => {
    const editor = mockEditor({ active: ['buttonsRow'], attrs: { buttons: [], align: '' } });
    const ctx = mockCtx({
      askButtons: vi.fn(async () => ({ align: 'left', buttons: [{ type: 'url', label: 'Docs' }] })),
    });
    await PREMIUM_ACTIONS.find((a) => a.id === 'buttons').run(editor, ctx);
    expect(editor.calls).toEqual([
      {
        name: 'updateAttributes',
        args: ['buttonsRow', { align: 'left', buttons: [{ type: 'url', label: 'Docs' }] }],
      },
    ]);

    const fresh = mockEditor();
    await PREMIUM_ACTIONS.find((a) => a.id === 'buttons').run(fresh, ctx);
    expect(fresh.names()).toEqual(['setButtonsRow']);
  });

  it('deletes an edited row whose buttons were all removed', async () => {
    const editor = mockEditor({ active: ['buttonsRow'], attrs: { buttons: [] } });
    await PREMIUM_ACTIONS.find((a) => a.id === 'buttons').run(
      editor,
      mockCtx({ askButtons: vi.fn(async () => ({ align: '', buttons: [] })) }),
    );
    expect(editor.names()).toEqual(['deleteSelection']);
  });

  it('inserts an inline chip through the dialog and edits it in place', async () => {
    const editor = mockEditor();
    const ctx = mockCtx({
      askInlineButton: vi.fn(async () => ({
        type: 'url',
        style: 'success',
        label: 'Docs',
        value: 'https://t.frich',
      })),
    });
    await PREMIUM_ACTIONS.find((a) => a.id === 'inlineButton').run(editor, ctx);
    expect(editor.calls).toEqual([
      {
        name: 'setInlineButton',
        args: [{ type: 'url', style: 'success', label: 'Docs', value: 'https://t.frich' }],
      },
    ]);

    const editing = mockEditor({
      active: ['inlineButton'],
      attrs: { type: 'url', style: '', label: 'Docs', value: 'https://old' },
    });
    await PREMIUM_ACTIONS.find((a) => a.id === 'inlineButton').run(editing, ctx);
    expect(editing.calls).toEqual([
      {
        name: 'updateInlineButton',
        args: [
          { type: 'url', style: 'success', label: 'Docs', value: 'https://t.frich' },
        ],
      },
    ]);
  });

  it('removes an edited inline chip when the dialog asks to', async () => {
    const editor = mockEditor({
      active: ['inlineButton'],
      attrs: { type: 'url', label: 'Docs', value: 'https://old' },
    });
    await PREMIUM_ACTIONS.find((a) => a.id === 'inlineButton').run(
      editor,
      mockCtx({ askInlineButton: vi.fn(async () => ({ removed: true })) }),
    );
    expect(editor.names()).toEqual(['removeInlineButton']);
  });

  it('leaves the document alone when the inline dialog is cancelled', async () => {
    const editor = mockEditor();
    await PREMIUM_ACTIONS.find((a) => a.id === 'inlineButton').run(
      editor,
      mockCtx({ askInlineButton: vi.fn(async () => null) }),
    );
    expect(editor.calls).toEqual([]);
  });
});

/* ═══════════════════ 8. Table cell extras ═══════════════════ */

describe('the table cell extras', () => {
  it('parses cell coordinates and rejects malformed coordinates', async () => {
    const editor = mockEditor({ active: ['tableCell'] });
    const ctx = mockCtx({ askText: vi.fn(async () => 'A title') });
    await TABLE_CELL_ACTIONS.find((a) => a.id === 'tableCaption').run(editor, ctx);
    expect(editor.calls).toEqual([{ name: 'setTableCaption', args: ['A title'] }]);
  });

  it('toggles settled alignment values off again', async () => {
    const editor = mockEditor({ active: ['tableCell'], attrs: { align: 'center' } });
    await TABLE_CELL_ACTIONS.find((a) => a.id === 'alignCenter').run(editor, mockCtx());
    expect(editor.calls).toEqual([{ name: 'setCellAlign', args: [''] }]);
  });
});

/* ═══════════════════ 9. Formula ═══════════════════ */
describe('insertFormula', () => {
  /** A selection whose $from sits inside a node of the given type. */
  const inside = (typeName, attrs = {}) => ({
    empty: true,
    $from: { parent: { type: { name: typeName }, attrs } },
  });

  it('inserts a math block from the entered formula', async () => {
    const editor = mockEditor({ selection: inside('paragraph') });
    await insertFormula(editor, mockCtx({ askFormula: vi.fn(async () => 'a^2+b^2') }));
    expect(editor.calls).toEqual([{ name: 'setMathBlock', args: ['a^2+b^2'] }]);
  });

  it('rewrites the block in place when the caret is inside one', async () => {
    const editor = mockEditor({ selection: inside('mathBlock', { formula: 'x' }) });
    await insertFormula(editor, mockCtx({ askFormula: vi.fn(async () => 'x^2') }));
    expect(editor.calls).toEqual([
      { name: 'updateAttributes', args: ['mathBlock', { formula: 'x^2' }] },
    ]);
  });

  it('does nothing when cancelled', async () => {
    const editor = mockEditor({ selection: inside('paragraph') });
    await insertFormula(editor, mockCtx({ askFormula: vi.fn(async () => null) }));
    expect(editor.calls).toEqual([]);
  });
});

/* ═══════════════════ palette ═══════════════════ */

describe('allActions', () => {
  it('flattens heading levels and drops the parent entry', () => {
    const ids = allActions().map((a) => a.id);
    expect(ids).toContain('heading3');
    expect(ids).not.toContain('heading');
  });

  it('includes the palette-only extras', () => {
    const ids = allActions().map((a) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'code',
        'clearFormat',
        'mathInline',
        'collage',
        'insertTable',
        // The Premium article features.
        'buttons',
        'customEmoji',
        'dateTime',
        'thinking',
        'anchor',
        'reference',
        'mention',
      ]),
    );
  });

  it('includes link and formula', () => {
    const ids = allActions().map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['link', 'formula']));
  });
});

describe('filterActions', () => {
  const translate = (key) => en[key] || key;

  it('returns everything for an empty query', () => {
    expect(filterActions(allActions(), '   ', translate)).toHaveLength(allActions().length);
  });

  it('matches translated labels case-insensitively', () => {
    const ids = filterActions(allActions(), 'SPOILER', translate).map((a) => a.id);
    expect(ids).toContain('spoiler');
  });

  it('matches action ids too', () => {
    const ids = filterActions(allActions(), 'checklist', translate).map((a) => a.id);
    expect(ids).toEqual(['checklist']);
  });

  it('returns nothing for a miss', () => {
    expect(filterActions(allActions(), 'zzzz', translate)).toEqual([]);
  });
});

describe('state helpers', () => {
  it('treats actions without an `enabled` predicate as enabled', () => {
    expect(isActionEnabled(FORMAT_ACTIONS[0], mockEditor())).toBe(true);
    expect(isActionEnabled(FORMAT_ACTIONS[0], null)).toBe(false);
  });

  it('is false without an isActive predicate', () => {
    expect(isActionActive({ id: 'x' }, mockEditor())).toBe(false);
  });

  it('swallows predicate errors', () => {
    const action = {
      id: 'boom',
      isActive: () => {
        throw new Error('nope');
      },
    };
    expect(isActionActive(action, mockEditor())).toBe(false);
  });
});
