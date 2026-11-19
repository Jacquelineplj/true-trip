// Installed extension with deterministic responses: no paid/provider requests.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {enrichHotels} from '../core/pipeline.js';
import {repriceHotel} from '../core/reprice.js';
import {applyParkingAverage} from '../core/parking-estimate.js';
const output='out/validation';fs.mkdirSync(output,{recursive:true});
const profile=fs.mkdtempSync(path.resolve(output,'economy-profile-'));
const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.TRUETRIP_BROWSER||chromium.executablePath(),args:[`--disable-extensions-except=${path.resolve('extension')}`,`--load-extension=${path.resolve('extension')}`]});
const report={method:'Installed extension, deterministic API responses, no paid requests',at:new Date().toISOString()};
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await worker.evaluate(()=>chrome.storage.sync.set({maxCards:12,ratings:true,economyVersion:0}));
 const automatic=[],details=[],pageLoads=[];
 await context.route('**/page-load',async r=>{pageLoads.push(r.request().postDataJSON().pageLoad);await r.fulfill({json:{ok:true}});});
 await context.route('**/health',r=>r.fulfill({json:{ok:true,parking:'gpt-web-search',ratings:{fallback:'llm'}}}));
 await context.route('https://www.booking.com/hotel/**',r=>r.fulfill({body:'<html></html>',contentType:'text/html'}));
 await context.route('**/hotel-taxes',r=>r.fulfill({json:{status:'unknown',reason:'Test has no availability table'}}));
 await context.route('**/enrich-one',async route=>{
  const b=route.request().postDataJSON();automatic.push(b);const cardIndex=Number(b.hotel.id.split('-').at(-1));const fee=b.settings.deepSearch?65:cardIndex===0?null:25;
  const point={lat:42,lon:-71};
  const special=cardIndex===1||cardIndex===2;
  const publicClaim={matched_name:b.hotel.name,facility_name:'Central Public Garage',facility_address:'100 Main Street, Boston',distance_m:400,parking_fee_per_night:32,currency:'USD',rate_basis:'24h',source_url:'https://fixture.example/public-rates',source_quote:'24 hours parking: $32 per day.',confidence:'high'};
  const publicParking=cardIndex===1?{claim:publicClaim,evidence:{status:'searched',searchedAt:new Date().toISOString(),webSearchCalls:1,sources:[{url:publicClaim.source_url}]}}:undefined;
  const result=await enrichHotels({...b,hotels:[{...b.hotel,tax:0}]},{geocode:async()=>point,geocodeHotel:async()=>point,driveRoute:async()=>({durationMin:5,distanceKm:1}),ratings:async()=>({google:{rating:4.4},tripadvisor:{rating:3.9,via:'Google Travel',attribution:'model-assigned',verification:'model-reported',source:'llm-search (unverified)',url:'https://www.google.com/travel/hotels/entity/FixtureHotel',verificationNote:'Tripadvisor attribution comes from the model.'}}),findParkingFee:async()=>({claim:{parking_fee_per_night:special?null:fee,parking_type:special?'none':'valet',currency:'USD',source_url:'https://fixture.example/parking',source_quote:special?'No on-site parking':fee==null?null:`Valet parking $${fee} per night`},publicParking})});
  const durations=[[2,18],[6,6],[1,null],[3,5],[18,22],[1,3]][cardIndex];
  result.hotels[0].commute=result.hotels[0].commute.map((c,i)=>({...c,durationMin:durations[i]}));
  await route.fulfill({json:{hotel:result.hotels[0]}});
 });
 await context.route('**/notes',async route=>{const b=route.request().postDataJSON();await route.fulfill({json:{...applyParkingAverage(b.hotels,b.settings),pageCost:{estimatedUsd:0.01234,unknownCostRequests:0},notes:[]}});});
 await context.route('**/reprice',async route=>{const b=route.request().postDataJSON();await route.fulfill({json:{hotel:repriceHotel(b.hotel,b.details,b.settings)}});});
 await context.route('**/hotel-research',async route=>{
  const b=route.request().postDataJSON();assert.equal(b.pageLoad.id,automatic[0].pageLoad.id);details.push(b.kind);await new Promise(r=>setTimeout(r,150));
  const h=b.kind==='ratings'?{...b.current,ratings:{requested:true,google:{rating:4.4},tripadvisor:null}}:{...b.current,deepSearchDone:true,parking:{status:'ok',type:'valet',perNight:65,sourceUrl:'https://fixture.example/valet'}};
  await route.fulfill({json:{hotel:repriceHotel(h,{},b.settings)}});
 });
 const page=await context.newPage();await page.goto('http://localhost:8787/demo?ss=Boston&checkin=2026-12-10&checkout=2026-12-11');
 await page.waitForFunction(()=>document.querySelectorAll('.tt-block[data-tt-state="complete"]').length===5);
 assert.equal(automatic.length,5);assert.ok(automatic.every(b=>b.settings.ratings===false));assert.equal(await page.locator('.tt-deferred').count(),1);
 assert.match(await page.locator('.tt-block').nth(1).innerText(),/nearby public parking.*32.*Central Public Garage/s);
 assert.match(await page.locator('.tt-block').nth(2).innerText(),/50.00\/night default estimate.*not a quoted rate/s);
 assert.equal(await page.locator('.tt-block').nth(2).locator('a[href="https://fixture.example/public-rates"]').count(),0);
 const stored=await worker.evaluate(()=>chrome.storage.sync.get(['maxCards','ratings','economyVersion']));assert.equal(stored.maxCards,5);assert.equal(stored.ratings,false);
 const first=page.locator('.tt-block[data-tt-state="complete"]').first();
 assert.equal(await page.locator('.tt-load-ratings, .tt-deep-search').count(),0);
 assert.ok(automatic.every(b=>b.settings.deepSearch===false));
 const originalTitles=await page.locator('[data-testid="property-card"] [data-testid="title"]').allTextContents();
 await page.locator('.tt-sort').click();assert.equal(await page.locator('.tt-rank').count(),5);
 await page.locator('.tt-sort-time').click();
 const titles=()=>page.locator('[data-testid="property-card"] [data-testid="title"]').allTextContents();
 assert.deepEqual((await titles()).slice(0,5),[3,1,0,4,2].map(i=>originalTitles[i]));
 assert.equal(await page.locator('.tt-sort-time').getAttribute('aria-pressed'),'true');
 assert.match(await page.locator('.tt-average-commute').first().innerText(),/4.0 min one way/);
 assert.match(await page.locator('.tt-average-commute').nth(4).innerText(),/unavailable/);
 await page.locator('.tt-restore').click();assert.deepEqual(await titles(),originalTitles);
 await page.locator('.tt-sort-time').click();
 await page.locator('.tt-deferred .tt-search').first().click();
 await page.waitForFunction(()=>document.querySelectorAll('.tt-block[data-tt-state="complete"]').length===6);
 assert.equal(automatic.length,6);
 await page.waitForFunction(expected=>document.querySelector('[data-testid="property-card"] [data-testid="title"]')?.textContent===expected,originalTitles[5]);
 assert.deepEqual(await titles(),[5,3,1,0,4,2].map(i=>originalTitles[i]));
 await page.locator('.tt-restore').click();assert.deepEqual(await titles(),originalTitles);
 const options=await context.newPage();await options.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
 await options.waitForFunction(()=>document.querySelector('#maxCards').value==='5');assert.equal(await options.locator('#ratings').isChecked(),false);
 assert.equal(await options.locator('#deepSearch').isChecked(),false);
 await options.locator('#ratings').check();await options.locator('#deepSearch').check();await options.locator('#save').click();
 await options.waitForFunction(()=>document.querySelector('#saved').textContent.startsWith('Saved.'));
 const popup=await context.newPage();await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
 assert.equal(await popup.locator('#usage').getAttribute('href'),'http://localhost:8787/usage');await popup.close();
 // Dashboard fixtures stay in the isolated browser; they never enter the real ledger.
 await context.route('**/usage.json',r=>r.fulfill({json:{totalEstimatedUsd:0.011395,pageLoadCount:3,unknownCostRequests:1,pages:[
  {id:'first',at:new Date().toISOString(),city:'Boston',site:'booking',checkin:'2026-11-17',checkout:'2026-11-18',hotels:5,estimatedUsd:0.011395,unknownCostRequests:0},
  {id:'reload',at:new Date().toISOString(),city:'Boston',site:'booking',hotels:5,estimatedUsd:0,unknownCostRequests:0},
  {id:'failed',at:new Date().toISOString(),city:'Cambridge',site:'booking',hotels:1,estimatedUsd:0,unknownCostRequests:1}
 ]}}));
 const usagePage=await context.newPage();await usagePage.goto('http://localhost:8787/usage');
 await usagePage.waitForFunction(()=>document.querySelector('#rows')?.children.length===3);
 assert.match(await usagePage.locator('#summary').innerText(),/\$0.011395/);
 assert.match(await usagePage.locator('#rows').innerText(),/\$0.000000/);
 assert.match(await usagePage.locator('#rows').innerText(),/Unknown/);
 assert.doesNotMatch(await usagePage.locator('body').innerText(),/[\p{Script=Han}]/u);
 await usagePage.screenshot({path:`${output}/usage-browser.png`,fullPage:true});await usagePage.close();
 await options.close();await page.waitForFunction(()=>document.querySelector('.tt-status')?.textContent.startsWith('6 hotels'));await page.screenshot({path:`${output}/economy-browser.png`,fullPage:true});
 assert.ok(automatic.every(b=>b.pageLoad.id===automatic[0].pageLoad.id));
 assert.match(await page.locator('.tt-status').innerText(),/estimated page cost: \$0.0123/);
 const originalLoad=automatic[0].pageLoad.id;
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.tt-block[data-tt-state=\"complete\"]').length===5);
 assert.equal(automatic.length,11);assert.ok(automatic.slice(6).every(b=>b.settings.ratings===true&&b.settings.deepSearch===true));
 assert.match(await page.locator('.tt-block').first().innerText(),/Google 4.4/);assert.match(await page.locator('.tt-block').first().innerText(),/Tripadvisor 3.9.*model-attributed.*unverified/s);
 assert.equal(await page.locator('.tt-block').first().locator('a[href="https://www.google.com/travel/hotels/entity/FixtureHotel"]').count(),1);assert.match(await page.locator('.tt-block').first().innerText(),/Parking: \$65/);
 assert.equal(await page.locator('.tt-load-ratings, .tt-deep-search').count(),0);assert.equal(details.length,0);assert.match(await page.locator('.tt-ratings').first().innerText(),/unverified; model-reported/);
 await page.screenshot({path:`${output}/economy-settings-enabled.png`,fullPage:true});
 assert.notEqual(automatic[6].pageLoad.id,originalLoad);assert.equal(pageLoads.length,2);
 Object.assign(report,{passed:true,automaticHotels:5,manualHotels:1,details,stored,usagePagePassed:true,averageTravelTimeSortPassed:true});
}catch(e){report.passed=false;report.error=e.stack;process.exitCode=1;}
finally{fs.writeFileSync(`${output}/economy-browser.json`,JSON.stringify(report,null,2));console.log(report);await context.close();fs.rmSync(profile,{recursive:true,force:true});}
