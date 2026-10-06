const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, Menu } = require('electron');

async function checkGuide(testRoot) {
  const help = Menu.getApplicationMenu()?.items.find(item => item.label === '\u5e2e\u52a9');
  const entry = help?.submenu?.items.find(item => item.label === '\u4f7f\u7528\u6559\u7a0b');
  assert(entry?.enabled && entry.accelerator === 'F1', 'Help must provide an enabled F1 user guide');
  const guidePath = path.join(app.getAppPath(), 'docs', 'user-guide.html');
  assert((await fs.stat(guidePath)).isFile(), 'The offline guide must be included in the app payload');
  const guideWindow = new BrowserWindow({ width: 1120, height: 800, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const views = [];
  try {
    guideWindow.removeMenu();
    await guideWindow.loadFile(guidePath);
    for (const [width, height] of [[1120, 800], [390, 844]]) {
      guideWindow.setContentSize(width, height);
      const view = await guideWindow.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        const links = [...document.querySelectorAll('a[href^="#"]')];
        resolve({
          title: document.title,
          headings: [...document.querySelectorAll('h1, h2, h3')].map(node => node.textContent.trim()),
          links: links.length,
          brokenLinks: links.map(link => link.getAttribute('href')).filter(href => !document.getElementById(decodeURIComponent(href.slice(1)))),
          width: innerWidth,
          documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        });
      })))`);
      assert.match(view.title, /\u7eee\u7ed8\u9884\u6f14\u53f0/, 'The guide title must identify the application');
      assert(view.headings.some(heading => heading.includes('\u5feb\u6377\u952e')), 'The guide must include keyboard instructions');
      assert(view.links > 0, 'The guide must include a linked table of contents');
      assert.deepEqual(view.brokenLinks, [], 'Every guide section link must resolve');
      assert(view.documentWidth <= view.width + 2, 'The guide must fit its desktop and narrow windows');
      await fs.writeFile(path.join(testRoot, 'guide-' + width + '.png'), (await guideWindow.webContents.capturePage()).toPNG());
      views.push({ width: view.width, documentWidth: view.documentWidth, sectionLinks: view.links });
    }
    return { path: guidePath, accelerator: entry.accelerator, views };
  } finally {
    guideWindow.destroy();
  }
}

async function checkViewportPixels(window) {
  const bounds = await window.webContents.executeJavaScript(`(() => {
    const rect = document.querySelector('[data-testid=director-stage-shell] canvas').getBoundingClientRect();
    return { x: Math.ceil(rect.left + rect.width * 0.25), y: Math.ceil(rect.top + rect.height * 0.56),
      width: Math.max(1, Math.floor(rect.width * 0.5)), height: Math.max(1, Math.floor(rect.height * 0.3)) };
  })()`);
  // Sample the lower central grid, clear of toolbars and the camera monitor.
  const image = await window.webContents.capturePage(bounds);
  assert(!image.isEmpty(), 'The viewport screenshot must contain pixels');
  const bitmap = image.toBitmap();
  const colors = new Set();
  let minimum = 255, maximum = 0;
  const stride = Math.max(1, Math.floor(bitmap.length / 4 / 12000)) * 4;
  for (let index = 0; index < bitmap.length; index += stride) {
    const blue = bitmap[index], green = bitmap[index + 1], red = bitmap[index + 2];
    colors.add((red << 16) | (green << 8) | blue);
    const value = (red + green + blue) / 3;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  assert(colors.size >= 4 && maximum - minimum >= 8, 'The 3D viewport must render a visible grid instead of a blank surface');
  return { colors: colors.size, brightnessRange: Number((maximum - minimum).toFixed(2)), bounds };
}

module.exports = async ({ window, origin, userData, testRoot, errors }) => {
  assert(path.resolve(userData).startsWith(path.resolve(testRoot) + path.sep));
  await fs.mkdir(testRoot, { recursive: true });
  const deadline = Date.now() + 30000;
  let canvas;
  let editor;
  while (Date.now() < deadline) {
    editor = await window.webContents.executeJavaScript(`(() => {
      document.querySelector('.startup-canvas-gate .startup-secondary')?.click();
      const startupButtons = [...document.querySelectorAll('button')];
      startupButtons.find(button => button.textContent.trim() === '\u77e5\u9053\u4e86')?.click();
      startupButtons.find(button => button.textContent.includes('\u76f4\u63a5\u5207\u6362'))?.click();
      const shell = document.querySelector('[data-testid=director-stage-shell]');
      const c = shell?.querySelector('canvas');
      const buttons = [...(shell?.querySelectorAll('button') || [])];
      const button = label => buttons.find(element => element.getAttribute('aria-label') === label || element.textContent.trim() === label);
      if (!button('\u5bfc\u51fa\u89c6\u9891')) button('\u52a8\u6001\u9884\u6f14')?.click();
      return {
        canvas: c && {width:c.width,height:c.height},
        emptyCamera: !!shell?.querySelector('[data-testid=director-stage-camera-empty]'),
        canAddCamera: !!shell?.querySelector('[data-testid=director-stage-monitor-add-camera]:not([disabled])'),
        captureDisabled: button('\u62cd\u6444')?.disabled === true,
        exportDisabled: button('\u5bfc\u51fa\u89c6\u9891')?.disabled === true,
      };
    })()`);
    canvas = editor.canvas;
    if (canvas?.width > 0 && canvas?.height > 0 && editor.emptyCamera && editor.canAddCamera && editor.captureDisabled && editor.exportDisabled) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await fs.writeFile(path.join(testRoot, 'desktop.png'), (await window.webContents.capturePage()).toPNG());
  assert(canvas?.width > 0 && canvas?.height > 0, 'Editor did not render a canvas');
  assert(editor.emptyCamera && editor.canAddCamera, 'Fresh project must show an empty camera monitor and Add camera');
  assert(editor.captureDisabled && editor.exportDisabled, 'Fresh project without a camera must disable capture and video export');
  const manifest = await fetch(origin + '/assets/motions/manifest.json').then(response => response.json());
  assert(manifest.motions.length >= 13, 'Expanded motion catalog is missing');
  assert.equal(new Set(manifest.motions.map(motion => motion.assetId)).size, manifest.motions.length);
  assert.equal(manifest.pathTraversalVariants.length, 2);
  const assets = await fetch(origin + '/api/assets/catalog').then(response => response.json());
  assert.equal(assets.root, await fs.realpath(path.join(testRoot, 'Assets')));
  assert.equal(assets.canOpenFolder, true);
  for (const category of ['characters', 'models', 'motions', 'poses']) {
    assert((await fs.stat(assets.directories[category])).isDirectory());
    assert.equal(assets[category].length, 0);
  }
  const viewportPixels = await checkViewportPixels(window);
  const guide = await checkGuide(testRoot);
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(testRoot, 'result.json'), JSON.stringify({ status: 'passed', ...editor, viewportPixels, guide,
    assetsRoot: assets.root, motions: manifest.motions.length, pathVariants: manifest.pathTraversalVariants.length, errors }, null, 2));
};
