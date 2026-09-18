"""Generate fixed speech clips and word timings with Kokoro 0.9.4 (CPU)."""
from pathlib import Path
import json, re, subprocess
import numpy as np
import soundfile as sf
import torch
from kokoro import KPipeline

ROOT = Path(__file__).resolve().parents[1]
torch.set_num_threads(4)
pipeline = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M', device='cpu')
manifest = {}
for s in json.loads((ROOT / 'snippets.json').read_text()):
    waves, tokens, offset = [], [], 0.0
    for result in pipeline(s['text'], voice=s['voice'], speed=.96):
        wave = result.audio.numpy()
        for token in result.tokens:
            tokens.append({'text': token.text, 'space': token.whitespace,
                           'start': None if token.start_ts is None else round(offset + token.start_ts, 4),
                           'end': None if token.end_ts is None else round(offset + token.end_ts, 4)})
        waves.append(wave)
        offset += len(wave) / 24000
    # The model tokenizer and TTS both use the original transcript. Reassemble
    # Kokoro's punctuation/contraction tokens into its whitespace-delimited words.
    words, pending = [], []
    for token in tokens:
        pending.append(token)
        if token['space']:
            voiced = [t for t in pending if t['start'] is not None]
            words.append({'word': ''.join(t['text'] for t in pending),
                          'start': min(t['start'] for t in voiced),
                          'end': max(t['end'] for t in voiced)})
            pending = []
    if pending:
        voiced = [t for t in pending if t['start'] is not None]
        words.append({'word': ''.join(t['text'] for t in pending),
                      'start': min(t['start'] for t in voiced),
                      'end': max(t['end'] for t in voiced)})
    assert [w['word'] for w in words] == s['text'].split(), (s['id'], words)
    wave = np.concatenate(waves)
    path = ROOT / 'audio' / (s['id'] + '.wav')
    sf.write(path, wave, 24000)
    mp3 = path.with_suffix('.mp3')
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(path),
                    '-codec:a', 'libmp3lame', '-b:a', '96k', str(mp3)], check=True)
    path.unlink()
    manifest[s['id']] = {'src': 'audio/' + mp3.name, 'duration': round(len(wave) / 24000, 4),
                         'voice': s['voice'], 'words': words}
    (ROOT / 'audio' / 'timings.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(s['id'], len(words), 'words;', round(len(wave)/24000, 2), 'seconds', flush=True)
