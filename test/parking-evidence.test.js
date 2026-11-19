import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {extractParkingFromText as extract,htmlToText,matchesProperty} from '../core/parking-evidence.js';
import {verifyParking} from '../core/verify.js';
test('Omni: selects overnight self-parking and excludes restaurant/event rates',()=>{
 const result=extract('Parking\nOvernight Valet & Self-Park\nOvernight Valet | $70\nOvernight Self-Park | $60\nHourly Valet Parking Rates\n0-3 Hours | $30\nRestaurant and Spa Parking | Up to 4 hours\nValet | $24\nSelf-Park | $19\nEvent Parking Rates Up to 8 hours\nValet | $49\nSelf-Park | $32');
 assert.equal(result.status,'ok');assert.equal(result.fee,60);assert.equal(result.type,'self');
});
test('separate self/valet labels preserve daily units and ignore adjacent garage',()=>{
 assert.equal(extract('Parking\nSelf-parking\n$25.00 per day\nValet parking\nNot available').fee,25);
 const r=extract('Parking\nValet\nDaily: $70.00\nAdditional Parking Information\nOversized parking fee: $90.');
 assert.equal(r.fee,70);assert.equal(r.type,'valet');
 assert.equal(extract('Parking\nOur hotel offers valet parking for $70 per vehicle, per night. Self-parking is available in the adjacent garage for $60 per night.').fee,70);
});
test('contradictory current rates and unsupported quotes are not accepted',()=>{
 assert.equal(extract('Parking\nSelf-parking $20 per day\nSelf-parking $25 per day').status,'conflict');
 assert.equal(extract('Parking\nEvent Parking\nValet | $49').status,'unknown');
});
test('free/on-site and no parking are resolved separately from unknown off-site costs',()=>{
 assert.equal(extract('Private parking\nFree private parking is available on-site.').fee,0);
 assert.equal(extract('Parking\nFree public parking is available nearby.').status,'unknown');
 assert.equal(extract('Our property does not have on-site parking.').status,'none');
});
test('fetched evidence expires and unsupported source tiers cannot enter totals',()=>{
 const claim={parking_fee_per_night:25,parking_type:'self',currency:'USD',source_url:'https://www.hilton.com/property',source_quote:'Self-parking $25 per day',confidence:'high'};
 const evidence={status:'fetched',propertyMatched:true,tier:'primary',fetchedAt:new Date().toISOString()};
 assert.equal(verifyParking(claim,evidence).status,'ok');
 assert.equal(verifyParking(claim,{...evidence,fetchedAt:'2020-01-01'}).status,'unknown');
 assert.equal(verifyParking(claim,{...evidence,tier:'unknown'}).status,'unknown');
 assert.equal(verifyParking(claim,null).status,'unknown');
});
test('page text excludes scripts and identity rejects a sister hotel',()=>{
 const text=htmlToText('<h1>The Verb Hotel</h1><script>self-parking $1 per night</script><p>Valet parking $73 per night</p>');
 assert.ok(!text.includes('$1'));assert.equal(extract(text).fee,73);
 assert.equal(matchesProperty({name:'Hilton Garden Inn Boston Logan Airport'},{title:'Hilton Boston Logan Airport',text:'Hilton Boston Logan Airport'}),false);
});

test('daily self parking supports suffix USD without accepting a package rate',()=>{
 const r=extract('Holiday Inn Express\nParking details\nDaily parking fee only $20.00 per night with accommodations. Extended parking available only when booking Park and Fly Package.\nDaily self parking fee: 20 USD');
 assert.equal(r.status,'ok');assert.equal(r.fee,20);
 const claim={parking_fee_per_night:20,parking_type:'self',source_url:'https://www.ihg.com/hotel',source_quote:r.quote,currency:'USD'};
 assert.equal(verifyParking(claim).status,'ok');
});

test('option labels retain event and off-site parent restrictions',()=>{
 assert.equal(extract('Event parking\nValet parking $49 per day').status,'unknown');
 assert.equal(extract('Nearby parking\nSelf parking $20 per night').status,'unknown');
 assert.equal(extract('Event parking\nValet parking $49 per day\nOvernight parking\nSelf parking $60 per night').fee,60);
});
test('hotel identity retains downtown rather than accepting a sister property',()=>{
 assert.equal(matchesProperty({name:'DoubleTree by Hilton Hotel Boston - Downtown'},{title:'DoubleTree by Hilton Hotel Boston Bayside',text:'DoubleTree by Hilton Hotel Boston Bayside'}),false);
});
