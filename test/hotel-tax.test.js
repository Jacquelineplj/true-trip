import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/hotel-tax-reader.js';
const {parseTaxes}=globalThis.TrueTripHotelTaxes;
test('screenshot: $85 room, 14.75% TAX plus $4 city tax per night',()=>{
 const r=parseTaxes('Excluded: 14.75 % TAX, $4 City tax per night',{price:85,nights:1});
 assert.equal(r.status,'ok');assert.equal(r.tax,16.54);assert.equal(Math.round((85+r.tax)*100)/100,101.54);
});
test('fixed nightly/person charges scale with stay; percentages use stay total',()=>{
 assert.equal(parseTaxes('Excluded: 10 % TAX, US$4 City tax per night',{price:300,nights:3}).tax,42);
 assert.equal(parseTaxes('Excluded: $2 city tax per person per night',{price:300,nights:3,adults:2}).tax,12);
});
test('included taxes are not added twice; unspecified and foreign charges stay unknown',()=>{
 assert.equal(parseTaxes('Includes taxes and fees',{price:85}).tax,0);
 for(const text of ['', 'Excluded: service charge', 'Excluded: €4 City tax', 'Excluded: 10% tax, resort fee may apply']) assert.equal(parseTaxes(text,{price:85}).tax,null,text);
});
const {readLocation,readCheapestRoom}=globalThis.TrueTripHotelTaxes;
const locationDoc=({address=null,coords=null,json=[]}={})=>({
 querySelector:s=>s==='.hp_address_subtitle'&&address?{textContent:address}:s.startsWith('#hotel_address ')&&coords?{getAttribute:()=>coords}:null,
 querySelectorAll:s=>s==='script[type="application/ld+json"]'?json.map(textContent=>({textContent})):[],
});
test('Booking address and hotel map coordinates are available even without room prices or dates',()=>{
 const doc=locationDoc({address:'670 Summer Street, Waterfront, Boston, MA 2210, United States – Great location – show map',coords:'42.3404878,-71.0354559'});
 const d=readCheapestRoom(doc,'https://www.booking.com/hotel/us/hampton.html');
 assert.equal(d.address,'670 Summer Street, Waterfront, Boston, MA 2210, United States');assert.equal(d.location.lat,42.3404878);assert.equal(d.tax,null);
});
test('Hotel JSON-LD accepts graph coordinates and ignores unrelated locations and malformed data',()=>{
 const doc=locationDoc({json:['broken',JSON.stringify({'@graph':[{'@type':'Restaurant',geo:{latitude:1,longitude:2}},{'@type':'Hotel',geo:{latitude:'42.34',longitude:'-71.03'},address:{streetAddress:'670 Summer Street',addressLocality:'Boston'}}]})]});
 assert.deepEqual(readLocation(doc),{address:'670 Summer Street, Boston',location:{lat:42.34,lon:-71.03}});
 assert.equal(readLocation(locationDoc({coords:',',json:[JSON.stringify({'@type':'Hotel',geo:{latitude:999,longitude:-71}})]})).location,null);
});
test('hotel-scoped microdata and map-marker links supply fallback coordinates',()=>{
 const micro={querySelector:s=>s.includes('[itemprop="geo"]')?{getAttribute:()=>s.includes('latitude')?'42.34':'-71.03'}:null,querySelectorAll:()=>[]};
 assert.deepEqual(readLocation(micro).location,{lat:42.34,lon:-71.03});
 for(const href of ['https://maps.google.com/?mlat=42.34&mlon=-71.03','https://maps.google.com/?query=42.34,-71.03']){
  const doc={querySelector:s=>s==='#showMap2[href], #hotel_address a[href*="maps"]'?{getAttribute:()=>href}:null,querySelectorAll:()=>[]};
  assert.deepEqual(readLocation(doc).location,{lat:42.34,lon:-71.03});
 }
});
test('hotel structured data resolves linked coordinates and address across graph nodes',()=>{
 const doc=locationDoc({json:[JSON.stringify({'@graph':[{'@type':'https://schema.org/Hotel',geo:{'@id':'#geo'},address:{'@id':'#address'}},{'@id':'#geo','@type':'GeoCoordinates',latitude:42.34,longitude:-71.03},{'@id':'#address',streetAddress:'670 Summer Street',addressLocality:'Boston'},{'@type':'Restaurant',geo:{latitude:1,longitude:2}}]})]});
 assert.deepEqual(readLocation(doc),{location:{lat:42.34,lon:-71.03},address:'670 Summer Street, Boston'});
});
