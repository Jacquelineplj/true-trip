import test from 'node:test';
import assert from 'node:assert/strict';
import {readParkingSource} from '../providers/parking-source-reader.js';
const url='https://www.marriott.com/en-us/hotels/test/overview/';
const read=html=>readParkingSource(url,{browser:false,fetchImpl:async()=>({ok:true,url,text:async()=>html})});
test('reader records fetched text and excludes privacy and duplicate-anchor distractions',async()=>{
 const p=await read('<title>Audit Hotel</title><h1>Audit Hotel</h1><p>Valet parking $70 per night</p><a href="/privacy-policy">Privacy policy</a><a href="/parking">Parking</a>');
 assert.equal(p.method,'http');assert.match(p.contentHash,/^[a-f0-9]{64}$/);assert.equal(p.links.length,1);assert.ok(p.links[0].url.endsWith('/parking'));
});
test('reader rejects access challenges even when the HTTP status is 200',async()=>{
 for(const body of ['<title>Bot or Not?</title>Show us your human side...', '<title>Hilton</title>Hilton Page Reference Code: 123','Access Denied']){
  assert.equal((await read(body)).error,'source unavailable over HTTP');
 }
});
