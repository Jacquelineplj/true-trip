// Two read-only live Booking page variants, no LLM/API calls.
import fs from 'node:fs';import {chromium} from 'playwright';
const reader=fs.readFileSync('extension/hotel-tax-reader.js','utf8');
const browser=await chromium.launch({headless:true,executablePath:process.env.TRUETRIP_BROWSER||chromium.executablePath()});
const report={method:'Live browser page reads; no model calls',at:new Date().toISOString(),variants:[]};
try{
 for(const path of ['r-boston-massachusettes.html','r-boston-massachusettes.en-gb.html']){
  const page=await browser.newPage({locale:'en-US'});const row={path};
  try{
   const url=`https://www.booking.com/hotel/us/${path}?checkin=2026-11-19&checkout=2026-11-20&group_adults=2&no_rooms=1&selected_currency=USD&lang=en-us`;
   const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});row.httpStatus=response?.status();
   await page.waitForSelector('#important_info, #fine_print, #hotelFacilitiesInc',{timeout:6000}).catch(()=>{});
   await page.evaluate(reader);const details=await page.evaluate(()=>globalThis.TrueTripHotelTaxes.readCheapestRoom());
   row.parking=details.parking;row.title=await page.title();row.reason=details.parking?null:'Parking policy markup not available (possible bot challenge or page layout)';
  }catch(e){row.error=e.message;}
  report.variants.push(row);console.log(JSON.stringify(row));await page.close();
 }
}finally{await browser.close();fs.mkdirSync('out/validation',{recursive:true});fs.writeFileSync('out/validation/ramada-booking-page-live.json',JSON.stringify(report,null,2));}
