// Minimal GPT-2 byte-level BPE tokenizer (same algorithm as OpenAI's encoder.py / HF GPT2Tokenizer).
// Needs vocab.json and merges.txt from the GPT-2 tokenizer.
(function () {
  function bytesToUnicode() {
    const bs = [];
    for (let i = "!".charCodeAt(0); i <= "~".charCodeAt(0); i++) bs.push(i);
    for (let i = "¡".charCodeAt(0); i <= "¬".charCodeAt(0); i++) bs.push(i);
    for (let i = "®".charCodeAt(0); i <= "ÿ".charCodeAt(0); i++) bs.push(i);
    const cs = bs.slice();
    let n = 0;
    for (let b = 0; b < 256; b++) {
      if (!bs.includes(b)) { bs.push(b); cs.push(256 + n); n++; }
    }
    const m = {};
    bs.forEach((b, i) => { m[b] = String.fromCharCode(cs[i]); });
    return m;
  }

  class GPT2Tokenizer {
    constructor(vocab, mergesText) {
      this.encoder = vocab;
      this.decoder = {};
      for (const k in vocab) this.decoder[vocab[k]] = k;
      this.byteEncoder = bytesToUnicode();
      const lines = mergesText.split("\n").filter(l => l && !l.startsWith("#version"));
      this.bpeRanks = new Map();
      lines.forEach((l, i) => { this.bpeRanks.set(l.trim(), i); });
      this.cache = new Map();
      this.pat = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;
      this.textEncoder = new TextEncoder();
    }
    static async load(dir) {
      const [vocab, merges] = await Promise.all([
        fetch(dir + "vocab.json").then(r => r.json()),
        fetch(dir + "merges.txt").then(r => r.text()),
      ]);
      return new GPT2Tokenizer(vocab, merges);
    }
    bpe(token) {
      if (this.cache.has(token)) return this.cache.get(token);
      let word = Array.from(token);
      if (word.length < 2) { this.cache.set(token, token); return token; }
      const getPairs = w => { const p = new Set(); for (let i = 0; i < w.length - 1; i++) p.add(w[i] + " " + w[i + 1]); return p; };
      let pairs = getPairs(word);
      while (true) {
        let best = null, bestRank = Infinity;
        for (const p of pairs) { const r = this.bpeRanks.get(p); if (r !== undefined && r < bestRank) { bestRank = r; best = p; } }
        if (best === null) break;
        const [first, second] = best.split(" ");
        const out = [];
        let i = 0;
        while (i < word.length) {
          const j = word.indexOf(first, i);
          if (j === -1) { out.push(...word.slice(i)); break; }
          out.push(...word.slice(i, j)); i = j;
          if (word[i] === first && i < word.length - 1 && word[i + 1] === second) { out.push(first + second); i += 2; }
          else { out.push(word[i]); i += 1; }
        }
        word = out;
        if (word.length === 1) break;
        pairs = getPairs(word);
      }
      const res = word.join(" ");
      this.cache.set(token, res);
      return res;
    }
    // returns {ids, tokens} where tokens are the byte-level token strings (word starts begin with "Ġ")
    encode(text) {
      const ids = [], tokens = [];
      for (const m of text.matchAll(this.pat)) {
        const bytes = this.textEncoder.encode(m[0]);
        let s = "";
        for (const b of bytes) s += this.byteEncoder[b];
        for (const t of this.bpe(s).split(" ")) {
          const id = this.encoder[t];
          if (id === undefined) continue;
          ids.push(id); tokens.push(t);
        }
      }
      return { ids, tokens };
    }
  }
  window.GPT2Tokenizer = GPT2Tokenizer;
})();
