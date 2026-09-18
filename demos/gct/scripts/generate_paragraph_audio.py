"""Generate the travel paragraph narration with Kokoro 0.9.4 (CPU).

Run in the same Python environment as generate_audio.py; ffmpeg is required.
The transcript comes from the page so controls or a second copy cannot drift.
"""

from html.parser import HTMLParser
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import subprocess

import numpy as np
import soundfile as sf
import torch
from kokoro import KPipeline


ROOT = Path(__file__).resolve().parents[1]
VOICE = "af_heart"
SPEED = 0.96
SAMPLE_RATE = 24000


class ParagraphParser(HTMLParser):
    def __init__(self, target_id):
        super().__init__()
        self.target_id = target_id
        self.depth = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if self.depth:
            self.depth += 1
        elif tag == "p" and dict(attrs).get("id") == self.target_id:
            self.depth = 1

    def handle_endtag(self, tag):
        if self.depth:
            self.depth -= 1

    def handle_data(self, data):
        if self.depth:
            self.parts.append(data)


def transcript():
    html = (ROOT / "index.html").read_text()
    for target_id in ("generation-text", "generation-output"):
        parser = ParagraphParser(target_id)
        parser.feed(html)
        text = " ".join("".join(parser.parts).split())
        if text:
            return text
    raise ValueError("The travel paragraph was not found in index.html")


def main():
    text = transcript()
    torch.set_num_threads(4)
    torch.manual_seed(0)
    pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", device="cpu")
    chunks = [result.audio.numpy() for result in pipeline(text, voice=VOICE, speed=SPEED)]
    wave = np.concatenate(chunks)
    peak = float(np.max(np.abs(wave)))
    if not np.isfinite(wave).all() or peak >= 1:
        raise ValueError(f"Invalid or clipped narration: peak={peak}")
    output = ROOT / "audio" / "travel-paragraph.mp3"
    output.parent.mkdir(exist_ok=True)
    with TemporaryDirectory(prefix="gct-paragraph-") as directory:
        wav = Path(directory) / "travel-paragraph.wav"
        sf.write(wav, wave, SAMPLE_RATE)
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
            "-codec:a", "libmp3lame", "-b:a", "96k", str(output),
        ], check=True)
    print(json.dumps({
        "src": str(output.relative_to(ROOT)), "text": text, "voice": VOICE,
        "speed": SPEED, "duration": round(len(wave) / SAMPLE_RATE, 4),
        "peak_dbfs": round(20 * np.log10(peak), 2),
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
