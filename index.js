const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs = require('fs-extra');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const path = require('path');

const OWNER_NUMBER = '5567998970260';
const TARGET_GROUP_JID = '120363407402053493@g.us';
const MENU_IMAGE_PATH = './assets/menu.jpg';
const DATA_DIR = './data';
const WATCH_FILE = path.join(DATA_DIR, 'watched.json');
const VOAUTO_FILE = path.join(DATA_DIR, 'voauto.json');

let sock;
const messageCache = new Map();
const deletedCache = new Map();
let watchedChats = new Set();
let voautoChats = new Set();

// ====================== PERSISTÊNCIA ======================
function loadSets() {
    fs.ensureDirSync(DATA_DIR);
    try {
        if (fs.existsSync(WATCH_FILE)) {
            watchedChats = new Set(JSON.parse(fs.readFileSync(WATCH_FILE, 'utf8')));
        }
        if (fs.existsSync(VOAUTO_FILE)) {
            voautoChats = new Set(JSON.parse(fs.readFileSync(VOAUTO_FILE, 'utf8')));
        }
        console.log(`Watch carregados: ${watchedChats.size} | VO Auto: ${voautoChats.size}`);
    } catch (e) {
        console.error('Erro ao carregar dados:', e);
    }
}

function saveWatched() {
    fs.ensureDirSync(DATA_DIR);
    fs.writeFileSync(WATCH_FILE, JSON.stringify([...watchedChats], null, 2));
}

function saveVoauto() {
    fs.ensureDirSync(DATA_DIR);
    fs.writeFileSync(VOAUTO_FILE, JSON.stringify([...voautoChats], null, 2));
}

async function streamToBuffer(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on('data', (chunk) => chunks.push(chunk));
        readableStream.on('end', () => resolve(Buffer.concat(chunks)));
        readableStream.on('error', reject);
    });
}

function getMenuText() {
    return `╭─────────────╮
│  🌑 𝗕𝗢𝗧 𝗠𝗘𝗡𝗨  │
╰─────────────╯

📌 𝗖𝗢𝗠𝗔𝗡𝗗𝗢𝗦 𝗣𝗥𝗜𝗡𝗖𝗜𝗣𝗔𝗜𝗦
┌────────────────────────────
│ !del
│ ↳ Recupera mensagens apagadas
│   (texto, foto, vídeo, áudio e View Once)
│
│ !adm
│ ↳ Captura View Once
│   (responda a mídia com o comando)
│
│ !id
│ ↳ Mostra o ID do chat atual
└────────────────────────────

👁️ 𝗠𝗢𝗡𝗜𝗧𝗢𝗥𝗔𝗠𝗘𝗡𝗧𝗢
┌────────────────────────────
│ !watch
│ ↳ Ativa anti-delete automático
│   neste chat/grupo
│
│ !unwatch
│ ↳ Desativa o monitoramento
│
│ !voauto on
│ ↳ Salva View Once automaticamente
│   neste chat
│
│ !voauto off
│ ↳ Desativa o salvamento automático
└────────────────────────────

🛠️ 𝗨𝗧𝗜𝗟𝗜𝗧Á𝗥𝗜𝗢𝗦
┌────────────────────────────
│ .menu
│ ↳ Mostra este menu
└────────────────────────────

💡 𝗗𝗜𝗖𝗔
Comandos de monitoramento apagam
a própria mensagem para não deixar rastro.`;
}

async function sendRecoveredItems(chatJid, items) {
    for (const item of items) {
        try {
            const hora = new Date(item.timestamp).toLocaleString('pt-BR');
            let caption = `🗑️ *MENSAGEM APAGADA RECUPERADA*\n\n` +
                          `👤 De: ${item.senderName}\n` +
                          `🕒 Hora: ${hora}\n`;

            if (item.type === 'text') {
                caption += `\n📝 Texto:\n${item.content}`;
                await sock.sendMessage(TARGET_GROUP_JID, { text: caption });
            } else if (item.type === 'image' || item.type === 'video') {
                const tipo = item.isViewOnce ? 'View Once' : (item.type === 'image' ? 'Foto' : 'Vídeo');
                caption += `\n📎 Tipo: ${tipo}`;
                await sock.sendMessage(TARGET_GROUP_JID, {
                    [item.type]: item.buffer,
                    caption
                });
            } else if (item.type === 'audio') {
                caption += `\n📎 Tipo: Áudio`;
                await sock.sendMessage(TARGET_GROUP_JID, {
                    audio: item.buffer,
                    mimetype: item.mimetype || 'audio/ogg; codecs=opus',
                    ptt: item.ptt || false,
                    caption
                });
                // Alguns clientes ignoram caption em áudio, então manda o texto junto
                await sock.sendMessage(TARGET_GROUP_JID, { text: caption });
            }
        } catch (e) {
            console.error('Erro ao enviar item recuperado:', e);
        }
    }
}

async function startBot() {
    loadSets();

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ['Chrome', 'Linux', 'Desktop'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('Escaneie o QR Code abaixo:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log('✅ Bot conectado com sucesso!');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada. Reconectando?', shouldReconnect);

            if (shouldReconnect) {
                console.log('Aguardando 5 segundos para reconectar...');
                setTimeout(() => startBot(), 5000);
            }
        }
    });

    // ====================== MENSAGENS ======================
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;

        const chatJid = msg.key.remoteJid;
        const messageId = msg.key.id;
        const from = msg.key.remoteJid;

        let sender = (msg.key.participant || from).replace('@s.whatsapp.net', '').replace('@lid', '').split(':')[0];
        const isOwner = sender.includes(OWNER_NUMBER) || msg.key.fromMe === true;

        // Cache de mensagens de outros
        if (!msg.key.fromMe) {
            if (!messageCache.has(chatJid)) messageCache.set(chatJid, new Map());
            messageCache.get(chatJid).set(messageId, msg);

            const chatCache = messageCache.get(chatJid);
            if (chatCache.size > 500) {
                const firstKey = chatCache.keys().next().value;
                chatCache.delete(firstKey);
            }

            // VOAUTO: salva View Once automaticamente
            if (voautoChats.has(chatJid)) {
                try {
                    const content = msg.message;
                    let mediaMsg = null;
                    let type = '';
                    let isVO = false;

                    if (content.viewOnceMessage?.message || content.viewOnceMessageV2?.message || content.ephemeralMessage?.message) {
                        const inner = content.viewOnceMessage?.message ||
                                      content.viewOnceMessageV2?.message ||
                                      content.ephemeralMessage?.message;
                        isVO = true;
                        if (inner?.imageMessage) { mediaMsg = inner.imageMessage; type = 'image'; }
                        else if (inner?.videoMessage) { mediaMsg = inner.videoMessage; type = 'video'; }
                    } else if (content.imageMessage?.viewOnce) {
                        mediaMsg = content.imageMessage;
                        type = 'image';
                        isVO = true;
                    } else if (content.videoMessage?.viewOnce) {
                        mediaMsg = content.videoMessage;
                        type = 'video';
                        isVO = true;
                    }

                    if (mediaMsg && isVO) {
                        const stream = await downloadContentFromMessage(mediaMsg, type);
                        const buffer = await streamToBuffer(stream);

                        let senderName = sender;
                        try {
                            const contact = await sock.getName(msg.key.participant || from);
                            if (contact) senderName = contact;
                        } catch (e) {}

                        const item = {
                            id: messageId,
                            senderName,
                            timestamp: (msg.messageTimestamp * 1000) || Date.now(),
                            type,
                            content: null,
                            buffer,
                            isViewOnce: true
                        };

                        if (!deletedCache.has(chatJid)) deletedCache.set(chatJid, []);
                        deletedCache.get(chatJid).push(item);
                        console.log(`View Once salva automaticamente em ${chatJid}`);
                    }
                } catch (e) {
                    console.error('Erro no voauto:', e);
                }
            }
        }

        let text = '';
        if (msg.message.conversation) text = msg.message.conversation;
        else if (msg.message.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;
        else if (msg.message.imageMessage?.caption) text = msg.message.imageMessage.caption;
        text = (text || '').trim().toLowerCase();

        if (!isOwner) return;

        // ===== .img =====
        if (text === '.img') {
            try {
                let mediaMsg = null;
                if (msg.message.imageMessage) {
                    mediaMsg = msg.message.imageMessage;
                } else if (msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
                    mediaMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
                }

                if (!mediaMsg) {
                    await sock.sendMessage(from, { text: '⚠️ Envie uma *foto* com a legenda .img ou responda uma foto com .img' });
                    return;
                }

                const stream = await downloadContentFromMessage(mediaMsg, 'image');
                const buffer = await streamToBuffer(stream);
                fs.ensureDirSync('./assets');
                fs.writeFileSync(MENU_IMAGE_PATH, buffer);

                await sock.sendMessage(from, { react: { text: '🖼️', key: msg.key } });
                await sock.sendMessage(from, { delete: msg.key });
                console.log('Imagem do menu atualizada!');
            } catch (e) {
                console.error('Erro no .img:', e);
            }
            return;
        }

        // ===== .menu =====
        if (text === '.menu') {
            const menuText = getMenuText();
            try {
                if (fs.existsSync(MENU_IMAGE_PATH)) {
                    const imageBuffer = fs.readFileSync(MENU_IMAGE_PATH);
                    await sock.sendMessage(from, { image: imageBuffer, caption: menuText });
                } else {
                    await sock.sendMessage(from, { text: menuText });
                }
            } catch (e) {
                await sock.sendMessage(from, { text: menuText });
            }
            return;
        }

        // ===== !id =====
        if (text === '!id') {
            console.log('\nID:', from);
            await sock.sendMessage(from, { text: `📌 *ID deste chat:*\n\`${from}\`` });
            return;
        }

        // ===== !watch =====
        if (text === '!watch') {
            watchedChats.add(from);
            saveWatched();
            await sock.sendMessage(from, { react: { text: '👁️', key: msg.key } });
            await sock.sendMessage(from, { delete: msg.key });
            console.log(`Watch ativado: ${from}`);
            return;
        }

        // ===== !unwatch =====
        if (text === '!unwatch') {
            watchedChats.delete(from);
            saveWatched();
            await sock.sendMessage(from, { react: { text: '📴', key: msg.key } });
            await sock.sendMessage(from, { delete: msg.key });
            console.log(`Watch desativado: ${from}`);
            return;
        }

        // ===== !voauto on =====
        if (text === '!voauto on') {
            voautoChats.add(from);
            saveVoauto();
            await sock.sendMessage(from, { react: { text: '🔒', key: msg.key } });
            await sock.sendMessage(from, { delete: msg.key });
            console.log(`VO Auto ativado: ${from}`);
            return;
        }

        // ===== !voauto off =====
        if (text === '!voauto off') {
            voautoChats.delete(from);
            saveVoauto();
            await sock.sendMessage(from, { react: { text: '🔓', key: msg.key } });
            await sock.sendMessage(from, { delete: msg.key });
            console.log(`VO Auto desativado: ${from}`);
            return;
        }

        // ===== !del =====
        if (text === '!del') {
            const deleted = deletedCache.get(from) || [];
            await sock.sendMessage(from, { react: { text: '👁️‍🗨️', key: msg.key } });
            await sock.sendMessage(from, { delete: msg.key });
            if (deleted.length === 0) return;
            await sendRecoveredItems(from, deleted);
            deletedCache.set(from, []);
            return;
        }

        // ===== !adm =====
        if (text === '!adm') {
            try {
                const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quoted) {
                    await sock.sendMessage(from, { text: '⚠️ Responda a uma mídia *View Once* com !adm' });
                    return;
                }

                let mediaMsg = null;
                let type = '';

                if (quoted.imageMessage) { mediaMsg = quoted.imageMessage; type = 'image'; }
                else if (quoted.videoMessage) { mediaMsg = quoted.videoMessage; type = 'video'; }
                else if (quoted.viewOnceMessage?.message) {
                    const inner = quoted.viewOnceMessage.message;
                    if (inner.imageMessage) { mediaMsg = inner.imageMessage; type = 'image'; }
                    else if (inner.videoMessage) { mediaMsg = inner.videoMessage; type = 'video'; }
                } else if (quoted.viewOnceMessageV2?.message) {
                    const inner = quoted.viewOnceMessageV2.message;
                    if (inner.imageMessage) { mediaMsg = inner.imageMessage; type = 'image'; }
                    else if (inner.videoMessage) { mediaMsg = inner.videoMessage; type = 'video'; }
                } else if (quoted.ephemeralMessage?.message) {
                    const inner = quoted.ephemeralMessage.message;
                    if (inner.imageMessage) { mediaMsg = inner.imageMessage; type = 'image'; }
                    else if (inner.videoMessage) { mediaMsg = inner.videoMessage; type = 'video'; }
                }

                if (!mediaMsg) {
                    await sock.sendMessage(from, { text: '❌ Não foi possível identificar a mídia View Once.' });
                    return;
                }

                const mediaStream = await downloadContentFromMessage(mediaMsg, type);
                const buffer = await streamToBuffer(mediaStream);

                await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });
                await sock.sendMessage(from, { delete: msg.key });

                const caption = `🔒 *View Once Capturada*\nDe: ${sender}\nHora: ${new Date().toLocaleString('pt-BR')}`;
                await sock.sendMessage(TARGET_GROUP_JID, { [type]: buffer, caption });
            } catch (e) {
                console.error('Erro no !adm:', e);
                await sock.sendMessage(from, { text: '❌ Erro ao capturar a mídia.' });
            }
        }
    });

    // ====================== MENSAGENS APAGADAS ======================
    sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            const { key, update: msgUpdate } = update;

            if (msgUpdate.messageStubType === 1) {
                const chatJid = key.remoteJid;
                const messageId = key.id;
                const senderJid = key.participant || key.remoteJid;

                if (messageCache.has(chatJid) && messageCache.get(chatJid).has(messageId)) {
                    const original = messageCache.get(chatJid).get(messageId);

                    let senderName = senderJid.replace('@s.whatsapp.net', '').replace('@lid', '');
                    try {
                        const contact = await sock.getName(senderJid);
                        if (contact) senderName = contact;
                    } catch (e) {}

                    const deletedItem = {
                        id: messageId,
                        senderName,
                        timestamp: original.messageTimestamp * 1000 || Date.now(),
                        type: 'text',
                        content: null,
                        buffer: null,
                        isViewOnce: false,
                        mimetype: null,
                        ptt: false
                    };

                    const msgContent = original.message;

                    if (msgContent?.conversation) {
                        deletedItem.content = msgContent.conversation;
                    } else if (msgContent?.extendedTextMessage?.text) {
                        deletedItem.content = msgContent.extendedTextMessage.text;
                    } else if (msgContent?.imageMessage) {
                        deletedItem.type = 'image';
                        try {
                            const stream = await downloadContentFromMessage(msgContent.imageMessage, 'image');
                            deletedItem.buffer = await streamToBuffer(stream);
                        } catch (e) {
                            deletedItem.content = '[Erro ao baixar imagem]';
                            deletedItem.type = 'text';
                        }
                    } else if (msgContent?.videoMessage) {
                        deletedItem.type = 'video';
                        try {
                            const stream = await downloadContentFromMessage(msgContent.videoMessage, 'video');
                            deletedItem.buffer = await streamToBuffer(stream);
                        } catch (e) {
                            deletedItem.content = '[Erro ao baixar vídeo]';
                            deletedItem.type = 'text';
                        }
                    } else if (msgContent?.audioMessage) {
                        deletedItem.type = 'audio';
                        deletedItem.ptt = msgContent.audioMessage.ptt || false;
                        deletedItem.mimetype = msgContent.audioMessage.mimetype || 'audio/ogg; codecs=opus';
                        try {
                            const stream = await downloadContentFromMessage(msgContent.audioMessage, 'audio');
                            deletedItem.buffer = await streamToBuffer(stream);
                        } catch (e) {
                            deletedItem.content = '[Erro ao baixar áudio]';
                            deletedItem.type = 'text';
                        }
                    } else if (msgContent?.viewOnceMessage?.message || msgContent?.viewOnceMessageV2?.message || msgContent?.ephemeralMessage?.message) {
                        const inner = msgContent.viewOnceMessage?.message ||
                                      msgContent.viewOnceMessageV2?.message ||
                                      msgContent.ephemeralMessage?.message;
                        deletedItem.isViewOnce = true;

                        if (inner?.imageMessage) {
                            deletedItem.type = 'image';
                            try {
                                const stream = await downloadContentFromMessage(inner.imageMessage, 'image');
                                deletedItem.buffer = await streamToBuffer(stream);
                            } catch (e) {
                                deletedItem.content = '[Erro ao baixar View Once]';
                                deletedItem.type = 'text';
                            }
                        } else if (inner?.videoMessage) {
                            deletedItem.type = 'video';
                            try {
                                const stream = await downloadContentFromMessage(inner.videoMessage, 'video');
                                deletedItem.buffer = await streamToBuffer(stream);
                            } catch (e) {
                                deletedItem.content = '[Erro ao baixar View Once]';
                                deletedItem.type = 'text';
                            }
                        }
                    }

                    if (deletedItem.content || deletedItem.buffer) {
                        if (!deletedCache.has(chatJid)) deletedCache.set(chatJid, []);
                        deletedCache.get(chatJid).push(deletedItem);

                        if (watchedChats.has(chatJid)) {
                            const items = deletedCache.get(chatJid);
                            await sendRecoveredItems(chatJid, items);
                            deletedCache.set(chatJid, []);
                        }
                    }

                    messageCache.get(chatJid).delete(messageId);
                }
            }
        }
    });
}

startBot();
