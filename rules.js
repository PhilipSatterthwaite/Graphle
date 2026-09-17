// Game rules: defaults, the hint catalog, and encoding rules into a shareable URL.

const HINT_TYPES = [
  { key: "definitions", code: "d", label: "Definitions", desc: "Shows every word's definition." },
  { key: "magnitude", code: "y", label: "Y-axis scale", desc: "Shows the numbers on each graph's y-axis." },
  { key: "reveal", code: "r", label: "Reveal one match", desc: "Locks one graph's correct word in place." },
  { key: "check", code: "c", label: "Check one graph", desc: "Player picks a graph to learn if its word is right." },
];

const DEFAULT_RULES = {
  n: 5,               // words per round: 3, 4, or 5
  guesses: 6,
  feedback: "count",  // "count": only how many are right; "exact": which ones are right
  logic: false,       // color past guesses by whether the current arrangement is consistent with them
  // Wrong guesses needed to unlock each hint (0 = from the start), or null for off.
  hints: { definitions: 1, magnitude: 2, reveal: 3, check: null },
  words: null,        // hand-picked words for the first round, or null for random
};

const MAX_GUESS_SETTING = 10;

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
  p.set("h", HINT_TYPES.filter((h) => r.hints[h.key] !== null).map((h) => h.code + r.hints[h.key]).join(","));
  if (r.words) p.set("p", encodeWords(r.words));
  return "?" + p.toString().replace(/%2C/g, ",");
}

function hintTimingLabel(at) {
  if (at === null) return "off";
  if (at === 0) return "from the start";
  return `after ${at} wrong`;
}
