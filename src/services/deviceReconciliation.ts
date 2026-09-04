import { AppSettings, AudioDevice } from '../types';

const sameIdentity = (device: AudioDevice, settings: AppSettings) =>
  device.name === settings.device_name &&
  (!settings.device_hostapi || device.hostapi === settings.device_hostapi) &&
  (!settings.device_alsa_card_id || device.alsa_card_id === settings.device_alsa_card_id);

export function reconcileSelectedDevice(
  freshDevices: AudioDevice[], settings: AppSettings,
  options: { allowFallback?: boolean } = {},
): Partial<AppSettings> {
  if (settings.source === 'gnuradio') return {};
  const hasConfiguredIdentity = Boolean(settings.device_name);
  const exact = freshDevices.find(device =>
    String(device.id) === String(settings.device_id) && sameIdentity(device, settings));
  const identityMatches = freshDevices.filter(device => sameIdentity(device, settings));
  const nameMatches = freshDevices.filter(device => device.name === settings.device_name);
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
