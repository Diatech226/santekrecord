import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const player = readFileSync(new URL('./components/AudioPlayer.tsx', import.meta.url), 'utf8');

test('ordinary playback does not initialize Web Audio', () => {
  const togglePlay = player.match(/const togglePlay = async \(\) => \{([\s\S]*?)\n  \};/)?.[1] ?? '';
  assert.doesNotMatch(togglePlay, /initWebAudio|createMediaElementSource/);
  assert.match(togglePlay, /configureAudioElement\(audio\)/);
  assert.match(togglePlay, /audio\.play\(\)/);
});

test('normalization is the only user action that initializes Web Audio', () => {
  const toggleNormalize = player.match(/const toggleNormalize = async \(\) => \{([\s\S]*?)\n  \};/)?.[1] ?? '';
  assert.match(toggleNormalize, /getRecordingNormalizationMetrics/);
  assert.match(toggleNormalize, /initWebAudio\(metrics\)/);
  assert.doesNotMatch(player, /Fetch or calculate recording normalization metrics on change/);
});

test('playback is unmuted and Web Audio failures restore a native element', () => {
  assert.match(player, /audio\.muted = false/);
  assert.match(player, /audio\.volume = 1/);
  assert.match(player, /audio\.playbackRate = playbackRate/);
  assert.match(player, /setAudioElementGeneration\(\(generation\) => generation \+ 1\)/);
  assert.match(player, /Web Audio resume failed; restoring native playback/);
});
