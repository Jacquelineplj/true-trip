import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createLimiter} from '../providers/async.js';
import {makeCache} from '../providers/cache.js';
import {enrichHotels} from '../core/pipeline.js';
import {repriceHotel} from '../core/reprice.js';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('concurrent cache misses share one request, failures can retry',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'truetrip-cache-'));const c=makeCache('test',{dir});let calls=0;
 try{const query=()=>c.wrap('k',async()=>{calls++;await wait(5);return 25;});assert.deepEqual(await Promise.all([query(),query(),query()]),[25,25,25]);assert.equal(calls,1);
 await assert.rejects(c.wrap('bad',async()=>{throw new Error('failed');}));assert.equal(await c.wrap('bad',async()=>30),30);
 assert.equal(await c.wrap('none',async()=>null),null);assert.equal(await c.wrap('none',async()=>50),50);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('model scheduler permits parallel work and bounds the global concurrency',async()=>{
 const queue=createLimiter(2);let active=0,peak=0;
 await Promise.all(Array.from({length:6},()=>queue.run(async()=>{active++;peak=Math.max(peak,active);await wait(5);active--;})));
 assert.equal(peak,2);assert.equal(queue.stats().active,0);
});
test('short negative cache expiry does not shorten successful entries',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'truetrip-negative-'));const c=makeCache('test',{dir,ttlMs:86400000});
 try{c.set('missing',{fee:null},{ttlMs:1});c.set('ok',{fee:25});await wait(10);assert.equal(c.get('missing'),undefined);assert.deepEqual(c.get('ok'),{fee:25});}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('parking and rating searches start before geocoding finishes; late taxes only reprice',async()=>{
 let release;const geoGate=new Promise(resolve=>{release=resolve;});let parking=0,ratings=0;
 const point={lat:42,lon:-71};
 const input={context:{city:'Testville',nights:1},hotels:[{name:'Test Hotel',price:100,tax:null}],settings:{anchors:['Anchor'],timeValue:0,deepSearch:true}};
 const pending=enrichHotels(input,{geocodeCity:async()=>{await geoGate;return point;},geocode:async()=>point,geocodeHotel:async()=>point,driveRoute:async()=>({durationMin:5,distanceKm:1}),findParkingFee:async h=>{assert.equal(h.allowDeepSearch,true);parking++;return {claim:{parking_fee_per_night:20,parking_type:'self',currency:'USD',source_url:'https://example.com/p',source_quote:'Self parking $20 per night'}};},ratings:async()=>{ratings++;return {};}});
 await wait(0);assert.equal(parking,1);assert.equal(ratings,1);release();const result=await pending;
 assert.equal(result.hotels[0].cost.total,null);
 const priced=repriceHotel(result.hotels[0],{price:90,tax:15,taxEvidence:{tax:15}},result.settings);
 assert.equal(priced.cost.total.mid,125);assert.equal(parking,1);assert.equal(ratings,1);
});
