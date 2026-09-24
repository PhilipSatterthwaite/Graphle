// Builds the game's data from scripts/words/*.txt (lines of `word | pos | definition`):
//   data/ngrams.json       quantized Google Books Ngram series per word
//   data/definitions.json  definitions per word
// The Ngram endpoint has no CORS headers, so the browser can't call it from
// github.io; the game reads these static files instead.
//
// Counts are case-insensitive: "jazz (All)" sums jazz, Jazz and JAZZ, which is what a
// player means by a word. Raw responses are cached in scripts/.ngram-ci-cache.json
// (gitignored), so re-runs only fetch words that are new.
//
// Usage: node scripts/fetch-ngrams.mjs
import { readFile, writeFile, readdir } from "node:fs/promises";

const YEAR_START = 1800;
const YEAR_END = 2022;
const SMOOTHING = 3;
const CORPUS = "en";
const BATCH = 12;
// Words whose peak is below this (per billion words) are too rare to graph well.
const MIN_PEAK = 50;

const root = new URL("..", import.meta.url);
const path = (p) => new URL(p, root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Parse word lists.
const entries = new Map();
const duplicates = [];
for (const file of (await readdir(path("scripts/words/"))).filter((f) => f.endsWith(".txt")).sort()) {
  const lines = (await readFile(path(`scripts/words/${file}`), "utf8")).split(/\r?\n/);
  for (const [n, line] of lines.entries()) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [word, pos, ...rest] = line.split("|").map((s) => s.trim());
    const text = rest.join("|");
    if (!word || !pos || !text || !/^[a-z]+$/.test(word)) {
      console.warn(`Skipping malformed line ${file}:${n + 1}: ${line}`);
      continue;
    }
    if (entries.has(word)) duplicates.push(word);
    else entries.set(word, { pos, text });
  }
}

let cache = {};
try { cache = JSON.parse(await readFile(path("scripts/.ngram-ci-cache.json"), "utf8")); } catch {}

// Fetch uncached words.
const todo = [...entries.keys()].filter((w) => !(w in cache));
console.log(`${entries.size} words, ${todo.length} to fetch.`);
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const url =
    "https://books.google.com/ngrams/json?" +
    new URLSearchParams({
      content: batch.join(","),
      year_start: YEAR_START,
      year_end: YEAR_END,
      corpus: CORPUS,
      smoothing: SMOOTHING,
      case_insensitive: "true",
    });
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url).catch((e) => ({ ok: false, status: e.message }));
    if (res.ok) {
      const byWord = new Map((await res.json()).map((r) => [r.ngram, r.timeseries]));
      // The combined series is returned as "word (All)"; a word with only one casing
      // in the corpus comes back under its own name instead.
      for (const w of batch) cache[w] = byWord.get(`${w} (All)`) ?? byWord.get(w) ?? null;
      break;
    }
    if (attempt === 5) throw new Error(`Giving up after HTTP ${res.status}`);
    const wait = 5000 * 2 ** attempt;
    console.warn(`\nHTTP ${res.status}; retrying in ${wait / 1000}s`);
    await sleep(wait);
  }
  process.stdout.write(`\r${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  if ((i / BATCH) % 10 === 9) await writeFile(path("scripts/.ngram-ci-cache.json"), JSON.stringify(cache));
  await sleep(1000);
}
await writeFile(path("scripts/.ngram-ci-cache.json"), JSON.stringify(cache));

// Build outputs. Each series is stored as its peak (per billion words) plus
// integer percentages of that peak, which keeps the file small.
const series = {};
const definitions = {};
const tooRare = [];
for (const [word, def] of entries) {
  const ts = cache[word];
  const values = (ts ?? []).map((v) => v * 1e9);
  const peak = Math.max(0, ...values);
  if (peak < MIN_PEAK) {
    tooRare.push(word);
    continue;
  }
  series[word] = { max: Number(peak.toPrecision(3)), q: values.map((v) => Math.round((v / peak) * 100)) };
  definitions[word] = def;
}

const out = { yearStart: YEAR_START, yearEnd: YEAR_END, unit: "per billion words", series };
await writeFile(path("data/ngrams.json"), JSON.stringify(out));
await writeFile(path("data/definitions.json"), JSON.stringify(definitions));
console.log(`\nWrote ${Object.keys(series).length} words.`);
if (duplicates.length) console.log(`Duplicates ignored (${duplicates.length}):`, duplicates.join(", "));
if (tooRare.length) console.log(`Dropped, too rare or no data (${tooRare.length}):`, tooRare.join(", "));
