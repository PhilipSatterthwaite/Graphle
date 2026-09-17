const WORDS_PER_ROUND = 5;
const MAX_GUESSES = 4;
// Hints unlock after this many wrong guesses.
const HINTS = [
  { key: "definitions", label: "Definitions", after: 1 },
  { key: "magnitude", label: "Y-axis scale", after: 2 },
];
const LETTERS = "ABCDE";
const W = 240, H = 200, PAD = { l: 34, r: 8, t: 10, b: 24 };

const $ = (id) => document.getElementById(id);
const tooltip = $("tooltip");

let data, definitions;
let round;            // { words: graph order, shuffled: bank order }
let assignments;      // graph index -> word | null
let locked;           // graph index -> true once guessed correctly
let tried;            // graph index -> Set of words guessed wrong there
let wrongGuesses;
let flashing;         // graph indices to shake after a submit
let status;           // "playing" | "won" | "lost"
let selectedWord = null;
const stats = loadStats();

function loadStats() {
  try { return JSON.parse(localStorage.getItem("graphle-stats")) || { score: 0, streak: 0 }; }
  catch { return { score: 0, streak: 0 }; }
}
function saveStats() {
  try { localStorage.setItem("graphle-stats", JSON.stringify(stats)); } catch {}
}

const hintOn = (key) => status !== "playing" || wrongGuesses >= HINTS.find((h) => h.key === key).after;

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

function pickWords() {
  const all = Object.keys(data.series);
  let best;
  for (let attempt = 0; attempt < 200; attempt++) {
    const words = shuffle(all).slice(0, WORDS_PER_ROUND);
    const s = words.map((w) => data.series[w]);
    let maxCorr = -1;
    for (let i = 0; i < s.length; i++)
      for (let j = i + 1; j < s.length; j++) maxCorr = Math.max(maxCorr, correlation(s[i], s[j]));
    if (!best || maxCorr < best.maxCorr) best = { words, maxCorr };
    if (maxCorr < 0.85) break;
  }
  return best.words;
}

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

function drawChart(series, showValues) {
  const { yearStart, yearEnd } = data;
  const ymax = niceMax(Math.max(...series) || 1);
  const x = (yr) => PAD.l + ((yr - yearStart) / (yearEnd - yearStart)) * (W - PAD.l - PAD.r);
  const y = (v) => H - PAD.b - (v / ymax) * (H - PAD.t - PAD.b);

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img" });
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

function place(gi, word) {
  if (status !== "playing" || !word || locked[gi] || locked[assignments.indexOf(word)]) return;
  const prev = assignments.indexOf(word);
  if (prev >= 0) assignments[prev] = null;
  assignments[gi] = word;
  selectedWord = null;
  render();
}

function definitionText(word) {
  const def = definitions[word];
  return def ? [el("span", { className: "pos", textContent: def.pos }), def.text] : ["No definition available."];
}

function renderBank() {
  const wordsEl = $("words");
  wordsEl.replaceChildren();
  for (const w of round.shuffled) {
    const at = assignments.indexOf(w);
    const isLocked = at >= 0 && locked[at];
    const b = el("button", { className: "chip", textContent: w });
    if (at >= 0) {
      b.classList.add(isLocked ? "locked" : "placed");
      b.append(el("span", { className: "tag", textContent: (isLocked ? "✓ " : "→ ") + LETTERS[at] }));
    }
    if (w === selectedWord) b.classList.add("selected");
    b.disabled = status !== "playing" || isLocked;
    b.draggable = !b.disabled;
    b.addEventListener("click", () => {
      selectedWord = selectedWord === w ? null : w;
      render();
    });
    b.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", w));
    wordsEl.append(b);
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
  const guessesEl = $("guesses");
  guessesEl.replaceChildren("Guesses");
  for (let i = 0; i < MAX_GUESSES; i++) {
    const pip = el("span", { className: "pip" });
    if (i < wrongGuesses) pip.classList.add("used");
    else if (i === wrongGuesses && status === "won") pip.classList.add("win");
    guessesEl.append(pip);
  }

  const hintsEl = $("hints");
  hintsEl.replaceChildren();
  for (const h of HINTS) {
    const on = hintOn(h.key);
    const text = on ? `💡 ${h.label}` : `🔒 ${h.label} after ${h.after} wrong`;
    hintsEl.append(el("span", { className: "hint" + (on ? " on" : ""), textContent: text }));
  }

  const defsEl = $("definitions");
  defsEl.hidden = !hintOn("definitions");
  defsEl.replaceChildren();
  for (const w of round.shuffled) defsEl.append(el("dt", { textContent: w }), el("dd", {}, ...definitionText(w)));
}

function renderCharts() {
  const chartsEl = $("charts");
  chartsEl.replaceChildren();
  const showValues = hintOn("magnitude");
  round.words.forEach((word, gi) => {
    const card = el("div", { className: "card" });
    if (locked[gi]) card.classList.add("correct");
    else if (status === "lost") card.classList.add("revealed");
    else if (flashing.has(gi)) card.classList.add("flash");
    else if (selectedWord) card.classList.add("target");

    const slot = el("div", { className: "slot" + (assignments[gi] ? " filled" : "") });
    if (status === "lost" && !locked[gi]) slot.textContent = `It was: ${word}`;
    else slot.textContent = assignments[gi] ? (locked[gi] ? "✓ " : "") + assignments[gi] : "tap to place";
    if (assignments[gi] && !locked[gi] && status === "playing") {
      slot.draggable = true;
      slot.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", assignments[gi]));
    }

    const triedEl = el("div", { className: "tried" });
    if (tried[gi].size && !locked[gi]) {
      triedEl.append("Not: ");
      [...tried[gi]].forEach((w, i) => triedEl.append(i ? ", " : "", el("s", { textContent: w })));
    }

    card.append(el("div", { className: "letter", textContent: `Graph ${LETTERS[gi]}` }), drawChart(data.series[word], showValues), slot, triedEl);
    card.addEventListener("click", () => {
      if (status !== "playing" || locked[gi]) return;
      if (selectedWord) place(gi, selectedWord);
      else if (assignments[gi]) {
        assignments[gi] = null;
        render();
      }
    });
    card.addEventListener("dragover", (e) => { if (status === "playing" && !locked[gi]) e.preventDefault(); });
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      place(gi, e.dataTransfer.getData("text/plain"));
    });
    chartsEl.append(card);
  });
}

function render() {
  renderBank();
  renderStatus();
  renderCharts();
  flashing.clear();
  $("submit").hidden = status !== "playing";
  $("submit").disabled = assignments.some((a) => !a);
  $("next").hidden = status === "playing";
  $("score").textContent = stats.score;
  $("streak").textContent = stats.streak;
}

function newRound() {
  const words = pickWords();
  round = { words, shuffled: shuffle(words) };
  assignments = words.map(() => null);
  locked = words.map(() => false);
  tried = words.map(() => new Set());
  flashing = new Set();
  wrongGuesses = 0;
  status = "playing";
  selectedWord = null;
  $("result").textContent = "";
  render();
}

function submit() {
  let wrong = 0;
  round.words.forEach((word, gi) => {
    if (locked[gi]) return;
    if (assignments[gi] === word) {
      locked[gi] = true;
    } else {
      wrong++;
      tried[gi].add(assignments[gi]);
      assignments[gi] = null;
      flashing.add(gi);
    }
  });
  selectedWord = null;
  tooltip.hidden = true;

  if (wrong === 0) {
    status = "won";
    stats.score += 1;
    stats.streak += 1;
    const n = wrongGuesses + 1;
    $("result").textContent = `Solved in ${n} guess${n === 1 ? "" : "es"}! 🎉`;
  } else {
    wrongGuesses++;
    const unlocked = HINTS.find((h) => h.after === wrongGuesses);
    if (wrongGuesses >= MAX_GUESSES) {
      status = "lost";
      stats.streak = 0;
      $("result").textContent = "Out of guesses — answers revealed.";
    } else {
      const right = round.words.length - wrong;
      $("result").textContent = `${right} of ${round.words.length} correct.` + (unlocked ? ` Hint unlocked: ${unlocked.label.toLowerCase()}.` : "");
    }
  }
  if (status !== "playing") saveStats();
  render();
}

$("submit").addEventListener("click", submit);
$("next").addEventListener("click", newRound);

Promise.all(["data/ngrams.json", "data/definitions.json"].map((u) => fetch(u + "?v=3").then((r) => r.json())))
  .then(([ngrams, defs]) => {
    data = ngrams;
    definitions = defs;
    newRound();
  })
  .catch(() => {
    $("result").textContent = "Couldn't load word data. Serve this folder over HTTP (not file://).";
  });
