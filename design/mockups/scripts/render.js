// Renders mockup.html variants to PNG. Usage: node render.js [outDir] [scale]
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || path.join(__dirname, '..');
const scale = +(process.argv[3] || 2);
const shots = [
  ['minimal-desktop', 'theme=minimal&view=desktop&moment=play', 1600, 900],
  ['minimal-phone', 'theme=minimal&view=phone&moment=play', 390, 844],
  ['minimal-phone-death', 'theme=minimal&view=phone&moment=death', 390, 844],
  ['cartoon-desktop', 'theme=cartoon&view=desktop&moment=play&zone=3', 1600, 900],
  ['cartoon-phone', 'theme=cartoon&view=phone&moment=play&zone=1', 390, 844],
  ['cartoon-phone-death', 'theme=cartoon&view=phone&moment=death&zone=5', 390, 844],
  ['cartoon-zone1', 'theme=cartoon&view=desktop&moment=play&zone=1', 1600, 900],
  ['cartoon-zone5', 'theme=cartoon&view=desktop&moment=play&zone=5', 1600, 900],
];
const shotsDone = (async () => {
  const browser = await chromium.launch();
  for (const [name, q, w, h] of shots) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
    await page.goto('file://' + path.join(__dirname, '..', 'mockup.html') + '?' + q);
    await page.waitForSelector('body[data-ready="1"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, name + '.png') });
    await page.close();
    console.log('wrote', name);
  }
  await browser.close();
})();
// boards: node render.js <dir> <scale> boards
if (process.argv[4] === 'boards') shotsDone.then(async () => {
  const browser = await chromium.launch();
  for (const t of ['minimal', 'cartoon']) {
    const page = await browser.newPage({ viewport: { width: 1960, height: 800 }, deviceScaleFactor: 1 });
    await page.goto('file://' + path.join(out, 'board.html') + '?theme=' + t);
    await page.waitForSelector('body[data-ready="1"]');
    await page.locator('.board').screenshot({ path: path.join(out, 'board-' + t + '.png') });
    console.log('wrote board', t);
  }
  await browser.close();
});
