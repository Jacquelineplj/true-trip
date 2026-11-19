import test from 'node:test';
import assert from 'node:assert/strict';
import {findParkingFee} from '../providers/parking-verified.js';
import {verifyParking} from '../core/verify.js';
const url='https://www.marriott.com/en-us/hotels/audit-hotel/overview/';
const hotel={name:'Audit Hotel',city:'Testville',parking_fee_per_night:20};
const opts={noCache:true,persistCache:false,sourceUrls:[url]};
const source=text=>({url,title:'Audit Hotel',text,method:'http',fetchedAt:new Date().toISOString(),contentHash:'test-document-hash'});
test('provider returns current source price, ignoring a supplied stale fee',async()=>{
 const r=await findParkingFee(hotel,{...opts,readSource:async()=>source('Audit Hotel\nParking\nSelf-parking $25 per day')});
 assert.equal(r.claim.parking_fee_per_night,25);assert.equal(r.requiresEvidence,true);
 assert.equal(verifyParking(r.claim,r.evidence).status,'ok');
});
test('provider never reuses a fee when current source is unavailable or belongs to another hotel',async()=>{
 const unavailable=await findParkingFee(hotel,{...opts,readSource:async()=>({url,error:'403 Forbidden'})});
 assert.equal(unavailable.claim,null);
 const sister=await findParkingFee(hotel,{...opts,readSource:async()=>({...source('Another Property\nParking\nSelf-parking $20 per day'),title:'Another Property'})});
 assert.equal(sister.claim,null);
});
test('OTA amenity terms exclude review prices and remain labeled as secondary evidence',async()=>{
 const ota='https://www.expedia.com/Audit-Hotel.h123.Hotel-Information';
 const r=await findParkingFee(hotel,{...opts,sourceUrls:[ota],readSource:async()=>({...source('Audit Hotel\nParking and transportation\nSelf parking on site (USD 30 per night)\nFood and drink\nReviews\nSelf-parking $10 per night'),url:ota})});
 assert.equal(r.claim.parking_fee_per_night,30);assert.equal(r.evidence.tier,'secondary');assert.equal(r.claim.confidence,'medium');
});
