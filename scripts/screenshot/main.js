/**
 * Screenshot capture — renders scripts/screenshot/mock.html (the app's real
 * stylesheets over a faithful DOM) and writes the README screenshot.
 *
 * Run with:  npx electron scripts/screenshot/main.js
 *            npx electron scripts/screenshot/main.js --theme=black
 *            npx electron scripts/screenshot/main.js --settings
 * Writes:    screenshot.jpg              (repository root, default palette)
 *            screenshot-black.jpg        (with --theme=black — id used as suffix)
 *
 * A standalone Electron process — it does not touch the packaged app, its
 * single-instance lock or the user's running copy.
 *
 * @module scripts/screenshot
 */

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Headless-friendly: no GPU surface needed, just the rasterizer.
app.disableHardwareAcceleration();

// --theme=<id> names a body[data-theme] palette to shoot; nothing means the
// tokens' default. The file name carries the id so four captures can coexist.
const themeArg = process.argv.find((arg) => arg.startsWith('--theme='));
const themeId = themeArg ? themeArg.slice('--theme='.length) : '';
// --settings swaps the composer for the Settings sheet (the theme preview
// cards) — a separate capture, so the flagship screenshot stays the composer.
const settingsShot = process.argv.includes('--settings');
const TAG = settingsShot ? `settings${themeId ? `-${themeId}` : ''}` : themeId;
const OUT = path.resolve(__dirname, '..', '..', TAG ? `screenshot-${TAG}.jpg` : 'screenshot.jpg');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    show: false,
    frame: true,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });

  await win.loadFile(path.join(__dirname, 'mock.html'));
  if (themeId) {
    await win.webContents.executeJavaScript(
      `document.body.dataset.theme = ${JSON.stringify(themeId)};`,
      true,
    );
  }
  if (settingsShot) {
    await win.webContents.executeJavaScript(
      `document.getElementById('settings-shot').style.display = 'flex';`,
      true,
    );
  }
  // Fonts and image tiles decode on the next frames; give it a beat.
  await new Promise((resolve) => setTimeout(resolve, 900));

  const image = await win.webContents.capturePage();
  fs.writeFileSync(OUT, image.toJPEG(92));
  console.log(`screenshot written: ${OUT} (${fs.statSync(OUT).size} bytes)`);
  app.quit();
});
