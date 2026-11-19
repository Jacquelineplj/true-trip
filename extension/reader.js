// Shared by the extension and the real-browser capture/test runner.
(() => {
  const txt = (el, sel) => (sel ? el.querySelector(sel) : el)?.textContent?.replace(/\s+/g, ' ').trim() || null;
  const money = (s) => {
    const matches = [...String(s ?? '').matchAll(/(US\$|CA\$|A\$|USD|EUR|GBP|[$€£])\s*([\d,]+(?:\.\d+)?)/g)];
    const m = matches.at(-1);
    return m ? { amount: Number(m[2].replace(/,/g, '')), currency: ({'US$':'USD','$':'USD',USD:'USD','CA$':'CAD','A$':'AUD','€':'EUR',EUR:'EUR','£':'GBP',GBP:'GBP'})[m[1]] } : null;
  };
  function datePair(checkin,checkout,datesSource){
    const valid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
    return valid(checkin)&&valid(checkout)&&Date.parse(checkout)>Date.parse(checkin)?{checkin,checkout,datesSource}:null;
  }
  function stayDates(doc,u){
    const direct=datePair(u.searchParams.get('checkin'),u.searchParams.get('checkout'),'url');
    if(direct)return direct;
    const value=name=>doc.querySelector(`input[name="${name}"]`)?.value;
    const form=datePair(value('checkin'),value('checkout'),'search-form');if(form)return form;
    const dateField=side=>{
      const field=doc.querySelector(`[data-testid="date-display-field-${side}"]`);
      return field?.getAttribute('data-date')??field?.getAttribute('datetime')??field?.querySelector('[datetime]')?.getAttribute('datetime');
    };
    const fields=datePair(dateField('start'),dateField('end'),'search-form');if(fields)return fields;
    // A session-backed search can omit dates from location.href while retaining them in each priced
    // hotel link. Only current property cards count; never inspect arbitrary calendar cells/date offers.
    const candidates=new Map();let count=0;
    for(const card of doc.querySelectorAll('[data-testid="property-card"]')){
      if(!Number.isFinite(money(txt(card,'[data-testid="price-and-discounted-price"]'))?.amount))continue;
      const anchor=card.querySelector('a[data-testid="title-link"]')??card.querySelector('a[href*="/hotel/"]');
      try{
        const link=new URL(anchor?.getAttribute('href')??'',u);
        if(link.protocol!=='https:'||!(link.hostname==='booking.com'||link.hostname.endsWith('.booking.com'))||!link.pathname.startsWith('/hotel/'))continue;
        const pair=datePair(link.searchParams.get('checkin'),link.searchParams.get('checkout'),'hotel-links');if(!pair)continue;
        const nights=txt(card,'[data-testid="price-for-x-nights"]')?.match(/(\d+)\s+nights?/i)?.[1];
        if(nights&&Number(nights)!==(Date.parse(pair.checkout)-Date.parse(pair.checkin))/86400000)continue;
        const key=pair.checkin+'|'+pair.checkout;
        const entry=candidates.get(key)??{...pair,count:0};entry.count++;candidates.set(key,entry);count++;
      }catch{/* Invalid or partial hotel links are not date evidence. */}
    }
    const winner=[...candidates.values()].sort((a,b)=>b.count-a.count)[0];
    if(winner&&winner.count>count/2)return {checkin:winner.checkin,checkout:winner.checkout,datesSource:winner.datesSource};
    return {checkin:null,checkout:null,datesSource:null};
  }
  function readContext(doc = document, url = location.href) {
    const u = new URL(url), p = u.searchParams;
    return { city: p.get('ss') || (txt(doc, 'h1') ?? '').split(':')[0].trim(), ...stayDates(doc,u), currency: p.get('selected_currency') || 'USD', source: u.hostname };
  }
  function cardLocation(card){
    const el=card.querySelector('[data-coords]')??card.querySelector('[data-latitude][data-longitude]');
    const pair=el?.getAttribute?.('data-coords')?.split(',');
    const lat=Number(pair?.[0]??el?.getAttribute?.('data-latitude')),lon=Number(pair?.[1]??el?.getAttribute?.('data-longitude'));
    return el&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?{lat,lon}:null;
  }
  function readCard(card, i) {
    const priceText = txt(card, '[data-testid="price-and-discounted-price"]');
    const price = money(priceText);
    const taxesText = txt(card, '[data-testid="taxes-and-charges"]') ?? '';
    const priceIncludesTaxes = /includes taxes|taxes and (?:charges|fees) included/i.test(taxesText);
    const tax = priceIncludesTaxes ? 0 : money(taxesText)?.amount ?? null;
    const review = txt(card, '[data-testid="review-score"]') ?? '';
    const nightsText = txt(card, '[data-testid="price-for-x-nights"]');
    return {
      location:cardLocation(card), id: `card-${i}`, name: txt(card, '[data-testid="title"]') ?? txt(card, 'h3') ?? txt(card, 'h2'),
      price: price?.amount ?? null, currency: price?.currency ?? null, priceIncludesTaxes, tax,
      priceText, taxesText, nightsText,
      priceWarning: /per night|\/night/i.test(priceText ?? '') ? 'per-night price needs a stay total' : null,
      bookingScore: Number(review.match(/(?:Scored\s*)?(\d{1,2}(?:\.\d)?)/i)?.[1]) || null,
      bookingReviews: Number(review.match(/([\d,]+)\s+reviews?/i)?.[1]?.replace(/,/g, '')) || null,
      address: txt(card, '[data-testid="address"]'), distanceText: txt(card, '[data-testid="distance"]'),
      url: card.querySelector('a[data-testid="title-link"]')?.href ?? card.querySelector('a[href*="/hotel/"]')?.href ?? null,
    };
  }
  globalThis.TrueTripReader = { readContext, readCard, money };
})();
