// Booking availability-table reader. No reservation controls are clicked or changed.
(() => {
  const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const amount = s => {
    const m = clean(s).match(/(?:US\$|USD\s*|\$)\s*([\d,]+(?:\.\d+)?)/);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };
  const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
  function parseTaxes(text, { price, nights = 1, adults = 2 } = {}) {
    const raw = clean(text);
    const unknown = reason => ({ status: 'unknown', tax: null, reason, text: raw });
    if (!Number.isFinite(price) || price < 0) return unknown('room price unavailable');
    if (/all taxes.*included|includes taxes and (?:fees|charges)|^Included:/i.test(raw) && !/excluded|not included/i.test(raw)) return {status:'ok',tax:0,text:raw,components:[],included:true};
    const excluded = raw.match(/(?:Excluded|Not included)\s*:\s*(.*)/i)?.[1];
    if (!excluded) return unknown('no explicit excluded-tax statement');
    // English/USD MVP. Every excluded component must have an explicit amount/rate.
    const parts = excluded.split(/,\s*(?=(?:US\$|USD|\$|\d+(?:\.\d+)?\s*%))/).filter(Boolean);
    let tax = 0; const components = [];
    for (const part of parts) {
      if (/€|£|CAD|CA\$|AUD|A\$|payable|may apply|not calculated|not included in (?:the )?(?:price|total)/i.test(part)) return unknown('unsupported or unspecified charge');
      const percent = part.match(/^(\d+(?:\.\d+)?)\s*%\s+(.+)/);
      const fixed = amount(part);
      if (percent) {
        if (/per person|per night|compound|including tax/i.test(part)) return unknown('unsupported percentage basis');
        const value = price * Number(percent[1]) / 100;
        tax += value; components.push({text:part,amount:round(value),rate:Number(percent[1])});
      } else if (fixed != null) {
        let multiplier = /per night|\/night/i.test(part) ? nights : 1;
        if (/per person|per guest/i.test(part)) multiplier *= adults;
        const value = fixed * multiplier;
        tax += value; components.push({text:part,amount:round(value)});
      } else return unknown('unrecognized excluded charge');
    }
    return components.length ? {status:'ok',tax:round(tax),text:raw,components,included:false} : unknown('no tax components');
  }
  function parseParking(text,sourceUrl,section='Booking parking policy'){
    const raw=clean(text);
    // Only inspect explicit policy/amenity sections, never guest reviews or room prices.
    const sentences=raw.split(/(?<=[.!?])\s*(?=[A-Z])/ );
    const candidates=[];
    for(const sentence of sentences){
      if(!/parking/i.test(sentence)||/per hour|\/\s*(?:hour|hr)\b|hourly|package|early bird|restaurant|event|\b(?:I|we) (?:paid|parked)|off[ -]site|nearby|public parking.*near/i.test(sentence))continue;
      let fee=null;
      const rate=sentence.match(/parking.{0,160}?(?:US\$|USD\s*|\$)\s*(\d+(?:\.\d{1,2})?)\s*(?:per (?:vehicle|car),?\s*)?(?:(?:per|a|each|\/)\s*(?:night|day)|for (?:24 hours|one night))/i);
      if(rate)fee=Number(rate[1]);
      if(/(?:free|complimentary)\s+(?:(?:private|self|on[ -]site)\s+)*parking|parking\s+is\s+free/i.test(sentence)&&!/not free|no free|free.*(?:member|package|reservation.*required)/i.test(sentence))fee=0;
      if(fee==null||/€|£|CAD|CA\$|AUD|A\$/i.test(sentence))continue;
      const type=fee===0?'free':/valet/i.test(sentence)?'valet':'self';
      candidates.push({claim:{parking_fee_per_night:fee,currency:'USD',parking_type:type,source_url:sourceUrl,source_quote:sentence.trim(),confidence:'high'},sourceUrl,fetchedAt:new Date().toISOString(),section,typeUnspecified:fee>0&&!/self|valet/i.test(sentence)});
    }
    return candidates.sort((a,b)=>a.claim.parking_fee_per_night-b.claim.parking_fee_per_night)[0]??null;
  }
  function readParking(doc,sourceUrl){
    const selectors=['#important_info','#fine_print','[data-testid="property-section--fine-print"]','#hotelFacilitiesInc','[data-testid="property-section--facilities"]'];
    const candidates=[];
    for(const selector of selectors)for(const section of doc.querySelectorAll(selector)){
      const result=parseParking(section.textContent,sourceUrl,selector);if(result)candidates.push(result);
    }
    return candidates.sort((a,b)=>a.claim.parking_fee_per_night-b.claim.parking_fee_per_night)[0]??null;
  }
  // Scope coordinates to the hotel header or Hotel/LodgingBusiness structured data.
  function readLocation(doc = document) {
    const text = selector => clean(doc.querySelector(selector)?.textContent);
    let address = text('#showMap2 .hp_address_subtitle') || text('.hp_address_subtitle') || text('[data-testid="PropertyHeaderAddressDesktop-wrapper"]') || text('#hotel_address [itemprop="address"]') || null;
    const point = (lat, lon) => lat != null && lon != null && String(lat).trim() && String(lon).trim() && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180 ? {lat:Number(lat),lon:Number(lon)} : null;
    const map = doc.querySelector('#hotel_address [data-atlas-latlng], #showMap2[data-atlas-latlng], #hotel_sidebar_static_map[data-atlas-latlng]');
    const pair = map?.getAttribute('data-atlas-latlng')?.split(',');
    let location = point(pair?.[0], pair?.[1]);
    if(!location){
      const attribute=selector=>{const el=doc.querySelector(selector);return el?.getAttribute('content')??el?.textContent;};
      location=point(attribute('[itemprop="geo"] [itemprop="latitude"]'),attribute('[itemprop="geo"] [itemprop="longitude"]'));
    }
    if(!location){
      const href=doc.querySelector('#showMap2[href], #hotel_address a[href*="maps"]')?.getAttribute('href');
      try{
        const u=new URL(href,'https://www.booking.com');
        const marker=u.searchParams.get('query')?.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
        location=point(u.searchParams.get('mlat'),u.searchParams.get('mlon'))??point(marker?.[1],marker?.[2]);
      }catch{/* Unsupported map link; continue to hotel structured data. */}
    }
    const nodes=[];
    const collect=value=>{if(Array.isArray(value)){value.forEach(collect);return;}if(!value||typeof value!=='object')return;nodes.push(value);collect(value['@graph']);collect(value.mainEntity);};
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try{collect(JSON.parse(script.textContent));}catch{/* Invalid data does not block other sources. */}
    }
    const linked=value=>value?.['@id']?nodes.find(n=>n['@id']===value['@id']&&Object.keys(n).length>1)??value:value;
    for(const node of nodes){
      if(![node?.['@type']].flat().some(t=>/^(Hotel|LodgingBusiness|Resort|Motel|Hostel)$/.test(String(t).replace(/^https?:\/\/schema\.org\//,''))))continue;
      const geo=linked(node.geo);
      location ??= point(geo?.latitude,geo?.longitude);
      const a=linked(node.address);
      address ||= typeof a==='string'?clean(a):a?.streetAddress?[a.streetAddress,a.addressLocality,a.addressRegion,a.postalCode,typeof a.addressCountry==='string'?a.addressCountry:a.addressCountry?.name].filter(Boolean).join(', '):null;
    }
    address = address?.replace(/\s*[–—-]\s*(?:Great location|Excellent location|Good location|show map).*$/i,'').trim() || null;
    return {address,location};
  }
  function readCheapestRoom(doc = document, url = location.href) {
    const u = new URL(url), params = u.searchParams;
    const nights = Math.round((Date.parse(params.get('checkout')) - Date.parse(params.get('checkin'))) / 86400000);
    const sourceUrl = new URL(u.origin+u.pathname);
    for(const key of ['checkin','checkout','group_adults','group_children','no_rooms','selected_currency']) if(params.has(key)) sourceUrl.searchParams.set(key,params.get(key));
    const base = {source:'booking-availability',sourceUrl:sourceUrl.href,checkin:params.get('checkin'),checkout:params.get('checkout'),nights,selection:'cheapest available room',capturedAt:new Date().toISOString(),...readLocation(doc),parking:readParking(doc,sourceUrl.href)};
    const fail = reason => ({...base,status:'unknown',tax:null,reason});
    if (!(nights > 0)) return fail('stay dates unavailable');
    if (Number(params.get('no_rooms') || 1) !== 1 || Number(params.get('group_children') || 0) !== 0) return fail('only one room with adult guests is supported');
    if (params.get('selected_currency') && params.get('selected_currency') !== 'USD') return fail('only USD supported');
    const rows = [...doc.querySelectorAll('#hprt-table tr[data-block-id]')];
    const candidates = rows.map(row => {
      const priceCell = row.querySelector('.hprt-table-cell-price');
      const priceText = clean(priceCell?.querySelector('.bui-price-display__value, [data-testid="price-and-discounted-price"]')?.textContent);
      const selector = row.querySelector('select.hprt-nos-select, select[name*="nr_rooms"]');
      const available = !selector || [...selector.options].some(o => Number(o.value) > 0 && !o.disabled);
      return {row,price:amount(priceText),priceText,available};
    }).filter(c => c.available && c.price != null && !/€|£|CA\$|A\$/i.test(c.priceText)).sort((a,b)=>a.price-b.price);
    if (!candidates.length) return fail('availability table has no priced rooms');
    const best = candidates[0];
    const taxesText = clean(best.row.querySelector('.hptr-taxinfo-block, [data-testid="taxes-and-charges"]')?.textContent);
    const taxes = parseTaxes(taxesText,{price:best.price,nights,adults:Number(params.get('group_adults') || 2)});
    return {...base,...taxes,price:best.price,currency:'USD',blockId:best.row.getAttribute('data-block-id'),roomName:clean(best.row.querySelector('.hprt-roomtype-link')?.textContent) || 'Lowest-priced available room',accommodationTotal:taxes.tax == null ? null : round(best.price+taxes.tax)};
  }
  globalThis.TrueTripHotelTaxes = {parseTaxes,readCheapestRoom,readLocation,parseParking,readParking};
})();
