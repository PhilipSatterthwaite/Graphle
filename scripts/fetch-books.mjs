// For each word in data/ngrams.json, finds a book published around the word's peak
// year whose title contains the word, preferring the one with the most editions
// (a rough stand-in for popularity). Writes data/books.json.
//
// Source: Open Library search API (free, no key). Results are cached in
// scripts/.books-cache.json (gitignored) so re-runs only fetch new words.
//
// Usage: node scripts/fetch-books.mjs
import { readFile, writeFile } from "node:fs/promises";

const WINDOW = 20;        // years either side of the peak
const MIN_EDITIONS = 1;
const DELAY_MS = 700;     // be polite to Open Library

const root = new URL("..", import.meta.url);
const path = (p) => new URL(p, root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ngrams = JSON.parse(await readFile(path("data/ngrams.json"), "utf8"));
const words = Object.keys(ngrams.series);

let cache = {};
try { cache = JSON.parse(await readFile(path("scripts/.books-cache.json"), "utf8")); } catch {}

const peakYear = (w) => {
  const q = ngrams.series[w].q;
  return ngrams.yearStart + q.indexOf(Math.max(...q));
};

const todo = words.filter((w) => !(w in cache));
console.log(`${words.length} words, ${todo.length} to fetch.`);

for (const [i, word] of todo.entries()) {
  const year = peakYear(word);
  const url =
    "https://openlibrary.org/search.json?" +
    new URLSearchParams({
      q: `title:${word} AND first_publish_year:[${year - WINDOW} TO ${year + WINDOW}]`,
      fields: "title,author_name,first_publish_year,edition_count",
      sort: "editions",
      limit: "20",
    });
  let docs = [];
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Graphle word game (github.com/PhilipSatterthwaite/Graphle)" } });
      if (res.ok) {
        docs = (await res.json()).docs ?? [];
        break;
      }
      if (res.status !== 429 && res.status < 500) break;
    } catch {}
    if (attempt === 4) break;
    await sleep(5000 * 2 ** attempt);
  }

  // Keep only titles that really contain the word, then take the most-published one.
  const re = new RegExp(`\\b${word}`, "i");
  const best = docs
    .filter((d) => d.title && re.test(d.title) && (d.edition_count ?? 0) >= MIN_EDITIONS)
    .sort((a, b) => (b.edition_count ?? 0) - (a.edition_count ?? 0))[0];

  cache[word] = best
    ? { title: best.title, author: best.author_name?.[0] ?? null, year: best.first_publish_year, editions: best.edition_count ?? 0 }
    : null;

  if (i % 25 === 24) {
    await writeFile(path("scripts/.books-cache.json"), JSON.stringify(cache));
    process.stdout.write(`\r${i + 1}/${todo.length}`);
  }
  await sleep(DELAY_MS);
}
await writeFile(path("scripts/.books-cache.json"), JSON.stringify(cache));

const books = {};
for (const w of words) if (cache[w]) books[w] = cache[w];
await writeFile(path("data/books.json"), JSON.stringify(books));
console.log(`\nWrote ${Object.keys(books).length} book titles for ${words.length} words.`);
