// Installed extension regression with local fixtures; no model or map network requests.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {geocodeHotel} from '../providers/geocode.js';
import {enrichHotels} from '../core/pipeline.js';
import {repriceHotel} from '../core/reprice.js';
import '../extension/hotel-tax-reader.js';
const dir='out/validation';fs.mkdirSync(dir,{recursive:true});
const profile=fs.mkdtempSync(path.resolve(dir,'booking-location-profile-'));
const browser=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.TRUETRIP_BROWSER||chromium.executablePath(),args:[`--disable-extensions-except=${path.resolve('extension')}`,`--load-extension=${path.resolve('extension')}`]});
const report={method:'Installed extension; Booking HTML and bridge responses intercepted; no paid requests',scenarios:[]};
try{
 const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
 await worker.evaluate(()=>chrome.storage.sync.set({maxCards:1,ratings:false,economyVersion:2}));
 let htmlCalls=0,browserCalls=0,enrichCalls=0,scenario='included',browserFinished=false,parkingLookups=0;
 await browser.route('**/health',r=>r.fulfill({json:{ok:true}}));
 await browser.route('**/page-load',r=>r.fulfill({json:{ok:true}}));
 await browser.route('**/notes',r=>r.fulfill({json:{notes:[]}}));
 await browser.route('**/demo?*',r=>{
  let body=fs.readFileSync('extension/demo/booking-mock.html','utf8');
  body=body.replace(/(<span data-testid="address">)[^<]*/g,'$1Waterfront, Boston');
  if(scenario==='missing')body=body.replaceAll('Includes taxes and fees','Taxes unavailable');
  return r.fulfill({body,contentType:'text/html'});
 });
 await browser.route('https://www.booking.com/hotel/**',r=>{
  htmlCalls++;
  return r.fulfill({body:`<html><span class="hp_address_subtitle">670 Summer Street, Boston, MA 02210</span><script type="application/ld+json">{"@type":"Hotel","geo":{"latitude":42.3404878,"longitude":-71.0354559}}</script>${scenario==='fine-print'||scenario==='english-only'&&new URL(r.request().url()).pathname.endsWith('.en-gb.html')?'<div id="important_info">Parking is $10 per day and available only for in-house guests during their reservation.</div>':''}</html>`,contentType:'text/html'});
 });
 await browser.route('**/hotel-taxes',async r=>{
  browserCalls++;await new Promise(resolve=>setTimeout(resolve,800));browserFinished=true;
  if(scenario==='hydrated-parking'){const b=r.request().postDataJSON();await r.fulfill({json:{parking:globalThis.TrueTripHotelTaxes.parseParking('Parking is $10 per day and available only for in-house guests during their reservation.',b.hotel.url)}});}
  else await r.fulfill({json:{status:'ok',price:224,tax:34}});
 });
 await browser.route('**/enrich-one',async r=>{
  enrichCalls++;const b=r.request().postDataJSON();
  if(scenario==='english-only'||scenario==='hydrated-parking')assert.equal(htmlCalls,2,'paid lookup must wait for both Booking versions');
  assert.equal(b.hotel.address,'670 Summer Street, Boston, MA 02210');
  assert.deepEqual(b.hotel.location,{lat:42.3404878,lon:-71.0354559});
  if(scenario==='missing')assert.equal(browserFinished,false,'location should not wait for tax hydration');
  const result=await enrichHotels({...b,hotels:[b.hotel]},{geocode:async()=>({lat:42.36,lon:-71.06}),geocodeHotel:h=>geocodeHotel(h,{bias:{lat:42.36,lon:-71.06},resolveAddress:async()=>assert.fail('LLM address fallback must not run')}),driveRoute:async()=>({durationMin:11,distanceKm:6}),findParkingFee:async()=>{parkingLookups++;return {};},ratings:async()=>({})});
  assert.equal(result.hotels[0].location.provider,'page');
  await r.fulfill({json:{hotel:result.hotels[0]}});
 });
 await browser.route('**/reprice',async r=>{const b=r.request().postDataJSON();await r.fulfill({json:{hotel:repriceHotel(b.hotel,b.details,b.settings)}});});
 const page=await browser.newPage();
 for(const mode of ['included','missing','fine-print','english-only','hydrated-parking']){
  await worker.evaluate(parking=>chrome.storage.sync.set({parking}),mode==='fine-print'||mode==='english-only'||mode==='hydrated-parking');
  scenario=mode;htmlCalls=0;browserCalls=0;enrichCalls=0;browserFinished=false;parkingLookups=0;
  await page.goto('http://localhost:8787/demo?ss=Boston&checkin=2026-12-10&checkout=2026-12-11');
  await page.waitForFunction(()=>document.querySelectorAll('.tt-block[data-tt-state="complete"]').length===1);
  if(mode==='missing')await page.waitForFunction(()=>document.querySelector('[data-truetrip-tax-pending="0"]'));
  if(mode==='fine-print'||mode==='english-only'||mode==='hydrated-parking')await page.waitForFunction(()=>document.querySelector('.tt-block')?.textContent.includes('Parking: $10/night'));
  assert.equal(enrichCalls,1);assert.equal(htmlCalls,mode==='english-only'||mode==='hydrated-parking'?2:1);assert.equal(browserCalls,mode==='missing'||mode==='hydrated-parking'?1:0);
  if(mode==='fine-print'||mode==='english-only')assert.equal(parkingLookups,0);
  report.scenarios.push({mode,htmlCalls,browserCalls,enrichCalls,parkingLookups,locationProvider:'page',addressFallbackCalls:0});
 }
 report.passed=true;
}catch(e){report.passed=false;report.error=e.stack;process.exitCode=1;}
finally{console.log(report);fs.writeFileSync(`${dir}/booking-location-browser.json`,JSON.stringify(report,null,2));await browser.close();fs.rmSync(profile,{recursive:true,force:true});}
