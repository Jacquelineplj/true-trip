// TrueTrip content script: reads Booking.com result cards, asks the local server for parking / commute / ratings /
// true trip cost, and inserts an "ADDED BY TRUETRIP" block under each card. Never changes the page's own data.
(() => {
  if (window.__truetripLoaded) return;
  window.__truetripLoaded = true;
  const owner=document.documentElement;
  if(owner.hasAttribute('data-truetrip-active'))return;
  owner.setAttribute('data-truetrip-active','1');

  const HAS_EXT = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  const DEFAULTS = {
    enabled: true,
    anchors: 'MIT Media Lab, 75 Amherst St, Cambridge MA; Boston Convention and Exhibition Center',
    mode: 'drive', timeValue: 20, roundTrips: 1, maxCommuteMin: 0, budget: 0,
    parking: true, ratings: false, deepSearch: false, serverUrl: 'http://localhost:8787', maxCards: 5,
  };

  // ---------- settings + transport ----------
  const pageLoadId=crypto.randomUUID();
  const getSettings = () => (HAS_EXT ? globalThis.TrueTripEconomySettings(DEFAULTS) : Promise.resolve({ ...DEFAULTS }));
  function extensionRequest(type,payload,timeoutMs){
    return new Promise(resolve=>{
      const timer=setTimeout(()=>resolve({ok:false,error:`${type} timed out; refresh the page to retry`}),timeoutMs);
      try{chrome.runtime.sendMessage({type,payload},r=>{clearTimeout(timer);resolve(r??{ok:false,error:chrome.runtime.lastError?.message??'Extension did not respond; reload TrueTrip and refresh this page'});});}
      catch(e){clearTimeout(timer);resolve({ok:false,error:e.message});}
    });
  }
  async function call(type, payload) {
    const context=payload?.context??state.context??readContext();
    payload={...payload,pageLoad:{id:pageLoadId,site:location.hostname.endsWith('booking.com')?'booking':'demo',city:context?.city,checkin:context?.checkin,checkout:context?.checkout}};
    const timeoutMs=['notes','reprice'].includes(type)?10000:180000;
    if(HAS_EXT)return extensionRequest(type,payload,timeoutMs);
    try {
      const r = await fetch(`${DEFAULTS.serverUrl}/${type}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),signal:AbortSignal.timeout(timeoutMs) });
      return { ok: r.ok, data: await r.json() };
    } catch (e) { return { ok: false, error: `Cannot reach TrueTrip server: ${e.message}` }; }
  }
  async function health() {
    if(HAS_EXT)return extensionRequest('health',undefined,7000);
    try { const r = await fetch(`${DEFAULTS.serverUrl}/health`,{signal:AbortSignal.timeout(7000)}); return { ok: r.ok, data: await r.json() }; } catch (e) { return { ok: false, error: e.message }; }
  }

  const { readContext, readCard } = globalThis.TrueTripReader;
  const anchorsOf = (s) => String(s ?? '').split(/;|\n/).map((x) => x.trim()).filter(Boolean).slice(0, 3);

  // ---------- rendering ----------
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const usd = (x) => `$${Math.round(x)}`;
  const containerOf = (card) => card.closest('[data-testid="property-card-container"]') ?? card;

  function averageCommute(hotel){
    const legs=hotel.commute;
    if(!legs?.length||legs.some(c=>!Number.isFinite(c.durationMin)||c.durationMin<0))return null;
    return legs.reduce((sum,c)=>sum+c.durationMin,0)/legs.length;
  }
  function renderBlock(block, h, settings) {
    block.classList.remove('tt-deferred');
    block.dataset.ttState='complete';
    const p = h.parking;
    let parking;
    if (p.status === 'estimated') parking = `Parking: <b>$${p.perNight.toFixed(2)}/night default estimate</b> × ${h.nights} = $${(p.perNight*h.nights).toFixed(2)} <span class="tt-muted" title="${esc(p.publicLookup?.reason??p.reason)}">(no usable nearby public parking price found; not a quoted rate)</span>${p.onSitePolicy?.sourceUrl?` <a href="${esc(p.onSitePolicy.sourceUrl)}" target="_blank" rel="noopener">hotel parking policy</a>`:''}`;
    else if(p.status==='ok'&&p.type==='public')parking=`Parking: nearby public parking <b>${usd(p.perNight)}/${p.facility.rateBasis==='24h'?'24h':'night'}</b> × ${h.nights} = ${usd(p.perNight*h.nights)} <span class="tt-muted">(${esc(p.facility.name)}; approx. ${Math.round(p.facility.distanceM)} m away; GPT web search)</span> <a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">source</a>`;
    else if (p.status === 'ok') parking = `Parking: ${usd(p.perNight)}/night x ${h.nights} = ${usd(p.perNight * h.nights)} (${esc(p.typeUnspecified?'guest parking':p.type)}; ${p.evidence?.status === 'searched' ? 'GPT web search' : p.evidence?.status === 'fetched' ? (p.provider==='booking-page'?'Booking page checked':p.evidence.tier === 'primary' ? 'hotel source checked' : 'OTA source checked') : 'LLM lookup, verify source'}) <a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">source</a>`;
    else if (p.status === 'flagged') parking = `<span class="tt-warn">Parking: ${usd(p.perNight)}/night flagged (${esc(p.reason)})</span> <a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">source</a>`;
    else if (p.type === 'none' && p.sourceUrl && p.reason.startsWith('hotel reports')) parking = `Parking: no on-site parking <span class="tt-muted">(off-site cost unknown)</span> <a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">source</a>`;
    else parking = `<span class="tt-warn">Parking: unknown</span> <span class="tt-muted">(${esc(p.reason)})</span>`;
    const rides = h.costRide.breakdown.rides;
    const hrs = h.costRide.travelHours;
    const avg=averageCommute(h);
    const commute = h.commute.map((c) => `${esc(c.anchor.split(',')[0])}: ${c.durationMin == null ? esc(c.reason??'location unavailable') : (c.estimated?'≈':'')+Math.round(c.durationMin) + ' min'}`).join(' · ');
    const g = h.ratings.google, t = h.ratings.tripadvisor;
    const rating = (r, label) => (r?.rating != null ? `${label} ${r.rating}${r.via ? ` <span class="tt-muted" title="${esc(r.verificationNote??'')}">(via ${esc(r.via)}${r.attribution==='model-assigned'?'; model-attributed':''})</span>` : ''}${r.verification==='model-reported'?` <span class="tt-muted" title="${esc(r.verificationNote)}">(unverified; model-reported)</span>`:''}${r.url ? ` <a href="${esc(r.url)}" target="_blank" rel="noopener">↗</a>` : ''}` : `<span title="${esc(h.ratings.rejections?.[label.toLowerCase()]??'No sourced rating available')}">${label} n/a</span>`);
    const unverified = [g, t].some((r) => r?.source?.includes('llm')) ? ' <span class="tt-muted">(via LLM search, unverified)</span>' : '';
    const c = h.cost;
    const pendingTax=h.taxLookup?.status==='pending'&&c.unknowns.includes('taxes and fees');
    const otherMissing=c.unknowns.filter(x=>x!=='taxes and fees');
    const total = c.total
      ? `True trip cost (${settings.mode}): about <b>${usd(c.total.mid)}</b>${c.total.low !== c.total.high ? ` <span class="tt-muted">(${usd(c.total.low)}-${usd(c.total.high)})</span>` : ''}`
      : pendingTax?`<span class="tt-muted">True trip cost (${settings.mode}): waiting for taxes</span>${otherMissing.length?` <span class="tt-muted">(also missing: ${esc(otherMissing.join(', '))})</span>`:''}`
      : `<span class="tt-warn">True trip cost (${settings.mode}): incomplete</span> <span class="tt-muted">(unknown: ${esc(c.unknowns.join(', '))})</span>`;
    const alt = settings.mode === 'drive' ? h.costRide : h.costDrive;
    const altLine = alt.total ? ` <span class="tt-muted">· if you ${settings.mode === 'drive' ? 'skip the car' : 'drive'}: ${usd(alt.total.mid)}</span>` : '';
    const taxMessage=h.taxEvidence?.tax==null?'Tax amount unavailable; total remains incomplete.':h.taxEvidence.tax>0?'Tax not included in room price; added above':h.taxEvidence.included?'Tax included in room price.':'No additional tax shown.';
    block.innerHTML = `
      <div class="tt-card-header"><div class="tt-head">TrueTrip</div><span class="tt-mode">${settings.mode==='drive'?'Drive':'Ride'}</span></div>
      ${h.taxEvidence ? `<div class="tt-accommodation"><div>Lowest-priced room on hotel page: <strong>${usd(h.room)} + ${h.taxEvidence.tax == null ? 'unknown taxes/fees' : usd(h.taxEvidence.tax) + ' taxes/fees'}</strong> <a href="${esc(h.taxEvidence.sourceUrl)}" target="_blank" rel="noopener" title="${esc(h.taxEvidence.text||h.taxEvidence.reason)}">source ↗</a></div><div class="tt-tax-note tt-muted">${taxMessage}</div></div>` : ''}
      <div class="tt-data-row">${parking}</div>
      <div class="tt-data-row">Rides to your anchors: ${rides ? `<span title="Formula estimate from route distance and time, with a city factor and uncertainty range. Not a live Uber/Lyft quote; includes configured round trips to each destination.">estimated ${usd(rides.low)}-${usd(rides.high)}</span>` : 'unknown'}, about ${hrs == null ? '?' : hrs.toFixed(1)} h total travel <span class="tt-muted">(${commute})</span></div>
      <div class="tt-data-row tt-average-commute" title="Arithmetic mean of one-way driving times to all configured anchors. All anchor routes are required.">Average to anchors: ${avg==null?'unavailable':avg.toFixed(1)+' min one way'}</div>
      <div class="tt-data-row tt-ratings">Ratings: Booking ${h.bookingScore ?? '?'} · ${rating(g, 'Google')} · ${rating(t, 'Tripadvisor')}${unverified}</div>
      <div class="tt-total"><span class="tt-primary-total">${total}</span>${altLine}</div>
      ${h.taxLookup?.status==='failed'&&c.unknowns.includes('taxes and fees')?`<div class="tt-tax-retry"><span class="tt-muted">${esc(h.taxLookup.reason??'Tax details unavailable')}</span> <button type="button" class="tt-search tt-retry-tax">Retry taxes</button></div>`:''}
      ${h.overLimit?.length ? `<div class="tt-over">Over your limit: ${esc(h.overLimit.join('; '))}</div>` : ''}
      ${h.warnings?.length ? `<div class="tt-muted">${esc(h.warnings.join('; '))}</div>` : ''}`;
  }

  // ---------- main ----------
  const state = { results: new Map(), records: new Map(), inFlight: 0, queue: [], banner: null, settings: null, context: null, done: 0, total: 0, sorted: false, sortBy:'cost', revision: 0, finishTimer: null, taxPending: 0, originalSlots: new Map(), epoch: 0, autoCount: 0, nextId: 0 };

  function ensureBanner() {
    if (state.banner?.isConnected) return state.banner;
    const first = document.querySelector('[data-testid="property-card"]');
    if (!first) return null;
    const b = el('div', 'tt-banner');
    b.innerHTML = `<b>TrueTrip</b> <span class="tt-status">starting…</span> <button class="tt-sort" aria-pressed="false" disabled>Sort by true trip cost</button> <button class="tt-sort-time" aria-pressed="false" title="Shortest average one-way driving time to all anchors first; incomplete routes go last" disabled>Sort by average travel time</button> <button class="tt-restore" disabled>Restore original order</button> ${HAS_EXT ? '<button class="tt-settings">Settings</button>' : ''} <div class="tt-notes"></div>`;
    b.querySelector('.tt-sort').addEventListener('click', () => sortCards('cost'));
    b.querySelector('.tt-sort-time').addEventListener('click',()=>sortCards('time'));
    b.querySelector('.tt-restore').addEventListener('click', restoreOrder);
    b.querySelector('.tt-restore').disabled=!state.sorted;
    b.querySelector('.tt-settings')?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'open-options' }));
    containerOf(first).parentElement.prepend(b);
    state.banner = b;
    b.querySelectorAll('.tt-sort, .tt-sort-time').forEach(btn=>{btn.disabled=state.results.size<2;btn.setAttribute('aria-pressed',String(state.sorted&&(btn.classList.contains('tt-sort-time')?state.sortBy==='time':state.sortBy==='cost')));});
    setStatus(state.statusHtml??(state.total?`enriching ${state.done}/${state.total}…`:'Waiting for hotel cards…'));
    return b;
  }
  const setStatus = (html) => { state.statusHtml=html; const s = state.banner?.querySelector('.tt-status'); if (s && s.innerHTML!==html) s.innerHTML = html; };

  function restoreOrder() {
    state.sorted=false;
    state.banner?.querySelectorAll('.tt-sort, .tt-sort-time').forEach(btn=>btn.setAttribute('aria-pressed','false'));
    for(const {marker,container} of state.originalSlots.values())if(marker.isConnected&&container.isConnected)marker.after(container);
    document.querySelectorAll('.tt-rank').forEach(b=>b.remove());
    const button=state.banner?.querySelector('.tt-restore');if(button)button.disabled=true;
  }

  function sortCards(mode=state.sortBy) {
    state.sorted=true;state.sortBy=mode;
    state.banner?.querySelectorAll('.tt-sort, .tt-sort-time').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.classList.contains('tt-sort-time')?mode==='time':mode==='cost')));
    const restore=state.banner?.querySelector('.tt-restore');if(restore)restore.disabled=false;
    const entries = [...state.results.values()].filter((r) => r.container?.isConnected);
    if (!entries.length) return;
    const originalOrder=new Map([...state.originalSlots.values()].map((v,i)=>[v.container,i]));
    const value=h=>mode==='time'?averageCommute(h):h.cost.total?.mid;
    entries.sort((a, b) => { const x = value(a.hotel), y = value(b.hotel); if (x == null && y == null) return originalOrder.get(a.container)-originalOrder.get(b.container); if (x == null) return 1; if (y == null) return -1; return x - y || originalOrder.get(a.container)-originalOrder.get(b.container); });
    const parent = entries[0].container.parentElement;
    const first = [...parent.children].find((node) => node.matches('[data-testid="property-card"], [data-testid="property-card-container"]'));
    const marker = document.createComment('TrueTrip sort position');
    parent.insertBefore(marker, first ?? parent.firstChild);
    entries.forEach((e, i) => { parent.insertBefore(e.container, marker); let badge = e.block.querySelector('.tt-rank'); if (!badge) { badge = el('span', 'tt-rank'); e.block.querySelector('.tt-head').prepend(badge); } badge.textContent = `#${i + 1}`; });
    marker.remove();
    entries[0].container.scrollIntoView({ block: 'start' });
  }

  async function finish() {
    const revision=state.revision;
    const hotels = [...state.results.values()].map((r) => r.hotel);
    if(!hotels.length){
      if(state.total&&!state.inFlight&&!state.queue.length)setStatus(`${state.done}/${state.total} finished · no hotel results; see the errors on each card`);
      return;
    }
    state.banner?.querySelectorAll('.tt-sort, .tt-sort-time').forEach(btn=>{btn.disabled=hotels.length<2;});
    const r = await call('notes', { hotels, settings: pipelineSettings() });
    if(revision!==state.revision){scheduleFinish();return;}
    if (r.ok && r.data.hotels) {
      for (const hotel of r.data.hotels) {
        const result=state.results.get(hotel.id);
        if (!result) continue;
        result.hotel=hotel;
        const record=[...state.records.values()].find(record=>record.hotel.id===hotel.id);
        for (const view of record?.views ?? [{block:result.block}]) if(view.block.isConnected) renderBlock(view.block,hotel,state.settings);
      }
    }
    if(r.ok && state.sorted)sortCards();
    const notesEl = state.banner?.querySelector('.tt-notes');
    if (r.ok && notesEl) notesEl.innerHTML = r.data.notes.length ? `<ul>${r.data.notes.map((n) => `<li>${esc(n.text)}</li>`).join('')}</ul>` : '';
    const pageCost=r.data?.pageCost;
    const costLabel=pageCost?` · estimated page cost: ${pageCost.unknownCostRequests?(pageCost.estimatedUsd>0?'$'+pageCost.estimatedUsd.toFixed(4)+' + unknown':'unknown'):'$'+pageCost.estimatedUsd.toFixed(4)}`:'';
    setStatus(`${hotels.length} hotels${state.inFlight||state.queue.length ? ' · loading more' : ''}${state.taxPending ? ' · '+state.taxPending+' tax lookups pending' : ''} · anchors: ${esc(anchorsOf(state.settings.anchors).map((a) => a.split(',')[0]).join(', '))} · ${esc(state.settings.mode)} · $${state.settings.timeValue}/h${costLabel}`);
  }

  const pipelineSettings = () => ({
    anchors: anchorsOf(state.settings.anchors), mode: state.settings.mode, timeValue: Number.isFinite(Number(state.settings.timeValue)) ? Number(state.settings.timeValue) : 20,
    roundTripsPerDay: Number(state.settings.roundTrips) || 1, maxCommuteMin: Number(state.settings.maxCommuteMin) || undefined,
    budget: Number(state.settings.budget) || undefined, parking: !!state.settings.parking, ratings: !!state.settings.ratings, deepSearch: !!state.settings.deepSearch,
  });

  function renderDeferred(block,hotel){
    block.classList.add('tt-deferred');block.dataset.ttState='deferred';
    block.innerHTML=`<button type="button" class="tt-search" aria-label="Search trip cost for ${esc(hotel.name)}" title="Look up parking, routes and true trip cost for this hotel"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m16 16 5 5"></path></svg>Search this hotel</button> <span class="tt-muted">TrueTrip</span>`;
  }
  function renderPending(block,hotel){
    block.classList.remove('tt-deferred');block.dataset.ttState='loading';
    block.innerHTML=`<div class="tt-head">Added by TrueTrip</div><button type="button" class="tt-search" disabled>Searching…</button> <span class="tt-muted">Loading ${esc(hotel.name)}…</span>`;
  }
  function enqueue(record,manual=false){
    if(record.phase!=='deferred')return false;
    record.phase='queued';state.total++;if(!manual)state.autoCount++;
    for(const view of record.views??[])if(view.block.isConnected)renderPending(view.block,record.hotel);
    state.queue.push(record);return true;
  }
  function ensureView(record,card){
    const container=containerOf(card);
    const blocks=[...container.querySelectorAll('.tt-block')].filter(b=>!b.closest('[data-testid="property-card"]')||b.closest('[data-testid="property-card"]')===card);
    let block=blocks[0];for(const extra of blocks.slice(1))extra.remove();
    if(!block){block=el('div','tt-block',`<div class="tt-head">Added by TrueTrip</div><div class="tt-muted">Loading ${esc(record.hotel.name)}…</div>`);container.appendChild(block);}
    record.card=card;record.block=block;
    record.views=(record.views??[]).filter(v=>v.card.isConnected&&v.block.isConnected&&v.block!==block);
    record.views.push({card,block});
    if(record.error)block.textContent=record.error;
    else if(record.phase==='deferred')renderDeferred(block,record.hotel);
    else if(record.phase==='queued'||record.phase==='working')renderPending(block,record.hotel);
    return block;
  }
  function failRecord(record,message){
    if(record.epoch!==state.epoch)return;
    record.phase='failed';record.error=`TrueTrip: ${message}`;
    for(const view of record.views??[])if(view.block.isConnected)view.block.textContent=record.error;
  }
  function publish(record,hotel){
    if(record.epoch!==state.epoch)return;
    record.phase='done';
    for(const view of record.views??[])if(view.block.isConnected)renderBlock(view.block,hotel,state.settings);
    state.results.set(record.hotel.id,{hotel,block:record.block,container:containerOf(record.card)});
    state.revision++;scheduleFinish();
  }
  function scheduleFinish(){clearTimeout(state.finishTimer);state.finishTimer=setTimeout(()=>finish().catch(()=>{}),150);}
  async function lookupTaxes(hotel,context,options={}){
    return globalThis.TrueTripTaxLookup.resolve({
      ...options,
      readHtml:()=>call('hotel-html',{hotel,context}),
      readAlternateHtml:()=>call('hotel-html',{hotel,context,variant:'en-gb'}),
      parseHtml:data=>globalThis.TrueTripHotelTaxes.readCheapestRoom(new DOMParser().parseFromString(data.html,'text/html'),data.url),
      readBrowser:()=>call('hotel-taxes',{hotel,context,parkingOnly:options.needTaxes===false}),
    }).then(result=>{options.onComplete?.(result);return result;});
  }
  function startTaxFetch(record,options){
    state.taxPending++;owner.dataset.truetripTaxPending=String(state.taxPending);
    return lookupTaxes(record.hotel,record.context,options);
  }
  async function finishTaxes(record,taxes){
    try{
      const result=await taxes;
      if(record.epoch!==state.epoch)return;
      const current=state.results.get(record.hotel.id);if(!current)return;
      const d=result.data;
      if(result.ok&&(d?.price!=null||d?.parking?.claim)){
        const taxLookup={status:Number.isFinite(d.tax)&&d.status==='ok'?'complete':'failed',reason:d.reason??null};
        const priced=await call('reprice',{hotel:current.hotel,details:{price:d.price,tax:d.price!=null?d.tax:undefined,bookingParking:d.parking,priceIncludesTaxes:false,taxEvidence:d.price!=null?d:undefined,priceWarning:null,taxLookup},settings:pipelineSettings()});
        if(priced.ok)publish(record,priced.data.hotel);
        else publish(record,{...current.hotel,taxLookup:{status:'failed',reason:'Tax details found but the total could not be updated'}});
      }else{
        const reason=d?.reason??result.error??'Hotel-page taxes unavailable';
        publish(record,{...current.hotel,taxLookup:{status:'failed',reason}});
      }
    }catch(e){
      const current=state.results.get(record.hotel.id);
      if(current&&record.epoch===state.epoch)publish(record,{...current.hotel,taxLookup:{status:'failed',reason:e.message}});
    }finally{if(record.epoch===state.epoch){state.taxPending--;owner.dataset.truetripTaxPending=String(state.taxPending);scheduleFinish();}}
  }
  async function recoverBookingParking(record){
    const result=await call('hotel-taxes',{hotel:record.hotel,context:record.context,parkingOnly:true});
    if(record.epoch!==state.epoch||!result.ok||!result.data?.parking?.claim)return;
    const current=state.results.get(record.hotel.id);if(!current)return;
    const priced=await call('reprice',{hotel:current.hotel,details:{bookingParking:result.data.parking},settings:pipelineSettings()});
    if(priced.ok)publish(record,priced.data.hotel);
  }
  async function processCard(record) {
    const hotel=record.hotel;
    record.phase='working';ensureView(record,record.card);
    if(!hotel.name||hotel.price==null){failRecord(record,'Hotel price unavailable; select dates or another property');return;}
    const needsTax=HAS_EXT&&hotel.tax==null&&hotel.url?.includes('booking.com/hotel/');
    const needsParking=HAS_EXT&&state.settings.parking&&hotel.url?.includes('booking.com/hotel/');
    const needsLocation=HAS_EXT&&!hotel.location&&!/\d/.test(hotel.address??'')&&hotel.url?.includes('booking.com/hotel/');
    let acceptDetails;
    const earlyDetails=new Promise(resolve=>{acceptDetails=resolve;});
    let acceptParkingDetails;
    const parkingDetails=new Promise(resolve=>{acceptParkingDetails=resolve;});
    const options={needTaxes:needsTax,needParking:needsParking,onParkingReady:acceptParkingDetails,onComplete:r=>{record.bookingBrowserTried=!!r.data?.taxRecovery?.attempted;},onDetails:d=>{if(!needsLocation||d?.location||d?.address||d?.parking?.claim)acceptDetails(d);}};
    const details=needsTax?startTaxFetch(record,options):(needsLocation||needsParking)?lookupTaxes(hotel,record.context,options):null;
    const taxes=needsTax?details:null;
    if((needsLocation||needsParking||(needsTax&&!hotel.location))&&details){
      const d=needsParking?await parkingDetails:await Promise.race([earlyDetails,details.then(r=>r.data)]);
      if(record.epoch!==state.epoch)return;
      if(d?.location)hotel.location=d.location;
      if(d?.address)hotel.address=d.address;
      if(d?.parking?.claim)hotel.bookingParking=d.parking;
    }
    const r=await call('enrich-one',{context:record.context,hotel,settings:pipelineSettings()});
    if(!r.ok||record.epoch!==state.epoch){
      if(!r.ok)failRecord(record,r.error??r.data?.error??'request failed');
      if(taxes)taxes.finally(()=>{if(record.epoch===state.epoch){state.taxPending--;owner.dataset.truetripTaxPending=String(state.taxPending);scheduleFinish();}});
      return;
    }
    publish(record,{...r.data.hotel,taxLookup:{status:needsTax?'pending':'not-needed'}});
    if(taxes)void finishTaxes(record,taxes);
    else if(needsParking&&!record.bookingBrowserTried&&!hotel.bookingParking&&r.data.hotel.parking.status!=='ok')void recoverBookingParking(record).catch(()=>{});
  }

  async function pump() {
    while (state.inFlight < 4 && state.queue.length) {
      const record = state.queue.shift();
      state.inFlight++;
      processCard(record).catch(error=>failRecord(record,error.message)).finally(()=>{state.inFlight--;if(record.epoch===state.epoch){state.done++;if(state.inFlight||state.queue.length)setStatus(`enriching ${state.done}/${state.total}…`);}pump();});
    }
    if (!state.inFlight && !state.queue.length && state.total) scheduleFinish();
  }

  const contextKey=c=>JSON.stringify([c?.city,c?.checkin,c?.checkout,c?.currency]);
  function hasStayDates(c){
    const valid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
    return valid(c?.checkin)&&valid(c?.checkout)&&Date.parse(c.checkout)>Date.parse(c.checkin);
  }
  function scan() {
    const cards = [...document.querySelectorAll('[data-testid="property-card"]')];
    if (!cards.length) return;
    ensureBanner();
    const context=readContext();
    if(contextKey(context)!==contextKey(state.context)){
      restoreOrder();state.epoch++;clearTimeout(state.finishTimer);state.revision++;
      for(const {marker} of state.originalSlots.values())marker.remove();
      state.originalSlots.clear();state.records.clear();state.results.clear();state.queue=[];
      state.done=0;state.total=0;state.autoCount=0;state.nextId=0;state.taxPending=0;owner.dataset.truetripTaxPending='0';
      document.querySelectorAll('.tt-block').forEach(b=>b.remove());state.context=context;
      state.banner.querySelectorAll('.tt-sort, .tt-sort-time').forEach(btn=>{btn.disabled=true;});
    }
    if(!hasStayDates(context)){
      setStatus('Select check-in and check-out dates on Booking.com to compare trip costs.');
      state.banner.querySelectorAll('.tt-sort, .tt-sort-time').forEach(btn=>{btn.disabled=true;});
      return;
    }
    let added = false,missingPrices=0;
    for (const card of cards) {
      const hotel = readCard(card, state.total);
      const key = hotel.name + '|' + (hotel.url ? new URL(hotel.url).pathname : '');
      const container=containerOf(card);
      if(!hotel.name||!Number.isFinite(hotel.price)){
        missingPrices++;
        let waiting=container.querySelector('.tt-block');
        if(!waiting){waiting=el('div','tt-block');waiting.dataset.ttState='waiting-price';container.appendChild(waiting);}
        if(waiting.dataset.ttState==='waiting-price'){
          const text='TrueTrip: Price unavailable for these dates. Choose dates or wait for Booking.com to show a price.';
          if(waiting.textContent!==text)waiting.textContent=text;
        }
        continue;
      }
      container.querySelector('.tt-block[data-tt-state="waiting-price"]')?.remove();
      let slot=state.originalSlots.get(key);
      if(!slot?.marker.isConnected){const marker=document.createComment('TrueTrip original position');container.before(marker);slot={marker,container};state.originalSlots.set(key,slot);}
      else slot.container=container;
      const present=[...container.querySelectorAll('.tt-block')];
      for(const extra of present.slice(1))extra.remove();
      if(present.length)continue;
      const existing = state.records.get(key);
      if (existing) {
        ensureView(existing,card);
        const result = state.results.get(existing.hotel.id);
        if (result) {
          renderBlock(existing.block, result.hotel, state.settings);
          result.block = existing.block; result.container = containerOf(card);
          if(state.sorted)sortCards();
        }
        continue;
      }
      hotel.id=`tt-${state.epoch}-${state.nextId++}`;
      const record = { card, hotel, views:[],phase:'deferred',epoch:state.epoch,context:{...state.context} };
      state.records.set(key, record);
      ensureView(record,card);
      if(state.autoCount < (Number(state.settings.maxCards)||5))added=enqueue(record)||added;
    }
    if (!added){if(!state.total&&missingPrices)setStatus('No hotel prices available. Select dates with available rooms on Booking.com.');return;}
    setStatus(`enriching ${state.done}/${state.total}…`);
    pump();
  }

  async function main() {
    owner.dataset.truetripTaxPending='0';
    ensureBanner();setStatus('Loading settings…');
    let timer;
    try{state.settings=await Promise.race([getSettings(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Settings timed out; reload TrueTrip and refresh this page')),7000);})]);}finally{clearTimeout(timer);}
    if (!state.settings.enabled){state.banner?.remove();return;}
    state.context = readContext();
    setStatus('Connecting to TrueTrip server…');
    const h = await health();
    if(h.ok)void call('page-load',{});
    if (!h.ok) { if (ensureBanner()) setStatus(`<span class="tt-warn">${esc(h.error ?? 'TrueTrip server is not running')}</span> — run <code>npm run server</code> in the truetrip folder, then reload.`); return; }
    if (!anchorsOf(state.settings.anchors).length) { if (ensureBanner()) setStatus('<span class="tt-warn">Set 1-3 anchors in TrueTrip settings first.</span>'); return; }
    setStatus('Waiting for hotel cards…');
    const scanSafely=()=>{try{scan();}catch(e){setStatus(`<span class="tt-warn">TrueTrip: ${esc(e.message)} — refresh this page to retry.</span>`);}};
    document.addEventListener('click',event=>{
      const button=event.target.closest?.('button.tt-search');
      if(!button||button.disabled)return;
      event.preventDefault();event.stopPropagation();
      scanSafely();
      if(!hasStayDates(state.context))return;
      const card=button.closest('[data-testid="property-card-container"]')?.querySelector('[data-testid="property-card"]')??button.closest('[data-testid="property-card"]');
      if(!card)return;
      const hotel=readCard(card,0);
      const key=hotel.name+'|'+(hotel.url?new URL(hotel.url).pathname:'');
      const record=state.records.get(key);
      if(button.classList.contains('tt-retry-tax')){
        const current=record&&state.results.get(record.hotel.id);
        if(!current||record.epoch!==state.epoch||current.hotel.taxLookup?.status!=='failed')return;
        publish(record,{...current.hotel,taxLookup:{status:'pending'}});void finishTaxes(record,startTaxFetch(record));return;
      }
      if(!record||record.epoch!==state.epoch||record.phase!=='deferred'||!Number.isFinite(hotel.price))return;
      record.hotel={...hotel,id:record.hotel.id};ensureView(record,card);
      if(enqueue(record,true)){setStatus(`enriching ${state.done}/${state.total}…`);pump();}
    },true);
    scanSafely();
    let t = null;
    new MutationObserver(() => { if(t)return;t=setTimeout(()=>{t=null;scanSafely();},600); }).observe(document.body, { childList: true, subtree: true,attributes:true,attributeFilter:['href','value','datetime','data-date'] });
    document.addEventListener('change',scanSafely,true);
    window.addEventListener('popstate',scanSafely);
  }
  main().catch(error=>{ensureBanner();setStatus(`<span class="tt-warn">TrueTrip: ${esc(error.message)} — reload TrueTrip and refresh this page.</span>`);});
})();
