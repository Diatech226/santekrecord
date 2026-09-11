import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('desktop page keeps the document as its vertical scroll container', () => {
  const css = read('./index.css');
  const app = read('./App.tsx');

  assert.match(css, /html\s*{[^}]*min-height:\s*100%[^}]*height:\s*auto[^}]*overflow-y:\s*auto/s);
  assert.match(css, /body\s*{[^}]*min-height:\s*100vh[^}]*height:\s*auto[^}]*overflow-y:\s*visible/s);
  assert.match(css, /#root\s*{[^}]*min-height:\s*100vh[^}]*height:\s*auto[^}]*overflow:\s*visible/s);
  assert.match(app, /className="min-h-screen /);
  assert.doesNotMatch(app, /className="[^"]*(?:^|\s)h-screen(?:\s|$)[^"]*"/);
});

test('ordinary vertical wheel gestures are not cancelled by the waveform', () => {
  const waveform = read('./components/WaveformCanvas.tsx');

  assert.match(waveform, /if \(e\.shiftKey \|\| Math\.abs\(e\.deltaX\) > Math\.abs\(e\.deltaY\)\)/);
  assert.match(waveform, /if \(\(e\.ctrlKey \|\| e\.metaKey\) && onZoomChange\)/);
  const handlerPreamble = waveform.match(/const handleWheel[^]*?const container[^]*?if \(!container\) return;/)?.[0];
  assert.ok(handlerPreamble);
  assert.doesNotMatch(handlerPreamble, /e\.preventDefault\(\)/);
});

test('modals and the offline notice do not leave the document scroll locked', () => {
  const files = [
    './App.tsx',
    './main.tsx',
    './components/CalibrationModal.tsx',
    './components/MetadataModal.tsx',
    './components/ReviewAnnotationModal.tsx',
    './components/TroubleshootUsbModal.tsx',
  ];
  const sources = files.map(read).join('\n');

  assert.doesNotMatch(sources, /document\.body\.style\.overflow/);
  assert.doesNotMatch(sources, /(?:window\.)?location\.(?:reload|href)/);

  const notice = read('./main.tsx');
  assert.match(notice, /id="backend-connectivity-notice"/);
  assert.doesNotMatch(notice, /id="backend-connectivity-notice"[^>]*className="[^"]*\binset-0\b/);
  assert.doesNotMatch(notice, /navigator\.onLine\s*[;)]/);
});
