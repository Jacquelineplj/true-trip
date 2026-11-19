document.getElementById('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
chrome.runtime.sendMessage({ type: 'health' }, (r) => {
  const e = document.getElementById('server');
  if (r?.ok) { e.className = 'ok'; e.textContent = `Server OK · parking via ${r.data.parking} · ratings ${r.data.ratings.google || r.data.ratings.tripadvisor ? 'via API' : 'via ' + r.data.ratings.fallback}`; }
  else { e.className = 'bad'; e.textContent = r?.error ?? 'Server not running. In the truetrip folder run: npm run server'; }
});
chrome.storage.sync.get({ anchors: '', mode: 'drive', timeValue: 20 }).then((s) => {
  document.getElementById('anchors').textContent = s.anchors ? `Anchors: ${s.anchors} · ${s.mode} · $${s.timeValue}/h` : 'No anchors set yet.';
});
chrome.storage.sync.get({serverUrl:'http://localhost:8787'}).then(s=>{document.getElementById('usage').href=s.serverUrl.replace(/\/$/,'')+'/usage';});
