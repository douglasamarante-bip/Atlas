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
