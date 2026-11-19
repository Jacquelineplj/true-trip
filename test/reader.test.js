import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/reader.js';
import { tripCost } from '../core/cost.js';
const {readCard,money}=globalThis.TrueTripReader;
const card=(fields)=>({querySelector:(selector)=>{const key=selector.match(/data-testid="([^"]+)/)?.[1];return fields[key] == null ? null : {textContent:fields[key],href:fields[key]};}});
test('live-card reader takes discounted current price rather than crossed-out original',()=>{
 const h=readCard(card({title:'Real Hotel','price-and-discounted-price':'US$300 US$240','taxes-and-charges':'+ US$36 taxes and charges','review-score':'Scored 8.7 8.7 Excellent 2,575 reviews','title-link':'https://www.booking.com/hotel/us/example.html'}),0);
 assert.equal(h.price,240);assert.equal(h.tax,36);assert.equal(h.bookingScore,8.7);assert.equal(h.bookingReviews,2575);
});
test('missing taxes stay unknown through the cost calculation',()=>{
 const h=readCard(card({title:'Hotel','price-and-discounted-price':'$200'}),0);
 assert.equal(h.tax,null);
 const cost=tripCost({room:h.price,tax:h.tax,nights:1,parkingPerNight:20,legs:[{durationMin:5}]});
 assert.equal(cost.total,null);assert.ok(cost.unknowns.includes('taxes and fees'));
});
test('reader recognizes included taxes and does not guess prices from unrelated card text',()=>{
 assert.equal(readCard(card({'taxes-and-charges':'Includes taxes and fees'}),0).tax,0);
 assert.equal(readCard(card({title:'Hotel $50 credit'}),0).price,null);
 assert.equal(money('€120').currency,'EUR');
});
