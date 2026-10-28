# Stolpersteine putzen

A mobile web app that coordinates groups cleaning Stolpersteine in Stuttgart,
starting with Bad Cannstatt: map of all stones, nearest open stone, shared
reservations ("on the way"), cleaned state and notes. The UI text is German.

Git workflow: direct on the default branch

## Stack

- Cloudflare Worker (`src/`, TypeScript) serving the API under `/api/*` and
  the static app from `public/` (Workers static assets).
- D1 database `stolpersteine-putzen`, schema in `migrations/`.
- Web app in `public/`: plain HTML, CSS and ES modules, no build step.
  Third-party libraries are copied from `node_modules` into `public/vendor/`
  by `npm run vendor` (git-ignored), so the app loads no CDN.
- Location data: `npm run data` turns the public KML into
  `public/data/locations.json` (committed).

## Commands

- `npm run data`: regenerate the location data
- `npm run vendor`: copy browser libraries into `public/vendor/`
- `npm run dev`: local Worker with local D1 (run `npm run db:migrate:local` once)
- `npm test`: Vitest
- `npm run typecheck`
- `npm run deploy`: see the deploy section in `README.md`

## Rules

- `docs/CONTRACT.md` is the interface between data, API and app. Change it
  only together with every side that uses it.
- Secrets: the organizer code is the Worker secret `ORGANIZER_CODE`; locally
  it lives in the git-ignored `.dev.vars`. Cloudflare credentials live in the
  git-ignored `.env`. Never commit either.
- This repo belongs to the `rote-socke` accounts (GitHub and Cloudflare).
  Before any `wrangler` command against Cloudflare, check with
  `npx wrangler whoami` that it shows that account.
