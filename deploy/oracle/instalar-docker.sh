#!/usr/bin/env bash
# Roda na VM Ubuntu da Oracle: instala o Docker e prepara o .env.
set -e
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
[ -f .env ] || cp .env.example .env
echo "Docker instalado. Saia e entre de novo no SSH (exit), edite o .env (nano .env) e rode: docker compose up -d --build"
