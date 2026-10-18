/**
 * Screenshot capture — renders scripts/screenshot/mock.html (the app's real
 * stylesheets over a faithful DOM) and writes the README screenshot.
 *
 * Run with:  npx electron scripts/screenshot/main.js
 * Writes:    screenshot.jpg  (repository root)
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

const OUT = path.resolve(__dirname, '..', '..', 'screenshot.jpg');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    show: false,
    frame: true,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });

  await win.loadFile(path.join(__dirname, 'mock.html'));
  // Fonts and image tiles decode on the next frames; give it a beat.
  await new Promise((resolve) => setTimeout(resolve, 900));

  const image = await win.webContents.capturePage();
  fs.writeFileSync(OUT, image.toJPEG(92));
  console.log(`screenshot written: ${OUT} (${fs.statSync(OUT).size} bytes)`);
  app.quit();
});
