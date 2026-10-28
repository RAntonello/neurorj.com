"""Fit voxelwise ridge encoding models from GPT-2 features, following the scaling-laws tutorial, then reduce to flatmap patches."""
import sys, os, time, json, numpy as np, joblib, logging
sys.path.insert(0, "data2")
os.environ.setdefault("XDG_CONFIG_HOME", os.path.abspath("cfg"))
from ridge_utils.ridge import bootstrap_ridge
import ridge_utils.npp as npp
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
LAYER = int(sys.argv[1])
train_stories = ['adollshouse', 'adventuresinsayingyes', 'alternateithicatom', 'avatar', 'buck', 'exorcism',
            'eyespy', 'fromboyhoodtofatherhood', 'hangtime', 'haveyoumethimyet', 'howtodraw', 'inamoment',
            'itsabox', 'legacy', 'naked', 'odetostepfather', 'sloth',
            'souls', 'stagefright', 'swimmingwithastronauts', 'thatthingonmyarm', 'theclosetthatateeverything',
            'tildeath', 'undertheinfluence']
test_stories = ["wheretheressmoke"]
trim_start, trim_end = 50, 5
ndelays = 4; delays = range(1, ndelays + 1)
def make_delayed(stim, delays):
    nt, nd = stim.shape; out = []
    for d in delays:
        ds = np.zeros((nt, nd)); ds[d:] = stim[:-d]; out.append(ds)
    return np.hstack(out)

t0 = time.time()
feats = joblib.load(f"feats_gpt2_layer{LAYER}.jbl")
Rstim = np.nan_to_num(np.vstack([npp.zs(feats[s][10:-5]) for s in train_stories]))
Pstim = np.nan_to_num(np.vstack([npp.zs(feats[s][trim_start:-trim_end]) for s in test_stories]))
# global feature statistics (over training TRs, before z-scoring) for use at demo time
raw_train = np.vstack([feats[s][10:-5] for s in train_stories])
feat_mean, feat_std = raw_train.mean(0), raw_train.std(0) + 1e-8
delRstim, delPstim = make_delayed(Rstim, delays), make_delayed(Pstim, delays)
print("stim:", delRstim.shape, delPstim.shape, f"{time.time()-t0:.0f}s", flush=True)
resp = joblib.load("data/UTS03_responses.jbl")
Rresp = np.vstack([resp[s] for s in train_stories]).astype(np.float32)
Presp = np.vstack([resp[s][40:] for s in test_stories]).astype(np.float32)
del resp
print("resp:", Rresp.shape, Presp.shape, f"{time.time()-t0:.0f}s", flush=True)
assert len(Rresp) == len(delRstim) and len(Presp) == len(delPstim), (Rresp.shape, delRstim.shape, Presp.shape, delPstim.shape)
alphas = np.logspace(1, 4, 15); nboots = 3; chunklen = 20; nchunks = int(len(Rresp) * 0.25 / chunklen)
wt, corr, valphas, bscorrs, valinds = bootstrap_ridge(delRstim, Rresp, delPstim, Presp, alphas, nboots, chunklen, nchunks,
                                                       use_corr=False, single_alpha=False)
corr = np.nan_to_num(corr)
print(f"layer {LAYER}: test corr mean {corr.mean():.4f}, median {np.median(corr):.4f}, top-1% {np.percentile(corr,99):.3f}, n>0.2: {(corr>0.2).sum()}, {time.time()-t0:.0f}s", flush=True)
joblib.dump({"wt": wt.astype(np.float32), "corr": corr.astype(np.float32), "valphas": valphas, "feat_mean": feat_mean, "feat_std": feat_std},
            f"ridge_gpt2_layer{LAYER}.jbl", compress=3)

# ---- reduce to flatmap patches: patch value = mean over the patch's flat vertices of the nearest-voxel value ----
import cortex
from PIL import Image
labels_img = np.array(Image.open("patches/patch_index.png"))
K = int(json.load(open("patches/meta.json"))["K"])
mask = cortex.db.get_mask("UTS03", "UTS03_auto", "thick")
mapper = cortex.get_mapper("UTS03", "UTS03_auto", "nearest")
nvox = int(mask.sum())
idxvol = np.full(mask.shape, -1, dtype=np.float32); idxvol[mask] = np.arange(nvox)
vidx = mapper(cortex.Volume(idxvol, "UTS03", "UTS03_auto"))
vvals = np.concatenate([vidx.left, vidx.right]).astype(np.int64)
(lpts, _), (rpts, _) = cortex.db.get_surf("UTS03", "flat", merge=False)
# vertex -> patch labels: recompute exactly as in make_patches (same seed) by loading saved labels if present
lab = np.load("patches/vertex_labels.npy") if os.path.exists("patches/vertex_labels.npy") else None
assert lab is not None, "run make_patches.py with label saving first"
good = vvals >= 0
A = np.zeros((K, nvox), dtype=np.float32)           # averaging matrix patch x voxel
np.add.at(A, (lab[good], vvals[good]), 1.0)
cnt = A.sum(1, keepdims=True); A = A / np.maximum(cnt, 1)
W_delay_sum = wt.reshape(ndelays, 768, nvox).sum(0)  # sustained-stimulus weights: sum over FIR delays -> (768, nvox)
Wp = (A @ W_delay_sum.T).astype(np.float32)          # (K, 768)
corr_p = (A @ corr).astype(np.float32)               # mean held-out corr per patch
# typical predicted response size per patch: std over training TRs of the patch prediction using z-scored (non-delayed) features
pred_train = Rstim @ Wp.T                            # (T, K)
predstd = pred_train.std(0).astype(np.float32) + 1e-6
np.save(f"patches/patch_weights_layer{LAYER}.npy", Wp)
with open(f"patches/weights_layer{LAYER}.bin", "wb") as f:
    for arr in (Wp.ravel(), feat_mean.astype(np.float32), feat_std.astype(np.float32), predstd, corr_p):
        f.write(np.ascontiguousarray(arr, dtype="<f4").tobytes())
json.dump({"K": K, "D": 768, "layer": LAYER, "corr_patch_mean": float(corr_p.mean()), "corr_patch_max": float(corr_p.max()),
           "n_patches_r_gt_0.1": int((corr_p > 0.1).sum()), "voxel_corr_mean": float(corr.mean())}, open(f"patches/summary_layer{LAYER}.json", "w"), indent=1)
print("patch summary:", open(f"patches/summary_layer{LAYER}.json").read(), f"{time.time()-t0:.0f}s")
