// Funções puras de leitura dos dados das bibliotecas (testáveis sem navegador).
const iso = ts => new Date(Number(ts) * 1000).toISOString().slice(0, 10);
const day = v => (v === undefined || v === null || v === '' ? '' : /^\d{9,11}$/.test(String(v)) ? iso(v) : String(v).slice(0, 10));
const clean = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 70);
const good = x => x && !/\{\{/.test(x);
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

function parseChunks(text) { // respostas do Facebook podem vir em várias linhas JSON
  const out = [];
  for (let l of String(text).replace(/^for \(;;\);/, '').split('\n')) {
    l = l.trim(); if (!l) continue;
    try { out.push(JSON.parse(l)); } catch (e) {}
  }
  return out;
}
function walk(o, fn) {
  if (Array.isArray(o)) { o.forEach(x => walk(x, fn)); return; }
  if (o && typeof o === 'object') { if (fn(o) === false) return; Object.values(o).forEach(x => walk(x, fn)); }
}

// ---------- Meta ----------
function walkMeta(obj, map) {
  walk(obj, o => {
    if (o.ad_archive_id && o.start_date !== undefined) { map.set(String(o.ad_archive_id), o); return false; }
  });
}
function metaRow(a) {
  const s = a.snapshot || {}, pl = (a.publisher_platform || []).map(x => String(x).toUpperCase());
  const fb = pl.includes('FACEBOOK'), ig = pl.includes('INSTAGRAM'), f = String(s.display_format || '').toUpperCase();
  const text = good(s.title) ? s.title : good(s.body && s.body.text) ? s.body.text : a.page_name;
  return {
    canal: fb && ig ? 'Meta' : ig ? 'Instagram' : fb ? 'Facebook' : 'Meta',
    fmt: f === 'VIDEO' ? 'Vídeo' : /CAROUSEL|DPA|DCO/.test(f) ? 'Carrossel' : 'Imagem',
    nome: clean(text || 'Anúncio') + ' · ' + a.ad_archive_id,
    ini: day(a.start_date), fim: a.is_active ? '' : day(a.end_date)
  };
}
function pickPages(map, q) { // quais anunciantes aparecem na busca por palavra-chave
  const g = new Map(), nq = norm(q);
  for (const a of map.values()) {
    const id = String(a.page_id || (a.snapshot && a.snapshot.page_id) || ''), name = a.page_name || (a.snapshot && a.snapshot.page_name) || '';
    if (!id) continue;
    const e = g.get(id) || {id, name, n: 0}; e.n++; g.set(id, e);
  }
  const score = p => { const n = norm(p.name); return (n === nq ? 3 : n.startsWith(nq) ? 2 : n.includes(nq) || nq.includes(n) ? 1 : 0) * 1000 + p.n; };
  return [...g.values()].sort((a, b) => score(b) - score(a));
}

// ---------- Google ----------
const AR = v => typeof v === 'string' && /^AR\d{10,}$/.test(v);
const CR = v => typeof v === 'string' && /^CR\d{10,}$/.test(v);
function findAdvertisers(obj) {
  const out = new Map();
  walk(obj, o => {
    const vals = Object.values(o), id = vals.find(AR);
    if (id && !out.has(id)) {
      const name = vals.find(v => typeof v === 'string' && v !== id && v.length > 1 && !/^[A-Z]{2}$/.test(v) && !/^\d+$/.test(v));
      if (name) out.set(id, name);
    }
  });
  return [...out].map(([id, name]) => ({id, name}));
}
function walkGoogle(obj, map) {
  walk(obj, o => {
    const vals = Object.values(o), cr = vals.find(CR);
    if (!cr) return;
    const ts = [];
    walk(o, x => { for (const v of Object.values(x)) if ((typeof v === 'number' || typeof v === 'string') && /^1[4-9]\d{8}$/.test(String(v))) ts.push(Number(v)); });
    map.set(cr, {id: cr, adv: vals.find(AR) || '', ts, blob: JSON.stringify(o).slice(0, 4000)});
    return false;
  });
}
function googleRow(c, name, advId) { // primeira/última exibição = menor/maior data encontrada no anúncio
  if (!c.ts.length) return null;
  const first = Math.min(...c.ts), last = Math.max(...c.ts), recent = Date.now() - last * 1000 < 3 * 864e5;
  const b = c.blob;
  return {
    canal: /youtube/i.test(b) ? 'YouTube' : 'Google',
    fmt: /\.mp4|video|youtube/i.test(b) ? 'Vídeo' : /<img|\.(jpe?g|png|webp)|simgad|googleusercontent/i.test(b) ? 'Imagem' : 'Texto',
    nome: clean(name || 'Anúncio') + ' · ' + c.id, ini: iso(first), fim: recent ? '' : iso(last),
    link: `https://adstransparency.google.com/advertiser/${c.adv || advId}/creative/${c.id}`
  };
}
module.exports = {parseChunks, walk, walkMeta, metaRow, pickPages, findAdvertisers, walkGoogle, googleRow};
