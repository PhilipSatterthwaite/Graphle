const LETTERS = ["A", "B", "C"];
const COLORS = ["var(--s-a)", "var(--s-b)", "var(--s-c)"];
const W = 340, H = 200, PAD = { l: 44, r: 10, t: 10, b: 24 };

const $ = (id) => document.getElementById(id);
const tooltip = $("tooltip");

let data;
let round;            // { words: graph order, shuffled: chip order }
let assignments;      // graph index -> word
let selectedWord = null;
let checked = false;
const stats = loadStats();

function loadStats() {
  try { return JSON.parse(localStorage.getItem("graphle-stats")) || { score: 0, streak: 0 }; }
  catch { return { score: 0, streak: 0 }; }
}
function saveStats() {
  try { localStorage.setItem("graphle-stats", JSON.stringify(stats)); } catch {}
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

function pickWords() {
  const all = Object.keys(data.series);
  let best;
  for (let attempt = 0; attempt < 50; attempt++) {
    const words = shuffle(all).slice(0, 3);
    const s = words.map((w) => data.series[w]);
    const maxCorr = Math.max(correlation(s[0], s[1]), correlation(s[0], s[2]), correlation(s[1], s[2]));
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

function svgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function drawChart(series, color) {
  const { yearStart, yearEnd } = data;
  const ymax = niceMax(Math.max(...series) || 1);
  const x = (yr) => PAD.l + ((yr - yearStart) / (yearEnd - yearStart)) * (W - PAD.l - PAD.r);
  const y = (v) => H - PAD.b - (v / ymax) * (H - PAD.t - PAD.b);

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img" });
  for (let i = 0; i <= 4; i++) {
    const v = (ymax * i) / 4;
    svg.append(svgEl("line", { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), class: i ? "grid" : "axis" }));
    const t = svgEl("text", { x: PAD.l - 6, y: y(v) + 4, "text-anchor": "end" });
    t.textContent = fmt(v);
    svg.append(t);
  }
  for (const yr of [1800, 1850, 1900, 1950, 2000]) {
    const t = svgEl("text", { x: x(yr), y: H - 6, "text-anchor": "middle" });
    t.textContent = yr;
    svg.append(t);
  }
  const d = series.map((v, i) => `${i ? "L" : "M"}${x(yearStart + i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  svg.append(svgEl("path", { d, class: "line", stroke: color }));

  const cross = svgEl("line", { y1: PAD.t, y2: H - PAD.b, class: "cross", visibility: "hidden" });
  const dot = svgEl("circle", { r: 4, class: "dot", fill: color, visibility: "hidden" });
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
    tooltip.innerHTML = `<b>${yearStart + i}</b> <span class="y">${fmt(series[i])} per billion words</span>`;
    tooltip.hidden = false;
    tooltip.style.left = Math.min(e.clientX + 12, innerWidth - tooltip.offsetWidth - 8) + "px";
    tooltip.style.top = e.clientY - 40 + "px";
  });
  svg.addEventListener("pointerleave", hide);
  return svg;
}

function place(gi, word) {
  if (checked || !word) return;
  const prev = assignments.indexOf(word);
  if (prev >= 0) assignments[prev] = null;
  assignments[gi] = word;
  selectedWord = null;
  render();
}

function renderWords() {
  const wordsEl = $("words");
  wordsEl.replaceChildren();
  for (const w of round.shuffled) {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = w;
    const placedAt = assignments.indexOf(w);
    if (placedAt >= 0) {
      b.classList.add("placed");
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "→ " + LETTERS[placedAt];
      b.append(tag);
    }
    if (w === selectedWord) b.classList.add("selected");
    b.disabled = checked;
    b.draggable = !checked;
    b.addEventListener("click", () => {
      selectedWord = selectedWord === w ? null : w;
      render();
    });
    b.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", w);
    });
    wordsEl.append(b);
  }
}

function renderCharts() {
  const chartsEl = $("charts");
  chartsEl.replaceChildren();
  round.words.forEach((word, gi) => {
    const card = document.createElement("div");
    card.className = "card";
    if (!checked && selectedWord) card.classList.add("target");
    if (checked) card.classList.add(assignments[gi] === word ? "correct" : "wrong");

    const head = document.createElement("div");
    head.className = "card-head";
    head.innerHTML = `<span class="letter"><span class="swatch" style="background:${COLORS[gi]}"></span>Graph ${LETTERS[gi]}</span>`;
    const slot = document.createElement("span");
    slot.className = "slot" + (assignments[gi] ? " filled" : "");
    slot.textContent = assignments[gi] || "drop a word";
    head.append(slot);

    const answer = document.createElement("p");
    answer.className = "answer";
    if (checked) {
      answer.innerHTML = assignments[gi] === word
        ? `<span class="ok">✓ Correct</span>`
        : `<span class="no">✗</span> It was <b>${word}</b>`;
    }

    card.append(head, drawChart(data.series[word], COLORS[gi]), answer);
    card.addEventListener("click", () => {
      if (checked) return;
      if (selectedWord) place(gi, selectedWord);
      else if (assignments[gi]) {
        assignments[gi] = null;
        render();
      }
    });
    card.addEventListener("dragover", (e) => { if (!checked) e.preventDefault(); });
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      place(gi, e.dataTransfer.getData("text/plain"));
    });
    chartsEl.append(card);
  });
}

function render() {
  renderWords();
  renderCharts();
  $("submit").disabled = assignments.some((a) => !a);
  $("submit").hidden = checked;
  $("next").hidden = !checked;
  $("score").textContent = stats.score;
  $("streak").textContent = stats.streak;
}

function newRound() {
  const words = pickWords();
  round = { words, shuffled: shuffle(words) };
  assignments = [null, null, null];
  selectedWord = null;
  checked = false;
  $("result").textContent = "";
  render();
}

$("submit").addEventListener("click", () => {
  checked = true;
  const correct = round.words.filter((w, i) => assignments[i] === w).length;
  if (correct === 3) {
    stats.score += 1;
    stats.streak += 1;
    $("result").textContent = "Perfect! 🎉";
  } else {
    stats.streak = 0;
    $("result").textContent = `${correct} of 3 correct.`;
  }
  saveStats();
  tooltip.hidden = true;
  render();
});
$("next").addEventListener("click", newRound);

fetch("data/ngrams.json")
  .then((r) => r.json())
  .then((json) => {
    data = json;
    newRound();
  })
  .catch(() => {
    $("result").textContent = "Couldn't load word data. Serve this folder over HTTP (not file://).";
  });
