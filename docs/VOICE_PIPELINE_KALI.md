# Voice pipeline field diagnosis (Kali)

The monitored path is: hardware input → native-rate stereo capture → stable
channel selection → 16 kHz resampling → detection-only gain/AGC → the same
processed samples for waveform and Silero → raw and smoothed VAD →
SpeechDetector candidate and duration confirmation → cold-start confirmation →
recorder. Archived WAV chunks branch before gain/AGC.

## Repeatable manual check

Open **Voice Pipeline / Diagnostics** while monitoring. For every run record:
raw and processed level, effective gain, selected channel and both channel RMS
levels, VAD raw and smoothed, candidate, confirmed, effective speech, recorder
state, and reject reason.

1. Select **General Voice**, **Channel 1**, and **AGC ON**. Say “Bonjour ceci
   est un test de voix” at a normal distance and record all fields above.
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
* High VAD plus `snr_too_low`: SpeechDetector rejected the frame; recalibrate the
  ambient profile only in genuine quiet.
* Candidate without confirmation: keep speaking past minimum speech duration.
* Confirmed without effective speech: the cold-start threshold is blocking it.
* Effective speech without REC: inspect the recorder/session state.

Synthetic automated tests validate scale, routing, gain, clipping, and decisions;
they do not substitute for these measurements with the actual Kali interface.
