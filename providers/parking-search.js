import {runLLM} from './llm.js';
import {llmProvider,llmModel,DEFAULT_OPENAI_MODEL} from './config.js';
import {extractJSON} from './parking-prompt.js';
import {makeCache} from './cache.js';
import {verifyParking} from '../core/verify.js';
import {otaParkingPrompt} from './parking-ota-prompt.js';

const cache=makeCache('parking-search-v5',{ttlMs:7*86400000});
const isUrl=value=>{try{return ['https:','http:'].includes(new URL(value).protocol);}catch{return false;}};
export function normalizeSearchClaim(claim,response) {
  if(!claim || typeof claim!=='object' || Array.isArray(claim))return null;
  // Hosted search sometimes puts links in API annotations rather than the JSON string.
  // Use those actual returned links; never manufacture a URL from a page title.
  if(!isUrl(claim.source_url)) {
    const link=[...(response.citations??[]),...(response.sources??[])].find(s=>isUrl(s.url));
    return {...claim,source_url:link?.url??null};
  }
  return claim;
}
export async function findParkingFee(hotel,opts={}) {
  let bookingUrl=null;try{const u=new URL(hotel.url);bookingUrl=u.origin+u.pathname;}catch{}
  const property={name:hotel.name,city:hotel.city,address:hotel.address,booking_url:bookingUrl};
  const primaryModel=llmModel(opts);
  const recoveryModel=opts.recoveryModel || (llmProvider()==='openai' ? DEFAULT_OPENAI_MODEL : primaryModel);
  const key=[llmProvider(),primaryModel,recoveryModel,hotel.name,hotel.city??'',hotel.address??'',bookingUrl];
  const hit=cache.get(key);if(hit&&!opts.noCache)return {...hit,cached:true,costUsd:0};
  const prompt=`Use web search to find the current overnight guest parking fee for this exact hotel as of ${new Date().toISOString().slice(0,10)}: ${JSON.stringify(property)}.
Return the cheapest on-site overnight guest option: self parking if offered, otherwise valet. Prefer current official hotel information, then OTA hotel parking terms. Exclude nearby public garages, hourly/event/restaurant prices and parking packages. Match the exact hotel, not a sister property. Report USD per vehicle per night/day. Use null if no price is found; use type "none" if there is no on-site parking, and type "free" with 0 only for explicitly free parking. Use the sources returned by your web search. Do not invent prices or source URLs.
Return JSON only: {"parking_fee_per_night":number|null,"currency":"USD","parking_type":"self"|"valet"|"free"|"none"|"unknown","source_url":string|null,"source_quote":string|null,"confidence":"high"|"medium"|"low"}. source_url must be a literal https:// URL from the search results, never a page title or a description. source_quote must contain the stated parking amount and daily/overnight context when a price is found.`;
  async function search(prompt,model=primaryModel){
    const r=await (opts.runLLM??runLLM)(prompt,{...opts,model,usageContext:{purpose:'parking_lookup',hotel:hotel.name,city:hotel.city}});
    if(!(r.webSearchCalls>0))throw new Error('No completed GPT web search');
    const claim=normalizeSearchClaim(extractJSON(r.text),r);
    if(!claim||typeof claim!=='object'||Array.isArray(claim))throw new Error('GPT search returned no parking JSON');
    const evidence={status:'searched',provider:r.provider,model:r.model,searchedAt:r.researchedAt??new Date().toISOString(),sourceUrl:claim.source_url,webSearchCalls:r.webSearchCalls,citations:r.citations??[],sources:r.sources??[],independentlyVerified:false};
    return {claim,evidence,requiresEvidence:true,provider:'gpt-web-search',costUsd:r.costUsd??null,llm:{provider:r.provider,model:r.model,usage:r.usage??null,webSearchCalls:r.webSearchCalls,latencyMs:r.latencyMs??null}};
  }
  const resolved=result=>{const v=verifyParking(result?.claim,result?.evidence);return v.status==='ok'||(v.type==='none'&&v.sourceUrl&&v.reason.startsWith('hotel reports'));};
  let result;
  try{result=await search(prompt);}catch(e){result={claim:null,requiresEvidence:true,provider:'gpt-web-search',costUsd:null,error:e.message};}
  // A missing numeric fee also includes a reported no-parking policy: mini
  // models can mistake an adjacent public garage for absence of hotel valet.
  const needsRecovery=!resolved(result)||(llmProvider()==='openai'&&verifyParking(result.claim,result.evidence).status!=='ok');
  if(needsRecovery&&opts.recoverMissing===true){
    const reason=result.error??verifyParking(result.claim,result.evidence).reason;
    try{
      const focused=otaParkingPrompt(hotel);
      const recovery=await search(focused,recoveryModel);
      if(resolved(recovery))result={...recovery,recovery:{attempted:true,model:recoveryModel,previousReason:reason}};
      else result={...result,recovery:{attempted:true,model:recoveryModel,previousReason:reason,reason:verifyParking(recovery.claim,recovery.evidence).reason}};
    }catch(e){result={...result,recovery:{attempted:true,model:recoveryModel,previousReason:reason,error:e.message}};}
  }
  if(opts.persistCache!==false&&resolved(result))cache.set(key,result);
  return result;
}
