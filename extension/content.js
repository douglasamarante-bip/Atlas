(() => {
if (window.__adsRadar) return; window.__adsRadar = 1;
const MES = {jan:0,fev:1,feb:1,mar:2,abr:3,apr:3,mai:4,may:4,jun:5,jul:6,ago:7,aug:7,set:8,sep:8,out:9,oct:9,nov:10,dez:11,dec:11};
const R1 = /(\d{1,2})\s+(?:de\s+)?([a-zç]{3,})\.?\s+(?:de\s+)?(\d{4})/gi;
const R2 = /([a-z]{3,})\.?\s+(\d{1,2}),\s+(\d{4})/gi;
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const clean = s => s.replace(/[;,\n\r]/g, ' ').trim().slice(0, 80);
const hash = s => { let h = 0; for (const c of s) h = (h*31 + c.charCodeAt(0)) | 0; return 'g' + h; };
function dates(t) {
  const o = [], seen = new Set(); let m;
  const add = (i, d, mo, y) => { const k = MES[mo.slice(0,3).toLowerCase()]; if (k === undefined || seen.has(i)) return; seen.add(i); o.push({i, d: new Date(+y, k, +d)}); };
  R1.lastIndex = 0; while ((m = R1.exec(t))) add(m.index, m[1], m[2], m[3]);
  R2.lastIndex = 0; while ((m = R2.exec(t))) add(m.index, m[2], m[1], m[3]);
  return o.sort((a, b) => a.i - b.i);
}
// Acha os "cartões" de anúncio: sobe a partir do marcador até o último pai que contém só um marcador.
function cards(mk) {
  const g = new RegExp(mk.source, 'gi');
  const leaf = [...document.querySelectorAll('span,div,a,p')].filter(e => e.textContent.length < 90 && mk.test(e.textContent) && ![...e.children].some(c => mk.test(c.textContent)));
  const out = [], seen = new Set();
  for (const e of leaf) {
    let c = e;
    while (c.parentElement && c.parentElement !== document.body) { const p = c.parentElement; if ((p.innerText.match(g) || []).length > 1) break; c = p; }
    if (!seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}
function meta() {
  const idRe = /(?:Library ID|ID da biblioteca)\s*:?\s*(\d{6,})/i, rows = [], seen = new Set();
  for (const c of cards(idRe)) {
    const t = c.innerText, id = (t.match(idRe) || [])[1];
    if (!id || seen.has(id)) continue; seen.add(id);
    const d = dates(t); if (!d.length) continue;
    const inactive = /Inativo|Inactive/i.test(t);
    const L = t.split('\n').map(s => s.trim()).filter(Boolean), i = L.findIndex(s => /^(Patrocinado|Sponsored)$/i.test(s));
    rows.push({id, canal: 'Meta', nome: clean((i > 0 ? L[i-1] : 'Anúncio') + ' · ' + id), fmt: c.querySelector('video') ? 'Vídeo' : 'Imagem',
      ini: iso(d[0].d), fim: d[1] ? iso(d[1].d) : (inactive ? iso(d[0].d) : ''), gasto: '', link: 'https://www.facebook.com/ads/library/?id=' + id});
  }
  return rows;
}
function goog() {
  const mk = /(?:Última exibição|Last shown)/i, rows = [], seen = new Set();
  for (const c of cards(mk)) {
    const t = c.innerText; if (seen.has(t)) continue; seen.add(t);
    const d = dates(t); if (!d.length) continue;
    const L = t.split('\n').map(s => s.trim()).filter(Boolean);
    const fmt = /Vídeo|Video/i.test(t) ? 'Vídeo' : /Imagem|Image/i.test(t) ? 'Imagem' : 'Texto';
    rows.push({id: hash(t), canal: /youtube/i.test(t) ? 'YouTube' : 'Google', nome: clean(L[0] || 'Anúncio'), fmt,
      ini: iso(d[0].d), fim: iso((d[1] || d[0]).d), gasto: '', link: ((c.querySelector('a[href*="/advertiser/"]') || {}).href || '')});
  }
  return rows;
}
async function autoScroll() {
  let last = 0, same = 0;
  for (let i = 0; i < 40 && same < 3; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 1300));
    const h = document.body.scrollHeight; same = h === last ? same + 1 : 0; last = h;
  }
  window.scrollTo(0, 0);
}
chrome.runtime.onMessage.addListener((m, _s, send) => {
  if (m.type !== 'scan') return;
  (async () => {
    if (m.scroll) await autoScroll();
    const rows = location.host.includes('facebook.com') ? meta() : goog();
    send({rows, q: (p => p.get('q') || (p.get('view_all_page_id') && 'ID ' + p.get('view_all_page_id')) || p.get('id') && 'ID ' + p.get('id') || document.title)(new URLSearchParams(location.search))});
  })();
  return true;
});
})();
