const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ ...(process.env.EDGE_PATH ? {executablePath:process.env.EDGE_PATH} : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.TEST_URL || 'http://localhost:8765', { waitUntil: 'networkidle' });
  await page.locator('.leaflet-pane').first().waitFor({state:'attached'});
  for (const [width, height] of [[360,800],[390,844],[844,390],[1440,900]]) {
    await page.setViewportSize({width,height});
    await page.waitForTimeout(350);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
    await page.locator('#installBtn').click();
    assert(await page.locator('#installHelp').isVisible());
    await page.locator('#installHelp form button').click();
    if (width < 880) {
      if (!(await page.locator('#panel').evaluate(el => el.classList.contains('min')))) await page.locator('#handle').click();
      await page.locator('#filterBtn').click();
      assert(await page.locator('#legend').isVisible());
      await page.locator('#legend button').first().click();
      assert(!(await page.locator('#legend').isVisible()));
    }
    await page.locator('[data-page="pgAdd"]').click();
    await page.locator('#q').fill('Tychy');
    await page.waitForTimeout(500);
    assert(await page.locator('#qres').innerText());
    await page.locator('[data-page="pgRoute"]').click();
    assert(await page.locator('.dock').isVisible());
    if (width < 880) {
      const panelBox = await page.locator('#panel').boundingBox();
      const appBox = await page.locator('#app').boundingBox();
      assert(Math.abs(panelBox.height-appBox.height)<2, 'route panel must fill application');
    }
    await page.locator('[data-page="pgSaved"]').click();
    if (width < 880) assert(!(await page.locator('.dock').isVisible()));
    console.log('PASS viewport',width,height);
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#handle').click();
  await page.waitForTimeout(400);
  await page.screenshot({path:'../mobile-preview.png'});
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.ready).active.state), 'activated');
  assert.equal((await page.request.get(new URL('assets/app-192.png', page.url()).href)).status(),200);
  assert.deepEqual(errors,[]);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
