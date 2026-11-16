# Matiz restaurant site

A public restaurant page and a staff dashboard. The page shows the name, introduction, hours, address, phone, menu, a short about, and a visit block. Staff change those details at `/admin`. There is no online ordering, reservations, or payment.

The site is a Cloudflare Worker named `matiz`. Restaurant facts, the menu, and the staff login live in the D1 database `matiz`. The live site is https://matizpr.com and https://www.matizpr.com.

## Run it locally

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open http://127.0.0.1:4327

The staff dashboard is http://127.0.0.1:4327/admin

`npm run dev` applies the local database migration, then starts Wrangler in local mode. That uses a database on this machine. It does not change the live D1 database. If Wrangler cannot start, the same site runs on a local SQLite file in `data/` instead. Those two databases are separate.

The staff username is `matiz`. The initial password was chosen when this project was created and is not written in the repo. Change it under Password in the dashboard. If you lose the local password, run `npm run admin:reset` and use the new password it prints. That command only updates local databases. The live database has its own copy of the original login.

## Checks

```bash
npm test
npm run typecheck
```

## Deploy

The Worker and database already exist on the Cloudflare account. `npx wrangler deploy` publishes this project to https://matizpr.com. D1 commands that should affect the live database need `--remote`. Commands with `--local` stay on this machine.
