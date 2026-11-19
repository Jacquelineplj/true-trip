import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {verifyPublicParking,parkingFromProvider} from '../core/public-parking.js';
import {createHotelResearch} from '../providers/hotel-research.js';
import {makeCache} from '../providers/cache.js';
import {realProviders} from '../providers/index.js';
import {enrichHotels,formatBlock} from '../core/pipeline.js';
import {applyParkingAverage} from '../core/parking-estimate.js';
import {repriceHotel} from '../core/reprice.js';

const claim={matched_name:'Audit Hotel',facility_name:'Central Public Garage',facility_address:'100 Main Street, Boston',distance_m:400,parking_fee_per_night:32,currency:'USD',rate_basis:'24h',source_url:'https://garage.example/rates',source_quote:'24 hours parking: $32 per day.',confidence:'high'};
const evidence={status:'searched',searchedAt:new Date().toISOString(),webSearchCalls:1,sources:[{url:claim.source_url}]};
const policy={claim:{matched_name:'Audit Hotel',parking_type:'none',parking_fee_per_night:null,source_url:'https://hotel.example/parking',source_quote:'No on-site parking',confidence:'high'}};
test('named, sourced nearby overnight public parking is separate from hotel parking',()=>{
 const p=parkingFromProvider({...policy,publicParking:{claim,evidence}});
 assert.equal(p.status,'ok');assert.equal(p.type,'public');assert.equal(p.scope,'off-site');assert.equal(p.perNight,32);
 assert.equal(p.facility.name,'Central Public Garage');assert.equal(p.onSitePolicy.sourceUrl,policy.claim.source_url);
 assert.equal(p.sourceUrl,claim.source_url);
});
test('unavailable, invalid and failed public searches use an explicit $50 estimate',()=>{
 for(const publicParking of [undefined,{claim:null,evidence},{error:'OpenAI API HTTP 429 (insufficient_quota)'},{claim:{...claim,parking_fee_per_night:null},evidence}]){
  const p=parkingFromProvider({...policy,publicParking});assert.equal(p.status,'estimated');assert.equal(p.perNight,50);
  assert.equal(p.sourceUrl,null);assert.equal(p.estimate.method,'default-public-parking');assert.match(p.reason,/No usable.*found.*default/);
 }
 assert.equal(parkingFromProvider({claim:{...policy.claim,parking_type:'unknown'}}).status,'unknown');
 assert.equal(parkingFromProvider({claim:{...policy.claim,source_url:null}}).status,'unknown');
});
test('public parking rejects unsupported hourly/event, distant, expired and uncited rates',()=>{
 for(const c of [{...claim,rate_basis:'hourly'},{...claim,source_quote:'Event parking $32 per day.'},{...claim,source_quote:'Overnight special $32: In After 4pm, Out Before 5am'},{...claim,distance_m:1500},{...claim,distance_m:null},{...claim,facility_name:null},{...claim,source_url:'https://not-cited.example/rates'},{...claim,source_quote:'24 hours parking $50 per day.'},{...claim,currency:'EUR'}])assert.equal(verifyPublicParking(c,evidence).status,'unknown');
 assert.equal(verifyPublicParking(claim,{...evidence,searchedAt:'2020-01-01'}).status,'unknown');
});
test('public parking and default estimates enter drive totals, survive notes/tax repricing, and remain out of ride totals',async()=>{
 for(const found of [false,true]){
  const point={lat:42,lon:-71};
  const r=await enrichHotels({context:{city:'Boston',nights:2},hotels:[{id:'audit',name:'Audit Hotel',price:100,tax:10}],settings:{anchors:['Anchor'],timeValue:0,ratings:false}},
   {geocode:async()=>point,geocodeHotel:async()=>point,driveRoute:async()=>({durationMin:5,distanceKm:1}),findParkingFee:async()=>({...policy,...(found?{publicParking:{claim,evidence}}:{})})});
  const h=r.hotels[0],fee=found?32:50;
  assert.equal(h.costDrive.breakdown.parking,fee*2);assert.equal(h.costDrive.total.mid,110+fee*2);assert.equal(h.costRide.breakdown.parking,0);
  const updated=applyParkingAverage(r.hotels,r.settings).hotels[0];assert.equal(updated.parking.perNight,fee);
  const priced=repriceHotel(updated,{price:90,tax:9},r.settings);assert.equal(priced.costDrive.total.mid,99+fee*2);
  assert.match(formatBlock(h,r.settings)[0],found?/nearby public parking/:/default public-parking estimate/);
 }
});
test('confirmed no-on-site policy goes directly to one cached mini public search',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'truetrip-public-'));const calls=[];
 try{
  const research=createHotelResearch({cache:makeCache('test',{dir}),run:async(prompt,opts)=>{
   const nearby=opts.usageContext.purpose==='hotel_public_parking';calls.push(opts.usageContext.purpose);
   if(nearby){assert.match(prompt,/1 km/);assert.match(prompt,/Do not supply a default price/);assert.equal(opts.maxToolCalls,1);assert.equal(opts.model,'gpt-4o-mini');}
   await new Promise(r=>setTimeout(r,5));
   return {text:JSON.stringify(nearby?claim:policy.claim),provider:'openai',model:opts.model,webSearchCalls:1,sources:[{url:nearby?claim.source_url:policy.claim.source_url}]};
  }});
  const p=await realProviders({research});const lookup=()=>p.findParkingFee({name:'Audit Hotel',city:'Boston',allowDeepSearch:true});
  const rows=await Promise.all([lookup(),lookup()]);assert.ok(rows.every(r=>parkingFromProvider(r).type==='public'));
  await lookup();assert.deepEqual(calls,['hotel_parking_address','hotel_public_parking']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('missing public quotes are cached briefly and produce a priced default without an OTA retry',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'truetrip-public-miss-'));const calls=[];
 try{
  const research=createHotelResearch({cache:makeCache('test',{dir}),run:async(_prompt,opts)=>{
   const nearby=opts.usageContext.purpose==='hotel_public_parking';calls.push(opts.usageContext.purpose);
   return {text:JSON.stringify(nearby?{matched_name:'Audit Hotel',parking_fee_per_night:null}:policy.claim),model:opts.model,provider:'openai',webSearchCalls:1,sources:[{url:policy.claim.source_url}]};
  }});
  const p=await realProviders({research});
  for(let i=0;i<2;i++){const r=await p.findParkingFee({name:'Audit Hotel',city:'Boston',allowDeepSearch:true});assert.equal(parkingFromProvider(r).perNight,50);}
  assert.deepEqual(calls,['hotel_parking_address','hotel_public_parking']);
  const cached=Object.values(JSON.parse(fs.readFileSync(path.join(dir,'test.json'))));
  assert.equal(cached.find(e=>e.k[0]==='public-parking-v1').ttlMs,30*60000);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Homestay ambiguous none answers use $50/night without claiming a verified no-parking policy',async()=>{
 const result={claim:{...policy.claim,source_quote:'Parking is subject to availability due to limited spaces.'}};
 const p=parkingFromProvider(result);
 assert.equal(p.status,'estimated');assert.equal(p.perNight,50);assert.equal(p.sourceUrl,null);
 assert.equal(p.onSitePolicy.quote,result.claim.source_quote);
 const point={lat:42,lon:-71};
 const r=await enrichHotels({context:{city:'Boston',nights:2},hotels:[{name:'Homestay',price:100,tax:10}],settings:{ratings:false,anchors:['Anchor'],timeValue:0}},
 {geocode:async()=>point,geocodeHotel:async()=>point,driveRoute:async()=>({durationMin:5,distanceKm:1}),findParkingFee:async()=>result});
 const h=r.hotels[0];assert.equal(h.costDrive.breakdown.parking,100);assert.equal(h.costRide.breakdown.parking,0);
 const legacy={...h,parking:{status:'unknown',type:'none',perNight:null,sourceUrl:result.claim.source_url,quote:result.claim.source_quote,reason:'hotel reports no on-site parking; off-site cost unknown'}};
 assert.equal(applyParkingAverage([legacy],r.settings).hotels[0].parking.perNight,50);
 assert.equal(repriceHotel(legacy,{price:90,tax:9},r.settings).costDrive.breakdown.parking,100);
});
