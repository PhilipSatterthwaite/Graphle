# Graphle

Match five words to their Google Books Ngram graphs. Each submission only tells
you how many are correct, and a table of past guesses helps you work it out.
Wrong guesses unlock hints (definitions, then the y-axis scale). Six guesses per round.

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

Round size, guess count, and hint thresholds are constants at the top of `game.js`.
When you change the game files, bump the `?v=` numbers in `index.html` and `game.js`
so browsers fetch the new versions.

## Deploy to GitHub Pages

Push to a GitHub repo, then Settings → Pages → Deploy from branch → `main` / root.
