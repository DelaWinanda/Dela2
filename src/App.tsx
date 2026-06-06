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

  const logsEndRef = useRef<HTMLDivElement>(null);

  // --- CONNECT TO BACKEND SERVER-SENT EVENTS ---
  useEffect(() => {
    const eventSource = new EventSource('/api/events');
    
    eventSource.onmessage = (event) => {
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
      console.error("SSE Connection broken. Retrying in background...", err);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // --- AUTO SCROLL LOGGER ---
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // --- PUBLISH COMMAND API ---
  const publishControl = async (topic: string, message: string) => {
    try {
      await fetch('/api/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, message })
      });
    } catch (err) {
      console.error("Failed to publish control:", err);
    }
  };

  // --- TOGGLE SIMULATOR API ---
  const toggleSimulator = async () => {
    try {
      const resp = await fetch('/api/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !simulatorActive })
      });
      const data = await resp.json();
      setSimulatorActive(data.simulatorActive);
    } catch (err) {
      console.error("Failed to toggle simulator:", err);
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

        // Kirim hasil text ke server untuk diproses AI / NLP
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
          setSpeechFeedback("Kesalahan jaringan saat menganalisis perintah.");
          setVoiceState('idle');
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
            <div className="flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed pr-1 space-y-1 scrollbar-thin scrollbar-thumb-slate-800">
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
