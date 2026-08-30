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
    themeKaliDark: 'Kali Stealth Dark',
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
    downloadWav: 'Download WAV file',
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
    themeKaliDark: 'Kali Sombre Furtif',
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
    downloadWav: 'Télécharger le fichier WAV',
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
  },
};
