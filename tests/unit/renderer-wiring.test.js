/**
 * Renderer wiring guards.
 *
 * The action layer talks to the app through a `ctx` object. When a dialog
 * helper is missing from that wiring, the feature degrades at runtime only:
 * the unit tests for the actions drive their own mock `ctx`, so a missing
 * method passes every editor test and simply dies in the real window. These
 * static assertions keep the action surface and the app's `ctx` in step —
 * the same static-pairing idea the ipc-surface test uses for IPC channels.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../../src/renderer');

const appSource = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8');
const toolbarSource = fs.readFileSync(
  path.join(SRC, 'components/Toolbar.jsx'),
  'utf8',
);
const actionsSource = fs.readFileSync(
  path.join(SRC, 'lib/editor-actions.js'),
  'utf8',
);
const mainSource = fs.readFileSync(path.join(SRC, 'main.jsx'), 'utf8');

/** Ids the toolbar shows as its own insert buttons. */
const TOOLBAR_INSERT_IDS = [
  'buttons',
  'inlineButton',
  'customEmoji',
  'mention',
  'dateTime',
  'thinking',
  'collage',
];

const ctxBlock = (() => {
  const match = appSource.match(/const ctx = useMemo\(\s*\(\) => \(\{[\s\S]*?\}\),/);
  return match ? match[0] : '';
})();

describe('App.jsx', () => {
  it('takes every dialog helper from useDialogs', () => {
    expect(appSource).toMatch(/const \{[^}]*askInlineButton[^}]*\} = useDialogs\(\)/);
  });

  it('wires the action ctx with every dialog helper the actions call', () => {
    // The registry uses `ctx.askInlineButton`, `ctx.askButtons`, `ctx.askLink`,
    // `ctx.askText` and `ctx.confirm` — a helper missing here is a feature
    // that opens no dialog and merely toasts "network error" on click.
    expect(ctxBlock).not.toBe('');
    expect(ctxBlock).toContain('askText');
    expect(ctxBlock).toContain('askLink');
    expect(ctxBlock).toContain('askButtons');
    expect(ctxBlock).toContain('askInlineButton');
    expect(ctxBlock).toContain('confirm');
    expect(ctxBlock).toContain('notify');
    expect(ctxBlock).toContain('askFiles');
  });
});

describe('Toolbar.jsx', () => {
  it('shows only insert ids the action registry actually defines', () => {
    for (const id of TOOLBAR_INSERT_IDS) {
      expect(actionsSource, `action ${id}`).toMatch(new RegExp(`id: '${id}'`));
    }
  });

  it("draws the insert buttons from the palette's own action records", () => {
    expect(toolbarSource).toContain('INSERT_IDS');
    expect(toolbarSource).toContain('PREMIUM_ACTIONS');
    expect(toolbarSource).toContain('EXTRA_ACTIONS');
  });
});

describe('main.jsx', () => {
  it('mounts the app behind the crash boundary', () => {
    expect(mainSource).toMatch(/import ErrorBoundary/);
    expect(mainSource).toMatch(/<ErrorBoundary>/);
  });
});
