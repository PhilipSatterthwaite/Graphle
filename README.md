# Graphle

Match words to their Google Books Ngram graphs.

The game: four graphs across the top, a slot under each, and the word bank
below. Three guesses. Each submission says only how many are right; the y-axis
scale is revealed after one wrong guess, and after two a graph the player
already had right is confirmed. Past guesses are colored by whether the current
arrangement is still consistent with them.

Two side pages are linked discreetly in the footer:

- **Rules & sharing** — words per round (3–5), guesses, feedback style, hint
  timing, graph variety (R² cap), word frequency floor, opening view, and
  hand-picked words. Every setting is encoded in a share link.
- **Saved & deleted** — words starred with ☆, and words removed with ✕, both
  kept in the browser and exportable as text.

Rules live in the URL query (`n`, `g`, `fb`, `lg`, `mp`, `r2`, `pf`, `h`, and
`p` for hand-picked words). Hand-picked words only apply to the first round.

## Run locally

`fetch` doesn't work over `file://`, so serve the folder:

```
python -m http.server 8000
```

Then open http://localhost:8000.

## Word list

Words and their definitions live in themed files under `scripts/words/`, one
entry per line:

```
hornswoggle | verb | To swindle, cheat, or hoax someone.
```

Only single lowercase words work (no hyphens, spaces, or digits). After editing,
rebuild the data:

```
node scripts/fetch-ngrams.mjs
```

This writes `data/ngrams.json` and `data/definitions.json`.

`node scripts/fetch-books.mjs` writes `data/books.json`: a book published around
each word's peak whose title contains the word, used by the "Peak-era book" hint. Raw Ngram responses
are cached in `scripts/.ngram-cache.json`, so only new words are downloaded.
Words peaking below 50 per billion words (`MIN_PEAK` in the script) are dropped and listed in the output.

The Ngram endpoint doesn't allow cross-origin browser requests, so the data is
fetched ahead of time and served as a static file.

Default rules and the hint catalog are in `rules.js`.
When you change the game files, bump the `?v=` numbers in `index.html` and `game.js`
so browsers fetch the new versions.

## Deploy to GitHub Pages

Push to a GitHub repo, then Settings → Pages → Deploy from branch → `main` / root.
