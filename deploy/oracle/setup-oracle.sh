#!/usr/bin/env bash
# Atlas – instalação completa na VM Ubuntu da Oracle.  Uso: bash setup-oracle.sh
set -euo pipefail

read -rp "URL do repositório no GitHub (https://github.com/usuario/repo.git): " REPO
read -rp "Código de acesso do Atlas (invente um): " CODE
read -rp "Endereço do seu site no Netlify (https://xxx.netlify.app): " ORIGIN
read -rp "Proxy (opcional, http://usuario:senha@host:porta) [Enter para pular]: " PROXY

echo "==> Instalando Docker..."
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER" || true

echo "==> Baixando o projeto..."
DIR="$HOME/atlas-repo"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull; else git clone "$REPO" "$DIR"; fi
COMPOSE="$(find "$DIR" -path '*deploy/oracle/docker-compose.yml' | head -1)"
[ -n "$COMPOSE" ] || { echo "Não achei deploy/oracle/docker-compose.yml no repositório."; exit 1; }
cd "$(dirname "$COMPOSE")"

echo "==> Criando o .env..."
cat > .env <<ENVEOF
ATLAS_ACCESS_CODE=$CODE
META_COUNTRY=BR
GOOGLE_REGION=BR
ALLOW_ORIGIN=${ORIGIN%/}
ENVEOF
[ -n "$PROXY" ] && echo "PROXY_URL=$PROXY" >> .env
chmod 600 .env

echo "==> Subindo o coletor (o primeiro build leva alguns minutos)..."
sudo docker compose up -d --build

echo "==> Esperando o endereço HTTPS do túnel..."
URL=""
for _ in $(seq 1 40); do
  URL="$(sudo docker compose logs tunel 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1 || true)"
  [ -n "$URL" ] && break
  sleep 3
done
[ -n "$URL" ] || { echo "Túnel não apareceu. Veja: sudo docker compose logs tunel"; exit 1; }

for _ in $(seq 1 20); do curl -fsS "$URL/health" >/dev/null 2>&1 && break; sleep 3; done
echo
echo "============================================================"
curl -fsS "$URL/health" && echo "  <- coletor no ar" || echo "Coletor ainda não respondeu (veja: sudo docker compose logs coletor)"
echo "Coloque no site/config.js do repositório e faça commit/push:"
echo "  window.ATLAS_API = '$URL/ads';"
echo "============================================================"
