"""GNU Radio worker, run with the distro Python that owns the DSP bindings."""
import math
import os
import signal
import sys
import threading


def receive(serial, frequency_hz):
    # Preserve a dedicated PCM descriptor; native diagnostics may write stdout.
    pcm_fd = os.dup(sys.stdout.fileno())
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    import osmosdr
    from gnuradio import analog, blocks, filter, gr
    from gnuradio.filter import firdes

    sample_rate = 8_000_000
    # Tune offset from DC while keeping the hardware center within range.
    offset = 100_000 if frequency_hz <= 5_999_900_000 else -100_000
    center_hz = frequency_hz + offset
    radio = osmosdr.source(args=f"numchan=1 hackrf={serial}")
    if radio.set_sample_rate(sample_rate) != sample_rate:
        raise RuntimeError("Le HackRF n'a pas appliqué 8 MHz d'échantillonnage.")
    actual = radio.set_center_freq(center_hz, 0)
    if not math.isclose(actual, center_hz, rel_tol=0, abs_tol=0.5):
        raise RuntimeError(f"Fréquence reçue inattendue : {actual - offset:.0f} Hz.")
    radio.set_gain_mode(False, 0)
    radio.set_gain(16, "LNA", 0)
    radio.set_gain(20, "VGA", 0)

    translate = filter.freq_xlating_fir_filter_ccc(
        10, firdes.low_pass(1, sample_rate, 80_000, 100_000), -offset, sample_rate)
    channel = filter.fir_filter_ccf(10, firdes.low_pass(1, 800_000, 6_000, 3_000))
    demodulate = analog.nbfm_rx(audio_rate=16_000, quad_rate=80_000, max_dev=2_500)
    output = blocks.file_descriptor_sink(gr.sizeof_float, pcm_fd)
    flowgraph = gr.top_block("HackRF NFM RX", catch_exceptions=True)
    flowgraph.connect(radio, translate, channel, demodulate, output)

    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    flowgraph.start()
    try:
        stop.wait()
    finally:
        flowgraph.stop()
        flowgraph.wait()


if __name__ == "__main__":
    receive(sys.argv[1], int(sys.argv[2]))
