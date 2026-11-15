# Atlas na Oracle Cloud (coletor + HTTPS)

## 1. Criar a VM
1. Crie a conta em oracle.com/cloud/free (pede cartão; escolha a região **Brasil – São Paulo** se disponível).
2. Compute → Instances → Create instance:
   - Image: **Ubuntu 22.04 ou 24.04**
   - Shape: **Ampere → VM.Standard.A1.Flex**, **2 OCPU e 12 GB** (limite do plano gratuito hoje; confira na página do Always Free)
   - SSH keys: gere ou envie sua chave pública e **baixe a privada**
   - Se aparecer "Out of capacity": tente outro horário/domínio de disponibilidade.
3. Anote o **IP público** da VM. Você **não precisa abrir portas**: o túnel da Cloudflare só faz conexões de saída.

## 2. Instalar (atalho: `bash setup-oracle.sh` faz tudo abaixo)
```bash
ssh -i SUA_CHAVE.key ubuntu@IP_DA_VM
git clone https://github.com/SEU_USUARIO/SEU_REPO.git && cd SEU_REPO/deploy/oracle
./instalar-docker.sh
exit                       # entre de novo no SSH para o Docker valer
cd SEU_REPO/deploy/oracle
nano .env                  # defina ATLAS_ACCESS_CODE e ALLOW_ORIGIN
docker compose up -d --build
```
O primeiro build leva alguns minutos (baixa o Chrome para ARM).

## 3. Pegar o endereço HTTPS
```bash
docker compose logs tunel | grep trycloudflare
curl https://XXXX.trycloudflare.com/health      # deve responder {"ok":true}
```
Em `site/config.js` do repositório:
```js
window.ATLAS_API = 'https://XXXX.trycloudflare.com/ads';
```
Faça commit e push: o Netlify atualiza o site. No primeiro uso, o dashboard pede o código de acesso (o mesmo `ATLAS_ACCESS_CODE`).

> O endereço do túnel rápido **muda quando o contêiner reinicia**. Para um endereço fixo: crie uma conta na Cloudflare, adicione um domínio seu, vá em Zero Trust → Networks → Tunnels → Create tunnel, copie o token, aponte o hostname público para `http://coletor:8080` e no `.env` coloque `TUNNEL_CMD=tunnel --no-autoupdate run` e `TUNNEL_TOKEN=...`. Depois `docker compose up -d`.

## 4. Operação
- Atualizar: `git pull && docker compose up -d --build`
- Logs: `docker compose logs -f coletor`
- Memória: `docker stats`

## Problemas comuns
- **Build falha no ARM**: me mande o erro; a alternativa é uma VM AMD (no plano gratuito é pequena demais, 1 GB).
- **Busca volta vazia ou com "bloqueou o acesso"**: a Meta/Google bloquearam o IP da Oracle. Use `PROXY_URL` (proxy residencial, pago) no `.env` e rode `docker compose up -d`.
- **Erro de CORS/401 no navegador**: confira `ALLOW_ORIGIN` (sem barra no final) e o código de acesso.
