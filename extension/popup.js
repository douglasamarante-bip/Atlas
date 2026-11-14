const $ = id => document.getElementById(id);
let rows = [];
const csvOf = r => r.map(x => [x.canal, x.nome, x.fmt, x.ini, x.fim, x.gasto].join(';')).join('\n');
const show = () => { $('n').textContent = rows.length + ' anúncios guardados'; };
const save = () => chrome.storage.local.set({rows, nome: $('nome').value, url: $('url').value});
(async () => { const s = await chrome.storage.local.get(['rows', 'url', 'nome']); rows = s.rows || []; $('url').value = s.url || ''; $('nome').value = s.nome || ''; show(); })();
async function scan(scroll) {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  $('st').textContent = scroll ? 'Rolando e capturando… (pode levar ~1 min)' : 'Capturando…';
  try {
    const res = await chrome.tabs.sendMessage(tab.id, {type: 'scan', scroll});
    const base = $('add').checked ? rows : [], seen = new Set(base.map(r => r.id));
    const nw = res.rows.filter(r => !seen.has(r.id));
    rows = base.concat(nw);
    if (!$('nome').value) $('nome').value = res.q;
    await save(); show();
    $('st').textContent = nw.length ? nw.length + ' novos anúncios capturados.' : 'Nenhum anúncio novo encontrado. Confirme se os resultados estão na tela e recarregue a página.';
  } catch (e) { $('st').textContent = 'Abra a Biblioteca da Meta ou o Centro de Transparência do Google e recarregue a página (F5).'; }
}
$('s1').onclick = () => scan(true);
$('s0').onclick = () => scan(false);
$('clr').onclick = async () => { rows = []; await save(); show(); $('st').textContent = 'Limpo.'; };
$('cp').onclick = async () => { await navigator.clipboard.writeText(csvOf(rows)); $('st').textContent = 'CSV copiado.'; };
$('dl').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csvOf(rows)], {type: 'text/csv'}));
  a.download = 'ads-radar.csv'; a.click();
};
$('send').onclick = async () => {
  let u; try { u = new URL($('url').value.trim()); } catch { $('st').textContent = 'URL do dashboard inválida.'; return; }
  if (!rows.length) { $('st').textContent = 'Capture anúncios antes de enviar.'; return; }
  const ok = await chrome.permissions.request({origins: [u.origin + '/*']});
  if (!ok) { $('st').textContent = 'Permissão negada.'; return; }
  await save();
  chrome.runtime.sendMessage({type: 'send', url: u.href, csv: csvOf(rows), nome: $('nome').value});
};
