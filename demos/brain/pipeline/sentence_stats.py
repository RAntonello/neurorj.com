"""Sentence-level normalization for the demo: compute the layer-L feature exactly as the browser does
(BOS + tokens, mean over word-final tokens) for ~2000 chunks of 8-60 words drawn from the training stories,
then rewrite weights_layer{L}.bin with mean/std over chunks and predstd = std of the patch predictions over chunks."""
import sys, json, numpy as np, torch, joblib, time
from transformers import AutoTokenizer, GPT2Model
sys.path.insert(0, "data2")
L = int(sys.argv[1]); K, D = 800, 768
rng = np.random.RandomState(0)
train_stories = ['adollshouse', 'adventuresinsayingyes', 'alternateithicatom', 'avatar', 'buck', 'exorcism',
            'eyespy', 'fromboyhoodtofatherhood', 'hangtime', 'haveyoumethimyet', 'howtodraw', 'inamoment',
            'itsabox', 'legacy', 'naked', 'odetostepfather', 'sloth',
            'souls', 'stagefright', 'swimmingwithastronauts', 'thatthingonmyarm', 'theclosetthatateeverything',
            'tildeath', 'undertheinfluence']
ws = joblib.load("data2/wordseqs.jbl")
tok = AutoTokenizer.from_pretrained("gpt2"); m = GPT2Model.from_pretrained("gpt2", attn_implementation="eager").eval()
torch.set_num_threads(4)
chunks = []
for s in train_stories:
    words = [w for w in ws[s].data if w.strip() and not w.startswith("{")]
    i = 0
    while i < len(words):
        n = int(rng.randint(8, 61)); chunks.append(" ".join(words[i:i+n])); i += n
rng.shuffle(chunks); chunks = chunks[:2000]
print("chunks:", len(chunks))
def browser_feature(text):
    enc = tok(text)["input_ids"]; toks = tok.convert_ids_to_tokens(enc); ids = [50256] + enc
    with torch.no_grad(): h = m(input_ids=torch.tensor([ids]), output_hidden_states=True).hidden_states[L][0].numpy()
    acc = np.zeros(D); n = 0
    for t in range(len(enc)):
        last = t == len(enc) - 1; nxt = None if last else toks[t+1]
        if not (last or nxt.startswith("Ġ") or nxt.startswith("Ċ")): continue
        if toks[t].strip() == "" or toks[t] == "Ċ": continue
        acc += h[t+1]; n += 1
    return acc / max(n, 1)
t0 = time.time()
F = np.stack([browser_feature(c) for c in chunks]); print("features", F.shape, f"{time.time()-t0:.0f}s")
f = np.fromfile(f"patches/weights_layer{L}.bin", dtype="<f4"); o = 0
Wp = f[o:o+K*D].reshape(K, D); o += K*D; o += 2*D; o += K; corr = f[o:o+K]
mean_s, std_s = F.mean(0), F.std(0) + 1e-6
Z = (F - mean_s) / std_s
P = Z @ Wp.T                          # (chunks, K)
predstd_s = P.std(0) + 1e-6
print("pred std over chunks: median", np.median(predstd_s), "  mean |pred| for r>0.1 patches:", np.abs(P[:, corr > 0.1]).mean())
np.savez(f"patches/sentence_stats_layer{L}.npz", mean=mean_s, std=std_s, predstd=predstd_s, F=F)
with open(f"patches/weights_layer{L}.bin", "wb") as fh:
    for arr in (Wp.ravel(), mean_s, std_s, predstd_s, corr):
        fh.write(np.ascontiguousarray(arr, dtype="<f4").tobytes())
print("rewrote", f"patches/weights_layer{L}.bin")
