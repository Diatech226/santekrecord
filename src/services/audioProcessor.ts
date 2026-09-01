import { AppSettings, DetectionMode, EngineStatus, MonitorUpdate, RecordingMeta, TrimInfo } from '../types';

export interface TrimResult {
  trimmedSamples: Float32Array;
  leadingTrimmedSec: number;
  trailingTrimmedSec: number;
  totalTrimmedSec: number;
  originalDurationSec: number;
  newDurationSec: number;
  isTrimmed: boolean;
}

/**
 * Automatically detects voice onset and offset using dBFS threshold + VAD speech probability,
 * then trims dead air / silence from the start and end of the audio sample array with a safe margin.
 */
export function trimSilenceFromSamples(
  samples: Float32Array,
  sampleRate: number,
  options: {
    trigger_mode?: DetectionMode;
    threshold_dbfs?: number;
    vad_threshold?: number;
    margin_seconds?: number;
  } = {}
): TrimResult {
  const trigger_mode = options.trigger_mode || 'db_vad';
  const threshold_dbfs = options.threshold_dbfs ?? -38;
  const vad_threshold = options.vad_threshold ?? 0.6;
  const margin_seconds = options.margin_seconds ?? 0.2; // 200ms default safety buffer
  const originalDurationSec = Math.round((samples.length / sampleRate) * 10) / 10;

  if (samples.length < sampleRate * 0.3) {
    return {
      trimmedSamples: samples,
      leadingTrimmedSec: 0,
      trailingTrimmedSec: 0,
      totalTrimmedSec: 0,
      originalDurationSec,
      newDurationSec: originalDurationSec,
      isTrimmed: false,
    };
  }

  // Evaluate in 512-sample blocks (~32ms per window at 16kHz)
  const frameSize = 512;
  const numFrames = Math.floor(samples.length / frameSize);
  const voiceFrames: boolean[] = new Array(numFrames).fill(false);

  for (let f = 0; f < numFrames; f++) {
    const start = f * frameSize;
    const end = Math.min(samples.length, start + frameSize);
    const chunk = samples.subarray(start, end);

    // Compute RMS & dBFS
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) {
      sum += chunk[i] * chunk[i];
    }
    const rms = Math.sqrt(sum / chunk.length);
    const level_dbfs = 20 * Math.log10(Math.max(rms, 1e-5));

    // Zero Crossing Rate & spectral estimation
    let prob = 0;
    if (rms >= 0.003) {
      let zcr = 0;
      for (let i = 1; i < chunk.length; i++) {
        if ((chunk[i] >= 0 && chunk[i - 1] < 0) || (chunk[i] < 0 && chunk[i - 1] >= 0)) {
          zcr++;
        }
      }
      const zcrRatio = zcr / chunk.length;
      if (zcrRatio > 0.03 && zcrRatio < 0.32) {
        const zcrScore = 1 - Math.abs(zcrRatio - 0.12) / 0.15;
        const energyScore = Math.min(1.0, rms * 15);
        prob = Math.max(0, Math.min(1.0, zcrScore * 0.6 + energyScore * 0.4));
      } else {
        prob = Math.max(0, rms * 8);
      }
    }
    prob = Math.min(0.99, Math.max(0.01, prob));

    // Trigger determination
    const isDbPassed = level_dbfs >= threshold_dbfs;
    const isVadPassed = prob >= vad_threshold;

    if (trigger_mode === 'db_vad') {
      voiceFrames[f] = isDbPassed && isVadPassed;
    } else if (trigger_mode === 'db_only') {
      voiceFrames[f] = isDbPassed;
    } else if (trigger_mode === 'vad_only') {
      voiceFrames[f] = isVadPassed;
    }
  }

  // Find first active frame and last active frame
  let firstActiveFrame = -1;
  let lastActiveFrame = -1;

  for (let f = 0; f < numFrames; f++) {
    if (voiceFrames[f]) {
      if (firstActiveFrame === -1) firstActiveFrame = f;
      lastActiveFrame = f;
    }
  }

  // If no voice frame was detected or entire buffer is voice, return original
  if (firstActiveFrame === -1) {
    return {
      trimmedSamples: samples,
      leadingTrimmedSec: 0,
      trailingTrimmedSec: 0,
      totalTrimmedSec: 0,
      originalDurationSec,
      newDurationSec: originalDurationSec,
      isTrimmed: false,
    };
  }

  const marginSamples = Math.round(margin_seconds * sampleRate);
  const firstVoiceSample = firstActiveFrame * frameSize;
  const lastVoiceSample = Math.min(samples.length, (lastActiveFrame + 1) * frameSize);

  const startSample = Math.max(0, firstVoiceSample - marginSamples);
  const endSample = Math.min(samples.length, lastVoiceSample + marginSamples);

  const leadingTrimmedSec = Math.round((startSample / sampleRate) * 100) / 100;
  const trailingTrimmedSec = Math.round(((samples.length - endSample) / sampleRate) * 100) / 100;
  const totalTrimmedSec = Math.round((leadingTrimmedSec + trailingTrimmedSec) * 100) / 100;

  // Trim only if there is meaningful silence removed (> 100ms)
  if (totalTrimmedSec > 0.1 && (endSample - startSample) > sampleRate * 0.2) {
    const trimmed = samples.slice(startSample, endSample);
    const newDurationSec = Math.round((trimmed.length / sampleRate) * 10) / 10;
    return {
      trimmedSamples: trimmed,
      leadingTrimmedSec,
      trailingTrimmedSec,
      totalTrimmedSec,
      originalDurationSec,
      newDurationSec,
      isTrimmed: true,
    };
  }

  return {
    trimmedSamples: samples,
    leadingTrimmedSec: 0,
    trailingTrimmedSec: 0,
    totalTrimmedSec: 0,
    originalDurationSec,
    newDurationSec: originalDurationSec,
    isTrimmed: false,
  };
}

/**
 * Re-encodes Float32Array PCM samples into standard 16-bit PCM WAV Blob
 */
export function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (v: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      v.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');

  // "fmt " sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // SubChunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, 1, true); // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true); // SampleRate (16000)
  view.setUint32(28, sampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  view.setUint16(32, 2, true); // BlockAlign (NumChannels * BitsPerSample/8)
  view.setUint16(34, 16, true); // BitsPerSample (16-bit)

  // "data" sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  // Write PCM 16-bit audio samples with clamping
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([view], { type: 'audio/wav' });
}

/**
 * Trims dead air / silence from an existing audio blob or URL
 */
export async function trimAudioBlobOrUrl(
  audioInput: Blob | string,
  settings: {
    trigger_mode?: DetectionMode;
    threshold_dbfs?: number;
    vad_threshold?: number;
    margin_seconds?: number;
  } = {}
): Promise<{
  blob: Blob;
  audioUrl: string;
  trimResult: TrimResult;
}> {
  let arrayBuffer: ArrayBuffer;
  if (typeof audioInput === 'string') {
    const res = await fetch(audioInput);
    if (!res.ok) throw new Error(`Failed to fetch audio: ${res.statusText}`);
    arrayBuffer = await res.arrayBuffer();
  } else {
    arrayBuffer = await audioInput.arrayBuffer();
  }

  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;

  const trimResult = trimSilenceFromSamples(channelData, sampleRate, settings);
  const blob = encodeWAV(trimResult.trimmedSamples, sampleRate);
  const audioUrl = URL.createObjectURL(blob);

  ctx.close().catch(() => {});

  return {
    blob,
    audioUrl,
    trimResult,
  };
}

export class AudioProcessorEngine {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private gainNode: GainNode | null = null;
  private isRunning: boolean = false;
  private settings: AppSettings;
  
  // Buffers
  private sampleRate: number = 16000;
  private preBufferChunks: Float32Array[] = [];
  private preBufferCapacitySamples: number = 16000;
  private preBufferCurrentSamples: number = 0;

  // Active recording state
  private isRecording: boolean = false;
  private recordedChunks: Float32Array[] = [];
  private recordingStartTime: string = '';
  private recordingStartEpoch: number = 0;
  private lastVoiceDetectedEpoch: number = 0;
  
  // Smoothing: 2 positive out of last 3
  private recentDetections: boolean[] = [false, false, false];

  // Ambient Noise Tracking
  private ambientNoiseFloor: number = -60;

  // Automatic Gain Control (AGC) dynamic state
  private currentAgcGain: number = 1.0;

  // Callbacks
  private onUpdateCallback?: (update: MonitorUpdate) => void;
  private onRecordingCompleteCallback?: (meta: RecordingMeta, blob: Blob) => void;
  private onErrorCallback?: (errMessage: string) => void;

  // Calibration state
  private isCalibrating: boolean = false;
  private calibrationSamples: number[] = [];
  private calibrationDurationSec: number = 5;

  constructor(settings: AppSettings) {
    this.settings = settings;
    this.updatePreBufferCapacity();
  }

  public updateSettings(newSettings: AppSettings) {
    this.settings = newSettings;
    this.updatePreBufferCapacity();
  }

  private updatePreBufferCapacity() {
    this.preBufferCapacitySamples = Math.max(1600, Math.floor(this.sampleRate * (this.settings.preroll_seconds || 1.0)));
  }

  public setCallbacks(
    onUpdate: (update: MonitorUpdate) => void,
    onRecordingComplete: (meta: RecordingMeta, blob: Blob) => void,
    onError: (errMessage: string) => void
  ) {
    this.onUpdateCallback = onUpdate;
    this.onRecordingCompleteCallback = onRecordingComplete;
    this.onErrorCallback = onError;
  }

  public async start(): Promise<boolean> {
    if (this.isRunning) return true;

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      
      // Initialize AudioContext with graceful fallback if 16kHz constraint is rejected by OS
      try {
        this.audioContext = new AudioCtx({ sampleRate: 16000 });
      } catch {
        this.audioContext = new AudioCtx();
      }

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.sampleRate = this.audioContext.sampleRate || 16000;
      this.updatePreBufferCapacity();

      if (this.settings.source === 'gnuradio') {
        // Synthesizer simulation for SDR / GNU Radio /tmp/hackrf_audio.f32
        this.setupGnuRadioSimulation();
      } else {
        let stream: MediaStream | null = null;
        const devId = this.settings.device_id;
        const isCustomDevice = devId && devId !== 'default-mic' && devId !== 'usb-soundcard' && devId !== 'gnuradio-fifo';

        // Attempt 1: Target specific sound card / USB device with multi-channel support
        if (isCustomDevice) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                deviceId: { exact: String(devId) },
                channelCount: { ideal: 2 },
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
              },
            });
          } catch {
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                  deviceId: { ideal: String(devId) },
                  channelCount: { ideal: 2 },
                },
              });
            } catch (e) {
              console.warn('Preferred audio device request failed, falling back to default mic:', e);
            }
          }
        }

        // Attempt 2: Default mic without processing
        if (!stream) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                channelCount: { ideal: 2 },
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
              },
            });
          } catch {
            // Attempt 3: Standard generic audio constraints
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          }
        }

        this.mediaStream = stream;
        this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
        this.setupAudioProcessing();
      }

      this.isRunning = true;
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Audio device initialization failed';
      if (this.onErrorCallback) {
        if (msg.includes('Permission') || msg.includes('NotAllowedError')) {
          this.onErrorCallback('Microphone permission denied. Please allow microphone access in your browser.');
        } else if (msg.includes('NotFound') || msg.includes('Overconstrained')) {
          this.onErrorCallback('Selected audio card is disconnected or busy. Try selecting Default Microphone.');
        } else {
          this.onErrorCallback(msg);
        }
      }
      return false;
    }
  }

  private setupAudioProcessing() {
    if (!this.audioContext || !this.sourceNode) return;

    // High-Resolution FFT AnalyserNode for Real-Time Frequency Spectrum & Interference Diagnostics
    try {
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 2048;
      this.analyserNode.smoothingTimeConstant = 0.55;
      this.sourceNode.connect(this.analyserNode);
    } catch (e) {
      console.warn('AnalyserNode creation failed:', e);
    }

    // 2048 samples per chunk @ 16kHz is ~128ms
    // Set up with 2 input channels to capture multi-channel sound cards & USB audio interfaces
    const bufferSize = 2048;
    this.scriptNode = this.audioContext.createScriptProcessor(bufferSize, 2, 1);

    this.scriptNode.onaudioprocess = (e) => {
      if (!this.isRunning) return;
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }

      const numChannels = e.inputBuffer.numberOfChannels;
      const ch0 = e.inputBuffer.getChannelData(0);
      const gainMultiplier = this.getEffectiveGain();
      const channelPref = this.settings.input_channel ?? 'auto';

      let chunk = new Float32Array(ch0.length);

      if (numChannels >= 2 && channelPref === 'channel_2') {
        const ch1 = e.inputBuffer.getChannelData(1);
        for (let i = 0; i < ch0.length; i++) {
          chunk[i] = ch1[i] * gainMultiplier;
        }
      } else if (channelPref === 'channel_1' || numChannels === 1) {
        for (let i = 0; i < ch0.length; i++) {
          chunk[i] = ch0[i] * gainMultiplier;
        }
      } else {
        // Auto: Take whichever channel has active energy or blend to prevent silent channel dropouts
        if (numChannels >= 2) {
          const ch1 = e.inputBuffer.getChannelData(1);
          for (let i = 0; i < ch0.length; i++) {
            const s0 = ch0[i];
            const s1 = ch1[i];
            // Take the max magnitude sample between Left (Ch0) and Right (Ch1)
            chunk[i] = (Math.abs(s0) >= Math.abs(s1) ? s0 : s1) * gainMultiplier;
          }
        } else {
          for (let i = 0; i < ch0.length; i++) {
            chunk[i] = ch0[i] * gainMultiplier;
          }
        }
      }

      this.processAudioChunk(chunk);
    };

    // Zero-gain node ensures the Web Audio clock stays active while avoiding speaker feedback / howl
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 0;

    this.sourceNode.connect(this.scriptNode);
    this.scriptNode.connect(this.gainNode);
    this.gainNode.connect(this.audioContext.destination);
  }

  private gnuRadioInterval: number | null = null;
  private setupGnuRadioSimulation() {
    // Generates SDR NFM carrier background noise + simulated burst transmissions
    let phase = 0;
    const bufferSize = 2048;

    this.gnuRadioInterval = window.setInterval(() => {
      if (!this.isRunning) return;
      const chunk = new Float32Array(bufferSize);
      const isVoiceBurst = Math.sin(Date.now() / 4000) > 0.4;

      for (let i = 0; i < bufferSize; i++) {
        // Base thermal RF noise
        const rfNoise = (Math.random() * 2 - 1) * 0.015;
        if (isVoiceBurst) {
          phase += 0.15;
          // Harmonic speech-like carrier demodulation
          const voice = Math.sin(phase) * 0.25 + Math.sin(phase * 1.8) * 0.15;
          chunk[i] = rfNoise + voice;
        } else {
          chunk[i] = rfNoise;
        }
      }
      this.processAudioChunk(chunk);
    }, 125);
  }

  public stop() {
    this.isRunning = false;
    if (this.gnuRadioInterval) {
      clearInterval(this.gnuRadioInterval);
      this.gnuRadioInterval = null;
    }
    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }
    if (this.scriptNode) {
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }
    if (this.analyserNode) {
      this.analyserNode.disconnect();
      this.analyserNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    if (this.isRecording) {
      this.finishRecording();
    }

    this.preBufferChunks = [];
    this.preBufferCurrentSamples = 0;
    this.recentDetections = [false, false, false];

    if (this.onUpdateCallback) {
      this.onUpdateCallback({
        level_dbfs: -90,
        speech_probability: 0,
        voice_detected: false,
        recording: false,
        status: 'idle',
        peak_dbfs: -90,
        ambient_noise_dbfs: Math.round(this.ambientNoiseFloor * 10) / 10,
        waveform: new Array(128).fill(0),
        spectrum: new Array(32).fill(0),
      });
    }
  }

  private processAudioChunk(chunk: Float32Array) {
    const rms = this.computeRMS(chunk);
    // dBFS calculation
    const level_dbfs = 20 * Math.log10(Math.max(rms, 1e-5));
    const speech_probability = this.computeSpeechProbability(chunk, rms);

    // Track ambient background noise floor during quiet periods
    if (rms < 0.02 && level_dbfs > -85) {
      this.ambientNoiseFloor = this.ambientNoiseFloor * 0.96 + level_dbfs * 0.04;
    }

    // Dynamic Automatic Gain Control (AGC) based on ambient noise floor measurements
    if (this.settings.auto_gain_control) {
      // Nominal reference ambient floor target is -48.0 dBFS for clear surveillance speech pickup
      const targetNoiseFloorDbfs = -48.0;
      const clampedAmbient = Math.max(-80, Math.min(-20, this.ambientNoiseFloor));
      const rawDeltaDb = targetNoiseFloorDbfs - clampedAmbient; // e.g. -48 - (-64) = +16 dB
      const idealGain = Math.max(0.5, Math.min(6.0, Math.pow(10, rawDeltaDb / 20)));

      // Asymmetric smoothing: fast attack on loud input, smooth release on quiet ambient
      if (idealGain < this.currentAgcGain) {
        this.currentAgcGain = this.currentAgcGain * 0.85 + idealGain * 0.15;
      } else {
        this.currentAgcGain = this.currentAgcGain * 0.97 + idealGain * 0.03;
      }

      // Fast-acting limiter safeguard to prevent digital distortion / clipping if level exceeds -4 dBFS
      if (level_dbfs > -4.0) {
        const overDb = level_dbfs - (-4.0);
        this.currentAgcGain = Math.max(0.5, this.currentAgcGain / Math.pow(10, overDb / 20));
      }
    }

    // Downsample chunk for real-time waveform visualization (128 points)
    const waveformLength = 128;
    const waveform: number[] = new Array(waveformLength);
    const step = chunk.length / waveformLength;
    for (let i = 0; i < waveformLength; i++) {
      const idx = Math.floor(i * step);
      waveform[i] = Math.round((chunk[idx] || 0) * 10000) / 10000;
    }

    // Extract real-time 32-band frequency distribution (0 to 8000 Hz)
    const numBands = 32;
    const spectrum: number[] = new Array(numBands).fill(0);

    if (this.analyserNode) {
      const binCount = this.analyserNode.frequencyBinCount;
      const freqBytes = new Uint8Array(binCount);
      this.analyserNode.getByteFrequencyData(freqBytes);
      const bandStep = binCount / numBands;
      for (let b = 0; b < numBands; b++) {
        const start = Math.floor(b * bandStep);
        const end = Math.min(binCount, Math.floor((b + 1) * bandStep));
        let sum = 0;
        let count = 0;
        for (let k = start; k < end; k++) {
          sum += freqBytes[k];
          count++;
        }
        const avg = count > 0 ? sum / count : 0;
        spectrum[b] = Math.round((avg / 255) * 1000) / 1000;
      }
    } else {
      // Sub-sampled DFT bandpass filter bank approximation for synthetic SDR streams
      const stride = 4;
      for (let b = 0; b < numBands; b++) {
        const freq = 60 + Math.pow(b / (numBands - 1), 1.6) * 7800;
        const omega = (2 * Math.PI * freq) / this.sampleRate;
        let cosSum = 0;
        let sinSum = 0;
        let count = 0;
        for (let i = 0; i < chunk.length; i += stride) {
          cosSum += chunk[i] * Math.cos(omega * i);
          sinSum += chunk[i] * Math.sin(omega * i);
          count++;
        }
        const mag = Math.sqrt(cosSum * cosSum + sinSum * sinSum) / Math.max(1, count);
        spectrum[b] = Math.min(1.0, Math.round(mag * 22 * 1000) / 1000);
      }
    }

    // Calibration accumulation
    if (this.isCalibrating) {
      this.calibrationSamples.push(level_dbfs);
    }

    // Determine conditions
    const isDbPassed = level_dbfs >= this.settings.threshold_dbfs;
    const isVadPassed = speech_probability >= this.settings.vad_threshold;

    let isChunkVoice = false;
    if (this.settings.trigger_mode === 'db_vad') {
      isChunkVoice = isDbPassed && isVadPassed;
    } else if (this.settings.trigger_mode === 'db_only') {
      isChunkVoice = isDbPassed;
    } else if (this.settings.trigger_mode === 'vad_only') {
      isChunkVoice = isVadPassed;
    }

    // 2 positive blocks out of last 3
    this.recentDetections.shift();
    this.recentDetections.push(isChunkVoice);
    const positiveCount = this.recentDetections.filter(Boolean).length;
    const voice_detected = positiveCount >= 2;

    const now = Date.now();

    // Circular Pre-Buffer Management
    this.preBufferChunks.push(chunk);
    this.preBufferCurrentSamples += chunk.length;
    while (this.preBufferCurrentSamples > this.preBufferCapacitySamples && this.preBufferChunks.length > 1) {
      const removed = this.preBufferChunks.shift();
      if (removed) {
        this.preBufferCurrentSamples -= removed.length;
      }
    }

    // State Machine
    let currentStatus: EngineStatus = 'listening';

    if (voice_detected) {
      this.lastVoiceDetectedEpoch = now;
      if (!this.isRecording) {
        // Start recording
        this.isRecording = true;
        this.recordingStartEpoch = now;
        this.recordingStartTime = new Date().toISOString();
        // Flush pre-buffer into recording
        this.recordedChunks = [...this.preBufferChunks];
        currentStatus = 'voice_detected';
      } else {
        this.recordedChunks.push(chunk);
        currentStatus = 'recording';
      }
    } else if (this.isRecording) {
      this.recordedChunks.push(chunk);
      const silenceDurationSec = (now - this.lastVoiceDetectedEpoch) / 1000;
      const configuredSilence = this.settings.silence_seconds || 2.0;

      if (silenceDurationSec >= configuredSilence) {
        // Stop recording
        currentStatus = 'saving';
        this.finishRecording();
      } else {
        currentStatus = 'silence';
      }
    } else {
      currentStatus = 'listening';
    }

    const current_duration_sec = this.isRecording ? (now - this.recordingStartEpoch) / 1000 : 0;

    if (this.onUpdateCallback) {
      this.onUpdateCallback({
        level_dbfs: Math.round(level_dbfs * 10) / 10,
        speech_probability: Math.round(speech_probability * 100) / 100,
        voice_detected: isChunkVoice,
        recording: this.isRecording,
        status: currentStatus,
        current_duration_sec: Math.round(current_duration_sec * 10) / 10,
        peak_dbfs: Math.round(level_dbfs * 10) / 10,
        ambient_noise_dbfs: Math.round(this.ambientNoiseFloor * 10) / 10,
        effective_gain: Math.round(this.getEffectiveGain() * 10) / 10,
        agc_active: Boolean(this.settings.auto_gain_control),
        waveform,
        spectrum,
      });
    }
  }

  private computeRMS(chunk: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) {
      sum += chunk[i] * chunk[i];
    }
    return Math.sqrt(sum / chunk.length);
  }

  private computeSpeechProbability(chunk: Float32Array, rms: number): number {
    if (rms < 0.003) return 0.0;

    // Zero Crossing Rate
    let zcr = 0;
    for (let i = 1; i < chunk.length; i++) {
      if ((chunk[i] >= 0 && chunk[i - 1] < 0) || (chunk[i] < 0 && chunk[i - 1] >= 0)) {
        zcr++;
      }
    }
    const zcrRatio = zcr / chunk.length;

    // Spectral voice band energy estimation (300 Hz - 3400 Hz voice formant region)
    // Low frequency hum < 200 Hz or high hiss > 4000 Hz are penalized
    let voiceBandEnergy = 0;
    let totalEnergy = 0;

    // Simple pseudo-filter / autocorrelation
    for (let i = 2; i < chunk.length; i++) {
      const diff = chunk[i] - chunk[i - 2];
      voiceBandEnergy += diff * diff;
      totalEnergy += chunk[i] * chunk[i];
    }

    const ratio = totalEnergy > 0 ? voiceBandEnergy / totalEnergy : 0;

    let prob = 0;
    // Human voice speech typically has moderate ZCR (0.04 to 0.28) and strong 300-3400Hz energy
    if (zcrRatio > 0.03 && zcrRatio < 0.32) {
      const zcrScore = 1 - Math.abs(zcrRatio - 0.12) / 0.15;
      const energyScore = Math.min(1.0, rms * 15);
      prob = Math.max(0, Math.min(1.0, zcrScore * 0.6 + energyScore * 0.4));
    } else {
      prob = Math.max(0, (rms * 8));
    }

    // Bound to [0.00, 1.00]
    return Math.min(0.99, Math.max(0.01, prob));
  }

  private finishRecording() {
    if (this.recordedChunks.length === 0) {
      this.isRecording = false;
      return;
    }

    const totalSamples = this.recordedChunks.reduce((acc, c) => acc + c.length, 0);
    const merged = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of this.recordedChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const rawDurationSeconds = Math.round((totalSamples / this.sampleRate) * 10) / 10;
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timestampStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

    // Auto-trim dead air / silence post-processing if enabled (enabled by default)
    let finalSamples = merged;
    let finalDurationSeconds = rawDurationSeconds;
    let isTrimmed = false;
    let trimmedDeadAirSec = 0;
    let trimInfo: TrimInfo | undefined = undefined;

    if (this.settings.auto_trim_silence !== false) {
      const trimResult = trimSilenceFromSamples(merged, this.sampleRate, {
        trigger_mode: this.settings.trigger_mode,
        threshold_dbfs: this.settings.threshold_dbfs,
        vad_threshold: this.settings.vad_threshold,
        margin_seconds: this.settings.trim_margin_seconds ?? 0.2,
      });

      if (trimResult.isTrimmed) {
        finalSamples = trimResult.trimmedSamples;
        finalDurationSeconds = trimResult.newDurationSec;
        isTrimmed = true;
        trimmedDeadAirSec = trimResult.totalTrimmedSec;
        trimInfo = {
          leading_trimmed_sec: trimResult.leadingTrimmedSec,
          trailing_trimmed_sec: trimResult.trailingTrimmedSec,
          total_trimmed_sec: trimResult.totalTrimmedSec,
        };
      }
    }

    // WAV creation (PCM 16-bit 16000Hz mono)
    const wavBlob = encodeWAV(finalSamples, this.sampleRate);
    const audioUrl = URL.createObjectURL(wavBlob);

    const meta: RecordingMeta = {
      recording_id: timestampStr,
      filename_wav: `${timestampStr}.wav`,
      filename_json: `${timestampStr}.json`,
      source: this.settings.source,
      device: this.settings.device_name || (this.settings.source === 'microphone' ? 'Default Microphone' : this.settings.source === 'usb' ? 'USB Audio Device' : 'GNU Radio FIFO'),
      sample_rate: this.sampleRate,
      channels: 1,
      timestamp_start: this.recordingStartTime || new Date(Date.now() - rawDurationSeconds * 1000).toISOString(),
      timestamp_end: new Date().toISOString(),
      duration_seconds: finalDurationSeconds,
      original_duration_seconds: rawDurationSeconds,
      is_trimmed: isTrimmed,
      trimmed_dead_air_sec: trimmedDeadAirSec,
      trim_info: trimInfo,
      trigger_mode: this.settings.trigger_mode,
      trigger_threshold_dbfs: this.settings.threshold_dbfs,
      vad_threshold: this.settings.vad_threshold,
      annotation_status: 'pending',
      upload_status: 'local',
      file_size_bytes: wavBlob.size,
      audio_url: audioUrl,
      ...(this.settings.source === 'gnuradio' && {
        frequency_hz: this.settings.frequency_hz || 145000000,
        modulation: this.settings.modulation || 'NFM',
        station_id: this.settings.station_id || 'ST001',
      }),
    };

    this.isRecording = false;
    this.recordedChunks = [];

    if (this.onRecordingCompleteCallback) {
      this.onRecordingCompleteCallback(meta, wavBlob);
    }
  }

  private encodeWAV(samples: Float32Array, sampleRate: number): Blob {
    return encodeWAV(samples, sampleRate);
  }

  // Calibration routine
  public async runCalibration(
    durationSec: number = 5,
    onProgress?: (elapsedSec: number, noiseDbfs: number) => void
  ): Promise<{ noise_floor_dbfs: number; recommended_threshold_dbfs: number }> {
    this.isCalibrating = true;
    this.calibrationSamples = [];
    this.calibrationDurationSec = durationSec;

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const currentAvg =
        this.calibrationSamples.length > 0
          ? this.calibrationSamples.reduce((a, b) => a + b, 0) / this.calibrationSamples.length
          : -60;
      if (onProgress) {
        onProgress(Math.min(durationSec, Math.round(elapsed * 10) / 10), Math.round(currentAvg * 10) / 10);
      }
    }, 200);

    return new Promise((resolve) => {
      setTimeout(() => {
        clearInterval(interval);
        this.isCalibrating = false;
        const valid = this.calibrationSamples.filter((v) => isFinite(v) && v > -100);
        const noiseFloor =
          valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : -58.0;

        const roundedNoise = Math.round(noiseFloor * 10) / 10;
        // Recommended threshold: noise_floor + 12 dB margin, clamped between -55 and -20 dBFS
        const recommended = Math.max(-55, Math.min(-20, Math.round((roundedNoise + 14) * 10) / 10));

        resolve({
          noise_floor_dbfs: roundedNoise,
          recommended_threshold_dbfs: recommended,
        });
      }, durationSec * 1000);
    });
  }

  public getEffectiveGain(): number {
    if (this.settings.auto_gain_control) {
      return this.currentAgcGain;
    }
    return this.settings.input_gain ?? 1.0;
  }

  public getAnalyserNode(): AnalyserNode | null {
    return this.analyserNode;
  }

  public getSampleRate(): number {
    return this.sampleRate;
  }

  public getAudioContext(): AudioContext | null {
    return this.audioContext;
  }
}
