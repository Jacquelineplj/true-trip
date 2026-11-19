import test from 'node:test';
import assert from 'node:assert/strict';
import {findParkingFee} from '../providers/parking-search.js';
import {verifyParking} from '../core/verify.js';
const hotel={name:'Audit Hotel',city:'Testville'};
const claim={parking_fee_per_night:25,currency:'USD',parking_type:'self',source_url:'https://independent-hotel.example/parking',source_quote:'Self parking is $25 per night.',confidence:'medium'};
const response={text:JSON.stringify(claim),provider:'openai',model:'gpt-4o',webSearchCalls:1,sources:[{url:claim.source_url}],usage:{input_tokens:20,output_tokens:30}};
const opts={noCache:true,persistCache:false,recoverMissing:true,runLLM:async()=>response,readSource:async()=>{throw new Error('Local page reads must not run');}};
test('direct GPT search accepts a sourced result without a local page fetch or domain allowlist',async()=>{
 const r=await findParkingFee(hotel,opts);const v=verifyParking(r.claim,r.evidence);
 assert.equal(v.status,'ok');assert.equal(v.perNight,25);assert.equal(r.evidence.status,'searched');assert.equal(r.evidence.independentlyVerified,false);assert.equal(r.llm.model,'gpt-4o');assert.match(v.reason,/not independently verified/);
});
test('direct search distinguishes no on-site parking from free parking',async()=>{
 const r=await findParkingFee(hotel,{...opts,runLLM:async()=>({...response,text:JSON.stringify({...claim,parking_fee_per_night:null,parking_type:'none',source_quote:'No on-site parking'})})});
 assert.equal(verifyParking(r.claim,r.evidence).type,'none');assert.equal(verifyParking(r.claim,r.evidence).perNight,null);
});
test('direct search requires an actual search, valid output and fresh provenance',async()=>{
 for(const output of [{...response,webSearchCalls:0},{...response,text:'Not JSON'}])assert.equal((await findParkingFee(hotel,{...opts,runLLM:async()=>output})).claim,null);
 const r=await findParkingFee(hotel,opts);
 assert.equal(verifyParking(r.claim,{...r.evidence,searchedAt:'2020-01-01'}).status,'unknown');
});

test('direct search uses actual API citations when GPT returns a page title instead of a URL',async()=>{
 const r=await findParkingFee(hotel,{...opts,runLLM:async()=>({...response,text:JSON.stringify({...claim,source_url:'Hotel parking FAQ'}),citations:[{url:claim.source_url,title:'Hotel parking FAQ'}]})});
 assert.equal(r.claim.source_url,claim.source_url);assert.equal(verifyParking(r.claim,r.evidence).status,'ok');
});

test('search quotes cannot substitute a personal review or a non-hotel garage for an on-site fee',()=>{
 for(const [parking_type,source_quote] of [['valet','I strongly recommend their valet parking service for $59/day.'],['self','Self parking $60/night. This is not a hotel-operated garage.']]){
  const fee=parking_type==='valet'?59:60;
  assert.equal(verifyParking({...claim,parking_type,parking_fee_per_night:fee,source_quote}).status,'flagged');
 }
});
test('an off-site quote gets one focused recovery for the hotel-operated option',async()=>{
 let calls=0;const r=await findParkingFee({...hotel,url:'https://www.booking.com/hotel/us/audit.html?sid=not-needed'},{...opts,runLLM:async prompt=>{
  calls++;if(calls===1)return {...response,text:JSON.stringify({...claim,parking_fee_per_night:60,source_quote:'Self parking $60/night. This is not a hotel-operated garage.'})};
  assert.match(prompt,/hotel-operated valet/);assert.match(prompt,/booking.com\/hotel\/us\/audit.html/);assert.doesNotMatch(prompt,/sid=/);
  return {...response,text:JSON.stringify({...claim,parking_fee_per_night:70,parking_type:'valet',source_quote:'Overnight valet parking $70 per night'})};
 }});
 assert.equal(calls,2);assert.equal(verifyParking(r.claim,r.evidence).perNight,70);assert.equal(r.recovery.attempted,true);
});
test('unsuccessful parking recovery stops at two requests and preserves unknown',async()=>{
 let calls=0;const r=await findParkingFee(hotel,{...opts,runLLM:async()=>{calls++;return {...response,text:JSON.stringify({...claim,parking_fee_per_night:null,parking_type:'unknown',source_quote:null})};}});
 assert.equal(calls,2);assert.equal(verifyParking(r.claim,r.evidence).status,'unknown');assert.equal(r.recovery.attempted,true);
});

test('parking uses mini first and a dedicated mini query only when no numeric fee is usable',async()=>{
 const models=[];
 const r=await findParkingFee(hotel,{...opts,model:'gpt-4o-mini',runLLM:async(_prompt,options)=>{
  models.push(options.model);
  return {...response,model:options.model,text:JSON.stringify(models.length===1?{...claim,parking_fee_per_night:null,parking_type:'unknown'}:claim)};
 }});
 assert.deepEqual(models,['gpt-4o-mini','gpt-4o-mini']);
 assert.equal(verifyParking(r.claim,r.evidence).perNight,25);
 assert.equal(r.llm.model,'gpt-4o-mini');
 models.length=0;
 await findParkingFee(hotel,{...opts,model:'gpt-4o-mini',runLLM:async(_prompt,options)=>{models.push(options.model);return response;}});
 assert.deepEqual(models,['gpt-4o-mini']);
});

test('a mini no-parking answer gets a focused OTA check for hotel valet',async()=>{
 let calls=0;
 const r=await findParkingFee(hotel,{...opts,model:'gpt-4o-mini',runLLM:async(_prompt,options)=>{
  calls++;
  if(calls===1)return {...response,text:JSON.stringify({...claim,parking_type:'none',parking_fee_per_night:null,source_quote:'Adjacent public garage'})};
  assert.equal(options.model,'gpt-4o-mini');
  return {...response,text:JSON.stringify({...claim,parking_type:'valet'})};
 }});
 assert.equal(calls,2);
 assert.equal(verifyParking(r.claim,r.evidence).type,'valet');
});
