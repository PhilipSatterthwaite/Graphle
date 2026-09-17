# Graphle

Match words to their Google Books Ngram graphs.

The page has two tabs:

- **Play** — the game under the current rules.
- **Create & share** — choose words per round (3–5), number of guesses, feedback
  style (how many are right vs. which ones are right), when each hint unlocks
  (definitions, y-axis scale, reveal one match, check one graph), and random or
  hand-picked words. "Play these rules" applies them; the share link encodes them.

Rules live in the URL query (`n`, `g`, `fb`, `h`, and `p` for hand-picked
words), so any link reproduces a rule set. Hand-picked words only apply to the
first round; later rounds are random.

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

This writes `data/ngrams.json` and `data/definitions.json`. Raw Ngram responses
are cached in `scripts/.ngram-cache.json`, so only new words are downloaded.
Words too rare to graph well are dropped and listed in the output.

The Ngram endpoint doesn't allow cross-origin browser requests, so the data is
fetched ahead of time and served as a static file.

Default rules and the hint catalog are in `rules.js`.
When you change the game files, bump the `?v=` numbers in `index.html` and `game.js`
so browsers fetch the new versions.

## Deploy to GitHub Pages

Push to a GitHub repo, then Settings → Pages → Deploy from branch → `main` / root.
