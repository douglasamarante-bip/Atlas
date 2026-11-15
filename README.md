# Atlas

Dashboard de anúncios (Meta + Google) em site estático + extensão de Chrome que captura os anúncios reais.

```
site/        → o dashboard Atlas (Netlify publica esta pasta)
extension/   → extensão do Chrome (captura e envia ao dashboard)
collector/    → coletor próprio (Playwright + Docker), alternativa à SearchAPI
netlify/functions/ads.js → busca anúncios reais (Meta + Google) via SearchAPI
netlify.toml → publish = "site"
```

## 1. Publicar o site (GitHub → Netlify)
1. Crie um repositório no GitHub e suba tudo (`git add . && git commit -m "ads radar" && git push`).
2. Netlify → Add new site → Import an existing project → GitHub → escolha o repositório.
3. Build command: vazio. O `netlify.toml` já aponta a publicação para `site/`. Deploy.

## 1b. Ligar a busca de dados reais (SearchAPI)
A busca por nome/@/ID usa a função `netlify/functions/ads.js`, que consulta a [SearchAPI.io](https://www.searchapi.io) (Meta Ad Library + Google Ads Transparency Center). A chave fica só no servidor.
1. Crie uma conta na SearchAPI e copie sua chave de API.
2. Netlify → Site configuration → Environment variables, crie:
   - `SEARCHAPI_KEY` – sua chave (obrigatória)
   - `ATLAS_ACCESS_CODE` – um código de acesso à sua escolha (recomendado: sem ele, qualquer pessoa com o link gasta seus créditos). O dashboard pede esse código na primeira busca.
   - `META_COUNTRY` (padrão `BR`) e `GOOGLE_REGION` (padrão `BR`, se não for aceito usa `anywhere`) – opcionais.
3. Faça um novo deploy (Deploys → Trigger deploy). Pronto: digite um nome e os anúncios reais aparecem.
Cada busca gasta cerca de 6 a 9 créditos da SearchAPI (nome do anunciante, anúncios e divisão YouTube/Google). O resultado fica em cache por 5 minutos no navegador.
Sem a função (ou sem a chave), o dashboard continua funcionando em modo demonstração, extensão e CSV.

## 1c. Coletor próprio (alternativa à SearchAPI, sem mensalidade de API)
O `collector/` faz o mesmo trabalho da SearchAPI: abre a Biblioteca de Anúncios da Meta e o Centro de Transparência do Google num Chrome no servidor, lê os dados e devolve o mesmo JSON. Não roda no Netlify (precisa de navegador e leva 30–60 s por busca), então fica num servidor com Docker.
1. Crie um serviço Docker a partir deste repositório (Render, Railway, Fly.io ou um VPS), com **Root Directory = `collector`**. Reserve pelo menos 1 GB de RAM.
2. Variáveis: `ATLAS_ACCESS_CODE` (o mesmo código do dashboard) e, opcionais, `META_COUNTRY`, `GOOGLE_REGION`, `ALLOW_ORIGIN` (ex.: `https://seusite.netlify.app`) e `PROXY_URL` (`http://usuario:senha@host:porta`).
3. Abra `site/config.js` e coloque `window.ATLAS_API = 'https://SEU-COLETOR/ads';`. Faça commit: o Netlify atualiza o site.
Avisos: (a) a Meta e o Google leem anúncios por páginas que mudam sem aviso, então o coletor pode quebrar e precisar de ajuste; (b) servidores de datacenter costumam ser bloqueados ou receber captcha, e é para isso que a SearchAPI cobra proxies: se acontecer, use `PROXY_URL` com proxy residencial; (c) a coleta automatizada pode contrariar os termos de uso das plataformas: use com volume baixo e por sua conta e risco.

Guia para hospedar o coletor na Oracle Cloud (com HTTPS): `deploy/oracle/LEIAME.md`.

## Anunciantes pequenos, locais e de nicho
- **Buscar anunciantes:** digite o nome (ex.: *Sobrado Sabores*) ou um nicho (ex.: *confeitaria*) e, se quiser, a cidade/bairro. Aparecem os anunciantes da **Meta** (Facebook + Instagram) e do **Google** (Pesquisa + YouTube) com esse nome, o de nome igual vem marcado. **Analisar** abre o painel completo de um anunciante; **Ver tudo** abre Meta + Google + YouTube de uma vez.
- A Meta não filtra por cidade: a cidade só entra como palavra no texto dos anúncios.
- **Busca por ID:** aceita o ID de um anúncio (o “ID da biblioteca”), o ID da página (Meta) ou o ID do anunciante `AR…` (Google). Com o ID de anúncio, o Atlas descobre o anunciante sozinho.
- Pequenos anunciantes costumam estar no Google pela razão social: se o nome fantasia não achar, tente a razão social.

## 2. Instalar a extensão
1. Chrome → `chrome://extensions` → ative **Modo do desenvolvedor** → **Carregar sem compactação** → selecione a pasta `extension/`.
2. Abra a Biblioteca de Anúncios da Meta (facebook.com/ads/library) ou o Centro de Transparência do Google (adstransparency.google.com), pesquise o alvo e deixe os resultados na tela.
3. Clique no ícone da extensão → **Capturar (rolando a página)**. Repita no outro site para somar Meta + Google.
4. Cole a URL do seu site Netlify e clique em **Enviar ao dashboard** (ou baixe o CSV e use "Importar dados reais").

## Buscar pelo ID da biblioteca
- **Meta:** o *ID da biblioteca* aparece em cada anúncio (“ID da biblioteca: 123…”). O *ID da página* está na URL da página do anunciante (`view_all_page_id=`).
- **Google:** o *ID do anunciante* começa com `AR` e aparece na URL (`/advertiser/AR…`).
- No dashboard (campo “Buscar por ID”) ou no popup da extensão (“Abrir anunciante pelo ID”) você escolhe o tipo de ID e abre direto a página do anunciante. Depois use **Capturar** e **Enviar ao dashboard**.
- Na tabela, o número do anúncio da Meta vira link para o anúncio na biblioteca.

## Limites
- A Meta e o Google não divulgam gasto de anúncios comerciais: o gasto é estimado (dias no ar × orçamento diário médio por canal). Você pode preencher a coluna `gasto` no CSV quando souber o valor real.
- O Google mostra só a data da última exibição na lista; os dias no ar de anúncios do Google ficam subestimados.
- As duas páginas mudam de layout com frequência. Se a captura vier vazia, ajuste os textos de busca em `extension/content.js`.
- Respeite os termos de uso das plataformas: a extensão só lê o que já aparece na sua tela.
