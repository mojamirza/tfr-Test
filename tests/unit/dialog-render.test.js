/**
 * Component test: every dialog kind must RENDER without blowing up the
 * whole window.
 *
 * The 5.7.0 buttons-row dialog shipped with a render-time crash — the shared
 * actions row read `dialog.options.danger`/`dialog.options.confirmKey` while
 * several `ask*` factories created the dialog without an `options` field, so
 * clicking the toolbar's buttons-row button (and also the map, details and
 * code dialogs) unmounted React at the title line before any panel rendered.
 * The action tests drive a mock `ctx` and the wiring test greps sources, so
 * only a mounted render catches a crash like this — which is why this file
 * mounts the real provider once per kind, empty options and all.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DialogProvider, useDialogs } from '../../src/renderer/components/Dialog.jsx';
import { I18nProvider } from '../../src/renderer/i18n/index.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The ask* helper each dialog kind reaches through useDialogs. `options` is
 * deliberately allowed to be `{}`/undefined — openDialog mounts with no
 * options, which is exactly the path that crashed.
 * @param {Record<string, (dialogs: object, options: object) => Promise<unknown>>}
 */
const OPENS = {
  buttons: ({ askButtons }, options) => askButtons(options),
  inlineBtn: ({ askInlineButton }, options) => askInlineButton(options),
  code: ({ askCodeLanguage }, options) => askCodeLanguage(options),
  choice: ({ askChoice }, options) => askChoice(options),
  map: ({ askMap }, options) => askMap(options),
  details: ({ askDetails }, options) => askDetails(options),
  text: ({ askText }, options) => askText(options),
  link: ({ askLink }, options) => askLink(options),
};

/**
 * Mount the provider, fire one `ask*`, and return the container for
 * assertions. The promise the dialog resolves stays pending — the dialog is
 * meant to stay open on screen, like an author who has not decided yet.
 * @param {keyof typeof OPENS} kind
 * @param {object} [options] forwarded into the ask* call
 */
async function openDialog(kind, options) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root;
  await act(async () => {
    root = createRoot(container);
    const Probe = () => {
      const dialogs = useDialogs();
      useEffect(() => {
        OPENS[kind](dialogs, options || {});
      }, []);
      return null;
    };
    root.render(
      createElement(I18nProvider, null, createElement(DialogProvider, null, createElement(Probe))),
    );
  });
  return { container, root };
}

/** Providers that must be unmounted exactly once, after each render. */
const roots = [];
afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    await act(async () => {
      root.unmount();
    });
  }
  document.body.innerHTML = '';
});

describe('every dialog kind renders', () => {
  for (const kind of Object.keys(OPENS)) {
    it(`the ${kind} dialog opens with a title and its actions row`, async () => {
      const { container, root } = await openDialog(kind);
      roots.push(root);

      const title = container.querySelector('.dialog-title');
      expect(title, `${kind}: title node`).toBeTruthy();
      expect(title.textContent.trim().length, `${kind}: title text`).toBeGreaterThan(0);

      // The shared confirm/cancel row — the read that used to crash.
      const actions = container.querySelectorAll('.dialog-actions .dialog-btn');
      expect(actions.length, `${kind}: actions row`).toBeGreaterThanOrEqual(2);
    });
  }

  it('the buttons dialog renders a prefilled row of button fields', async () => {
    const { container, root } = await openDialog('buttons', {
      align: 'center',
      buttons: [{ type: 'url', label: 'Docs', value: 'https://core.telegram.org', style: 'primary' }],
    });
    roots.push(root);

    const rows = container.querySelectorAll('.btn-row');
    expect(rows.length).toBe(1);
    // The chip preview carries the label and the style tint.
    const preview = container.querySelector('.btn-row-preview');
    expect(preview.textContent).toBe('Docs');
    expect(preview.getAttribute('data-style')).toBe('primary');
    // The row can grow to the documented cap of eight buttons.
    expect(container.querySelector('.dialog-btn.block')?.disabled).toBe(false);
  });

  it('the map dialog renders its coordinate fields', async () => {
    const { container, root } = await openDialog('map');
    roots.push(root);
    expect(container.querySelectorAll('.dialog-fields input').length).toBeGreaterThan(0);
  });

  it('the details dialog renders the initially-expanded pick', async () => {
    const { container, root } = await openDialog('details');
    roots.push(root);
    const check = container.querySelector('.btn-row-check input[type="checkbox"]');
    expect(check).toBeTruthy();
    expect(check.checked).toBe(false);
  });

  it('the code dialog renders its language search plus list', async () => {
    const { container, root } = await openDialog('code');
    roots.push(root);
    expect(container.querySelector('.dialog-list')).toBeTruthy();
  });

  it('the choice dialog lists its options and tints the current pick', async () => {
    const { container, root } = await openDialog('choice', {
      titleKey: 'block.listType',
      current: 'a',
      options: [
        { value: '', labelKey: 'marker.numbers' },
        { value: 'a', labelKey: 'marker.lowerLetters' },
        { value: 'A', labelKey: 'marker.upperLetters' },
      ],
    });
    roots.push(root);

    const rows = [...container.querySelectorAll('.dialog-list-item')];
    expect(rows.map((row) => row.textContent)).toEqual(['Numbers', 'Lowercase letters', 'Uppercase letters']);
    // The current pick carries the highlight; the others do not.
    const active = rows.filter((row) => row.className.includes('active'));
    expect(active.length).toBe(1);
    expect(active[0].textContent).toBe('Lowercase letters');
    expect(active[0].getAttribute('aria-selected')).toBe('true');
  });
});
