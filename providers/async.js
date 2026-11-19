export function createLimiter(limit) {
 let active=0,peak=0;const waiting=[];
 function pump(){while(active<limit&&waiting.length){const {fn,resolve,reject}=waiting.shift();active++;peak=Math.max(peak,active);Promise.resolve().then(fn).then(resolve,reject).finally(()=>{active--;pump();});}}
 return {run(fn){return new Promise((resolve,reject)=>{waiting.push({fn,resolve,reject});pump();});},stats(){return {limit,active,queued:waiting.length,peak};}};
}
