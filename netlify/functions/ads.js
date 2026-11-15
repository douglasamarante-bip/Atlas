// Atlas – função do Netlify: busca anúncios reais (Meta + Google) via SearchAPI.io.
// A chave fica só aqui no servidor (variável SEARCHAPI_KEY), nunca no navegador.
const API = 'https://www.searchapi.io/api/v1/search';
const KEY = process.env.SEARCHAPI_KEY;
const COUNTRY = (process.env.META_COUNTRY || 'BR').toUpperCase();
const REGION = process.env.GOOGLE_REGION || 'BR';
const H = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=300'};
const reply = (code, obj) => ({statusCode: code, headers: H, body: JSON.stringify(obj)});
const day = s => (s ? String(s).slice(0, 10) : '');
const clean = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 70);
const good = x => x && !/\{\{/.test(x);

async function call(params) {
  const post = !!params.next_page_token; // tokens grandes vão no corpo (POST)
  const r = post
    ? await fetch(API, {method: 'POST', headers: {Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json'}, body: JSON.stringify(params)})
    : await fetch(API + '?' + new URLSearchParams(params), {headers: {Authorization: 'Bearer ' + KEY}});
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(String(j.error || 'SearchAPI HTTP ' + r.status));
  return j;
}

// ---------- Meta (Facebook + Instagram) ----------
function metaRow(a) {
  const s = a.snapshot || {}, pl = (a.publisher_platform || []).map(x => String(x).toUpperCase());
  const fb = pl.includes('FACEBOOK'), ig = pl.includes('INSTAGRAM');
  const f = String(s.display_format || '').toUpperCase();
  const text = good(s.title) ? s.title : good(s.body && s.body.text) ? s.body.text : a.page_name;
  return {
    canal: fb && ig ? 'Meta' : ig ? 'Instagram' : fb ? 'Facebook' : 'Meta',
    fmt: f === 'VIDEO' ? 'Vídeo' : /CAROUSEL|DPA|DCO/.test(f) ? 'Carrossel' : 'Imagem',
    nome: clean(text || 'Anúncio') + ' · ' + a.ad_archive_id,
    ini: day(a.start_date), fim: a.is_active ? '' : day(a.end_date)
  };
}
async function meta(q, pageId, pages, t0) {
  let pid = pageId, name = null, cands = [];
  if (!pid) {
    const s = await call({engine: 'meta_ad_library_page_search', q, country: COUNTRY});
    const list = s.page_results || [];
    cands = list.slice(0, 5).map(p => ({plat: 'Meta', name: p.name, id: String(p.page_id)}));
    if (!list.length) return {rows: [], note: 'Meta: nenhum anunciante encontrado para “' + q + '”.'};
    pid = String(list[0].page_id); name = list[0].name;
  }
  const rows = []; let token;
  for (let i = 0; i < pages; i++) {
    const p = {engine: 'meta_ad_library', page_id: pid, country: COUNTRY, active_status: 'all', sort_by: 'most_recent'};
    if (token) p.next_page_token = token;
    const j = await call(p);
    for (const a of j.ads || []) { if (!name) name = a.page_name; const r = metaRow(a); if (r.ini) rows.push(r); }
    token = j.pagination && j.pagination.next_page_token;
    if (!token || Date.now() - t0 > 14000) break;
  }
  return {rows, name, id: pid, cands, note: rows.length ? '' : 'Meta: o anunciante existe, mas não há anúncios no período/país consultado.'};
}

// ---------- Google (Pesquisa + YouTube) ----------
function findAdvertisers(s) {
  const out = [];
  for (const v of Object.values(s)) if (Array.isArray(v)) for (const it of v) {
    const id = it && (it.id || it.advertiser_id);
    if (typeof id === 'string' && /^AR\d+/i.test(id)) out.push({id: id.toUpperCase(), name: it.name || it.advertiser_name || id});
  }
  return out;
}
async function gCall(p) { // se a região não for aceita, tenta "anywhere"
  try { return await call({...p, region: REGION}); }
  catch (e) { if (REGION === 'anywhere') throw e; return await call({...p, region: 'anywhere'}); }
}
async function google(q, advId, pages, t0) {
  let id = advId, name = null, cands = [];
  if (!id) {
    const s = await call({engine: 'google_ads_transparency_center_advertiser_search', q});
    const list = findAdvertisers(s);
    cands = list.slice(0, 5).map(a => ({plat: 'Google', name: a.name, id: a.id}));
    if (!list.length) return {rows: [], note: 'Google: nenhum anunciante encontrado para “' + q + '”.'};
    id = list[0].id; name = list[0].name;
  }
  const base = {engine: 'google_ads_transparency_center', advertiser_id: id, num: 100};
  let yt = new Set();
  try { yt = new Set(((await gCall({...base, platform: 'youtube'})).ad_creatives || []).map(c => c.id)); } catch (e) {}
  const rows = []; let token;
  for (let i = 0; i < pages; i++) {
    const p = {...base}; if (token) p.next_page_token = token;
    const j = await gCall(p);
    for (const c of j.ad_creatives || []) {
      if (!name && c.advertiser) name = c.advertiser.name;
      const last = c.last_shown_datetime, recent = last && Date.now() - Date.parse(last) < 3 * 864e5;
      rows.push({
        canal: yt.has(c.id) ? 'YouTube' : 'Google',
        fmt: {text: 'Texto', image: 'Imagem', video: 'Vídeo'}[c.format] || 'Imagem',
        nome: clean((c.advertiser && c.advertiser.name) || name || 'Anúncio') + ' · ' + c.id,
        ini: day(c.first_shown_datetime), fim: recent ? '' : day(last), link: c.details_link || `https://adstransparency.google.com/advertiser/${id}/creative/${c.id}`
      });
    }
    token = j.pagination && j.pagination.next_page_token;
    if (!token || Date.now() - t0 > 14000) break;
  }
  return {rows: rows.filter(r => r.ini), name, id, cands, note: rows.length ? '' : 'Google: o anunciante existe, mas não há anúncios no período/região consultados.'};
}

const norm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const nameMatch = (n, q) => { n = norm(n); q = norm(q); return n.length >= 3 && q.length >= 3 && (n === q || n.includes(q) || q.includes(n)); };

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
async function channelMode(input) {
  const ch = await ytChannelInfo(input);
  if (!ch.name) return {status: 400, body: {error: 'Não consegui ler o canal. Cole o link completo (youtube.com/@canal) ou o @ do canal.'}};
  const g = await call({engine: 'google_ads_transparency_center_advertiser_search', q: ch.name}).catch(() => ({}));
  const list = findAdvertisers(g).map(a => ({...a, match: nameMatch(a.name, ch.name)})).sort((a, b) => b.match - a.match);
  const rows = [];
  for (const a of list.slice(0, 2)) {
    try {
      const j = await gCall({engine: 'google_ads_transparency_center', advertiser_id: a.id, num: 100});
      for (const c of j.ad_creatives || []) rows.push({adv: a.id, advName: a.name, nome: clean(a.name) + ' · ' + c.id, ini: day(c.first_shown_datetime), fim: day(c.last_shown_datetime),
        link: c.details_link || `https://adstransparency.google.com/advertiser/${a.id}/creative/${c.id}`, vids: videoIds(JSON.stringify(c))});
    } catch (e) {}
  }
  const ids = [...new Set(rows.flatMap(r => r.vids))].slice(0, 40);
  return {status: 200, body: {...channelResult(ch, list, rows, await checkVideos(ids, ch), ids.length), source: 'SearchAPI'}};
}
async function discoverBoth(q) { // anunciantes com esse nome na Meta e no Google
  const [m, g] = await Promise.all([
    call({engine: 'meta_ad_library_page_search', q, country: COUNTRY}).catch(() => ({})),
    call({engine: 'google_ads_transparency_center_advertiser_search', q}).catch(() => ({}))]);
  const meta = (m.page_results || []).slice(0, 15).map(p => ({id: String(p.page_id), name: p.name, ads: null, active: null, since: '', match: nameMatch(p.name, q)}));
  const google = findAdvertisers(g).slice(0, 15).map(a => ({...a, match: nameMatch(a.name, q)}));
  return {q, meta, google, best: {meta: (meta.find(x => x.match) || {}).id || '', google: (google.find(x => x.match) || {}).id || ''}, source: 'SearchAPI'};
}
function deepFind(o, key) {
  if (Array.isArray(o)) { for (const x of o) { const r = deepFind(x, key); if (r) return r; } }
  else if (o && typeof o === 'object') { if (o[key]) return String(o[key]); for (const v of Object.values(o)) { const r = deepFind(v, key); if (r) return r; } }
  return '';
}
async function pageFromAd(adId) { // ID de anúncio -> ID da página
  try { return deepFind(await call({engine: 'meta_ad_library_ad_details', ad_archive_id: adId}), 'page_id'); } catch (e) { return ''; }
}

exports.handler = async (event) => {
  if (!KEY) return reply(500, {error: 'SEARCHAPI_KEY não configurada nas variáveis de ambiente do Netlify.'});
  const need = process.env.ATLAS_ACCESS_CODE, h = event.headers || {};
  if (need && h['x-atlas-code'] !== need) return reply(401, {error: 'Código de acesso inválido.'});
  const p = event.queryStringParameters || {};
  const q = String(p.q || '').replace(/^@/, '').trim().slice(0, 100);
  const id = String(p.id || '').trim(), type = p.type || 'auto';
  const pages = Math.min(5, Math.max(1, parseInt(p.pages || '2', 10) || 2));
  if (p.mode === 'channel') {
    const input = String(p.q || '').trim().slice(0, 200);
    if (!input) return reply(400, {error: 'Cole o link ou o @ do canal.'});
    try { const r = await channelMode(input); return reply(r.status, r.body); } catch (e) { return reply(502, {error: e.message}); }
  }
  if (p.mode === 'discover') {
    if (!q) return reply(400, {error: 'Informe o nome do anunciante ou o nicho.'});
    try { return reply(200, await discoverBoth(q)); } catch (e) { return reply(502, {error: e.message}); }
  }
  const mid = String(p.mid || '').trim(), gid = String(p.gid || '').trim();
  if ((mid && !/^[A-Za-z0-9]+$/.test(mid)) || (gid && !/^[A-Za-z0-9]+$/.test(gid))) return reply(400, {error: 'ID inválido.'});
  if (!q && !id && !mid && !gid) return reply(400, {error: 'Informe q (nome) ou id.'});
  if (id && !/^[A-Za-z0-9]+$/.test(id)) return reply(400, {error: 'ID inválido.'});
  let metaId = mid, gId = gid.toUpperCase();
  if (id) {
    if (type === 'gadv' || (type === 'auto' && /^AR/i.test(id))) gId = id.toUpperCase();
    else if (type === 'mpg') metaId = id;
    else { // ID de anúncio (ou só números, sem tipo)
      const pg = await pageFromAd(id);
      if (pg) metaId = pg; else if (type === 'auto') metaId = id;
      else return reply(400, {error: 'Não consegui achar o anunciante desse ID de anúncio. Confira o ID ou use o ID da página.'});
    }
  }
  const t0 = Date.now(), jobs = [];
  const wrap = (k, pr) => pr.then(r => ({k, ...r})).catch(e => ({k, rows: [], note: (k === 'meta' ? 'Meta: ' : 'Google: ') + e.message}));
  const doMeta = !!metaId || !gId, doGoogle = !!gId || !metaId;
  if (doMeta) jobs.push(wrap('meta', meta(q, metaId, pages, t0)));
  if (doGoogle) jobs.push(wrap('google', google(q, gId, pages, t0)));
  const res = await Promise.all(jobs);
  const get = k => res.find(r => r.k === k);
  const m = get('meta'), g = get('google');
  const rows = res.flatMap(r => r.rows || []);
  return reply(200, {
    name: (m && m.name) || (g && g.name) || q || id,
    meta: m && m.id ? {name: m.name, id: m.id} : null,
    google: g && g.id ? {name: g.name, id: g.id} : null,
    candidates: res.flatMap(r => r.cands || []),
    notes: res.map(r => r.note).filter(Boolean),
    count: rows.length, rows, source: 'SearchAPI'
  });
};
