import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Recordings storage directory
const RECORDINGS_DIR = path.join(process.cwd(), 'recordings');
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

// Config file path
const CONFIG_FILE = path.join(process.cwd(), 'config.json');

// Default initial config
const DEFAULT_CONFIG = {
  source: 'microphone',
  device_id: 'default-mic',
  sample_rate: 16000,
  trigger_mode: 'db_vad',
  threshold_dbfs: -38,
  vad_threshold: 0.6,
  preroll_seconds: 1.0,
  silence_seconds: 2.0,
  auto_trim_silence: true,
  trim_margin_seconds: 0.2,
  frequency_hz: 145000000,
  modulation: 'NFM',
  station_id: 'ST001',
  fifo_path: '/tmp/hackrf_audio.f32',
};

// Initialize config if not existing
if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
}

// Multer upload config for recordings
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, RECORDINGS_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

// Active state
let isMonitoring = false;
let monitorInterval: NodeJS.Timeout | null = null;
const wsClients = new Set<WebSocket>();

// API Routes
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    engine: 'active',
    monitoring: isMonitoring,
    timestamp: new Date().toISOString(),
    recordings_dir: RECORDINGS_DIR,
  });
});

app.get('/api/audio/devices', (req, res) => {
  // Return standard Linux soundcard / ALSA / Pulse / SDR devices
  const devices = [
    {
      id: 'default-mic',
      name: 'Default System Microphone (hw:0,0)',
      max_input_channels: 1,
      default_samplerate: 16000,
      is_default: true,
      type: 'microphone',
    },
    {
      id: 'usb-soundcard',
      name: 'USB Audio Device Line-In (hw:1,0)',
      max_input_channels: 2,
      default_samplerate: 16000,
      is_default: false,
      type: 'usb',
    },
    {
      id: 'gnuradio-fifo',
      name: 'GNU Radio FIFO (/tmp/hackrf_audio.f32)',
      max_input_channels: 1,
      default_samplerate: 16000,
      is_default: false,
      type: 'other',
    },
  ];
  res.json(devices);
});

app.get('/api/settings', (req, res) => {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      return res.json(data);
    }
  } catch (err) {
    console.error('Error reading config.json:', err);
  }
  res.json(DEFAULT_CONFIG);
});

app.put('/api/settings', (req, res) => {
  try {
    const updated = { ...DEFAULT_CONFIG, ...req.body };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2));
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

app.post('/api/monitor/start', (req, res) => {
  isMonitoring = true;
  res.json({ success: true, message: 'Monitoring started' });
});

app.post('/api/monitor/stop', (req, res) => {
  isMonitoring = false;
  res.json({ success: true, message: 'Monitoring stopped' });
});

app.post('/api/calibrate', async (req, res) => {
  // Simulate 5s calibration or return computed value
  res.json({
    noise_floor_dbfs: -57.4,
    recommended_threshold_dbfs: -43.0,
    margin_db: 14.4,
    sample_count: 50,
  });
});

app.get('/api/recordings', (req, res) => {
  try {
    const files = fs.readdirSync(RECORDINGS_DIR);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    const list: unknown[] = [];

    for (const jf of jsonFiles) {
      try {
        const fullPath = path.join(RECORDINGS_DIR, jf);
        const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
        const wavName = jf.replace('.json', '.wav');
        const wavPath = path.join(RECORDINGS_DIR, wavName);
        if (fs.existsSync(wavPath)) {
          const stats = fs.statSync(wavPath);
          data.file_size_bytes = stats.size;
        }
        data.audio_url = `/api/recordings/${data.recording_id}/audio`;
        list.push(data);
      } catch {
        // ignore corrupted json
      }
    }

    // Sort newest first
    list.sort((a: any, b: any) => (b.recording_id > a.recording_id ? 1 : -1));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read recordings directory' });
  }
});

app.get('/api/recordings/:id', (req, res) => {
  const jsonPath = path.join(RECORDINGS_DIR, `${req.params.id}.json`);
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      data.audio_url = `/api/recordings/${req.params.id}/audio`;
      return res.json(data);
    } catch {
      return res.status(500).json({ error: 'Corrupted metadata' });
    }
  }
  res.status(404).json({ error: 'Recording not found' });
});

app.get('/api/recordings/:id/audio', (req, res) => {
  const wavPath = path.join(RECORDINGS_DIR, `${req.params.id}.wav`);
  if (fs.existsSync(wavPath)) {
    res.setHeader('Content-Type', 'audio/wav');
    return fs.createReadStream(wavPath).pipe(res);
  }
  res.status(404).json({ error: 'Audio file not found' });
});

app.get('/api/recordings/:id/json', (req, res) => {
  const jsonPath = path.join(RECORDINGS_DIR, `${req.params.id}.json`);
  if (fs.existsSync(jsonPath)) {
    res.setHeader('Content-Type', 'application/json');
    return fs.createReadStream(jsonPath).pipe(res);
  }
  res.status(404).json({ error: 'JSON metadata file not found' });
});

app.delete('/api/recordings/:id', (req, res) => {
  const id = req.params.id;
  const wavPath = path.join(RECORDINGS_DIR, `${id}.wav`);
  const jsonPath = path.join(RECORDINGS_DIR, `${id}.json`);

  let deleted = false;
  if (fs.existsSync(wavPath)) {
    fs.unlinkSync(wavPath);
    deleted = true;
  }
  if (fs.existsSync(jsonPath)) {
    fs.unlinkSync(jsonPath);
    deleted = true;
  }

  if (deleted) {
    return res.json({ success: true, message: `Recording ${id} deleted` });
  }
  res.status(404).json({ error: 'Recording not found' });
});

app.post('/api/recordings/upload', upload.single('audio'), (req, res) => {
  try {
    if (req.body.meta) {
      const meta = JSON.parse(req.body.meta);
      const jsonPath = path.join(RECORDINGS_DIR, meta.filename_json || `${meta.recording_id}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2));
      meta.audio_url = `/api/recordings/${meta.recording_id}/audio`;
      return res.json(meta);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to store recording files' });
  }
});

// Setup server and WebSocket
async function start() {
  const server = http.createServer(app);

  const wss = new WebSocketServer({ server, path: '/ws/monitor' });

  wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.on('close', () => {
      wsClients.delete(ws);
    });
    ws.send(
      JSON.stringify({
        level_dbfs: -90,
        speech_probability: 0,
        voice_detected: false,
        recording: false,
        status: isMonitoring ? 'listening' : 'idle',
      })
    );
  });

  // Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Auto Voice Recorder server running on http://0.0.0.0:${PORT}`);
  });
}

start();
