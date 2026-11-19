import './config.js';
// Wires the real providers together for the CLI and the local server.
import { geocode, geocodeHotel, geocodeCity, geocodeAnchor } from './geocode.js';
import { driveRoute } from './route.js';
import { getParkingProvider } from './parking.js';
import { googleRating, available as googleAvailable } from './ratings-google.js';
import { tripadvisorRating, available as taAvailable } from './ratings-tripadvisor.js';
import {createRatingsLookup} from './ratings-lookup.js';
import { mapLimit } from './http.js';
import {researchHotel,researchRunner} from './hotel-research.js';
import {parkingMode,llmModel,DEFAULT_OPENAI_MODEL} from './config.js';
import {extractJSON} from './parking-prompt.js';
import {matchesHotelLocation} from './geocode.js';
import {verifyParking,describesOffSiteParkingOnly} from '../core/verify.js';
import {hasNoOnSiteParkingPolicy,needsDefaultPublicParking} from '../core/public-parking.js';

/**
 * @param {{ratingsFallback?: 'llm'|'none', model?: string}} opts
 */
export async function realProviders(opts = {}) {
  const parking = await getParkingProvider();
  const ratingsFallback = opts.ratingsFallback ?? process.env.TRUETRIP_RATINGS_FALLBACK ?? 'none';
  const research=opts.research??researchHotel;
  const ratingsLookup=createRatingsLookup({research,...(opts.research?{record:null}:{}),...(opts.ratingsCache?{cache:opts.ratingsCache}:{})});
  const modelFor=h=>h.deepSearch?DEFAULT_OPENAI_MODEL:llmModel({model:opts.model??opts.claudeModel});
  const runner=h=>researchRunner(research,h,{model:modelFor(h),includeRatings:!!h.lookupRatings,preferParking:true,mode:h.deepSearch?'ota':'combined'});
  function otaNearbyParking(h,result){
    const c=result.claim,quote=String(c.source_quote??'');
    const m=quote.match(/\b(\d+(?:\.\d+)?)\s*(ft|feet|m|meters|metres|yards?)\s+away\b/i);
    if(!m)return null;
    const n=Number(m[1]),unit=m[2].toLowerCase();
    const distance=unit.startsWith('f')?n*0.3048:unit.startsWith('y')?n*0.9144:n;
    const basis=/per day|daily|24\s*(?:hours?|hrs?|h)\b/i.test(quote)?'24h':/per night|overnight/i.test(quote)?'overnight':null;
    if(!basis)return null;
    let host='hotel listing';try{host=new URL(c.source_url).hostname.replace(/^www\./,'');}catch{}
    return {claim:{matched_name:h.name,listing:'ota',parking_fee_per_night:c.offSiteQuotedFee,currency:c.currency??'USD',rate_basis:basis,facility_name:`Nearby parking listed on ${host}`,facility_address:null,distance_m:Math.round(distance),source_url:c.source_url,source_quote:quote,confidence:c.confidence},
      evidence:result.evidence??null,provider:'gpt-web-search',llm:result.llm??null};
  }
  async function nearbyParking(h,result){
    const policy=verifyParking(result.claim,result.evidence);
    if(!hasNoOnSiteParkingPolicy(policy))return result;
    try{
      const response=await research({...h,address:result.claim?.address??h.address},{model:DEFAULT_OPENAI_MODEL,mode:'public'});
      const evidence=response.error?null:{status:'searched',searchedAt:response.researchedAt,webSearchCalls:response.webSearchCalls,sources:response.sources??[],citations:response.citations??[],provider:response.provider,model:response.model};
      return {...result,publicParking:{claim:extractJSON(response.text),evidence,error:response.error,provider:'gpt-web-search',llm:{model:response.model,usage:response.usage,webSearchCalls:response.webSearchCalls}}};
    }catch(e){return {...result,publicParking:{error:e.message}};}
  }
  return {
    geocode,
    geocodeHotel:(h,options)=>geocodeHotel(h,{...options,resolveAddress:async({bias})=>{
      const r=await research(h,{model:modelFor(h),includeRatings:!!h.lookupRatings});
      if(r.error)return null;
      const j=extractJSON(r.text);
      if(typeof j?.address!=='string'||!/^https?:\/\//.test(j.address_source_url??'')||!/\d/.test(j.address))return null;
      const g=await geocodeHotel({...h,address:j.address},{bias,resolveAddress:async()=>null});
      return g&&matchesHotelLocation({...h,address:j.address},g,true)?{...g,label:`${h.name}, ${j.address}`,addressSource:j.address_source_url}:null;
    }}),
    geocodeCity,
    geocodeAnchor,
    driveRoute,
    ratingsNeedsLocation:googleAvailable()||taAvailable(),
    async findParkingFee(h){
      const query=hotel=>parking.findParkingFee(hotel,parkingMode()==='search'?{model:modelFor(hotel),runLLM:runner(hotel),noCache:true,persistCache:false,recoverMissing:false}:{model:opts.model??opts.claudeModel});
      const initial=await query(h);
      const verified=verifyParking(initial.claim,initial.evidence);
      if(hasNoOnSiteParkingPolicy(verified))return nearbyParking(h,initial);
      if(needsDefaultPublicParking(verified))return initial;
      // The hotel answer says paid on-site parking exists but gave no amount: one dedicated
      // parking-only search is worth it even when "Search deeper" is off.
      // The model's type label can contradict its own quote ("free" + "available for a surcharge"),
      // so a quote that states a charge also counts.
      const quoteSaysPaid=/\b(?:surcharge|(?:additional|extra|daily|nightly)\s+(?:fee|charge|cost)|for a (?:fee|charge)|(?:fees?|charges?)\s+appl(?:y|ies)|paid parking)\b/i.test(verified.quote??'');
      const paidButNoAmount=verified.perNight==null&&verified.type!=='none'&&(['self','valet'].includes(verified.type)||quoteSaysPaid);
      if((!h.allowDeepSearch&&!paidButNoAmount)||h.deepSearch||parkingMode()!=='search'||verified.status==='ok'||/HTTP (?:401|429)/.test(initial.error??''))return initial;
      let fallback=await query({...h,deepSearch:true,lookupRatings:false});
      // An OTA "parking is available nearby" listing means the hotel has no parking of its own:
      // treat it as a no-on-site policy so the named-garage search / $50 estimate path prices it.
      if(fallback.claim&&describesOffSiteParkingOnly(fallback.claim.source_quote))fallback={...fallback,claim:{...fallback.claim,parking_type:'none',parking_fee_per_night:null,offSiteQuotedFee:fallback.claim.parking_fee_per_night??null}};
      const checked=verifyParking(fallback.claim,fallback.evidence);
      const usable=checked.status==='ok'||(checked.type==='none'&&checked.sourceUrl&&checked.reason.startsWith('hotel reports'));
      // User decision (2026-11-18): when the hotel's own OTA listing prices nearby parking with a distance,
      // use that price directly instead of searching for a named garage. verifyPublicParking still checks
      // the quoted amount, daily/overnight basis, distance and searched source.
      const ota=usable&&fallback.claim?.offSiteQuotedFee!=null?otaNearbyParking(h,fallback):null;
      if(ota)return {...fallback,publicParking:ota,recovery:{attempted:true,model:DEFAULT_OPENAI_MODEL,strategy:'dedicated-ota',previousReason:initial.error??verified.reason}};
      return nearbyParking(h,{...(usable?fallback:initial),recovery:{attempted:true,model:DEFAULT_OPENAI_MODEL,strategy:'dedicated-ota',previousReason:initial.error??verified.reason,...(!usable?{reason:fallback.error??checked.reason}:{})}});
    },
    async ratings(h) {
      const out = { google: null, tripadvisor: null, note: null };
      if (googleAvailable()) { const r = await googleRating(h); out.google = r && !r.error ? r : null; if (r?.error) out.note = r.error; }
      if (taAvailable()) { const r = await tripadvisorRating(h); out.tripadvisor = r && !r.error ? r : null; if (r?.error) out.note = (out.note ? out.note + '; ' : '') + r.error; }
      if (!googleAvailable() && !taAvailable()) {
        if (ratingsFallback === 'llm') {
          const r = await ratingsLookup(h,{model:modelFor(h)});
          out.rejections=r?.rejections??null;
          if (r && !r.error) { out.google = r.google; out.tripadvisor = r.tripadvisor; out.llm = r.llm; out.citations = r.citations; out.note = 'ratings via LLM web search (unverified); set GOOGLE_MAPS_API_KEY / TRIPADVISOR_API_KEY for API ratings'; }
          else out.note = `LLM ratings failed: ${r?.error}`;
        } else out.note = 'no rating API keys set (GOOGLE_MAPS_API_KEY, TRIPADVISOR_API_KEY); use --ratings-fallback llm to search with the LLM';
      }
      return out;
    },
    mapLimit,
  };
}
