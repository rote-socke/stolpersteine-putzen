# Stolpersteine putzen

A mobile web app for groups cleaning Stolpersteine in Stuttgart. It shows all
stones on a map, suggests the nearest open one, lets a group reserve a stone
while walking there, and records which stones are cleaned, shared between
everyone using it.

Stone locations, names and biography links come from the public map data of
the Stuttgart Stolperstein initiatives
(<https://www.stolpersteine-stuttgart.de/kartenueberblick/>). The biographies
stay on their sites; this app only links to them.

## How it works

- Anyone with the link can view the map and the cleaning state.
- An organizer creates a group with the organizer code. The app then shows a
  QR code (and a shareable link) that lets the group's members join.
- In organizer mode ("Organisation" in the group dialog) the organizer sees
  the progress and all groups, can show a group's invite again, create a new
  link, rename, delete groups or join one. Group tokens are derived from
  `INVITE_SECRET`, so an invite never gets lost.
- Members can reserve a stone ("Wir gehen hin"), mark it cleaned and leave a
  note. A reservation expires after 45 minutes.

## Development

```sh
npm install
npm run db:migrate:local
npm run dev          # http://localhost:8787, organizer code from .dev.vars
npm test
npm run typecheck
npm run data         # refresh public/data/locations.json from the KML
```

`.dev.vars` holds the local secrets (`ORGANIZER_CODE=...` and `INVITE_SECRET=...`).

## Deploy

Cloudflare credentials go into the git-ignored `.env`:

```sh
CLOUDFLARE_API_TOKEN=...   # permissions: Workers Scripts edit, D1 edit
CLOUDFLARE_ACCOUNT_ID=...
```

Load it into the shell before any `wrangler` command and check the account:

```sh
set -a; . ./.env; set +a
npx wrangler whoami
```

First deploy:

```sh
npx wrangler d1 create stolpersteine-putzen   # put the printed id into wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put ORGANIZER_CODE
npx wrangler secret put INVITE_SECRET   # long random string; changing it invalidates all invites
npm run deploy
```

Existing deployment: set `INVITE_SECRET` before the first deploy of this
version. Groups from before use their old random token until the organizer
opens their invite once; then they switch to the derived token and their old
links stop working.

Later deploys: `npm run db:migrate:remote` if there are new migrations, then
`npm run deploy`.
