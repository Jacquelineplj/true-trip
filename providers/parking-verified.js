// LLM finds URLs; current fetched source text determines the fee. Evaluation labels are never read here.
import fs from 'node:fs';
import { makeCache } from './cache.js';
import { runLLM } from './llm.js';
import {llmProvider,llmModel} from './config.js';
import { extractJSON } from './parking-prompt.js';
import { extractParkingFromText, matchesProperty } from '../core/parking-evidence.js';
import { readParkingSource, isSourceUrl } from './parking-source-reader.js';

const cache=makeCache('parking-verified-v3',{ttlMs:86400000});
const discovery=makeCache('parking-source-urls',{ttlMs:30*86400000});
const primaryHosts=['hilton.com','marriott.com','omnihotels.com','hyatt.com','wyndhamhotels.com','ihg.com','sonesta.com','stayaka.com','hotelcommonwealth.com','theverbhotel.com','theatlashotel.com','midtownhotel.com','foundhotels.com','wyndhambeaconhill.com','kasa.com','yotel.com'];
const secondaryHosts=['expedia.com','hotels.com','booking.com'];
export function sourceTier(url){const h=new URL(url).hostname.replace(/^www\./,'');if(primaryHosts.some(d=>h===d||h.endsWith('.'+d)))return 'primary';if(secondaryHosts.some(d=>h===d||h.endsWith('.'+d)))return 'secondary';return 'unknown';}
function legacyUrls(hotel){
  try{const values=JSON.parse(fs.readFileSync(new URL('../.cache/parking.json',import.meta.url),'utf8'));return Object.values(values).filter(e=>e.k?.[1]===hotel.name).map(e=>e.v?.claim?.source_url).filter(isSourceUrl);}catch{return [];}
}
function variants(url){
  const u=new URL(url);u.hash='';u.search='';
  if(/^www\.expedia\./.test(u.hostname)){u.hostname='www.expedia.com';u.pathname=u.pathname.replace(/^\/en\//,'/');}
  if(u.hostname.endsWith('hilton.com')){
    const property=u.pathname.match(/^\/(en(?:-[a-z]+)?)\/hotels\/([^/]+)/i);
    if(property)return [`${u.origin}/en/hotels/${property[2]}/hotel-location/`,`${u.origin}/en/hotels/${property[2]}/hotel-info/`];
  }
  return [u.href];
}
function discoveryKey(hotel,opts){return ['v4',llmProvider(),llmModel(opts),hotel.name,hotel.city??''];}
async function discover(hotel,opts){
  const key=discoveryKey(hotel,opts);
  const hit=discovery.get(key);if(hit&&!opts.refreshSources)return {urls:hit,costUsd:0};
  const prompt=`Find the official property website and parking policy URLs for this exact hotel: ${JSON.stringify({name:hotel.name,city:hotel.city,address:hotel.address})}. Use web search. Return up to 3 official property-specific URLs and one Expedia property URL as fallback. Include the Expedia property URL even when an official website exists; if no Expedia page exists, use Booking. Prefer specific parking/FAQ/policy pages to the homepage. Return URLs only, never parking prices. Do not return search pages, event guides, reviews, parking packages, or sister hotels. JSON only: {"urls":["https://..."]}.`;
  const r=await runLLM(prompt,{...opts,maxTurns:10});
  const j=extractJSON(r.text);const urls=(j?.urls??[]).filter(isSourceUrl).slice(0,4);
  if(urls.length)discovery.set(key,urls);
  return {urls,costUsd:r.costUsd,llm:{provider:r.provider,model:r.model,usage:r.usage??null,webSearchCalls:r.webSearchCalls??null,latencyMs:r.latencyMs??null}};
}
export async function findParkingFee(hotel,opts={}){
  const key=['v3',hotel.name,hotel.city??'',hotel.address??''];
  const now=Date.now();const hit=cache.get(key);
  if(!opts.noCache && hit && now-Date.parse(hit.evidence?.fetchedAt)<(hit.evidence?.tier==='primary'?86400000:21600000))return {...hit,cached:true};
  const attempts=[];let costUsd=0,llm=null;
  try{
    const seeded=legacyUrls(hotel);
    const known=discovery.get(discoveryKey(hotel,opts))??[];
    let urls=opts.sourceUrls ? [...opts.sourceUrls] : [...known,...seeded];
    // Discover when only OTA/unknown URLs are available; seed values are never accepted as fees.
    if(!opts.sourceUrls && (!known.length||!urls.some(u=>sourceTier(u)==='primary')||opts.refreshSources)){
      try{const d=await discover(hotel,opts);costUsd=d.costUsd;llm=d.llm??null;urls=[...d.urls,...urls];}
      catch(e){attempts.push({stage:'discovery',error:e.message});} // Still fetch available URL hints when discovery fails.
    }
    urls=[...new Set(urls.filter(isSourceUrl).flatMap(variants))];
    const priority=u=>(sourceTier(u)==='primary'?10:0)+(/parking|polic|faq|hotel-info|hotel-location|local-area|directions/i.test(new URL(u).pathname)?2:0);
    urls.sort((a,b)=>priority(b)-priority(a));
    const secondary=[];
    for(let sourceIndex=0;sourceIndex<Math.min(urls.length,8);sourceIndex++){
      const url=urls[sourceIndex];
      if(sourceTier(url)==='unknown'){attempts.push({url,error:'unsupported source authority'});continue;}
      let page=await (opts.readSource??readParkingSource)(url);
      if(page.error){attempts.push({url,error:page.error});continue;}
      if(!page.error && page.method==='http' && (extractParkingFromText(page.text,{tier:sourceTier(page.url)}).status==='unknown' || !matchesProperty(hotel,page))){
        const hydrated=await (opts.readSource??readParkingSource)(url,{forceBrowser:true});if(!hydrated.error)page=hydrated;
      }
      if(!matchesProperty(hotel,page)){attempts.push({url,error:'page identity does not match requested hotel',title:page.title,textLength:page.text?.length});continue;}
      const parsed=extractParkingFromText(page.text,{tier:sourceTier(page.url)});
      attempts.push({url:page.url,status:parsed.status,fee:parsed.fee??null,type:parsed.type??null});
      if(parsed.status==='unknown'){
        const extra=sourceTier(page.url)==='primary' ? (page.links??[]).map(l=>{const u=new URL(l.url);u.hash='';u.search='';return u.href;}).filter(u=>isSourceUrl(u)&&!urls.includes(u)&&!/(?:login|sign-?in|search|reserve|privacy|cookie|terms|accessibility|pet-policy)/i.test(new URL(u).pathname)) : [];
        urls.splice(sourceIndex+1,0,...extra.slice(0,3));
        continue;
      }
      if(parsed.status==='conflict')continue;
      const evidence={version:3,status:'fetched',fetchedAt:page.fetchedAt,sourceUrl:page.url,contentHash:page.contentHash,method:page.method,tier:sourceTier(page.url),propertyMatched:true};
      const claim={parking_fee_per_night:parsed.fee,currency:'USD',parking_type:parsed.type,source_url:page.url,source_quote:parsed.quote,confidence:'high'};
      const result={claim,evidence,provider:'source-verified',requiresEvidence:true,costUsd,llm,attempts};
      if(evidence.tier==='primary'){
        // Conflicting rates on the same current page are never selected by taking the minimum.
        if(opts.persistCache!==false)cache.set(key,result);return result;
      }
      if(evidence.tier==='secondary')secondary.push(result);
    }
    // Current OTA property terms are a lower-tier fallback; search snippets and reviews are never evidence.
    if(secondary.length){
      const fees=[...new Set(secondary.map(r=>r.claim.parking_type+'|'+r.claim.parking_fee_per_night))];
      if(fees.length>1)return {claim:null,provider:'source-verified',requiresEvidence:true,costUsd,llm,attempts,error:'Current OTA parking terms conflict'};
      const r=secondary[0];r.claim.confidence='medium';r.attempts=attempts;if(opts.persistCache!==false)cache.set(key,r);return r;
    }
    return {claim:null,provider:'source-verified',requiresEvidence:true,costUsd,llm,attempts,error:'No current, matching on-site parking evidence could be retrieved'};
  }catch(e){return {claim:null,provider:'source-verified',requiresEvidence:true,costUsd,llm,attempts,error:e.message};}
}
