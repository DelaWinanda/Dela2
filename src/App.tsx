import { useState, useEffect, useRef } from "react";
import { 
  Thermometer, 
  Droplets, 
  Power, 
  Sliders, 
  Radio, 
  Mic, 
  MicOff, 
  Volume2, 
  Terminal, 
  Activity, 
  Database, 
  RefreshCw, 
  BookOpen, 
  Cpu,
  Trash2,
  CheckCircle,
  HelpCircle,
  Play,
  Square,
  Sparkles,
  Wifi,
  ChevronRight
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { LogEntry } from "./types";

const BROKERS = [
  { id: 1, name: "CloudAMQP", url: "kingfisher.lmq.cloudamqp.com", detail: "TLS 8883" },
  { id: 2, name: "Cedalo", url: "pf-26xt4cmufmfw6kr1zpyq.cedalo.cloud", detail: "TLS 8883" },
  { id: 3, name: "Flespi", url: "mqtt.flespi.io", detail: "TLS 8883" }
];

export default function App() {
  // --- REAL-TIME STATES FROM SSE ---
  const [relays, setRelays] = useState({ relay1: false, relay2: false, relay3: false, relay4: false });
  const [variations, setVariations] = useState({ variasi1: false, variasi2: false });
  const [sensors, setSensors] = useState({ suhu: 28.0, kelembaban: 65.0, lastUpdate: new Date().toISOString() });
  const [activeBroker, setActiveBroker] = useState<number>(0);
  const [mqttStatus, setMqttStatus] = useState<'connected' | 'disconnected' | 'reconnecting' | 'error'>('disconnected');
  const [mqttError, setMqttError] = useState<string>("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [simulatorActive, setSimulatorActive] = useState<boolean>(false);

  // --- INTERACTION & UI STATES ---
  const [logFilter, setLogFilter] = useState<'all' | 'broker' | 'command' | 'sensor'>('all');
  const [logSearch, setLogSearch] = useState<string>("");
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'analyzing' | 'speaking'>('idle');
  const [lastCommand, setLastCommand] = useState<string>("");
  const [speechFeedback, setSpeechFeedback] = useState<string>("");
  const [showGuide, setShowGuide] = useState<boolean>(false);

  // --- SANDBOX/VERCEL AUTODETECT FALLBACK ---
  const [isSandboxMode, setIsSandboxMode] = useState<boolean>(false);
  const [isPollingMode, setIsPollingMode] = useState<boolean>(false);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Helper to add local client-side logs
  const addLocalLog = (message: string, type: 'info' | 'error' | 'command' | 'sensor' | 'broker' = 'info') => {
    const newLog: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      type,
      message
    };
    setLogs(prev => {
      if (prev.length > 0 && prev[prev.length - 1].message === message) return prev;
      return [...prev.slice(-40), newLog];
    });
  };

  // --- CONNECT TO BACKEND SERVER-SENT EVENTS WITH EXCELLENT RELIABILITY ---
  useEffect(() => {
    // 1. Immediately activate sandbox mode if we are deployed to Vercel (since Vercel doesn't run background threads or SSE)
    const host = window.location.hostname;
    const isVercelHost = host.includes('vercel.app') || host.includes('github.io');
    
    if (isVercelHost) {
      setIsSandboxMode(true);
      setMqttStatus('connected');
      addLocalLog("System initialized in Client Sandbox Mode (Vercel detected).", "info");
      addLocalLog("Connected to broker: CloudAMQP (TLS Emulator)", "broker");
      addLocalLog("SENSOR: Reading mock data... Success", "sensor");
      return;
    }

    // 2. Otherwise try connecting via SSE (standard Express container mode)
    let eventSource: EventSource | null = new EventSource('/api/events');
    let sseActive = false;
    
    // Set a timeout: if we don't get any SSE signal in 6 seconds, we fallback to HTTP Polling Mode, keeping it connected to the real server and physical ESP32!
    const fallbackTimer = setTimeout(() => {
      if (!sseActive) {
        setIsPollingMode(true);
        addLocalLog("SSE stream slow or buffered. Switching to HTTP Polling... (Still connected to real ESP32)", "info");
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
      }
    }, 6000);

    eventSource.onmessage = (event) => {
      clearTimeout(fallbackTimer);
      sseActive = true;
      setIsSandboxMode(false); // Valid real-time sever container is answering!
      setIsPollingMode(false);
      try {
        const data = JSON.parse(event.data);
        setRelays(data.relays);
        setVariations(data.variations);
        setSensors(data.sensors);
        setActiveBroker(data.activeBroker);
        setMqttStatus(data.mqttStatus);
        setMqttError(data.mqttError || "");
        setSimulatorActive(data.simulatorActive);
        if (data.logs) {
          setLogs(data.logs);
        }
      } catch (err) {
        console.error("Error parsing SSE data:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.warn("SSE Connection failed or broken. Switching to HTTP Polling to maintain real ESP32 connection...", err);
      clearTimeout(fallbackTimer);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      setIsPollingMode(true);
    };

    return () => {
      if (eventSource) {
        eventSource.close();
      }
      clearTimeout(fallbackTimer);
    };
  }, []);

  // --- HTTP STATUS POLLING (Activates when SSE is slow or blocked by container reverse-proxy) ---
  useEffect(() => {
    let intervalId: any = null;
    
    if (isPollingMode && !isSandboxMode) {
      const fetchStatus = async () => {
        try {
          const resp = await fetch('/api/status');
          if (resp.ok) {
            const data = await resp.json();
            setRelays(data.relays);
            setVariations(data.variations);
            setSensors(data.sensors);
            setActiveBroker(data.activeBroker);
            setMqttStatus(data.mqttStatus);
            setMqttError(data.mqttError || "");
            setSimulatorActive(data.simulatorActive);
            if (data.logs) {
              setLogs(data.logs);
            }
          }
        } catch (err) {
          console.warn("Polling status failed:", err);
        }
      };

      // Fetch immediately, then every 2.5s
      fetchStatus();
      intervalId = setInterval(fetchStatus, 2500);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isPollingMode, isSandboxMode]);

  // --- CLIENT-SIDE SENSOR SIMULATION (Active only in Sandbox mode) ---
  useEffect(() => {
    let intervalId: any = null;
    if (isSandboxMode) {
      // Simulate ticking sensors every 3 seconds
      intervalId = setInterval(() => {
        setSensors(prev => {
          const dSuhu = (Math.random() - 0.5) * 0.4;
          const dKelembaban = (Math.random() - 0.5) * 0.8;
          const nextSuhu = Math.max(22, Math.min(35, prev.suhu + dSuhu));
          const nextKelembaban = Math.max(45, Math.min(85, prev.kelembaban + dKelembaban));
          
          if (Math.random() < 0.2) {
            addLocalLog(`SENSOR: Temp ${nextSuhu.toFixed(1)}°C, Humidity ${nextKelembaban.toFixed(1)}%`, "sensor");
          }
          return {
            suhu: nextSuhu,
            kelembaban: nextKelembaban,
            lastUpdate: new Date().toISOString()
          };
        });
      }, 3000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isSandboxMode]);

  // --- AUTO SCROLL LOGGER ---
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // --- PUBLISH COMMAND API WITH FLUID FALLBACK TO COMPATIBLE CLIENT STATES ---
  const publishControl = async (topic: string, message: string) => {
    // If working in sandbox mode, immediately update local states to keep the app 100% interactive
    if (isSandboxMode) {
      if (topic.startsWith("kontrol/relay")) {
        const relayId = topic.replace("kontrol/", ""); // e.g. "relay1"
        const targetValue = message === "ON";
        setRelays(prev => ({ ...prev, [relayId]: targetValue }));
        
        const pin = relayId === "relay1" ? "Pin 23" : relayId === "relay2" ? "Pin 22" : relayId === "relay3" ? "Pin 21" : "Pin 19";
        addLocalLog(`RELAY: ${pin} -> ${targetValue ? 'LOW (Active)' : 'HIGH (Inaktif)'}`, "command");
      } else if (topic.startsWith("kontrol/variasi")) {
        const varId = topic.replace("kontrol/", ""); // e.g. "variasi1"
        const isStart = message === "START";
        setVariations(prev => ({ ...prev, [varId]: isStart }));
        addLocalLog(`CMD: ${varId.toUpperCase()} ${isStart ? 'START' : 'STOP'} triggered from client`, "command");
      } else if (topic === "kontrol/broker") {
        const brokerId = parseInt(message, 10);
        if (!isNaN(brokerId) && brokerId >= 1 && brokerId <= 3) {
          const bIndex = brokerId - 1;
          setActiveBroker(bIndex);
          addLocalLog(`BROKER: Switching command received (${brokerId})`, "broker");
          addLocalLog(`WIFI: Re-establishing secure connection to ${BROKERS[bIndex].name}...`, "broker");
          setTimeout(() => {
            addLocalLog(`Connected to broker: ${BROKERS[bIndex].name} (TLS Online)`, "broker");
          }, 800);
        }
      }
      return;
    }

    try {
      const response = await fetch('/api/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, message })
      });
      if (!response.ok) throw new Error("HTTP error " + response.status);
    } catch (err) {
      console.warn("Express server unreachable, switching to responsive local sandbox fallback...", err);
      setIsSandboxMode(true);
      // Run the control action instantly on sandbox fallback instead
      publishControl(topic, message);
    }
  };

  // --- TOGGLE SIMULATOR API ---
  const toggleSimulator = async () => {
    if (isSandboxMode) {
      setSimulatorActive(prev => !prev);
      addLocalLog(`CMD: Simulator ${!simulatorActive ? "Activated" : "Deactivated"} locally`, "info");
      return;
    }

    try {
      const resp = await fetch('/api/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !simulatorActive })
      });
      const data = await resp.json();
      setSimulatorActive(data.simulatorActive);
    } catch (err) {
      console.warn("Simulator toggle endpoint unavailable, doing local toggle.", err);
      setIsSandboxMode(true);
      setSimulatorActive(prev => !prev);
    }
  };

  // --- SYSTEM VOICE RECOGNITION (WEB SPEECH API) ---
  const startVoiceCommand = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      alert("Browser Anda tidak mendukung Web Speech API (Gunakan Chrome, Edge, atau Safari).");
      return;
    }

    try {
      setVoiceState('listening');
      setSpeechFeedback("Mendengarkan ucapan Anda...");
      setLastCommand("");

      const rec = new SpeechRecognition();
      rec.lang = 'id-ID'; // Set Bahasa Indonesia
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        console.log("Speech recognition started");
      };

      rec.onresult = async (evt: any) => {
        const text = evt.results[0][0].transcript;
        setLastCommand(text);
        setVoiceState('analyzing');
        setSpeechFeedback(`Memproses instruksi: "${text}"`);

        // If sandbox mode is operating, use client-side smart voice analyzer to guarantee instant response!
        if (isSandboxMode) {
          setTimeout(() => {
            const cleanText = text.toLowerCase();
            let speechResp = "";
            let recognized = false;

            if (cleanText.includes("nyalakan") || cleanText.includes("aktifkan") || cleanText.includes("on") || cleanText.includes("hidup")) {
              if (cleanText.includes("relay 1") || cleanText.includes("relay satu") || cleanText.includes("satu")) {
                setRelays(prev => ({ ...prev, relay1: true }));
                speechResp = "Baik bos, relay satu berhasil dinyalakan.";
                addLocalLog("CMD: Voice recognized 'Relay 1 ON'", "command");
                addLocalLog("RELAY: Pin 23 -> LOW (Active)", "command");
                recognized = true;
              } else if (cleanText.includes("relay 2") || cleanText.includes("relay dua") || cleanText.includes("dua")) {
                setRelays(prev => ({ ...prev, relay2: true }));
                speechResp = "Siap, asisten pintar menyalakan relay dua sekarang.";
                addLocalLog("CMD: Voice recognized 'Relay 2 ON'", "command");
                addLocalLog("RELAY: Pin 22 -> LOW (Active)", "command");
                recognized = true;
              } else if (cleanText.includes("relay 3") || cleanText.includes("relay tiga") || cleanText.includes("tiga")) {
                setRelays(prev => ({ ...prev, relay3: true }));
                speechResp = "Dimengerti, sakelar relay tiga sudah diaktifkan.";
                addLocalLog("CMD: Voice recognized 'Relay 3 ON'", "command");
                addLocalLog("RELAY: Pin 21 -> LOW (Active)", "command");
                recognized = true;
              } else if (cleanText.includes("relay 4") || cleanText.includes("relay empat") || cleanText.includes("empat")) {
                setRelays(prev => ({ ...prev, relay4: true }));
                speechResp = "Baik pemilik, relay empat dalam kondisi aktif.";
                addLocalLog("CMD: Voice recognized 'Relay 4 ON'", "command");
                addLocalLog("RELAY: Pin 19 -> LOW (Active)", "command");
                recognized = true;
              } else if (cleanText.includes("semua") || cleanText.includes("semua lampu") || cleanText.includes("semua relay")) {
                setRelays({ relay1: true, relay2: true, relay3: true, relay4: true });
                speechResp = "Perintah diterima, seluruh modul relay berhasil dinyalakan.";
                addLocalLog("CMD: Voice recognized 'Nyalakan semua relay'", "command");
                recognized = true;
              } else if (cleanText.includes("variasi 1") || cleanText.includes("variasi satu") || cleanText.includes("forward")) {
                setVariations(prev => ({ ...prev, variasi1: true }));
                speechResp = "Siap, siklus variasi satu forward berhasil dimulai.";
                addLocalLog("CMD: Voice recognized 'Variasi 1 START'", "command");
                recognized = true;
              } else if (cleanText.includes("variasi 2") || cleanText.includes("variasi dua") || cleanText.includes("backward")) {
                setVariations(prev => ({ ...prev, variasi2: true }));
                speechResp = "Siap, siklus variasi dua backward telah berputar.";
                addLocalLog("CMD: Voice recognized 'Variasi 2 START'", "command");
                recognized = true;
              }
            } else if (cleanText.includes("matikan") || cleanText.includes("nonaktifkan") || cleanText.includes("off") || cleanText.includes("stop") || cleanText.includes("padam")) {
              if (cleanText.includes("relay 1") || cleanText.includes("relay satu") || cleanText.includes("satu")) {
                setRelays(prev => ({ ...prev, relay1: false }));
                speechResp = "Baik bos, sakelar relay satu sudah dimatikan.";
                addLocalLog("CMD: Voice recognized 'Relay 1 OFF'", "command");
                addLocalLog("RELAY: Pin 23 -> HIGH (Inaktif)", "command");
                recognized = true;
              } else if (cleanText.includes("relay 2") || cleanText.includes("relay dua") || cleanText.includes("dua")) {
                setRelays(prev => ({ ...prev, relay2: false }));
                speechResp = "Selesai, relay dua berhasil di-nonaktifkan.";
                addLocalLog("CMD: Voice recognized 'Relay 2 OFF'", "command");
                addLocalLog("RELAY: Pin 22 -> HIGH (Inaktif)", "command");
                recognized = true;
              } else if (cleanText.includes("relay 3") || cleanText.includes("relay tiga") || cleanText.includes("tiga")) {
                setRelays(prev => ({ ...prev, relay3: false }));
                speechResp = "Bagus, sakelar untuk relay tiga sekarang mati.";
                addLocalLog("CMD: Voice recognized 'Relay 3 OFF'", "command");
                addLocalLog("RELAY: Pin 21 -> HIGH (Inaktif)", "command");
                recognized = true;
              } else if (cleanText.includes("relay 4") || cleanText.includes("relay empat") || cleanText.includes("empat")) {
                setRelays(prev => ({ ...prev, relay4: false }));
                speechResp = "Dimengerti, mematikan saluran relay empat.";
                addLocalLog("CMD: Voice recognized 'Relay 4 OFF'", "command");
                addLocalLog("RELAY: Pin 19 -> HIGH (Inaktif)", "command");
                recognized = true;
              } else if (cleanText.includes("semua") || cleanText.includes("semua lampu") || cleanText.includes("semua relay")) {
                setRelays({ relay1: false, relay2: false, relay3: false, relay4: false });
                setVariations({ variasi1: false, variasi2: false });
                speechResp = "Baik bos, seluruh relay beserta pola variasi dihentikan secara total.";
                addLocalLog("CMD: Voice recognized 'Matikan semua relay'", "command");
                recognized = true;
              } else if (cleanText.includes("variasi 1") || cleanText.includes("variasi satu")) {
                setVariations(prev => ({ ...prev, variasi1: false }));
                speechResp = "Siklus pola variasi satu forward resmi dihentikan.";
                addLocalLog("CMD: Voice recognized 'Variasi 1 STOP'", "command");
                recognized = true;
              } else if (cleanText.includes("variasi 2") || cleanText.includes("variasi dua")) {
                setVariations(prev => ({ ...prev, variasi2: false }));
                speechResp = "Siklus pola variasi dua backward resmi dihentikan.";
                addLocalLog("CMD: Voice recognized 'Variasi 2 STOP'", "command");
                recognized = true;
              }
            } else if (cleanText.includes("suhu") || cleanText.includes("panas") || cleanText.includes("kelembaban") || cleanText.includes("kehangatan") || cleanText.includes("temprature") || cleanText.includes("kondisi")) {
              speechResp = `Klimatologi ruangan saat ini terukur pada suhu ${sensors.suhu.toFixed(1)} derajat Celcius dan kelembaban udara mencapai ${sensors.kelembaban.toFixed(1)} persen.`;
              addLocalLog("CMD: Voice recognized 'Sebutkan kondisi suhu saat ini'", "command");
              recognized = true;
            } else if (cleanText.includes("pindah") || cleanText.includes("broker") || cleanText.includes("server")) {
              if (cleanText.includes("cloudamqp") || cleanText.includes("satu") || cleanText.includes("1")) {
                setActiveBroker(0);
                speechResp = "Baik pimpinan, koneksi dialihkan ke broker CloudAMQP.";
                addLocalLog("CMD: Voice recognized 'Pindah ke broker CloudAMQP'", "command");
                recognized = true;
              } else if (cleanText.includes("cedalo") || cleanText.includes("dua") || cleanText.includes("2")) {
                setActiveBroker(1);
                speechResp = "Mengerti, broker dialihkan ke server Cedalo Cloud.";
                addLocalLog("CMD: Voice recognized 'Pindah ke broker Cedalo'", "command");
                recognized = true;
              } else if (cleanText.includes("flespi") || cleanText.includes("tiga") || cleanText.includes("3")) {
                setActiveBroker(2);
                speechResp = "Siap pemilik, memindahkan server broker ke Flespi io.";
                addLocalLog("CMD: Voice recognized 'Pindah ke broker Flespi'", "command");
                recognized = true;
              }
            }

            if (!recognized) {
              speechResp = `Saya mendengar "${text}". Kalimat tersebut belum dicocokkan dengan perintah sakelar lokal. Cobalah katakan: nyalakan relay dua, atau tanyakan kondisi suhu ruangan.`;
              addLocalLog(`VOICE: Perintah tidak dikenali: "${text}"`, "error");
            }

            setSpeechFeedback(speechResp);
            setVoiceState('speaking');
            speakText(speechResp);
          }, 1000);
          return;
        }

        // Kirim hasil text ke server untuk diproses AI / NLP (Default Mode)
        try {
          const res = await fetch('/api/voice-command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
          });
          const data = await res.json();
          if (data.success) {
            setSpeechFeedback(data.response);
            setVoiceState('speaking');
            speakText(data.response);
          } else {
            setSpeechFeedback("Maaf, gagal memproses perintah suara.");
            setVoiceState('idle');
          }
        } catch (err) {
          console.warn("Express NLP server unreachable, evaluating locally...", err);
          setIsSandboxMode(true);
        }
      };

      rec.onerror = (e: any) => {
        console.error("Speech Recognition Error:", e);
        if (e.error === 'not-allowed') {
          setSpeechFeedback("Akses mikrofon diblokir. Harap berikan izin.");
        } else {
          setSpeechFeedback(`Gagal mendengar: ${e.error || 'Silakan ulangi.'}`);
        }
        setVoiceState('idle');
      };

      rec.onend = () => {
        // Recognition stops autonomously
      };

      rec.start();
    } catch (e: any) {
      console.error("Failed to initialize speech recognition:", e);
      setSpeechFeedback("Gagal meluncurkan asisten suara.");
      setVoiceState('idle');
    }
  };

  // --- TEXT TO SPEECH OUT UTTERANCE ---
  const speakText = (text: string) => {
    if (!window.speechSynthesis) return;

    window.speechSynthesis.cancel(); // Reset
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'id-ID';
    utterance.rate = 1.0;
    utterance.pitch = 1.05;

    utterance.onend = () => {
      setVoiceState('idle');
    };

    utterance.onerror = (err) => {
      console.error("TTS Error:", err);
      setVoiceState('idle');
    };

    window.speechSynthesis.speak(utterance);
  };

  const getStatusText = () => {
    switch (mqttStatus) {
      case 'connected': return `MQTT: ${BROKERS[activeBroker]?.name.toUpperCase()} (TLS 8883)`;
      case 'reconnecting': return 'MQTT: MENGHUBUNGKAN...';
      case 'error': return 'MQTT: KONEKSI ERROR';
      default: return 'MQTT: TERPUTUS';
    }
  };

  const filteredLogs = logs.filter(log => {
    const matchesFilter = logFilter === 'all' || log.type === logFilter;
    const matchesSearch = log.message.toLowerCase().includes(logSearch.toLowerCase()) || 
                          log.type.toLowerCase().includes(logSearch.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col justify-between selection:bg-indigo-600 selection:text-white">
      
      {/* ================= TOP HEADER NAVIGATION ================= */}
      <header className="h-20 bg-white border-b border-slate-200 px-8 flex items-center justify-between shrink-0 sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-xs">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">ESP32 IoT Hub</h1>
            <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold">Multi-Broker Control System</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition ${
            mqttStatus === 'connected' 
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
              : 'bg-rose-50 text-rose-700 border-rose-200'
          }`}>
            <span className={`w-2 h-2 rounded-full ${mqttStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500 animate-ping'}`} />
            {getStatusText()}
          </div>
          
          <button
            onClick={toggleSimulator}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition hidden md:flex items-center gap-1.5 cursor-pointer ${
              simulatorActive 
                ? 'bg-amber-100/60 border-amber-300 text-amber-800' 
                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Simulasi {simulatorActive ? "Aktif" : "Nonaktif"}</span>
          </button>
        </div>
      </header>

      {/* ================= MAIN GRID LAYOUT ================= */}
      <main className="flex-1 p-6 lg:p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6 lg:gap-8 max-w-7xl w-full mx-auto">
        
        {/* WARNING SIMULATION BANNER */}
        {simulatorActive && (
          <div className="col-span-12 bg-amber-50 border border-amber-200 p-4 rounded-xl flex flex-wrap items-center justify-between gap-2 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
              <div>
                <p className="text-xs font-bold text-amber-850">Sistem Berjalan dalam Mode Simulasi Virtual</p>
                <p className="text-[11px] text-amber-600 font-medium">Bagus untuk uji coba jika perangkat ESP32 fisik Anda sedang offline.</p>
              </div>
            </div>
            <button 
              onClick={toggleSimulator}
              className="text-[10px] font-bold bg-amber-200/50 hover:bg-amber-200 text-amber-900 border border-amber-300/40 px-3 py-1 rounded-md transition cursor-pointer"
            >
              Kembali ke Fisik
            </button>
          </div>
        )}

        {/* SERVERLESS FALLBACK WARNING BANNER */}
        {isSandboxMode && (
          <div className="col-span-12 bg-indigo-50/80 border border-indigo-200/70 p-4 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-indigo-650 flex items-center justify-center text-white shrink-0 font-extrabold text-[11px] select-none animate-pulse">i</div>
              <div>
                <p className="text-xs font-bold text-indigo-900">⚡ Client Sandbox Mode Aktif Otomatis</p>
                <p className="text-[11px] text-indigo-650 leading-relaxed font-semibold">
                  Terdeteksi dijalankan di hosting Serverless (seperti <span className="font-mono bg-indigo-100/85 px-1 rounded text-indigo-800">dela2.vercel.app</span>) yang membatasi jalannya background task/SSE MQTT server Node.js. 
                  Sistem otomatis mengaktifkan <strong>Simulator Sandbox Mandiri</strong> sehingga semua fitur (sakelar relay, asisten suara offline, sensor aktif, log riwayat) tetap aktif dan responsif langsung di peramban Anda!
                </p>
              </div>
            </div>
            <a 
              href="https://ai.studio/build" 
              target="_blank" 
              rel="noreferrer"
              className="text-[10px] font-bold bg-indigo-600 hover:bg-indigo-750 text-white text-center py-2 px-3.5 rounded-lg transition shrink-0 self-start md:self-auto select-none"
            >
              Uji Coba di AI Studio Container ↗
            </a>
          </div>
        )}

        {/* ================= LEFT: SENSORS & VOICE COMMAND (COL-4) ================= */}
        <div className="lg:col-span-4 flex flex-col gap-6 lg:gap-8">
          
          {/* Card: Environmental Data */}
          <div className="bg-white p-6 rounded-2xl shadow-xs border border-slate-200">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6">Environmental Data</h2>
            <div className="grid grid-cols-2 gap-6">
              
              {/* Temperature */}
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-slate-400 mb-1 flex items-center gap-1">
                  <Thermometer className="w-3.5 h-3.5 text-orange-500" />
                  Suhu
                </span>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-light text-slate-800">
                    {sensors.suhu !== undefined ? sensors.suhu.toFixed(1) : "--"}
                  </span>
                  <span className="text-sm font-bold text-slate-400">°C</span>
                </div>
                <span className="text-[9px] text-slate-400 font-mono mt-1">sensor/suhu</span>
              </div>
              
              {/* Humidity */}
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-slate-400 mb-1 flex items-center gap-1">
                  <Droplets className="w-3.5 h-3.5 text-sky-500" />
                  Kelembaban
                </span>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-light text-slate-800">
                    {sensors.kelembaban !== undefined ? sensors.kelembaban.toFixed(1) : "--"}
                  </span>
                  <span className="text-sm font-bold text-slate-400">%</span>
                </div>
                <span className="text-[9px] text-slate-400 font-mono mt-1">sensor/kelembaban</span>
              </div>

            </div>
          </div>

          {/* Card: Voice Command (Sleek deep indigo theme as requested) */}
          <div className="bg-indigo-600 p-6 rounded-2xl shadow-lg shadow-indigo-100 text-white flex flex-col justify-between flex-1 min-h-[300px]">
            <div>
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-xs font-black text-indigo-200 uppercase tracking-widest">Voice Command</h2>
                  <p className="text-[11px] text-indigo-100 opacity-80 mt-1 leading-relaxed">Ketuk asisten mik dan katakan perintah suara IoT Anda.</p>
                </div>
                
                <button
                  onClick={startVoiceCommand}
                  disabled={voiceState === 'listening' || voiceState === 'analyzing'}
                  className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition duration-300 cursor-pointer ${
                    voiceState === 'listening' 
                      ? 'bg-red-500 border-red-300 animate-pulse' 
                      : voiceState === 'analyzing'
                      ? 'bg-amber-500 border-amber-300 animate-spin'
                      : 'bg-indigo-500 border-indigo-400 hover:bg-indigo-400'
                  }`}
                >
                  <Mic className="w-5 h-5 text-white" />
                </button>
              </div>

              {/* Real command or helper display */}
              <div className="mt-6">
                <p className="text-lg font-medium leading-snug">
                  {lastCommand ? `"${lastCommand}"` : '"Sebutkan kondisi suhu saat ini"'}
                </p>
                <p className="text-xs text-indigo-200 mt-2 font-mono flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${voiceState === 'listening' ? 'bg-red-300' : 'bg-indigo-300'}`} />
                  {voiceState === 'idle' && 'Siap mendengarkan...'}
                  {voiceState === 'listening' && 'Mendengarkan aktif...'}
                  {voiceState === 'analyzing' && 'Mengurai kecerdasan buatan...'}
                  {voiceState === 'speaking' && 'Menjawab perintah...'}
                </p>
              </div>

              {/* Response output */}
              {(speechFeedback || lastCommand) && (
                <div className="mt-4 p-3 bg-indigo-700/60 rounded-xl border border-indigo-500/30 text-xs">
                  <p className="font-semibold text-indigo-200 select-none">Tanggapan:</p>
                  <p className="text-white mt-0.5 leading-relaxed">{speechFeedback || "Mencerna kalimat..."}</p>
                </div>
              )}
            </div>

            {/* Quick Tips Guide Block */}
            <div className="mt-6 border-t border-indigo-500/40 pt-4">
              <button 
                onClick={() => setShowGuide(!showGuide)}
                className="text-[11px] font-bold text-indigo-200 hover:text-white flex items-center justify-between w-full cursor-pointer"
              >
                <span>{showGuide ? "Sembunyikan" : "Tampilkan"} Bantuan Kalimat</span>
                <HelpCircle className="w-3.5 h-3.5" />
              </button>

              <AnimatePresence>
                {showGuide && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden text-[10px] text-indigo-150 space-y-1 mt-2.5 bg-indigo-700/30 p-2.5 rounded-lg border border-indigo-500/20"
                  >
                    <p>• "Nyalakan relay dua"</p>
                    <p>• "Matikan semua relay"</p>
                    <p>• "Berapa tingkat kehangatan suhu sekarang?"</p>
                    <p>• "Aktifkan putaran variasi satu"</p>
                    <p>• "Pindah ke broker Flespi"</p>
                    <p className="text-indigo-200 pt-1 font-semibold">Gemini AI memproses kalimat tidak terstruktur dengan cerdas!</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

        </div>

        {/* ================= CENTER: CONTROLS (COL-4) ================= */}
        <div className="lg:col-span-4 flex flex-col gap-6 lg:gap-8">
          
          <div className="bg-white p-6 rounded-2xl shadow-xs border border-slate-200 flex-1 flex flex-col justify-between">
            <div>
              <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6">Hardware Controls</h2>
              
              {/* Relays grid */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                {[
                  { id: "relay1", label: "RELAY 1", topic: "kontrol/relay1" },
                  { id: "relay2", label: "RELAY 2", topic: "kontrol/relay2" },
                  { id: "relay3", label: "RELAY 3", topic: "kontrol/relay3" },
                  { id: "relay4", label: "RELAY 4", topic: "kontrol/relay4" }
                ].map((relayOpt) => {
                  const isActive = (relays as any)[relayOpt.id];
                  return (
                    <div 
                      key={relayOpt.id} 
                      className="p-4 rounded-xl border border-slate-150 bg-slate-50 flex flex-col justify-between h-28 hover:shadow-2xs transition"
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-500">{relayOpt.label}</span>
                        <span className={`w-3 h-3 rounded-full transition-all duration-300 ${isActive ? 'bg-emerald-500 shadow-xs' : 'bg-slate-300'}`} />
                      </div>
                      <button 
                        onClick={() => publishControl(relayOpt.topic, isActive ? "OFF" : "ON")}
                        className={`w-full py-2 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
                          isActive 
                            ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs' 
                            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {isActive ? 'SWITCH OFF' : 'SWITCH ON'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Sequence Automations */}
            <div>
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Sequence Variations</h3>
              <div className="flex flex-col gap-3">
                
                {/* Variation 1 button */}
                <button 
                  onClick={() => publishControl("kontrol/variasi1", variations.variasi1 ? "STOP" : "START")}
                  className={`w-full p-4 flex items-center justify-between rounded-xl transition cursor-pointer text-left ${
                    variations.variasi1 
                      ? 'bg-slate-900 border border-slate-900 text-white' 
                      : 'border border-slate-200 text-slate-650 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-xs font-medium uppercase">Variation 1 (Forward)</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    variations.variasi1 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'
                  }`}>
                    {variations.variasi1 ? 'RUNNING' : 'START'}
                  </span>
                </button>

                {/* Variation 2 button */}
                <button 
                  onClick={() => publishControl("kontrol/variasi2", variations.variasi2 ? "STOP" : "START")}
                  className={`w-full p-4 flex items-center justify-between rounded-xl transition cursor-pointer text-left ${
                    variations.variasi2 
                      ? 'bg-slate-900 border border-slate-900 text-white' 
                      : 'border border-slate-200 text-slate-650 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-xs font-medium uppercase">Variation 2 (Backward)</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    variations.variasi2 ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-400'
                  }`}>
                    {variations.variasi2 ? 'RUNNING' : 'START'}
                  </span>
                </button>

              </div>
            </div>
          </div>

        </div>

        {/* ================= RIGHT: BROKER & ACTIVITY LOG (COL-4) ================= */}
        <div className="lg:col-span-4 flex flex-col gap-6 lg:gap-8">
          
          {/* Card: Broker Management */}
          <div className="bg-white p-6 rounded-2xl shadow-xs border border-slate-200 flex flex-col justify-between">
            <div>
              <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Broker Management</h2>
              
              <div className="space-y-2">
                {BROKERS.map((b) => {
                  const isCurrent = activeBroker === (b.id - 1);
                  return (
                    <button
                      key={b.id}
                      onClick={() => publishControl("kontrol/broker", b.id.toString())}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition cursor-pointer ${
                        isCurrent 
                          ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-medium' 
                          : 'border-slate-100 hover:border-slate-200 text-slate-500'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Database className={`w-3.5 h-3.5 ${isCurrent ? 'text-indigo-600' : 'text-slate-450'}`} />
                        <span className="text-xs font-bold">{b.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-mono opacity-80">{b.detail}</span>
                        {isCurrent && (
                          <span className="text-[9px] bg-indigo-600 text-white font-bold px-1.5 py-0.5 rounded">ACTIVE</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 pt-3.5 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[10px] font-mono text-slate-400">Total Server: {BROKERS.length}</span>
              <span className="text-[10px] text-slate-400 hover:text-slate-650 font-semibold flex items-center gap-1 cursor-pointer">
                Automatic TLS config
              </span>
            </div>
          </div>

          {/* Card: Activity Log / Telemetry (Deep clean terminal background) */}
          <div className="bg-slate-900 p-6 rounded-2xl shadow-sm flex flex-col justify-between h-[360px]">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">Activity Log</h2>
                <span className="text-[10px] text-slate-500 font-mono">v1.0.4-stable</span>
              </div>

              {/* Log filter tags */}
              <div className="flex flex-wrap gap-1 mb-3.5">
                {[
                  { id: 'all', label: 'ALL' },
                  { id: 'broker', label: 'BK' },
                  { id: 'command', label: 'CMD' },
                  { id: 'sensor', label: 'SNS' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setLogFilter(tab.id as any)}
                    className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-sm transition cursor-pointer select-none border ${
                      logFilter === tab.id 
                        ? 'bg-white border-white text-slate-900' 
                        : 'bg-slate-800 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Terminal logs list */}
            <div 
              ref={logsContainerRef}
              className="flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed pr-1 space-y-1 scrollbar-thin scrollbar-thumb-slate-800"
            >
              {filteredLogs.length === 0 ? (
                <div className="text-slate-500 py-6 text-center italic">
                  Belum ada log aktivitas terdeteksi.
                </div>
              ) : (
                filteredLogs.map(log => {
                  let colorClass = "text-slate-300";
                  if (log.type === 'error') colorClass = "text-rose-450";
                  else if (log.type === 'broker') colorClass = "text-indigo-400";
                  else if (log.type === 'command') colorClass = "text-emerald-400";
                  else if (log.type === 'sensor') colorClass = "text-amber-400";

                  return (
                    <div key={log.id} className="text-slate-450 leading-relaxed font-mono shrink-0">
                      <span className="opacity-45 select-none mr-1.5">
                        [{new Date(log.timestamp).toLocaleTimeString()}]
                      </span>
                      <span className={colorClass}>{log.message}</span>
                    </div>
                  );
                })
              )}
              <div ref={logsEndRef} />
            </div>

            <div className="flex items-center justify-between border-t border-slate-850 pt-3 mt-3 shrink-0">
              <span className="text-[10px] text-slate-500 font-mono">Real-time sync callback</span>
              <button
                onClick={() => setLogs([])}
                className="text-[10px] text-slate-500 hover:text-rose-400 font-bold transition flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            </div>
          </div>

        </div>

      </main>

      {/* ================= BOTTOM STATUS BAR ================= */}
      <footer className="h-12 bg-white border-t border-slate-200 px-8 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse"></span>
            System Ready
          </span>
          <span className="w-px h-3 bg-slate-200"></span>
          <span>Baudrate: 115200</span>
        </div>
        <div className="flex items-center gap-4 text-[11px] font-bold uppercase tracking-widest text-slate-400">
          ESP32-DEV-KIT-V1
        </div>
      </footer>

    </div>
  );
}
