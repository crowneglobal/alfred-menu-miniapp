const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('/opt/homebrew/lib/node_modules/openclaw/node_modules/playwright-core');
test('compact selector fits mobile widths and enlarged transparent target responds',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try {
 const html=fs.readFileSync(__dirname+'/../app.html','utf8');
 const styles=html.split('<style>')[1].split('</style>')[0];
 const nav='<nav class="module-switch"'+html.split('<nav class="module-switch"')[1].split('</nav>')[0]+'</nav>';
 const page=await browser.newPage();
 await page.route('**/*',r=>r.abort());
 await page.setContent('<html class="telegram-fullscreen"><style>'+styles+'</style><body class="banking-mode">'+nav+'</body></html>');
 await page.evaluate(()=>document.documentElement.style.setProperty('--app-device-safe-top','54px'));
 const measurements=[];
 for(const width of [320,375,390,430]) {
 await page.setViewportSize({width,height:844});
 for(const name of ['Alfred Bank ⇄','Alfred Tasks ⇄']) {
 await page.locator('button').evaluate((b,n)=>b.textContent=n,name);
 const m=await page.locator('button').evaluate(b=>{const r=b.getBoundingClientRect(),s=getComputedStyle(b);return {width:r.width,height:r.height,left:r.left,right:r.right,font:s.fontSize,color:s.backgroundColor,scroll:b.scrollWidth,client:b.clientWidth}});
 assert.equal(m.height,30);assert.equal(m.font,'16px');assert.equal(m.color,'rgb(242, 243, 235)');assert.ok(m.width<146);assert.ok(m.left>=72&&m.right<=width-72);assert.equal(m.scroll,m.client);
 measurements.push({viewport:width,name,...m});
 }
 }
 await page.locator('button').evaluate(b=>{b.onclick=()=>b.dataset.clicked='yes'});
 const box=await page.locator('button').boundingBox();await page.mouse.click(box.x+box.width/2,box.y-6);
 assert.equal(await page.locator('button').getAttribute('data-clicked'),'yes');
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'/Users/alfredo/.openclaw/workspace/evidence/banking-tasks-proposal/refined-switch-fixture.png'});
 console.log(JSON.stringify(measurements));
 } finally {await browser.close()}
});
