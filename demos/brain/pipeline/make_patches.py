"""Build flatmap patches for UTS03: cluster flat-surface vertices into K patches, map voxels -> patches,
and render (a) a patch-index raster, (b) curvature underlay, (c) ROI outline overlay."""
import os, numpy as np, cortex, json
from cortex import quickflat
from scipy.cluster.vq import kmeans2
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image
np.random.seed(0)
SUBJ, XFM, K, H = "UTS03", "UTS03_auto", 800, 1024
out = "patches"; os.makedirs(out, exist_ok=True)

# flat surface vertex coords, both hemispheres concatenated (pycortex convention)
(lpts, lpolys), (rpts, rpolys) = cortex.db.get_surf(SUBJ, "flat", merge=False)
pts = np.vstack([lpts, rpts])[:, :2]
nL = len(lpts)
print("flat vertices:", len(pts), "left:", nL)

# k-means per hemisphere, K/2 each, on flat xy
labels = np.full(len(pts), -1, dtype=np.int32)
cent_all = []
for hemi, (sl, off) in enumerate([(slice(0, nL), 0), (slice(nL, None), K // 2)]):
    c, lab = kmeans2(pts[sl].astype(np.float64), K // 2, minit="++", seed=hemi)
    labels[sl] = lab + off
    cent_all.append(c)
cent = np.vstack(cent_all)
# drop empty clusters by relabeling densely
uniq, labels = np.unique(labels, return_inverse=True)
K_eff = len(uniq); cent = cent[uniq]
print("patches:", K_eff)
np.save(os.path.join(out, "vertex_labels.npy"), labels)

# voxel -> vertex mapping using pycortex nearest mapper (vertex values from voxel values)
mask = cortex.db.get_mask(SUBJ, XFM, "thick")
mapper = cortex.get_mapper(SUBJ, XFM, "nearest")
# For each voxel in the thick mask, assign a patch: map a volume of voxel indices to vertices (nearest), then
# collect which vertices each voxel lands on and take the majority patch. Do it by mapping one-hot-ish index volume.
nvox = int(mask.sum())
idxvol = np.full(mask.shape, -1, dtype=np.float32)
idxvol[mask] = np.arange(nvox)
vol = cortex.Volume(idxvol, SUBJ, XFM)
vidx = mapper(vol)  # VertexData with values per vertex (nearest voxel index)
vvals = np.concatenate([vidx.left, vidx.right]).astype(np.int64)
# vertex -> voxel index; build voxel -> list of patches
from collections import defaultdict, Counter
vox_patches = defaultdict(Counter)
good = vvals >= 0
for v_i, vox in zip(np.where(good)[0], vvals[good]):
    vox_patches[int(vox)][int(labels[v_i])] += 1
vox2patch = np.full(nvox, -1, dtype=np.int32)
for vox, cnt in vox_patches.items():
    vox2patch[vox] = cnt.most_common(1)[0][0]
print("voxels with a patch:", int((vox2patch >= 0).sum()), "of", nvox)
np.save(os.path.join(out, "vox2patch.npy"), vox2patch)

# render patch index raster via quickflat: make a Vertex with patch ids, sample to flatmap image (nearest)
vert = cortex.Vertex(labels.astype(np.float32), SUBJ)
img, extents = quickflat.make_flatmap_image(vert, height=H, recache=False, sampler="nearest")
print("flatmap image shape:", img.shape, "extents:", extents)
# img is masked array (HxW), nan outside; encode index as 16-bit in R,G (little endian), B=255 where valid
arr = np.ma.filled(img, np.nan)
valid = ~np.isnan(arr)
idx = np.where(valid, arr, 0).astype(np.uint16)
rgb = np.zeros(arr.shape + (3,), dtype=np.uint8)
rgb[..., 0] = idx & 0xFF; rgb[..., 1] = (idx >> 8) & 0xFF; rgb[..., 2] = valid.astype(np.uint8) * 255
Image.fromarray(rgb).save(os.path.join(out, "patch_index.png"))

# curvature underlay (grayscale) and ROI outlines with labels, same extents/size
curv = cortex.db.get_surfinfo(SUBJ, "curvature")
cimg, _ = quickflat.make_flatmap_image(curv, height=H, recache=False)
carr = np.ma.filled(cimg, np.nan)
g = np.where(np.isnan(carr), np.nan, np.clip(-carr, -1, 1))  # sulci dark
gray = np.where(np.isnan(g), 0, (0.5 + 0.18 * g) * 255).astype(np.uint8)
alpha = (~np.isnan(g)).astype(np.uint8) * 255
Image.fromarray(np.dstack([gray, gray, gray, alpha])).save(os.path.join(out, "curvature.png"))

# ROI outlines + labels rendered by pycortex on a transparent figure
fig = quickflat.make_figure(cortex.Vertex(np.full(len(pts), np.nan), SUBJ), with_curvature=False, with_colorbar=False,
                            with_rois=True, with_labels=True, linewidth=3, labelsize=24, height=H, fig=plt.figure(figsize=(img.shape[1]/100, img.shape[0]/100), dpi=100))
plt.axis("off"); fig.subplots_adjust(0, 0, 1, 1)
fig.savefig(os.path.join(out, "rois.png"), transparent=True, dpi=100)
json.dump({"K": int(K_eff), "height": int(arr.shape[0]), "width": int(arr.shape[1])}, open(os.path.join(out, "meta.json"), "w"))
print("done")
