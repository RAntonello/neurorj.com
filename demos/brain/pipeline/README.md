# Pipeline for the in-browser encoding model demo

Scripts that produced the files in `demos/brain/`. Data is not included.

Inputs (from the scaling-laws Box folder, https://utexas.box.com/v/EncodingModelScalingLaws):
`story_data/wordseqs.jbl`, `story_data/ridge_utils.zip`, `responses/full_responses/UTS03_responses.jbl` (26.6 GB).
Subject surface: `derivatives/pycortex-db/UTS03` from OpenNeuro ds003020.

Order:
1. `make_patches.py` — k-means the UTS03 flatmap into 800 patches; writes `patch_index.png`, `curvature.png`, `rois.png`, `vertex_labels.npy`.
2. `extract_features.py` — GPT-2 small hidden states (layers 6-9) per word with the tutorial's 256-512 word context scheme, Lanczos-downsampled to TRs with `DataSequence.chunksums`.
3. `fit_ridge.py L` — tutorial hyperparameters (trim 50/5, 4 FIR delays, alphas logspace(1,4,15), 3 boots, chunklen 20), `bootstrap_ridge` from ridge_utils; reduces voxel weights (summed over delays) to patches; writes `weights_layer{L}.bin`.
4. `sentence_stats2.py L` (supersedes `sentence_stats.py`) — normalization for sentence-level input: mean/std of the browser-style feature over ~1500 story chunks, and per-patch prediction std; rewrites `weights_layer{L}.bin`.
5. `export_gpt2.py L out/` — GPT-2 truncated at layer L (final LayerNorm removed) to ONNX, int8 per-channel dynamic quantization.
6. `reference_check.py L "text"` — Python replica of the browser computation for sanity checks.

`weights.bin` layout (float32 little-endian): W[K*768], mean[768], std[768], predstd[K], corr[K], then the same mean/std/predstd for 6-word trailing windows (timeline view); K=800.
Layer 8 held-out (wheretheressmoke) voxel correlation: mean 0.076, 23,493 voxels above 0.2.
Python envs: torch CPU + transformers + onnx + onnxruntime; pycortex needs a Python with headers.
