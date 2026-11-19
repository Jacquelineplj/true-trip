// Real DOM tests for session-retained Booking dates absent from the search URL.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {enrichHotels} from '../core/pipeline.js';
const {chromium}=await import(process.env.TRUETRIP_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const report={at:new Date().toISOString(),method:'Real content script/DOM on local demo, fixture enrichment and real /notes; no AI calls.'};
try{
 const page=await browser.newPage(),requests=[];
 await page.route('**/enrich-one',async route=>{
  const b=route.request().postDataJSON();requests.push(b.context);const point={lat:42,lon:-71};
  const r=await enrichHotels({context:b.context,hotels:[b.hotel],settings:b.settings},{geocode:async()=>point,geocodeHotel:async()=>point,driveRoute:async()=>({durationMin:5,distanceKm:1})});
  await route.fulfill({json:{hotel:r.hotels[0]}});
 });
 await page.goto('http://localhost:8787/demo?ss=Boston&inline=1');
 await page.waitForFunction(()=>/Select check-in/.test(document.querySelector('.tt-status')?.textContent??''));
 await page.evaluate(()=>{const calendar=document.createElement('div');calendar.innerHTML='<span data-date="2026-12-10">10</span><span data-date="2026-12-11">11</span>';document.body.appendChild(calendar);});
 await page.waitForTimeout(800);assert.equal(requests.length,0);
 report.unselectedCalendarIgnored=true;
 // Only href attributes change. This must wake the observer and use the dates embedded in the links.
 await page.evaluate(()=>{for(const a of document.querySelectorAll('a[data-testid="title-link"]')){const u=new URL(a.href);u.searchParams.set('checkin','2026-12-10');u.searchParams.set('checkout','2026-12-11');a.href=u.href;}});
 await page.waitForFunction(()=>document.querySelectorAll('.tt-block[data-tt-state="complete"]').length===6);
 assert.equal(requests.length,6);assert.ok(requests.every(c=>c.checkin==='2026-12-10'&&c.checkout==='2026-12-11'&&c.datesSource==='hotel-links'));
 assert.ok(!new URL(page.url()).searchParams.has('checkin'));
 report.urlWithoutDatesEnriches=true;report.hrefOnlyHydrationPassed=true;
 await page.evaluate(()=>{for(const a of document.querySelectorAll('a[data-testid="title-link"]')){const u=new URL(a.href);u.searchParams.set('checkin','2026-12-12');u.searchParams.set('checkout','2026-12-13');a.href=u.href;}});
 await page.waitForFunction(()=>document.querySelectorAll('.tt-block[data-tt-state="complete"]').length===6&&[...document.querySelectorAll('.tt-status')].some(x=>x.textContent.includes('6 hotels')));
 await page.waitForTimeout(800);assert.equal(requests.length,12);assert.ok(requests.slice(6).every(c=>c.checkin==='2026-12-12'));
 report.linkDatesChangeResetsSearch=true;
 // Isolated parser cases, without initializing the content script or making requests.
 const parser=await browser.newPage();
 const read=async(html,url='https://www.booking.com/searchresults.html?ss=Boston')=>{await parser.setContent(html);await parser.evaluate(fs.readFileSync('extension/reader.js','utf8'));return parser.evaluate(url=>globalThis.TrueTripReader.readContext(document,url),url);};
 const card=(start,end,price='$100',nights=1)=>`<div data-testid="property-card"><a data-testid="title-link" href="/hotel/us/test.html?checkin=${start}&amp;checkout=${end}">Hotel</a><div data-testid="price-and-discounted-price">${price}</div><div data-testid="price-for-x-nights">${nights} night, 2 adults</div></div>`;
 const form=await read('<input name="checkin" value="2026-12-10"><input name="checkout" value="2026-12-11">');assert.equal(form.datesSource,'search-form');
 const conflict=await read(card('2026-12-10','2026-12-11')+card('2026-12-12','2026-12-13'));assert.equal(conflict.checkin,null);
 const unpriced=await read(card('2026-12-12','2026-12-13','')+card('2026-12-10','2026-12-11'));assert.equal(unpriced.checkin,'2026-12-10');
 const mismatch=await read(card('2026-12-10','2026-12-12'));assert.equal(mismatch.checkin,null);
 const bad=await read(card('2026-02-30','2026-03-01'));assert.equal(bad.checkin,null);
 const explicit=await read(card('2026-12-12','2026-12-13'),'https://www.booking.com/searchresults.html?ss=Boston&checkin=2026-12-10&checkout=2026-12-11');assert.equal(explicit.datesSource,'url');assert.equal(explicit.checkin,'2026-12-10');
 report.formDatesPassed=true;report.conflictsAndInvalidDatesRejected=true;report.explicitUrlPriorityPassed=true;report.requestCount=requests.length;report.passed=true;
}catch(e){report.passed=false;report.error=e.stack;process.exitCode=1;}
finally{fs.mkdirSync('out/validation',{recursive:true});fs.writeFileSync('out/validation/session-dates-browser.json',JSON.stringify(report,null,2));console.log(report);await browser.close();}
