import numpy as np


class RMSDetector:
    """
    Calculates audio signal level, RMS, and dBFS.
    dBFS = 20 * log10(max(RMS, 1e-7))
    """

    @staticmethod
    def calculate_rms(samples: np.ndarray) -> float:
        if len(samples) == 0:
            return 0.0
        # Ensure float array
        f_samples = samples.astype(np.float32)
        mean_square = np.mean(f_samples ** 2)
        return float(np.sqrt(mean_square))

    @staticmethod
    def rms_to_dbfs(rms: float) -> float:
        # Avoid log(0)
        safe_rms = max(float(rms), 1e-6)
        dbfs = 20.0 * np.log10(safe_rms)
        return float(np.clip(dbfs, -90.0, 0.0))

    @classmethod
    def process_chunk(cls, chunk: np.ndarray) -> tuple[float, float]:
        """
        Returns (rms, dbfs) for the given audio chunk.
        """
        rms = cls.calculate_rms(chunk)
        dbfs = cls.rms_to_dbfs(rms)
        return rms, dbfs
