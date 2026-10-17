/**
 * Round-trip proof through a real headless TipTap editor.
 *
 * The other action tests drive a mock editor, which pins the *call* the
 * palette makes but not that the schema actually accepts it. This file builds
 * the composer's genuine extension set (the same `buildExtensions` list the
 * hook uses), performs the insert/update commands for the premium blocks, and
 * feeds the result into the wire serializer — the complete path from a UI
 * interaction to a `sendRichMessage` body, minus Electron itself.
 *
 * One behaviour this pins deliberately: after inserting a block, the editor's
 * selection is *not* on it — the user reaches the "edit in place" state by
 * clicking the block, exactly like the real app does. Encoding that here
 * keeps the palette's active-state logic honest.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { buildExtensions } from '../../src/renderer/components/useTfrEditor.js';
import { serializeEditorHtml } from '../../src/shared/html-serializer.js';

/** A translator that hands the key straight back — palettes need one, tests don't. */
const noopT = (key) => key;

/**
 * @type {import('@tiptap/core').Editor[]}
 * Kept app-side so every editor is destroyed exactly once, after all tests.
 */
const editors = [];

/** @param {object} content */
function makeEditor(content = '') {
  const editor = new Editor({
    extensions: buildExtensions({ placeholder: '', t: noopT }),
    content,
  });
  editors.push(editor);
  return editor;
}

/** Select the first node of `typeName` in the document, like a chip click. */
function selectNode(editor, typeName) {
  let found = false;
  editor.state.doc.descendants((node, pos) => {
    if (!found && node.type.name === typeName) {
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)),
      );
      found = true;
    }
  });
  return found;
}

afterAll(() => {
  for (const editor of editors) {
    if (!editor.isDestroyed) editor.destroy();
  }
});

describe('a real editor round-trips the premium blocks', () => {
  it('inserts a `<tg-button-row>` block that serializes on the wire', () => {
    const editor = makeEditor('<p>Hello</p>');
    editor.commands.setButtonsRow({
      align: 'center',
      buttons: [
        { type: 'url', style: 'primary', label: 'Docs', value: 'https://t.frich' },
        { type: 'callback_data', style: 'link', label: 'Tap', value: 'tap-1' },
      ],
    });

    // The editor DOM carries the editor-flavoured markup, retaining the align
    // value it will need on the next HTML round-trip…
    const editorHtml = editor.getHTML();
    expect(editorHtml).toContain('tg-buttons');
    expect(editorHtml).toContain('tg-btn-chip');
    expect(editorHtml).toContain('data-align="center"');

    // …and clicking a chip selects the row, which is what makes the wand's
    // button entry report "in place" editing.
    expect(editor.isActive('buttonsRow')).toBe(false);
    expect(selectNode(editor, 'buttonsRow')).toBe(true);
    expect(editor.isActive('buttonsRow')).toBe(true);

    const { html } = serializeEditorHtml(editor.getHTML());
    expect(html).toContain(
      '<tg-button-row align="center">' +
        '<tg-button type="url" style="primary" url="https://t.frich">Docs</tg-button>' +
        '<tg-button type="callback_data" style="link" data="tap-1">Tap</tg-button>' +
        '</tg-button-row>',
    );
  });

  it('edits an inserted row in place, without duplicating it', () => {
    const editor = makeEditor();
    editor.commands.setButtonsRow({
      align: '',
      buttons: [{ type: 'url', label: 'Docs', value: 'https://t.frich' }],
    });
    expect((editor.getHTML().match(/tg-buttons/g) || []).length).toBe(1);

    expect(selectNode(editor, 'buttonsRow')).toBe(true);
    editor.chain().focus().updateAttributes('buttonsRow', {
      align: '',
      buttons: [{ type: 'url', label: 'Docs', value: 'https://new' }],
    }).run();

    expect((editor.getHTML().match(/tg-buttons/g) || []).length).toBe(1);
    expect(serializeEditorHtml(editor.getHTML()).html).toContain(
      '<tg-button type="url" url="https://new">Docs</tg-button>',
    );
  });

  it('inserts an inline `<tg-button>` chip inside a paragraph (10.3)', () => {
    const editor = makeEditor('<p>Pick: </p>');
    editor.commands.setInlineButton({
      type: 'callback_data',
      style: 'success',
      label: 'Go',
      value: 'go-1',
    });

    const editorHtml = editor.getHTML();
    // The chip carries its style as data (the DOM `style` attribute is CSS and
    // browsers normalise non-CSS values away).
    expect(editorHtml).toContain('<tg-button');
    expect(editorHtml).toContain('data-style="success"');
    expect(editorHtml).not.toMatch(/(?<!data-)style="success"/);

    expect(selectNode(editor, 'inlineButton')).toBe(true);
    expect(editor.isActive('inlineButton')).toBe(true);
    editor.commands.updateInlineButton({ label: 'Go now' });
    expect(editor.getHTML()).toContain('>Go now<');

    const { html } = serializeEditorHtml(editor.getHTML());
    expect(html).toContain(
      '<tg-button type="callback_data" style="success" data="go-1">Go now</tg-button>',
    );
  });

  it('keeps both the row and the chip in one message and serializes the whole page', () => {
    const editor = makeEditor(
      '<p>Text with a <tg-button type="url" style="link" url="https://t.frich">link chip</tg-button>.</p>',
    );
    editor.commands.setButtonsRow({
      align: 'right',
      buttons: [{ type: 'url', label: 'Open', value: 'https://t.frich/open' }],
    });
    const { html, blocks } = serializeEditorHtml(editor.getHTML());
    expect(html).toContain('tg-button-row align="right"');
    // The chip's `link` style can only ride on callback buttons, so it is
    // dropped from the wire even though the editor keeps showing it.
    expect(html).toContain('<tg-button type="url" url="https://t.frich">link chip</tg-button>');
    expect(blocks).toBeGreaterThan(1);
  });
});
