// Service worker: proxies requests from the content script to the local TrueTrip server
// (a content script on https://booking.com cannot fetch http://localhost directly: mixed content).
const DEFAULT_SERVER = 'http://localhost:8787';

async function serverUrl() {
  const { serverUrl } = await chrome.storage.sync.get({ serverUrl: DEFAULT_SERVER });
  return (serverUrl || DEFAULT_SERVER).replace(/\/$/, '');
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    let base=DEFAULT_SERVER;
    try {
      base=await serverUrl();
      if (msg.type === 'open-options') { chrome.runtime.openOptionsPage(); sendResponse({ ok: true }); return; }
      if(msg.type==='hotel-html'){
        const {hotel,context}=msg.payload;
        const url=new URL(hotel.url);
        if(url.protocol!=='https:'||!url.hostname.endsWith('.booking.com')||!url.pathname.startsWith('/hotel/'))throw new Error('Unsupported hotel URL');
        url.pathname=url.pathname.replace(/\.[a-z]{2}(?:-[a-z]{2})?\.html$/i,'.html');
        if(msg.payload.variant==='en-gb')url.pathname=url.pathname.replace(/\.html$/i,'.en-gb.html');
        for(const key of ['checkin','checkout'])if(context[key])url.searchParams.set(key,context[key]);
        url.searchParams.set('selected_currency','USD');url.searchParams.set('lang',msg.payload.variant==='en-gb'?'en-gb':'en-us');url.searchParams.set('no_rooms','1');
        const r=await fetch(url.href,{credentials:'include',signal:AbortSignal.timeout(12000)});
        const finalUrl=new URL(r.url);
        const propertyPath=u=>u.pathname.replace(/\.[a-z]{2}(?:-[a-z]{2})?\.html$/i,'.html');
        if(finalUrl.hostname!==url.hostname||propertyPath(finalUrl)!==propertyPath(url))throw new Error('Hotel page redirected to a different property');
        if(!r.ok||['checkin','checkout'].some(k=>finalUrl.searchParams.get(k)!==url.searchParams.get(k)))throw new Error('Hotel page did not preserve stay dates');
        sendResponse({ok:true,data:{html:await r.text(),url:r.url}});return;
      }
      if (msg.type === 'health') {
        const r = await fetch(`${base}/health`,{signal:AbortSignal.timeout(5000)});
        sendResponse({ ok: r.ok, data: await r.json() });
        return;
      }
      if (msg.type === 'enrich-one' || msg.type === 'notes' || msg.type === 'reprice' || msg.type === 'hotel-taxes' || msg.type === 'hotel-research' || msg.type === 'page-load') {
        const r = await fetch(`${base}/${msg.type}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg.payload),signal:AbortSignal.timeout(['notes','reprice'].includes(msg.type)?8000:170000) });
        const data = await r.json();
        sendResponse({ ok: r.ok, data });
        return;
      }
      sendResponse({ ok: false, error: 'unknown message' });
    } catch (e) {
      sendResponse({ ok: false, error: `TrueTrip request failed: ${e.message}. Local server: ${base}` });
    }
  })();
  return true; // keep the channel open for the async response
});
