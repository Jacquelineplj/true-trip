// npm run test:browser -- [--live] (live captures public Booking cards, never books).
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TRUETRIP_PLAYWRIGHT || 'playwright');
const live = process.argv.includes('--live');
const taxes = process.argv.includes('--taxes');
const undated=process.argv.includes('--undated');
const manual=process.argv.includes('--manual');
const sessionDates=process.argv.includes('--session-dates');
const testCheckin=process.env.TRUETRIP_TEST_CHECKIN||'2026-12-10';
const testCheckout=process.env.TRUETRIP_TEST_CHECKOUT||'2026-12-11';
const targetCards=Math.max(1,Math.min(30,Number(process.env.TRUETRIP_TEST_MAX_CARDS)||3));
const testRatings=process.env.TRUETRIP_TEST_RATINGS==='1';
const captureTarget=Math.max(targetCards+(manual?1:0),Number(process.env.TRUETRIP_TEST_CAPTURE_CARDS)||(live?(manual?targetCards+1:30):6));
const out = path.resolve('out/validation'); fs.mkdirSync(out,{recursive:true});
const context = await chromium.launchPersistentContext(taxes ? fs.mkdtempSync(path.join(out,'tax-profile-')) : path.join(out, live ? 'browser-profile' : 'mock-profile'), {
  headless: false, timeout:30000, ...(process.env.TRUETRIP_BROWSER ? { executablePath: process.env.TRUETRIP_BROWSER } : {}), args: [`--disable-extensions-except=${path.resolve('extension')}`, `--load-extension=${path.resolve('extension')}`],
});
const testStart=Date.now();
const report = {startedAt:new Date().toISOString(),live,undated,sessionDates,targetCards,ratings:testRatings,checks:[]};
let worker,monitor;
try {
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(({serverUrl,maxCards,ratings}) => chrome.storage.sync.set({maxCards,ratings,serverUrl}), {serverUrl:process.env.TRUETRIP_SERVER||'http://localhost:8787',maxCards:targetCards,ratings:testRatings});
  await worker.evaluate(()=>{
    globalThis.__ttRequests=[];
    const original=globalThis.fetch.bind(globalThis);
    globalThis.fetch=async(input,options)=>{
      const url=new URL(typeof input==='string'?input:input.url);
      const local=['localhost','127.0.0.1'].includes(url.hostname);
      const row={endpoint:local?url.pathname:'hotel-html',startedAt:new Date().toISOString(),startedMs:Date.now(),hotel:null};
      if(local&&options?.body){try{row.hotel=JSON.parse(options.body).hotel?.name??null;}catch{}}
      globalThis.__ttRequests.push(row);
      try{
        const r=await original(input,options);row.status=r.status;
        const summary=h=>({id:h.id,name:h.name,room:h.room,taxEvidence:h.taxEvidence,parking:h.parking,unknowns:h.cost?.unknowns,total:h.cost?.total});
        try{
          if(local&&['/enrich-one','/reprice','/notes','/hotel-taxes'].includes(url.pathname)){
            const data=await r.clone().json();
            if(data.hotel)row.hotelResult=summary(data.hotel);
            if(data.hotels)row.hotelResults=data.hotels.map(summary);
            if(url.pathname==='/hotel-taxes')row.taxResult=data;
          }else if(!local&&url.hostname.endsWith('.booking.com')){
            const html=await r.clone().text();row.htmlInfo={bytes:html.length,hasAvailability:html.includes('hprt-table'),hasTaxTerms:/Excluded:|Not included:/i.test(html)};
          }
        }catch{}
        return r;
      }catch(e){row.error=e.message;throw e;}finally{row.durationMs=Date.now()-row.startedMs;}
    };
  });
  report.checks.push('MV3 service worker loaded; real extension storage configured');
  const page = await context.newPage();
  if(live)await page.addLocatorHandler(page.getByRole('button',{name:/dismiss sign.in/i}),async button=>button.click());
  let extraTabs=0;context.on('page',()=>extraTabs++);
  monitor=setInterval(async()=>{
    try{const snapshot=await page.evaluate(()=>({status:document.querySelector('.tt-status')?.textContent,blocks:document.querySelectorAll('.tt-block').length,finished:[...document.querySelectorAll('.tt-block')].filter(b=>b.textContent.includes('True trip cost')).length,taxPending:document.documentElement.dataset.truetripTaxPending}));fs.writeFileSync(path.join(out,'browser-progress.json'),JSON.stringify({at:new Date().toISOString(),elapsedMs:Date.now()-testStart,...snapshot},null,2));}catch{}
  },5000);
  page.on('pageerror' ,e => (report.pageErrors ??= []).push(e.message));
  let url = live ? 'https://www.booking.com/searchresults.html?ss=Boston&checkin=2026-12-10&checkout=2026-12-11&group_adults=2&no_rooms=1&selected_currency=USD' : 'http://localhost:8787/demo?ss=Boston&checkin=2026-12-10&checkout=2026-12-11';
  {const u=new URL(url);u.searchParams.set('checkin',testCheckin);u.searchParams.set('checkout',testCheckout);url=u.href;}
  if(undated){const u=new URL(url);u.searchParams.delete('checkin');u.searchParams.delete('checkout');url=u.href;}
  if(sessionDates){
    await worker.evaluate(()=>chrome.storage.sync.set({enabled:false}));
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
    await page.locator('[data-testid="price-and-discounted-price"]').first().waitFor({timeout:60000});
    await page.waitForTimeout(1500);
    await worker.evaluate(()=>chrome.storage.sync.set({enabled:true}));
    url='https://www.booking.com/searchresults.html?ss=Boston&ssne=Boston&ssne_untouched=Boston';
  }
  console.log(`Opening ${url}`);
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('[data-testid="property-card"]').first().waitFor({timeout:60000});
  await page.waitForTimeout(2000);
  if(undated){
    await page.waitForFunction(()=>/Select check-in and check-out/.test(document.querySelector('.tt-status')?.textContent??''),{},{timeout:15000});
    await page.waitForTimeout(20000);
    assert.equal(await page.locator('.tt-block').count(),0);
    assert.ok(await page.locator('.tt-sort').isDisabled());
    const requests=await worker.evaluate(()=>globalThis.__ttRequests??[]);
    assert.equal(requests.filter(r=>['/enrich-one','/hotel-taxes','hotel-html'].includes(r.endpoint)).length,0);
    report.statusText=await page.locator('.tt-status').innerText();report.extraUserBrowserTabs=extraTabs;
    report.checks.push('Real undated Booking page: no loading panels or hotel/tax queries after 20 seconds');
    assert.equal(extraTabs,0);report.passed=true;
    await page.screenshot({path:path.join(out,'booking-undated.png')});
  }else{
  if(live){
    for(let i=0;i<15 && await page.locator('[data-testid="property-card"]').count()<captureTarget;i++){
      await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
      const more=page.getByRole('button',{name:/load more results|show more results/i});
      if(await more.count()) await more.first().click();
      await page.waitForTimeout(1500);
    }
  }
  await page.evaluate(fs.readFileSync('extension/reader.js','utf8'));
  const capture=await page.evaluate(()=>({context:globalThis.TrueTripReader.readContext(),hotels:[...document.querySelectorAll('[data-testid="property-card"]')].slice(0,30).map((c,i)=>globalThis.TrueTripReader.readCard(c,i))}));
  console.log(`Captured ${capture.hotels.length} cards`);
  if(sessionDates){
    assert.equal(new URL(url).searchParams.has('checkin'),false);
    assert.equal(capture.context.checkin,testCheckin);assert.equal(capture.context.checkout,testCheckout);
    assert.equal(capture.context.datesSource,'hotel-links');report.dateContext=capture.context;
    report.checks.push('Exact user URL has no dates; session dates recovered from priced hotel links');
  }
  capture.context.capturedAt=new Date().toISOString();capture.context.sourceUrl=url;
  for (const h of capture.hotels) if(h.url){const u=new URL(h.url);h.url=u.origin+u.pathname;}
  fs.writeFileSync(path.join(out,live?'booking-live-cards.json':'mock-cards.json'),JSON.stringify(capture,null,2));
  if(live){
    if (!fs.existsSync('fixtures/boston-30.json')) fs.writeFileSync('fixtures/boston-30.json',JSON.stringify(capture,null,2));
    fs.writeFileSync(path.join(out,'booking-cards.html'),await page.locator('[data-testid="property-card"]').evaluateAll(cs=>cs.slice(0,30).map(c=>c.outerHTML).join('\n')));
  }
  assert.ok(capture.hotels.length>=captureTarget,`Only ${capture.hotels.length} cards captured`);
  assert.ok(capture.hotels.every(h=>h.name && h.price>0 && h.url));
  report.checks.push(`${capture.hotels.length} cards read with name, price, hotel URL`);
  await page.waitForFunction(n=>[...document.querySelectorAll('.tt-block')].filter(b=>b.textContent.includes('True trip cost')).length >= n,targetCards,{timeout:240000,polling:1000});
  report.enrichmentReadyMs=Date.now()-testStart;console.log(`All ${targetCards} provider blocks rendered after ${report.enrichmentReadyMs}ms`);
  if(taxes){await page.waitForFunction(()=>document.documentElement.dataset.truetripTaxPending==='0',{}, {timeout:240000});await page.waitForFunction(()=>[...document.querySelectorAll('.tt-block')].some(b=>b.textContent.includes('Lowest-priced room on hotel page:')),{}, {timeout:90000});}
  if(manual){
    const button=page.locator('.tt-deferred .tt-search').first();
    report.manualHotel=await button.evaluate(b=>(b.closest('[data-testid="property-card-container"]')??b.closest('[data-testid="property-card"]')).querySelector('[data-testid="title"]').textContent);
    await button.click();
    await page.waitForFunction(n=>document.querySelectorAll('.tt-block[data-tt-state="complete"]').length>=n,targetCards+1,{timeout:180000});
    if(taxes)await page.waitForFunction(()=>document.documentElement.dataset.truetripTaxPending==='0',{},{timeout:180000});
    report.manualSearchPassed=true;report.checks.push('Clicking a magnifier beyond the automatic cap returns an additional real hotel result');
  }
  report.taxesReadyMs=Date.now()-testStart;
  const blocks=await page.locator('.tt-block').filter({hasText:'True trip cost'}).allTextContents();
  report.ratingCoverage={google:blocks.filter(b=>/Google \d/.test(b)).length,tripadvisor:blocks.filter(b=>/Tripadvisor \d/.test(b)).length,googleTravel:blocks.filter(b=>b.includes('via Google Travel')).length};
  assert.ok(blocks.length>=targetCards);assert.ok(blocks.every(b=>b.includes('True trip cost')));
  assert.ok(await page.locator('[data-testid="property-card"]').evaluateAll(cs=>cs.every(c=>(c.closest('[data-testid="property-card-container"]')??c).querySelectorAll('.tt-block').length<=1)),'Duplicate TrueTrip blocks on one hotel card');
  report.checks.push('At most one TrueTrip block per hotel card');
  report.checks.push(`${targetCards} real provider results rendered by installed extension`);
  if(taxes){assert.ok(blocks.some(b=>b.includes('Lowest-priced room on hotel page:')), 'No availability-table tax result rendered');report.checks.push('Cheapest availability-table room and taxes rendered on search cards');}
  const originalOrder=await page.locator('[data-testid="title"]').allTextContents();
  await page.locator('.tt-sort').click({timeout:15000});
  assert.ok(await page.locator('.tt-rank').count()>=3);
  assert.equal(await page.locator('[data-testid="property-card"]').first().evaluate(c => (c.closest('[data-testid="property-card-container"]') ?? c).querySelector('.tt-rank')?.textContent), '#1');
  report.checks.push('Sort puts enriched cards first and assigns three ranks');
  // Simulate Booking replacing a card and removing the injected banner during hydration.
  await page.evaluate(() => {
    const card = document.querySelector('[data-testid="property-card"]');
    const container = card.closest('[data-testid="property-card-container"]') ?? card;
    const replacement = container.cloneNode(true);
    replacement.querySelectorAll('.tt-block').forEach(b => b.remove());
    container.replaceWith(replacement);
    document.querySelector('.tt-banner')?.remove();
  });
  await page.waitForFunction(() => document.querySelector('.tt-banner') && [...document.querySelectorAll('.tt-block')].filter(b => b.textContent.includes('True trip cost')).length >= 3, {}, {timeout:10000,polling:500});
  await page.locator('.tt-sort').click();
  assert.ok(await page.locator('.tt-rank').count()>=3);
  report.checks.push('Card and banner restored after DOM replacement; sort still works');
  await page.locator('.tt-restore').click();
  assert.deepEqual(await page.locator('[data-testid="title"]').allTextContents(),originalOrder);
  assert.equal(await page.locator('.tt-rank').count(),0);
  report.checks.push('Restore original Booking order after sorting and DOM replacement');
  assert.equal(extraTabs,0,'TrueTrip created a visible browser tab');
  report.extraUserBrowserTabs=extraTabs;
  report.checks.push('No extra tabs created in extension browser during tax lookups');
  report.blocks=blocks;
  await page.locator('.tt-block').first().scrollIntoViewIfNeeded();
  await page.locator('.tt-block').first().screenshot({path:path.join(out,live?'booking-enrichment.png':'mock-enrichment.png')});
  await page.waitForTimeout(300);
  await page.screenshot({path:path.join(out,live?'booking-extension.png':'mock-extension.png'),fullPage:!live});
  assert.ok(!report.pageErrors?.length,JSON.stringify(report.pageErrors));
  report.statusText=await page.locator('.tt-status').innerText();
  report.passed=true;
  }
} catch(e){report.passed=false;report.error=e.stack; const p=context.pages().at(-1); if(p){report.blocks=await p.locator('.tt-block').allTextContents().catch(()=>[]);report.statusText=await p.locator('.tt-status').allTextContents().catch(()=>[]);await p.screenshot({path:path.join(out,'browser-failure.png')}).catch(()=>{});} process.exitCode=1;}
finally { clearInterval(monitor);report.elapsedMs=Date.now()-testStart;report.requests=await worker?.evaluate(()=>globalThis.__ttRequests??[]).catch(()=>[]);fs.writeFileSync(path.join(out,live?(sessionDates?'browser-live-session-dates.json':undated?'browser-live-undated.json':manual?'browser-live-manual.json':taxes?'browser-live-taxes.json':'browser-live.json'):'browser-mock.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));await context.close();}
