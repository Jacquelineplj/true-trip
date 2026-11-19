// One searched answer per property supplies parking, address and optional ratings.
// Cached misses and shared in-flight work prevent refreshes/tabs from paying again.
import {makeCache} from './cache.js';
import {runLLM} from './llm.js';
import {llmModel,llmProvider} from './config.js';
import {extractJSON} from './parking-prompt.js';
import {verifyParking} from '../core/verify.js';
import {nameSimilarity} from '../core/match.js';
import {appendUsage} from './usage.js';
import {otaParkingPrompt} from './parking-ota-prompt.js';
import {publicParkingPrompt} from './public-parking-prompt.js';
import {verifyPublicParking} from '../core/public-parking.js';

export function createHotelResearch({cache=makeCache('hotel-research-v1',{ttlMs:7*86400000}),run=runLLM,record=run===runLLM?appendUsage:null}={}){
 return async function research(hotel,{model=llmModel(),includeRatings=false,mode='combined',ratingPlatforms=['google','tripadvisor'],preferParking=false}={}){
  const ratingsOnly=mode==='ratings';
  const missing=['google','tripadvisor'].filter(p=>ratingPlatforms.includes(p));
  const ota=mode==='ota';
  const nearby=mode==='public';
  if(ota||nearby)includeRatings=false;
  let bookingUrl=null;try{const u=new URL(hotel.url);bookingUrl=u.origin+u.pathname;}catch{}
  const property={name:hotel.name,city:hotel.city,booking_url:bookingUrl};
  const base=ratingsOnly?['ratings-recovery-v1',llmProvider(),model,property,missing]:nearby?['public-parking-v1',llmProvider(),model,property]:ota?['ota-parking-v1',llmProvider(),model,property]:[llmProvider(),model,property];
  const purpose=ratingsOnly?'hotel_ratings_recovery':nearby?'hotel_public_parking':ota?'hotel_parking_ota':includeRatings?'hotel_parking_address_ratings':'hotel_parking_address';
  // A full answer can also satisfy a later parking/address-only lookup.
  const fullKey=[...base,true],key=[...base,includeRatings];
  const full=ota||nearby||ratingsOnly?null:cache.get(fullKey);
  const own=cache.get(key);
  const parkingOnly=cache.get([...base,false]);
  const usefulOwn=(!includeRatings||preferParking)&&parkingOnly&&!parkingOnly.error&&verifyParking(extractJSON(parkingOnly.text)).status==='ok';
  const hit=usefulOwn?parkingOnly:full&&!full.error?full:own;
  if(hit){
   if(record)try{record({kind:'cache_hit',provider:'openai',model,purpose,hotel:hotel.name,city:hotel.city??null,status:hit.error?'cached_failure':'cached',cost:{estimatedUsd:0,pricingStatus:'no_api_request'}});}catch(e){console.error(`TrueTrip usage log write failed (${e.code??'write_error'})`);}
   return hit;
  }
  return cache.wrap(key,async()=>{
   try{
    const prompt=ratingsOnly?`Use web search to find ONLY the missing ${missing.join(' and ')} user-review ratings for this exact property: ${JSON.stringify({...property,address:hotel.address??null})}.
Focus the search on Google Travel/Google Maps and Tripadvisor. Google Travel can supply both scores. Match the exact property and address, not a sister property. Scores must be out of 5; never return Booking/Expedia scores or hotel star classifications. Keep platform labels distinct. Use real searched source URLs and short exact supporting quotes; a Tripadvisor entry on Google Travel may use that actual Travel URL. Unsupported ratings must be null. Do not research parking or street addresses.
Return JSON only: {"matched_name":string,"confidence":"high"|"medium"|"low","google":{"rating":number|null,"reviews":number|null,"source_url":string|null,"source_quote":string|null},"tripadvisor":{"rating":number|null,"reviews":number|null,"source_url":string|null,"source_quote":string|null}}.`:nearby?publicParkingPrompt(hotel):ota?otaParkingPrompt(hotel):`Use web search to research this exact hotel as of ${new Date().toISOString().slice(0,10)}: ${JSON.stringify(property)}.
Find its overnight guest parking fee and current street address${includeRatings?', plus Google and Tripadvisor user-review ratings':''}. Reuse searched pages across these questions. Match the exact property, not a sister hotel.
Parking: prefer official hotel information, then OTA parking terms. Return the cheapest on-site overnight guest option, self if offered otherwise hotel valet. Exclude adjacent public garages, hourly/event rates, parking packages and personal reviews. An adjacent public garage does NOT establish that hotel valet is absent. Only report none when an explicit policy states no on-site parking. Unknown amounts stay null, never zero. USD per vehicle per night/day; free requires an explicit free-parking quote. Quote the actual amount and overnight context. Booking's The fine print / Important information and Facilities / Parking can state a fee missing from the overview; check those sections before returning null.
Address: return a street address only with a searched source URL, never invented coordinates.
${includeRatings?'Ratings: Google Travel may supply both Google and explicitly attributed Tripadvisor scores. Keep labels distinct. Use actual searched URLs and short exact quotes supporting each score out of 5. Match name/address; exclude hotel star classifications. Never invent a Maps URL. If Tripadvisor is quoted from Google Travel, use that Travel URL and include Tripadvisor in the quote.':'Do not search for ratings in this request; return null rating values.'}
Return JSON only, no explanation: {"matched_name":string,"confidence":"high"|"medium"|"low","address":string|null,"address_source_url":string|null,"parking_fee_per_night":number|null,"currency":"USD","parking_type":"self"|"valet"|"free"|"none"|"unknown","source_url":string|null,"source_quote":string|null,"google":{"rating":number|null,"reviews":number|null,"source_url":string|null,"source_quote":string|null},"tripadvisor":{"rating":number|null,"reviews":number|null,"source_url":string|null,"source_quote":string|null}}. Use literal searched https URLs; unsupported fields must be null.`;
    const response=await run(prompt,{model,maxOutputTokens:ota||nearby||ratingsOnly?700:1100,maxToolCalls:1,usageContext:{purpose,hotel:hotel.name,city:hotel.city}});
    if(!(response.webSearchCalls>0))throw new Error('No completed hotel web search');
    const claim=extractJSON(response.text);
    // The parking-only schema is the same one used by the tested OTA query.
    // Combined answers must identify the hotel; reject a conflicting name in either mode.
    if(!claim||typeof claim!=='object'||Array.isArray(claim)||((!ota||claim.matched_name!=null)&&nameSimilarity(hotel.name,claim.matched_name)<0.7))throw new Error('Hotel identity could not be confirmed');
    return {...response,researchedAt:new Date().toISOString()};
   }catch(e){return {error:e.message};}
  },{ttlMs:response=>{
   if(response.error)return /401|429/.test(response.error)?60000:5*60000;
   if(ratingsOnly)return 30*60000;
   const j=extractJSON(response.text);
   if(nearby)return verifyPublicParking(j,{...response,status:'searched',searchedAt:response.researchedAt}).status==='ok'?7*86400000:30*60000;
   // Fully missing answers expire sooner; useful property data lasts seven days.
   const parking=verifyParking(j);
   return parking.status==='ok'||parking.type==='none'||(includeRatings&&(j.google?.rating!=null||j.tripadvisor?.rating!=null))?7*86400000:30*60000;
  }});
 };
}
export const researchHotel=createHotelResearch();
export function researchRunner(research,hotel,options){
 return async()=>{const response=await research(hotel,options);if(response.error)throw new Error(response.error);return response;};
}
