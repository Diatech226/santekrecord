import { AppSettings, AudioDevice } from '../types';

export const normalizeDeviceName = (name: string) => name
  .replace(/\(\s*(?:plug)?hw:\d+\s*,\s*\d+\s*\)/gi, '')
  .replace(/\bplughw:\d+\s*,\s*\d+\b/gi, '')
  .replace(/\bcard\s+\d+\b/gi, '')
  .replace(/\s+/g, ' ').replace(/^[\s:,\-]+|[\s:,\-]+$/g, '').toLocaleLowerCase();

const sameIdentity = (device: AudioDevice, settings: AppSettings) => {
  if (settings.device_alsa_card_id) {
    return device.alsa_card_id === settings.device_alsa_card_id &&
      (settings.device_alsa_device === undefined ||
       device.alsa_device === settings.device_alsa_device);
  }
  return normalizeDeviceName(device.name) === normalizeDeviceName(settings.device_name ?? '') &&
    (!settings.device_hostapi || device.hostapi === settings.device_hostapi) &&
    (settings.device_max_input_channels === undefined ||
      device.max_input_channels === settings.device_max_input_channels) &&
    (settings.device_default_samplerate === undefined ||
      device.default_samplerate === settings.device_default_samplerate) &&
    (settings.device_alsa_device === undefined ||
      device.alsa_device === settings.device_alsa_device);
};

/** Replace every persisted identity field when the user changes input family. */
export const settingsForSelectedDevice = (
  source: AppSettings['source'], selectedDevice?: AudioDevice,
): Partial<AppSettings> => ({
  source,
  device_id: selectedDevice?.id ?? null,
  device_name: selectedDevice?.name,
  device_hostapi: selectedDevice?.hostapi,
  device_max_input_channels: selectedDevice?.max_input_channels,
  device_default_samplerate: selectedDevice?.default_samplerate,
  device_alsa_card_id: selectedDevice?.alsa_card_id ?? undefined,
  device_alsa_device: selectedDevice?.alsa_device ?? undefined,
});

export const selectDeviceForSource = (
  devices: AudioDevice[], source: AppSettings['source'], currentDeviceId: number | string | null,
): AudioDevice | undefined => {
  const candidates = devices.filter((device) => {
    if (source === 'microphone') return device.type !== 'usb' && device.type !== 'line';
    if (source !== 'usb') return true;
    const name = (device.name || '').toLowerCase();
    return device.type === 'usb' || device.type === 'line' ||
      ['usb', 'codec', 'sound', 'audio', 'dac'].some(token => name.includes(token));
  });
  const pool = candidates.length ? candidates : devices;
  return pool.find(device => String(device.id) === String(currentDeviceId))
    ?? pool.find(device => device.is_default) ?? pool[0];
};

export type EngineDisplayState = 'reconnecting' | 'active' | 'waiting' | 'ready';
export const getEngineDisplayState = (
  deviceReconnecting: boolean, engineRunning: boolean, monitorRequested: boolean,
): EngineDisplayState => deviceReconnecting ? 'reconnecting'
  : engineRunning ? 'active' : monitorRequested ? 'waiting' : 'ready';

export function reconcileSelectedDevice(
  freshDevices: AudioDevice[], settings: AppSettings,
  options: { allowFallback?: boolean } = {},
): Partial<AppSettings> {
  if (settings.source === 'gnuradio') return {};
  const hasConfiguredIdentity = Boolean(settings.device_name);
  const exact = freshDevices.find(device =>
    String(device.id) === String(settings.device_id) && sameIdentity(device, settings));
  const identityMatches = freshDevices.filter(device => sameIdentity(device, settings));
  const nameMatches = settings.device_alsa_card_id ? [] : freshDevices.filter(device =>
    normalizeDeviceName(device.name) === normalizeDeviceName(settings.device_name ?? ''));
  const replacement = exact ?? (identityMatches.length === 1 ? identityMatches[0] : undefined)
    ?? (nameMatches.length === 1 ? nameMatches[0] : undefined);
  const allowFallback = options.allowFallback ?? !hasConfiguredIdentity;
  const selected = replacement ?? (allowFallback
    ? freshDevices.find(device => device.is_default) ?? freshDevices[0]
    : undefined);
  return selected ? {
    device_id: Number(selected.id), device_name: selected.name,
    device_hostapi: selected.hostapi,
    device_max_input_channels: selected.max_input_channels,
    device_default_samplerate: selected.default_samplerate,
    device_alsa_card_id: selected.alsa_card_id ?? undefined,
    device_alsa_device: selected.alsa_device ?? undefined,
    selected_device_available: true,
  } : {
    // A null volatile id does not erase the persisted physical identity.
    device_id: hasConfiguredIdentity ? settings.device_id : null,
    selected_device_available: false,
  };
}
