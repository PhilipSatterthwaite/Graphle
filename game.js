const W = 240, H = 200, PAD = { l: 34, r: 8, t: 10, b: 24 };

const $ = (id) => document.getElementById(id);
const tooltip = $("tooltip");

let data, definitions;
let peaks = {};       // word -> peak uses per billion words, kept for the minimum-peak rule
let rules = rulesFromQuery(location.search);
let roundIndex = 0;   // rounds started under the current rules; hand-picked words only apply to the first
let round;            // { words: graph order, shuffled: bank order }
let assignments;      // graph index -> word | null
let locked;           // graph index -> true once known correct (feedback, reveal, or check)
let knownWrong;       // graph index -> Set of words known not to belong there
let lastWrong;        // graph indices marked wrong by the latest feedback or check
let guesses;          // [{ guess: [word by graph index], correct: number }]
let wrongGuesses;
let checksLeft;
let status;           // "playing" | "won" | "lost"
let selectedWord = null;
let message = "";
let messageIsNews = false;   // the message outranks arrangement warnings until the player moves a word
const stats = loadStats();

function loadStats() {
  try { return JSON.parse(localStorage.getItem("graphle-stats")) || { score: 0, streak: 0 }; }
  catch { return { score: 0, streak: 0 }; }
}
function saveStats() {
  try { localStorage.setItem("graphle-stats", JSON.stringify(stats)); } catch {}
}

function hintOn(key) {
  if (status !== "playing" && ["definitions", "magnitude"].includes(key)) return true;
  const at = rules.hints[key];
  return at !== null && wrongGuesses >= at;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Pearson correlation — used to avoid rounds where two graphs look identical.
function correlation(x, y) {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return num / (Math.sqrt(dx * dy) || 1);
}

// Shape similarity between two words, as R². Correlation ignores height, so this
// compares shapes only. Mirror-image curves (one rising, one falling) are as
// different as curves get, so negative correlation counts as no similarity.
function shapeR2(a, b) {
  const c = correlation(data.series[a], data.series[b]);
  return c > 0 ? c * c : 0;
}

const worstR2 = (words) => {
  let worst = 0;
  for (let i = 0; i < words.length; i++)
    for (let j = i + 1; j < words.length; j++) worst = Math.max(worst, shapeR2(words[i], words[j]));
  return worst;
};

// How far apart the round's peak magnitudes are — bigger is more varied.
function magnitudeSpread(words) {
  const sorted = words.map((w) => peaks[w]).sort((a, b) => a - b);
  return sorted[sorted.length - 1] / sorted[0];
}

function wordPool() {
  const all = Object.keys(data.series).filter((w) => !isDeleted(w));
  const pool = all.filter((w) => peaks[w] >= rules.minPeak);
  return pool.length >= 20 ? pool : all;
}

// Build a round by repeatedly adding the sampled word that is least like the
// words chosen so far (farthest-point selection on shape similarity).
function pickSpreadOut(n, pool, sample = 250) {
  const words = [pool[Math.floor(Math.random() * pool.length)]];
  while (words.length < n) {
    let best = null;
    for (let i = 0; i < sample; i++) {
      const candidate = pool[Math.floor(Math.random() * pool.length)];
      if (words.includes(candidate)) continue;
      const worst = Math.max(...words.map((w) => shapeR2(w, candidate)));
      if (!best || worst < best.worst) best = { candidate, worst };
    }
    if (!best) break;
    words.push(best.candidate);
  }
  return words;
}

function pickWords(n) {
  const pool = wordPool();
  if (rules.maxR2 >= 1) return shuffle(pool).slice(0, n);   // no limit: plain random
  let best = null;
  // A handful of attempts: keep the first round that meets the similarity cap
  // with varied peak heights, else the least similar round seen.
  for (let attempt = 0; attempt < 12; attempt++) {
    const words = pickSpreadOut(n, pool);
    const r2 = worstR2(words);
    if (!best || r2 < best.r2) best = { words, r2 };
    if (r2 <= rules.maxR2 && magnitudeSpread(words) >= 3) return words;
  }
  return best.words;
}

const isValidWord = (w) => Boolean(data && Object.hasOwn(data.series, w));

function niceMax(v) {
  const exp = 10 ** Math.floor(Math.log10(v));
  // Multipliers whose quarters are round numbers, since the axis has 4 intervals.
  for (const m of [1, 1.2, 1.6, 2, 2.4, 3, 4, 6, 8, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

function fmt(v) {
  if (v >= 1e6) return +(v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return +(v / 1e3).toFixed(1) + "k";
  if (v >= 10) return String(Math.round(v));
  return String(+v.toFixed(2));
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function svgEl(tag, attrs) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

function drawChart(series, showValues, showCurve = true) {
  const { yearStart, yearEnd } = data;
  const ymax = niceMax(Math.max(...series) || 1);
  const x = (yr) => PAD.l + ((yr - yearStart) / (yearEnd - yearStart)) * (W - PAD.l - PAD.r);
  const y = (v) => H - PAD.b - (v / ymax) * (H - PAD.t - PAD.b);

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "chart", role: "img" });
  for (let i = 0; i <= 4; i++) {
    const v = (ymax * i) / 4;
    svg.append(svgEl("line", { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), class: i ? "grid" : "axis" }));
    // Until the scale is revealed only the baseline is labelled.
    if (!showValues && i) continue;
    const t = svgEl("text", { x: PAD.l - 6, y: y(v) + 4, "text-anchor": "end", class: i ? "scale" : "" });
    t.textContent = fmt(v);
    svg.append(t);
  }
  for (const yr of [1800, 1850, 1900, 1950, 2000]) {
    const t = svgEl("text", { x: x(yr), y: H - 6, "text-anchor": "middle" });
    t.textContent = yr;
    svg.append(t);
  }
  if (!showCurve) {
    // Curve hidden: mark only when the word peaked.
    const peakYear = yearStart + series.indexOf(Math.max(...series));
    svg.append(svgEl("line", { x1: x(peakYear), x2: x(peakYear), y1: PAD.t, y2: H - PAD.b, class: "peak-mark" }));
    svg.append(svgEl("circle", { cx: x(peakYear), cy: PAD.t + 6, r: 4, class: "peak-dot" }));
    return svg;
  }

  const d = series.map((v, i) => `${i ? "L" : "M"}${x(yearStart + i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const plot = svgEl("g", { class: "plot" });
  plot.append(
    svgEl("path", { d: `${d}L${x(yearStart + series.length - 1).toFixed(1)},${y(0)}L${x(yearStart).toFixed(1)},${y(0)}Z`, class: "area" }),
    svgEl("path", { d, class: "line" }));
  svg.append(plot);

  if (showValues) {
    // Once the scale is revealed, mark the peak and write its height out beside it,
    // with a guide back to the axis so it reads against the numbers there too.
    const top = Math.max(...series);
    const px = x(yearStart + series.indexOf(top)), py = y(top);
    const label = "peak " + fmt(top);
    const w = label.length * 6 + 14, h = 18;
    const lx = px < (PAD.l + W - PAD.r) / 2 ? px + 9 : px - 9 - w;   // on whichever side has room
    const ly = Math.max(PAD.t - 4, Math.min(py - h / 2, H - PAD.b - h));
    const peak = svgEl("g", { class: "scale peak" });
    const text = svgEl("text", { x: lx + w / 2, y: ly + h / 2 + 3.8, "text-anchor": "middle", class: "peak-text" });
    text.textContent = label;
    peak.append(
      svgEl("line", { x1: PAD.l, x2: px, y1: py, y2: py, class: "peak-guide" }),
      svgEl("circle", { cx: px, cy: py, r: 3.5, class: "peak-pt" }),
      svgEl("rect", { x: lx, y: ly, width: w, height: h, rx: h / 2, class: "peak-tag" }),
      text);
    svg.append(peak);
  }

  const cross = svgEl("line", { y1: PAD.t, y2: H - PAD.b, class: "cross", visibility: "hidden" });
  const dot = svgEl("circle", { r: 4, class: "dot", visibility: "hidden" });
  svg.append(cross, dot);

  const hide = () => {
    cross.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  };
  svg.addEventListener("pointermove", (e) => {
    if (drag?.dragging) return hide();   // a word is being carried over the graph
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (yearEnd - yearStart));
    if (i < 0 || i >= series.length) return hide();
    const cx = x(yearStart + i), cy = y(series[i]);
    cross.setAttribute("x1", cx);
    cross.setAttribute("x2", cx);
    dot.setAttribute("cx", cx);
    dot.setAttribute("cy", cy);
    cross.setAttribute("visibility", "visible");
    dot.setAttribute("visibility", "visible");
    tooltip.replaceChildren(el("b", { textContent: yearStart + i }));
    if (showValues) tooltip.append(" ", el("span", { className: "y", textContent: `${fmt(series[i])} per billion words` }));
    tooltip.hidden = false;
    tooltip.style.left = Math.min(e.clientX + 12, innerWidth - tooltip.offsetWidth - 8) + "px";
    tooltip.style.top = e.clientY - 40 + "px";
  });
  svg.addEventListener("pointerleave", hide);
  return svg;
}

const ICONS = {
  lock: "M5.5 7V5a2.5 2.5 0 0 1 5 0v2M4.5 7h7a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z",
  check: "M3.5 8.5l3 3 6-7",
  cross: "M4.5 4.5l7 7M11.5 4.5l-7 7",
  key: "M13.5 5.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM8.4 7.6 2.5 13.5M4.4 11.6l1.6 1.6M6.3 9.7l1.6 1.6",
};

function icon(name) {
  const svg = svgEl("svg", { viewBox: "0 0 16 16", class: "icon", "aria-hidden": "true" });
  svg.append(svgEl("path", { d: ICONS[name] }));
  return svg;
}

// ---- Motion -------------------------------------------------------------

// Every render rebuilds the words, so movement is animated after the fact: note
// where each word was, render, then slide it in from its old spot (FLIP).
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let fx = {};            // one-shot cues for the next render: { newRound, submitted: row }
let flipFrom = null;    // { word, rect } — where a dragged word was let go
let shownLocked = [];   // graphs already drawn as locked, so a new lock can announce itself
let shownHints = null;  // hints already drawn as unlocked

function wordRects() {
  const rects = new Map();
  for (const n of document.querySelectorAll("#play-view [data-word]")) rects.set(n.dataset.word, n.getBoundingClientRect());
  return rects;
}

function flyWords(before) {
  const dropped = flipFrom;
  flipFrom = null;
  if (reducedMotion.matches) return;
  for (const n of document.querySelectorAll("#play-view [data-word]")) {
    const from = dropped?.word === n.dataset.word ? dropped.rect : before.get(n.dataset.word);
    if (!from) continue;
    const to = n.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    if (Math.hypot(dx, dy) < 2) continue;
    const scale = Math.min(1.08, Math.max(0.8, from.width / to.width));
    n.classList.add("flying");
    const flight = n.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: "none" }],
      { duration: 320, easing: "cubic-bezier(.2, .8, .2, 1)" });
    flight.onfinish = flight.oncancel = () => n.classList.remove("flying");
  }
}

// ---- The enlarged graph (phones) ----------------------------------------

const narrow = matchMedia("(max-width: 720px)");
let zoomAt = null;   // the graph on show, or null when closed

function openZoom(gi) {
  zoomAt = gi;
  const word = round.words[gi];
  const known = status !== "playing" || locked[gi];
  const showValues = hintOn("magnitude");
  const showCurve = !rules.peakFirst || wrongGuesses > 0 || status !== "playing";
  $("zoom-title").textContent = known ? word : `Graph ${gi + 1}`;
  $("zoom-chart").replaceChildren(drawChart(data.series[word], showValues, showCurve));
  $("zoom-hint").textContent = `${gi + 1} of ${rules.n} · drag across for a year`;
  $("zoom").hidden = false;
  document.documentElement.classList.add("zoomed");
}

function closeZoom() {
  zoomAt = null;
  $("zoom").hidden = true;
  tooltip.hidden = true;
  document.documentElement.classList.remove("zoomed");
}

const stepZoom = (by) => openZoom((zoomAt + by + rules.n) % rules.n);

$("zoom-close").addEventListener("click", closeZoom);
$("zoom-prev").addEventListener("click", () => stepZoom(-1));
$("zoom-next").addEventListener("click", () => stepZoom(1));
// A tap on the backdrop closes it; taps on the card itself must not.
$("zoom").addEventListener("click", (e) => { if (e.target === $("zoom")) closeZoom(); });
addEventListener("keydown", (e) => {
  if (zoomAt === null) return;
  if (e.key === "Escape") closeZoom();
  if (e.key === "ArrowLeft") stepZoom(-1);
  if (e.key === "ArrowRight") stepZoom(1);
});

// ---- Moving words -------------------------------------------------------

const isLockedWord = (w) => assignments.some((a, gi) => a === w && locked[gi]);

// Put a word under a graph. If the word was already under another graph, the two words swap.
function place(gi, word) {
  if (status !== "playing" || !word || locked[gi] || isLockedWord(word) || !round.words.includes(word)) return;
  const from = assignments.indexOf(word);
  if (from === gi) return;
  const occupant = assignments[gi];
  assignments[gi] = word;
  if (from >= 0) assignments[from] = occupant;
  lastWrong.delete(gi);
  lastWrong.delete(from);
  selectedWord = null;
  messageIsNews = false;
  render();
}

function unplace(word) {
  const at = assignments.indexOf(word);
  if (status !== "playing" || at < 0 || locked[at]) return;
  assignments[at] = null;
  lastWrong.delete(at);
  messageIsNews = false;
  render();
}

// Would the current arrangement, if it were the answer, have produced this past guess's score?
// "fits" / "conflicts" for a full arrangement; while slots are empty, "open" unless it's already impossible.
function logicCheck(past) {
  const placed = new Set(assignments.filter(Boolean));
  let matches = 0, couldMatch = 0;
  past.guess.forEach((w, gi) => {
    if (assignments[gi]) matches += assignments[gi] === w ? 1 : 0;
    else if (!placed.has(w)) couldMatch++;
  });
  if (matches > past.correct || matches + couldMatch < past.correct) return "conflicts";
  return assignments.every(Boolean) ? "fits" : "open";
}

// Take every word off the graphs except ones known to be correct.
function clearBoard() {
  if (status !== "playing") return;
  assignments = assignments.map((a, gi) => (locked[gi] ? a : null));
  lastWrong.clear();
  selectedWord = null;
  messageIsNews = false;
  render();
}

// Refill the graphs from a past guess. Locked graphs keep their known word, and a
// word already locked elsewhere is left off rather than duplicated.
function loadGuess(index) {
  if (status !== "playing") return;
  const lockedWords = round.words.filter((w, gi) => locked[gi]);
  assignments = guesses[index].guess.map((w, gi) => (locked[gi] ? round.words[gi] : lockedWords.includes(w) ? null : w));
  lastWrong.clear();
  selectedWord = null;
  messageIsNews = false;
  render();
}

const sameAsPastGuess = () => guesses.some((h) => h.guess.every((w, gi) => w === assignments[gi]));

// Pointer-based dragging, so it works the same with a mouse, trackpad, touchscreen
// or pen — HTML5 drag events do nothing on touch devices.
const DRAG_THRESHOLD = 6;

const DROP_MARGIN = 48;   // how far outside a column still counts as that column

function dropTargetAt(x, y) {
  const under = document.elementFromPoint(x, y);
  const column = under?.closest("[data-graph]");
  if (column) return { type: "graph", index: Number(column.dataset.graph), el: column };
  if (under?.closest("#words")) return { type: "bank", el: $("words") };

  // Near miss: if the pointer is around the board, use the nearest column.
  const board = $("board").getBoundingClientRect();
  if (y < board.top - DROP_MARGIN || y > board.bottom + DROP_MARGIN) return null;
  if (x < board.left - DROP_MARGIN || x > board.right + DROP_MARGIN) return null;
  let best = null;
  for (const cell of document.querySelectorAll("#board [data-graph]")) {
    const r = cell.getBoundingClientRect();
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    const distance = Math.hypot(dx, dy);
    if (!best || distance < best.distance) best = { distance, cell };
  }
  if (!best || best.distance > DROP_MARGIN * 2) return null;
  return { type: "graph", index: Number(best.cell.dataset.graph), el: best.cell };
}

// One drag at a time, tracked here rather than on the dragged element: if the
// browser stops sending events to that element (lost pointer capture, a re-render
// mid-drag, a pointerup outside the window), element listeners would never fire
// and the ghost would be stranded on screen.
let drag = null;

function clearGhosts() {
  for (const g of document.querySelectorAll(".drag-ghost")) g.remove();
  for (const n of document.querySelectorAll(".dragging")) n.classList.remove("dragging");
  markDropTarget(null);
}

// Light up what a drop would land on: the whole column (graph and open slot), or the bank.
function markDropTarget(target) {
  for (const t of document.querySelectorAll(".drop-target")) t.classList.remove("drop-target");
  if (target?.type === "bank") target.el.classList.add("drop-target");
  if (target?.type === "graph") {
    for (const n of document.querySelectorAll(`#board .card[data-graph="${target.index}"], #board .slot-cell[data-graph="${target.index}"]`)) n.classList.add("drop-target");
  }
}

function endDrag(ev) {
  if (!drag) return;
  const { node, word, dragging, ghost } = drag;
  drag = null;
  // The word settles into place from wherever it was let go.
  if (ghost && ev?.type === "pointerup") flipFrom = { word, rect: ghost.getBoundingClientRect() };
  removeEventListener("pointermove", onDragMove, true);
  removeEventListener("pointerup", endDrag, true);
  removeEventListener("pointercancel", endDrag, true);
  removeEventListener("blur", endDrag);
  clearGhosts();
  if (!dragging || !ev || ev.type !== "pointerup") return;
  // Suppress the click that would otherwise follow the drag.
  node.addEventListener("click", (c) => c.stopImmediatePropagation(), { capture: true, once: true });
  const target = dropTargetAt(ev.clientX, ev.clientY);
  if (target?.type === "graph") place(target.index, word);
  else if (target?.type === "bank") unplace(word);
  if (flipFrom) render();   // nothing moved: let the word glide back to where it came from
}

function onDragMove(ev) {
  if (!drag || ev.pointerId !== drag.pointerId) return;
  if (!drag.dragging) {
    if (Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < DRAG_THRESHOLD) return;
    drag.dragging = true;
    try { drag.node.setPointerCapture(ev.pointerId); } catch {}
    drag.ghost = el("div", { className: "drag-ghost", textContent: drag.word });
    document.body.append(drag.ghost);
    drag.node.classList.add("dragging");
  }
  ev.preventDefault();
  drag.ghost.style.left = ev.clientX + "px";
  drag.ghost.style.top = ev.clientY + "px";
  const target = dropTargetAt(ev.clientX, ev.clientY);
  const key = target ? target.type + (target.index ?? "") : null;
  if (drag.hovered !== key) {
    drag.hovered = key;
    markDropTarget(target);
  }
}

function dragSource(node, word) {
  node.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || status !== "playing") return;
    endDrag();  // drop anything still in flight
    drag = { node, word, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dragging: false, ghost: null, hovered: null };
    addEventListener("pointermove", onDragMove, true);
    addEventListener("pointerup", endDrag, true);
    addEventListener("pointercancel", endDrag, true);
    addEventListener("blur", endDrag);
  });
}

// ---- Hints --------------------------------------------------------------

// Apply hints whose unlock point is exactly the current number of wrong guesses.
function unlockHints() {
  const unlocked = HINT_TYPES.filter((h) => rules.hints[h.key] === wrongGuesses);
  for (const h of unlocked) {
    if (h.key === "reveal") revealMatch();
    if (h.key === "check") checksLeft++;
  }
  return unlocked;
}

// Confirm one graph's word. Prefer one the player already had right in their most
// recent guess, then one they had right in their first guess, then any graph.
function revealMatch() {
  const open = round.words.map((w, gi) => gi).filter((gi) => !locked[gi]);
  if (!open.length) return;
  const rightIn = (g) => (g ? open.filter((gi) => g.guess[gi] === round.words[gi]) : []);
  const pool = [rightIn(guesses.at(-1)), rightIn(guesses[0]), open].find((list) => list.length);
  const gi = pool[Math.floor(Math.random() * pool.length)];
  const word = round.words[gi];
  const from = assignments.indexOf(word);
  if (from >= 0 && from !== gi) assignments[from] = assignments[gi];
  assignments[gi] = word;
  locked[gi] = true;
  lastWrong.delete(gi);
}

function checkGraph(gi) {
  if (checksLeft <= 0 || locked[gi] || !assignments[gi]) return;
  checksLeft--;
  const word = assignments[gi];
  if (word === round.words[gi]) {
    locked[gi] = true;
    message = `Check: “${word}” is right for graph ${gi + 1}.`;
  } else {
    knownWrong[gi].add(word);
    lastWrong.add(gi);
    message = `Check: “${word}” is not graph ${gi + 1}.`;
  }
  messageIsNews = true;
  render();
}

// ---- Rendering ----------------------------------------------------------

function definitionText(word) {
  const def = definitions[word];
  return def ? [el("span", { className: "pos", textContent: def.pos }), def.text] : ["No definition available."];
}

function renderRulesSummary() {
  const parts = [
    `${rules.n} words`,
    `${rules.guesses} guesses`,
    rules.feedback === "exact" ? "shows which are right" : "shows how many are right",
  ];
  if (rules.logic) parts.push("logic helper on");
  if (rules.minPeak !== DEFAULT_RULES.minPeak) parts.push(`peak ≥ ${formatPeak(rules.minPeak)}`);
  if (rules.maxR2 !== DEFAULT_RULES.maxR2) parts.push(`graphs ≤ R² ${formatR2(rules.maxR2)}`);
  if (rules.peakFirst) parts.push("peak markers first");
  if (rules.words) parts.push(roundIndex <= 1 ? "custom puzzle" : "custom puzzle done, now random");
  $("rules-summary").textContent = parts.join(" · ");
}

function renderBank() {
  const wordsEl = $("words");
  wordsEl.replaceChildren();
  wordsEl.classList.toggle("enter", Boolean(fx.newRound));
  wordsEl.hidden = status !== "playing";   // once the round is over the words are all on the board
  round.shuffled.forEach((w, i) => {
    const at = assignments.indexOf(w);
    const isLocked = at >= 0 && locked[at];
    const b = el("button", { className: "chip", textContent: w });
    if (at >= 0) b.classList.add(isLocked ? "locked" : "placed");
    else b.dataset.word = w;   // the word lives here until it's placed under a graph
    if (w === selectedWord) b.classList.add("selected");
    b.disabled = status !== "playing" || isLocked;
    if (!b.disabled) dragSource(b, w);
    b.addEventListener("click", () => {
      // With only one open graph left, tapping an unplaced word drops it straight in.
      const open = assignments.map((a, gi) => gi).filter((gi) => !assignments[gi] && !locked[gi]);
      if (at < 0 && open.length === 1) return place(open[0], w);
      selectedWord = selectedWord === w ? null : w;
      render();
    });
    const wrap = el("span", { className: "chip-wrap" }, b, starButton(w), deleteButton(w));
    wrap.style.setProperty("--i", i);
    wordsEl.append(wrap);
  });

  const sel = $("selected-def");
  sel.replaceChildren();
  if (selectedWord) {
    sel.append(el("b", { textContent: selectedWord }));
    if (hintOn("definitions")) sel.append(" — ", ...definitionText(selectedWord));
    else sel.append(" — now tap a graph");
  }
}

function renderStatus() {
  const hintsEl = $("hints");
  hintsEl.replaceChildren();
  const nowOn = new Set();
  for (const h of HINT_TYPES) {
    const at = rules.hints[h.key];
    if (at === null) continue;
    const on = wrongGuesses >= at;
    let text = on ? h.label : `${h.label} ${hintTimingLabel(at)}`;
    if (h.key === "check" && on) text += checksLeft ? " — tap “Check” on a graph" : " (used)";
    const pill = el("span", { className: "hint" + (on ? " on" : "") }, icon(on ? "check" : "lock"), text);
    if (on) nowOn.add(h.key);
    if (on && shownHints && !shownHints.has(h.key)) pill.classList.add("fresh");
    hintsEl.append(pill);
  }
  shownHints = nowOn;

  const defsEl = $("definitions");
  defsEl.hidden = !hintOn("definitions");
  defsEl.replaceChildren();
  for (const w of round.shuffled) defsEl.append(el("dt", {}, w, starButton(w), deleteButton(w)), el("dd", {}, ...definitionText(w)));

}

// The graphs are built once per round and kept, so their curves don't redraw (and
// hover, transitions and entrance animations survive) when the words move around.
let cardsKey = null;
let roundSerial = 0;

function renderCards(board, showValues, showCurve) {
  const key = [roundSerial, showValues, showCurve].join("|");
  if (key !== cardsKey) {
    const sameRound = cardsKey?.startsWith(roundSerial + "|");
    const curveAppeared = sameRound && showCurve && cardsKey.endsWith("false");
    cardsKey = key;
    board.replaceChildren(el("div", { className: "row-n head" }));
    round.words.forEach((word, gi) => {
      const card = el("div", { className: "card" });
      card.dataset.graph = gi;
      card.style.setProperty("--i", gi);
      if (!sameRound || curveAppeared) card.classList.add("enter");
      const chart = drawChart(data.series[word], showValues, showCurve);
      if (sameRound && showValues) for (const t of chart.querySelectorAll(".scale")) t.classList.add("labels-in");
      // Caption replaces the axis labels on narrow screens; it must not give away
      // more than the axis would, so it shows the peak height only.
      card.append(chart, el("div", { className: "chart-caption" + (showValues ? " on" : ""), textContent: showValues ? `peak ${fmt(peaks[word])}` : "1800–2022" }));
      card.addEventListener("click", () => {
        // With a word in hand, a tap on the graph still places it.
        if (selectedWord && status === "playing" && !locked[gi]) return place(gi, selectedWord);
        // Otherwise, on a phone, open the graph large — the only place its axis fits.
        if (narrow.matches) return openZoom(gi);
        if (status !== "playing" || locked[gi]) return;
        if (assignments[gi]) unplace(assignments[gi]);
      });
      board.append(card);
    });
    board.append(el("div", { className: "score-cell head" }));
  }

  round.words.forEach((word, gi) => {
    const card = board.children[gi + 1];
    const done = status !== "playing";
    card.classList.toggle("target", Boolean(selectedWord) && !done && !locked[gi]);
    // Green for a win or a graph locked mid-round; a lost round leaves every graph blue.
    card.classList.toggle("correct", status === "won" || (status === "playing" && locked[gi]));
    if ((done || locked[gi]) && !card.querySelector(".card-top")) {
      card.prepend(el("div", { className: "card-top" }, starButton(word), deleteButton(word)));
    }
  });
}

function renderBoard() {
  const board = $("board");
  board.style.setProperty("--cols", rules.n);
  document.body.dataset.cols = rules.n;   // the side ad only shows when the board leaves room for it
  const showValues = hintOn("magnitude");
  // With "peak markers first", curves stay hidden until the first wrong guess.
  const showCurve = !rules.peakFirst || wrongGuesses > 0 || status !== "playing";

  // Top row: the graphs, each its own drop column. Everything after it is rebuilt.
  renderCards(board, showValues, showCurve);
  while (board.children.length > rules.n + 2) board.lastChild.remove();

  // Each row below the graphs is one element spanning the board (a subgrid), so a
  // whole row can be marked at once — the logic helper's bands, the answer row.
  const current = guesses.length;   // the row being filled in
  for (let row = 0; row < rules.guesses; row++) {
    const past = guesses[row];
    const live = row === current && status === "playing";
    const line = el("div", { className: "guess-row" });
    line.append(el("div", { className: "row-n" + (live ? " current" : past ? "" : " future"), textContent: row + 1 }));
    board.append(line);

    if (past) {
      // A submitted guess: words in place, score at the end. Once every slot is filled the
      // logic helper bands the row green if the board fits its score, yellow if it can't.
      const fresh = fx.submitted === row;
      const winning = status === "won" && row === guesses.length - 1;
      const logic = rules.logic && status === "playing" ? logicCheck(past) : null;
      if (logic === "conflicts") {
        line.classList.add("conflict");
        line.title = `The words on the board can't be right: guess ${row + 1} scored ${past.correct}/${rules.n} and they don't fit that.`;
      } else if (logic === "fits") {
        line.classList.add("fits");
        line.title = `The words on the board fit guess ${row + 1}'s score of ${past.correct}/${rules.n}.`;
      }
      if (fresh && status === "lost") line.classList.add("shake");
      past.guess.forEach((w, gi) => {
        const cell = el("div", { className: "guess-cell", textContent: w });
        cell.dataset.graph = gi;   // the whole column is a drop zone
        cell.style.setProperty("--i", gi);
        cell.style.setProperty("--len", w.length);
        // Once the round is over every past guess shows which words were right.
        if (rules.feedback === "exact" || status !== "playing") cell.classList.add(w === round.words[gi] ? "ok" : "bad");
        if (winning) cell.classList.add("win");
        if (fresh) cell.classList.add(winning ? "celebrate" : "stamp");
        if (status === "playing") {
          cell.title = "Click to put this guess back on the graphs";
          cell.classList.add("loadable");
          cell.addEventListener("click", () => loadGuess(row));
        }
        line.append(cell);
      });
      line.append(el("div", { className: "score-cell" + (fresh ? " pop" : "") },
        el("b", { textContent: past.correct }), el("span", { textContent: "/" + rules.n })));
      continue;
    }

    if (live) {
      // The live row: the slots being filled.
      round.words.forEach((word, gi) => {
        const placed = assignments[gi];
        const cell = el("div", { className: "slot-cell" });
        cell.dataset.graph = gi;
        cell.style.setProperty("--len", (locked[gi] ? word.length + 2 : placed?.length) || 8);
        if (locked[gi]) {
          cell.classList.add("correct");
          if (!shownLocked[gi]) cell.classList.add("lock-in");
          const label = el("span", { textContent: word });
          label.dataset.word = word;
          cell.append(icon("check"), label);
        } else {
          if (selectedWord) cell.classList.add("target");
          if (lastWrong.has(gi)) cell.classList.add("wrong");
          if (placed) {
            cell.classList.add("filled");
            const token = el("div", { className: "token", textContent: placed });
            token.dataset.word = placed;
            dragSource(token, placed);
            cell.append(token);
          }
          if (knownWrong[gi].size) cell.title = "Not: " + [...knownWrong[gi]].join(", ");
          cell.addEventListener("click", () => {
            if (selectedWord) place(gi, selectedWord);
            else if (placed) unplace(placed);
          });
          if (checksLeft > 0 && placed) {
            const btn = el("button", { className: "check-btn", textContent: "Check" });
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              checkGraph(gi);
            });
            btn.addEventListener("pointerdown", (e) => e.stopPropagation());
            cell.append(btn);
          }
        }
        line.append(cell);
      });
      line.append(el("div", { className: "score-cell" }));
      continue;
    }

    // A guess that hasn't happened yet.
    for (let gi = 0; gi < rules.n; gi++) {
      const cell = el("div", { className: "guess-cell future" });
      cell.dataset.graph = gi;
      line.append(cell);
    }
    line.append(el("div", { className: "score-cell future" }));
  }

  // Out of guesses: a final row gives the answers.
  if (status === "lost") {
    const line = el("div", { className: "guess-row answers" }, el("div", { className: "row-n" }, icon("key")));
    line.firstChild.title = "The answers";
    round.words.forEach((word, gi) => {
      const cell = el("div", { className: "guess-cell answer", textContent: word });
      if (fx.submitted !== undefined) cell.classList.add("stamp");
      cell.style.setProperty("--i", gi);
      cell.style.setProperty("--len", word.length);
      line.append(cell);
    });
    line.append(el("div", { className: "score-cell" }));
    board.append(line);
  }
  shownLocked = [...locked];
}

function render() {
  if (!drag) clearGhosts();  // never leave a stranded ghost behind a re-render
  const before = fx.newRound ? new Map() : wordRects();
  renderRulesSummary();
  renderBank();
  renderStatus();
  renderBoard();
  flyWords(before);
  fx = {};
  const full = assignments.every(Boolean);
  const repeat = status === "playing" && full && sameAsPastGuess();
  $("submit").hidden = status !== "playing";
  $("clear").hidden = status !== "playing";
  $("clear").disabled = !assignments.some((a, gi) => a && !locked[gi]);
  $("submit").disabled = !full || repeat;
  const conflicts = rules.logic && status === "playing" ? guesses.map((h, i) => (logicCheck(h) === "conflicts" ? "#" + (i + 1) : null)).filter(Boolean) : [];
  const note = repeat
    ? "You already tried this exact arrangement."
    : conflicts.length ? `Heads up: this arrangement can't be right given guess ${conflicts.join(", ")}.` : "";
  $("submit-note").textContent = note;
  // One status line at a time: the word in hand, then a warning, then the latest result.
  $("selected-def").hidden = !selectedWord;
  const showNote = Boolean(note) && !(messageIsNews && message);
  $("submit-note").hidden = Boolean(selectedWord) || !showNote;
  $("result").hidden = Boolean(selectedWord) || showNote;
  $("next").hidden = status === "playing";
  $("share").hidden = status === "playing";
  // The end of a round gets a verdict panel rather than a line of text.
  if (status === "won") $("result").replaceChildren(verdict("win", "check", "Solved!", message));
  else if (status === "lost") $("result").replaceChildren(verdict("loss", "cross", "Out of guesses", message));
  else $("result").textContent = message;
  $("score").textContent = stats.score;
  $("streak").textContent = stats.streak;
}

// ---- Sharing -------------------------------------------------------------

// A spoiler-free summary: one row per guess (green where a word was right, red where
// it wasn't), a blue row for the answers if the round was lost, and a link to this
// same puzzle so whoever gets it can play the same graphs.
function shareText() {
  const rows = guesses.map((g) => g.guess.map((w, gi) => (w === round.words[gi] ? "🟩" : "🟥")).join(""));
  if (status === "lost") rows.push("🟦".repeat(rules.n));
  const score = status === "won" ? guesses.length : "X";
  const link = location.origin + location.pathname + rulesToQuery({ ...rules, words: [...round.words] });
  return [`Graphle ${score}/${rules.guesses}`, ...rows, link].join("\n");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or a page without clipboard permission: copy from a hidden field.
    const area = el("textarea", { value: text });
    area.style.cssText = "position:fixed;opacity:0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

async function shareResults() {
  const button = $("share");
  const ok = await copyText(shareText());
  button.textContent = ok ? "Copied!" : "Couldn't copy";
  button.classList.toggle("done", ok);
  clearTimeout(button.reset);
  button.reset = setTimeout(() => {
    button.textContent = "Share results";
    button.classList.remove("done");
  }, 1800);
}

function verdict(kind, iconName, title, detail) {
  return el("div", { className: "verdict " + kind },
    el("span", { className: "verdict-badge" }, icon(iconName)),
    el("span", { className: "verdict-text" }, el("b", { textContent: title }), el("span", { textContent: detail })));
}

// ---- Rounds -------------------------------------------------------------

function newRound() {
  const handPicked = roundIndex === 0 && rules.words && rules.words.every(isValidWord);
  // Graph order is shuffled so the order a puzzle maker typed the words in gives nothing away.
  const words = handPicked ? shuffle(rules.words) : pickWords(rules.n);
  roundIndex++;
  round = { words, shuffled: shuffle(words) };
  assignments = words.map(() => null);
  locked = words.map(() => false);
  knownWrong = words.map(() => new Set());
  lastWrong = new Set();
  guesses = [];
  wrongGuesses = 0;
  checksLeft = 0;
  status = "playing";
  selectedWord = null;
  const unlocked = unlockHints();
  message = unlocked.length ? `Starting hints: ${unlocked.map((h) => h.label.toLowerCase()).join(", ")}.` : "";
  messageIsNews = true;
  if (zoomAt !== null) closeZoom();
  roundSerial++;
  shownLocked = [];
  shownHints = null;
  fx = { newRound: true };
  render();
}

function submit() {
  const guess = [...assignments];
  const correct = guess.filter((w, gi) => w === round.words[gi]).length;
  guesses.push({ guess, correct });
  fx = { submitted: guesses.length - 1 };
  messageIsNews = true;
  selectedWord = null;
  tooltip.hidden = true;

  if (rules.feedback === "exact") {
    lastWrong = new Set();
    guess.forEach((w, gi) => {
      if (w === round.words[gi]) locked[gi] = true;
      else {
        knownWrong[gi].add(w);
        lastWrong.add(gi);
      }
    });
  }

  if (correct === rules.n) {
    status = "won";
    stats.score += 1;
    stats.streak += 1;
    const n = guesses.length;
    message = (n === 1 ? "First try" : `In ${n} guesses`) + (stats.streak > 1 ? ` · ${stats.streak} in a row` : "") + ".";
  } else {
    wrongGuesses++;
    if (wrongGuesses >= rules.guesses) {
      status = "lost";
      stats.streak = 0;
      message = "The answers are on the bottom row, in blue.";
    } else {
      const unlocked = unlockHints();
      message = `${correct} of ${rules.n} correct.` +
        (unlocked.length ? ` Hint unlocked: ${unlocked.map((h) => h.label.toLowerCase()).join(", ")}.` : "");
    }
  }
  if (status !== "playing") saveStats();
  render();
}

// Switch to a new rule set (from the Create tab) and start fresh.
function applyRules(newRules) {
  rules = cloneRules(newRules);
  roundIndex = 0;
  history.replaceState(null, "", rulesToQuery(rules));
  newRound();
}

// ---- Tabs and startup ---------------------------------------------------

function showTab(name) {
  if (zoomAt !== null) closeZoom();
  for (const view of ["play", "create", "saved"]) $(view + "-view").hidden = name !== view;
  for (const b of document.querySelectorAll(".tab")) b.classList.toggle("active", b.dataset.tab === name);
  history.replaceState(null, "", location.search + (name === "play" ? "" : "#" + name));
  if (name === "create") openCreator(rules);
  if (name === "saved") renderSaved();
  window.scrollTo(0, 0);
}

for (const b of document.querySelectorAll(".tab")) b.addEventListener("click", () => showTab(b.dataset.tab));
$("brand").addEventListener("click", () => showTab("play"));
$("submit").addEventListener("click", submit);
$("clear").addEventListener("click", clearBoard);
$("next").addEventListener("click", newRound);
$("share").addEventListener("click", shareResults);

Promise.all(["data/ngrams.json", "data/definitions.json"].map((u) => fetch(u + "?v=30").then((r) => r.json())))
  .then(([ngrams, defs]) => {
    // Series are stored as a peak plus percentages of it; expand to values.
    for (const [w, { max, q }] of Object.entries(ngrams.series)) {
      peaks[w] = max;
      ngrams.series[w] = q.map((p) => (p * max) / 100);
    }
    data = ngrams;
    definitions = defs;
    newRound();
    showTab(["#create", "#saved"].includes(location.hash) ? location.hash.slice(1) : "play");
  })
  .catch((err) => {
    console.error(err);
    $("result").textContent = "Couldn't load word data. Serve this folder over HTTP (not file://).";
  });
