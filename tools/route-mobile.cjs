const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch(process.env.EDGE_PATH?{executablePath:process.env.EDGE_PATH}:{});
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await page.route('**/table/v1/**', route=>route.abort());
 await page.route('**/route/v1/**', route=>route.abort());
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
 assert.equal(await page.locator('#btnGo').getAttribute('href'), null, 'navigation locked before optimization');
 await page.locator('#btnOpt').click();
 await page.waitForFunction(()=>document.getElementById('btnGo').hasAttribute('href'));
 assert.equal(await page.locator('#btnGo').evaluate(e=>getComputedStyle(e).textDecorationLine),'none');
 assert((await page.locator('#btnGo').boundingBox()).height>=70);
 await page.waitForTimeout(300);
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
 await page.locator('[data-mode="ends"]').click();
 assert.equal(await page.locator('#btnGo').getAttribute('href'),null,'mode change locks navigation');
 // Drag the dedicated grab area, leaving list scrolling untouched.
 const grip=await page.locator('#mapGesture').boundingBox();
 await page.mouse.move(grip.x+100,grip.y+20);await page.mouse.down();
 await page.mouse.move(grip.x+100,grip.y+140,{steps:8});await page.mouse.up();
 assert(await page.locator('#panel').evaluate(e=>e.classList.contains('min')),'swipe reveals map');
 assert(!(await page.locator('#mapGo').isVisible()),'map navigation also locked');
 // Open a real gmina popup, then force a different visible feature set.
 await page.evaluate(()=>{previewMap.setView([50.12,18.98],10,{animate:false});});
 await page.waitForTimeout(400);
 await page.evaluate(()=>{
   const layers=[];previewMap.eachLayer(l=>{if(l.feature && l.getBounds && l.getBounds().contains(previewMap.getCenter()))layers.push(l);});
   const layer=layers.find(l=>l.listens('click'));
   if(!layer)throw Error('No interactive gmina found');
   layer.fire('click');window.popupOwner=layer;
 });
 await page.waitForTimeout(400);
 await page.evaluate(()=>{previewMap.panBy([220,80],{animate:false});});
 await page.waitForTimeout(300);
 assert(await page.evaluate(()=>popupOwner.isPopupOpen()),'popup survives map movement');
 await page.locator('#installBtn').click();
 await page.locator('#installIOS').click();
 assert((await page.locator('#installSteps').innerText()).includes('Safari'));
 await page.locator('#installAndroid').click();
 assert((await page.locator('#installSteps').innerText()).includes('Chrome'));
 await page.locator('#installHelp form button').click();
 await page.evaluate(()=>{
   const event=new Event('beforeinstallprompt',{cancelable:true});
   event.prompt=async()=>{window.installPromptCalled=true;};
   event.userChoice=Promise.resolve({outcome:'dismissed'});
   dispatchEvent(event);
 });
 await page.locator('#installBtn').click();
 assert(await page.evaluate(()=>window.installPromptCalled),'native install prompt invoked when available');
 await page.locator('#handle').click();
 await page.unroute('**/table/v1/**');
 let releaseRequest;
 await page.route('**/table/v1/**', async route=>{
   await new Promise(resolve=>{releaseRequest=resolve;}); await route.abort();
 });
 await page.locator('#btnOpt').click();
 await page.waitForFunction(()=>document.getElementById('btnOpt').disabled);
 await page.locator('[data-mode="open"]').click();
 while(!releaseRequest)await new Promise(resolve=>setTimeout(resolve,10));
 releaseRequest();
 await page.waitForFunction(()=>!document.getElementById('btnOpt').disabled);
 assert.equal(await page.locator('#btnGo').getAttribute('href'),null,'stale calculation cannot unlock navigation');
 await browser.close();console.log('PASS map add → fullscreen route → navigation → map preview → route');
})().catch(e=>{console.error(e);process.exit(1)});
