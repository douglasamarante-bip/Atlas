// Atlas – coletor próprio: abre as bibliotecas de anúncios num navegador (Playwright)
// e devolve o mesmo JSON da função do Netlify. Rode em Docker (Render, Railway, Fly, VPS).
const http = require('http');
const { chromium } = require('playwright');
const P = require('./parse');
const PORT = process.env.PORT || 8080, CODE = process.env.ATLAS_ACCESS_CODE || '';
const COUNTRY = (process.env.META_COUNTRY || 'BR').toUpperCase(), REGION = process.env.GOOGLE_REGION || 'BR';
const CACHE = new Map(), TTL = 10 * 60 * 1000;
let browser, chain = Promise.resolve();
const queue = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; }; // 1 coleta por vez

async function newCtx() {
  if (!browser || !browser.isConnected()) {
    const o = {args: ['--no-sandbox', '--disable-dev-shm-usage']};
    if (process.env.PROXY_URL) { const u = new URL(process.env.PROXY_URL); o.proxy = {server: u.protocol + '//' + u.host, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password)}; }
    browser = await chromium.launch(o);
  }
  const c = await browser.newContext({locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', viewport: {width: 1366, height: 900}});
  await c.route('**/*', r => ['image', 'media', 'font'].includes(r.request().resourceType()) ? r.abort() : r.continue());
  return c;
}
const GO = {waitUntil: 'domcontentloaded', timeout: 45000};

async function metaCollect(url, scrolls) {
  const c = await newCtx(), page = await c.newPage(), ads = new Map();
  page.on('response', async r => { if (!r.url().includes('/api/graphql')) return; try { for (const o of P.parseChunks(await r.text())) P.walkMeta(o, ads); } catch (e) {} });
  try {
    await page.goto(url, GO); await page.waitForTimeout(3500);
    try { await page.getByRole('button', {name: /permitir todos|allow all|aceitar todos|accept all/i}).first().click({timeout: 1500}); } catch (e) {}
    for (const s of await page.$$eval('script[type="application/json"]', els => els.map(e => e.textContent))) { try { P.walkMeta(JSON.parse(s), ads); } catch (e) {} }
    for (let i = 0, stale = 0; i < scrolls && stale < 3; i++) { const n = ads.size; await page.mouse.wheel(0, 5000); await page.waitForTimeout(1800); stale = ads.size === n ? stale + 1 : 0; }
  } finally { await c.close(); }
  return ads;
}
async function meta(q, pageId, scrolls) {
  const U = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${COUNTRY}&media_type=all`;
  let pid = pageId, name = null, cands = [];
  if (!pid) {
    const found = P.pickPages(await metaCollect(`${U}&q=${encodeURIComponent(q)}&search_type=keyword_unordered`, 3), q);
    if (!found.length) return {rows: [], note: 'Meta: nenhum anúncio encontrado para “' + q + '” (ou a Meta bloqueou o acesso do servidor).'};
    if (!found[0].match) return {rows: [], cands: found.slice(0, 8).map(p => ({plat: 'Meta', name: p.name, id: p.id})), note: 'Meta: não achei um anunciante chamado “' + q + '”. Escolha um dos parecidos abaixo ou use “Descobrir anunciantes”.'};
    pid = found[0].id; name = found[0].name; cands = found.slice(0, 5).map(p => ({plat: 'Meta', name: p.name, id: p.id}));
  }
  const ads = await metaCollect(`${U}&view_all_page_id=${pid}&search_type=page`, scrolls);
  const rows = [...ads.values()].map(P.metaRow).filter(r => r.ini);
  if (!name && ads.size) name = [...ads.values()][0].page_name;
  return {rows, name, id: pid, cands, note: rows.length ? '' : 'Meta: nenhum anúncio coletado para esta página.'};
}

async function googleFind(q) {
  const c = await newCtx(), page = await c.newPage(), advs = new Map();
  page.on('response', async r => { if (!/SearchSuggestions/.test(r.url())) return; try { for (const a of P.findAdvertisers(JSON.parse(await r.text()))) advs.set(a.id, a.name); } catch (e) {} });
  try {
    await page.goto(`https://adstransparency.google.com/?region=${REGION}`, GO);
    const input = page.locator('input').first(); await input.waitFor({timeout: 15000});
    await input.click(); await input.pressSequentially(q, {delay: 90}); await page.waitForTimeout(3000);
  } finally { await c.close(); }
  return [...advs].map(([id, name]) => ({id, name}));
}
async function google(q, advId, scrolls) {
  let id = advId, name = null, cands = [];
  if (!id) {
    const list = await googleFind(q);
    if (!list.length) return {rows: [], note: 'Google: nenhum anunciante encontrado para “' + q + '” (ou o Google bloqueou o acesso do servidor).'};
    id = list[0].id; name = list[0].name; cands = list.slice(0, 5).map(a => ({plat: 'Google', name: a.name, id: a.id}));
  }
  const c = await newCtx(), page = await c.newPage(), map = new Map();
  page.on('response', async r => { if (!/SearchCreatives/.test(r.url())) return; try { P.walkGoogle(JSON.parse(await r.text()), map); } catch (e) {} });
  try {
    await page.goto(`https://adstransparency.google.com/advertiser/${id}?region=${REGION}`, GO); await page.waitForTimeout(4000);
    for (let i = 0, stale = 0; i < scrolls && stale < 3; i++) {
      const n = map.size;
      const btn = page.getByRole('button', {name: /ver mais|see more|load more|mostrar mais/i}).first();
      if (await btn.count()) { try { await btn.click({timeout: 1500}); } catch (e) {} } else await page.mouse.wheel(0, 5000);
      await page.waitForTimeout(2000); stale = map.size === n ? stale + 1 : 0;
    }
  } finally { await c.close(); }
  const rows = [...map.values()].map(x => P.googleRow(x, name, id)).filter(Boolean);
  return {rows, name, id, cands, note: rows.length ? '' : 'Google: nenhum anúncio coletado para este anunciante.'};
}

async function metaFromAd(adId) { // descobre a página (anunciante) a partir do ID de um anúncio
  try {
    const ads = await metaCollect(`https://www.facebook.com/ads/library/?id=${adId}`, 0);
    const a = ads.get(String(adId)) || [...ads.values()].find(x => x.page_id);
    const id = a && String(a.page_id || (a.snapshot && a.snapshot.page_id) || '');
    return id ? {id, name: a.page_name} : null;
  } catch (e) { return null; }
}

async function channelLookup(input) {
  const ch = await P.ytChannelInfo(input);
  if (!ch.name) return {status: 400, body: {error: 'Não consegui ler o canal. Cole o link completo (youtube.com/@canal) ou o @ do canal.'}};
  let list = []; try { list = await googleFind(ch.name); } catch (e) {}
  list = list.map(a => ({...a, match: P.nameMatch(a.name, ch.name)})).sort((a, b) => b.match - a.match);
  const rows = [];
  for (const a of list.slice(0, 2)) { try { for (const x of (await google(ch.name, a.id, 8)).rows) rows.push({...x, adv: a.id, advName: a.name}); } catch (e) {} }
  const ids = [...new Set(rows.flatMap(r => r.vids || []))].slice(0, 40);
  const info = await P.checkVideos(ids, ch);
  return {status: 200, body: {...P.channelResult(ch, list, rows, info, ids.length), source: 'coletor próprio'}};
}

async function lookup({q, id, type, pages, mid, gid}) {
  let metaId = mid || '', gId = (gid || '').toUpperCase();
  if (id) {
    if (type === 'gadv' || (type === 'auto' && /^AR/i.test(id))) gId = id.toUpperCase();
    else if (type === 'mpg') metaId = id;
    else { // ID de anúncio (ou só números, sem tipo): acha o anunciante pelo anúncio
      const pg = await metaFromAd(id);
      if (pg) metaId = pg.id;
      else if (type === 'auto') metaId = id;
      else return {status: 400, body: {error: 'Não consegui achar o anunciante desse ID de anúncio. Confira o ID ou use o ID da página.'}};
    }
  }
  const scrolls = Math.min(30, pages * 6), res = [];
  const run = async (k, fn) => { try { res.push({k, ...(await fn())}); } catch (e) { res.push({k, rows: [], note: (k === 'meta' ? 'Meta: ' : 'Google: ') + e.message.split('\n')[0]}); } };
  const doMeta = !!metaId || !gId, doGoogle = !!gId || !metaId;
  if (doMeta) await run('meta', () => meta(q, metaId, scrolls));
  if (doGoogle) await run('google', () => google(q, gId, scrolls));
  const m = res.find(r => r.k === 'meta'), g = res.find(r => r.k === 'google'), rows = res.flatMap(r => r.rows || []);
  return {status: 200, body: {
    name: (m && m.name) || (g && g.name) || q || id,
    meta: m && m.id ? {name: m.name, id: m.id} : null, google: g && g.id ? {name: g.name, id: g.id} : null,
    candidates: res.flatMap(r => r.cands || []), notes: res.map(r => r.note).filter(Boolean),
    count: rows.length, rows, source: 'coletor próprio'}};
}

http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': process.env.ALLOW_ORIGIN || '*', 'Access-Control-Allow-Headers': 'x-atlas-code', 'Access-Control-Allow-Methods': 'GET, OPTIONS'}); res.end(JSON.stringify(obj)); };
  if (req.method === 'OPTIONS') return send(204, {});
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/health') return send(200, {ok: true});
  if (u.pathname !== '/ads') return send(404, {error: 'não encontrado'});
  if (CODE && req.headers['x-atlas-code'] !== CODE) return send(401, {error: 'Código de acesso inválido.'});
  const q = (u.searchParams.get('q') || '').replace(/^@/, '').trim().slice(0, 100), id = (u.searchParams.get('id') || '').trim();
  const type = u.searchParams.get('type') || 'auto', pages = Math.min(5, Math.max(1, parseInt(u.searchParams.get('pages') || '2', 10) || 2));
  if (u.searchParams.get('mode') === 'channel') { // canal do YouTube -> anúncios ligados a ele
    const input = (u.searchParams.get('q') || '').trim().slice(0, 200);
    if (!input) return send(400, {error: 'Cole o link ou o @ do canal.'});
    const ck = 'c|' + input, ch = CACHE.get(ck);
    if (ch && Date.now() - ch.t < TTL) return send(200, ch.d);
    try {
      const r = await queue(() => channelLookup(input));
      if (r.status === 200) CACHE.set(ck, {t: Date.now(), d: r.body});
      return send(r.status, r.body);
    } catch (e) { return send(500, {error: 'Falha na coleta: ' + e.message.split('\n')[0]}); }
  }
  if (u.searchParams.get('mode') === 'discover') { // buscar anunciantes (nome ou nicho) na Meta e no Google
    if (!q) return send(400, {error: 'Informe o nome do anunciante ou o nicho.'});
    const city = (u.searchParams.get('city') || '').trim().slice(0, 60);
    const dk = 'd|' + q + '|' + city, dh = CACHE.get(dk);
    if (dh && Date.now() - dh.t < TTL) return send(200, dh.d);
    try {
      const d = await queue(async () => {
        const ads = await metaCollect(`https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${COUNTRY}&media_type=all&q=${encodeURIComponent((q + ' ' + city).trim())}&search_type=keyword_unordered`, 8);
        const meta = P.groupPages(ads, q).slice(0, 25);
        let google = [];
        try { google = (await googleFind(q)).map(a => ({...a, match: P.nameMatch(a.name, q)})); } catch (e) {}
        return {q, meta, google, best: {meta: (meta.find(m => m.match) || {}).id || '', google: (google.find(g => g.match) || {}).id || ''}, source: 'coletor próprio'};
      });
      CACHE.set(dk, {t: Date.now(), d}); return send(200, d);
    } catch (e) { return send(500, {error: 'Falha na coleta: ' + e.message.split('\n')[0]}); }
  }
  const mid = (u.searchParams.get('mid') || '').trim(), gid = (u.searchParams.get('gid') || '').trim();
  if ((mid && !/^[A-Za-z0-9]+$/.test(mid)) || (gid && !/^[A-Za-z0-9]+$/.test(gid))) return send(400, {error: 'ID inválido.'});
  if (!q && !id && !mid && !gid) return send(400, {error: 'Informe q (nome) ou id.'});
  if (id && !/^[A-Za-z0-9]+$/.test(id)) return send(400, {error: 'ID inválido.'});
  const key = [q, id, type, pages, mid, gid].join('|'), hit = CACHE.get(key);
  if (hit && Date.now() - hit.t < TTL) return send(200, hit.d);
  try {
    const r = await queue(() => lookup({q, id, type, pages, mid, gid}));
    if (r.status === 200) CACHE.set(key, {t: Date.now(), d: r.body});
    send(r.status, r.body);
  } catch (e) { send(500, {error: 'Falha na coleta: ' + e.message.split('\n')[0]}); }
}).listen(PORT, () => console.log('Atlas coletor na porta ' + PORT));
