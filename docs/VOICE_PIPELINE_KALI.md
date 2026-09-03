# Voice pipeline field diagnosis (Kali)

After stable channel selection and 16 kHz resampling the path splits:

```text
RAW AUDIO
├── RAW LEVEL → RAW AMBIENT → EVENT GATE (diagnostic/buffering only)
├── WAV ARCHIVE + PERMANENT PRE-ROLL
└── DETECTION GAIN/AGC → SILERO → SPEECHDETECTOR → RECORD
```

Silero and SpeechDetector alone confirm human voice and authorize recording.
The event gate means only a significant energy departure from raw ambient. It
has no veto: `EVENT OFF / VOICE ON / REC ON` is valid for quiet speech. Speech
origin is diagnostic metadata only. Archived WAV chunks always remain raw.

The version-2 product defaults are `voice_any_source`, 16 kHz, 3.0 seconds of
verified quiet audio, VAD learning maximum 0.15, 8 dB event margin, VAD
start/continue 0.65/0.35, minimum speech 160/300 ms, minimum SNR 6 dB, gain
1.0 without AGC, automatic channel selection, and 1.5 seconds of pre-roll.
There is no legacy configuration migration. A future schema is rejected without
rewriting it.

RAW AMBIENT is explicitly `LEARNING` until a stable eight-frame quiet bootstrap
window has passed. Voice candidates clear that window, including gradual VAD
ramp-up. Event telemetry remains idle and its baseline/delta remain unavailable
until then. This affects diagnostics only: confirmed voice still records.

## Repeatable manual check

Open **Voice Pipeline / Diagnostics** while monitoring. For every run record:
`RAW LEVEL`, `RAW PEAK`, `RAW AMBIENT READY`, `RAW AMBIENT`, `EVENT DELTA`, `EVENT ACTIVE`, `PROCESSED LEVEL`,
`GAIN`, `VAD RAW`, `VAD SMOOTHED`, `SPEECH CANDIDATE`, `SPEECH CONFIRMED`, and
`REC`. Also note the selected channel, both channel RMS levels, and reject reason.

1. **Test A — voix normale.** Remain quiet until calibration has accumulated
   3.0 seconds of verified quiet, then speak normally. Expected: `VOICE ON`,
   `REC ON`; `EVENT` is diagnostic.
2. **Test B — voix faible.** Speak softly. `EVENT OFF`, `VOICE ON`, `REC ON` is
   explicitly acceptable and desired. Confirm that the WAV includes pre-roll.
3. **Test C — bruit fort.** Clap, knock, or hiss. Possible/expected:
   `EVENT ON`, `VOICE OFF`, `REC OFF`; no final WAV is produced.
4. **Test D — talkie.** Play speech through a walkie-talkie near the microphone.
   Expected: `VOICE ON`, `REC ON`, with no `radio_activity` requirement.

## Reading the diagnosis

* Moving waveform plus `input_too_low`: inspect capture level or detection gain.
* Usable processed level plus `vad_inactive`: compare channels and verify routing,
  16 kHz processing, and Silero backend/error.
* A level event with low VAD is non-voice and must not produce a final WAV.
* Candidate without confirmation: keep speaking past minimum speech duration.
* Confirmed voice without REC: `recorder_not_started` indicates a recorder or
  exceptional pipeline fault; the event state is never a blocking explanation.

Synthetic automated tests validate scale, routing, gain, clipping, and decisions;
they do not substitute for these measurements with the actual Kali interface.
