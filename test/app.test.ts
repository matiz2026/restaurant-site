import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { hashPassword, verifyPassword, HASH_ITERATIONS } from "../src/auth.ts";
import { handleRequest } from "../src/app.ts";
import { applyMigrations, openDatabase } from "../scripts/sqlite-db.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const origin = "http://127.0.0.1:4327";

describe("restaurant site", () => {
  it("verifies a password hash and rejects the wrong password", async () => {
    const hash = await hashPassword("a-long-password");
    assert.equal(await verifyPassword("a-long-password", hash), true);
    assert.equal(await verifyPassword("a-long-password-no", hash), false);
    assert.equal(HASH_ITERATIONS, 20_000);
    const migration = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");
    assert.match(migration, /pbkdf2-sha256\$20000\$[0-9a-f]{32}\$[0-9a-f]{64}/);
  });

  it("renders the public page from the database", async () => {
    const { ctx } = await context();
    const response = await handleRequest(new Request(`${origin}/`), ctx);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Matiz/);
    assert.match(html, /Your city/);
    assert.match(html, /\(000\) 000-0000/);
    assert.match(html, /123 Example Street/);
    assert.match(html, /Placeholder plate/);
    assert.match(html, /11:00 a\.m\./);
    assert.match(html, /Closed/);
    assert.match(html, /id="menu"/);
    assert.match(html, /id="about"/);
    assert.match(html, /id="visit"/);
    assert.match(html, /Staff sign-in/);
  });

  it("shows empty menu and hours states", async () => {
    const { ctx } = await context();
    await ctx.db.batch([ctx.db.prepare("DELETE FROM menu_items"), ctx.db.prepare("DELETE FROM menu_sections")]);
    await ctx.db.prepare("DELETE FROM hours").run();
    const html = await (await handleRequest(new Request(`${origin}/`), ctx)).text();
    assert.match(html, /The menu has not been added yet/);
    assert.match(html, /Hours have not been added yet/);
  });

  it("shows an error page when the database cannot be read", async () => {
    const broken = {
      prepare() {
        throw new Error("disk failed");
      },
      async batch() {
        throw new Error("disk failed");
      },
    };
    const response = await handleRequest(new Request(`${origin}/`), {
      db: broken,
      sessionSecret: "x".repeat(40),
      assets: { async fetch() { return new Response("missing", { status: 404 }); } },
    });
    const html = await response.text();
    assert.equal(response.status, 500);
    assert.match(html, /could not load the restaurant details/);
    assert.doesNotMatch(html, /disk failed/);
  });

  it("serves the admin shell with a loading state", async () => {
    const { ctx } = await context();
    for (const path of ["/admin", "/admin/details", "/admin/hours", "/admin/menu", "/admin/password"]) {
      const html = await (await handleRequest(new Request(`${origin}${path}`), ctx)).text();
      assert.match(html, /Loading the dashboard/);
      assert.match(html, /admin\.js/);
    }
    const missing = await handleRequest(new Request(`${origin}/admin/nope`), ctx);
    assert.equal(missing.status, 404);
  });

  it("signs in, edits the site, and changes the password", async () => {
    const { ctx, password } = await context();
    const blocked = await post(ctx, "/api/login", { username: "matiz", password }, "http://evil.example");
    assert.equal(blocked.status, 403);

    const wrong = await post(ctx, "/api/login", { username: "matiz", password: "not-the-password" });
    assert.equal(wrong.status, 401);

    const loggedIn = await post(ctx, "/api/login", { username: "matiz", password });
    assert.equal(loggedIn.status, 200);
    const cookie = cookiePair(loggedIn);
    assert.match(loggedIn.headers.get("set-cookie") ?? "", /HttpOnly/);
    assert.match(loggedIn.headers.get("set-cookie") ?? "", /SameSite=Lax/);

    const unauthenticated = await put(ctx, "/api/admin/restaurant", { name: "Nope" }, "");
    assert.equal(unauthenticated.status, 401);

    const renamed = await put(
      ctx,
      "/api/admin/restaurant",
      {
        name: "<script>alert(1)</script>",
        city: "Bayamón",
        phone: "(787) 555-0100",
        address: "50 Calle Luna",
        intro: "A short intro.",
        about: "About the room.",
        visitNote: "The door is on the corner.",
        heroImageUrl: "javascript:alert(1)",
      },
      cookie,
    );
    assert.equal(renamed.status, 400);

    const saved = await put(
      ctx,
      "/api/admin/restaurant",
      {
        name: "<script>alert(1)</script>",
        city: "Bayamón",
        phone: "(787) 555-0100",
        address: "50 Calle Luna",
        intro: "A short intro.",
        about: "About the room.",
        visitNote: "The door is on the corner.",
        heroImageUrl: "",
      },
      cookie,
    );
    assert.equal(saved.status, 200);
    const page = await (await handleRequest(new Request(`${origin}/`), ctx)).text();
    assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(page, /<script>alert\(1\)/);
    assert.match(page, /Bayamón/);
    assert.match(page, /50 Calle Luna/);

    const menu = await put(
      ctx,
      "/api/admin/menu",
      {
        sections: [
          {
            name: "Sweets",
            note: "After dinner",
            items: [{ name: "Rice pudding", description: "Cold", price: "$7", photoUrl: "https://example.com/pudding.jpg" }],
          },
          { name: "First", note: "", items: [{ name: "Soup", description: "", price: "$6" }] },
        ],
      },
      cookie,
    );
    assert.equal(menu.status, 200);
    const menuPage = await (await handleRequest(new Request(`${origin}/`), ctx)).text();
    assert.match(menuPage, /Rice pudding/);
    assert.doesNotMatch(menuPage, /pudding\.jpg/);
    assert.doesNotMatch(menuPage, /item-photo/);
    assert.ok(menuPage.indexOf("Sweets") < menuPage.indexOf("First") || menuPage.indexOf("Sweets") > 0);
    const sweets = menuPage.indexOf("Sweets");
    const first = menuPage.indexOf(">First<");
    assert.ok(sweets > 0 && first > sweets);

    const reversed = await put(
      ctx,
      "/api/admin/menu",
      {
        sections: [
          { name: "First", note: "", items: [{ name: "Soup", description: "", price: "$6" }] },
          { name: "Sweets", note: "", items: [] },
        ],
      },
      cookie,
    );
    assert.equal(reversed.status, 200);
    const reversedPage = await (await handleRequest(new Request(`${origin}/`), ctx)).text();
    assert.ok(reversedPage.indexOf(">First<") < reversedPage.indexOf("Sweets"));
    assert.match(reversedPage, /Nothing is listed in this section yet/);

    const hours = await put(
      ctx,
      "/api/admin/hours",
      { hours: [{ label: "Daily", opens: "09:00", closes: "17:00", closed: false }] },
      cookie,
    );
    assert.equal(hours.status, 200);
    const hoursPage = await (await handleRequest(new Request(`${origin}/`), ctx)).text();
    assert.match(hoursPage, /9:00 a\.m\./);
    assert.match(hoursPage, /5:00 p\.m\./);

    const changed = await put(
      ctx,
      "/api/admin/password",
      { currentPassword: password, newPassword: "replacement-pass" },
      cookie,
    );
    assert.equal(changed.status, 200);
    const oldLogin = await post(ctx, "/api/login", { username: "matiz", password });
    assert.equal(oldLogin.status, 401);
    const newLogin = await post(ctx, "/api/login", { username: "matiz", password: "replacement-pass" });
    assert.equal(newLogin.status, 200);

    const css = await handleRequest(new Request(`${origin}/site.css`), ctx);
    assert.equal(css.status, 200);
    assert.match(await css.text(), /color:red/);

    const photos = await handleRequest(
      new Request(`${origin}/api/admin/photos`, {
        method: "POST",
        headers: { origin, "content-type": "image/png", cookie },
        body: "not-used",
      }),
      ctx,
    );
    assert.equal(photos.status, 404);
  });
});

async function context() {
  const db = openDatabase(":memory:");
  applyMigrations(db, `${root}/migrations`);
  const password = "test-password-9";
  await db
    .prepare("UPDATE admin_users SET password_hash = ? WHERE username = ?")
    .bind(await hashPassword(password), "matiz")
    .run();
  return {
    password,
    ctx: {
      db,
      sessionSecret: "test-session-secret-should-be-long-enough-0123456789",
      assets: {
        async fetch() {
          return new Response("body{color:red}", { headers: { "content-type": "text/css" } });
        },
      },
    },
  };
}

function post(ctx, path, body, requestOrigin = origin) {
  return handleRequest(
    new Request(`${origin}${path}`, {
      method: "POST",
      headers: { origin: requestOrigin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx,
  );
}

function put(ctx, path, body, cookie) {
  const headers = { origin, "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return handleRequest(
    new Request(`${origin}${path}`, { method: "PUT", headers, body: JSON.stringify(body) }),
    ctx,
  );
}

function cookiePair(response) {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const pair = setCookie.split(";")[0] ?? "";
  if (!pair.startsWith("matiz_session=")) throw new Error(`missing cookie: ${setCookie}`);
  return pair;
}
