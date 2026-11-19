import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichHotels,formatBlock} from '../core/pipeline.js';
import {applyParkingAverage} from '../core/parking-estimate.js';
const providers={geocode:async()=>({lat:42,lon:-71}),geocodeHotel:async()=>({lat:42,lon:-71}),driveRoute:async()=>({distanceKm:1,durationMin:5}),
 findParkingFee:async h=>({claim:{currency:'USD',confidence:'high',source_url:'https://hotel.example/parking',...({
  Paid:{parking_fee_per_night:60,parking_type:'valet',source_quote:'Valet parking $60 per night'},
  Free:{parking_fee_per_night:0,parking_type:'free',source_quote:'Free parking'},
  None:{parking_fee_per_night:null,parking_type:'none',source_quote:'No on-site parking'},
  Unknown:{parking_fee_per_night:null,parking_type:'unknown',source_quote:null},
  Flagged:{parking_fee_per_night:500,parking_type:'valet',source_quote:'Valet parking $500 per night'},
 })[h.name]}})};
async function run(names=['Paid','Free','None','Unknown','Flagged'],mode='drive'){
 return enrichHotels({context:{city:'Testville',nights:2},hotels:names.map(name=>({id:name,name,price:{Paid:250,Free:310,None:230,Unknown:100,Flagged:110}[name],priceIncludesTaxes:true})),settings:{anchors:['Anchor'],timeValue:0,mode,budget:280,ratings:false}},providers);
}
test('no-parking hotels use an explicit $50/night fallback with correct totals and ranking',async()=>{
 const r=await run();const n=r.hotels.find(h=>h.id==='None');
 assert.deepEqual(r.parkingAverage,{perNight:null,sampleSize:0});
 assert.equal(n.parking.status,'estimated');assert.equal(n.parking.type,'none');assert.equal(n.parking.perNight,50);
 assert.equal(n.parking.estimate.method,'default-public-parking');assert.equal(n.parking.sourceUrl,null);
 assert.equal(n.costDrive.breakdown.parking,100);assert.equal(n.cost.total.mid,330);assert.equal(r.rankedByTrueCost[0],'Free');
 assert.ok(n.overLimit.some(x=>x.includes('$330')));assert.match(formatBlock(n,r.settings)[0],/default public-parking estimate.*not a quoted rate/);
 assert.equal(r.hotels.find(h=>h.id==='Unknown').cost.total,null);assert.equal(r.hotels.find(h=>h.id==='Flagged').parking.status,'flagged');
});
test('incremental hotel quotes never replace the $50 default with a comparison average',async()=>{
 const r=await run(['Paid','None']);const partial=r.hotels.find(h=>h.id==='None');assert.equal(partial.parking.perNight,50);
 const more=await run(['Free']);const updated=applyParkingAverage([...r.hotels,...more.hotels],r.settings);
 assert.equal(updated.hotels.find(h=>h.id==='None').parking.perNight,50);
 const removed=applyParkingAverage(updated.hotels.filter(h=>h.id==='None'),r.settings);
 assert.equal(removed.hotels[0].parking.status,'estimated');assert.equal(removed.hotels[0].cost.total.mid,330);
});
test('no other hotel quotes still allows the labeled default, and ride totals exclude parking',async()=>{
 const noQuotes=await run(['None','Unknown']);assert.equal(noQuotes.hotels[0].cost.total.mid,330);assert.equal(noQuotes.hotels[1].cost.total,null);
 const drive=await run(['Paid','Free','None']);const ride=await run(['Paid','Free','None'],'ride');
 const d=drive.hotels.find(h=>h.id==='None'),n=ride.hotels.find(h=>h.id==='None');
 assert.equal(n.cost.breakdown.parking,0);assert.deepEqual(n.cost,d.costRide);assert.equal(n.costDrive.breakdown.parking,100);
});
