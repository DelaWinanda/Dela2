export interface RelayStatus {
  relay1: boolean;
  relay2: boolean;
  relay3: boolean;
  relay4: boolean;
}

export interface VariationStatus {
  variasi1: boolean;
  variasi2: boolean;
}

export interface SensorData {
  suhu: number;
  kelembaban: number;
  lastUpdate: string;
}

export interface BrokerInfo {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  clientId: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'error' | 'command' | 'sensor' | 'broker';
  message: string;
}

export interface DashboardState {
  relays: RelayStatus;
  variations: VariationStatus;
  sensors: SensorData;
  activeBroker: number;
  mqttStatus: 'connected' | 'disconnected' | 'reconnecting' | 'error';
  mqttError?: string;
  logs: LogEntry[];
  simulatorActive: boolean;
}
