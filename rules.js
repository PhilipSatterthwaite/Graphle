// Game rules: defaults, the hint catalog, and encoding rules into a shareable URL.

const HINT_TYPES = [
  { key: "definitions", code: "d", label: "Definitions", desc: "Shows every word's definition." },
  { key: "magnitude", code: "y", label: "Y-axis scale", desc: "Shows the numbers on each graph's y-axis." },
  { key: "reveal", code: "r", label: "Reveal one match", desc: "Locks one graph's correct word in place." },
  { key: "check", code: "c", label: "Check one graph", desc: "Player picks a graph to learn if its word is right." },
  { key: "curve", code: "l", label: "Full curves", desc: "Until this unlocks, each graph shows only a marker at its peak year." },
];

const DEFAULT_RULES = {
  n: 5,               // words per round: 3, 4, or 5
  guesses: 6,
  feedback: "count",  // "count": only how many are right; "exact": which ones are right
  logic: false,       // color past guesses by whether the current arrangement is consistent with them
  // Wrong guesses needed to unlock each hint (0 = from the start), or null for off.
  hints: { definitions: 1, magnitude: 2, reveal: 3, check: null, curve: 0 },
  minPeak: 50,        // random rounds only use words peaking at least this high (per billion words)
  maxR2: 0.3,         // cap on how similar any two graphs in a round may be (R², shape only)
  words: null,        // hand-picked words for the first round, or null for random
};

const MAX_GUESS_SETTING = 10;
// Slider stops for the minimum peak, in uses per billion words. The data itself
// already excludes anything below 50.
const MIN_PEAK_STEPS = [50, 75, 100, 150, 250, 400, 600, 1000, 1500, 2500, 4000, 6000, 10000, 20000];

// Similarity caps for a round's graphs, as R² between curve shapes.
// 1 means no cap; smaller numbers force more clearly different curves.
const R2_STEPS = [1, 0.7, 0.5, 0.3, 0.2, 0.1, 0.05, 0.02];

function formatR2(v) {
  return v === 1 ? "no limit" : v.toFixed(2).replace(/0$/, "");
}

function formatPeak(v) {
  return v >= 1000 ? (v / 1000) + "k" : String(v);
}

function cloneRules(r) {
  return { ...r, hints: { ...r.hints }, words: r.words ? [...r.words] : null };
}

// Hand-picked words are lightly obfuscated so a shared link doesn't show the answers at a glance.
function encodeWords(words) {
  return btoa(unescape(encodeURIComponent(words.join(",")))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeWords(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(b64))).split(",").filter(Boolean);
}

function rulesFromQuery(search) {
  const p = new URLSearchParams(search);
  const r = cloneRules(DEFAULT_RULES);
  const n = Number(p.get("n"));
  if ([3, 4, 5].includes(n)) r.n = n;
  const g = Number(p.get("g"));
  if (Number.isInteger(g) && g >= 1 && g <= MAX_GUESS_SETTING) r.guesses = g;
  if (p.get("fb") === "exact") r.feedback = "exact";
  if (p.get("lg") === "1") r.logic = true;
  const r2 = Number(p.get("r2"));
  if (R2_STEPS.includes(r2)) r.maxR2 = r2;
  const mp = Number(p.get("mp"));
  if (Number.isFinite(mp) && mp >= MIN_PEAK_STEPS[0]) r.minPeak = mp;
  if (p.has("h")) {
    for (const h of HINT_TYPES) r.hints[h.key] = null;
    for (const part of p.get("h").split(",")) {
      const h = HINT_TYPES.find((t) => t.code === part[0]);
      const at = Number(part.slice(1));
      if (h && part.length > 1 && Number.isInteger(at) && at >= 0) r.hints[h.key] = Math.min(at, r.guesses - 1);
    }
  }
  if (p.has("p")) {
    try {
      const words = decodeWords(p.get("p"));
      if (words.length === r.n) r.words = words;
    } catch {}
  }
  return r;
}

function rulesToQuery(r) {
  const p = new URLSearchParams();
  p.set("n", r.n);
  p.set("g", r.guesses);
  p.set("fb", r.feedback);
  if (r.logic) p.set("lg", "1");
  if (r.minPeak !== DEFAULT_RULES.minPeak) p.set("mp", r.minPeak);
  if (r.maxR2 !== DEFAULT_RULES.maxR2) p.set("r2", r.maxR2);
  p.set("h", HINT_TYPES.filter((h) => r.hints[h.key] !== null).map((h) => h.code + r.hints[h.key]).join(","));
  if (r.words) p.set("p", encodeWords(r.words));
  return "?" + p.toString().replace(/%2C/g, ",");
}

function hintTimingLabel(at) {
  if (at === null) return "off";
  if (at === 0) return "from the start";
  return `after ${at} wrong`;
}
