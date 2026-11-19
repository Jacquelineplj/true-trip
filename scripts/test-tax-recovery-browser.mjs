// Installed-extension regression: pending is not final missing data; retry only missing taxes.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {enrichHotels} from '../core/pipeline.js';
const {chromium}=await import(process.env.TRUETRIP_PLAYWRIGHT||'playwright');fs.mkdirSync('out/validation',{recursive:true});
const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.resolve('out/validation/tax-recovery-profile-')),{headless:false,...(process.env.TRUETRIP_BROWSER?{executablePath:process.env.TRUETRIP_BROWSER}:{}),args:[`--disable-extensions-except=${path.resolve('extension')}`,`--load-extension=${path.resolve('extension')}`]});
const report={at:new Date().toISOString(),method:'Installed extension with fixture hotel/availability responses and real local repricing; no AI calls.'};
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>chrome.storage.sync.set({maxCards:1,ratings:false,serverUrl:'http://localhost:8787'}));
 let html=0,browser=0,enrich=0;const availability=fs.readFileSync('fixtures/booking-availability.html','utf8');
 await context.route('**/demo?*',async route=>{const source=fs.readFileSync('extension/demo/booking-mock.html','utf8').replace('Includes taxes and fees','Taxes unavailable');await route.fulfill({body:source,contentType:'text/html'});});
 await context.route('https://www.booking.com/hotel/**',async route=>{html++;const body=html===1?availability.replace(/Excluded: 11.7 % TAX/g,'Tax details loading'):availability;await route.fulfill({body,contentType:'text/html'});});
 await context.route('**/hotel-taxes',async route=>{browser++;await new Promise(resolve=>setTimeout(resolve,1200));await route.fulfill({json:{status:'unknown',price:95,tax:null,reason:'Temporary tax-source failure'}});});
 await context.route('**/enrich-one',async route=>{enrich++;const b=route.request().postDataJSON();const point={lat:42,lon:-71};const r=await enrichHotels({context:b.context,hotels:[b.hotel],settings:b.settings},{geocode:async()=>point,geocodeHotel:async()=>point,driveRoute:async()=>({durationMin:5,distanceKm:1}),findParkingFee:async()=>({claim:{parking_fee_per_night:20,parking_type:'self',source_url:'https://fixture.example/parking',source_quote:'Self parking $20 per night'}})});await route.fulfill({json:{hotel:r.hotels[0]}});});
 const page=await context.newPage();let tabs=0;context.on('page',()=>tabs++);
 await page.goto('http://localhost:8787/demo?ss=Boston&checkin=2026-12-10&checkout=2026-12-11');
 await page.waitForFunction(()=>document.querySelector('.tt-block')?.textContent.includes('waiting for taxes'));
 assert.doesNotMatch(await page.locator('.tt-block').first().innerText(),/incomplete/);report.pendingTaxStatePassed=true;
 await page.locator('.tt-retry-tax').waitFor();assert.equal(browser,1);assert.match(await page.locator('.tt-block').first().innerText(),/incomplete/);
 await page.locator('.tt-retry-tax').click();
 await page.waitForFunction(()=>document.querySelector('.tt-block')?.textContent.includes('$11 taxes/fees'));
 await page.waitForFunction(()=>document.documentElement.dataset.truetripTaxPending==='0');
 assert.doesNotMatch(await page.locator('.tt-block').first().innerText(),/incomplete|waiting for taxes|Temporary tax-source failure/);
 assert.equal(enrich,1);assert.equal(html,2);assert.equal(browser,1);assert.equal(tabs,0);
 report.priceOnlyFallbackPassed=true;report.retryTaxesPassed=true;report.noRepeatEnrichment=true;report.extraTabs=tabs;report.passed=true;
}catch(e){report.passed=false;report.error=e.stack;process.exitCode=1;}
finally{fs.writeFileSync('out/validation/tax-recovery-browser.json',JSON.stringify(report,null,2));console.log(report);await context.close();}
