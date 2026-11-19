import fs from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.TRUETRIP_PLAYWRIGHT || 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.TRUETRIP_BROWSER?{executablePath:process.env.TRUETRIP_BROWSER}:{})});
try {
 const page=await browser.newPage();
 await page.setContent(fs.readFileSync('fixtures/booking-availability.html','utf8'));
 await page.evaluate(fs.readFileSync('extension/hotel-tax-reader.js','utf8'));
 const url='https://www.booking.com/hotel/us/example.html?checkin=2026-12-10&checkout=2026-12-11&group_adults=2&no_rooms=1';
 const result=await page.evaluate(url=>globalThis.TrueTripHotelTaxes.readCheapestRoom(document,url),url);
 assert.equal(result.blockId,'cheapest-rate');assert.equal(result.price,95);assert.equal(result.tax,11.12);assert.equal(result.accommodationTotal,106.12);
 const missing=await page.evaluate(()=>globalThis.TrueTripHotelTaxes.readCheapestRoom(document,'https://www.booking.com/hotel/us/example.html'));
 assert.equal(missing.status,'unknown');
 await page.evaluate(()=>document.querySelector('[data-block-id="cheapest-rate"] .hptr-taxinfo-block').textContent='Excluded: 14.75 % TAX, $4 City tax per night');
 const mixed=await page.evaluate(url=>globalThis.TrueTripHotelTaxes.readCheapestRoom(document,url),url);
 assert.equal(mixed.tax,18.01);
 console.log('PASS: cheapest available row, sold-out exclusion, percent/fixed taxes, missing-date fallback');
}finally{await browser.close();}
