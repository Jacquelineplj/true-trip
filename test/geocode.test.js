import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesHotelLocation,geocode,geocodeAddress,geocodeHotel } from '../providers/geocode.js';
import {makeCache} from '../providers/cache.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('rejects unrelated hotels returned by real Boston searches',()=>{
 assert.equal(matchesHotelLocation({name:'Boston Lodge and Suites'},{label:'Homewood Suites by Hilton Boston / Andover, 4 Riverside Drive, Andover'}),false);
 assert.equal(matchesHotelLocation({name:'Bay Village Suites'},{label:'Embassy Suites by Hilton Boston Marlborough, 123 Boston Post Road West, Marlborough'}),false);
 assert.equal(matchesHotelLocation({name:'Charles River Inn'},{label:'Residence Inn by Marriott Boston Harbor on Tudor Wharf, 34-44 Charles River Avenue, Boston'}),false);
 assert.equal(matchesHotelLocation({name:'Hilton Boston Logan Airport'},{label:'Hilton Boston Logan Airport, One Hotel Drive, Boston'}),true);
});

test('a similarly named hotel in the same neighbourhood is not the requested hotel',()=>{
 assert.equal(matchesHotelLocation({name:'HI Boston Hostel'},{label:'HI Boston, 19 Stuart Street, Boston',kind:'hostel'}),true);
 assert.equal(matchesHotelLocation({name:'Hotel Ivy Boston Common'},{label:'Hotel AKA Boston Common, 90 Tremont Street, Boston'}),false);
 assert.equal(matchesHotelLocation({name:'Hotel Ivy Boston Common',address:'78 Charles St South'},{label:'Found Hotel Boston Common, 78 Charles Street South, Boston'},true),true);
});

const hampton={name:'Hampton by Hilton at the Boston Seaport District',address:'670 Summer Street, Boston, MA 02210',city:'Boston'};
const exact={lat:42.3404878,lon:-71.0354559,label:'670, Summer Street, South Boston, Boston, Massachusetts, 02210, United States',provider:'nominatim'};
test('Hampton branding variants match without accepting a Homewood sister property',()=>{
 assert.equal(matchesHotelLocation(hampton,{label:'Hampton Inn Boston Seaport District, Summer Street, Boston'}),true);
 assert.equal(matchesHotelLocation(hampton,{label:'Homewood Suites by Hilton Boston Seaport District, Summer Street, Boston'}),false);
 assert.equal(matchesHotelLocation(hampton,{label:'Summer Street, Boston'},true),false);
 assert.equal(matchesHotelLocation(hampton,{label:'1670 Summer Street, Boston'},true),false);
 assert.equal(matchesHotelLocation(hampton,exact,true),true);
});
test('street-only cached/Photon hits do not prevent trying Nominatim for the actual building',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'truetrip-geocode-'));const cacheStore=makeCache('test',{dir});
 try{
  const q=hampton.address,bias={lat:42.36,lon:-71.06},calls=[];
  const street={lat:42.3497722,lon:-71.0492587,label:'Summer Street, Boston, Massachusetts'};
  cacheStore.set(['address-v1','address',q,['42.36','-71.06']],street);
  const r=await geocode(q,{bias,kind:'address',cacheStore,accept:p=>matchesHotelLocation(hampton,p,true),lookupProviders:[async()=>{calls.push('photon');return street;},async()=>{calls.push('nominatim');return exact;}]});
  assert.equal(r.lat,exact.lat);assert.deepEqual(calls,['photon','nominatim']);
  assert.equal(cacheStore.get(['address-v1','address',q,['42.36','-71.06']]).label,exact.label);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('sourced addresses do not append Boston twice and enforce a building match',async()=>{
 const queries=[];
 const r=await geocodeAddress(hampton.address,{city:'Boston',lookup:async(q,opts)=>{queries.push(q);assert.equal(opts.kind,'address');assert.equal(opts.accept({label:'Summer Street, Boston'}),false);return exact;}});
 assert.equal(r,exact);assert.deepEqual(queries,[hampton.address]);
});
test('previously sourced Hampton coordinates are reused before any name/AI fallback',async()=>{
 const known={...exact,label:'Hampton Inn Boston Seaport District, 670 Summer Street, Boston',addressSource:'https://www.hilton.com/en/hotels/bosbahx-hampton-boston-seaport-district/'};
 let calls=0;
 const r=await geocodeHotel(hampton,{bias:{lat:42.36,lon:-71.06},resolvedAddressCache:{get:()=>known},resolveAddress:async()=>{calls++;throw new Error('Should not call research');}});
 assert.equal(r,known);assert.equal(calls,0);
});
test('Booking page coordinates bypass caches, geocoders and LLM address research',async()=>{
 const r=await geocodeHotel({...hampton,location:{lat:42.3404878,lon:-71.0354559}},{bias:{lat:42.36,lon:-71.06},resolvedAddressCache:{get:()=>assert.fail('page point should bypass cache')},resolveAddress:async()=>assert.fail('no LLM lookup needed')});
 assert.equal(r.provider,'page');assert.equal(r.lat,42.3404878);
});
test('Ramada street abbreviation and given-name expansion match while wrong buildings and directions fail',()=>{
 const hotel={name:'Ramada by Wyndham Boston',address:'800 Morrissey Blvd, Boston, MA 02122'};
 const point={label:'Ramada Inn, 800, William T. Morrissey Boulevard, Dorchester, Boston'};
 assert.equal(matchesHotelLocation(hotel,point,true),true);
 assert.equal(matchesHotelLocation(hotel,{label:'Ramada Inn, 800 Morrissey Boulevard, Boston'},true),true);
 assert.equal(matchesHotelLocation(hotel,{label:'Ramada Inn, 1800 William T. Morrissey Boulevard, Boston'},true),false);
 assert.equal(matchesHotelLocation(hotel,{label:'Ramada Inn, 800 North Morrissey Boulevard, Boston'},true),false);
 assert.equal(matchesHotelLocation(hotel,{label:'Ramada Inn, 800 William T. Main Boulevard, Boston'},true),false);
});
test('a valid legacy Ramada address cache entry avoids map and LLM requests',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'truetrip-ramada-'));const cacheStore=makeCache('test',{dir});
 try{
  const query='800 Morrissey Blvd, Boston, MA 02122',bias={lat:42.36,lon:-71.06};
  const point={lat:42.2950208,lon:-71.0465469,label:'Ramada Inn, 800 William T Morrissey Boulevard, Boston'};
  cacheStore.set(['v3',null,query,['42.36','-71.06']],point);
  const r=await geocodeAddress(query,{bias,lookup:(q,o)=>geocode(q,{...o,cacheStore,lookupProviders:[async()=>assert.fail('cached building should avoid map calls')]})});
  assert.equal(r.lat,point.lat);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('each provider response checks all candidates before paying for another lookup',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'truetrip-candidates-'));const cacheStore=makeCache('test',{dir});let calls=0;
 try{
  const result=await geocode(hampton.address,{kind:'address',bias:{lat:42.36,lon:-71.06},cacheStore,accept:p=>matchesHotelLocation(hampton,p,true),lookupProviders:[async()=>{calls++;return [{...exact,label:'Summer Street, Boston'},{...exact,lat:90,label:'670 Summer Street, Boston'},exact];},async()=>assert.fail('second provider unnecessary')]});
  assert.equal(result,exact);assert.equal(calls,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('address fallback removes neighbourhood noise, expands abbreviations, and keeps the building check',async()=>{
 const queries=[];
 const r=await geocodeAddress('670 Summer St, Waterfront, Boston, MA 02210, United States',{city:'Boston',lookup:async(q,o)=>{queries.push(q);assert.equal(o.accept({...exact,label:'1670 Summer Street, Boston'}),false);return q==='670 Summer Street, Boston'?exact:null;}});
 assert.equal(r,exact);assert.equal(queries.length,3);assert.match(queries[1],/Massachusetts/);assert.equal(queries[2],'670 Summer Street, Boston');
});
test('short hotel-name queries can recover a validated property without LLM research',async()=>{
 const queries=[];
 const h={name:'Audit Hotel by Wyndham',city:'Boston'};
 const result=await geocodeHotel(h,{resolvedAddressCache:{get:()=>null},lookup:async(q,o)=>{queries.push(q);const point={...exact,label:'Audit Hotel by Wyndham, Boston'};return q==='Audit Hotel, Boston'&&o.accept(point)?point:null;},resolveAddress:async()=>assert.fail('no LLM needed')});
 assert.equal(result.label,'Audit Hotel by Wyndham, Boston');assert.deepEqual(queries,['Audit Hotel by Wyndham, Boston','Audit Hotel, Boston']);
});
test('sourced fallback results are saved and reused before name/address or LLM lookups',async()=>{
 let saved,calls=0;const resolvedAddressCache={get:()=>saved,set:(_key,value)=>{saved=value;}};
 const options={bias:{lat:42.36,lon:-71.06},resolvedAddressCache,geocodeCache:{get:()=>null},lookup:async()=>null,addressLookup:async()=>null,resolveAddress:async()=>{calls++;return {...exact,label:'Hampton Inn Boston Seaport District, 670 Summer Street, Boston',addressSource:'https://hotel.example/address'};}};
 assert.ok(await geocodeHotel(hampton,options));assert.ok(await geocodeHotel(hampton,{...options,lookup:async()=>assert.fail('should use cache')}));assert.equal(calls,1);
});
test('negative geocodes are cached for only five minutes to avoid refresh retries',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'truetrip-negative-'));const cacheStore=makeCache('test',{dir});let calls=0;
 try{
  const options={kind:'hotel',cacheStore,lookupProviders:[async()=>{calls++;return [];} ]};
  assert.equal(await geocode('Missing Hotel',options),null);assert.equal(await geocode('Missing Hotel',options),null);assert.equal(calls,1);
  assert.equal(Object.values(JSON.parse(fs.readFileSync(cacheStore.file)))[0].ttlMs,5*60000);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
