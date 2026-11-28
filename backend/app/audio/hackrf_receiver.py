"""GNU Radio worker, run with the distro Python that owns the DSP bindings."""
import math
import os
import sys

from hackrf_protocol import TUNE_MARKER


def receive(serial, frequency_hz):
    # Preserve a dedicated PCM descriptor; native diagnostics may write stdout.
    pcm_fd = os.dup(sys.stdout.fileno())
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    import osmosdr
    from gnuradio import analog, blocks, filter, gr
    from gnuradio.filter import firdes

    sample_rate = 8_000_000

    def graph_for(radio, frequency):
        offset = 100_000 if frequency <= 5_999_900_000 else -100_000
        center_hz = frequency + offset
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
        power = blocks.complex_to_mag_squared(1)
        average = blocks.moving_average_ff(5, 0.2, 4000)
        decimate = blocks.keep_one_in_n(gr.sizeof_float, 5)
        interleave = blocks.interleave(gr.sizeof_float)
        output = blocks.file_descriptor_sink(gr.sizeof_float, os.dup(pcm_fd))
        graph = gr.top_block("HackRF NFM RX", catch_exceptions=True)
        graph.connect(radio, translate, channel, demodulate, (interleave, 0))
        graph.connect(channel, power, average, decimate, (interleave, 1))
        graph.connect(interleave, output)
        return graph

    # Four gr-osmosdr USB buffers at 8 Msps contain at most about 66 ms
    # of IQ that can survive an RX restart. The scanner drops 192 ms.
    radio = osmosdr.source(args=f"numchan=1 hackrf={serial},buffers=4")
    graph = graph_for(radio, frequency_hz)
    graph.start()
    try:
        for command in sys.stdin:
            if command.strip() == "stop":
                break
            frequency = int(command)
            graph.stop()
            graph.wait()
            # Keep the source and USB handle, but rebuild the DSP history and
            # discard any remaining samples from the driver's bounded ring.
            graph.disconnect_all()
            graph = graph_for(radio, frequency)
            # The reader discards all audio through this ordered boundary.
            os.write(pcm_fd, TUNE_MARKER)
            graph.start()
    finally:
        graph.stop()
        graph.wait()


if __name__ == "__main__":
    receive(sys.argv[1], int(sys.argv[2]))
