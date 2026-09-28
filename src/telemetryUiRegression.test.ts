import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const translations = readFileSync(new URL('./i18n/translations.ts', import.meta.url), 'utf8');

test('monitoring offers one primary stop and one sticky stop without banner or header duplicates', () => {
  assert.match(app, /id="btn-toggle-monitoring"/);
  assert.match(app, /id="btn-stop-monitoring-sticky"/);
  assert.doesNotMatch(app, /btn-stop-surveillance-top|btn-quick-stop-monitor/);
});

test('the sticky decision strip keeps three equal state columns on narrow screens', () => {
  assert.match(app, /sticky top-2 z-30/);
  assert.match(app, /grid grid-cols-3[^"\n]*flex-1/);
  assert.match(app, /sm:grid-cols-\[minmax\(0,1fr\)_auto\]/);
});

test('recording duration is visual while its live region only announces state changes', () => {
  assert.match(app, /REC \{telemetry\?\.recording \? `ON \$\{durationSec\.toFixed\(1\)\}s` : 'OFF'\}/);
  assert.match(app, /role="status" aria-live="polite">\s*REC \{telemetry\?\.recording \? 'ON' : 'OFF'\}/s);
  assert.doesNotMatch(app, /aria-live="polite"[^>]*>[\s\S]{0,250}durationSec/);
});

test('active and quiet sound-card labels are translated', () => {
  for (const key of ['audioInputFallback', 'listeningInProgress', 'signalVeryLow', 'boostGain']) {
    assert.match(translations, new RegExp(`${key}: string`));
    assert.doesNotMatch(app, new RegExp(`['\"](?:Entrée audio|Écoute en cours)['\"]`));
  }
});
