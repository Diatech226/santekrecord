export type Language = 'en' | 'fr';

export interface Translations {
  // Top bar
  appTitle: string;
  version: string;
  uptime: string;
  device: string;
  engine: string;
  engineActive: string;
  engineReady: string;
  backendConnected: string;
  sileroVadReady: string;
  targetFifo: string;
  port: string;
  retry: string;

  // Source Selector
  inputSource: string;
  microphone: string;
  usbSound: string;
  hackrfGnu: string;
  deviceInterface: string;
  defaultAudioDevice: string;
  fifoStream: string;
  formatFloat32: string;
  rate16k: string;
  inputGain: string;
  inputGainDesc: string;
  inputChannel: string;
  channelAuto: string;
  channel1: string;
  channel2: string;
  soundCardInactiveNotice: string;
  soundCardQuietNotice: string;
  soundCardTroubleshootTitle: string;

  // Detection Parameters
  detectionParams: string;
  autoCalibrate: string;
  triggerMode: string;
  modeDbVad: string;
  modeDbOnly: string;
  modeVadOnly: string;
  dbThreshold: string;
  sensitive: string;
  loud: string;
  vadConfidence: string;
  permissive: string;
  strictVoice: string;
  prerecord: string;
  silenceTail: string;

  // Theme Settings
  colorScheme: string;
  themeDark: string;
  themeLight: string;
  themeToggle: string;
  themeKaliDark: string;
  themeTerminalGreen: string;
  themeKaliBlue: string;
  themeWhiteTerminal: string;
  themeKaliDarkDesc: string;
  themeTerminalGreenDesc: string;
  themeKaliBlueDesc: string;
  themeWhiteTerminalDesc: string;

  // Post-Processing / Trimming
  postProcessing: string;
  autoTrimSilence: string;
  autoTrimSilenceDesc: string;
  trimMargin: string;
  trimMarginDesc: string;
  trimSilenceBtn: string;
  trimming: string;
  trimmedBadge: string;
  trimmedTooltip: string;
  deadAirRemoved: string;
  leadingSilence: string;
  trailingSilence: string;
  originalDuration: string;
  trimSuccess: string;
  noSilenceToTrim: string;

  // Primary Actions
  startSurveillance: string;
  terminateSurveillance: string;
  calibrateNoiseFloor: string;

  // Live Telemetry
  liveTelemetry: string;
  vadConfidenceMetric: string;
  recDuration: string;
  formatCodec: string;
  activePlayback: string;

  // Status Indicator
  status: string;
  statusListening: string;
  statusVoiceDetected: string;
  statusRecording: string;
  statusSilence: string;
  statusSaving: string;
  statusError: string;
  statusIdle: string;

  // Audio Meter
  rmsSignalLevel: string;
  peak: string;
  resetPeak: string;
  trg: string;
  ambientNoise: string;
  ambientFloor: string;
  ambientFloorSparkline: string;
  ambientMin: string;
  ambientMax: string;
  ambientAvg: string;
  ambientQuiet: string;
  ambientModerate: string;
  ambientNoisy: string;
  timeSeriesTelemetry: string;
  thresholdBreach: string;
  liveSampling: string;
  systemStandby: string;
  vadClassifier: string;
  speechActive: string;
  noSpeech: string;
  confidence: string;
  peakHold: string;
  now: string;

  // Waveform & Input Clarity
  liveWaveformBuffer: string;
  inputClarity: string;
  crestFactor: string;
  snrEstimate: string;
  snrMetric: string;
  snrDisplay: string;
  snrDelta: string;
  snrExcellent: string;
  snrGood: string;
  snrFair: string;
  snrPoor: string;
  snrQuality: string;
  noiseFloorOffset: string;
  clarityPristine: string;
  clarityOptimal: string;
  clarityLow: string;
  clarityClipping: string;
  clippingNominal: string;
  bufferWindow: string;
  dynamicRange: string;

  // Spectral Heatmap & Frequency Distribution
  spectralHeatmap: string;
  spectralWaterfall: string;
  voiceBandEnergy: string;
  lowNoiseEnergy: string;
  highHissEnergy: string;
  peakFrequency: string;
  voiceSignature: string;
  noiseSignature: string;
  spectralIntensity: string;
  voiceRegionLabel: string;
  lowRumbleLabel: string;
  highHissLabel: string;
  colorMap: string;
  spectralResolution: string;

  // Real-Time FFT Spectrum & Interference Analyzer
  fftSpectrum: string;
  fftSpectrumSub: string;
  interferenceSources: string;
  detectedInterference: string;
  noInterferenceDetected: string;
  interferenceMains50: string;
  interferenceMains60: string;
  interferenceHarmonic100_120: string;
  interferenceTone1k: string;
  interferenceCoilWhine: string;
  interferenceRoomRumble: string;
  interferenceSpeechFormant: string;
  interferenceLightBuzz: string;
  scaleLog: string;
  scaleLinear: string;
  frequencyScale: string;
  peakHoldEnvelope: string;
  resetPeakHold: string;
  diagnostics: string;
  frequencyRange: string;
  rangeFull: string;
  rangeVoice: string;
  rangeLowHum: string;
  viewSpectrum: string;
  viewHeatmap: string;
  viewCombined: string;
  reticle: string;
  harmonicMarkers: string;
  interferenceMitigation: string;
  mainsHumMitigation: string;
  groundLoopMitigation: string;
  coilWhineMitigation: string;

  // History & Player
  sessionRecordings: string;
  archived: string;
  noRecordings: string;
  exportAll: string;
  exporting: string;
  exportSuccess: string;
  exportCsv: string;
  exportCsvSuccess: string;
  exportWav: string;
  exportSelectedWav: string;
  exportWavSuccess: string;
  exportingWav: string;
  exportSelected: string;
  exportSelectedCsv: string;
  deleteSelected: string;
  selectAll: string;
  deselectAll: string;
  selectedCount: string;
  confirmBatchDelete: string;
  thTimestamp: string;
  thDuration: string;
  thSize: string;
  thConfidence: string;
  thActions: string;
  play: string;
  json: string;
  del: string;
  viewJsonMeta: string;
  downloadWav: string;
  deleteRecording: string;

  // Calibration Modal
  calibTitle: string;
  calibDesc: string;
  calibInstructionsTitle: string;
  calibStep1: string;
  calibStep2: string;
  calibStep3: string;
  calibStartBtn: string;
  calibMeasuring: string;
  calibQuiet: string;
  calibMeasuredNoise: string;
  calibRecommendedTrg: string;
  calibRemeasure: string;
  calibApplyBtn: string;

  // Metadata Modal
  metaPath: string;
  copyJson: string;
  copied: string;
  downloadMetadata: string;
  playbackSpeed: string;
}

export const translations: Record<Language, Translations> = {
  en: {
    appTitle: 'Audio Intelligence Monitor',
    version: 'v1.0.4-kali',
    uptime: 'UPTIME',
    device: 'DEV',
    engine: 'ENGINE',
    engineActive: 'ACTIVE',
    engineReady: 'READY',
    backendConnected: 'BACKEND CONNECTED',
    sileroVadReady: 'SILERO VAD READY',
    targetFifo: 'TARGET',
    port: 'PORT',
    retry: 'Retry',

    inputSource: 'Input Source',
    microphone: 'Microphone',
    usbSound: 'USB Sound',
    hackrfGnu: 'HackRF / GNU',
    deviceInterface: 'Device Interface',
    defaultAudioDevice: 'hw:0,0 [Default ALSA / PulseAudio]',
    fifoStream: 'FIFO Stream',
    formatFloat32: 'Format: Float32 Mono',
    rate16k: 'Rate: 16000 Hz',
    inputGain: 'Software Input Gain',
    inputGainDesc: 'Amplification boost for low-level microphones or sound card inputs',
    inputChannel: 'Input Channel Routing',
    channelAuto: 'Auto Mix (Channel 1 + 2)',
    channel1: 'Channel 1 (Left / Primary)',
    channel2: 'Channel 2 (Right / Secondary)',
    soundCardInactiveNotice: 'Surveillance is paused. Click "START MONITORING" to enable sound card stream.',
    soundCardQuietNotice: 'Audio level is quiet (< -70 dBFS). If voice is not triggering, increase software gain or adjust threshold.',
    soundCardTroubleshootTitle: 'Sound Card Status & Troubleshooting',

    detectionParams: 'Detection Parameters',
    autoCalibrate: 'Auto-Calibrate',
    triggerMode: 'Trigger Mode',
    modeDbVad: 'dB + Voice VAD (Recommended)',
    modeDbOnly: 'dB Level Only',
    modeVadOnly: 'Voice Activity (VAD) Only',
    dbThreshold: 'dB Threshold',
    sensitive: '-60 dBFS (Sensitive)',
    loud: '-15 dBFS (Loud)',
    vadConfidence: 'VAD Confidence',
    permissive: '0.20 (Permissive)',
    strictVoice: '0.95 (Strict Voice)',
    prerecord: 'Pre-Record',
    silenceTail: 'Silence Tail',

    colorScheme: 'Color Scheme / Theme',
    themeDark: 'Dark',
    themeLight: 'Light',
    themeToggle: 'Toggle Theme (Dark / Light)',
    themeKaliDark: 'Dark Workstation',
    themeTerminalGreen: 'Terminal Green',
    themeKaliBlue: 'Kali Dragon Blue',
    themeWhiteTerminal: 'White Terminal',
    themeKaliDarkDesc: 'Stealth black with cyan HUD glow',
    themeTerminalGreenDesc: 'Phosphor matrix CRT console',
    themeKaliBlueDesc: 'Official Kali Linux dragon cobalt',
    themeWhiteTerminalDesc: 'Clean high-contrast light terminal',

    postProcessing: 'Post-Processing',
    autoTrimSilence: 'Auto-Trim Dead Air (Silence)',
    autoTrimSilenceDesc: 'Automatically trims pre-roll and trailing silence based on VAD speech onset & offset',
    trimMargin: 'Trim Margin Buffer',
    trimMarginDesc: 'Safety padding to prevent clipping speech consonants (0.1s - 0.5s)',
    trimSilenceBtn: 'Trim Silence',
    trimming: 'Trimming...',
    trimmedBadge: 'Trimmed',
    trimmedTooltip: 'Dead air trimmed by VAD',
    deadAirRemoved: 'Dead air removed',
    leadingSilence: 'Leading silence',
    trailingSilence: 'Trailing silence',
    originalDuration: 'Original',
    trimSuccess: 'Recording trimmed successfully',
    noSilenceToTrim: 'No dead air detected to trim',

    startSurveillance: 'Start Surveillance',
    terminateSurveillance: 'Terminate Surveillance',
    calibrateNoiseFloor: 'Auto-Calibrate Noise Floor',

    liveTelemetry: 'Live Signal Telemetry',
    vadConfidenceMetric: 'VAD Confidence',
    recDuration: 'Rec Duration',
    formatCodec: 'Format / Codec',
    activePlayback: 'Active Playback Stream',

    status: 'Status',
    statusListening: 'LISTENING',
    statusVoiceDetected: 'VOICE DETECTED',
    statusRecording: 'RECORDING',
    statusSilence: 'SILENCE TAIL',
    statusSaving: 'WRITING WAV+JSON',
    statusError: 'ERROR',
    statusIdle: 'STANDBY',

    rmsSignalLevel: 'RMS SIGNAL LEVEL',
    peak: 'PEAK',
    resetPeak: 'RST',
    trg: 'TRG',
    ambientNoise: 'AMBIENT',
    ambientFloor: 'Ambient Noise Floor',
    ambientFloorSparkline: 'NOISE FLOOR SPARKLINE',
    ambientMin: 'MIN',
    ambientMax: 'MAX',
    ambientAvg: 'AVG',
    ambientQuiet: 'QUIET',
    ambientModerate: 'MODERATE',
    ambientNoisy: 'ELEVATED',
    timeSeriesTelemetry: '5s TIME-SERIES TELEMETRY',
    thresholdBreach: '● THRESHOLD BREACH',
    liveSampling: 'LIVE 50ms SAMPLING',
    systemStandby: 'SYSTEM STANDBY',
    vadClassifier: 'VAD CLASSIFIER',
    speechActive: 'SPEECH ACTIVE',
    noSpeech: 'NO SPEECH',
    confidence: 'CONFIDENCE',
    peakHold: 'PEAK HOLD',
    now: 'NOW',

    // Waveform & Input Clarity
    liveWaveformBuffer: 'LIVE BUFFER WAVEFORM (PCM OSCILLOSCOPE)',
    inputClarity: 'INPUT CLARITY',
    crestFactor: 'CREST FACTOR',
    snrEstimate: 'EST. SNR',
    snrMetric: 'SIGNAL-TO-NOISE (SNR)',
    snrDisplay: 'SIGNAL-TO-NOISE RATIO (SNR)',
    snrDelta: 'Δ NOISE MARGIN',
    snrExcellent: 'EXCELLENT (+20dB)',
    snrGood: 'GOOD (+12dB)',
    snrFair: 'FAIR (+6dB)',
    snrPoor: 'POOR (<6dB)',
    snrQuality: 'SIGNAL QUALITY',
    noiseFloorOffset: 'ABOVE NOISE FLOOR',
    clarityPristine: 'PRISTINE',
    clarityOptimal: 'OPTIMAL',
    clarityLow: 'LOW LEVEL',
    clarityClipping: 'CLIPPING',
    clippingNominal: 'NOMINAL',
    bufferWindow: '128ms BUFFER',
    dynamicRange: 'DYN RANGE',

    // Spectral Heatmap & Frequency Distribution
    spectralHeatmap: 'FREQUENCY SPECTRAL HEAT MAP (D3 CANVAS)',
    spectralWaterfall: 'LIVE SPECTROGRAM & WATERFALL',
    voiceBandEnergy: 'VOICE BAND',
    lowNoiseEnergy: 'LOW NOISE',
    highHissEnergy: 'HIGH HISS',
    peakFrequency: 'PEAK FREQ',
    voiceSignature: 'VOICE FORMANT',
    noiseSignature: 'BACKGROUND NOISE',
    spectralIntensity: 'SPECTRAL POWER',
    voiceRegionLabel: '300Hz - 3.4kHz VOICE FORMANTS',
    lowRumbleLabel: '<250Hz RUMBLE / HUM',
    highHissLabel: '>4kHz HISS / AIR',
    colorMap: 'PALETTE',
    spectralResolution: '32-BAND FFT',

    // Real-Time FFT Spectrum & Interference Analyzer
    fftSpectrum: 'REAL-TIME FFT SPECTRUM & INTERFERENCE ANALYZER',
    fftSpectrumSub: 'FREQUENCY-DOMAIN HARMONIC & NOISE DIAGNOSTICS',
    interferenceSources: 'Interference Sources',
    detectedInterference: 'DETECTED INTERFERENCE',
    noInterferenceDetected: 'Clean Acoustic Spectrum (No Major Narrowband Interference)',
    interferenceMains50: '50 Hz Mains AC Hum (UK/EU Power Grid)',
    interferenceMains60: '60 Hz Mains AC Hum (US/Americas Power Grid)',
    interferenceHarmonic100_120: '100/120 Hz Rectifier / Ground Loop Harmonic Buzz',
    interferenceTone1k: '1.0 kHz Acoustic Whistle / Test Tone Carrier',
    interferenceCoilWhine: 'Coil Whine / High-Frequency SMPS Switching Noise (>3.5kHz)',
    interferenceRoomRumble: 'Low-Frequency HVAC / Room Vibration Rumble (<80Hz)',
    interferenceSpeechFormant: 'Speech Formant Cluster (300Hz - 3.4kHz)',
    interferenceLightBuzz: 'Fluorescent / Triac Dimmer Light Buzz',
    scaleLog: 'Logarithmic',
    scaleLinear: 'Linear',
    frequencyScale: 'SCALE',
    peakHoldEnvelope: 'PEAK HOLD',
    resetPeakHold: 'RST PEAK',
    diagnostics: 'DIAGNOSTICS',
    frequencyRange: 'RANGE',
    rangeFull: 'Full (20Hz - 8kHz)',
    rangeVoice: 'Voice & Mains (20Hz - 4kHz)',
    rangeLowHum: 'Low Hum (20Hz - 500Hz)',
    viewSpectrum: 'FFT Spectrum',
    viewHeatmap: 'Waterfall Heatmap',
    viewCombined: 'Combined View',
    reticle: 'Crosshair Reticle',
    harmonicMarkers: 'Harmonic Guides',
    interferenceMitigation: 'Mitigation Recommendation',
    mainsHumMitigation: 'Isolate AC power cables from mic lead or engage 80Hz high-pass filter.',
    groundLoopMitigation: 'Check ground loop isolator / ensure single common earth reference.',
    coilWhineMitigation: 'Relocate microphone away from laptop chargers, SMPS power supplies, and LED dimmers.',

    sessionRecordings: 'Session Recordings',
    archived: 'ARCHIVED',
    noRecordings: 'No session recordings logged yet. Start monitoring to automatically capture voice triggers.',
    exportAll: 'Export All (ZIP)',
    exporting: 'Exporting ZIP...',
    exportSuccess: 'Archive downloaded',
    exportCsv: 'Export CSV',
    exportCsvSuccess: 'CSV downloaded',
    exportWav: 'Export WAV',
    exportSelectedWav: 'Export Selected (.wav)',
    exportWavSuccess: 'WAV downloaded',
    exportingWav: 'Exporting WAV...',
    exportSelected: 'Export Selected',
    exportSelectedCsv: 'Export Selected (CSV)',
    deleteSelected: 'Delete Selected',
    selectAll: 'Select All',
    deselectAll: 'Deselect All',
    selectedCount: 'selected',
    confirmBatchDelete: 'Are you sure you want to delete the selected recordings?',
    thTimestamp: 'Timestamp / File',
    thDuration: 'Duration',
    thSize: 'Size',
    thConfidence: 'Confidence',
    thActions: 'Actions',
    play: 'Play',
    json: 'JSON',
    del: 'Del',
    viewJsonMeta: 'View JSON metadata',
    downloadWav: 'Download WAV',
    deleteRecording: 'Delete recording',

    calibTitle: 'Noise Floor Calibration',
    calibDesc: 'Automated calibration measures ambient noise floor across 5 seconds and calculates the optimal trigger threshold with high SNR margin.',
    calibInstructionsTitle: 'Instructions:',
    calibStep1: '1. Remain silent in normal operating acoustics.',
    calibStep2: '2. Keep constant fans/SDR/hardware running.',
    calibStep3: '3. Trigger auto-calibration below.',
    calibStartBtn: 'Start 5-Second Calibration',
    calibMeasuring: 'Measuring Ambient Noise Floor...',
    calibQuiet: 'Please maintain quiet',
    calibMeasuredNoise: 'Measured Noise Floor:',
    calibRecommendedTrg: 'Recommended Trigger:',
    calibRemeasure: 'Re-measure',
    calibApplyBtn: 'Apply Threshold',

    metaPath: 'PATH',
    copyJson: 'Copy JSON',
    copied: 'Copied',
    downloadMetadata: 'Download Metadata',
    playbackSpeed: 'Speed',
  },
  fr: {
    appTitle: 'Moniteur d\'Intelligence Audio',
    version: 'v1.0.4-kali',
    uptime: 'FONCTIONNEMENT',
    device: 'PÉR.',
    engine: 'MOTEUR',
    engineActive: 'ACTIF',
    engineReady: 'PRÊT',
    backendConnected: 'SERVEUR CONNECTÉ',
    sileroVadReady: 'SILERO VAD PRÊT',
    targetFifo: 'CIBLE',
    port: 'PORT',
    retry: 'Réessayer',

    inputSource: 'Source d\'Entrée',
    microphone: 'Microphone',
    usbSound: 'Son USB',
    hackrfGnu: 'HackRF / GNU',
    deviceInterface: 'Interface Périphérique',
    defaultAudioDevice: 'hw:0,0 [ALSA / PulseAudio par Défaut]',
    fifoStream: 'Flux FIFO',
    formatFloat32: 'Format: Float32 Mono',
    rate16k: 'Fréquence: 16000 Hz',
    inputGain: 'Gain d\'Entrée Logiciel',
    inputGainDesc: 'Amplification du signal pour carte son, entrée ligne ou microphone à faible niveau',
    inputChannel: 'Routage du Canal d\'Entrée',
    channelAuto: 'Auto Mix (Canaux 1 + 2)',
    channel1: 'Canal 1 (Gauche / Principal)',
    channel2: 'Canal 2 (Droite / Secondaire)',
    soundCardInactiveNotice: 'Surveillance en pause. Cliquez sur "DÉMARRER LA SURVEILLANCE" pour activer l\'écoute de la carte son.',
    soundCardQuietNotice: 'Niveau audio faible (< -70 dBFS). Si le son ne déclenche pas l\'enregistrement, augmentez le gain logiciel ou ajustez le seuil.',
    soundCardTroubleshootTitle: 'État de la Carte Son & Diagnostic',

    detectionParams: 'Paramètres de Détection',
    autoCalibrate: 'Auto-Étalonnage',
    triggerMode: 'Mode de Déclenchement',
    modeDbVad: 'dB + Voix VAD (Recommandé)',
    modeDbOnly: 'Niveau dB Uniquement',
    modeVadOnly: 'Activité Vocale (VAD) Seule',
    dbThreshold: 'Seuil dB',
    sensitive: '-60 dBFS (Sensible)',
    loud: '-15 dBFS (Fort)',
    vadConfidence: 'Confiance VAD',
    permissive: '0.20 (Permissif)',
    strictVoice: '0.95 (Voix Stricte)',
    prerecord: 'Pré-Enregistrement',
    silenceTail: 'Fin de Silence',

    colorScheme: 'Schéma de Couleurs / Thème',
    themeDark: 'Sombre',
    themeLight: 'Blanc',
    themeToggle: 'Basculer Thème (Sombre / Blanc)',
    themeKaliDark: 'Station Sombre',
    themeTerminalGreen: 'Terminal Vert Phosphore',
    themeKaliBlue: 'Kali Bleu Dragon',
    themeWhiteTerminal: 'Terminal Blanc',
    themeKaliDarkDesc: 'Noir furtif avec lueur HUD cyan',
    themeTerminalGreenDesc: 'Console CRT matrice phosphore',
    themeKaliBlueDesc: 'Bleu cobalt officiel Kali Linux',
    themeWhiteTerminalDesc: 'Terminal clair monochrome épuré',

    postProcessing: 'Post-Traitement',
    autoTrimSilence: 'Suppression Automatique du Silence',
    autoTrimSilenceDesc: 'Supprime automatiquement le pré-enregistrement et la fin de silence selon l\'activité vocale VAD',
    trimMargin: 'Marge de Sécurité du Découpage',
    trimMarginDesc: 'Marge de sécurité pour éviter de couper les consonnes (0.1s - 0.5s)',
    trimSilenceBtn: 'Couper le Silence',
    trimming: 'Découpage en cours...',
    trimmedBadge: 'Découpé',
    trimmedTooltip: 'Silence découpé par le VAD',
    deadAirRemoved: 'Silence supprimé',
    leadingSilence: 'Silence initial',
    trailingSilence: 'Silence final',
    originalDuration: 'Original',
    trimSuccess: 'Enregistrement découpé avec succès',
    noSilenceToTrim: 'Aucun silence à découper détecté',

    startSurveillance: 'Démarrer la Surveillance',
    terminateSurveillance: 'Arrêter la Surveillance',
    calibrateNoiseFloor: 'Auto-Étalonner le Bruit de Fond',

    liveTelemetry: 'Télémétrie du Signal en Direct',
    vadConfidenceMetric: 'Confiance VAD',
    recDuration: 'Durée Enreg.',
    formatCodec: 'Format / Codec',
    activePlayback: 'Flux de Lecture Actif',

    status: 'Statut',
    statusListening: 'EN ÉCOUTE',
    statusVoiceDetected: 'VOIX DÉTECTÉE',
    statusRecording: 'ENREGISTREMENT',
    statusSilence: 'QUEUE DE SILENCE',
    statusSaving: 'ÉCRITURE WAV+JSON',
    statusError: 'ERREUR',
    statusIdle: 'EN VEILLE',

    rmsSignalLevel: 'NIVEAU DE SIGNAL RMS',
    peak: 'CRÊTE',
    resetPeak: 'RST',
    trg: 'SEUIL',
    ambientNoise: 'AMBIANT',
    ambientFloor: 'Bruit de fond ambiant',
    ambientFloorSparkline: 'HISTORIQUE DU BRUIT DE FOND',
    ambientMin: 'MIN',
    ambientMax: 'MAX',
    ambientAvg: 'MOY',
    ambientQuiet: 'SILENCIEUX',
    ambientModerate: 'MODÉRÉ',
    ambientNoisy: 'ÉLEVÉ',
    timeSeriesTelemetry: 'TÉLÉMÉTRIE TEMPORELLE 5s',
    thresholdBreach: '● DÉPASSEMENT DE SEUIL',
    liveSampling: 'ÉCHANTILLONNAGE 50ms EN DIRECT',
    systemStandby: 'SYSTÈME EN VEILLE',
    vadClassifier: 'CLASSIFICATEUR VAD',
    speechActive: 'VOIX ACTIVE',
    noSpeech: 'AUCUNE VOIX',
    confidence: 'CONFIANCE',
    peakHold: 'MAINTIEN DE CRÊTE',
    now: 'MAINT.',

    // Waveform & Input Clarity
    liveWaveformBuffer: 'FORME D\'ONDE DU BUFFER EN DIRECT (OSCILLOSCOPE PCM)',
    inputClarity: 'CLARTÉ DU SIGNAL',
    crestFactor: 'FACTEUR DE CRÊTE',
    snrEstimate: 'RSB ESTIMÉ',
    snrMetric: 'RAPPORT SIGNAL/BRUIT (RSB)',
    snrDisplay: 'RAPPORT SIGNAL SUR BRUIT (RSB)',
    snrDelta: 'Δ MARGE DE BRUIT',
    snrExcellent: 'EXCELLENT (+20dB)',
    snrGood: 'BON (+12dB)',
    snrFair: 'MOYEN (+6dB)',
    snrPoor: 'FAIBLE (<6dB)',
    snrQuality: 'QUALITÉ DU SIGNAL',
    noiseFloorOffset: 'AU-DESSUS DU BRUIT',
    clarityPristine: 'PARFAIT',
    clarityOptimal: 'OPTIMAL',
    clarityLow: 'NIVEAU FAIBLE',
    clarityClipping: 'ÉCRÊTAGE',
    clippingNominal: 'NOMINAL',
    bufferWindow: 'BUFFER 128ms',
    dynamicRange: 'PLAGE DYN.',

    // Spectral Heatmap & Frequency Distribution
    spectralHeatmap: 'CARTE THERMIQUE SPECTRALE (CANVAS D3)',
    spectralWaterfall: 'SPECTROGRAMME EN DIRECT & WATERFALL',
    voiceBandEnergy: 'BANDE VOCALE',
    lowNoiseEnergy: 'BRUIT GRAVE',
    highHissEnergy: 'AIGUS/SIFFLEMENT',
    peakFrequency: 'FRÉQ. CRÊTE',
    voiceSignature: 'FORMANTS VOIX',
    noiseSignature: 'BRUIT DE FOND',
    spectralIntensity: 'PUISSANCE SPECTRALE',
    voiceRegionLabel: '300Hz - 3,4kHz FORMANTS VOCAUX',
    lowRumbleLabel: '<250Hz RONFLEMENT/GRAVE',
    highHissLabel: '>4kHz AIGU/SOUFFLE',
    colorMap: 'PALETTE',
    spectralResolution: 'FFT 32-BANDES',

    // Real-Time FFT Spectrum & Interference Analyzer
    fftSpectrum: 'SPECTRE FFT TEMPS RÉEL & ANALYSEUR D\'INTERFÉRENCES',
    fftSpectrumSub: 'DIAGNOSTIC HARMONIQUE ET BRUITS EN DOMAINE FRÉQUENTIEL',
    interferenceSources: 'Sources d\'Interférences',
    detectedInterference: 'INTERFÉRENCES DÉTECTÉES',
    noInterferenceDetected: 'Spectre Acoustique Propre (Aucune Interférence Majeure)',
    interferenceMains50: 'Ronflement Secteur 50 Hz (Réseau Électrique UE/UK)',
    interferenceMains60: 'Ronflement Secteur 60 Hz (Réseau Électrique US/Amériques)',
    interferenceHarmonic100_120: 'Bourdonnement Harmonique Redresseur / Boucle de Masse 100/120 Hz',
    interferenceTone1k: 'Tonalité / Sifflement / Porteuse Test 1,0 kHz',
    interferenceCoilWhine: 'Sifflement de Bobine / Bruit Découpage Alim (>3,5kHz)',
    interferenceRoomRumble: 'Vibrations Graves Ventilation / HVAC (<80Hz)',
    interferenceSpeechFormant: 'Groupe de Formants Vocaux (300Hz - 3,4kHz)',
    interferenceLightBuzz: 'Parasites Éclairage Néon / Variateur Triac',
    scaleLog: 'Logarithmique',
    scaleLinear: 'Linéaire',
    frequencyScale: 'ÉCHELLE',
    peakHoldEnvelope: 'MAINTIEN CRÊTE',
    resetPeakHold: 'RÉINIT. CRÊTE',
    diagnostics: 'DIAGNOSTICS',
    frequencyRange: 'PLAGE',
    rangeFull: 'Complet (20Hz - 8kHz)',
    rangeVoice: 'Voix & Secteur (20Hz - 4kHz)',
    rangeLowHum: 'Graves (20Hz - 500Hz)',
    viewSpectrum: 'Spectre FFT',
    viewHeatmap: 'Carte Waterfall',
    viewCombined: 'Vue Combinée',
    reticle: 'Réticule Télémesure',
    harmonicMarkers: 'Repères Harmoniques',
    interferenceMitigation: 'Recommandation d\'Atténuation',
    mainsHumMitigation: 'Éloigner les câbles secteur du micro ou activer un filtre passe-haut à 80Hz.',
    groundLoopMitigation: 'Vérifier l\'isolation de masse / raccorder à une terre commune unique.',
    coilWhineMitigation: 'Éloigner le microphone des chargeurs portables, alimentations à découpage et variateurs LED.',

    sessionRecordings: 'Enregistrements de Session',
    archived: 'ARCHIVÉS',
    noRecordings: 'Aucun enregistrement pour le moment. Démarrez la surveillance pour capturer automatiquement.',
    exportAll: 'Tout exporter (ZIP)',
    exporting: 'Exportation ZIP...',
    exportSuccess: 'Archive téléchargée',
    exportCsv: 'Exporter CSV',
    exportCsvSuccess: 'CSV téléchargé',
    exportWav: 'Exporter WAV',
    exportSelectedWav: 'Exporter la sélection (.wav)',
    exportWavSuccess: 'WAV téléchargé',
    exportingWav: 'Exportation WAV...',
    exportSelected: 'Exporter la sélection',
    exportSelectedCsv: 'Exporter la sélection (CSV)',
    deleteSelected: 'Supprimer la sélection',
    selectAll: 'Tout sélectionner',
    deselectAll: 'Tout désélectionner',
    selectedCount: 'sélectionné(s)',
    confirmBatchDelete: 'Êtes-vous sûr de vouloir supprimer les enregistrements sélectionnés ?',
    thTimestamp: 'Horodatage / Fichier',
    thDuration: 'Durée',
    thSize: 'Taille',
    thConfidence: 'Confiance',
    thActions: 'Actions',
    play: 'Lire',
    json: 'JSON',
    del: 'Suppr',
    viewJsonMeta: 'Voir les métadonnées JSON',
    downloadWav: 'Télécharger WAV',
    deleteRecording: 'Supprimer l\'enregistrement',

    calibTitle: 'Étalonnage du Bruit de Fond',
    calibDesc: 'L\'étalonnage automatisé mesure le bruit ambiant pendant 5 secondes et calcule le seuil de déclenchement optimal.',
    calibInstructionsTitle: 'Instructions :',
    calibStep1: '1. Restez silencieux dans l\'acoustique normale.',
    calibStep2: '2. Laissez tourner les ventilateurs/SDR/appareils.',
    calibStep3: '3. Déclenchez l\'auto-étalonnage ci-dessous.',
    calibStartBtn: 'Démarrer l\'Étalonnage 5s',
    calibMeasuring: 'Mesure du bruit de fond ambiant...',
    calibQuiet: 'Veuillez maintenir le silence',
    calibMeasuredNoise: 'Bruit de fond mesuré :',
    calibRecommendedTrg: 'Seuil recommandé :',
    calibRemeasure: 'Ré-étalonner',
    calibApplyBtn: 'Appliquer le Seuil',

    metaPath: 'CHEMIN',
    copyJson: 'Copier JSON',
    copied: 'Copié',
    downloadMetadata: 'Télécharger Métadonnées',
    playbackSpeed: 'Vitesse',
  },
};
