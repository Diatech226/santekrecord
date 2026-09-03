# Voice pipeline field diagnosis (Kali)

The monitored path is: hardware input → native-rate stereo capture → stable
channel selection → 16 kHz resampling → detection-only gain/AGC → the same
processed samples for calibration and monitoring → dynamic event gate → Silero
raw and smoothed VAD → SpeechDetector duration confirmation → recorder. The
origin of human speech is diagnostic metadata only and never an authorization.
Archived WAV chunks branch before gain/AGC, with 1–2 seconds of pre-roll.

## Repeatable manual check

Open **Voice Pipeline / Diagnostics** while monitoring. For every run record:
raw and processed level, effective gain, selected channel and both channel RMS
levels, VAD raw and smoothed, candidate, confirmed, effective speech, recorder
state, and reject reason.

1. Start monitoring, remain quiet until **CALIBRATING AMBIENT** has accumulated
   3.0 seconds of verified quiet, then say “Bonjour ceci est un test de voix”.
   Expect **EVENT**, **VOICE**, and **REC**.
2. Select **Channel 2**, repeat the phrase at the same distance, and compare
   processed levels and both VAD probabilities with step 1.
3. Select **AUTO**, repeat at least three times, and verify that the displayed
   `AUTO → CH1/CH2` remains stable and chooses the channel whose speech produces
   useful VAD, rather than merely following steady hiss.
4. On the better channel repeat with **AGC OFF / 1×**, **AGC OFF / 4×**, then
   **AGC ON**. Compare processed peak and VAD. Stop increasing manual gain if
   quality says `clipping`.

## Reading the diagnosis

* Moving waveform plus `input_too_low`: inspect capture level or detection gain.
* Usable processed level plus `vad_inactive`: compare channels and verify routing,
  16 kHz processing, and Silero backend/error.
* A level event with low VAD is non-voice and must not produce a final WAV.
* Candidate without confirmation: keep speaking past minimum speech duration.
* Effective speech without REC: inspect the recorder/session state.

## Three simple Kali acceptance tests

* **A — local person:** after quiet calibration, say “Bonjour ceci est un test
  de voix”. Expected: `EVENT`, `VOICE`, `REC`.
* **B — talkie:** play human speech from a talkie beside the microphone.
  Expected: exactly the same `EVENT`, `VOICE`, `REC` result.
* **C — non-voice noise:** make a loud knock, hiss, or fan burst. Expected:
  `EVENT`, `VOICE = NO`, `REC = NO`; the temporary event buffer is discarded.

Synthetic automated tests validate scale, routing, gain, clipping, and decisions;
they do not substitute for these measurements with the actual Kali interface.
