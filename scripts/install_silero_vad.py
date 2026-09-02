"""Install a pinned Silero ONNX model for deterministic offline runtime use."""
from pathlib import Path
from urllib.request import urlopen

URL = "https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.0/src/silero_vad/data/silero_vad.onnx"
DESTINATION = Path(__file__).parents[1] / "backend" / "models" / "silero_vad.onnx"


def main():
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    temporary = DESTINATION.with_suffix(".onnx.part")
    with urlopen(URL, timeout=60) as response, temporary.open("wb") as output:
        output.write(response.read())
    temporary.replace(DESTINATION)
    print(f"Installed Silero VAD: {DESTINATION}")


if __name__ == "__main__":
    main()
