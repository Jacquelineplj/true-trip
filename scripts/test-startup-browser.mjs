// A stalled health check must produce an actionable error, never an endless starting banner.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
const {chromium}=await import(process.env.TRUETRIP_PLAYWRIGHT||'playwright');
const installed=process.argv.includes('--extension');
fs.mkdirSync('out/validation',{recursive:true});
const browser=installed
 ? await chromium.launchPersistentContext(fs.mkdtempSync(path.resolve('out/validation/startup-profile-')),{headless:false,...(process.env.TRUETRIP_BROWSER?{executablePath:process.env.TRUETRIP_BROWSER}:{}),args:[`--disable-extensions-except=${path.resolve('extension')}`,`--load-extension=${path.resolve('extension')}`]})
 : await chromium.launch({headless:true,channel:'chrome'});
const report={at:new Date().toISOString(),installedExtension:installed,method:'Real demo/content script, intercepted nonresponding health endpoint; no AI calls.'};
try{
 if(installed){const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');await worker.evaluate(()=>chrome.storage.sync.set({serverUrl:'http://localhost:8787',enabled:true}));}
 const page=await browser.newPage();
 let intercepted=0;
 await (installed?browser:page).route('**/health',()=>{intercepted++;});
 const started=Date.now();
 await page.goto('http://localhost:8787/demo?ss=Boston&checkin=2026-12-10&checkout=2026-12-11'+(installed?'':'&inline=1'));
 await page.waitForFunction(()=>/timed out|timeout|aborted/i.test(document.querySelector('.tt-status')?.textContent??''),{},{timeout:12000});
 report.elapsedMs=Date.now()-started;report.intercepted=intercepted;assert.ok(intercepted>0,'Health request was not intercepted');
 report.status=await page.locator('.tt-status').innerText();
 assert.doesNotMatch(report.status,/starting/i);
 assert.match(report.status,/server|reload/i);
 report.passed=true;
}catch(e){report.passed=false;report.error=e.stack;process.exitCode=1;}
finally{fs.mkdirSync('out/validation',{recursive:true});fs.writeFileSync(installed?'out/validation/startup-timeout-extension.json':'out/validation/startup-timeout-browser.json',JSON.stringify(report,null,2));console.log(report);await browser.close();}
