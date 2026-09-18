"""Generate travel paragraph narration and word timings with Kokoro 0.9.4 (CPU).

Run in the same Python environment as generate_audio.py; ffmpeg is required.
The transcript comes from the page so controls or a second copy cannot drift.
Writes audio/travel-paragraph.json; refuses to overwrite a nonidentical MP3.
"""

from html.parser import HTMLParser
from pathlib import Path
from tempfile import TemporaryDirectory
import hashlib
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
    chunks, tokens, offset = [], [], 0.0
    for result in pipeline(text, voice=VOICE, speed=SPEED):
        chunk = result.audio.numpy()
        for token in result.tokens:
            tokens.append({
                "text": token.text, "space": token.whitespace,
                "start": None if token.start_ts is None else round(offset + token.start_ts, 4),
                "end": None if token.end_ts is None else round(offset + token.end_ts, 4),
            })
        chunks.append(chunk)
        offset += len(chunk) / SAMPLE_RATE
    words, pending = [], []
    for index, token in enumerate(tokens):
        pending.append(token)
        if token["space"] or index == len(tokens) - 1:
            voiced = [part for part in pending if part["start"] is not None]
            if not voiced:
                raise ValueError(f"No speech timing for {pending}")
            words.append({
                "word": "".join(part["text"] for part in pending),
                "start": min(part["start"] for part in voiced),
                "end": max(part["end"] for part in voiced),
            })
            pending = []
    if [word["word"] for word in words] != text.split():
        raise ValueError("Speech timing tokens do not match the original paragraph")
    wave = np.concatenate(chunks)
    peak = float(np.max(np.abs(wave)))
    if not np.isfinite(wave).all() or peak >= 1:
        raise ValueError(f"Invalid or clipped narration: peak={peak}")
    output = ROOT / "audio" / "travel-paragraph.mp3"
    output.parent.mkdir(exist_ok=True)
    with TemporaryDirectory(prefix="gct-paragraph-") as directory:
        wav = Path(directory) / "travel-paragraph.wav"
        sf.write(wav, wave, SAMPLE_RATE)
        mp3 = wav.with_suffix(".mp3")
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
            "-codec:a", "libmp3lame", "-b:a", "96k", str(mp3),
        ], check=True)
        generated = mp3.read_bytes()
        if output.exists() and output.read_bytes() != generated:
            raise ValueError("Regenerated audio differs; retain existing MP3 until narration is reviewed")
        output.write_bytes(generated)
    metadata = {
        "src": str(output.relative_to(ROOT)), "text": text, "voice": VOICE,
        "speed": SPEED, "duration": round(len(wave) / SAMPLE_RATE, 4),
        "sampleRate": SAMPLE_RATE,
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "timingSource": "Kokoro 0.9.4 predicted phoneme durations, reassembled into original spoken words",
        "words": words,
    }
    output.with_suffix(".json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({
        **{key: value for key, value in metadata.items() if key != "words"},
        "wordCount": len(words),
        "peak_dbfs": round(20 * np.log10(peak), 2),
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
