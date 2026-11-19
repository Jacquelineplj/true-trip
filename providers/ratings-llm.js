// Searched platform scores, including explicitly attributed Google Travel reviews.
// These are searched claims, not independently fetched/API-verified ratings.
import {runLLM} from './llm.js';
import {llmProvider,llmModel} from './config.js';
import {extractJSON} from './parking-prompt.js';
import {makeCache} from './cache.js';
import {nameSimilarity,tokens} from '../core/match.js';
const cache=makeCache('ratings-llm-v6',{ttlMs:7*86400000});
function page(value){
 try{
  const u=new URL(value);if(u.protocol!=='https:')return null;
  const host=u.hostname.replace(/^www\./,'');
  const google=/^google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(host);
  const tripadvisor=/^tripadvisor\.(?:com|co\.uk|ca|com\.au|de|fr|it|es|in|co\.nz)$/.test(host);
  const entity=google&&u.pathname.match(/^\/travel\/hotels\/entity\/([^/]+)/)?.[1];
  const maps=google&&/^\/maps(?:\/|$)/.test(u.pathname);
  if(!entity&&!maps&&!tripadvisor)return null;
  const key=entity?`google-travel:${entity}`:`${host}${u.pathname.replace(/\/$/,'')}${maps&&!u.pathname.includes('/place/')?'?'+(u.searchParams.get('cid')??u.searchParams.get('query_place_id')??u.searchParams.get('q')??''):''}`;
  return {url:u.href,key,host,path:u.pathname,entity,maps,tripadvisor};
 }catch{return null;}
}
function quoteSupports(quote,score,platform,indirect){
 if(!quote||typeof quote!=='string')return false;
 const value=String(score).replace('.','[.,]');
 const number=new RegExp(`(?:^|[^\\d])${value}${Number.isInteger(score)?'(?:[.,]0)?':''}(?![\\d.])`);
 if(!number.test(quote)||/\/\s*10\b|out of\s*10/i.test(quote))return false;
 if(/\d\s*[- ]star hotel/i.test(quote)&&!/review|rating|\/\s*5\b/i.test(quote))return false;
 if(indirect&&platform==='tripadvisor')return /trip\s*advisor/i.test(quote);
 if(indirect&&platform==='google'&&!/google/i.test(quote)&&/trip\s*advisor|booking|expedia|trip\.com|hotels\.com|agoda/i.test(quote))return false;
 return /review|rating|rated|\/\s*5\b|out of\s*5/i.test(quote);
}
function relaxedTripadvisorQuote(quote,score,j,hotel,evidence){
 if(!evidence?.page.entity||!quoteSupports(quote,score,'tripadvisor',false))return false;
 // A model-assigned score can use the same hotel's real Travel page without
 // manufacturing the missing platform label in the returned quotation.
 if(/google|expedia|booking|trip\.com|hotels\.com|agoda/i.test(quote))return false;
 const title=evidence.source.title;
 const titleMatches=title&&nameSimilarity(hotel.name,title)>=0.6;
 const g=j.google;
 const sharedGooglePage=[g?.source_url,g?.url].map(page).filter(Boolean).some(p=>p.key===evidence.page.key);
 const googleScore=Number(g?.rating);
 const supportedGoogle=googleScore>=1&&googleScore<=5&&quoteSupports(g?.source_quote??g?.quote,googleScore,'google',true);
 return !!(titleMatches||(sharedGooglePage&&supportedGoogle));
}
function rating(r,j,platform,hotel,sources){
 const reject=reason=>({value:null,reason});
 if(r?.rating==null||r.rating===''||!Number.isFinite(Number(r.rating))||Number(r.rating)<1||Number(r.rating)>5)return reject('No supported 1–5 rating found');
 const score=Number(r.rating),quote=r.source_quote??r.quote??'';
 const supplied=[r.source_url,r.url].map(page).filter(Boolean);
 const cited=sources.map(s=>({source:s,page:page(s.url)})).filter(s=>s.page);
 const target=tokens(hotel.name);
 const wrongTripadvisor=supplied.some(p=>p.tripadvisor&&target.length&&target.filter(t=>tokens(decodeURIComponent(p.path)).includes(t)).length/target.length<0.6);
 if(platform==='tripadvisor'&&wrongTripadvisor)return reject('The source link appears to describe another hotel');
 // Match Google Travel entity IDs across /reviews and date/tracking-query variants.
 let evidence=cited.find(s=>supplied.some(p=>p.key===s.page.key));
 // A platform URL in the answer may be an original listing while the actual source is Google Travel.
 // Only use that intermediary when the quote explicitly supports this platform's score.
 if(!evidence&&supplied.some(p=>platform==='tripadvisor'?p.tripadvisor:p.maps))evidence=cited.find(s=>s.page.entity&&quoteSupports(quote,score,platform,true));
 if(!evidence&&platform==='tripadvisor')evidence=cited.find(s=>relaxedTripadvisorQuote(quote,score,j,hotel,s));
 if(!evidence)return reject('No supporting searched source link');
 const source=evidence.page;
 if(platform==='google'&&!source.maps&&!source.entity)return reject('The searched page does not identify a Google rating');
 if(platform==='tripadvisor'&&!source.tripadvisor&&!source.entity)return reject('The searched page does not identify a Tripadvisor rating');
 const indirect=!!source.entity;
 const modelAttributed=platform==='tripadvisor'&&indirect&&!quoteSupports(quote,score,platform,true)&&relaxedTripadvisorQuote(quote,score,j,hotel,evidence);
 if(indirect&&!quoteSupports(quote,score,platform,true)&&!modelAttributed)return reject('No explicitly attributed score in the Google Travel excerpt');
 if(!indirect&&quote&&!quoteSupports(quote,score,platform,false))return reject('The source excerpt does not support this score');
 const matchedName=r.matched_name??j.matched_name;
 if(nameSimilarity(hotel.name,matchedName)<0.7)return reject('The rating could not be matched to this hotel');
 // Readable listing URLs can catch a sister-property mismatch, but need not reproduce 90% of the name.
 const pathTokens=tokens(decodeURIComponent(source.path));
 if(!indirect&&(source.tripadvisor||source.path.includes('/place/'))&&target.length&&target.filter(t=>pathTokens.includes(t)).length/target.length<0.6)return reject('The source link appears to describe another hotel');
 // Titles supplied by the search tool provide additional identity evidence for opaque entity URLs.
 const title=evidence.source.title;
 if(indirect&&title&&tokens(title).filter(t=>!['google','travel','reviews','review','ratings','rating'].includes(t)).length>=2&&nameSimilarity(hotel.name,title)<0.45)return reject('The searched page title describes another hotel');
 return {value:{rating:score,reviews:r.reviews!=null&&Number.isInteger(Number(r.reviews))&&Number(r.reviews)>=0?Number(r.reviews):null,
  url:evidence.source.url,sourceUrl:evidence.source.url,sourceQuote:quote||null,matchedName,source:'llm-search (unverified)',
  via:indirect?'Google Travel':null,confidence:r.confidence??j.confidence,
  ...(modelAttributed?{attribution:'model-assigned',verificationNote:'Tripadvisor attribution comes from the model; the quoted Google Travel excerpt does not explicitly name the platform.'}:{})},reason:null};
}
// Coverage-first display is opt-in for the plugin. Never turn missing numbers,
// other hotels or a ten-point Booking score into a platform rating.
function assessRating(r,j,platform,hotel,sources,allowUnverified){
 const checked=rating(r,j,platform,hotel,sources);
 if(allowUnverified&&j.confidence==='low'&&checked.value)return {value:{...checked.value,verification:'model-reported',attribution:'model-assigned',verificationNote:'Low-confidence model-reported score; not independently confirmed.'},reason:null};
 if(!allowUnverified||checked.value)return checked;
 const eligible=['No supporting searched source link','The searched page does not identify a Google rating','The searched page does not identify a Tripadvisor rating','No explicitly attributed score in the Google Travel excerpt','The source excerpt does not support this score'];
 if(!eligible.includes(checked.reason))return checked;
 const quote=String(r?.source_quote??r?.quote??'');
 if(/\/\s*10\b|out of\s*10|booking|expedia|hotels\.com|agoda/i.test(quote)||platform==='google'&&/trip\s*advisor/i.test(quote)||platform==='tripadvisor'&&/google (?:rating|reviews)/i.test(quote))return checked;
 const matchedName=r?.matched_name??j.matched_name;
 if(nameSimilarity(hotel.name,matchedName)<0.7)return checked;
 const candidate=sources.map(source=>({source,page:page(source.url)})).find(({source,page:p})=>p&&(p.entity||(platform==='google'?p.maps:p.tripadvisor))&&(!source.title||nameSimilarity(hotel.name,source.title)>=0.45));
 return {value:{rating:Number(r.rating),reviews:r.reviews!=null&&Number.isInteger(Number(r.reviews))&&Number(r.reviews)>=0?Number(r.reviews):null,
  url:candidate?.source.url??null,sourceUrl:candidate?.source.url??null,sourceQuote:r.source_quote??r.quote??null,matchedName,
  source:'llm-search (unverified)',verification:'model-reported',attribution:'model-assigned',via:candidate?.page.entity?'Google Travel':null,
  confidence:r.confidence??j.confidence,verificationNote:`Model-reported score; not confirmed by the source excerpt. ${checked.reason}.`},reason:null};
}
export async function llmRatings(hotel,opts={}){
 opts={...opts,usageContext:{purpose:'ratings_lookup',hotel:hotel.name,city:hotel.city}};
 const key=[llmProvider(),llmModel(opts),hotel.name,hotel.address??'',hotel.city??'',!!opts.allowUnverified];
 const hit=cache.get(key);if(hit&&!opts.noCache)return {...hit,cached:true};
 const prompt=`Use web search to find current Google user-review and Tripadvisor ratings for this exact hotel: ${JSON.stringify({name:hotel.name,address:hotel.address,city:hotel.city})}.
Google Travel hotel pages often show BOTH the Google user score and a separate "Tripadvisor <score>/5 · <count> reviews" entry under reviews on other travel sites. You MAY use that explicit Tripadvisor entry: the evidence source_url must then be the actual Google Travel page and the quote must say Tripadvisor plus its score. Google Travel entity/reviews URLs are valid evidence; do not invent a Google Maps URL just to satisfy a domain rule. Google Travel may be the source for both scores, but keep the platform labels distinct.
Search for the exact hotel name and city on Google Travel/Google Maps and Tripadvisor as needed. Match the property's name and address, not a sister property. Report scores out of 5, never hotel star classifications or Booking/Expedia scores. Include a short verbatim excerpt containing the platform attribution and score (and review count if visible). Return null when no searched evidence supports a score. Never fill from memory or invent a URL/quote.
JSON only: {"matched_name":string,"confidence":"high"|"medium"|"low","google":{"rating":number|null,"reviews":number|null,"source_url":string|null,"source_quote":string|null},"tripadvisor":{"rating":number|null,"reviews":number|null,"source_url":string|null,"source_quote":string|null}}. Use actual searched URLs; a Google Travel link is allowed for Tripadvisor when the page explicitly attributes the score to Tripadvisor.`;
 try{
  const response=await (opts.runLLM??runLLM)(prompt,opts),j=extractJSON(response.text);
  if(!j||(j.confidence==='low'&&!opts.allowUnverified)||nameSimilarity(hotel.name,j.matched_name)<0.7)return {error:'No sufficiently matched searched ratings',rejections:{google:'Hotel identity could not be confirmed',tripadvisor:'Hotel identity could not be confirmed'}};
  const sources=[...(response.sources??[]),...(response.citations??[])];
  const g=assessRating(j.google,j,'google',hotel,sources,opts.allowUnverified),t=assessRating(j.tripadvisor,j,'tripadvisor',hotel,sources,opts.allowUnverified);
  const out={google:g.value,tripadvisor:t.value,rejections:{google:g.reason,tripadvisor:t.reason},costUsd:response.costUsd,
   llm:{provider:response.provider,model:response.model,usage:response.usage??null,webSearchCalls:response.webSearchCalls??null},citations:response.citations??[],sources};
  if((out.google||out.tripadvisor)&&(!out.google||!out.tripadvisor)&&opts.recoverMissing===true){
   const missing=['google','tripadvisor'].filter(p=>!out[p]);
   try{
    const focused=`Use web search to find ONLY the missing ${missing.join(' and ')} user-review score for ${JSON.stringify({name:hotel.name,address:hotel.address,city:hotel.city})}. For Google, find the main Google user-review summary on Google Travel or Google Maps, not a Tripadvisor/Expedia score. For Tripadvisor, its explicitly labeled entry on Google Travel is valid. Distinguish hotel star classification from user rating. Return a short exact source quote containing the SAME numeric rating you put in JSON; do not substitute another platform's quote. A Google Travel source link is allowed. If not found, return null. JSON only: {"matched_name":string,"confidence":"high"|"medium"|"low","google":{"rating":number|null,"reviews":number|null,"source_url":string|null,"source_quote":string|null},"tripadvisor":{"rating":number|null,"reviews":number|null,"source_url":string|null,"source_quote":string|null}}`;
    const extra=await (opts.runLLM??runLLM)(focused,opts),answer=extractJSON(extra.text);
    out.recoveryAttempts=1;
    out.llm.recovery={provider:extra.provider,model:extra.model,usage:extra.usage??null,webSearchCalls:extra.webSearchCalls??null};
    if(answer&&answer.confidence!=='low'&&nameSimilarity(hotel.name,answer.matched_name)>=0.7){
     const extraSources=[...(extra.sources??[]),...(extra.citations??[])];
     for(const platform of missing){const recovered=assessRating(answer[platform],answer,platform,hotel,extraSources,opts.allowUnverified);if(recovered.value){out[platform]=recovered.value;out.rejections[platform]=null;}}
     out.sources.push(...extraSources);out.citations.push(...(extra.citations??[]));
    }
   }catch{/* Keep the useful scores from the first search. */}
  }
  if(!out.google&&!out.tripadvisor)return {...out,error:'No valid platform rating found'};
  if(opts.persistCache!==false)cache.set(key,out);return out;
 }catch(e){return {error:e.message,rejections:{google:'Rating search unavailable',tripadvisor:'Rating search unavailable'}};}
}
