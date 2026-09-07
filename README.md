# neurorj.com

Plain HTML, no build step. Layout follows williamhoza.com.

- `index.html` is the homepage.
- `research/index.html` is the paper list. Each paper is one `<li>`: linked title, authors paragraph, italic venue paragraph.
- `demos/index.html` lists demos. `demos/brain/` is the in-browser GPT-2 encoding model demo: `demo.js` (page logic), `tokenizer.js` (GPT-2 BPE), `gpt2_layer8_int8.onnx` (model), `weights.bin` (patch ridge weights + normalization), `patch_index.png`/`curvature.png`/`rois.png` (flatmap layers from pycortex, subject UTS03).
- `main.css` is the only stylesheet.
- `CNAME` makes GitHub Pages serve at neurorj.com. Do not delete it.

Push to `main` to deploy.
