"""Normalization stats for the demo, two feature types computed exactly as the browser does:
  whole-text: mean of layer-L hidden states over all word-final tokens of a chunk (8-60 words)
  windowed:   mean over the trailing WIN word-final tokens, at every word position >= WIN-1
Writes weights_layer{L}.bin: W[K*D], mean[D], std[D], predstd[K], corr[K], mean_w[D], std_w[D], predstd_w[K]"""
import sys, numpy as np, torch, joblib, time
sys.path.insert(0, "data2")
from transformers import AutoTokenizer, GPT2Model
L = int(sys.argv[1]); K, D, WIN = 800, 768, 6
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
rng.shuffle(chunks); chunks = chunks[:1500]
def word_final_states(text):
    enc = tok(text)["input_ids"]; toks = tok.convert_ids_to_tokens(enc); ids = [50256] + enc
    with torch.no_grad(): h = m(input_ids=torch.tensor([ids]), output_hidden_states=True).hidden_states[L][0].numpy()
    out = []
    for t in range(len(enc)):
        last = t == len(enc) - 1; nxt = None if last else toks[t+1]
        if not (last or nxt.startswith("Ġ") or nxt.startswith("Ċ")): continue
        if toks[t].strip() == "" or toks[t] == "Ċ": continue
        out.append(h[t+1])
    return np.array(out)
t0 = time.time(); F, Fw = [], []
for i, c in enumerate(chunks):
    S_ = word_final_states(c)
    if len(S_) == 0: continue
    F.append(S_.mean(0))
    cs = np.cumsum(np.vstack([np.zeros((1, D)), S_]), 0)
    for p in range(WIN - 1, len(S_), 3):          # every 3rd position to keep it manageable
        Fw.append((cs[p+1] - cs[p+1-WIN]) / WIN)
    if i % 300 == 0: print(i, f"{time.time()-t0:.0f}s", flush=True)
F, Fw = np.array(F), np.array(Fw); print("whole", F.shape, "windowed", Fw.shape)
f = np.fromfile(f"patches/weights_layer{L}.bin", dtype="<f4"); o = 0
Wp = f[o:o+K*D].reshape(K, D); o += K*D; o += 2*D; o += K; corr = f[o:o+K]
def stats(X):
    mu, sd = X.mean(0), X.std(0) + 1e-6
    P = ((X - mu) / sd) @ Wp.T
    return mu.astype("<f4"), sd.astype("<f4"), (P.std(0) + 1e-6).astype("<f4")
mean_s, std_s, predstd_s = stats(F); mean_w, std_w, predstd_w = stats(Fw)
print("predstd whole median", np.median(predstd_s), "windowed median", np.median(predstd_w))
with open(f"patches/weights_layer{L}.bin", "wb") as fh:
    for arr in (Wp.ravel(), mean_s, std_s, predstd_s, corr.astype("<f4"), mean_w, std_w, predstd_w):
        fh.write(np.ascontiguousarray(arr, dtype="<f4").tobytes())
print("rewrote weights", f"{time.time()-t0:.0f}s")
