"""Reference: replicate the browser computation in Python (HF GPT-2 fp32 and the int8 ONNX) for a sentence, print patch values."""
import sys, json, numpy as np, torch, onnxruntime as ort
from transformers import AutoTokenizer, GPT2Model
L = int(sys.argv[1]); text = sys.argv[2]
meta = json.load(open(f"patches/summary_layer{L}.json")); K, D = meta["K"], meta["D"]
f = np.fromfile(f"patches/weights_layer{L}.bin", dtype="<f4"); o = 0
Wp = f[o:o+K*D].reshape(K, D); o += K*D; mean = f[o:o+D]; o += D; std = f[o:o+D]; o += D; predstd = f[o:o+K]; o += K; corr = f[o:o+K]
tok = AutoTokenizer.from_pretrained("gpt2"); m = GPT2Model.from_pretrained("gpt2", attn_implementation="eager").eval()
enc = tok(text)["input_ids"]; toks = tok.convert_ids_to_tokens(enc)
ids = [50256] + enc
with torch.no_grad(): h = m(input_ids=torch.tensor([ids]), output_hidden_states=True).hidden_states[L][0].numpy()
sess = ort.InferenceSession(f"export/gpt2_layer{L}_int8.onnx", providers=["CPUExecutionProvider"])
h8 = sess.run(None, {"input_ids": np.array([ids], dtype=np.int64)})[0][0]
def feat(hs):
    acc = np.zeros(D); n = 0
    for t in range(len(enc)):
        last = t == len(enc) - 1; nxt = None if last else toks[t+1]
        if not (last or nxt.startswith("Ġ") or nxt.startswith("Ċ")): continue
        if toks[t].strip() == "" or toks[t] == "Ċ": continue
        acc += hs[t+1]; n += 1
    return acc / n, n
for name, hs in (("fp32", h), ("int8", h8)):
    fv, n = feat(hs); z = (fv - mean) / std; vals = (Wp @ z) / predstd
    ok = corr >= 0.1
    print(f"{name}: words={n} vals[ok] mean={vals[ok].mean():+.3f} std={vals[ok].std():.3f} max={vals[ok].max():+.2f} min={vals[ok].min():+.2f}")
    if name == "fp32": v32 = vals
    else: print("int8 vs fp32 corr over predictable patches:", np.corrcoef(v32[ok], vals[ok])[0,1].round(4))
