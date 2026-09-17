const LETTERS = "ABCDE";
const W = 240, H = 200, PAD = { l: 34, r: 8, t: 10, b: 24 };

const $ = (id) => document.getElementById(id);
const tooltip = $("tooltip");

let data, definitions;
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
  if (status !== "playing" && (key === "definitions" || key === "magnitude")) return true;
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

function pickWords(n) {
  const all = Object.keys(data.series);
  let best;
  for (let attempt = 0; attempt < 200; attempt++) {
    const words = shuffle(all).slice(0, n);
    const s = words.map((w) => data.series[w]);
    let maxCorr = -1;
    for (let i = 0; i < s.length; i++)
      for (let j = i + 1; j < s.length; j++) maxCorr = Math.max(maxCorr, correlation(s[i], s[j]));
    if (!best || maxCorr < best.maxCorr) best = { words, maxCorr };
    if (maxCorr < 0.85) break;
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

const sameAsPastGuess = () => guesses.some((h) => h.guess.every((w, gi) => w === assignments[gi]));

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

// Give away one graph's word, preferring graphs the last guess got wrong so the hint adds information.
function revealMatch() {
  const open = round.words.map((w, gi) => gi).filter((gi) => !locked[gi]);
  if (!open.length) return;
  const last = guesses.at(-1);
  const preferred = open.filter((gi) => !last || last.guess[gi] !== round.words[gi]);
  const pool = preferred.length ? preferred : open;
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
    message = `Check: “${word}” is right for graph ${LETTERS[gi]}.`;
  } else {
    knownWrong[gi].add(word);
    lastWrong.add(gi);
    message = `Check: “${word}” is not graph ${LETTERS[gi]}.`;
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
    wordsEl.append(el("span", { className: "chip-wrap" }, b, starButton(w)));
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
  for (let i = 0; i < rules.guesses; i++) {
    const pip = el("span", { className: "pip" });
    if (i < wrongGuesses) pip.classList.add("used");
    else if (i === wrongGuesses && status === "won") pip.classList.add("win");
    guessesEl.append(pip);
  }

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
  for (const w of round.shuffled) defsEl.append(el("dt", {}, w, starButton(w)), el("dd", {}, ...definitionText(w)));

  const histEl = $("history");
  histEl.hidden = guesses.length === 0;
  const tbody = el("tbody");
  const showLogic = rules.logic && status === "playing";
  guesses.forEach((h, i) => {
    const row = el("tr", {}, el("td", { className: "n", textContent: i + 1 }));
    const logic = showLogic ? logicCheck(h) : null;
    if (logic) row.className = "logic-" + logic;
    h.guess.forEach((w, gi) => {
      const cell = el("td", { textContent: w });
      if (rules.feedback === "exact") cell.className = w === round.words[gi] ? "ok" : "bad";
      row.append(cell);
    });
    row.append(el("td", { className: "count", textContent: `${h.correct} / ${rules.n}` }));
    if (logic) row.append(el("td", { className: "logic", textContent: { fits: "✓ fits", conflicts: "✗ conflicts", open: "…" }[logic] }));
    tbody.append(row);
  });
  const head = el("tr", {}, el("th", { textContent: "#" }));
  for (let gi = 0; gi < rules.n; gi++) head.append(el("th", { textContent: LETTERS[gi] }));
  head.append(el("th", { textContent: "Correct" }));
  if (showLogic) head.append(el("th", { textContent: "Your arrangement", title: "Whether your current arrangement is consistent with each past result" }));
  histEl.querySelector("table").replaceChildren(el("thead", {}, head), tbody);
}

function renderCharts() {
  const chartsEl = $("charts");
  chartsEl.replaceChildren();
  chartsEl.style.setProperty("--cols", rules.n);
  const showValues = hintOn("magnitude");
  round.words.forEach((word, gi) => {
    const placed = assignments[gi];
    const card = el("div", { className: "card" });
    const slot = el("div", { className: "slot" + (placed ? " filled" : "") });
    const note = el("div", { className: "note" });

    if (locked[gi] || status === "won") {
      card.classList.add("correct");
      slot.textContent = "✓ " + word;
    } else if (status === "lost") {
      card.classList.add(placed === word ? "correct" : "revealed");
      slot.textContent = placed === word ? "✓ " + word : `It was: ${word}`;
    } else {
      if (selectedWord) card.classList.add("target");
      if (lastWrong.has(gi)) card.classList.add("wrong");
      slot.textContent = placed || "tap to place";
      if (placed) {
        slot.draggable = true;
        slot.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", placed));
      }
      if (knownWrong[gi].size) note.append("Not: " + [...knownWrong[gi]].join(", "));
      if (checksLeft > 0 && placed) {
        const btn = el("button", { className: "check-btn", textContent: "Check this graph" });
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          checkGraph(gi);
        });
        note.append(btn);
      }
    }

    // Starring a graph's word is only offered once the word is known, so it can't leak the answer.
    const known = status !== "playing" || locked[gi];
    const letter = el("div", { className: "letter" }, `Graph ${LETTERS[gi]}`, known ? starButton(word) : "");
    card.append(letter, drawChart(data.series[word], showValues), slot, note);
    card.addEventListener("click", () => {
      if (status !== "playing" || locked[gi]) return;
      if (selectedWord) place(gi, selectedWord);
      else if (placed) unplace(placed);
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
  renderRulesSummary();
  renderBank();
  renderStatus();
  renderCharts();
  const full = assignments.every(Boolean);
  const repeat = status === "playing" && full && sameAsPastGuess();
  $("submit").hidden = status !== "playing";
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
$("edit-rules").addEventListener("click", () => showTab("create"));
$("submit").addEventListener("click", submit);
$("next").addEventListener("click", newRound);
// Dropping a placed word back on the word bank takes it off its graph.
$("words").addEventListener("dragover", (e) => e.preventDefault());
$("words").addEventListener("drop", (e) => {
  e.preventDefault();
  unplace(e.dataTransfer.getData("text/plain"));
});

Promise.all(["data/ngrams.json", "data/definitions.json"].map((u) => fetch(u + "?v=9").then((r) => r.json())))
  .then(([ngrams, defs]) => {
    // Series are stored as a peak plus percentages of it; expand to values.
    for (const [w, { max, q }] of Object.entries(ngrams.series)) ngrams.series[w] = q.map((p) => (p * max) / 100);
    data = ngrams;
    definitions = defs;
    newRound();
    showTab(["#create", "#saved"].includes(location.hash) ? location.hash.slice(1) : "play");
  })
  .catch((err) => {
    console.error(err);
    $("result").textContent = "Couldn't load word data. Serve this folder over HTTP (not file://).";
  });
