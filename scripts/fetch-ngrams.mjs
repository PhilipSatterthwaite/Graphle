// Pre-fetches Google Books Ngram data for every word in words.txt and writes
// data/ngrams.json. The Ngram endpoint has no CORS headers, so the browser
// can't call it from github.io; the game reads this static file instead.
//
// Usage: node scripts/fetch-ngrams.mjs
import { readFile, writeFile } from "node:fs/promises";

const YEAR_START = 1800;
const YEAR_END = 2022;
const SMOOTHING = 3;
const CORPUS = "en";
const BATCH = 10;

const root = new URL("..", import.meta.url);
const words = (await readFile(new URL("scripts/words.txt", root), "utf8"))
  .split(/\r?\n/)
  .map((w) => w.trim())
  .filter((w) => w && !w.startsWith("#"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const series = {};
const missing = [];

for (let i = 0; i < words.length; i += BATCH) {
  const batch = words.slice(i, i + BATCH);
  const url =
    "https://books.google.com/ngrams/json?" +
    new URLSearchParams({
      content: batch.join(","),
      year_start: YEAR_START,
      year_end: YEAR_END,
      corpus: CORPUS,
      smoothing: SMOOTHING,
    });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${batch.join(",")}`);
  const rows = await res.json();
  const byWord = new Map(rows.map((r) => [r.ngram, r.timeseries]));
  for (const w of batch) {
    const ts = byWord.get(w);
    if (!ts || ts.every((v) => v === 0)) {
      missing.push(w);
      continue;
    }
    // Store as occurrences per billion words, 3 significant figures.
    series[w] = ts.map((v) => Number((v * 1e9).toPrecision(3)));
  }
  process.stdout.write(`\r${Math.min(i + BATCH, words.length)}/${words.length}`);
  await sleep(800);
}

const out = { yearStart: YEAR_START, yearEnd: YEAR_END, unit: "per billion words", series };
await writeFile(new URL("data/ngrams.json", root), JSON.stringify(out));
console.log(`\nWrote ${Object.keys(series).length} words.`);
if (missing.length) console.log("No data for:", missing.join(", "));
