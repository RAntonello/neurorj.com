"""Export the brain demo's encoding weights for the black-box panel.

Run from the repository root:
    python demos/gct/scripts/export_weights.py
Each weight is divided by its patch's prediction scale, as the demo does when it
predicts, so every patch row is shown in the same units. Values are stored as
16-bit integers with one shared scale; the reconstruction error is below 3e-6.
"""
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np

out = Path(__file__).resolve().parents[1]
source = out.parent / 'brain'
meta = json.loads((source / 'meta.json').read_text())
K, D = meta['K'], meta['D']
raw = np.fromfile(source / 'weights.bin', dtype='<f4')
assert raw.size in (K * D + 2 * D + 2 * K, K * D + 4 * D + 3 * K)
weights = raw[:K * D].reshape(K, D).astype(np.float64)
predstd = raw[K * D + 2 * D:K * D + 2 * D + K].astype(np.float64)
assert (predstd > 0).all()
effective = weights / predstd[:, None]

scale = np.abs(effective).max() / 32767
quantized = np.round(effective / scale).astype('<i2')
error = np.abs(quantized * scale - effective).max()
assert error <= scale / 2 + 1e-12
with gzip.GzipFile(filename=str(out / 'encoding-weights.bin.gz'), mode='wb', mtime=0) as f:
    f.write(quantized.tobytes())

metadata = {
    'rows': K, 'columns': D,
    'layout': 'int16 little-endian, row-major; value = stored * scale',
    'scale': scale,
    'maxAbsoluteError': error,
    'rowsAre': 'cortical patches of the brain demo encoding model',
    'columnsAre': f'GPT-2 layer {meta["layer"]} features',
    'values': 'ridge weight divided by the patch prediction scale, as applied by the demo',
    'absolutePercentiles': {str(q): float(np.percentile(np.abs(effective), q)) for q in (50, 90, 99)},
    'sourceSha256': {name: hashlib.sha256((source / name).read_bytes()).hexdigest()
                     for name in ('weights.bin', 'meta.json')},
}
(out / 'encoding-weights.json').write_text(json.dumps(metadata, indent=2) + '\n')
print('Weights:', K * D, 'max error: %.2g' % error,
      'asset bytes:', (out / 'encoding-weights.bin.gz').stat().st_size)
