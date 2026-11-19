// Verifier: checks LLM parking claims and guards against double counting.
// Design rules from the proposal: unknown fees are flagged, never $0; parking claims carry a source link.

const MAX_PLAUSIBLE_PER_NIGHT = 250;

// OTA listings phrase off-site parking as "Parking is available nearby and costs USD 26 per day (200 ft away)".
// Such a quote describes a nearby garage, not the hotel's own parking, unless it also names valet/on-site parking.
export function describesOffSiteParkingOnly(quote){
  const q=String(quote??'');
  return /\bparking is available nearby\b|\bnearby (?:public )?(?:parking|garage|lot)\b|\b\d+\s*(?:ft|feet|m|meters|metres|yards?)\s+away\b|\boff[ -]site parking\b|\badjacent (?:public )?garage\b/i.test(q)&&!/\bvalet\b|\bon[ -]site\b/i.test(q);
}

// Repair model field inconsistencies only when the quoted policy explicitly
// establishes free guest parking, without off-site, conditional or paid terms.
function statesFreeParking(quote){
  if(!quote)return false;
  const explicit=/\b(?:free|complimentary)\s+(?:(?:on[ -]site|private|self|valet|guest|hotel)[ -]+){0,3}parking\b|\bparking\s*[:–-]?\s*(?:(?:is|available|provided|on[ -]site|for guests)\s+){0,3}(?:free|complimentary)\b/i.test(quote);
  const excluded=/\b(?:no|not)\b.{0,35}\b(?:free|complimentary)\b|\b(?:free|complimentary)\b.{0,45}\b(?:not available|not provided|unavailable)\b|off[ -]site|nearby|adjacent|public (?:garage|parking)|street parking|\b(?:package|purchase|restaurant|wedding|event|hourly|loyalty|elite|members? only)\b|\b(?:free|complimentary)\b.{0,35}\b(?:first|up to|hours?|minutes?|with|when|if)\b/i.test(quote);
  const paid=[...quote.matchAll(/(?:\$|USD\s*)([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:USD|US\$)/gi)].some(m=>Number((m[1]??m[2]).replace(/,/g,''))>0);
  return explicit&&!excluded&&!paid;
}

/**
 * @param {object|null} claim  { parking_fee_per_night, currency, parking_type, source_url, source_quote, confidence }
 * @returns {{ status:'ok'|'unknown'|'flagged', perNight:number|null, type:string, sourceUrl:string|null, quote:string|null, reason:string }}
 */
export function verifyParking(claim, evidence = undefined) {
  const base = { perNight: null, type: 'unknown', sourceUrl: null, quote: null };
  if (!claim || typeof claim !== 'object') return { status: 'unknown', ...base, reason: 'no claim' };
  const url = typeof claim.source_url === 'string' && /^https?:\/\//i.test(claim.source_url) ? claim.source_url : null;
  let type = String(claim.parking_type ?? 'unknown').toLowerCase();
  let fee = claim.parking_fee_per_night == null ? null : Number(claim.parking_fee_per_night);
  const quote = typeof claim.source_quote === 'string' ? claim.source_quote.slice(0, 300) : null;

  if (evidence?.status === 'searched') {
    const age=Date.now()-Date.parse(evidence.searchedAt);
    if(!(evidence.webSearchCalls>0) || !Number.isFinite(age) || age>7*86400000 || age < -60000 || !url)
      return {status:'unknown',...base,type,sourceUrl:url,quote,reason:'missing or expired GPT search evidence'};
  } else if (evidence !== undefined && (!evidence || evidence.status !== 'fetched' || evidence.propertyMatched !== true || !['primary','secondary'].includes(evidence.tier) || !Number.isFinite(Date.parse(evidence.fetchedAt)) || Date.now()-Date.parse(evidence.fetchedAt)>(evidence.tier==='primary'?86400000:21600000) || Date.parse(evidence.fetchedAt)>Date.now()+60000)) return {status:'unknown',...base,type,sourceUrl:url,quote,reason:'current source-page evidence not verified'};
  if (type === 'none') return { status: 'unknown', ...base, type, sourceUrl: url, quote, reason: 'hotel reports no on-site parking; off-site cost unknown' };
  if (!url) return { status: 'unknown', ...base, type, quote, reason: 'no source URL' };
  const explicitFree=statesFreeParking(quote);
  const normalizedFreeParking=(fee==null||fee===0)&&explicitFree&&(type!=='free'||fee!==0);
  if((fee==null||fee===0)&&explicitFree){type='free';fee=0;}
  if (fee == null || Number.isNaN(fee)) return { status: 'unknown', ...base, type, sourceUrl: url, quote, reason: 'fee not found at source' };
  if (fee === 0 && type !== 'free') return { status: 'unknown', ...base, type, sourceUrl: url, quote, reason: '$0 claimed but not stated as free' };
  if (fee === 0 && !explicitFree) return { status: 'unknown', ...base, type, sourceUrl: url, quote, reason: 'free parking claimed without an unconditional guest-parking quote' };
  if (fee < 0 || fee > MAX_PLAUSIBLE_PER_NIGHT) return { status: 'flagged', ...base, perNight: fee, type, sourceUrl: url, quote, reason: 'implausible fee' };
  if (claim.currency && String(claim.currency).toUpperCase() !== 'USD') return { status: 'flagged', ...base, perNight: fee, type, sourceUrl: url, quote, reason: `non-USD fee (${claim.currency})` };
  if (!['self', 'valet', 'free'].includes(type)) return { status: 'flagged', ...base, perNight: fee, type, sourceUrl: url, quote, reason: 'unknown parking type' };
  if (fee > 0 && (!quote || ![...quote.matchAll(/(?:\$|USD\s*)([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:USD|US\$)/gi)].some((m) => Number((m[1]??m[2]).replace(/,/g, '')) === fee))) return { status: 'flagged', ...base, perNight: fee, type, sourceUrl: url, quote, reason: 'quoted evidence does not state this fee' };
  if (quote && (/\b(?:I|we) (?:paid|parked|strongly recommend|recommend)\b/i.test(quote) || describesOffSiteParkingOnly(quote) || (['self','free'].includes(type) && /not (?:a )?hotel[ -]operated|off[ -]site|nearby public|adjacent (?:public )?garage/i.test(quote))))
    return {status:'flagged',...base,perNight:fee,type,sourceUrl:url,quote,reason:'quote describes a guest review or an off-site garage, not an on-site guest rate'};
  if (claim.confidence === 'low') return { status: 'flagged', ...base, perNight: fee, type, sourceUrl: url, quote, reason: 'low-confidence claim; verify at source' };
  return { status: 'ok', perNight: fee, type, sourceUrl: url, quote,...(normalizedFreeParking?{normalizedFreeParking:true}:{}), reason: evidence?.status==='searched' ? 'GPT web search; not independently verified' : claim.confidence ? `confidence ${claim.confidence}` : 'ok' };
}

/**
 * Double-counting guard for a cost breakdown.
 * Returns a list of problems (empty = fine).
 */
export function checkDoubleCounting(cost, { priceIncludesTaxes = false } = {}) {
  const problems = [];
  const b = cost?.breakdown ?? {};
  if (cost.mode === 'drive' && b.rides && (b.rides.low > 0 || b.rides.high > 0)) problems.push('ride cost added in drive mode');
  if (cost.mode === 'ride' && b.parking) problems.push('parking added in ride mode');
  if (priceIncludesTaxes && b.tax) problems.push('tax added although page price includes taxes');
  return problems;
}
