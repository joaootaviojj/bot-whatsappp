#!/data/data/com.termux/files/usr/bin/bash
set -e

cd "$HOME/bot-whatsapp"

echo "Parando bot..."
pm2 stop bot 2>/dev/null || true

echo "Baixando atualização..."
git pull

echo "Instalando dependências..."
npm install

echo "Reiniciando..."
pm2 restart bot || pm2 start index.js --name bot
pm2 save

echo ""
echo "✅ Atualizado com sucesso!"
echo ""
