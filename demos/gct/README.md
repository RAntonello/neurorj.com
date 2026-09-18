# GCT opening storyboard

Twelve frameless panels on white introduce the encoding model, a draggable
language playground, the difficulty of understanding black boxes, retrosplenial
cortex (RSC), feeding many text snippets into a model, and ranking its predicted
RSC responses, the location pattern among the top snippets, and an LLM explanation. A single
horizontal model diagram stays fixed through the first two panels while the
surrounding copy and word cloud crossfade. On the third panel, its input, arrows,
and playback controls fade out while the box and rotatable brain remain visible.
During the transition to the fourth panel, the same brain inflates and unfolds
into its matching cortical flatmap, with RSC highlighted in both hemispheres.
The box moves left to make room for the wider map. On the fifth panel, the
flatmap fades out, the box moves right, and a denser cloud feeds snippets into
it. On the sixth panel, the heading crossfades and these same snippets move into
a numbered list, ordered by predicted RSC response. Higher predictions are
redder and lower predictions bluer. On the seventh panel, the heading fades to
“All of the top snippets mention locations,” with “locations” italicized. Fine
underlines draw from left to right beneath the place words in the 14 location
snippets; the ranked list and box stay in place. Scrolling backward retracts
the underlines. Reduced-motion mode shows them without the drawing animation.
These word annotations are editorial, not model feature-attribution scores.
On the eighth panel, the lower-ranked snippets and encoding-model box fade away.
The same top ten snippets expand into inputs to a separately labeled LLM, shown
as three offset mesh layers with fine nodes and connections. The prompt “What
do these text snippets have in common?” feeds into the network from above via
a straight downward arrow. Signals travel down that prompt arrow and continue
from the network along the entire output arrow to the explanation. Soft highlights
on their place words and pulses through the connections and layers illustrate
recognizing the shared pattern. The output is “Travel and location names,” the
initial RSC explanation from [Fig. 2a of the paper](https://arxiv.org/html/2410.00812v3#S4).
The output itself links to that source. This is a storyboard of the explanation
step, not a live LLM call or a replay of measured attention. It presents the
paper's published explanation alongside the demo's own top-ten examples; the
published pipeline used a larger corpus and multiple candidate explanations.
It uses the initial RSC explanation, before the later contrast against PPA/OPA
refined it to “Location names.” The ten inputs are selected by their saved RSC
scores. Scrolling back restores the full list, colors, and underlines.
On mobile the explanation sits below the input/model diagram. Reduced-motion
mode removes the traveling pulses and word highlights. The network is a schematic
SVG, distinct from the encoding model's black box, with a straight output connector.
On the ninth panel, the snippets, LLM, prompt, and connectors fade away while the
same explanation moves to the middle of the screen. The new heading introduces
automatically generated candidate explanations. The explanation remains visible
and linked to its source throughout this transition; scrolling back restores the
diagram. Reduced-motion mode changes its position directly.
On the tenth panel, that same monospace explanation moves left to become the
input to an LLM. The prompt “Generate paragraphs with this input as the theme.”
feeds in from above, and a short travel paragraph appears at the output. Signals
continue through the input, prompt, network, and output connections. The paragraph
is an illustrative example written for this tutorial, not a stimulus from the
published study or a live generation call. On mobile it appears below the model.
The paragraph has compact Listen/Pause, mute, and seek controls. Its narration
has a faint underline beneath the phrase currently being spoken, aligned to the
existing word timestamps. Pausing holds the underline, seeking updates it, and
finishing playback or leaving the paragraph clears it. Inline spans preserve the
original transcript and line wrapping; reduced motion removes the underline fade.
If timing data cannot load, the paragraph and audio still work normally. Narration
continues into the feedback panel, pauses when leaving the paragraph or hiding
the tab, and shares the earlier demo's mute preference. It starts only on user
request. The feedback brain shows the encoding model's prediction for this exact
paragraph, synchronized with the narration; no experimental response is implied.
The heading introduces generating driving stimuli to test *in vivo*. Scrolling
back restores the centered explanation and earlier diagram; reduced-motion mode
changes positions directly and disables the pulses.
On the eleventh panel, the explanation and the same paragraph form a feedback
loop with a rotatable 3D brain. The LLM and prompt fade away, the paragraph moves
to the middle, and the return arrow links a measured response back to evaluation
of the explanation. Sequential pulses illustrate stimulus generation, delivery,
and feedback. Mobile uses a compact triangular layout. The brain shows the left
hemisphere from its medial side, interpolated 35% toward the matching inflated
surface to expose RSC within its sulcus. The functional mask and vertex
correspondence are unchanged. Independent positions, normals, and indices
preserve the earlier brain's anatomy and unfolding topology. The return arrow
reads “Evaluate *in vivo* response.”
RSC remains marked by a thin charcoal contour with a white halo, independent of
the response colors inside it. The contour follows the existing functional mask
and the surface depth test, so it rotates with the brain. A persistent RSC callout
identifies the region. This preview uses a model prediction, not the experimental
response that the feedback loop proposes to test.
The initial map is the whole-paragraph prediction. Playback and seeking show its
word-level predictions, using the audio clock and the earlier demo's smoothing.
Pause freezes the map; replay restarts it. Reduced motion keeps the whole-paragraph
map static and disables traveling pulses. Leaving the panel stops rendering.
The final panel fades out the full feedback diagram before revealing the user's
closing statement, the paper title, all eight authors, equal-contribution and
joint-supervision credits, its citation, and the original black-box image.
The centered composition fades in without moving. The heading names Generative
Causal Testing, and the title links to [the paper](https://arxiv.org/abs/2410.00812). Bibliographic details and
authorship notes follow the June 13, 2026 manuscript (v3). The citation says
“Nature Neuroscience (accepted, 2026),” matching the arXiv acceptance notice and
[the authors' announcement](https://www.microsoft.com/en-us/research/blog/understanding-the-brain-with-ai-driven-explanations-and-experiments/),
verified September 17, 2026; no unverified journal volume, pages, or DOI are given.
The final black box also links to the paper, with “Click the box to read the paper”
beneath it. There is no separate arXiv citation link. On hover or keyboard focus, its
front face slowly swings a few degrees outward around its left edge, revealing
a narrow white light that spills onto the stationary right side. `paper-box.js`
reuses the photograph in SVG layers, preserving the original closed appearance.
The motion reverses smoothly, stops rendering when settled or hidden, and becomes
instant with reduced motion enabled. Touch opens the paper directly. No additional
3D software, generated images, or animation downloads are required.
Scrolling backward restores the feedback diagram and its interaction.
Audio remains paused after leaving the playground.
After 30 seconds of visible time on any panel except the last, a subtle
“Scroll down” button fades in. Changing panels resets the timer; scrolling
dismisses a visible hint, and time in a hidden tab does not count. Clicking the
hint advances the storyboard, including the opening description. On small screens
the opening hint uses its empty cloud space if the lower text leaves no room.
Scrolling also reveals the opening description. The first two panels use the
same brain canvas, preserving its rotation and response across the transition. Serve the
site root and open `/demos/gct/`; there is no build step.

The worked example for the following GCT methodology is retrosplenial cortex.

## RSC snippet corpus

The fifth panel has 48 illustrative snippets in `index.html`, including 14
location-related phrases. Each has a stable `data-corpus-id` and `data-topic`
(`location` or `everyday`) for reuse in the following RSC steps. Mobile layouts
show 32 snippets, or 28 on the narrowest screens; all 14 location snippets remain
visible. These topic labels describe the text, not measured RSC selectivity.

The cloud slowly drifts while several phrases at a time travel into the box.
The animation illustrates presenting model inputs; inference is precomputed.
Source snippets remain in the corpus after being fed. Scrolling to the ranking
stops the drift and moves the original elements into score order; scrolling back
restores their cloud positions. Desktop displays one numbered list in two columns
(read down the first, then the second). Mobile keeps the same responsive subset
in a single column and retains each snippet's rank among all 48. Very short
viewports allow the completed list to scroll. Reduced-motion mode shows a static
cloud with an arrow into the model, then changes directly to the ranked layout.
The preceding ten audio snippets and predictions remain separate from this set.

### RSC ranking predictions

`corpus-predictions.json` contains all 48 snippets' whole-snippet predictions from
the unchanged GPT-2 layer 8 encoding demo, plus their RSC scores. The features
are the mean of word-final hidden states with the original whole-text
normalization. Predictions are for UTS03, not observed responses from the GCT
driving experiments. Topic labels do not determine the ranking.

Each score averages unsmoothed patch predictions within the bilateral functional
RSC mask shown on panel four. Vertices are weighted by their pial surface area
(one third of each incident triangle's area); patches below the original 0.1
held-out correlation threshold are excluded. Five reliable patches cover 730
of the ROI's 1,516 vertices, or 48.8% of its area. The score is therefore a coarse
model estimate over the reliable portion of RSC. Zero is the encoding demo's
standardized feature baseline, not a measurement of neural suppression.

The color scale is neutral gray at zero, red toward the largest positive score,
and blue toward the most negative score, with each branch scaled independently.
The 48 predictions include 20 positive and 28 negative scores. Scores are exposed
in snippet tooltips and accessible labels; the page orders them from highest to
lowest without adding explanatory copy to the storyboard.

Recompute with `GCT_CDP_PORT=9223 node demos/gct/scripts/score_corpus.cjs` from the
site root, with Node.js and `ws` installed, the preview server on port 8877, and
a local Chrome debugging endpoint. The script uses the original browser inference
code and records model, weights, anatomy, and ROI hashes, ROI coverage and weights,
all 800 patch outputs per snippet, and the computed RSC scores. Display smoothing
does not enter this calculation.

## Playback

A compact frameless color key beneath the interactive brain labels blue as
“Less activation” and red as “More activation.” It appears only on the second
panel, with space reserved around the playback controls and instruction.

Ten original conversational transcripts live in `snippets.json`. Selecting a
snippet plays its local MP3 and animates the corresponding model prediction.
The sentence beside the model has a play button and updates to the selected
snippet. A single HTML audio element owns the playback clock: pause, seek,
replay, and buffering apply to both sound and animation. Playback continues
between the first two panels and pauses when entering the black-box panel.
The speaker button mutes sound while the animation keeps
playing. Nothing plays automatically on page load.

The word cloud moves freely at a few pixels per second, with boundary reflection
and gentle collision separation. Hovered and keyboard-focused snippets hold
still for selection. Snippets support dragging, click, keyboard, and mobile tap.
The brain supports mouse/touch rotation, arrow keys, and Home to reset its view.
Reduced-motion mode keeps the cloud and whole-snippet brain map still while
allowing audio playback.

## Prediction provenance

`predictions.json` contains outputs from the existing `/demos/brain/` demo,
recomputed for all ten transcripts on September 17, 2026. These are model
predictions for UTS03, not observed responses or data from the GCT driving
experiments. The model and regression weights were not retrained.

The original demo's `window.__state.words`, `wordVals`, and `wholeVals` were
saved, with predictions rounded to four decimals and held-out reliability
correlations from `__dbg.corr` rounded to five.

- GPT-2, layer 8: `../brain/gpt2_layer8_int8.onnx`
- Encoding weights and normalizations: `../brain/weights.bin`
- Original inference/feature code: `../brain/demo.js`, `../brain/tokenizer.js`
- 800 cortical patches, minimum held-out correlation 0.1
- Each word frame averages the preceding six word-final hidden states, or fewer
  at the beginning, using the original demo's window normalization.
- Whole-snippet predictions use its whole-snippet normalization.

Precomputation avoids downloading the 97 MB language model to play these fixed
examples. Each transcript is matched to its own predictions and spoken words.

## Display smoothing

`surface-blend.bin.gz` contains a four-patch interpolation kernel at each vertex.
`scripts/smooth_surface.py` constructs it from the cortical mesh using 80 steps
of diffusion (half the current value, half an inverse-edge-length-weighted
neighbor average). This follows surface topology rather than spatial proximity,
so it does not jump across opposing sulcal banks or between hemispheres. The
four retained contributions preserve 99.36% of kernel mass on average and are
renormalized. Medial-wall vertices stay neutral.

The renderer excludes unreliable patch predictions before smoothing. Signed
response values are blended before applying the continuous blue/white/orange
color scale; spatial feathering can extend into neighboring unreliable patches.
This removes the hard parcel boundaries without modifying the saved predictions.

Temporal interpolation uses a Gaussian kernel (sigma 0.34 seconds) over frames
at the spoken word centers, sampled from `audio.currentTime` on animation frames.
A 0.65-second onset fade starts each playback smoothly. This is display smoothing
for the tutorial, not an estimate of neural or hemodynamic response timing.

The interpolation asset's little-endian format is four uint32 header values
(magic `0x47435453`, vertex count, four retained contributions, diffusion steps),
then four uint16 patch IDs per vertex and four normalized uint16 weights per
vertex. Rebuild it with Python, NumPy, and SciPy using
`python scripts/smooth_surface.py` from this directory.

## Audio

`audio/*.mp3` was generated locally using
[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) with the
[Kokoro 0.9.4 inference library](https://github.com/hexgrad/kokoro), voices
`af_heart` and `am_fenrir`, at speed 0.96. ElevenLabs was not connected in this
environment. No browser speech-synthesis service or API key is needed at runtime.

`scripts/generate_audio.py` regenerates the ten snippet MP3s and `audio/timings.json` from
`snippets.json`. It requires Kokoro 0.9.4, PyTorch, NumPy, SoundFile, and FFmpeg.
Kokoro's predicted phoneme durations supply the word timestamps, with contraction
and punctuation tokens reassembled against the original whitespace-delimited
transcript. The script asserts that every spoken word matches that transcript.
Audio is generated at 24 kHz and encoded as 96 kbps MP3. Kokoro code and model
weights use Apache 2.0; these are synthetic voices and original demo transcripts.

`scripts/generate_paragraph_audio.py` regenerates `audio/travel-paragraph.mp3`
directly from `#generation-text` in the page, with `af_heart` at the same speed and
encoding settings. This 14.2-second narration is separate from the ten snippet
predictions and timings. Its corresponding `paragraph-prediction.json` contains
precomputed outputs of the same UTS03 GPT-2 layer 8 encoding model, with word
centers aligned to the narration in `audio/travel-paragraph.json`. The source
paragraph retains “São”; model input transliterates it to “Sao” before the demo's
ASCII word normalization, preserving one spoken word per model frame. The exact
input and preprocessing are recorded with the prediction. These are model predictions, not measured
responses from the paper. `paragraph-response.js` applies the same reliability
mask, temporal interpolation, and onset fade as the earlier examples; the shared
brain renderer supplies surface smoothing. Audio alignment is for the tutorial's
playback and does not simulate the hemodynamic delay of an fMRI measurement.
After generating the audio timestamps, regenerate the prediction with
`GCT_CDP_PORT=9223 node demos/gct/scripts/predict_paragraph.cjs` from the site root,
using the same preview server and inference browser as the corpus script. The
export records source hashes and unsmoothed area-weighted RSC scores for auditing;
these scores do not alter the brain colors or the existing display scale.

## 3D anatomy

`brain-surface.bin.gz` contains UTS03's left and right pial surfaces from the
original demo's pycortex database (`surfaces/pia_lh.gii`, `pia_rh.gii`), with
321,587 vertices and 643,166 triangles. Original topology and vertex order are
preserved. Coordinates are centered and rotated from RAS to display axes
`[x, z, -y]`. Curvature from `surface-info/curvature.npz` supplies neutral shading.
The original `patches/vertex_labels.npy` maps vertices to the 800 modeled patches;
vertices excluded from the flat surfaces receive neutral label 800.

The gzip payload is little-endian: four uint32 header values (magic `0x47435433`,
vertex count, index count, modeled patch count), float32 xyz positions, uint32
triangle indices, uint16 patch labels, four-byte alignment padding, and float32
curvature shades. Source vertex-label SHA-256:
`59136e359b5310bc3578f83cb7ebd7680a4073898ff74939bd518a63f65578ef`.

`brain3d.js` uses locally vendored Three.js 0.169.0 and OrbitControls (MIT license
in `vendor/THREE-LICENSE.txt`). Rendering requires WebGL and `DecompressionStream`.
Fonts have system fallbacks.

### Unfolding and RSC

`brain-unfold.bin.gz` adds the same UTS03 subject's inflated and flat surfaces,
with the original vertex correspondence. The morph first inflates the pial
surface, then opens it into the flat surface. The flat surface's cut topology
is used during unfolding; restoring the folded view restores its original
triangles and the viewer's previous camera orientation. Vertex normals are
interpolated along with the surface, and prediction colors give way to neutral
curvature and the RSC highlight. Reduced-motion mode changes directly between
the 3D and flat views.

RSC comes from the `RSC` layer in UTS03's original `overlays.svg`, mapped to
surface vertices with pycortex's overlay tools. It contains 626 left-hemisphere
and 890 right-hemisphere vertices. This is the subject's existing functional
ROI, rather than a cytoarchitectonic atlas boundary or a region drawn for this
tutorial. The source SVG and surfaces are read without modification.

`scripts/export_unfold.py /path/to/pycortex-db/UTS03` regenerates the asset using
NumPy and pycortex. `brain-unfold.json` records the source hashes, counts, flatmap
extent, and RSC centroids used for the callout. The binary contains a four-uint32
header (magic `0x47435455`, vertex count, flat index count, left vertex count),
float32 inflated xyz positions, float32 flat xyz positions, uint8 ROI membership,
four-byte alignment padding, and uint32 flat triangle indices.

## Box asset

The final webpage asset is `assets/black-box.webp`; `assets/black-box.png` retains
the original generated image. Generated with the built-in imagegen tool, then
resized and encoded to WebP for the page. This is a conceptual illustration.

Generation prompt:

> Use case: product-mockup. Create a square website asset: a natural studio photograph of one plain small matte black cube, like a solid block of black-dyed wood, standing on a seamless pure white surface against pure white (#ffffff). This represents an abstract black-box model in an elegant neuroscience tutorial. The cube should occupy about 72% of the image width and height, centered, seen slightly from above, front face dominant with a narrow right side visible. Soft large-window light, believable fine matte texture and softly worn edges, subtle contact shadow close to the base. Restrained photographic realism, natural material, no dramatic effects. No electronics, LEDs, buttons, holes, seams, labels, symbols, text, decorative patterns, surrounding objects, borders or watermarks. The white at every image edge must be pure white so the asset sits seamlessly on a white webpage.
