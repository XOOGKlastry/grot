const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch(process.env.EDGE_PATH?{executablePath:process.env.EDGE_PATH}:{});
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await page.goto(process.env.TEST_URL||'http://localhost:8765',{waitUntil:'networkidle'});
 // Exercise a real map polygon popup and its add-to-route control.
 await page.locator('#map').click({position:{x:140,y:240}});
 await page.locator('[data-add]').click();
 assert(await page.locator('#pgRoute').isVisible(),'map addition opens route');
 assert(!(await page.locator('#panel').evaluate(el=>el.classList.contains('min'))),'route is expanded');
 assert.equal(await page.locator('#cntStops').innerText(),'1');
 await page.locator('[data-page="pgAdd"]').click();
 await page.locator('#q').fill('Tychy');
 await page.locator('#qres [data-kod]').first().click();
 await page.locator('[data-page="pgRoute"]').click();
 assert(await page.locator('#btnGo').getAttribute('href'));
 assert((await page.locator('#btnGo').boundingBox()).height>=70);
 await page.screenshot({path:'../vesna-route.png'});
 await page.evaluate(() => {
   const original = L.Map.prototype.fitBounds;
   L.Map.prototype.fitBounds = function(bounds, options) {
     window.previewMap = this; window.previewBounds = bounds;
     return original.call(this, bounds, options);
   };
 });
 await page.locator('#handle').click();
 assert(await page.locator('#mapGo').isVisible());
 assert.equal(await page.locator('#mapGo').getAttribute('href'),await page.locator('#btnGo').getAttribute('href'));
 await page.waitForTimeout(600);
 assert(await page.evaluate(()=>!!window.previewMap && previewMap.getBounds().contains(previewBounds)), 'preview fits all stops');
 await page.screenshot({path:'../vesna-map.png'});
 await page.locator('#handle').click();
 assert(await page.locator('#pgRoute').isVisible());
 assert.equal(await page.locator('#cntStops').innerText(),'2');
 await browser.close();console.log('PASS map add → fullscreen route → navigation → map preview → route');
})().catch(e=>{console.error(e);process.exit(1)});
