import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {makeCache} from '../providers/cache.js';
import {createHotelResearch} from '../providers/hotel-research.js';
import {realProviders} from '../providers/index.js';
import {findParkingFee} from '../providers/parking-search.js';
import {enrichHotels} from '../core/pipeline.js';
import {parkingFromProvider} from '../core/public-parking.js';
const hotel={name:'Audit Hotel',city:'Boston',url:'https://www.booking.com/hotel/us/audit.html?sid=private'};
const claim={matched_name:hotel.name,confidence:'high',parking_fee_per_night:25,currency:'USD',parking_type:'valet',source_url:'https://hotel.example/parking',source_quote:'Valet parking $25 per night',address:'123 Main Street',address_source_url:'https://hotel.example/contact',google:{rating:4.4,reviews:100,source_url:'https://www.google.com/travel/hotels/entity/audit',source_quote:'Google rating 4.4/5, 100 reviews'},tripadvisor:{rating:null}};
const response={text:JSON.stringify(claim),provider:'openai',model:'gpt-4o-mini',webSearchCalls:1,sources:[{url:claim.source_url},{url:claim.google.source_url}],usage:{input_tokens:9000,output_tokens:250}};
function fixture(run){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'truetrip-research-'));const cache=makeCache('research',{dir});return {dir,cache,research:createHotelResearch({cache,run})};}

test('parking and ratings share one full hotel search, retain sources and model budget',async()=>{
 let calls=0;
 const f=fixture(async(prompt,options)=>{calls++;assert.equal(options.maxToolCalls,1);assert.ok(options.maxOutputTokens<=1100);assert.ok(!prompt.includes('sid='));return response;});
 try{
  const p=await realProviders({ratingsCache:makeCache('ratings',{dir:f.dir}),research:f.research,ratingsFallback:'llm'});
  const h={...hotel,lookupRatings:true};
  const [parking,ratings]=await Promise.all([p.findParkingFee(h),p.ratings(h)]);
  assert.equal(calls,1);assert.equal(parking.claim.parking_fee_per_night,25);assert.equal(ratings.google.rating,4.4);
  assert.equal(parking.evidence.searchedAt,(await f.research(h,{includeRatings:true})).researchedAt);
  await p.findParkingFee({...hotel,lookupRatings:false});assert.equal(calls,1);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('repeated and concurrent missing results are cached; OTA retry is explicit',async()=>{
 let calls=0;const models=[];
 const f=fixture(async(_prompt,o)=>{calls++;models.push(o.model);return {...response,text:JSON.stringify({...claim,parking_fee_per_night:null,parking_type:'unknown',google:{rating:null}})};});
 try{
  const p=await realProviders({ratingsCache:makeCache('ratings',{dir:f.dir}),research:f.research});
  await Promise.all([p.findParkingFee(hotel),p.findParkingFee(hotel)]);
  await p.findParkingFee(hotel);assert.equal(calls,1);assert.deepEqual(models,['gpt-4o-mini']);
  const entry=Object.values(JSON.parse(fs.readFileSync(path.join(f.dir,'research.json'))))[0];assert.equal(entry.ttlMs,30*60000);
  await p.findParkingFee({...hotel,deepSearch:true});assert.deepEqual(models,['gpt-4o-mini','gpt-4o-mini']);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('authentication failures are briefly cached without fallback retries',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;throw new Error('OpenAI API HTTP 401 (invalid_api_key)');});
 try{const p=await realProviders({ratingsCache:makeCache('ratings',{dir:f.dir}),research:f.research});for(let i=0;i<3;i++)assert.match((await p.findParkingFee(hotel)).error,/401/);assert.equal(calls,1);}finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('default standalone parking never silently upgrades the model',async()=>{
 let calls=0;
 const r=await findParkingFee(hotel,{noCache:true,persistCache:false,runLLM:async()=>{calls++;return {...response,text:JSON.stringify({...claim,parking_fee_per_night:null})};}});
 assert.equal(calls,1);assert.equal(r.recovery,undefined);
});
test('Search deeper setting permits one fallback only for unresolved parking',async()=>{
 for(const enabled of [false,true]){
  const models=[];
  const f=fixture(async(_prompt,o)=>{models.push(o.model);const ota=o.usageContext.purpose==='hotel_parking_ota';return {...response,model:o.model,text:JSON.stringify({...claim,parking_fee_per_night:ota?25:null,parking_type:ota?'valet':'unknown'})};});
  try{
   const p=await realProviders({ratingsCache:makeCache('ratings',{dir:f.dir}),research:f.research});
   const result=await p.findParkingFee({...hotel,allowDeepSearch:enabled});
   assert.deepEqual(models,enabled?['gpt-4o-mini','gpt-4o-mini']:['gpt-4o-mini']);
   assert.equal(result.claim.parking_fee_per_night,enabled?25:null);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
 }
 const models=[];const f=fixture(async(_prompt,o)=>{models.push(o.model);return response;});
 try{const p=await realProviders({ratingsCache:makeCache('ratings',{dir:f.dir}),research:f.research});await p.findParkingFee({...hotel,allowDeepSearch:true});assert.deepEqual(models,['gpt-4o-mini']);}finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('known paid parking without an amount gets one parking-only retry even with Search deeper off',async()=>{
 const purposes=[];
 const f=fixture(async(_prompt,o)=>{const ota=o.usageContext.purpose==='hotel_parking_ota';purposes.push(o.usageContext.purpose);return {...response,text:JSON.stringify({...claim,parking_fee_per_night:ota?62:null,parking_type:'valet',source_quote:ota?'Valet parking $62 per night':'Valet parking is available for an additional fee'})};});
 try{
  const p=await realProviders({ratingsCache:makeCache('ratings',{dir:f.dir}),research:f.research});
  const r=await p.findParkingFee({...hotel,allowDeepSearch:false});
  assert.deepEqual(purposes,['hotel_parking_address','hotel_parking_ota']);
  assert.equal(r.claim.parking_fee_per_night,62);assert.equal(r.recovery.strategy,'dedicated-ota');
  await p.findParkingFee({...hotel,allowDeepSearch:false});assert.equal(purposes.length,2);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('a surcharge quote triggers the parking-only retry even when the model labels parking free',async()=>{
 const purposes=[];
 const f=fixture(async(_prompt,o)=>{const ota=o.usageContext.purpose==='hotel_parking_ota';purposes.push(o.usageContext.purpose);return {...response,text:JSON.stringify({...claim,parking_fee_per_night:ota?55:null,parking_type:ota?'valet':'free',source_quote:ota?'Valet parking $55 per night':'Parking is available for a surcharge.'})};});
 try{
  const p=await realProviders({ratingsCache:makeCache('ratings',{dir:f.dir}),research:f.research});
  const r=await p.findParkingFee({...hotel,allowDeepSearch:false});
  assert.deepEqual(purposes,['hotel_parking_address','hotel_parking_ota']);assert.equal(r.claim.parking_fee_per_night,55);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('an OTA nearby-parking price with a distance is used directly, without a garage search',async()=>{
 const purposes=[];
 const f=fixture(async(_prompt,o)=>{const p=o.usageContext.purpose;purposes.push(p);
  const ota=p==='hotel_parking_ota';
  return {...response,sources:[{url:'https://www.hotels.com/ho1/ivy/'},...response.sources],text:JSON.stringify({...claim,parking_fee_per_night:ota?26:null,parking_type:'valet',source_url:ota?'https://www.hotels.com/ho1/ivy/':claim.source_url,source_quote:ota?'Parking is available nearby and costs USD 26 per day (200 ft away; open 24 hours)':'Parking is available for a surcharge.'})};});
 try{
  const p=await realProviders({ratingsCache:makeCache('ratings',{dir:f.dir}),research:f.research});
  const card=parkingFromProvider(await p.findParkingFee({...hotel,allowDeepSearch:false}));
  assert.deepEqual(purposes,['hotel_parking_address','hotel_parking_ota']);
  assert.equal(card.status,'ok');assert.equal(card.type,'public');assert.equal(card.perNight,26);
  assert.equal(card.facility.distanceM,61);assert.equal(card.facility.rateBasis,'24h');assert.equal(card.facility.name,'Nearby parking listed on hotels.com');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('an OTA nearby-parking answer without a distance falls back to the named-garage search',async()=>{
 const purposes=[];
 const f=fixture(async(_prompt,o)=>{const p=o.usageContext.purpose;purposes.push(p);
  if(p==='hotel_public_parking')return {...response,text:JSON.stringify({matched_name:hotel.name,parking_fee_per_night:30,currency:'USD',rate_basis:'24h',facility_name:'Charles Garage',facility_address:'1 Charles St, Boston',distance_m:150,source_url:'https://garage.example/rates',source_quote:'Daily max $30 per 24 hours',confidence:'high'}),sources:[{url:'https://garage.example/rates'}]};
  return {...response,text:JSON.stringify({...claim,parking_fee_per_night:p==='hotel_parking_ota'?26:null,parking_type:'valet',source_quote:p==='hotel_parking_ota'?'Parking is available nearby and costs USD 26 per day':'Parking is available for a surcharge.'})};});
 try{
  const p=await realProviders({ratingsCache:makeCache('ratings',{dir:f.dir}),research:f.research});
  const card=parkingFromProvider(await p.findParkingFee({...hotel,allowDeepSearch:false}));
  assert.deepEqual(purposes,['hotel_parking_address','hotel_parking_ota','hotel_public_parking']);
  assert.equal(card.type,'public');assert.equal(card.perNight,30);assert.equal(card.facility.name,'Charles Garage');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
 const v=(await import('../core/verify.js')).verifyParking({parking_fee_per_night:26,currency:'USD',parking_type:'valet',source_url:'https://x.example',source_quote:'Parking is available nearby and costs USD 26 per day (200 ft away)'});
 assert.equal(v.status,'flagged');
});
test('dedicated OTA retry has an independent cache and shares concurrent retries',async()=>{
 const calls=[];
 const f=fixture(async(prompt,o)=>{
  const ota=o.usageContext.purpose==='hotel_parking_ota';calls.push({purpose:o.usageContext.purpose,model:o.model});
  if(ota){
   assert.match(prompt,/site:expedia\.com OR site:hotels\.com/);
   assert.doesNotMatch(prompt,/ratings|addresses|sid=private/);
   assert.equal(o.maxOutputTokens,700);assert.equal(o.maxToolCalls,1);
  }
  await new Promise(resolve=>setTimeout(resolve,5));
  return {...response,text:JSON.stringify({...claim,parking_fee_per_night:ota?25:null})};
 });
 try{
  const p=await realProviders({ratingsCache:makeCache('ratings',{dir:f.dir}),research:f.research});
  const look=()=>p.findParkingFee({...hotel,allowDeepSearch:true});
  const results=await Promise.all([look(),look(),look()]);
  assert.deepEqual(calls,[{purpose:'hotel_parking_address',model:'gpt-4o-mini'},{purpose:'hotel_parking_ota',model:'gpt-4o-mini'}]);
  assert.ok(results.every(r=>r.claim.parking_fee_per_night===25&&r.recovery.strategy==='dedicated-ota'));
  await look();assert.equal(calls.length,2);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('OTA accepts its parking-only schema but rejects an explicitly mismatched hotel name',async()=>{
 for(const mismatched of [false,true]){
  const parking={...claim};delete parking.matched_name;
  if(mismatched)parking.matched_name='Unrelated Resort Miami';
  const f=fixture(async()=>({...response,text:JSON.stringify(parking)}));
  try{
   const p=await realProviders({ratingsCache:makeCache('ratings',{dir:f.dir}),research:f.research});const result=await p.findParkingFee({...hotel,deepSearch:true});
   if(mismatched)assert.match(result.error,/identity/);else assert.equal(result.claim.parking_fee_per_night,25);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
 }
});
test('explicit free parking with a missing amount yields a complete trip cost and avoids an OTA retry',async()=>{
 let calls=0;
 const f=fixture(async()=>{calls++;return {...response,text:JSON.stringify({...claim,parking_type:'free',parking_fee_per_night:null,source_quote:'Free parking'})};});
 try{
  const p=await realProviders({ratingsCache:makeCache('ratings',{dir:f.dir}),research:f.research});const point={lat:42,lon:-71};
  const r=await enrichHotels({context:{city:'Boston',nights:1},hotels:[{...hotel,price:100,tax:10}],settings:{anchors:['Anchor'],timeValue:0,ratings:false,deepSearch:true}},
   {...p,geocodeCity:async()=>point,geocodeAnchor:async()=>point,geocodeHotel:async()=>point,driveRoute:async()=>({durationMin:5,distanceKm:1})});
  assert.equal(calls,1);assert.equal(r.hotels[0].parking.status,'ok');assert.equal(r.hotels[0].parking.perNight,0);
  assert.equal(r.hotels[0].parking.normalizedFreeParking,true);assert.equal(r.hotels[0].costDrive.total.mid,110);
  assert.ok(!r.hotels[0].costDrive.unknowns.includes('parking fee'));
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('existing extension defaults migrate once while custom limits survive',async()=>{
 const source=fs.readFileSync(new URL('../extension/economy-settings.js',import.meta.url),'utf8');
 for(const [limit,expected] of [[12,5],[3,5],[7,7]]){
  let stored={maxCards:limit,ratings:true};
  const context={chrome:{storage:{sync:{get:async defaults=>({...defaults,...stored}),set:async changes=>Object.assign(stored,changes)}}}};
  vm.runInNewContext(source,context);
  const first=await context.TrueTripEconomySettings({maxCards:5,ratings:false});assert.equal(first.maxCards,expected);assert.equal(first.ratings,false);
  stored.ratings=true;
  assert.equal((await context.TrueTripEconomySettings({})).ratings,true);
 }
});
test('five-hotel update migrates the previous three-hotel default without resetting ratings',async()=>{
 let stored={maxCards:3,ratings:true,economyVersion:1};
 const context={chrome:{storage:{sync:{get:async defaults=>({...defaults,...stored}),set:async changes=>Object.assign(stored,changes)}}}};
 vm.runInNewContext(fs.readFileSync(new URL('../extension/economy-settings.js',import.meta.url),'utf8'),context);
 const s=await context.TrueTripEconomySettings({maxCards:5,ratings:false});
 assert.equal(s.maxCards,5);assert.equal(s.ratings,true);assert.equal(s.economyVersion,2);
});
test('a rating-rich cached answer with no parking price does not hide a valid parking-only answer',async()=>{
 const f=fixture(async()=>assert.fail('cached parking must not trigger another API call'));
 try{
  const property={name:hotel.name,city:hotel.city,booking_url:'https://www.booking.com/hotel/us/audit.html'};
  const useful={...response,researchedAt:new Date().toISOString()};
  f.cache.set(['openai','gpt-4o-mini',property,false],useful);
  f.cache.set(['openai','gpt-4o-mini',property,true],{...useful,text:JSON.stringify({...claim,parking_fee_per_night:null})});
  const p=await realProviders({research:f.research,ratingsCache:makeCache('ratings',{dir:f.dir})});
  assert.equal((await p.findParkingFee(hotel)).claim.parking_fee_per_night,25);
  assert.equal((await p.findParkingFee({...hotel,lookupRatings:true})).claim.parking_fee_per_night,25);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
