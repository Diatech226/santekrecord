import assert from 'node:assert/strict';
import test from 'node:test';

import { AppSettings, AudioDevice } from '../types';
import { reconcileSelectedDevice } from './deviceReconciliation';

const configured: AppSettings = {
  source: 'usb', device_id: 8, device_name: 'USB Audio CODEC',
  device_hostapi: 'ALSA', device_alsa_card_id: 'CODEC', sample_rate: 16000,
  preroll_seconds: 1.5, silence_seconds: 2,
};
const device = (id: number, name: string, card: string): AudioDevice => ({
  id, name, hostapi: 'ALSA', alsa_card_id: card, max_input_channels: 2,
  default_samplerate: 48000, type: card === 'PCH' ? 'microphone' : 'usb',
});

test('reconciliation preserves expected device when temporarily missing', () => {
  const update = reconcileSelectedDevice([device(1, 'Built-in Mic', 'PCH')], configured);
  assert.equal(update.device_id, 8);
  assert.equal(update.device_name, undefined);
  assert.equal(update.selected_device_available, false);
});

test('reconciliation follows the same identity to a new PortAudio id', () => {
  const update = reconcileSelectedDevice([device(11, 'USB Audio CODEC', 'CODEC')], configured);
  assert.equal(update.device_id, 11);
  assert.equal(update.device_name, 'USB Audio CODEC');
  assert.equal(update.selected_device_available, true);
});

test('reconciliation never substitutes a different USB device', () => {
  const fresh = [device(4, 'USB Webcam Mic', 'WEBCAM'), device(1, 'Built-in Mic', 'PCH')];
  const update = reconcileSelectedDevice(fresh, configured);
  assert.equal(update.device_id, 8);
  assert.equal(update.selected_device_available, false);
});

test('first installation may select the default input', () => {
  const initial = { ...configured, device_id: null, device_name: undefined };
  const update = reconcileSelectedDevice([device(1, 'Built-in Mic', 'PCH')], initial);
  assert.equal(update.device_id, 1);
  assert.equal(update.selected_device_available, true);
});
