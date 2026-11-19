import test from 'node:test';import assert from 'node:assert/strict';
import '../extension/hotel-tax-reader.js';
import {bookingParkingResult} from '../core/booking-parking.js';
import {parkingFromProvider} from '../core/public-parking.js';
import {enrichHotels} from '../core/pipeline.js';
import {repriceHotel} from '../core/reprice.js';
const {parseParking,readParking}=globalThis.TrueTripHotelTaxes;
const url='https://www.booking.com/hotel/us/r-boston-massachusettes.html';
const ramada='Parking is $10 per day and available only for in-house guests during their reservation.';
test('fine-print parser handles Ramada and daily, nightly, decimal, valet and free variants',()=>{
 for(const [text,fee,type] of [[ramada,10,'self'],['Private parking is available on site (reservation is not needed) and costs US$10 per day.',10,'self'],['Self parking costs USD 12.50 per night.',12.5,'self'],['Overnight valet parking is $72 per vehicle, per night.',72,'valet'],['Free private parking is available on site.',0,'free'],['Parking costs $25/day.',25,'self']]){
  const p=parseParking(text,url);assert.equal(p?.claim.parking_fee_per_night,fee,text);assert.equal(p.claim.parking_type,type);assert.equal(parkingFromProvider(bookingParkingResult(p,url)).status,'ok');
 }
});
test('parking extraction excludes shuttle, deposit, hourly, nearby and event amounts',()=>{
 for(const text of ['The airport shuttle service is $10 per person.','Parking is available. Deposit is $100.','Parking is $10 per hour.','Nearby public parking is $30 per day.','Event parking is $20 per day.','Parking package is $40 per night.','Parking costs CA$10 per day.','No free parking is available.'])assert.equal(parseParking(text,url),null,text);
 const d=parseParking(`The airport shuttle is $10 per person. Parking is $12.50 per day. A deposit of $100 is required.`,url);assert.equal(d.claim.parking_fee_per_night,12.5);
});
test('only policy/facility sections are scanned, including a price available only in fine print',()=>{
 const d=readParking({querySelectorAll:s=>s==='#important_info'?[{textContent:ramada}]:[]},url);assert.equal(d.claim.parking_fee_per_night,10);assert.equal(d.section,'#important_info');
});
test('Booking evidence must be current and refer to the same property, including localized URLs',()=>{
 const d=parseParking(ramada,url.replace('.html','.en-gb.html'));assert.ok(bookingParkingResult(d,url));
 assert.equal(bookingParkingResult(d,url.replace('r-boston-massachusettes','another')),null);
 assert.equal(bookingParkingResult({...d,fetchedAt:'2020-01-01'},url),null);
 assert.equal(bookingParkingResult({...d,sourceUrl:'https://booking.com.evil.example/hotel/us/r-boston-massachusettes.html'},url),null);
});
test('direct Booking quote avoids model parking lookup and updates totals after late page hydration',async()=>{
 const bookingParking=parseParking(ramada,url),point={lat:42.295,lon:-71.04};let modelCalls=0;
 const result=await enrichHotels({context:{city:'Boston',nights:2},hotels:[{name:'Ramada by Wyndham Boston',url,bookingParking,price:100,tax:10}],settings:{ratings:false,anchors:['Anchor'],timeValue:0}},
 {geocode:async()=>point,geocodeHotel:async()=>point,driveRoute:async()=>({durationMin:5,distanceKm:1}),findParkingFee:async()=>{modelCalls++;return {};}});
 const h=result.hotels[0];assert.equal(modelCalls,0);assert.equal(h.parking.perNight,10);assert.equal(h.parking.typeUnspecified,true);assert.equal(h.costDrive.breakdown.parking,20);assert.equal(h.costRide.breakdown.parking,0);
 const updated=repriceHotel({...h,parking:{status:'unknown'}},{bookingParking},result.settings);assert.equal(updated.parking.perNight,10);assert.equal(updated.costDrive.breakdown.parking,20);
});
test('real Booking concatenated paragraph text keeps parking separate from shuttle and deposit',()=>{
 const raw='Contact hotel after booking for more details.Please note, guests must be 21 years or older to check-in at this property.Parking is $10 per day and available only for in-house guests during their reservation.The airport, cruise port, and BCEC shuttle service is $10 per person.A deposit of $100 is required.';
 const p=parseParking(raw,url);assert.equal(p.claim.source_quote,ramada);assert.equal(p.claim.parking_fee_per_night,10);
});
