import { AppSettings, AudioDevice } from '../types';

const sameIdentity = (device: AudioDevice, settings: AppSettings) =>
  device.name === settings.device_name &&
  (!settings.device_hostapi || device.hostapi === settings.device_hostapi) &&
  (!settings.device_alsa_card_id || device.alsa_card_id === settings.device_alsa_card_id);

export function reconcileSelectedDevice(
  freshDevices: AudioDevice[], settings: AppSettings,
): Partial<AppSettings> {
  if (settings.source === 'gnuradio') return {};
  const exact = freshDevices.find(device =>
    String(device.id) === String(settings.device_id) && sameIdentity(device, settings));
  const replacement = exact
    ?? freshDevices.find(device => sameIdentity(device, settings))
    ?? (settings.source === 'usb' ? freshDevices.find(device => device.type === 'usb') : undefined)
    ?? freshDevices.find(device => device.is_default)
    ?? freshDevices[0];
  return replacement ? {
    device_id: Number(replacement.id), device_name: replacement.name,
    device_hostapi: replacement.hostapi,
    device_max_input_channels: replacement.max_input_channels,
    device_default_samplerate: replacement.default_samplerate,
    device_alsa_card_id: replacement.alsa_card_id ?? undefined,
    device_alsa_device: replacement.alsa_device ?? undefined,
  } : { device_id: null };
}
