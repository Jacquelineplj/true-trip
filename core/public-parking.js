import {verifyParking,describesOffSiteParkingOnly} from './verify.js';
export const DEFAULT_PUBLIC_PARKING_PER_NIGHT=50;
export const PUBLIC_PARKING_RADIUS_M=1000;

// Older model answers can say "none" without a conclusive no-parking quote.
// Price that uncertainty explicitly instead of treating it as a verified policy.
export function needsDefaultPublicParking(parking){
 return parking?.status==='unknown'&&parking.type==='none'&&
  /^https?:\/\//i.test(parking.sourceUrl??'')&&parking.reason?.startsWith('hotel reports');
}

export function hasNoOnSiteParkingPolicy(parking){
 if(parking?.status==='unknown'&&!parking.reason?.startsWith('hotel reports'))return false;
 const p=parking?.onSitePolicy??parking;
 const quote=String(p?.quote??'').trim().replace(/’/g,"'");
 return (p?.type==='none'||parking?.type==='none')&&/^https?:\/\//i.test(p?.sourceUrl??'')&&
  (/no on[ -]?site parking|(?:does not|doesn't|do not|don't) (?:offer|have|provide).{0,45}parking|no (?:hotel|kasa)[ -]managed parking|parking (?:is not|isn't|not) available|no parking (?:available|facilities)|\bno parking[.!]?$/i.test(quote)||describesOffSiteParkingOnly(quote));
}
function sourceKey(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.hostname.replace(/^www\./,'')+u.pathname.replace(/\/$/,''):null;}catch{return null;}}
export function verifyPublicParking(claim,evidence){
 const unknown=reason=>({status:'unknown',perNight:null,type:'public',scope:'off-site',reason});
 if(!claim||typeof claim!=='object')return unknown('No public parking claim');
 const fee=claim.parking_fee_per_night==null?null:Number(claim.parking_fee_per_night);
 const age=Date.now()-Date.parse(evidence?.searchedAt);
 if(evidence?.status!=='searched'||!(evidence.webSearchCalls>0)||!Number.isFinite(age)||age>7*86400000||age < -60000)return unknown('Missing or expired public parking search evidence');
 if(!['number','string'].includes(typeof claim.parking_fee_per_night)||!Number.isFinite(fee)||fee<0||fee>250)return unknown('No usable public parking price');
 if(String(claim.currency??'').toUpperCase()!=='USD')return unknown('Public parking price is not USD');
 if(!['overnight','24h'].includes(claim.rate_basis))return unknown('Public parking rate does not cover an overnight or 24-hour stay');
 // An OTA listing's "parking is available nearby" price names no garage; it is accepted with its quoted distance (user decision, 2026-11-18).
 const otaListing=claim.listing==='ota';
 if(typeof claim.facility_name!=='string'||!claim.facility_name.trim()||(!otaListing&&(typeof claim.facility_address!=='string'||!claim.facility_address.trim())))return unknown('Public parking facility is not identified');
 if(typeof claim.distance_m!=='number'||!Number.isFinite(claim.distance_m)||claim.distance_m<0||claim.distance_m>PUBLIC_PARKING_RADIUS_M)return unknown('Public parking proximity is unknown or beyond 1 km');
 const key=sourceKey(claim.source_url),sources=[...(evidence.sources??[]),...(evidence.citations??[])];
 if(!key||!sources.some(s=>sourceKey(s.url)===key))return unknown('No supporting searched public parking source');
 const quote=typeof claim.source_quote==='string'?claim.source_quote.slice(0,700):'';
 if(/\b(?:in|enter|entry) after\b|\b(?:out|exit) (?:before|by)\b/i.test(quote))return unknown('Time-restricted parking special does not establish a normal overnight/24-hour rate');
 if(!/overnight|24\s*(?:hours?|hrs?|h)\b|per (?:night|day)|\/(?:night|day)|daily/i.test(quote))return unknown('Public parking quote has no overnight/daily rate context');
 if(/per hour|\/\s*(?:hour|hr)\b|\bhourly\b/i.test(quote))return unknown('Public parking quote contains an hourly-only or ambiguous rate');
 if(/\b(?:event|restaurant|wedding|package|early bird)\b|\b(?:I|we) (?:paid|parked|recommend)\b/i.test(quote))return unknown('Public parking quote describes an event, package or personal review');
 const amounts=[...quote.matchAll(/(?:\$|USD\s*)([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:USD|US\$)/gi)].map(m=>Number((m[1]??m[2]).replace(/,/g,'')));
 if(fee>0&&!amounts.includes(fee))return unknown('Public parking quote does not state the returned price');
 if(fee===0&&(!/\bfree\b.{0,30}\bparking\b|\bparking\b.{0,30}\bfree\b/i.test(quote)||/\b(?:not|no)\b.{0,20}\bfree\b|free.{0,30}not available/i.test(quote)))return unknown('Free public parking has no explicit quote');
 if(claim.confidence==='low')return unknown('Low-confidence public parking price');
 return {status:'ok',perNight:fee,type:'public',scope:'off-site',sourceUrl:claim.source_url,quote,
  facility:{name:claim.facility_name.trim(),address:otaListing?null:claim.facility_address.trim(),distanceM:claim.distance_m,distanceEstimated:true,rateBasis:claim.rate_basis,...(otaListing?{listing:'ota'}:{})},
  reason:otaListing?'Nearby parking price from the hotel\'s OTA listing via GPT web search; garage not named, not independently verified':'Nearby public parking from GPT web search; not independently verified'};
}
export function defaultPublicParking(policy,lookupReason='No usable nearby public parking price found'){
 const onSitePolicy=policy.onSitePolicy??{type:'none',sourceUrl:policy.sourceUrl,quote:policy.quote,evidence:policy.evidence};
 return {status:'estimated',perNight:DEFAULT_PUBLIC_PARKING_PER_NIGHT,type:'none',scope:'off-site',estimated:true,sourceUrl:null,quote:null,onSitePolicy,
  estimate:{method:'default-public-parking',perNight:DEFAULT_PUBLIC_PARKING_PER_NIGHT},
  publicLookup:{status:'unavailable',reason:lookupReason},reason:'No usable nearby public parking price found; default $50/night estimate'};
}
export function parkingFromProvider(result){
 const p=result??{};
 const parking={...verifyParking(p.claim,p.requiresEvidence?(p.evidence??null):undefined),evidence:p.evidence??null,provider:p.provider??null,cached:p.cached??false,costUsd:p.costUsd??null,llm:p.llm??null};
 if(p.typeUnspecified)parking.typeUnspecified=true;
 if(p.error)parking.reason=`provider error: ${p.error}`;
 if(!hasNoOnSiteParkingPolicy(parking))return needsDefaultPublicParking(parking)?defaultPublicParking(parking,'Hotel parking availability is unconfirmed; using a default estimate'):parking;
 const nearby=p.publicParking;
 const verified=verifyPublicParking(nearby?.claim,nearby?.evidence);
 if(verified.status==='ok')return {...verified,evidence:nearby.evidence,provider:nearby.provider??'gpt-web-search',llm:nearby.llm??null,
  onSitePolicy:{type:'none',sourceUrl:parking.sourceUrl,quote:parking.quote,evidence:parking.evidence},publicLookup:{status:'found'}};
 return defaultPublicParking(parking,nearby?.error??verified.reason);
}
