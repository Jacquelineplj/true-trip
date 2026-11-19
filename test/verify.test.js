import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyParking, checkDoubleCounting } from '../core/verify.js';
import { tripCost } from '../core/cost.js';

test('verifyParking accepts a sourced fee', () => {
  const r = verifyParking({ parking_fee_per_night: 75, currency: 'USD', parking_type: 'valet', source_url: 'https://www.marriott.com/x', source_quote: '$75 per night', confidence: 'high' });
  assert.equal(r.status, 'ok');
  assert.equal(r.perNight, 75);
});

test('verifyParking never yields $0 without a source and a free statement', () => {
  assert.equal(verifyParking({ parking_fee_per_night: 0, parking_type: 'self', source_url: 'https://x.com' }).status, 'unknown');
  assert.equal(verifyParking({ parking_fee_per_night: 0, parking_type: 'free', source_url: null }).status, 'unknown');
  assert.equal(verifyParking({ parking_fee_per_night: 0, parking_type: 'free', source_url: 'https://x.com', source_quote: 'Free self parking' }).status, 'ok');
  assert.equal(verifyParking(null).status, 'unknown');
  assert.equal(verifyParking({ parking_fee_per_night: 40, parking_type: 'self', source_url: 'not a url' }).status, 'unknown');
});

test('verifyParking flags implausible fees', () => {
  assert.equal(verifyParking({ parking_fee_per_night: 900, parking_type: 'valet', source_url: 'https://x.com' }).status, 'flagged');
});

test('explicit free-parking evidence repairs self/unknown type and a missing or zero amount',()=>{
 const base={currency:'USD',source_url:'https://hotel.example/parking',confidence:'high'};
 for(const [parking_type,parking_fee_per_night,source_quote] of [
  ['self',0,'Self parking is free at this property.'],
  ['free',null,'With plenty of free parking, comfortable rooms, and sweet treats in the lobby, we make it easy to enjoy Boston.'],
  ['free',null,'Free parking'],
  ['unknown',null,'Complimentary self-parking is available for hotel guests.'],
 ]){
  const r=verifyParking({...base,parking_type,parking_fee_per_night,source_quote});
  assert.equal(r.status,'ok');assert.equal(r.perNight,0);assert.equal(r.type,'free');assert.equal(r.normalizedFreeParking,true);
 }
});

test('free-field repair preserves evidence freshness and rejects paid, conditional, off-site or negated quotes',()=>{
 const base={parking_type:'free',parking_fee_per_night:null,source_url:'https://hotel.example/parking',confidence:'high'};
 for(const source_quote of ['Free WiFi. Parking available.','No free parking is available.','Free parking is not available.','Free parking nearby.','Free parking for the first 2 hours.','Complimentary parking with a parking package.','Free self parking for elite members only.','Free valet parking when dining at our restaurant.','Self parking is free, valet parking is $50 per night.']){
  assert.notEqual(verifyParking({...base,source_quote}).status,'ok',source_quote);
 }
 const valid={...base,source_quote:'Free parking'};
 assert.notEqual(verifyParking({...valid,source_url:null}).status,'ok');
 assert.notEqual(verifyParking(valid,{status:'searched',webSearchCalls:1,searchedAt:'2020-01-01'}).status,'ok');
 assert.notEqual(verifyParking({...valid,confidence:'low'}).status,'ok');
 assert.equal(verifyParking({...valid,parking_type:'none'}).type,'none');
 assert.notEqual(verifyParking({...valid,parking_fee_per_night:50}).status,'ok');
});

test('checkDoubleCounting', () => {
  const drive = tripCost({ room: 100, nights: 1, parkingPerNight: 10, legs: [{ durationMin: 10, fare: { low: 5, high: 9 } }] }, { mode: 'drive' });
  assert.deepEqual(checkDoubleCounting(drive), []);
  const ride = tripCost({ room: 100, nights: 1, parkingPerNight: 10, legs: [{ durationMin: 10, fare: { low: 5, high: 9 } }] }, { mode: 'ride' });
  assert.deepEqual(checkDoubleCounting(ride), []);
  assert.deepEqual(checkDoubleCounting({ ...drive, breakdown: { ...drive.breakdown, tax: 12 } }, { priceIncludesTaxes: true }), ['tax added although page price includes taxes']);
});

test('unsupported and low-confidence fees never enter complete totals',()=>{
 const claim={parking_fee_per_night:49,currency:'USD',parking_type:'self',source_url:'https://hotel.example/policies'};
 assert.equal(verifyParking({...claim,source_quote:null}).status,'flagged');
 assert.equal(verifyParking({...claim,source_quote:'Overnight Self-Park | $60'}).status,'flagged');
 assert.equal(verifyParking({...claim,source_quote:'Overnight Self-Park | $49',confidence:'low'}).status,'flagged');
 assert.equal(verifyParking({...claim,parking_fee_per_night:0,parking_type:'free',source_quote:'Free WiFi'}).status,'unknown');
});
