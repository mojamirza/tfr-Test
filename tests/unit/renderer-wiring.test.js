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

/** Ids the toolbar shows as its own insert buttons (in the labelled groups). */
const TOOLBAR_INSERT_IDS = [
  'buttons',
  'inlineButton',
  'collage',
];

/** Dialog helpers the registry reaches through ctx — every one must exist. */
const CTX_HELPERS = [
  'askText',
  'askLink',
  'askButtons',
  'askInlineButton',
  'askCodeLanguage',
  'askFormula',
  'askSchedule',
  'askChoice',
  'askMap',
  'askDetails',
  'confirm',
  'notify',
  'askFiles',
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
    // The registry reaches ctx.askText/askLink/askButtons/askInlineButton/
    // askCodeLanguage/askChoice/askMap/askDetails/confirm — a helper missing
    // here is a feature that opens no dialog and merely toasts "network
    // error" on click. Some actions are also exercised with a mock ctx in
    // editor-actions tests, which cannot catch a missing wire-up — hence
    // these static assertions.
    expect(ctxBlock).not.toBe('');
    for (const helper of CTX_HELPERS) {
      expect(ctxBlock, `ctx helper ${helper}`).toContain(helper);
    }
  });

  it('wires every ctx.* helper the action source actually awaits', () => {
    // The fixed list above guards a known contract; this one derives the
    // contract from the actions themselves, so a new `ctx.askX` call site
    // fails here before it fails in the window.
    expect(ctxBlock).not.toBe('');
    const used = [...new Set(actionsSource.match(/\bctx\.\w+/g) || [])].map(
      (ref) => ref.slice('ctx.'.length),
    );
    expect(used.length).toBeGreaterThan(0);
    for (const helper of used) {
      expect(ctxBlock, `ctx.* ${helper} used by the actions`).toContain(helper);
    }
  });
});

describe('Toolbar.jsx', () => {
  it('shows only insert ids the action registry actually defines', () => {
    for (const id of TOOLBAR_INSERT_IDS) {
      expect(actionsSource, `action ${id}`).toMatch(new RegExp(`id: '${id}'`));
    }
  });

  it('draws the insert buttons from the palette\'s own action records', () => {
    expect(toolbarSource).toContain('GROUP_INSERTS');
    expect(toolbarSource).toContain('PREMIUM_ACTIONS');
    expect(toolbarSource).toContain('EXTRA_ACTIONS');
  });

  it('labels the four groups and keeps the publish sheet a click away', () => {
    for (const key of ['toolbar.groupText', 'toolbar.groupBlocks', 'toolbar.groupMedia', 'toolbar.groupPublish']) {
      expect(toolbarSource, `group label ${key}`).toContain(key);
    }
    expect(toolbarSource).toContain('onPublishOptions');
  });
});

describe('main.jsx', () => {
  it('mounts the app behind the crash boundary', () => {
    expect(mainSource).toMatch(/import ErrorBoundary/);
    expect(mainSource).toMatch(/<ErrorBoundary>/);
  });
});
