#!/data/data/com.termux/files/usr/bin/bash
set -e

echo ""
echo "======================================"
echo "   INSTALADOR DO BOT WHATSAPP"
echo "======================================"
echo ""

pkg update -y
pkg upgrade -y
pkg install -y nodejs git

BOT_DIR="$HOME/bot-whatsapp"
REPO_URL="https://github.com/joaootaviojj/bot-whatsappp.git"

if [ -d "$BOT_DIR/.git" ]; then
  echo "Atualizando instalação existente..."
  cd "$BOT_DIR"
  git pull || true
else
  echo "Baixando bot..."
  rm -rf "$BOT_DIR"
  git clone "$REPO_URL" "$BOT_DIR"
  cd "$BOT_DIR"
fi

echo "Instalando dependências..."
npm install
npm install -g pm2

mkdir -p assets data

pm2 delete bot 2>/dev/null || true
pm2 start index.js --name bot
pm2 save

command -v termux-wake-lock >/dev/null && termux-wake-lock || true

echo ""
echo "======================================"
echo "   INSTALAÇÃO CONCLUÍDA!"
echo "======================================"
echo ""
echo "Escaneie o QR com:"
echo "  pm2 logs bot"
echo ""
echo "Para atualizar depois:"
echo "  cd \~/bot-whatsapp && bash update.sh"
echo ""
