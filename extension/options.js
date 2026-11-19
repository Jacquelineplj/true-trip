const DEFAULTS = { enabled: true, anchors: 'MIT Media Lab, 75 Amherst St, Cambridge MA; Boston Convention and Exhibition Center', mode: 'drive', timeValue: 20, roundTrips: 1, maxCommuteMin: 0, budget: 0, parking: true, ratings: false, deepSearch: false, serverUrl: 'http://localhost:8787', maxCards: 5 };
const $ = (id) => document.getElementById(id);
globalThis.TrueTripEconomySettings(DEFAULTS).then((s) => {
  $('anchors').value = s.anchors.split(';').map((x) => x.trim()).filter(Boolean).join('\n');
  document.querySelector(`input[name=mode][value=${s.mode}]`).checked = true;
  for (const k of ['timeValue', 'roundTrips', 'maxCommuteMin', 'budget', 'serverUrl', 'maxCards']) $(k).value = s[k];
  for (const k of ['parking', 'ratings', 'deepSearch', 'enabled']) $(k).checked = !!s[k];
});
$('save').addEventListener('click', async () => {
  const s = {
    anchors: $('anchors').value.split(/\n|;/).map((x) => x.trim()).filter(Boolean).slice(0, 3).join('; '),
    mode: document.querySelector('input[name=mode]:checked').value,
    timeValue: Number($('timeValue').value) || 20, roundTrips: Number($('roundTrips').value) || 1,
    maxCommuteMin: Number($('maxCommuteMin').value) || 0, budget: Number($('budget').value) || 0,
    parking: $('parking').checked, ratings: $('ratings').checked, deepSearch: $('deepSearch').checked, enabled: $('enabled').checked,
    serverUrl: $('serverUrl').value.trim() || DEFAULTS.serverUrl, maxCards: Math.max(1,Math.min(50,Number($('maxCards').value)||5)),economyVersion:2,
  };
  await chrome.storage.sync.set(s);
  $('saved').textContent = 'Saved. Reload the Booking.com results page.';
});
