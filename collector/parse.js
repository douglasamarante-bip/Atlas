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
    if (o.ad_archive_id && (o.start_date !== undefined || o.page_id !== undefined)) { map.set(String(o.ad_archive_id), o); return false; }
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
  return [...g.values()].map(p => ({...p, match: score(p) >= 1000})).sort((a, b) => score(b) - score(a));
}
const nameMatch = (name, q) => { const n = norm(name), nq = norm(q); return n.length >= 3 && nq.length >= 3 && (n === nq || n.includes(nq) || nq.includes(n)); };
function groupPages(map, q) { // anunciantes distintos numa busca por palavra-chave (descoberta)
  const g = new Map();
  for (const a of map.values()) {
    const id = String(a.page_id || (a.snapshot && a.snapshot.page_id) || ''); if (!id) continue;
    const e = g.get(id) || {id, name: a.page_name || (a.snapshot && a.snapshot.page_name) || id, ads: 0, active: 0, since: ''};
    e.ads++; if (a.is_active) e.active++; e.match = q ? nameMatch(e.name, q) : false;
    const d = day(a.start_date); if (d && (!e.since || d < e.since)) e.since = d;
    g.set(id, e);
  }
  return [...g.values()].sort((a, b) => (b.match - a.match) || b.active - a.active || b.ads - a.ads).slice(0, 40);
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
    const full = JSON.stringify(o);
    map.set(cr, {id: cr, adv: vals.find(AR) || '', ts, blob: full.slice(0, 4000), vids: videoIds(full)});
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
    vids: c.vids || [], link: `https://adstransparency.google.com/advertiser/${c.adv || advId}/creative/${c.id}`
  };
}

// ---------- YouTube: canal -> anúncios ----------
const YT_ID = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/|ytimg\.com\/vi(?:_webp)?\/)([A-Za-z0-9_-]{11})/g;
function videoIds(text) { const s = new Set(); let m; YT_ID.lastIndex = 0; while ((m = YT_ID.exec(text))) s.add(m[1]); return [...s]; }
async function ytChannelInfo(input) {
  input = String(input || '').trim();
  let url = '';
  if (/^https?:\/\//i.test(input)) url = input; else if (/^@?[\w.\-]+$/.test(input)) url = 'https://www.youtube.com/@' + input.replace(/^@/, '');
  const info = {name: url ? '' : input, url: '', id: '', handle: ''};
  if (!url) return info;
  try {
    const r = await fetch(url, {headers: {'accept-language': 'pt-BR,pt;q=0.9', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'}});
    const t = await r.text();
    const og = t.match(/<meta property="og:title" content="([^"]+)"/);
    info.name = og ? og[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"') : '';
    const cid = t.match(/"(?:channelId|externalId)":"(UC[\w-]{22})"/); info.id = cid ? cid[1] : '';
    const cu = t.match(/<link rel="canonical" href="([^"]+)"/); info.url = cu ? cu[1] : url;
    const h = info.url.match(/youtube\.com\/(@[^/?#]+)/); info.handle = h ? decodeURIComponent(h[1]).toLowerCase() : '';
  } catch (e) {}
  return info;
}
async function ytOembed(id) {
  try {
    const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
    if (!r.ok) return null;
    const j = await r.json(); return {id, title: j.title, author: j.author_name, url: j.author_url};
  } catch (e) { return null; }
}
function sameChannel(ch, o) {
  const u = decodeURIComponent(String(o.url || '')).toLowerCase();
  if (ch.handle && u.includes(ch.handle)) return true;
  if (ch.id && u.includes(ch.id.toLowerCase())) return true;
  return !!ch.name && !!o.author && norm(o.author) === norm(ch.name);
}
async function checkVideos(ids, ch) { // confere de quem é cada vídeo (oEmbed do YouTube, em lotes de 5)
  const out = new Map();
  for (let i = 0; i < ids.length; i += 5) await Promise.all(ids.slice(i, i + 5).map(async id => { const o = await ytOembed(id); if (o) out.set(id, {...o, same: sameChannel(ch, o)}); }));
  return out;
}
function channelResult(ch, list, rows, info, nChecked) {
  const linked = [];
  for (const r of rows) for (const v of r.vids || []) { const o = info.get(v); if (o && o.same) { linked.push({adv: r.adv, advName: r.advName, nome: r.nome, ini: r.ini, fim: r.fim, link: r.link, video: 'https://www.youtube.com/watch?v=' + v, title: o.title}); break; } }
  const advertisers = list.slice(0, 10).map((a, i) => ({id: a.id, name: a.name, match: a.match, videoAds: i < 2 ? rows.filter(r => r.adv === a.id && (r.vids || []).length).length : null, linked: i < 2 ? linked.filter(l => l.adv === a.id).length : null}));
  const top = list.slice(0, 2);
  const verdict = linked.length ? 'Sim: ' + linked.length + ' anúncio(s) do Google/YouTube usam vídeos deste canal.'
    : top.some(a => a.match) ? 'Existe anunciante com o nome do canal, mas não consegui confirmar nos anúncios nenhum vídeo deste canal (os anúncios podem usar vídeos não listados, ou o Transparency Center não expôs o link do vídeo).'
    : list.length ? 'Não achei anunciante com o nome do canal. Veja os parecidos abaixo: o canal pode anunciar por uma conta com outro nome (agência, razão social).'
    : 'Nenhum anunciante encontrado para o nome do canal.';
  return {channel: ch, advertisers, linked, checked: nChecked, verdict};
}

module.exports = {videoIds, ytChannelInfo, checkVideos, channelResult, parseChunks, walk, walkMeta, metaRow, pickPages, groupPages, nameMatch, findAdvertisers, walkGoogle, googleRow};
