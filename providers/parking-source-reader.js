import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import { htmlToText } from '../core/parking-evidence.js';

let browserPromise, contextPromise;
const evidenceDir=fileURLToPath(new URL('../.cache/parking-evidence/',import.meta.url));
export async function closeParkingBrowser() {
  if(contextPromise){await (await contextPromise.catch(()=>null))?.close().catch(()=>{});contextPromise=null;}
  if(browserPromise){const b=await browserPromise.catch(()=>null);browserPromise=null;await b?.close().catch(()=>{});}
}
async function getBrowser() {
  if(!browserPromise) browserPromise=(async()=>{
    const {chromium}=await import(process.env.TRUETRIP_PLAYWRIGHT || 'playwright');
    return chromium.launch({headless:true,...(process.env.TRUETRIP_BROWSER?{executablePath:process.env.TRUETRIP_BROWSER}:{channel:'chrome'})});
  })();
  return browserPromise;
}
export function isSourceUrl(value) {
  try{const u=new URL(value);return u.protocol==='https:' && !/^(?:localhost|127\.|10\.|192\.168\.|\[|0\.)/.test(u.hostname);}catch{return false;}
}
const blocked=t=>/access denied|bot or not|show us your human side|human or a bot|verify (?:that )?you(?:'re| are) (?:not a robot|human)|page reference code|something went wrong/i.test(t.slice(0,1800));
function pageResult(url,html,method,title='') {
  const text=htmlToText(html);
  fs.mkdirSync(evidenceDir,{recursive:true});
  const hash=crypto.createHash('sha256').update(text).digest('hex');
  fs.writeFileSync(path.join(evidenceDir,hash+'.txt'),text);
  const links=[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m=>{try{return {url:new URL(m[1],url).href,label:htmlToText(m[2])};}catch{return null;}}).filter(Boolean).filter(l=>new URL(l.url).hostname===new URL(url).hostname && /faq|parking|polic|amenities|transportation|hotel-info|hotel-location/i.test(l.url+' '+l.label) && !/privacy|cookie|terms|accessibility|pet-policy|login|sign-?in/i.test(l.url)).slice(0,30);
  return {url,links,title:title||html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'',text,method,fetchedAt:new Date().toISOString(),contentHash:crypto.createHash('sha256').update(text).digest('hex'),blocked:blocked(title+'\n'+text)};
}
export async function readParkingSource(url, {browser=true,forceBrowser=false,fetchImpl=fetch}={}) {
  if(!isSourceUrl(url)) return {url,error:'unsupported source URL'};
  try{
    if(forceBrowser) throw new Error('browser read requested');
    const response=await fetchImpl(url,{signal:AbortSignal.timeout(12000),headers:{Accept:'text/html','User-Agent':'TrueTrip/0.2 parking source verification'}});
    if(response.ok){const html=await response.text();const result=pageResult(response.url||url,html,'http');if(!result.blocked) return result;}
  }catch{/* browser fallback */}
  if(!browser) return {url,error:'source unavailable over HTTP'};
  let page;
  try{
    const b=await getBrowser();
    if(!contextPromise)contextPromise=b.newContext({locale:'en-US'});
    page=await (await contextPromise).newPage();
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(2200);
    if(/expedia|hotels\.com|travelocity/.test(new URL(url).hostname)){
      for(const label of [/See all policies/i,/See all property amenities/i,/View all amenities/i]){
        const button=page.getByRole('button',{name:label}).first();
        if(await button.count() && await button.isVisible()) {await button.click({timeout:2000}).catch(()=>{});await page.waitForTimeout(500);break;}
      }
    }
    // Read-only disclosures; never interact with booking or payment controls.
    const disclosures=page.locator('button, [role="button"], summary, a[aria-expanded]');
    const candidates=await disclosures.all();
    let opened=0;
    for(const candidate of candidates){
      const label=(await candidate.innerText().catch(()=>''))?.trim();
      if(label && /^(?:Hotel Information|Parking|What are the parking options.*|How much is parking.*|Does .* (?:offer|have) parking\??)$/i.test(label) && await candidate.isVisible() && await candidate.getAttribute('aria-expanded')!=='true'){
        await candidate.click({timeout:1000}).catch(()=>{});if(++opened>=4)break;
      }
    }
    const html=await page.locator('body').innerHTML();
    const result=pageResult(page.url(),html,'browser',await page.title());
    return result.blocked?{url,error:'source returned an access/error page'}:result;
  }catch(e){return {url,error:e.message};}finally{await page?.close().catch(()=>{});}
}
