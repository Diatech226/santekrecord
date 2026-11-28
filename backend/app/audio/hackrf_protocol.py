"""Each PCM frame is a float32 audio sample and a float32 RF power sample."""
# Two reserved NaN payloads cannot be emitted by the finite DSP input. The
# worker writes them at a frame boundary after the previous graph has joined.
TUNE_MARKER = bytes.fromhex("531ac07f 421dc07f")
FRAME_BYTES = 8
