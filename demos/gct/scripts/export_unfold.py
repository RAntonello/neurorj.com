"""Export matching inflated/flat UTS03 surfaces and its existing functional RSC ROI.

Run with the original demo's pycortex environment:
    python scripts/export_unfold.py /path/to/pycortex-db/UTS03
The source surfaces and overlay are read without modification.
"""
import argparse
import gzip
import hashlib
import json
import struct
from pathlib import Path

import numpy as np
from cortex.database import Database

parser = argparse.ArgumentParser()
parser.add_argument('subject_directory', type=Path)
args = parser.parse_args()
subject = args.subject_directory.resolve()
out = Path(__file__).resolve().parents[1]
db = Database(str(subject.parent))
flat, faces = db.get_surf(subject.name, 'flat', merge=True, nudge=True)
flat = flat.copy()
left, right = db.get_surf(subject.name, 'inflated', merge=False)
n_left = len(left[0])
n = len(flat)
raw = gzip.decompress((out / 'brain-surface.bin.gz').read_bytes())
assert struct.unpack_from('<4I', raw)[1] == n

# The SVG and flat vertices are mapped by pycortex itself, using the same
# hemisphere nudging and SVG coordinate convention as the original flatmap.
overlay = db.get_overlay(subject.name, modify_svg_file=False)
roi_indices = np.unique(overlay.rois.get_mask('RSC'))
valid = np.zeros(n, bool)
valid[np.unique(faces)] = True
roi = np.zeros(n, np.uint8)
roi[roi_indices] = 1
roi[~valid] = 0
assert roi[:n_left].sum() > 0 and roi[n_left:].sum() > 0

inflated = []
for i, (points, _) in enumerate([left, right]):
    points = points.copy()
    points[:, 0] -= points[:, 0].max() + 8 if i == 0 else points[:, 0].min() - 8
    inflated.append(points[:, [0, 2, 1]] * np.array([1, 1, -1]) * .72)
inflated = np.vstack(inflated)
inflated -= (inflated.min(0) + inflated.max(0)) / 2

# Open a small gap at the midline; retain the original flatmap's shape and axes.
flat[:n_left, 0] -= 10
flat[n_left:, 0] += 10
flat[:, 2] = 0
minimum, maximum = flat[valid].min(0), flat[valid].max(0)
flat = (flat - (minimum + maximum) / 2) * (300 / (maximum[0] - minimum[0]))
flat[~valid] = 0
centers = [flat[np.flatnonzero(roi[:n_left])].mean(0),
           flat[np.flatnonzero(roi[n_left:]) + n_left].mean(0)]
payload = struct.pack('<4I', 0x47435455, n, faces.size, n_left)
payload += inflated.astype('<f4').tobytes() + flat.astype('<f4').tobytes() + roi.tobytes()
payload += b'\0' * (-len(payload) % 4)
payload += faces.astype('<u4').tobytes()
with gzip.GzipFile(filename=str(out / 'brain-unfold.bin.gz'), mode='wb', mtime=0) as f:
    f.write(payload)

source_files = ['overlays.svg'] + [f'surfaces/{kind}_{hemi}.gii'
    for kind in ['flat', 'inflated'] for hemi in ['lh', 'rh']]
metadata = {
    'subject': subject.name,
    'source': 'OpenNeuro ds003020, derivatives/pycortex-db/UTS03',
    'roi': 'RSC functional ROI from the subject overlays.svg; not a cytoarchitectonic atlas label',
    'vertices': n, 'flatTriangles': len(faces), 'leftVertices': n_left,
    'roiVertexCounts': [int(roi[:n_left].sum()), int(roi[n_left:].sum())],
    'flatRscCenters': [center.tolist() for center in centers],
    'flatSize': (flat[valid].max(0) - flat[valid].min(0)).tolist(),
    'sourceSha256': {name: hashlib.sha256((subject / name).read_bytes()).hexdigest() for name in source_files},
}
(out / 'brain-unfold.json').write_text(json.dumps(metadata, indent=2) + '\n')
print('Vertices:', n, 'RSC vertices:', metadata['roiVertexCounts'],
      'asset bytes:', (out / 'brain-unfold.bin.gz').stat().st_size)
