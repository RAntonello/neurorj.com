# Language-to-brain demo

The demo pairs editable text and eight saved examples with a rotatable 3D cortex. Examples work before GPT-2 loads. The interface uses the GCT tutorial's typography, white background, continuous response colors, and cortical surface.

## Loading and files

- `demo.js` manages examples, custom text, playback, and the display clock; `demo.css` styles the page.
- `examples.json` contains eight original example sentences, their normalized words, 141 word-level frames, eight whole-text predictions, and held-out correlations for all 800 patches.
- `inference-client.js` creates `inference-worker.js` only when custom text needs a prediction. The worker loads the existing tokenizer, encoding weights, and approximately 97 MB GPT-2 model, then retains its session for subsequent requests. Loading and inference run outside the interface thread. Text stays in the browser; the pinned ONNX Runtime files load from jsDelivr.
- `brain-view.js` reuses `../gct/brain-surface.bin.gz`, `../gct/surface-blend.bin.gz`, and the tutorial's vendored Three.js and OrbitControls. Unfolding assets load only on the first **Unfold** action; **Fold** restores the previous 3D orientation. Both views show the same prediction colors, without an ROI highlight. Keep these shared tutorial assets available when moving the demo.

## Predictions and display

The scientific computation is unchanged: GPT-2 layer 8, the existing 800-patch encoding weights, lowercase text with punctuation removed, the training context-start token, and a maximum of 1,000 retained tokens. Features use word-final hidden states. Whole-text predictions average all word-final states; timeline predictions average the trailing six words. Each retains its original feature and response normalization. Inference uses ONNX Runtime Web 1.29.0 with the WASM provider; this quantized graph produces incorrect results with WebGPU.

Playback advances at 0.35 seconds per word. A Gaussian temporal kernel with a 0.34-second standard deviation blends the signed timeline predictions before coloring. The 3D viewer uses the GCT tutorial's interpolation across cortical patches. Both are display operations; stored predictions and encoding weights remain unchanged. Patches below the existing held-out correlation threshold (`r < 0.1`) remain neutral.

Drag or use arrow keys to rotate the brain; Home resets the view. Automatic rotation pauses after interaction and stops offscreen, in hidden tabs, or with reduced motion enabled.

## Rebuilding saved examples

`examples.json` records SHA-256 hashes of the model, weights, metadata, tokenizer assets, and generation script, plus the original implementation's reference hash. Predictions are stored to seven decimal places; correlations retain their exact Float32 values. All 119,200 saved response values were checked against the original browser demo, with a maximum rounding difference of `5e-8`.

With Node 18 or newer, the `ws` package, and Chrome available, run from the repository root:

```sh
google-chrome --remote-debugging-port=9223 --user-data-dir=/tmp/brain-example-export
node demos/brain/pipeline/precompute_examples.cjs --port=9223
```

The script uses its own browser tab and temporary local server, closing both afterward. `--output=/path/examples.json` selects an alternate output. It reads the model assets already in this directory. See [pipeline/README.md](pipeline/README.md) for the original training and export pipeline.

## Local preview

Serve the repository root so the shared tutorial assets resolve:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/demos/brain/` in a current browser with WebGL and `DecompressionStream` support. No build step is required.
