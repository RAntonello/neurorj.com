"""Export spatial interpolation weights by diffusion over cortical topology."""
from pathlib import Path
import gzip, struct
import numpy as np
from scipy import sparse

root = Path(__file__).resolve().parents[1]
raw = gzip.decompress((root / 'brain-surface.bin.gz').read_bytes())
magic, n, ni, patches = struct.unpack_from('<4I', raw)
assert magic == 0x47435433
pos = np.frombuffer(raw, '<f4', n*3, 16).reshape(-1, 3)
faces = np.frombuffer(raw, '<u4', ni, 16+n*12).reshape(-1, 3)
labels = np.frombuffer(raw, '<u2', n, 16+n*12+ni*4)
edges = np.vstack([faces[:,[0,1]], faces[:,[1,2]], faces[:,[2,0]]])
a, b = edges.T
# Use only adjacent vertices, keeping opposite sulcal banks and hemispheres apart.
length = np.linalg.norm(pos[a]-pos[b], axis=1).clip(.2)
adj = sparse.coo_matrix((1/length, (a,b)), shape=(n,n)).tocsr()
adj = adj + adj.T
row = np.asarray(adj.sum(axis=1)).ravel()
adj = sparse.diags(1 / row.clip(1e-8)) @ adj
weights = sparse.csr_matrix((np.ones(n, np.float32), (np.arange(n), labels)), shape=(n,801))
for step in range(80):
    weights = .5 * weights + .5 * (adj @ weights)
    # Tiny contributions are immaterial to visualization; pruning bounds memory.
    weights.data[weights.data < .0005] = 0
    weights.eliminate_zeros()
    if step % 20 == 0: print('Diffusion',step,'entries',weights.nnz,flush=True)
# Retain the four strongest neighboring patch contributions per vertex.
ids = np.full((n,4),800,dtype='<u2')
values = np.zeros((n,4),dtype=np.float32)
mass = []
for i in range(n):
    start,end = weights.indptr[i:i+2]
    v, ix = weights.data[start:end], weights.indices[start:end]
    chosen = np.argsort(v)[-4:][::-1]
    if labels[i] == 800:
        values[i,0] = 1
    else:
        ids[i,:len(chosen)] = ix[chosen]
        values[i,:len(chosen)] = v[chosen] / v[chosen].sum()
        mass.append(v[chosen].sum()/v.sum())
packed = np.rint(values*65535).astype('<u2')
payload = struct.pack('<4I',0x47435453,n,4,80)+ids.tobytes()+packed.tobytes()
with gzip.GzipFile(filename=str(root/'surface-blend.bin.gz'),mode='wb',mtime=0) as f: f.write(payload)
print('Mean retained kernel mass:',np.mean(mass),'size:',(root/'surface-blend.bin.gz').stat().st_size,flush=True)
