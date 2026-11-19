// A bounded, invisible availability reader. Only complete tax results enter the success cache.
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import {createLimiter} from './async.js';
import {makeCache} from './cache.js';
const queue=createLimiter(2),pending=new Map();
const cache=makeCache('hotel-taxes-headless-v4',{ttlMs:5*60000});
const reader=fs.readFileSync(fileURLToPath(new URL('../extension/hotel-tax-reader.js',import.meta.url)),'utf8');
let browserPromise;
export const taxQueueStats=()=>({...queue.stats(),inFlight:pending.size});
async function browser(){
 if(!browserPromise)browserPromise=(async()=>{const {chromium}=await import(process.env.TRUETRIP_PLAYWRIGHT||'playwright');return chromium.launch({headless:true,...(process.env.TRUETRIP_BROWSER?{executablePath:process.env.TRUETRIP_BROWSER}:{channel:'chrome'})});})().catch(e=>{browserPromise=null;throw e;});
 return browserPromise;
}
export async function closeTaxBrowser(){const p=browserPromise;browserPromise=null;await (await p?.catch(()=>null))?.close().catch(()=>{});}
export function hotelTaxUrl(hotel,context={}){
 const url=new URL(hotel.url);
 if(url.protocol!=='https:'||!(url.hostname==='booking.com'||url.hostname.endsWith('.booking.com'))||!url.pathname.startsWith('/hotel/'))throw new Error('Unsupported hotel URL');
 for(const key of ['checkin','checkout'])if(context[key])url.searchParams.set(key,context[key]);
 url.searchParams.set('selected_currency','USD');url.searchParams.set('lang','en-us');url.searchParams.set('no_rooms','1');return url.href;
}
const unknown=reason=>({status:'unknown',tax:null,reason,method:'headless-browser'});
async function readOnce(url,{parkingOnly=false}={}){
 let session,timer,best=null,lastReason='Availability table not available';
 try{
  session=await (await browser()).newContext({locale:'en-US'});
  // Navigation retries and hydration share a total budget, so a blocked page cannot monopolize a slot.
  timer=setTimeout(()=>session.close().catch(()=>{}),25000);
  const page=await session.newPage();
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:12000});await page.waitForTimeout(1500);
  const expected=new URL(url);
  if(['checkin','checkout'].some(k=>new URL(page.url()).searchParams.get(k)!==expected.searchParams.get(k))){
   await page.goto(url,{waitUntil:'domcontentloaded',timeout:12000});await page.waitForTimeout(1500);
  }
  const started=Date.now();
  while(Date.now()-started<15000){
   try{
    await page.evaluate(reader);const r=await page.evaluate(()=>globalThis.TrueTripHotelTaxes.readCheapestRoom());
    if(parkingOnly&&r.parking?.claim)return {...r,method:'headless-browser'};
    if(r.address||r.location||r.parking)best={...best,...r,method:'headless-browser'};
    if(r.price!=null&&r.checkin===expected.searchParams.get('checkin')&&r.checkout===expected.searchParams.get('checkout')){
     best={...r,method:'headless-browser'};
     if(!parkingOnly&&r.status==='ok'&&Number.isFinite(r.tax))return best;
    }
    if(r.reason)lastReason=r.reason;
    if(/only .*supported/i.test(lastReason))break;
   }catch{/* A hydration redirect can temporarily destroy the execution context. */}
   await page.waitForTimeout(500);
  }
 }catch(e){lastReason=/timeout|closed/i.test(e.message)?'Hotel background page timed out or did not finish loading':'Hotel background page could not be read';}
 finally{clearTimeout(timer);await session?.close().catch(()=>{});}
 return best??unknown(lastReason);
}
export async function readHotelTaxes(hotel,context,options={}){
 const url=hotelTaxUrl(hotel,context),key=[url,!!options.parkingOnly],hit=cache.get(key);if(hit)return hit;
 if(pending.has(key.join()))return pending.get(key.join());
 const queuedAt=Date.now();
 const task=queue.run(async()=>{
  if(Date.now()-queuedAt>120000)return unknown('Background tax lookup queue timed out; retry this hotel');
  const result=await readOnce(url,options);
  if(options.parkingOnly?!!result.parking?.claim:result.status==='ok'&&Number.isFinite(result.price)&&Number.isFinite(result.tax))cache.set(key,result);
  return result;
 }).finally(()=>pending.delete(key.join()));pending.set(key.join(),task);return task;
}
