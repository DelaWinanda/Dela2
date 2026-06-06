import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import mqtt from "mqtt";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// ================= DAFTAR BROKER MQTT (Sesuai ESP32) =================
const brokerList = [
  {
    nama: "CloudAMQP",
    server: "kingfisher.lmq.cloudamqp.com",
    port: 8883,
    user: "azfrfvzw:azfrfvzw",
    pass: "HMxpFwhwM9i7bDo2bp8XoBipnq2ZcmxQ",
    clientId: "ESP_CloudAMQP_Web"
  },
  {
    nama: "Cedalo",
    server: "pf-26xt4cmufmfw6kr1zpyq.cedalo.cloud",
    port: 8883,
    user: "Esp2",
    pass: "d",
    clientId: "Esp32Client_Web"
  },
  {
    nama: "Flespi",
    server: "mqtt.flespi.io",
    port: 8883,
    user: "UJyFksta5S1kfEMf95YVPQIn0X2o9u4OFvWvVeAMuGEORyCzS5elmDywO9xhS5ay",
    pass: "",
    clientId: "ESP32Flespi001_Web"
  }
];

// ================= STATE PERANGKAT YANG DISINKRONKAN =================
let activeBrokerIndex = 0;
let relays = { relay1: false, relay2: false, relay3: false, relay4: false };
let variations = { variasi1: false, variasi2: false };
let sensors = { suhu: 28.0, kelembaban: 65.0, lastUpdate: new Date().toISOString() };
let mqttStatus: 'connected' | 'disconnected' | 'reconnecting' | 'error' = 'disconnected';
let mqttError = "";
let logs: any[] = [];
let simulatorActive = false;

// ================= DUKUNGAN GEMINI AI =================
let ai: GoogleGenAI | null = null;
function getGemini() {
  if (!ai) {
    const key = process.env.GEMINI_API_KEY;
    if (key && key !== "MY_GEMINI_API_KEY") {
      ai = new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
    }
  }
  return ai;
}

// Untuk broadcast update ke client
let sseClients: { id: number; res: express.Response }[] = [];

function addLog(type: 'info' | 'error' | 'command' | 'sensor' | 'broker', message: string) {
  const log = {
    id: Math.random().toString(36).substring(2, 9),
    timestamp: new Date().toISOString(),
    type,
    message
  };
  logs.unshift(log);
  if (logs.length > 100) {
    logs.pop();
  }
  broadcastState();
}

function broadcastState() {
  const state = {
    relays,
    variations,
    sensors,
    activeBroker: activeBrokerIndex,
    mqttStatus,
    mqttError,
    logs,
    simulatorActive
  };
  const data = JSON.stringify(state);
  sseClients.forEach(client => {
    client.res.write(`data: ${data}\n\n`);
  });
}

// ================= KONEKSI MQTT CLIENT SECURE =================
let mqttClient: mqtt.MqttClient | null = null;

function connectToBroker(index: number) {
  if (mqttClient) {
    try {
      mqttClient.removeAllListeners();
      mqttClient.end(true);
    } catch (e: any) {
      console.warn("Error forcing close on previous MQTT client:", e.message);
    }
  }

  activeBrokerIndex = index;
  const config = brokerList[index];
  addLog('broker', `Sistem beralih ke Broker [${config.nama}] di ${config.server}...`);
  mqttStatus = 'reconnecting';
  broadcastState();

  const options: mqtt.IClientOptions = {
    port: config.port,
    host: config.server,
    username: config.user,
    password: config.pass,
    clientId: `${config.clientId}_Web_${Math.random().toString(16).substring(2, 6)}`,
    rejectUnauthorized: false, // Menirukan setInsecure() ESP32
    protocol: 'mqtts', // Menggunakan TLS port 8883
    connectTimeout: 7000,
    reconnectPeriod: 5000,
  };

  try {
    mqttClient = mqtt.connect(`mqtts://${config.server}:${config.port}`, options);

    mqttClient.on('connect', () => {
      mqttStatus = 'connected';
      addLog('broker', `Koneksi Web terhubung ke broker [${config.nama}]!`);
      
      // Subscribe topic kontrol dan sensor lengkap
      mqttClient?.subscribe('sensor/suhu');
      mqttClient?.subscribe('sensor/kelembaban');
      mqttClient?.subscribe('status/broker');
      mqttClient?.subscribe('kontrol/relay1');
      mqttClient?.subscribe('kontrol/relay2');
      mqttClient?.subscribe('kontrol/relay3');
      mqttClient?.subscribe('kontrol/relay4');
      mqttClient?.subscribe('kontrol/variasi1');
      mqttClient?.subscribe('kontrol/variasi2');
      mqttClient?.subscribe('kontrol/broker');
      
      broadcastState();
    });

    mqttClient.on('message', (topic, payload) => {
      const msg = payload.toString();
      handleMqttIncoming(topic, msg);
    });

    mqttClient.on('close', () => {
      if (mqttStatus === 'connected') {
        mqttStatus = 'disconnected';
        addLog('broker', `Koneksi ke [${config.nama}] terputus silang.`);
        broadcastState();
      }
    });

    mqttClient.on('error', (err) => {
      mqttStatus = 'error';
      mqttError = err.message;
      addLog('error', `Kesalahan broker [${config.nama}]: ${err.message}`);
      broadcastState();
    });
  } catch (error: any) {
    mqttStatus = 'error';
    mqttError = error.message;
    addLog('error', `Gagal menghubungkan broker: ${error.message}`);
    broadcastState();
  }
}

// Handler pesan MQTT masuk (Sinkronisasi Web + ESP32)
function handleMqttIncoming(topic: string, msg: string) {
  if (topic === 'sensor/suhu') {
    const val = parseFloat(msg);
    if (!isNaN(val)) {
      sensors.suhu = val;
      sensors.lastUpdate = new Date().toISOString();
      addLog('sensor', `Suhu fisik ESP32 terdeteksi: ${val} °C`);
    }
  } else if (topic === 'sensor/kelembaban') {
    const val = parseFloat(msg);
    if (!isNaN(val)) {
      sensors.kelembaban = val;
      sensors.lastUpdate = new Date().toISOString();
      addLog('sensor', `Kelembaban fisik ESP32 terdeteksi: ${val} %`);
    }
  } else if (topic === 'status/broker') {
    addLog('broker', `Konfirmasi ESP32 aktif: ${msg}`);
  } else if (topic === 'kontrol/relay1') {
    relays.relay1 = (msg === 'ON');
    addLog('command', `Sinkron Relay 1: ${msg}`);
  } else if (topic === 'kontrol/relay2') {
    relays.relay2 = (msg === 'ON');
    addLog('command', `Sinkron Relay 2: ${msg}`);
  } else if (topic === 'kontrol/relay3') {
    relays.relay3 = (msg === 'ON');
    addLog('command', `Sinkron Relay 3: ${msg}`);
  } else if (topic === 'kontrol/relay4') {
    relays.relay4 = (msg === 'ON');
    addLog('command', `Sinkron Relay 4: ${msg}`);
  } else if (topic === 'kontrol/variasi1') {
    variations.variasi1 = (msg === 'START');
    if (variations.variasi1) variations.variasi2 = false;
    addLog('command', `Sinkron Variasi 1: ${msg}`);
  } else if (topic === 'kontrol/variasi2') {
    variations.variasi2 = (msg === 'START');
    if (variations.variasi2) variations.variasi1 = false;
    addLog('command', `Sinkron Variasi 2: ${msg}`);
  } else if (topic === 'kontrol/broker') {
    const bTarget = parseInt(msg) - 1;
    if (bTarget >= 0 && bTarget < brokerList.length && bTarget !== activeBrokerIndex) {
      addLog('broker', `Pesan MQTT mendeteksi perubahan broker ke Indeks ${bTarget + 1}. Menyemak...`);
      setTimeout(() => {
        connectToBroker(bTarget);
      }, 500);
    }
  }
}

// Mulai hubungkan broker pertama (CloudAMQP) saat server nyala
connectToBroker(0);

// ================= BACKEND SIMULATOR ESP32 (VIRTUAL) =================
let varStep = 0;
setInterval(() => {
  if (simulatorActive) {
    // 1. Ubah nilai sensor secara acak & alami
    const driftT = (Math.random() - 0.5) * 0.4;
    const driftH = (Math.random() - 0.5) * 1.0;
    sensors.suhu = parseFloat(Math.max(16, Math.min(42, sensors.suhu + driftT)).toFixed(1));
    sensors.kelembaban = parseFloat(Math.max(30, Math.min(99, sensors.kelembaban + driftH)).toFixed(1));
    sensors.lastUpdate = new Date().toISOString();

    if (mqttClient && mqttStatus === 'connected') {
      mqttClient.publish('sensor/suhu', sensors.suhu.toString(), { qos: 1 });
      mqttClient.publish('sensor/kelembaban', sensors.kelembaban.toString(), { qos: 1 });
    } else {
      broadcastState();
    }

    // 2. Jalankan efek variasi relay secara otomatis
    if (variations.variasi1) {
      const urutanMaju = ["relay1", "relay2", "relay3", "relay4"];
      urutanMaju.forEach((key, idx) => {
        relays[key as keyof typeof relays] = (idx === varStep);
      });
      addLog('sensor', `[Simu ESP32] Variasi 1 berjalan -> Relay ${varStep + 1} ON`);
      varStep = (varStep + 1) % 4;
      broadcastState();
    } else if (variations.variasi2) {
      const urutanMundur = ["relay4", "relay3", "relay2", "relay1"];
      urutanMundur.forEach((key, idx) => {
        relays[key as keyof typeof relays] = (idx === varStep);
      });
      addLog('sensor', `[Simu ESP32] Variasi 2 berjalan -> Relay ${4 - varStep} ON`);
      varStep = (varStep + 1) % 4;
      broadcastState();
    }
  }
}, 5000);

// ================= REST API ENDPOINTS =================

// Info server
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", broker: brokerList[activeBrokerIndex].nama });
});

// Tarik status terbaru
app.get("/api/status", (req, res) => {
  res.json({
    relays,
    variations,
    sensors,
    activeBroker: activeBrokerIndex,
    mqttStatus,
    mqttError,
    logs,
    simulatorActive
  });
});

// Nyalakan / matikan simulator
app.post("/api/simulator", (req, res) => {
  const { active } = req.body;
  simulatorActive = !!active;
  addLog('info', `Mode Simulasi Virtual ESP32: ${simulatorActive ? 'AKTIF' : 'NON-AKTIF'}`);
  res.json({ success: true, simulatorActive });
});

// Kirim Kontrol Relay manual, variasi dan broker
app.post("/api/control", (req, res) => {
  const { topic, message } = req.body;
  
  if (mqttClient && mqttStatus === 'connected') {
    mqttClient.publish(topic, message, { qos: 1 });
    addLog('command', `Mengirim MQTT [${topic}]: ${message}`);
  } else {
    addLog('command', `Mengirim Lokalnya (MQTT terputus) [${topic}]: ${message}`);
  }

  // Lakukan pemutakhiran state lokal secara responsif
  if (topic === "kontrol/relay1") relays.relay1 = (message === "ON");
  else if (topic === "kontrol/relay2") relays.relay2 = (message === "ON");
  else if (topic === "kontrol/relay3") relays.relay3 = (message === "ON");
  else if (topic === "kontrol/relay4") relays.relay4 = (message === "ON");
  else if (topic === "kontrol/variasi1") {
    variations.variasi1 = (message === "START");
    if (variations.variasi1) {
      variations.variasi2 = false;
      varStep = 0;
    } else {
      // Matikan semua
      relays.relay1 = false; relays.relay2 = false; relays.relay3 = false; relays.relay4 = false;
    }
  } else if (topic === "kontrol/variasi2") {
    variations.variasi2 = (message === "START");
    if (variations.variasi2) {
      variations.variasi1 = false;
      varStep = 0;
    } else {
      // Matikan semua
      relays.relay1 = false; relays.relay2 = false; relays.relay3 = false; relays.relay4 = false;
    }
  } else if (topic === "kontrol/broker") {
    const val = parseInt(message) - 1;
    if (val >= 0 && val < brokerList.length) {
      connectToBroker(val);
    }
  }

  broadcastState();
  res.json({ success: true });
});

// SSE endpoint
app.get("/api/events", (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const id = Date.now();
  sseClients.push({ id, res });

  // Kirim data perdana
  const currentStatus = {
    relays,
    variations,
    sensors,
    activeBroker: activeBrokerIndex,
    mqttStatus,
    mqttError,
    logs,
    simulatorActive
  };
  res.write(`data: ${JSON.stringify(currentStatus)}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== id);
  });
});

// API Perintah Suara (Speech AI & NLP Analyzer)
app.post("/api/voice-command", async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: "Sebutkan perintah suara terlebih dahulu." });
  }

  addLog('command', `Perintah Suara Masuk: "${text}"`);

  const query = text.toLowerCase();
  let matchFound = false;
  let actionText = "";
  let speechResponse = "";

  // 1. FAST LOCAL TRANSLATION (Kecepatan tinggi, nol latensi)
  if (query.includes('nyala') || query.includes('hidup') || query.includes('on') || query.includes('hidupkan')) {
    if (query.includes('semua')) {
      relays.relay1 = true; relays.relay2 = true; relays.relay3 = true; relays.relay4 = true;
      if (mqttClient && mqttStatus === 'connected') {
        mqttClient.publish('kontrol/relay1', 'ON', { qos: 1 });
        mqttClient.publish('kontrol/relay2', 'ON', { qos: 1 });
        mqttClient.publish('kontrol/relay3', 'ON', { qos: 1 });
        mqttClient.publish('kontrol/relay4', 'ON', { qos: 1 });
      }
      actionText = "Menyalakan Semua Relay";
      speechResponse = "Baik, semua relay telah berhasil dinyalakan.";
      matchFound = true;
    } else if (query.includes('satu') || query.includes(' 1')) {
      relays.relay1 = true;
      if (mqttClient && mqttStatus === 'connected') mqttClient.publish('kontrol/relay1', 'ON', { qos: 1 });
      actionText = "Menyalakan Relay 1";
      speechResponse = "Siap, relay satu telah dinyalakan.";
      matchFound = true;
    } else if (query.includes('dua') || query.includes(' 2')) {
      relays.relay2 = true;
      if (mqttClient && mqttStatus === 'connected') mqttClient.publish('kontrol/relay2', 'ON', { qos: 1 });
      actionText = "Menyalakan Relay 2";
      speechResponse = "Siap, relay dua telah dinyalakan.";
      matchFound = true;
    } else if (query.includes('tiga') || query.includes(' 3')) {
      relays.relay3 = true;
      if (mqttClient && mqttStatus === 'connected') mqttClient.publish('kontrol/relay3', 'ON', { qos: 1 });
      actionText = "Menyalakan Relay 3";
      speechResponse = "Siap, relay tiga telah dinyalakan.";
      matchFound = true;
    } else if (query.includes('empat') || query.includes(' 4')) {
      relays.relay4 = true;
      if (mqttClient && mqttStatus === 'connected') mqttClient.publish('kontrol/relay4', 'ON', { qos: 1 });
      actionText = "Menyalakan Relay 4";
      speechResponse = "Siap, relay empat telah dinyalakan.";
      matchFound = true;
    }
  } else if (query.includes('mati') || query.includes('off') || query.includes('matikan')) {
    if (query.includes('semua')) {
      relays.relay1 = false; relays.relay2 = false; relays.relay3 = false; relays.relay4 = false;
      variations.variasi1 = false; variations.variasi2 = false;
      if (mqttClient && mqttStatus === 'connected') {
        mqttClient.publish('kontrol/relay1', 'OFF', { qos: 1 });
        mqttClient.publish('kontrol/relay2', 'OFF', { qos: 1 });
        mqttClient.publish('kontrol/relay3', 'OFF', { qos: 1 });
        mqttClient.publish('kontrol/relay4', 'OFF', { qos: 1 });
        mqttClient.publish('kontrol/variasi1', 'STOP', { qos: 1 });
        mqttClient.publish('kontrol/variasi2', 'STOP', { qos: 1 });
      }
      actionText = "Mematikan Semua Relay";
      speechResponse = "Baik, semua relay dan variasi telah dimatikan.";
      matchFound = true;
    } else if (query.includes('satu') || query.includes(' 1')) {
      relays.relay1 = false;
      if (mqttClient && mqttStatus === 'connected') mqttClient.publish('kontrol/relay1', 'OFF', { qos: 1 });
      actionText = "Mematikan Relay 1";
      speechResponse = "Siap, relay satu dimatikan.";
      matchFound = true;
    } else if (query.includes('dua') || query.includes(' 2')) {
      relays.relay2 = false;
      if (mqttClient && mqttStatus === 'connected') mqttClient.publish('kontrol/relay2', 'OFF', { qos: 1 });
      actionText = "Mematikan Relay 2";
      speechResponse = "Siap, relay dua dimatikan.";
      matchFound = true;
    } else if (query.includes('tiga') || query.includes(' 3')) {
      relays.relay3 = false;
      if (mqttClient && mqttStatus === 'connected') mqttClient.publish('kontrol/relay3', 'OFF', { qos: 1 });
      actionText = "Mematikan Relay 3";
      speechResponse = "Siap, relay tiga dimatikan.";
      matchFound = true;
    } else if (query.includes('empat') || query.includes(' 4')) {
      relays.relay4 = false;
      if (mqttClient && mqttStatus === 'connected') mqttClient.publish('kontrol/relay4', 'OFF', { qos: 1 });
      actionText = "Mematikan Relay 4";
      speechResponse = "Siap, relay empat dimatikan.";
      matchFound = true;
    }
  } else if (query.includes('variasi')) {
    if (query.includes('satu') || query.includes(' 1')) {
      if (query.includes('mulai') || query.includes('start') || query.includes('jalan') || query.includes('nyalakan')) {
        variations.variasi1 = true;
        variations.variasi2 = false;
        varStep = 0;
        if (mqttClient && mqttStatus === 'connected') mqttClient.publish('kontrol/variasi1', 'START', { qos: 1 });
        actionText = "Mulai Variasi 1";
        speechResponse = "Baik, variasi satu maju otomatis telah berjalan.";
        matchFound = true;
      } else if (query.includes('stop') || query.includes('henti') || query.includes('mati') || query.includes('matikan')) {
        variations.variasi1 = false;
        if (mqttClient && mqttStatus === 'connected') mqttClient.publish('kontrol/variasi1', 'STOP', { qos: 1 });
        actionText = "Hentikan Variasi 1";
        speechResponse = "Baik, variasi satu berhasil dihentikan.";
        matchFound = true;
      }
    } else if (query.includes('dua') || query.includes(' 2')) {
      if (query.includes('mulai') || query.includes('start') || query.includes('jalan') || query.includes('nyalakan')) {
        variations.variasi2 = true;
        variations.variasi1 = false;
        varStep = 0;
        if (mqttClient && mqttStatus === 'connected') mqttClient.publish('kontrol/variasi2', 'START', { qos: 1 });
        actionText = "Mulai Variasi 2";
        speechResponse = "Baik, variasi dua mundur otomatis telah berjalan.";
        matchFound = true;
      } else if (query.includes('stop') || query.includes('henti') || query.includes('mati') || query.includes('matikan')) {
        variations.variasi2 = false;
        if (mqttClient && mqttStatus === 'connected') mqttClient.publish('kontrol/variasi2', 'STOP', { qos: 1 });
        actionText = "Hentikan Variasi 2";
        speechResponse = "Baik, variasi dua berhasil dihentikan.";
        matchFound = true;
      }
    }
  } else if (query.includes('suhu') || query.includes('derajat') || query.includes('kelembaban') || query.includes('sensor') || query.includes('panas') || query.includes('dingin') || query.includes('cuaca') || query.includes('kondisi')) {
    actionText = "Pengecekan Sensor Lingkungan";
    speechResponse = `Saat ini suhu adalah ${sensors.suhu} derajat Celcius dengan tingkat kelembaban ${sensors.kelembaban} persen.`;
    matchFound = true;
  } else if (query.includes('broker') || query.includes('pindah') || query.includes('ganti')) {
    if (query.includes('satu') || query.includes(' 1') || query.includes('cloudamqp')) {
      connectToBroker(0);
      if (mqttClient && mqttStatus === 'connected') mqttClient.publish('kontrol/broker', '1', { qos: 1 });
      actionText = "Pindah ke Broker CloudAMQP";
      speechResponse = "Siap, beralih ke broker satu CloudAMQP sekarang.";
      matchFound = true;
    } else if (query.includes('dua') || query.includes(' 2') || query.includes('cedalo')) {
      connectToBroker(1);
      if (mqttClient && mqttStatus === 'connected') mqttClient.publish('kontrol/broker', '2', { qos: 1 });
      actionText = "Pindah ke Broker Cedalo";
      speechResponse = "Siap, beralih ke broker dua Cedalo sekarang.";
      matchFound = true;
    } else if (query.includes('tiga') || query.includes(' 3') || query.includes('flespi')) {
      connectToBroker(2);
      if (mqttClient && mqttStatus === 'connected') mqttClient.publish('kontrol/broker', '3', { qos: 1 });
      actionText = "Pindah ke Broker Flespi";
      speechResponse = "Siap, beralih ke broker tiga Flespi sekarang.";
      matchFound = true;
    }
  }

  // 2. BACKEND GEMINI SMART NLP COOPERATOR (Mencakup kalimat gaul, implisit, dan rumit)
  if (!matchFound) {
    const aiClient = getGemini();
    if (aiClient) {
      addLog('info', `Meneruskan perintah ke otak buatan Gemini AI...`);
      try {
        const response = await aiClient.models.generateContent({
          model: "gemini-3.5-flash",
          contents: `Anda adalah pemroses perintah IoT dalam Bahasa Indonesia cerdas untuk sistem ESP32.
          Sistem kami memiliki perangkat dan kondisi aktual berikut:
          - 4 Relay (relay1, relay2, relay3, relay4): masing-masing saat ini bernilai [relay1: ${relays.relay1}, relay2: ${relays.relay2}, relay3: ${relays.relay3}, relay4: ${relays.relay4}].
          - 2 Variasi Relay otomatis (variasi1, variasi2): masing-masing saat ini bernilai [variasi1: ${variations.variasi1}, variasi2: ${variations.variasi2}].
          - 3 MQTT Brokers (1: CloudAMQP, 2: Cedalo, 3: Flespi).
          - Suhu aktual: ${sensors.suhu}°C, Kelembaban aktual: ${sensors.kelembaban}%.
          
          Perintah Bebas Pengguna: "${text}"
          
          Analisislah maksud perintah tersebut, sesuaikan perubahan status yang tepat jika diinstruksikan, dan berikan respon dalam bentuk obyek JSON dengan schema persis berikut:
          {
            "action": "control", "status", "switch_broker", atau "unknown",
            "target": "relay1", "relay2", "relay3", "relay4", "variasi1", "variasi2", "broker", atau "none",
            "value": "ON", "OFF", "START", "STOP", "1", "2", "3", atau "none",
            "speechResponse": "Tanggapan suara bersahabat, merdu, sopan, dalam Bahasa Indonesia dan sebutkan tindakan yang dilakukan asisten pintar"
          }
          Penting: Balas HANYA obyek JSON solid tersebut secara langsung, tanpa format penulisan kode atau petik tiga (no markdown format).`
        });

        const rawText = response.text ? response.text.trim() : "";
        const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const result = JSON.parse(cleanJson);

        if (result.action === 'control') {
          const target = result.target;
          const val = result.value;
          
          if (target.startsWith('relay')) {
            const num = parseInt(target.replace('relay', ''));
            const k = target as keyof typeof relays;
            relays[k] = (val === 'ON');
            if (mqttClient && mqttStatus === 'connected') {
              mqttClient.publish(`kontrol/${target}`, val, { qos: 1 });
            }
            actionText = `AI Kontrol: ${target.toUpperCase()} diubah ke ${val}`;
          } else if (target.startsWith('variasi')) {
            const isV1 = (target === 'variasi1');
            if (isV1) {
              variations.variasi1 = (val === 'START');
              if (variations.variasi1) {
                variations.variasi2 = false;
                varStep = 0;
              }
            } else {
              variations.variasi2 = (val === 'START');
              if (variations.variasi2) {
                variations.variasi1 = false;
                varStep = 0;
              }
            }
            if (!variations.variasi1 && !variations.variasi2) {
              relays.relay1 = false; relays.relay2 = false; relays.relay3 = false; relays.relay4 = false;
            }
            if (mqttClient && mqttStatus === 'connected') {
              mqttClient.publish(`kontrol/${target}`, val, { qos: 1 });
            }
            actionText = `AI Kontrol: ${target.toUpperCase()} diubah ke ${val}`;
          }
          speechResponse = result.speechResponse;
          matchFound = true;
        } else if (result.action === 'status') {
          actionText = `AI Status Laporan`;
          speechResponse = result.speechResponse;
          matchFound = true;
        } else if (result.action === 'switch_broker' && result.value !== 'none') {
          const bIdx = parseInt(result.value) - 1;
          if (bIdx >= 0 && bIdx < brokerList.length) {
            connectToBroker(bIdx);
            if (mqttClient && mqttStatus === 'connected') {
              mqttClient.publish('kontrol/broker', result.value, { qos: 1 });
            }
            actionText = `AI Pindah Broker: ${brokerList[bIdx].nama}`;
          }
          speechResponse = result.speechResponse;
          matchFound = true;
        }
      } catch (err: any) {
        addLog('error', `AI processing failed: ${err.message}`);
      }
    }
  }

  // Fallback jika tidak teridentifikasi
  if (!matchFound) {
    actionText = "Tanggapan Gagal Dimengerti";
    speechResponse = "Maaf, saya tidak mengerti maksud kalimat Anda. Silakan coba perintah baku seperti: jalankan variasi satu, atau matikan relay tiga.";
  }

  addLog('info', `Hasil Perintah Suara: "${actionText}"`);
  broadcastState();

  res.json({
    success: true,
    action: actionText,
    response: speechResponse
  });
});

// ================= VITE MIDDLEWARE SETUP =================

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running beautifully at http://0.0.0.0:${PORT}`);
  });
}

startServer();
