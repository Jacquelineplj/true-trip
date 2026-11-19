// Tiny file-backed JSON cache with TTL. One file per namespace under .cache/.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache');

export function makeCache(namespace, { ttlMs = 7 * 86400000, dir = ROOT } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${namespace}.json`);
  const pending=new Map();
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = {}; }
  const key = (k) => crypto.createHash('sha1').update(JSON.stringify(k)).digest('hex');
  const flush = () => fs.writeFileSync(file, JSON.stringify(data, null, 1));
  return {
    get(k) {
      const e = data[key(k)];
      if (!e) return undefined;
      if (Date.now() - e.t > (e.ttlMs??ttlMs)) { delete data[key(k)]; return undefined; }
      return e.v;
    },
    set(k, v, options={}) { data[key(k)] = { t: Date.now(), v, k, ...(options.ttlMs!=null?{ttlMs:options.ttlMs}:{}) }; flush(); return v; },
    async wrap(k, fn, options={}) {
      const hit = this.get(k);
      if (hit !== undefined&&(!options.accept||options.accept(hit))) return hit;
      const id=key(k);
      if(pending.has(id))return pending.get(id);
      const task=Promise.resolve().then(fn).then(v=>{if(v!=null||options.cacheNull)this.set(k,v,{ttlMs:typeof options.ttlMs==='function'?options.ttlMs(v):options.ttlMs});return v;}).finally(()=>pending.delete(id));
      pending.set(id,task);
      return task;
    },
    file,
  };
}
