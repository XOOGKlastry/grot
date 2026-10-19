// Render the unmodified VESNA vector logo onto a maskable application tile.
// Source: https://www.vesna.legal/ inline g#logo (retrieved 2026-10-19).
const {chromium} = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch(process.env.EDGE_PATH ? {executablePath:process.env.EDGE_PATH} : {});
  const page = await browser.newPage();
  const svg = fs.readFileSync(path.join(__dirname,'../assets/vesna-logo.svg'),'utf8');
  for (const size of [192,512]) {
    await page.setViewportSize({width:size,height:size});
    await page.setContent(`<body style="margin:0;background:#22251b;display:grid;place-items:center;height:100vh"><img style="width:78%;height:78%" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body>`);
    await page.locator('img').evaluate(img => img.decode());
    await page.screenshot({path:path.join(__dirname,`../assets/app-${size}.png`)});
  }
  await browser.close();
})().catch(e => {console.error(e); process.exit(1);});
