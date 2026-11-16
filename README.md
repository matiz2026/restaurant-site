# Matiz restaurant site

A public restaurant page and a staff dashboard. The page shows the name, introduction, hours, address, phone, menu, a short about, and a visit block. Staff change those details at `/admin`. There is no online ordering, reservations, or payment.

The site is a Cloudflare Worker. Restaurant facts, the menu, and the staff login live in Cloudflare D1. Nothing in this repo has been created on the Cloudflare account yet. The Worker name and database name in `wrangler.jsonc` are local placeholders.

## Run it locally

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open http://127.0.0.1:4327

The staff dashboard is http://127.0.0.1:4327/admin

`npm run dev` applies the local database migration, then starts Wrangler in local mode. That uses a database on this machine. It does not create or change anything on Cloudflare. If Wrangler cannot start, the same site runs on a local SQLite file in `data/` instead. Those two databases are separate.

The staff username is `matiz`. The initial password was chosen when this project was created and is not written in the repo. Change it under Password in the dashboard. If you lose the local password, run `npm run admin:reset` and use the new password it prints. That command only updates local databases.

## Checks

```bash
npm test
npm run typecheck
```

## What not to run yet

Do not run `wrangler deploy`, `wrangler d1 create`, or any D1 command without `--local`. Those talk to the Cloudflare account. The domain is not attached. See the handoff note for the placeholders to replace before any of that.
