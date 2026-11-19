import test from 'node:test';
import assert from 'node:assert/strict';
import {llmRatings} from '../providers/ratings-llm.js';
const hotel={name:'Audit Garden Airport',city:'Testville'};
const call=async j=>llmRatings(hotel,{noCache:true,persistCache:false,runLLM:async()=>({text:JSON.stringify(j),provider:'openai',model:'gpt-5.4-mini',usage:{input_tokens:10},webSearchCalls:1,sources:[{url:j.google?.url}]})});
const base={matched_name:hotel.name,confidence:'high',google:{rating:4.3,reviews:120,url:'https://www.google.com/maps/place/Audit-Garden-Airport'},tripadvisor:null};
test('searched ratings retain the unverified label and API model metadata',async()=>{
 const r=await call(base);assert.equal(r.google.rating,4.3);assert.equal(r.google.source,'llm-search (unverified)');assert.equal(r.llm.provider,'openai');
});
test('ratings reject different properties, impossible scores and non-platform URLs',async()=>{
 assert.ok((await call({...base,matched_name:'Other Property'})).error);
 for(const google of [{...base.google,rating:9},{...base.google,rating:null},{...base.google,url:'javascript:alert(1)'},{...base.google,url:'https://google.com.evil.test/'}]){
  assert.ok((await call({...base,google})).error);
 }
});
test('failed ratings lookup can recover on the next request instead of caching the error',async()=>{
 let count=0;const opts={persistCache:false,noCache:true,runLLM:async()=>{if(++count===1)throw new Error('quota unavailable');return {text:JSON.stringify(base),provider:'openai',sources:[{url:base.google.url}]};}};
 assert.ok((await llmRatings(hotel,opts)).error);assert.equal((await llmRatings(hotel,opts)).google.rating,4.3);
});

test('opaque Google entities and uncited platform links cannot become hotel ratings',async()=>{
 assert.ok((await call({...base,google:{...base.google,url:'https://www.google.com/travel/hotels/entity/opaque-id'}})).error);
 const r=await llmRatings(hotel,{noCache:true,persistCache:false,runLLM:async()=>({text:JSON.stringify(base),sources:[]})});
 assert.ok(r.error);
});

const travel='https://www.google.com/travel/hotels/entity/WestinEntity';
const westin={name:'The Westin Copley Place, Boston',address:'10 Huntington Avenue',city:'Boston'};
async function viaTravel(j,sources=[{url:travel+'/reviews?date=1',title:'The Westin Copley Place, Boston - Google hotels'}]){
 return llmRatings(westin,{noCache:true,persistCache:false,runLLM:async()=>({text:JSON.stringify(j),provider:'openai',sources})});
}
const attributed={matched_name:westin.name,confidence:'high',google:{rating:4.4,reviews:4121,source_url:travel,source_quote:'Google user reviews 4.4/5 · 4,121 reviews'},tripadvisor:{rating:4.2,reviews:5182,source_url:travel,source_quote:'Tripadvisor 4.2/5 · 5,182 reviews'}};
test('Google Travel explicitly attributed scores fill both platforms and retain the intermediary source',async()=>{
 const r=await viaTravel(attributed);assert.equal(r.google.rating,4.4);assert.equal(r.tripadvisor.rating,4.2);
 assert.equal(r.tripadvisor.via,'Google Travel');assert.equal(r.tripadvisor.url,travel+'/reviews?date=1');
 assert.equal(r.tripadvisor.sourceQuote,'Tripadvisor 4.2/5 · 5,182 reviews');
 const generic=await viaTravel(attributed,[{url:travel,title:'Google hotels'}]);assert.equal(generic.google.rating,4.4);assert.equal(generic.tripadvisor.rating,4.2);
});
test('an original Tripadvisor listing can use explicitly attributed Google Travel evidence',async()=>{
 const r=await viaTravel({...attributed,tripadvisor:{...attributed.tripadvisor,source_url:null,url:'https://www.tripadvisor.com/Hotel_Review-g60745-d111426-Reviews-The_Westin_Copley_Place_Boston.html'}});
 assert.equal(r.tripadvisor.rating,4.2);assert.equal(r.tripadvisor.via,'Google Travel');
});
test('attribution must distinguish platform scores and must not accept star classifications or ten-point scores',async()=>{
 for(const quote of ['Expedia 4.2/5 · 500 reviews','Tripadvisor 4.8/5 · 500 reviews','Tripadvisor 4.2/10 rating','4.2-star hotel']){
  const r=await viaTravel({...attributed,tripadvisor:{...attributed.tripadvisor,source_quote:quote}});assert.equal(r.tripadvisor,null);assert.ok(r.rejections.tripadvisor);
 }
 const r=await viaTravel({...attributed,google:{...attributed.google,rating:4.2,source_quote:'Tripadvisor 4.2/5 · 500 reviews'}});assert.equal(r.google,null);
});
test('hotel identity uses names and sources instead of demanding near-identical URL slugs',async()=>{
 const j={...attributed,google:null,tripadvisor:{rating:4.2,source_url:'https://www.tripadvisor.com/Hotel_Review-g1-d2-Reviews-Westin_Copley_Place.html'}};
 const r=await viaTravel(j,[{url:j.tripadvisor.source_url}]);assert.equal(r.tripadvisor.rating,4.2);
 const wrong=await viaTravel(attributed,[{url:travel,title:'Sheraton Boston Hotel'}]);assert.ok(wrong.error);
 const sister=await viaTravel({...j,tripadvisor:{rating:4.2,source_url:'https://www.tripadvisor.com/Hotel_Review-g1-d2-Reviews-Westin_Boston_Waterfront.html'}},[{url:'https://www.tripadvisor.com/Hotel_Review-g1-d2-Reviews-Westin_Boston_Waterfront.html'}]);assert.ok(sister.error);
});
test('one focused follow-up fills a missing platform without replacing the already supported score',async()=>{
 let calls=0;
 const r=await llmRatings(westin,{noCache:true,persistCache:false,recoverMissing:true,runLLM:async prompt=>{
  calls++;if(calls===2)assert.match(prompt,/ONLY the missing google/);
  return {text:JSON.stringify(calls===1?{...attributed,google:null}:{...attributed,tripadvisor:{...attributed.tripadvisor,rating:4.8}}),provider:'openai',sources:[{url:travel,title:westin.name}]};
 }});
 assert.equal(calls,2);assert.equal(r.google.rating,4.4);assert.equal(r.tripadvisor.rating,4.2);assert.equal(r.recoveryAttempts,1);
});

test('Yotel-style uncited Tripadvisor URL can use its searched Google Travel page and generic score quote',async()=>{
 const travel='https://www.google.com/travel/hotels/entity/YotelBoston';
 const j={matched_name:'YOTEL Boston',confidence:'high',google:{rating:4,source_url:travel,source_quote:'4.0 Very good | 3,120 reviews'},tripadvisor:{rating:3.9,reviews:1668,source_url:'https://www.tripadvisor.com/Hotel_Review-g60745-d12345678-Reviews-YOTEL_Boston-Boston_Massachusetts.html',source_quote:'3.9/5 · 1,668 reviews'}};
 let calls=0;
 const r=await llmRatings({name:'Yotel Boston',city:'Boston'},{noCache:true,persistCache:false,runLLM:async()=>{calls++;return {text:JSON.stringify(j),sources:[{url:travel+'?date=1'}]};}});
 assert.equal(calls,1);assert.equal(r.google.rating,4);assert.equal(r.tripadvisor.rating,3.9);
 assert.equal(r.tripadvisor.url,travel+'?date=1');assert.equal(r.tripadvisor.attribution,'model-assigned');
 assert.equal(r.tripadvisor.sourceQuote,'3.9/5 · 1,668 reviews');assert.match(r.tripadvisor.source,/unverified/);
});
test('generic Tripadvisor score may use a hotel-matched Travel source title without a supplied URL',async()=>{
 const j={...attributed,google:null,tripadvisor:{rating:4.2,reviews:5182,source_quote:'4.2/5 · 5,182 reviews'}};
 const r=await viaTravel(j);assert.equal(r.tripadvisor.rating,4.2);assert.equal(r.tripadvisor.attribution,'model-assigned');
 const noIdentity=await viaTravel(j,[{url:travel}]);assert.equal(noIdentity.tripadvisor,null);
 const contradictory=await viaTravel({...j,tripadvisor:{...j.tripadvisor,source_quote:'Expedia 4.2/5 · 500 reviews'}});assert.equal(contradictory.tripadvisor,null);
 const badScore=await viaTravel({...j,tripadvisor:{...j.tripadvisor,source_quote:'4.8/5 · 500 reviews'}});assert.equal(badScore.tripadvisor,null);
});
test('coverage-first ratings retain model numbers without inventing a missing source URL',async()=>{
 const response={matched_name:westin.name,confidence:'high',google:{rating:4.1,reviews:6031,source_url:travel,source_quote:'[google.com](link)'},tripadvisor:{rating:4.1,reviews:277,source_url:'https://www.tripadvisor.com/Hotel_Review-Unknown-Westin_Copley_Place.html',source_quote:'[google.com](link)'}};
 const r=await llmRatings(westin,{allowUnverified:true,noCache:true,persistCache:false,runLLM:async()=>({text:JSON.stringify(response),sources:[{url:travel}]})});
 for(const platform of ['google','tripadvisor']){assert.equal(r[platform].rating,4.1);assert.equal(r[platform].verification,'model-reported');assert.equal(r[platform].url,travel);assert.match(r[platform].verificationNote,/not confirmed/);}
 const noSources=await llmRatings(westin,{allowUnverified:true,noCache:true,persistCache:false,runLLM:async()=>({text:JSON.stringify(response),sources:[]})});
 assert.equal(noSources.google.rating,4.1);assert.equal(noSources.google.url,null);
});
test('coverage-first ratings still exclude missing scores, ten-point scales and other hotels',async()=>{
 for(const j of [{...attributed,matched_name:'Another Hotel'},{...attributed,google:{rating:8.2},tripadvisor:null},{...attributed,google:{rating:4.1,source_quote:'Booking 4.1/10'},tripadvisor:null},{...attributed,google:null,tripadvisor:null}]){
  const r=await llmRatings(westin,{allowUnverified:true,noCache:true,persistCache:false,runLLM:async()=>({text:JSON.stringify(j),sources:[]})});
  assert.equal(r.google??null,null);assert.equal(r.tripadvisor??null,null);
 }
});
