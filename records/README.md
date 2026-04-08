# Records

Vinyl collection gallery for samhouston.me, powered by the Discogs API.

## How it works

1. A GitHub Action (`.github/workflows/refresh-collection.yml`) runs weekly (Mondays 08:00 UTC) and on manual trigger.
2. The Action runs `records/fetch-collection.mjs`, which paginates through the Discogs API for user `QforQ`, downloads cover art into `records/covers/`, and writes the flattened result to `records/collection.json`.
3. Any changes get committed back to the repo by the `github-actions[bot]` user.
4. `records/index.html` loads `collection.json` at runtime. If it doesn't exist yet, it falls back to `sample-collection.json` so the page never breaks.

## One-time setup

1. **Generate a Discogs personal access token** at https://www.discogs.com/settings/developers (click "Generate new token").
2. **Add it as a repo secret:** Settings → Secrets and variables → Actions → New repository secret. Name: `DISCOGS_TOKEN`. Value: the token.
3. **Give the Action write permission:** Settings → Actions → General → Workflow permissions → "Read and write permissions" → Save.
4. **Trigger the first run:** Actions tab → "Refresh Discogs Collection" → Run workflow. Or just wait until Monday.

## Running locally

```bash
DISCOGS_TOKEN=your_token_here node records/fetch-collection.mjs
```

That writes `records/collection.json` and caches covers to `records/covers/`. Then serve the repo with any static server — you need a real HTTP server because the page uses `fetch()`:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/records/
```

## Files

- `index.html` — the gallery page (self-contained, one external dep: Chart.js CDN)
- `fetch-collection.mjs` — Node script that pulls from Discogs (zero dependencies)
- `sample-collection.json` — 20 sample records, used as a fallback when `collection.json` doesn't exist
- `collection.json` — **generated** by the Action, do not hand-edit
- `covers/` — **generated** cover art cache, safe to delete (will redownload)

## Notes

- Discogs API rate limit is 60 requests/minute for authenticated users. The script sleeps ~1.1s between calls to stay well under that. A 200-record collection takes about 4 minutes on a cold run; subsequent runs only download covers for new releases.
- The `transformRelease` function strips Discogs's `(2)`, `(3)` disambiguators from artist and label names — those exist because Discogs has multiple artists named "Genesis" etc. If you *want* the disambiguators, remove the `.replace(/\s*\(\d+\)$/, '')` calls.
- "Record of the week" uses an ISO-week-seeded pick from `collection.length`, so it rotates every Monday independent of when the Action runs.
