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
start/continue 0.50/0.30, minimum speech 120/300 ms, SNR confidence reference
6 dB, gain
1.0 without AGC, automatic channel selection, and 1.5 seconds of pre-roll.
The SNR reference only normalizes confidence and feeds diagnostics; it never
vetoes recording after human voice is confirmed.
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

## Silero v6.2.1 streaming validation

Update and start the application on the Kali host:

```bash
git pull
./start_kali.sh
```

Before speaking, verify the diagnostics report:

```text
VAD BACKEND       silero_onnx
MODEL LOADED      YES
VAD INPUT         576 samples
CONTEXT           64
FRAME             512
```

Speak normally for five seconds. `RAW LEVEL` and `PROCESSED LEVEL` must rise,
then `VAD RAW` must rise clearly, followed by `VAD SMOOTHED`, `SPEECH CANDIDATE
YES`, `SPEECH CONFIRMED YES`, and `REC ACTIVE`. Repeat close to the microphone,
at 1–2 metres, and with a human voice played through a radio or loudspeaker. In
each case the invariant is `human voice → SPEECH → REC`, regardless of source.

For input-path diagnosis only, launch with `SANTEK_DEBUG_VAD_AUDIO=1`. Up to ten
seconds of the post-resampling/post-gain mono signal presented to the VAD is
written to `data/debug/vad_input.wav`; its path, duration, 16 kHz sample rate,
RMS, and peak are logged. The dump is disabled by default and is separate from
normal archived recordings.
## USB hot-plug field validation

1. Select **USB Audio CODEC** and press **Start**.
2. Speak and confirm `VOICE → SPEECH → REC`.
3. Unplug the USB device.
4. Confirm the configured device remains visible in diagnostics.
5. Confirm the resolved device and ID become `None` / `—`.
6. Confirm `RECONNECTING`, unavailable, and engine not running are reported.
7. Confirm no built-in, default, or other USB microphone is selected.
8. Plug the same USB device back in.
9. Confirm its ALSA `card_id` resolves it even if its `hw` card number changed.
10. Confirm diagnostics show the new resolved PortAudio ID.
11. Confirm `LISTENING` resumes automatically.
12. Speak again and confirm `VOICE → SPEECH → REC`.

Capture ALSA and PortAudio enumeration before unplugging and after hot-plug:

```bash
arecord -l
python -c "import sounddevice as sd; print(sd.query_devices())"
```

A rename such as `hw:2,0 → hw:3,0` is expected. SantekRecord must recognize the
same physical card through `alsa_card_id` and must not substitute another input.
Also press **Stop** at several reconnect stages and confirm no stream reopens.
Automatic reconnect scans every 1.5 seconds for up to 45 seconds. If it times
out, confirm `reconnect_failed`, monitor requested false, and engine running
false before using **Retry**.

## Runtime configuration

User and device settings are persisted in `data/config.json` (not in the
versioned `config.default.json`). Inspect the active values with:

```bash
cat data/config.json
```

For the canonical 16 kHz pipeline, verify `vad_start_threshold` is `0.5`,
`vad_stop_threshold` is `0.3`, and `minimum_speech_ms` is `128`. After selecting
the USB device and changing gain, restart the application and confirm the same
device, ALSA identity, channel, and gain remain present. A subsequent `git pull`
may update product defaults but must not replace this runtime file; normal use
must leave `git status --short` clean.
