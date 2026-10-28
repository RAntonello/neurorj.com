"""Export GPT-2 small truncated at layer L to ONNX (int8), outputting that layer's hidden states.
Hidden state index convention matches HF output_hidden_states: index 0 = embeddings, index L = output of block L.
"""
import sys, os, torch, numpy as np
from transformers import AutoTokenizer, GPT2Model
L = int(sys.argv[1]); out = sys.argv[2]
os.makedirs(out, exist_ok=True)
tok = AutoTokenizer.from_pretrained("gpt2")
tok.save_pretrained(os.path.join(out, "tokenizer"))
m = GPT2Model.from_pretrained("gpt2", attn_implementation="eager").eval()
m.h = m.h[:L]                      # keep blocks 1..L
m.ln_f = torch.nn.Identity()       # HF applies ln_f to the last entry of hidden_states; we want the raw residual stream
class Trunc(torch.nn.Module):
    def __init__(s, m): super().__init__(); s.m = m
    def forward(s, input_ids):
        # skip the final ln_f: we want the raw residual stream after block L, as in output_hidden_states[L]
        hs = s.m(input_ids=input_ids, output_hidden_states=True).hidden_states
        return hs[L]
net = Trunc(m)
ids = torch.tensor([[464, 3290, 318, 257, 1332]])
with torch.no_grad():
    ref = net(ids)
    full = GPT2Model.from_pretrained("gpt2", attn_implementation="eager").eval()
    ref_full = full(input_ids=ids, output_hidden_states=True).hidden_states[L]
print("truncated vs full max abs diff:", (ref - ref_full).abs().max().item())
fp32 = os.path.join(out, f"gpt2_layer{L}_fp32.onnx")
torch.onnx.export(net, (ids,), fp32, input_names=["input_ids"], output_names=["hidden"],
                  dynamic_axes={"input_ids": {0: "batch", 1: "seq"}, "hidden": {0: "batch", 1: "seq"}},
                  opset_version=17, dynamo=False)
from onnxruntime.quantization import quantize_dynamic, QuantType
q = os.path.join(out, f"gpt2_layer{L}_int8.onnx")
quantize_dynamic(fp32, q, weight_type=QuantType.QInt8, per_channel=True, reduce_range=False)
import onnxruntime as ort
ids2 = tok("When I was a kid my father took me to see the ocean for the first time, and I remember the smell of salt.", return_tensors="pt").input_ids
with torch.no_grad(): ref2 = net(ids2).numpy()
for path in (fp32, q):
    sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    o = sess.run(None, {"input_ids": ids2.numpy().astype(np.int64)})[0]
    a, b = o[0], ref2[0]
    za = (a - a.mean(0)) / (a.std(0) + 1e-6); zb = (b - b.mean(0)) / (b.std(0) + 1e-6)
    print(os.path.basename(path), f"{os.path.getsize(path)/1e6:.1f} MB", "raw corr:", round(float(np.corrcoef(a.ravel(), b.ravel())[0,1]),5), "zscored-per-dim corr:", round(float(np.corrcoef(za.ravel(), zb.ravel())[0,1]),5))
