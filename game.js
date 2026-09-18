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
    const t = svgEl("text", { x: PAD.l - 6, y: y(v) + 4, "text-anchor": "end" });
    t.textContent = showValues ? fmt(v) : i === 0 ? "0" : "?";
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
  svg.append(svgEl("path", { d, class: "line" }));

  const cross = svgEl("line", { y1: PAD.t, y2: H - PAD.b, class: "cross", visibility: "hidden" });
  const dot = svgEl("circle", { r: 4, class: "dot", visibility: "hidden" });
  svg.append(cross, dot);

  const hide = () => {
    cross.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  };
  svg.addEventListener("pointermove", (e) => {
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
  render();
}

function unplace(word) {
  const at = assignments.indexOf(word);
  if (status !== "playing" || at < 0 || locked[at]) return;
  assignments[at] = null;
  lastWrong.delete(at);
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
  for (const t of document.querySelectorAll(".drop-target")) t.classList.remove("drop-target");
}

function endDrag(ev) {
  if (!drag) return;
  const { node, word, dragging } = drag;
  drag = null;
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
  if (drag.hovered !== (target?.el ?? null)) {
    drag.hovered?.classList.remove("drop-target");
    drag.hovered = target?.el ?? null;
    drag.hovered?.classList.add("drop-target");
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
  for (const w of round.shuffled) {
    const at = assignments.indexOf(w);
    const isLocked = at >= 0 && locked[at];
    const b = el("button", { className: "chip", textContent: w });
    if (at >= 0) b.classList.add(isLocked ? "locked" : "placed");
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
    wordsEl.append(el("span", { className: "chip-wrap" }, b, starButton(w), deleteButton(w)));
  }

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
  for (const h of HINT_TYPES) {
    const at = rules.hints[h.key];
    if (at === null) continue;
    const on = wrongGuesses >= at;
    let text = on ? `💡 ${h.label}` : `🔒 ${h.label} ${hintTimingLabel(at)}`;
    if (h.key === "check" && on) text += checksLeft ? " — tap “Check” on a graph" : " (used)";
    hintsEl.append(el("span", { className: "hint" + (on ? " on" : ""), textContent: text }));
  }

  const defsEl = $("definitions");
  defsEl.hidden = !hintOn("definitions");
  defsEl.replaceChildren();
  for (const w of round.shuffled) defsEl.append(el("dt", {}, w, starButton(w), deleteButton(w)), el("dd", {}, ...definitionText(w)));

}

function renderBoard() {
  const board = $("board");
  board.replaceChildren();
  board.style.setProperty("--cols", rules.n);
  const showValues = hintOn("magnitude");
  // With "peak markers first", curves stay hidden until the first wrong guess.
  const showCurve = !rules.peakFirst || wrongGuesses > 0 || status !== "playing";

  // Top row: the graphs, each its own drop column.
  round.words.forEach((word, gi) => {
    const card = el("div", { className: "card" });
    card.dataset.graph = gi;
    if (status !== "playing" || locked[gi]) {
      card.append(el("div", { className: "card-top" }, starButton(word), deleteButton(word)));
    }
    card.append(drawChart(data.series[word], showValues, showCurve));
    // Caption replaces the axis labels on narrow screens; it must not give away
    // more than the axis would, so it shows the peak height only.
    card.append(el("div", { className: "chart-caption", textContent: showValues ? `peak ${fmt(peaks[word])}` : "1800–2022" }));
    if (locked[gi] || status === "won") card.classList.add("correct");
    else if (status === "lost") card.classList.add(assignments[gi] === word ? "correct" : "revealed");
    card.addEventListener("click", () => {
      if (status !== "playing" || locked[gi]) return;
      if (selectedWord) place(gi, selectedWord);
      else if (assignments[gi]) unplace(assignments[gi]);
    });
    board.append(card);
  });
  board.append(el("div", { className: "score-cell head" }));

  const current = guesses.length;   // the row being filled in
  for (let row = 0; row < rules.guesses; row++) {
    const past = guesses[row];
    if (past) {
      // A submitted guess: words in place, colored by the logic helper, score at the end.
      const logic = rules.logic && status === "playing" ? logicCheck(past) : null;
      past.guess.forEach((w, gi) => {
        const cell = el("div", { className: "guess-cell", textContent: w });
        cell.dataset.graph = gi;   // the whole column is a drop zone
        if (logic) cell.classList.add("logic-" + logic);
        if (rules.feedback === "exact") cell.classList.add(w === round.words[gi] ? "ok" : "bad");
        if (status === "playing") {
          cell.title = "Click to put this guess back on the graphs";
          cell.classList.add("loadable");
          cell.addEventListener("click", () => loadGuess(row));
        }
        board.append(cell);
      });
      board.append(el("div", { className: "score-cell", textContent: `${past.correct}/${rules.n}` }));
      continue;
    }

    if (row === current && status === "playing") {
      // The live row: the slots being filled.
      round.words.forEach((word, gi) => {
        const placed = assignments[gi];
        const cell = el("div", { className: "slot-cell" });
        cell.dataset.graph = gi;
        if (locked[gi]) {
          cell.classList.add("correct");
          cell.textContent = "✓ " + word;
        } else {
          if (selectedWord) cell.classList.add("target");
          if (lastWrong.has(gi)) cell.classList.add("wrong");
          cell.textContent = placed || "";
          if (placed) {
            cell.classList.add("filled");
            dragSource(cell, placed);
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
            cell.append(btn);
          }
        }
        board.append(cell);
      });
      board.append(el("div", { className: "score-cell" }));
      continue;
    }

    // A guess that hasn't happened yet, or the answers once the round is over.
    for (let gi = 0; gi < rules.n; gi++) {
      const showAnswer = status === "lost" && row === current;
      const cell = el("div", {
        className: "guess-cell future" + (showAnswer ? " answer" : ""),
        textContent: showAnswer ? round.words[gi] : "",
      });
      cell.dataset.graph = gi;
      board.append(cell);
    }
    board.append(el("div", { className: "score-cell future" }));
  }
}

function render() {
  if (!drag) clearGhosts();  // never leave a stranded ghost behind a re-render
  renderRulesSummary();
  renderBank();
  renderStatus();
  renderBoard();
  const full = assignments.every(Boolean);
  const repeat = status === "playing" && full && sameAsPastGuess();
  $("submit").hidden = status !== "playing";
  $("clear").hidden = status !== "playing";
  $("clear").disabled = !assignments.some((a, gi) => a && !locked[gi]);
  $("submit").disabled = !full || repeat;
  const conflicts = rules.logic && status === "playing" ? guesses.map((h, i) => (logicCheck(h) === "conflicts" ? "#" + (i + 1) : null)).filter(Boolean) : [];
  $("submit-note").textContent = repeat
    ? "You already tried this exact arrangement."
    : conflicts.length ? `Heads up: this arrangement can't be right given guess ${conflicts.join(", ")}.` : "";
  $("next").hidden = status === "playing";
  $("result").textContent = message;
  $("score").textContent = stats.score;
  $("streak").textContent = stats.streak;
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
  render();
}

function submit() {
  const guess = [...assignments];
  const correct = guess.filter((w, gi) => w === round.words[gi]).length;
  guesses.push({ guess, correct });
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
    message = `Solved in ${n} guess${n === 1 ? "" : "es"}! 🎉`;
  } else {
    wrongGuesses++;
    if (wrongGuesses >= rules.guesses) {
      status = "lost";
      stats.streak = 0;
      message = "Out of guesses — answers revealed.";
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
  for (const view of ["play", "create", "saved"]) $(view + "-view").hidden = name !== view;
  for (const b of document.querySelectorAll(".tab")) b.classList.toggle("active", b.dataset.tab === name);
  history.replaceState(null, "", location.search + (name === "play" ? "" : "#" + name));
  if (name === "create") openCreator(rules);
  if (name === "saved") renderSaved();
  window.scrollTo(0, 0);
}

for (const b of document.querySelectorAll(".tab")) b.addEventListener("click", () => showTab(b.dataset.tab));
$("submit").addEventListener("click", submit);
$("clear").addEventListener("click", clearBoard);
$("next").addEventListener("click", newRound);

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
