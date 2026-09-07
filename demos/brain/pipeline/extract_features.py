"""GPT-2 small word-level features for the scaling-laws tutorial stories, following the tutorial's context scheme:
each word gets the hidden state of its last token, computed with a causal context of the preceding 256..512 words,
with a start token prepended; one forward pass per 256-word block. Then Lanczos-downsampled to TRs via DataSequence.chunksums.
"""
import sys, os, time, numpy as np, torch, joblib
sys.path.insert(0, "data2")
from transformers import AutoTokenizer, GPT2Model
from ridge_utils.DataSequence import DataSequence
LAYERS = [6, 7, 8, 9]
LOOK1, LOOK2 = 256, 512
train_stories = ['adollshouse', 'adventuresinsayingyes', 'alternateithicatom', 'avatar', 'buck', 'exorcism',
            'eyespy', 'fromboyhoodtofatherhood', 'hangtime', 'haveyoumethimyet', 'howtodraw', 'inamoment',
            'itsabox', 'legacy', 'naked', 'odetostepfather', 'sloth',
            'souls', 'stagefright', 'swimmingwithastronauts', 'thatthingonmyarm', 'theclosetthatateeverything',
            'tildeath', 'undertheinfluence']
test_stories = ["wheretheressmoke"]
tok = AutoTokenizer.from_pretrained("gpt2")
model = GPT2Model.from_pretrained("gpt2", attn_implementation="eager").eval()
torch.set_num_threads(max(1, os.cpu_count() - 2))
BOS = tok.eos_token_id  # 50256, GPT-2's only special token; used as the context start token
ws = joblib.load("data2/wordseqs.jbl")
out = {L: {} for L in LAYERS}
t0 = time.time()
for story in train_stories + test_stories:
    ds = ws[story]
    words = list(ds.data)
    # per-word token groups: tokenize each non-empty word with a leading space (GPT-2 marks word starts with a space)
    groups = []
    for w in words:
        if w.strip() == "":
            groups.append([])           # empty word: no tokens, reuses previous word's feature (as in the tutorial)
        else:
            groups.append(tok(" " + w.strip(), add_special_tokens=False)["input_ids"])
    n = len(words)
    feats = {L: np.zeros((n, 768), dtype=np.float32) for L in LAYERS}
    # walk blocks: context start s is fixed while the lookback grows from LOOK1 to LOOK2
    start = 0
    i = 0
    passes = 0
    while i < n:
        # words that share context start `start`: from i up to (start + LOOK2), exclusive of nothing
        end = min(n, start + LOOK2 + 1)     # words start..end-1 are computed in one pass
        toks, wordend = [BOS], []
        for j in range(start, end):
            toks.extend(groups[j]); wordend.append(len(toks) - 1)
        if len(toks) > 1024:                 # GPT-2 context limit; drop earliest tokens if needed (never triggers in practice)
            cut = len(toks) - 1024; toks = [BOS] + toks[1 + cut:]; wordend = [max(0, e - cut) for e in wordend]
        with torch.no_grad():
            hs = model(input_ids=torch.tensor([toks]), output_hidden_states=True).hidden_states
        passes += 1
        for L in LAYERS:
            h = hs[L][0].numpy()
            for k, j in enumerate(range(start, end)):
                if j < i: continue
                e = wordend[k]
                feats[L][j] = h[e] if e > 0 else 0.0
        i = end
        start = max(0, end - LOOK1)          # next block: lookback resets to LOOK1
    for L in LAYERS:
        out[L][story] = DataSequence(feats[L], ds.split_inds, ds.data_times, ds.tr_times).chunksums('lanczos', window=3)
    print(f"{story}: {n} words, {passes} passes, TR feats {out[LAYERS[0]][story].shape}, {time.time()-t0:.0f}s", flush=True)
for L in LAYERS:
    joblib.dump(out[L], f"feats_gpt2_layer{L}.jbl")
print("done", time.time() - t0)
