import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/tax-lookup.js';
const {resolve}=globalThis.TrueTripTaxLookup;
const first={ok:true,data:{html:'fixture',url:'https://www.booking.com/hotel/us/test.html'}};
const partial={status:'unknown',price:109,tax:null,reason:'Tax markup not hydrated'};
test('a price without taxes must continue to the browser reader',async()=>{
 let fallback=0;
 const r=await resolve({readHtml:async()=>first,parseHtml:()=>partial,readBrowser:async()=>{fallback++;return {ok:true,data:{status:'ok',price:109,tax:21.2}};}});
 assert.equal(fallback,1);assert.equal(r.data.tax,21.2);assert.equal(r.data.taxRecovery.attempted,true);
});
test('an explicit included-tax result does not trigger another lookup',async()=>{
 const r=await resolve({readHtml:async()=>first,parseHtml:()=>({status:'ok',price:109,tax:0,included:true}),readBrowser:async()=>{throw new Error('unnecessary lookup');}});
 assert.equal(r.data.tax,0);assert.equal(r.data.method,'background-http');
});
test('failed recovery retains the known price without turning missing tax into zero',async()=>{
 const r=await resolve({readHtml:async()=>first,parseHtml:()=>partial,readBrowser:async()=>({ok:false,error:'unavailable'})});
 assert.equal(r.data.price,109);assert.equal(r.data.tax,null);assert.equal(r.data.status,'unknown');assert.equal(r.data.taxRecovery.browserReason,'unavailable');
});
test('location is delivered before slower tax recovery and survives its failure',async()=>{
 const location={lat:42.34,lon:-71.03};let delivered=false;
 const r=await resolve({readHtml:async()=>first,parseHtml:()=>({...partial,address:'670 Summer Street',location}),onDetails:d=>{if(d?.location)delivered=true;},readBrowser:async()=>{assert.equal(delivered,true);return {ok:false,error:'blocked'};}});
 assert.equal(r.data.address,'670 Summer Street');assert.deepEqual(r.data.location,location);assert.equal(r.data.tax,null);
});
test('location-only lookup stops at the shared HTTP page without a tax/browser request',async()=>{
 const r=await resolve({needTaxes:false,readHtml:async()=>first,parseHtml:()=>({...partial,address:'670 Summer Street'}),readBrowser:async()=>assert.fail('extra browser request')});
 assert.equal(r.data.address,'670 Summer Street');assert.equal(r.data.method,'background-http');
});
test('parking waits for the second Booking version even when the first has complete taxes and coordinates',async()=>{
 const order=[],parking={claim:{parking_fee_per_night:10}};
 const r=await resolve({needTaxes:false,needParking:true,readHtml:async()=>{order.push('default');return first;},readAlternateHtml:async()=>{order.push('en-gb');return {...first,data:{...first.data,html:'english'}};},parseHtml:d=>d.html==='english'?{status:'unknown',tax:null,parking}:{status:'ok',price:109,tax:0,address:'800 Morrissey Blvd'},onParkingReady:d=>{order.push('ready');assert.equal(d.parking,parking);},readBrowser:async()=>assert.fail('no extra browser read')});
 assert.deepEqual(order,['default','en-gb','ready']);assert.equal(r.data.tax,0);assert.equal(r.data.price,109);assert.equal(r.data.parking,parking);
});
test('a direct parking rate in the first version stops before the second page',async()=>{
 const parking={claim:{parking_fee_per_night:0}};
 const r=await resolve({needTaxes:false,needParking:true,readHtml:async()=>first,readAlternateHtml:async()=>assert.fail('unnecessary second version'),parseHtml:()=>({parking}),readBrowser:async()=>assert.fail('unnecessary browser read')});
 assert.equal(r.data.parking,parking);
});
test('both failed direct versions release the model fallback without losing the tax recovery path',async()=>{
 const order=[];
 await resolve({needTaxes:true,needParking:true,readHtml:async()=>{order.push('default');throw new Error('blocked');},readAlternateHtml:async()=>{order.push('en-gb');return {ok:false,error:'blocked'};},parseHtml:()=>assert.fail('no page to parse'),onParkingReady:d=>{order.push('ready');assert.equal(d,null);},readBrowser:async()=>{order.push('tax-browser');return {ok:false,error:'unavailable'};}});
 assert.deepEqual(order,['default','en-gb','ready','tax-browser']);
});
test('an implausible first-page amount does not prevent checking the second version',async()=>{
 let second=0;
 const r=await resolve({needTaxes:false,needParking:true,readHtml:async()=>first,readAlternateHtml:async()=>{second++;return {...first,data:{...first.data,html:'english'}};},parseHtml:d=>({parking:{claim:{parking_fee_per_night:d.html==='english'?10:500}}}),readBrowser:async()=>assert.fail('rate already found')});
 assert.equal(second,1);assert.equal(r.data.parking.claim.parking_fee_per_night,10);
});
