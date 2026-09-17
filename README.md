# Graphle

Match three words to their Google Books Ngram graphs.

## Run locally

`fetch` doesn't work over `file://`, so serve the folder:

```
python -m http.server 8000
```

Then open http://localhost:8000.

## Word list

Words live in `scripts/words.txt`. After editing, refresh the data:

```
node scripts/fetch-ngrams.mjs
```

This writes `data/ngrams.json`. The Ngram endpoint doesn't allow cross-origin
browser requests, so the data is fetched ahead of time and served as a static file.

## Deploy to GitHub Pages

Push to a GitHub repo, then Settings → Pages → Deploy from branch → `main` / root.
