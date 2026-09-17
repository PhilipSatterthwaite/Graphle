const WORDS_PER_ROUND = 5;
const MAX_GUESSES = 6;
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
let history;          // [{ guess: [word by graph index], correct: number }]
let wrongGuesses;
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

const sameAsPastGuess = () => history.some((h) => h.guess.every((w, gi) => w === assignments[gi]));

function place(gi, word) {
  if (status !== "playing" || !word) return;
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
    const b = el("button", { className: "chip", textContent: w });
    if (at >= 0) {
      b.classList.add("placed");
      b.append(el("span", { className: "tag", textContent: "→ " + LETTERS[at] }));
    }
    if (w === selectedWord) b.classList.add("selected");
    b.disabled = status !== "playing";
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

  const histEl = $("history");
  histEl.hidden = history.length === 0;
  const tbody = el("tbody");
  history.forEach((h, i) => {
    const row = el("tr", {}, el("td", { className: "n", textContent: i + 1 }));
    h.guess.forEach((w) => row.append(el("td", { textContent: w })));
    row.append(el("td", { className: "count", textContent: `${h.correct} / ${WORDS_PER_ROUND}` }));
    tbody.append(row);
  });
  const head = el("tr", {}, el("th", { textContent: "#" }));
  for (let gi = 0; gi < WORDS_PER_ROUND; gi++) head.append(el("th", { textContent: LETTERS[gi] }));
  head.append(el("th", { textContent: "Correct" }));
  histEl.querySelector("table").replaceChildren(el("thead", {}, head), tbody);
}

function renderCharts() {
  const chartsEl = $("charts");
  chartsEl.replaceChildren();
  const showValues = hintOn("magnitude");
  round.words.forEach((word, gi) => {
    const placed = assignments[gi];
    const card = el("div", { className: "card" });
    const slot = el("div", { className: "slot" + (placed ? " filled" : "") });

    if (status === "won") {
      card.classList.add("correct");
      slot.textContent = "✓ " + word;
    } else if (status === "lost") {
      card.classList.add(placed === word ? "correct" : "revealed");
      slot.textContent = placed === word ? "✓ " + word : `It was: ${word}`;
    } else {
      if (selectedWord) card.classList.add("target");
      slot.textContent = placed || "tap to place";
      if (placed) {
        slot.draggable = true;
        slot.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", placed));
      }
    }

    card.append(el("div", { className: "letter", textContent: `Graph ${LETTERS[gi]}` }), drawChart(data.series[word], showValues), slot);
    card.addEventListener("click", () => {
      if (status !== "playing") return;
      if (selectedWord) place(gi, selectedWord);
      else if (placed) {
        assignments[gi] = null;
        render();
      }
    });
    card.addEventListener("dragover", (e) => { if (status === "playing") e.preventDefault(); });
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
  const full = assignments.every(Boolean);
  const repeat = status === "playing" && full && sameAsPastGuess();
  $("submit").hidden = status !== "playing";
  $("submit").disabled = !full || repeat;
  $("submit-note").textContent = repeat ? "You already tried this exact arrangement." : "";
  $("next").hidden = status === "playing";
  $("score").textContent = stats.score;
  $("streak").textContent = stats.streak;
}

function newRound() {
  const words = pickWords();
  round = { words, shuffled: shuffle(words) };
  assignments = words.map(() => null);
  history = [];
  wrongGuesses = 0;
  status = "playing";
  selectedWord = null;
  $("result").textContent = "";
  render();
}

function submit() {
  const guess = [...assignments];
  const correct = guess.filter((w, gi) => w === round.words[gi]).length;
  history.push({ guess, correct });
  selectedWord = null;
  tooltip.hidden = true;

  if (correct === WORDS_PER_ROUND) {
    status = "won";
    stats.score += 1;
    stats.streak += 1;
    const n = history.length;
    $("result").textContent = `Solved in ${n} guess${n === 1 ? "" : "es"}! 🎉`;
  } else {
    wrongGuesses++;
    const unlocked = HINTS.find((h) => h.after === wrongGuesses);
    if (wrongGuesses >= MAX_GUESSES) {
      status = "lost";
      stats.streak = 0;
      $("result").textContent = "Out of guesses — answers revealed.";
    } else {
      $("result").textContent = `${correct} of ${WORDS_PER_ROUND} correct.` + (unlocked ? ` Hint unlocked: ${unlocked.label.toLowerCase()}.` : "");
    }
  }
  if (status !== "playing") saveStats();
  render();
}

$("submit").addEventListener("click", submit);
$("next").addEventListener("click", newRound);

Promise.all(["data/ngrams.json", "data/definitions.json"].map((u) => fetch(u + "?v=7").then((r) => r.json())))
  .then(([ngrams, defs]) => {
    // Series are stored as a peak plus percentages of it; expand to values.
    for (const [w, { max, q }] of Object.entries(ngrams.series)) ngrams.series[w] = q.map((p) => (p * max) / 100);
    data = ngrams;
    definitions = defs;
    newRound();
  })
  .catch(() => {
    $("result").textContent = "Couldn't load word data. Serve this folder over HTTP (not file://).";
  });
