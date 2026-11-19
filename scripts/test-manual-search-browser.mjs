// Installed extension: limited automatic lookups + on-demand search on later cards.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {enrichHotels} from '../core/pipeline.js';
const {chromium}=await import(process.env.TRUETRIP_PLAYWRIGHT||'playwright');
fs.mkdirSync('out/validation',{recursive:true});
const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.resolve('out/validation/manual-profile-')),{headless:false,...(process.env.TRUETRIP_BROWSER?{executablePath:process.env.TRUETRIP_BROWSER}:{}),args:[`--disable-extensions-except=${path.resolve('extension')}`,`--load-extension=${path.resolve('extension')}`]});
const report={at:new Date().toISOString(),method:'Installed extension on demo page; deterministic provider responses, real /notes aggregation. No live AI requests.'};
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await worker.evaluate(()=>chrome.storage.sync.set({maxCards:2,ratings:true,serverUrl:'http://localhost:8787'}));
 const requests=[];
 await context.route('**/enrich-one',async route=>{
  const b=route.request().postDataJSON(),index=requests.length;requests.push(b.hotel);await new Promise(resolve=>setTimeout(resolve,1200));
  const claim=index===1?{parking_fee_per_night:null,parking_type:'none',source_quote:'No on-site parking'}:{parking_fee_per_night:index===0?20:index===2?60:80,parking_type:'self',source_quote:`Self parking $${index===0?20:index===2?60:80} per night`};
  const point={lat:42,lon:-71};const providers={ratings:async()=>({google:{rating:4.4,url:'https://www.google.com/travel/hotels/entity/fixture',via:'Google Travel',source:'llm-search (unverified)'},tripadvisor:{rating:4.2,url:'https://www.google.com/travel/hotels/entity/fixture',via:'Google Travel',source:'llm-search (unverified)'}}),geocode:async()=>point,geocodeHotel:async()=>point,driveRoute:async()=>({durationMin:5,distanceKm:1}),findParkingFee:async()=>({claim:{...claim,currency:'USD',source_url:'https://fixture.example/parking',confidence:'high'}})};
  const hotel={...b.hotel};
  if(index===0)Object.assign(hotel,{price:109,tax:21.2,priceIncludesTaxes:false,taxEvidence:{tax:21.2,text:'Excluded: 19.45 % TAX',sourceUrl:b.hotel.url}});
  if(index===1)Object.assign(hotel,{tax:0,priceIncludesTaxes:true,taxEvidence:{tax:0,included:true,text:'Included: taxes and fees',sourceUrl:b.hotel.url}});
  if(index===2)Object.assign(hotel,{tax:null,priceIncludesTaxes:false,taxEvidence:{tax:null,reason:'Tax amount unavailable',sourceUrl:b.hotel.url}});
  const r=await enrichHotels({context:b.context,hotels:[hotel],settings:b.settings},providers);await route.fulfill({json:{hotel:r.hotels[0]}});
 });
 const page=await context.newPage();
 await page.goto('http://localhost:8787/demo?ss=Boston&checkin=2026-12-10&checkout=2026-12-11');
 const cards=page.locator('[data-testid="property-card-container"]');
 const original=await page.locator('[data-testid="title"]').allTextContents();
 await page.waitForFunction(()=>document.querySelectorAll('.tt-block[data-tt-state="complete"]').length===2);
 assert.equal(requests.length,2);assert.equal(await page.locator('.tt-deferred .tt-search').count(),4);
 const ratingBlock=page.locator('.tt-block[data-tt-state="complete"]').first();
 assert.match(await ratingBlock.innerText(),/Google 4.4.*via Google Travel.*Tripadvisor 4.2.*via Google Travel/s);
 assert.equal(await ratingBlock.locator('a[href="https://www.google.com/travel/hotels/entity/fixture"]').count(),2);
 report.ratingAttributionPassed=true;
 assert.equal(await cards.nth(0).locator('.tt-tax-note').innerText(),'Tax not included in room price; added above');
 assert.equal(await cards.nth(1).locator('.tt-tax-note').innerText(),'Tax included in room price.');
 assert.doesNotMatch(await cards.nth(0).locator('.tt-block').innerText(),/Excluded:/);
 report.taxCopyPassed=true;
 // Recreate a deferred card with its icon intact. The cloned button must still work.
 await cards.nth(5).evaluate(c=>c.replaceWith(c.cloneNode(true)));
 const manual=cards.nth(5).locator('.tt-search');await manual.click();
 assert.ok(await manual.isDisabled());
 await cards.nth(5).evaluate(c=>c.querySelector('.tt-search').dispatchEvent(new MouseEvent('click',{bubbles:true})));
 await page.waitForFunction(()=>document.querySelectorAll('.tt-block[data-tt-state="complete"]').length===3);
 assert.equal(requests.length,3);assert.equal(requests[2].name,'The Verb Hotel');
 assert.equal(await cards.nth(5).locator('.tt-tax-note').innerText(),'Tax amount unavailable; total remains incomplete.');
 await page.waitForFunction(()=>[...document.querySelectorAll('.tt-block')].some(b=>b.textContent.includes('$50.00/night default estimate')));
 report.defaultParkingRetained=true;report.doubleClickDedupPassed=true;report.clonedButtonPassed=true;
 await page.locator('.tt-sort').click();assert.equal(await page.locator('.tt-rank').count(),3);
 await page.locator('.tt-restore').click();assert.deepEqual(await page.locator('[data-testid="title"]').allTextContents(),original);
 // Another manual card gets a distinct ID and does not start the remaining cards automatically.
 await cards.nth(2).locator('.tt-search').click();
 await page.waitForFunction(()=>document.querySelectorAll('.tt-block[data-tt-state="complete"]').length===4);
 assert.equal(requests.length,4);assert.equal(new Set(requests.map(h=>h.id)).size,4);
 assert.equal(await page.locator('.tt-deferred .tt-search').count(),2);
 // A lazily inserted card beyond the limit gets a button, not a lookup.
 await cards.nth(3).evaluate(c=>{const n=c.cloneNode(true);n.querySelector('.tt-block')?.remove();n.querySelector('[data-testid="title"]').textContent='New lazy hotel';n.querySelector('a[data-testid="title-link"]').href='https://www.booking.com/hotel/us/new-lazy.html';c.parentElement.appendChild(n);});
 await page.waitForFunction(()=>document.querySelectorAll('.tt-deferred .tt-search').length===3);
 assert.equal(requests.length,4);
 assert.ok(await cards.evaluateAll(cs=>cs.every(c=>c.querySelectorAll('.tt-block').length===1)));
 report.passed=true;report.requestCount=requests.length;report.uniqueIds=4;report.remainingManualButtons=3;
 report.manualIncludedInSort=true;report.autoLimitPreserved=true;
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:'out/validation/manual-search-browser.png',fullPage:true});
 await cards.nth(0).locator('.tt-block').screenshot({path:'out/validation/minimal-card.png'});
 await page.locator('.tt-banner').screenshot({path:'out/validation/minimal-toolbar.png'});
 await page.locator('.tt-deferred').first().screenshot({path:'out/validation/minimal-search.png'});
 await page.setViewportSize({width:390,height:844});
 await cards.nth(0).locator('.tt-block').screenshot({path:'out/validation/minimal-card-mobile.png'});
 const box=await cards.nth(0).locator('.tt-block').boundingBox();assert.ok(box.width<=390);
 report.mobileCardFits=true;
 const extensionOrigin='chrome-extension://'+new URL(worker.url()).host;
 const options=await context.newPage();await options.goto(extensionOrigin+'/options.html');
 await options.waitForFunction(()=>document.querySelector('#anchors')?.value.includes('MIT Media Lab'));await options.screenshot({path:'out/validation/minimal-settings.png',fullPage:true});
 const popup=await context.newPage();await popup.goto(extensionOrigin+'/popup.html');
 await popup.waitForFunction(()=>!document.querySelector('#server')?.textContent.includes('Checking server'));
 await popup.locator('body').screenshot({path:'out/validation/minimal-popup.png'});
}catch(e){report.passed=false;report.error=e.stack;process.exitCode=1;}
finally{fs.writeFileSync('out/validation/manual-search-browser.json',JSON.stringify(report,null,2));console.log(report);await context.close();}
