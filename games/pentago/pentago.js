(function () {
  const $ = id => document.getElementById(id);
  const PREFIX = "neurorj-pentago-";
  const CELL = 70, GAP = 20, MARGIN = 40;
  const QORIGIN = [[MARGIN, MARGIN], [MARGIN + 3 * CELL + GAP, MARGIN], [MARGIN, MARGIN + 3 * CELL + GAP], [MARGIN + 3 * CELL + GAP, MARGIN + 3 * CELL + GAP]];
  const NAMES = { 1: "Black", 2: "White" };

  // ---------------- game logic ----------------
  function newState() {
    return { board: new Array(36).fill(0), turn: 1, phase: "place", pending: -1, winner: 0, lines: [], moves: 0 };
  }
  const idx = (r, c) => r * 6 + c;
  function quadOf(i) { const r = Math.floor(i / 6), c = i % 6; return (r >= 3 ? 2 : 0) + (c >= 3 ? 1 : 0); }
  function rotateQuad(board, q, dir) {
    const r0 = q >= 2 ? 3 : 0, c0 = q % 2 ? 3 : 0;
    const old = [];
    for (let rr = 0; rr < 3; rr++) { old.push([]); for (let cc = 0; cc < 3; cc++) old[rr].push(board[idx(r0 + rr, c0 + cc)]); }
    for (let rr = 0; rr < 3; rr++) for (let cc = 0; cc < 3; cc++)
      board[idx(r0 + rr, c0 + cc)] = dir === "cw" ? old[2 - cc][rr] : old[cc][2 - rr];
  }
  function findLines(board) {
    // returns {1: Set of cells in black lines, 2: Set for white}
    const res = { 1: new Set(), 2: new Set() };
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
      const p = board[idx(r, c)]; if (!p) continue;
      for (const [dr, dc] of dirs) {
        const cells = [];
        for (let k = 0; k < 5; k++) {
          const rr = r + dr * k, cc = c + dc * k;
          if (rr < 0 || rr > 5 || cc < 0 || cc > 5 || board[idx(rr, cc)] !== p) break;
          cells.push(idx(rr, cc));
        }
        if (cells.length === 5) cells.forEach(i => res[p].add(i));
      }
    }
    return res;
  }
  function settle(s) {
    const L = findLines(s.board);
    const b = L[1].size > 0, w = L[2].size > 0;
    if (b && w) { s.winner = 3; s.lines = [...L[1], ...L[2]]; }
    else if (b) { s.winner = 1; s.lines = [...L[1]]; }
    else if (w) { s.winner = 2; s.lines = [...L[2]]; }
    else if (!s.board.includes(0)) { s.winner = 3; s.lines = []; }
    if (s.winner) s.phase = "over";
  }
  function applyPlace(s, i, player) {
    if (s.phase !== "place" || s.turn !== player || s.board[i] !== 0) return false;
    s.board[i] = player; s.pending = i; s.moves++;
    // five in a row on placement wins without rotating
    const L = findLines(s.board);
    if (L[player].size > 0) { s.winner = player; s.lines = [...L[player]]; s.phase = "over"; return true; }
    s.phase = "rotate";
    return true;
  }
  function applyRotate(s, q, dir, player) {
    if (s.phase !== "rotate" || s.turn !== player || q < 0 || q > 3 || (dir !== "cw" && dir !== "ccw")) return false;
    rotateQuad(s.board, q, dir);
    s.pending = -1; s.phase = "place"; s.turn = 3 - s.turn;
    settle(s);
    return true;
  }

  // ---------------- rendering ----------------
  const svg = $("board");
  const NS = "http://www.w3.org/2000/svg";
  const el = (name, attrs, parent) => { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; };
  let quadG = [], cellEls = [], stoneEls = [], arrowEls = [];
  function buildBoard() {
    svg.innerHTML = ""; quadG = []; cellEls = []; stoneEls = []; arrowEls = [];
    for (let q = 0; q < 4; q++) {
      const [ox, oy] = QORIGIN[q];
      const g = el("g", { class: "quad", style: `transform-origin: ${ox + 1.5 * CELL}px ${oy + 1.5 * CELL}px;` });
      quadG.push(g);
      el("rect", { x: ox - 4, y: oy - 4, width: 3 * CELL + 8, height: 3 * CELL + 8, rx: 10, fill: "#e9e6de" }, g);
      for (let rr = 0; rr < 3; rr++) for (let cc = 0; cc < 3; cc++) {
        const r = (q >= 2 ? 3 : 0) + rr, c = (q % 2 ? 3 : 0) + cc, i = idx(r, c);
        const cx = ox + cc * CELL + CELL / 2, cy = oy + rr * CELL + CELL / 2;
        const cell = el("circle", { class: "cell", cx, cy, r: CELL / 2 - 6 }, g);
        cell.addEventListener("click", () => onCell(i));
        cellEls[i] = cell;
        stoneEls[i] = el("circle", { class: "stone", cx, cy, r: CELL / 2 - 12, visibility: "hidden" }, g);
      }
      // rotation buttons on the outer horizontal edge of each block
      const ay = q < 2 ? oy - 22 : oy + 3 * CELL + 22;
      const mk = (dir, ax, glyph) => {
        const circ = el("circle", { class: "arrow", cx: ax, cy: ay, r: 15 });
        const t = el("text", { class: "arrowtxt", x: ax, y: ay + 6, "text-anchor": "middle" }); t.textContent = glyph;
        circ.addEventListener("click", () => onRotate(q, dir));
        arrowEls.push({ circ, t });
      };
      mk("ccw", ox + 1.5 * CELL - 24, "↺");
      mk("cw", ox + 1.5 * CELL + 24, "↻");
    }
  }
  function render() {
    const s = G.state;
    for (let i = 0; i < 36; i++) {
      const v = s.board[i];
      stoneEls[i].setAttribute("visibility", v ? "visible" : "hidden");
      stoneEls[i].setAttribute("class", "stone " + (v === 1 ? "b" : "w") + (i === s.pending ? " pending" : "") + (s.lines.includes(i) ? " line" : ""));
      cellEls[i].setAttribute("class", "cell" + (v === 0 && myTurn() && s.phase === "place" ? " free" : ""));
    }
    const showArrows = myTurn() && s.phase === "rotate";
    arrowEls.forEach(a => { a.circ.setAttribute("class", "arrow" + (showArrows ? "" : " off")); a.t.setAttribute("class", "arrowtxt" + (showArrows ? "" : " off")); });
    // side panel
    let who;
    if (G.mode === "local") who = "Two players on this computer.";
    else who = `You are ${NAMES[G.me]}.`;
    $("players").textContent = who;
    if (s.winner === 3) $("hint").innerHTML = '<span class="win">Draw.</span>';
    else if (s.winner) $("hint").innerHTML = `<span class="win">${NAMES[s.winner]} wins${G.mode !== "local" ? (s.winner === G.me ? " — that's you!" : ".") : "."}</span>`;
    else if (myTurn()) $("hint").innerHTML = `<span class="turn-me">${G.mode === "local" ? NAMES[s.turn] + "'s turn" : "Your turn"}:</span> ${s.phase === "place" ? "place a marble." : "rotate a block."}`;
    else $("hint").innerHTML = `<span class="turn-them">${NAMES[s.turn]}'s turn.</span> Waiting…`;
    $("rematch").hidden = !(s.winner && (G.mode === "local" || G.mode === "host"));
  }
  function animateRotate(q, dir, then) {
    const g = quadG[q];
    g.style.transition = "transform 0.45s ease";
    g.style.transform = `rotate(${dir === "cw" ? 90 : -90}deg)`;
    setTimeout(() => { g.style.transition = "none"; g.style.transform = "none"; then(); }, 460);
  }

  // ---------------- game controller ----------------
  const G = { mode: null, me: 0, state: newState(), conn: null, peer: null };
  function myTurn() { return !G.state.winner && (G.mode === "local" || G.state.turn === G.me); }
  function log(msg) { const d = $("log"); const p = document.createElement("div"); p.textContent = msg; d.prepend(p); }
  function setStatus(msg, cls) { $("status").textContent = msg; $("status").className = cls || ""; }

  function onCell(i) {
    const s = G.state; if (!myTurn() || s.phase !== "place" || s.board[i]) return;
    const player = G.mode === "local" ? s.turn : G.me;
    if (G.mode === "guest") { G.conn.send({ type: "place", i }); return; } // host applies and echoes state
    if (applyPlace(s, i, player)) { log(`${NAMES[player]} placed at ${"ABCDEF"[i % 6]}${Math.floor(i / 6) + 1}.`); render(); broadcast(); }
  }
  function onRotate(q, dir) {
    const s = G.state; if (!myTurn() || s.phase !== "rotate") return;
    const player = G.mode === "local" ? s.turn : G.me;
    if (G.mode === "guest") { G.conn.send({ type: "rotate", q, dir }); return; }
    doRotate(q, dir, player, true);
  }
  function doRotate(q, dir, player, broadcastAfter) {
    const before = JSON.stringify(G.state);
    const s = G.state;
    if (!applyRotate(s, q, dir, player)) return false;
    log(`${NAMES[player]} rotated block ${q + 1} ${dir === "cw" ? "clockwise" : "counter-clockwise"}.`);
    // show the pre-rotation board while animating, then the real one
    const after = G.state; G.state = JSON.parse(before); G.state.phase = "animating";
    render();
    animateRotate(q, dir, () => { G.state = after; render(); if (after.winner) log(after.winner === 3 ? "Draw." : `${NAMES[after.winner]} wins.`); });
    if (broadcastAfter) broadcast(after, { q, dir });
    return true;
  }
  function broadcast(state, rot) {
    if (G.mode !== "host" || !G.conn) return;
    G.conn.send({ type: "state", state: state || G.state, rot: rot || null });
  }
  function startGame(mode, me) {
    G.mode = mode; G.me = me; G.state = newState();
    $("lobby").hidden = true; $("boardwrap").hidden = false; $("log").innerHTML = "";
    buildBoard(); render();
  }
  $("rematch").addEventListener("click", () => {
    G.state = newState(); log("New game.");
    if (G.mode === "host") { G.conn.send({ type: "reset" }); }
    render();
  });

  // ---------------- networking (PeerJS, WebRTC) ----------------
  function makeCode() { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
  function wireConn(conn, role) {
    G.conn = conn;
    conn.on("data", msg => {
      if (role === "host") {
        if (msg.type === "place") { if (applyPlace(G.state, msg.i, 2)) { log(`White placed at ${"ABCDEF"[msg.i % 6]}${Math.floor(msg.i / 6) + 1}.`); render(); broadcast(); } }
        else if (msg.type === "rotate") doRotate(msg.q, msg.dir, 2, true);
      } else {
        if (msg.type === "state") {
          if (msg.rot) {
            const after = msg.state; const pre = JSON.parse(JSON.stringify(G.state));
            // reconstruct the pre-rotation board for the animation from the last known state, if consistent
            G.state = pre; G.state.phase = "animating"; render();
            log(`${NAMES[after.winner ? (after.phase === "over" ? 3 - after.turn : after.turn) : 3 - after.turn]} rotated block ${msg.rot.q + 1} ${msg.rot.dir === "cw" ? "clockwise" : "counter-clockwise"}.`);
            animateRotate(msg.rot.q, msg.rot.dir, () => { G.state = after; render(); if (after.winner) log(after.winner === 3 ? "Draw." : `${NAMES[after.winner]} wins.`); });
          } else {
            const prev = G.state; G.state = msg.state; render();
            if (G.state.pending >= 0 && G.state.pending !== prev.pending) log(`${NAMES[G.state.turn]} placed at ${"ABCDEF"[G.state.pending % 6]}${Math.floor(G.state.pending / 6) + 1}.`);
            if (G.state.winner && !prev.winner) log(G.state.winner === 3 ? "Draw." : `${NAMES[G.state.winner]} wins.`);
          }
        } else if (msg.type === "reset") { G.state = newState(); log("New game."); render(); }
      }
    });
    conn.on("close", () => { setStatus("The other player disconnected.", "turn-them"); G.conn = null; });
    conn.on("error", e => setStatus("Connection error: " + e, "turn-them"));
  }
  function peerError(e) {
    const m = { "peer-unavailable": "No game with that code is waiting.", "unavailable-id": "That code is taken, try again.", "network": "Could not reach the signaling server. Try again in a moment.", "browser-incompatible": "This browser does not support WebRTC." };
    setStatus(m[e.type] || ("Error: " + e.type), "turn-them");
    $("create").disabled = false; $("join").disabled = false;
  }
  $("create").addEventListener("click", () => {
    $("create").disabled = true; setStatus("Contacting the signaling server…");
    const code = makeCode();
    const peer = new Peer(PREFIX + code, { debug: 1 });
    G.peer = peer;
    peer.on("open", () => {
      $("code").textContent = code;
      const link = location.origin + location.pathname + "?join=" + code;
      $("link").textContent = link; $("created").hidden = false; setStatus("");
      $("copy").onclick = () => { navigator.clipboard.writeText(link).then(() => { $("copy").textContent = "Copied"; setTimeout(() => $("copy").textContent = "Copy link", 1500); }); };
    });
    peer.on("connection", conn => {
      if (G.conn) { conn.close(); return; }
      conn.on("open", () => {
        wireConn(conn, "host");
        startGame("host", 1); setStatus("Connected. You play Black and move first.", "turn-me");
        broadcast();
      });
    });
    peer.on("error", peerError);
  });
  function join(code) {
    code = (code || "").trim().toUpperCase(); if (code.length !== 6) { setStatus("Enter the 6-character game code.", "turn-them"); return; }
    $("join").disabled = true; setStatus("Connecting…");
    const peer = new Peer({ debug: 1 }); G.peer = peer;
    peer.on("open", () => {
      const conn = peer.connect(PREFIX + code, { reliable: true });
      conn.on("open", () => { wireConn(conn, "guest"); startGame("guest", 2); setStatus("Connected. You play White; Black moves first.", "turn-me"); });
      conn.on("error", e => setStatus("Connection error: " + e, "turn-them"));
    });
    peer.on("error", peerError);
  }
  $("join").addEventListener("click", () => join($("joincode").value));
  $("joincode").addEventListener("keydown", e => { if (e.key === "Enter") join($("joincode").value); });
  $("local").addEventListener("click", () => { startGame("local", 0); setStatus(""); });

  const params = new URLSearchParams(location.search);
  if (params.get("join")) { $("joincode").value = params.get("join").toUpperCase(); join(params.get("join")); }
})();
