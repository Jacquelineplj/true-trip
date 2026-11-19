import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {makeCache} from '../providers/cache.js';
import {createRatingsLookup,RATING_MISS_TTL,RATING_SUCCESS_TTL} from '../providers/ratings-lookup.js';
import {createHotelResearch} from '../providers/hotel-research.js';
const hotel={name:'Audit Garden Airport',city:'Testville',url:'https://www.booking.com/hotel/us/audit.html?sid=private'};
const travel='https://www.google.com/travel/hotels/entity/Audit';
const answer=(google=null,tripadvisor=null,researchedAt)=>({researchedAt,text:JSON.stringify({matched_name:hotel.name,confidence:'high',google:google==null?null:{rating:google,source_url:travel,source_quote:`Google reviews ${google}/5`},tripadvisor:tripadvisor==null?null:{rating:tripadvisor,source_url:travel,source_quote:`Tripadvisor reviews ${tripadvisor}/5`}}),sources:[{url:travel}],webSearchCalls:1,model:'gpt-4o-mini',provider:'openai'});
function setup(run){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'truetrip-ratings-'));
 let time=Date.parse('2026-11-18T18:00:00Z');const calls=[];
 const research=async(h,o)=>{calls.push(o);return run(o,time,calls.length);};
 const cache=makeCache('state',{dir});
 const options={research,cache,now:()=>time,record:null};
 return {dir,calls,options,lookup:createRatingsLookup(options),advance:n=>{time+=n;},close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('fresh combined misses are cached across refreshes; only missing platform retries after 30 minutes',async()=>{
 const f=setup((o,t)=>o.mode==='ratings'?answer(1,4.2,new Date(t).toISOString()):answer(4.4,null,new Date(t).toISOString()));
 try{
  assert.equal((await f.lookup(hotel)).google.rating,4.4);
  await f.lookup({...hotel,address:'123 Main St'});assert.equal(f.calls.length,1);
  f.advance(RATING_MISS_TTL-1);await f.lookup(hotel);assert.equal(f.calls.length,1);
  f.advance(1);const r=await f.lookup(hotel);
  assert.equal(f.calls.length,2);assert.equal(f.calls[1].mode,'ratings');assert.deepEqual(f.calls[1].ratingPlatforms,['tripadvisor']);
  assert.equal(r.google.rating,4.4);assert.equal(r.tripadvisor.rating,4.2);
  f.advance(RATING_MISS_TTL);await f.lookup(hotel);assert.equal(f.calls.length,2);
 }finally{f.close();}
});
test('old cached invalid Booking score immediately gets one ratings-only attempt, shared concurrently',async()=>{
 const f=setup((o,t)=>o.mode==='ratings'?answer(4.1,4,new Date(t).toISOString()):answer(8.2,null,new Date(t-RATING_MISS_TTL-1).toISOString()));
 try{
  const results=await Promise.all([f.lookup(hotel),f.lookup(hotel),f.lookup(hotel)]);
  assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1].ratingPlatforms,['google','tripadvisor']);
  assert.ok(results.every(r=>r.google.rating===4.1&&r.tripadvisor.rating===4));
 }finally{f.close();}
});
test('a repeated miss survives restart and never rereads combined parking data after cooldown',async()=>{
 const f=setup((o,t)=>answer(null,null,new Date(t).toISOString()));
 try{
  await f.lookup(hotel);f.advance(RATING_MISS_TTL);await f.lookup(hotel);assert.equal(f.calls.length,2);
  const restarted=createRatingsLookup({...f.options,cache:makeCache('state',{dir:f.dir})});
  await restarted(hotel);assert.equal(f.calls.length,2);
  f.advance(RATING_MISS_TTL);await restarted(hotel);
  assert.equal(f.calls.length,3);assert.equal(f.calls.filter(o=>o.includeRatings).length,1);
 }finally{f.close();}
});
test('recovery errors keep useful scores and apply the miss cooldown',async()=>{
 const f=setup((o,t)=>{if(o.mode==='ratings')throw new Error('HTTP 429');return answer(4.4,null,new Date(t).toISOString());});
 try{
  await f.lookup(hotel);f.advance(RATING_MISS_TTL);
  assert.equal((await f.lookup(hotel)).google.rating,4.4);
  assert.equal((await f.lookup(hotel)).google.rating,4.4);assert.equal(f.calls.length,2);
 }finally{f.close();}
});
test('successful rating TTL is seven days and cache hits do not extend score freshness',async()=>{
 const f=setup((o,t)=>answer(4.4,4.2,new Date(t).toISOString()));
 try{
  await f.lookup(hotel);f.advance(RATING_SUCCESS_TTL-1);await f.lookup(hotel);assert.equal(f.calls.length,1);
  f.advance(1);await f.lookup(hotel);assert.equal(f.calls.length,2);assert.equal(f.calls[1].mode,'ratings');assert.deepEqual(f.calls[1].ratingPlatforms,['google','tripadvisor']);
 }finally{f.close();}
});
test('dedicated research uses a distinct cache, one mini search and a ratings-only prompt',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'truetrip-raw-ratings-'));let calls=0;
 try{
  const cache=makeCache('raw',{dir});
  const research=createHotelResearch({cache,record:null,run:async(prompt,o)=>{
   calls++;
   if(o.usageContext.purpose==='hotel_ratings_recovery'){
    assert.match(prompt,/ONLY the missing tripadvisor/);assert.doesNotMatch(prompt,/sid=private|parking_fee_per_night/);
    assert.equal(o.model,'gpt-4o-mini');assert.equal(o.maxToolCalls,1);assert.equal(o.maxOutputTokens,700);
   }
   return answer(4.4,null,new Date().toISOString());
  }});
  await research(hotel,{includeRatings:true});
  await Promise.all([research(hotel,{mode:'ratings',ratingPlatforms:['tripadvisor']}),research(hotel,{mode:'ratings',ratingPlatforms:['tripadvisor']})]);
  assert.equal(calls,2);
  await research(hotel,{includeRatings:false});assert.equal(calls,2);
  const entry=Object.values(JSON.parse(fs.readFileSync(cache.file))).find(e=>e.k[0]==='ratings-recovery-v1');
  assert.equal(entry.ttlMs,RATING_MISS_TTL);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
