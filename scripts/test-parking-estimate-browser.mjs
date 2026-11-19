// Browser UI regression: deterministic provider fixtures; real localhost /notes aggregation.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {enrichHotels} from '../core/pipeline.js';
const {chromium}=await import(process.env.TRUETRIP_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.TRUETRIP_BROWSER?{executablePath:process.env.TRUETRIP_BROWSER}:{channel:'chrome'})});
const report={at:new Date().toISOString(),method:'Deterministic provider fixtures in a browser; real running localhost /notes endpoint. No live model requests.'};
try {
 const page=await browser.newPage();
 await page.route('**/page-load',r=>r.fulfill({json:{ok:true}}));let count=0,active=0,peak=0;
 await page.route('**/enrich-one',async route=>{
  const body=route.request().postDataJSON();const index=count++;active++;peak=Math.max(peak,active);
  await new Promise(resolve=>setTimeout(resolve,2500));
  const claim=index<2 ? {parking_fee_per_night:index===0?20:40,parking_type:'self',source_quote:`Self parking $${index===0?20:40} per night`}
   : index<5 ? {parking_fee_per_night:null,parking_type:'none',source_quote:'No on-site parking'} : {parking_fee_per_night:null,parking_type:'unknown',source_quote:null};
  const providers={geocode:async()=>({lat:42,lon:-71}),geocodeHotel:async()=>({lat:42,lon:-71}),driveRoute:async()=>({durationMin:5,distanceKm:1}),findParkingFee:async()=>({claim:{...claim,source_url:'https://fixture.example/parking',currency:'USD',confidence:'high'}})};
  const result=await enrichHotels({context:body.context,hotels:[{...body.hotel,priceIncludesTaxes:true}],settings:{...body.settings,ratings:false}},providers);
  active--;await route.fulfill({json:{hotel:result.hotels[0],context:result.context,anchors:result.anchors}});
 });
 const responsePromise=page.waitForResponse(async r=>r.url().endsWith('/notes')&&r.request().method()==='POST'&&(await r.json()).hotels?.length===6);
 await page.goto('http://localhost:8787/demo?ss=Boston&checkin=2026-12-10&checkout=2026-12-11&inline=1');
 await page.waitForFunction(()=>document.querySelectorAll('.tt-block[data-tt-state="complete"]').length===5);
 await page.locator('.tt-deferred .tt-search').click();
 await page.evaluate(()=>document.querySelector('.tt-banner').remove());
 await page.locator('.tt-banner').waitFor();
 assert.match(await page.locator('.tt-status').innerText(),/enriching|loading more/);
 assert.doesNotMatch(await page.locator('.tt-status').innerText(),/starting/);
 report.pendingBannerRecoveryPassed=true;
 await page.evaluate(()=>document.body.appendChild(document.createElement('aside')));
 const summary=await (await responsePromise).json();
 const original=await page.locator('[data-testid="title"]').allTextContents();
 assert.equal(count,6);assert.equal(peak,4);
 assert.ok(await page.locator('[data-testid="property-card"]').evaluateAll(cards=>cards.every(c=>(c.closest('[data-testid="property-card-container"]')??c).querySelectorAll('.tt-block').length===1)));
 await page.evaluate(()=>{window.__truetripLoaded=false;});
 await page.addScriptTag({path:'extension/content.js'});
 assert.equal(count,6);
 assert.deepEqual(summary.parkingAverage,{perNight:null,sampleSize:0});
 assert.equal(summary.hotels.filter(h=>h.parking.status==='estimated').length,3);
 assert.equal(summary.hotels.filter(h=>h.parking.status==='unknown').length,1);
 await page.waitForFunction(()=>[...document.querySelectorAll('.tt-block')].filter(b=>b.textContent.includes('default estimate')).length===3);
 assert.equal(await page.locator('.tt-block').filter({hasText:'not a quoted rate'}).count(),3);
 assert.equal(await page.locator('.tt-block').filter({hasText:'$50.00/night default estimate'}).count(),3);
 await page.locator('.tt-sort').click();assert.equal(await page.locator('.tt-rank').count(),6);
 await page.evaluate(()=>{const c=document.querySelector('[data-testid="property-card"]');const parent=c.closest('[data-testid="property-card-container"]')??c;const clone=parent.cloneNode(true);clone.querySelectorAll('.tt-block').forEach(b=>b.remove());parent.replaceWith(clone);});
 await page.waitForFunction(()=>document.querySelectorAll('.tt-block').length===6);
 assert.equal(await page.locator('.tt-block').filter({hasText:'default estimate'}).count(),3);
 assert.equal(await page.locator('.tt-rank').count(),6);
 await page.locator('.tt-restore').click();
 assert.deepEqual(await page.locator('[data-testid="title"]').allTextContents(),original);
 assert.equal(await page.locator('.tt-rank').count(),0);
 await page.waitForTimeout(900);
 assert.deepEqual(await page.locator('[data-testid="title"]').allTextContents(),original);
 await page.locator('.tt-sort').click();assert.equal(await page.locator('.tt-rank').count(),6);
 await page.locator('.tt-restore').click();
 assert.deepEqual(await page.locator('[data-testid="title"]').allTextContents(),original);
 report.restoreOriginalPassed=true;
 report.passed=true;report.requestCount=count;report.peakParallelHotelRequests=peak;report.average=summary.parkingAverage;report.estimated=3;report.blocks=await page.locator('.tt-block').allTextContents();
 await page.screenshot({path:'out/validation/parking-average-browser.png',fullPage:true});
}catch(e){report.passed=false;report.error=e.stack;process.exitCode=1;}
finally{fs.mkdirSync('out/validation',{recursive:true});fs.writeFileSync('out/validation/parking-average-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,average:report.average,error:report.error}));await browser.close();}
