import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichHotels, formatBlock } from '../core/pipeline.js';

// Fake providers: no network, no LLM. Hotel A near the anchor with paid parking; Hotel B far with free parking.
const places = {
  'Anchor X': { lat: 42.36, lon: -71.09, label: 'Anchor X' },
  'Hotel A': { lat: 42.361, lon: -71.091, label: 'Hotel A' },
  'Hotel B': { lat: 42.40, lon: -71.20, label: 'Hotel B' },
  'Hotel C': null,
};
const fake = {
  geocode: async (q) => places[q] ?? null,
  geocodeHotel: async (h) => places[h.name] ?? null,
  driveRoute: async (a, b) => {
    const far = Math.abs(a.lat - b.lat) > 0.01;
    return { distanceKm: far ? 12 : 1, durationMin: far ? 30 : 5, provider: 'fake', estimated: false };
  },
  findParkingFee: async (h) => ({
    'Hotel A': { claim: { parking_fee_per_night: 60, currency: 'USD', parking_type: 'valet', source_url: 'https://a.example/parking', source_quote: '$60 per night', confidence: 'high' }, provider: 'fake' },
    'Hotel B': { claim: { parking_fee_per_night: 0, currency: 'USD', parking_type: 'free', source_url: 'https://b.example/parking', source_quote: 'Free parking', confidence: 'high' }, provider: 'fake' },
    'Hotel C': { claim: { parking_fee_per_night: 0, currency: 'USD', parking_type: 'self', source_url: null }, provider: 'fake' },
  }[h.name]),
  ratings: async (h) => ({ google: { rating: 4.2, reviews: 100, source: 'fake' }, tripadvisor: null }),
};

test('pipeline enriches hotels, verifies parking, computes costs, finds notes', async () => {
  const res = await enrichHotels({
    context: { city: 'Testville', checkin: '2026-12-10', checkout: '2026-12-13' },
    hotels: [
      { id: 'a', name: 'Hotel A', price: 600, priceIncludesTaxes: true },
      { id: 'b', name: 'Hotel B', price: 640, priceIncludesTaxes: true },
      { id: 'c', name: 'Hotel C', price: 100, priceIncludesTaxes: true },
    ],
    settings: { anchors: ['Anchor X'], mode: 'drive', timeValue: 20, roundTripsPerDay: 1, maxCommuteMin: 20 },
  }, fake);

  assert.equal(res.context.nights, 3);
  assert.equal(res.anchors[0].label, 'Anchor X');
  const [A, B, C] = res.hotels;
  assert.equal(A.parking.status, 'ok');
  assert.equal(A.costDrive.total.mid, 600 + 180 + 0.5 * 20);         // 790: 6 legs x 5 min = 30 min
  assert.equal(B.parking.status, 'ok');
  assert.equal(B.costDrive.total.mid, 640 + 0 + 3 * 20);             // 700: 6 legs x 30 min = 3 h
  assert.equal(C.parking.status, 'unknown');                          // $0 without source is never accepted
  assert.equal(C.costDrive.total, null);
  assert.ok(C.warnings.includes('hotel location not found'));
  assert.deepEqual(B.overLimit, ['commute 30 min > 20 min limit']);
  assert.deepEqual(res.rankedByTrueCost, ['b', 'a', 'c']);           // unknown last
  const pr = res.notes.find((n) => n.type === 'price-reversal');
  assert.ok(pr, JSON.stringify(res.notes));
  assert.match(pr.text, /Hotel B costs \$40 more in room rate than Hotel A, but about \$90 less/);
  const block = formatBlock(A, res.settings);
  assert.match(block[0], /Parking: \$60\/night x 3 = \$180 \(valet; source: https:\/\/a.example\/parking\)/);
  assert.match(block[3], /True trip cost \(drive\): about \$790/);
});

test('pipeline in ride mode uses fare ranges', async () => {
  const res = await enrichHotels({
    context: { city: 'Testville', nights: 1 },
    hotels: [{ id: 'a', name: 'Hotel A', price: 200, priceIncludesTaxes: true }],
    settings: { anchors: ['Anchor X'], mode: 'ride', parking: false },
  }, fake);
  const A = res.hotels[0];
  assert.equal(A.parking.reason, 'not requested');
  assert.ok(A.costRide.total.low < A.costRide.total.high);
  assert.equal(A.costRide.breakdown.parking, 0);
});

test('pipeline keeps foreign currency and unsupported nightly prices incomplete',async()=>{
 for(const fields of [{currency:'EUR'},{priceWarning:'per-night price needs a stay total'}]){
 const res=await enrichHotels({context:{city:'Testville',nights:1},hotels:[{name:'Hotel A',price:200,priceIncludesTaxes:true,...fields}],settings:{anchors:['Anchor X']}},fake);
 assert.equal(res.hotels[0].cost.total,null);assert.ok(res.hotels[0].warnings.length);
 }
});

test('cheapest-room extracted taxes change final hotel ordering without double counting',async()=>{
 const providers={...fake,findParkingFee:async()=>({claim:{parking_fee_per_night:0,currency:'USD',parking_type:'free',source_url:'https://hotel.example/parking',source_quote:'Free parking'}})};
 const res=await enrichHotels({context:{city:'Testville',nights:1},hotels:[
  {id:'a',name:'Hotel A',price:85,tax:16.54,priceIncludesTaxes:false,taxEvidence:{source:'booking-availability',text:'Excluded: 14.75 % TAX, $4 City tax per night',tax:16.54}},
  {id:'b',name:'Hotel A',price:100,tax:0,priceIncludesTaxes:true}
 ],settings:{anchors:['Anchor X'],timeValue:0}},providers);
 assert.equal(res.hotels[0].cost.total.mid,101.54);
 assert.equal(res.hotels[1].cost.total.mid,100);
 assert.deepEqual(res.rankedByTrueCost,['b','a']);
 assert.equal(res.hotels[0].taxEvidence.tax,16.54);
});
