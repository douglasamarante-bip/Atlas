# Ads Radar

Dashboard de anúncios (Meta + Google) em site estático + extensão de Chrome que captura os anúncios reais.

```
site/        → o dashboard (Netlify publica esta pasta)
extension/   → extensão do Chrome (captura e envia ao dashboard)
netlify.toml → publish = "site"
```

## 1. Publicar o site (GitHub → Netlify)
1. Crie um repositório no GitHub e suba tudo (`git add . && git commit -m "ads radar" && git push`).
2. Netlify → Add new site → Import an existing project → GitHub → escolha o repositório.
3. Build command: vazio. O `netlify.toml` já aponta a publicação para `site/`. Deploy.

## 2. Instalar a extensão
1. Chrome → `chrome://extensions` → ative **Modo do desenvolvedor** → **Carregar sem compactação** → selecione a pasta `extension/`.
2. Abra a Biblioteca de Anúncios da Meta (facebook.com/ads/library) ou o Centro de Transparência do Google (adstransparency.google.com), pesquise o alvo e deixe os resultados na tela.
3. Clique no ícone da extensão → **Capturar (rolando a página)**. Repita no outro site para somar Meta + Google.
4. Cole a URL do seu site Netlify e clique em **Enviar ao dashboard** (ou baixe o CSV e use "Importar dados reais").

## Limites
- A Meta e o Google não divulgam gasto de anúncios comerciais: o gasto é estimado (dias no ar × orçamento diário médio por canal). Você pode preencher a coluna `gasto` no CSV quando souber o valor real.
- O Google mostra só a data da última exibição na lista; os dias no ar de anúncios do Google ficam subestimados.
- As duas páginas mudam de layout com frequência. Se a captura vier vazia, ajuste os textos de busca em `extension/content.js`.
- Respeite os termos de uso das plataformas: a extensão só lê o que já aparece na sua tela.
