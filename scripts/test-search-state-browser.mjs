// Search-state regression: undated page, missing prices, late price hydration and terminal errors.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {enrichHotels} from '../core/pipeline.js';
const {chromium}=await import(process.env.TRUETRIP_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const report={at:new Date().toISOString(),method:'Real content script on local demo; fixture enrichment responses and real /notes. No AI calls.'};
try{
 const page=await browser.newPage();let requests=0;
 await page.route('**/enrich-one',async route=>{
  const body=route.request().postDataJSON();requests++;await new Promise(resolve=>setTimeout(resolve,800));
  if(body.hotel.name==='Boston Marriott Copley Place'){await route.fulfill({status:503,json:{error:'Test provider unavailable'}});return;}
  const point={lat:42,lon:-71};
  const providers={geocode:async()=>point,geocodeHotel:async()=>point,driveRoute:async()=>({durationMin:5,distanceKm:1}),findParkingFee:async()=>({claim:{parking_fee_per_night:20,parking_type:'self',source_quote:'Self parking $20 per night',source_url:'https://fixture.example/parking',currency:'USD'}})};
  const result=await enrichHotels({context:body.context,hotels:[body.hotel],settings:body.settings},providers);
  await route.fulfill({json:{hotel:result.hotels[0]}});
 });
 await page.goto('http://localhost:8787/demo?ss=Boston&inline=1');
 await page.waitForFunction(()=>/Select check-in and check-out/.test(document.querySelector('.tt-status')?.textContent??''));
 await page.waitForTimeout(1200);assert.equal(requests,0);assert.equal(await page.locator('.tt-block').count(),0);
 report.undatedNoQueries=true;
 await page.evaluate(()=>{
  const cards=[...document.querySelectorAll('[data-testid="property-card"]')];
  for(const c of cards.slice(-2)){const price=c.querySelector('[data-testid="price-and-discounted-price"]');price.dataset.oldText=price.textContent;price.textContent='';}
  history.pushState({},'',location.href+'&checkin=2026-12-10&checkout=2026-12-11');document.body.appendChild(document.createElement('aside'));
 });
 await page.waitForFunction(()=>[...document.querySelectorAll('.tt-block')].filter(b=>b.textContent.includes('True trip cost')).length===3);
 assert.equal(requests,4);assert.equal(await page.locator('.tt-block[data-tt-state="waiting-price"]').count(),2);
 report.unpricedCardsNotQueued=true;
 await page.evaluate(()=>{
  for(const p of document.querySelectorAll('[data-old-text]'))p.textContent=p.dataset.oldText;
  const c=document.querySelector('[data-testid="property-card-container"]');const clone=c.cloneNode(true);clone.querySelectorAll('.tt-block').forEach(b=>b.remove());c.replaceWith(clone);document.querySelector('.tt-banner').remove();
 });
 await page.waitForFunction(()=>[...document.querySelectorAll('.tt-block')].filter(b=>b.textContent.includes('True trip cost')).length===5);
 await page.waitForFunction(()=>document.querySelector('.tt-status')?.textContent.includes('5 hotels'));
 assert.equal(requests,6);assert.match(await page.locator('[data-testid="property-card-container"]').first().innerText(),/Test provider unavailable/);
 assert.doesNotMatch(await page.locator('.tt-status').innerText(),/enriching 6\/6/);
 report.latePricesProcessed=true;report.failureSurvivesRedraw=true;
 await page.evaluate(()=>{history.pushState({},'',location.pathname+'?ss=Boston&inline=1');document.body.appendChild(document.createElement('aside'));});
 await page.waitForFunction(()=>/Select check-in and check-out/.test(document.querySelector('.tt-status')?.textContent??''));
 assert.equal(await page.locator('.tt-block').count(),0);assert.equal(requests,6);
 report.searchResetClearsResults=true;
 const started=page.waitForRequest('**/enrich-one');
 await page.evaluate(()=>{history.pushState({},'',location.href+'&checkin=2026-12-12&checkout=2026-12-13');document.body.appendChild(document.createElement('aside'));});
 await started;
 await page.evaluate(()=>{history.pushState({},'',location.pathname+'?ss=Boston&inline=1');document.body.appendChild(document.createElement('aside'));});
 await page.waitForTimeout(1800);
 assert.equal(await page.locator('.tt-block').count(),0);
 assert.match(await page.locator('.tt-status').innerText(),/Select check-in and check-out/);
 report.staleResultsIgnored=true;report.requests=requests;report.passed=true;
}catch(e){report.passed=false;report.error=e.stack;process.exitCode=1;}
finally{fs.mkdirSync('out/validation',{recursive:true});fs.writeFileSync('out/validation/search-state-browser.json',JSON.stringify(report,null,2));console.log(report);await browser.close();}
