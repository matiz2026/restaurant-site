import {
  createSessionCookie,
  clearSessionCookie,
  dummyVerify,
  hashPassword,
  readSessionUsername,
  requestIsSecure,
  verifyPassword,
} from "./auth.ts";
import {
  findAdmin,
  loadContent,
  saveHours,
  saveMenu,
  saveRestaurant,
  SetupError,
  updatePassword,
  type AppDatabase,
  type SiteContent,
} from "./db.ts";
import { renderAdminShell, renderProblem, renderPublic } from "./pages.ts";
import { defaultUploadsDir, imageKind, readPhoto, savePhoto, savePhotoLocally } from "./uploads.ts";
import {
  parseHours,
  parseLogin,
  parseMenu,
  parsePasswordChange,
  parseRestaurant,
  ValidationError,
} from "./validate.ts";

const MAX_BODY = 100_000;
const MAX_PHOTO = 2_000_000;
const ADMIN_SECTIONS = new Set(["details", "hours", "menu", "password"]);
const CSP = [
  "default-src 'self'",
  "img-src 'self' https: http:",
  "style-src 'self'",
  "font-src 'self'",
  "script-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

export interface AppContext {
  db: AppDatabase;
  sessionSecret: string;
  assets: { fetch(request: Request): Promise<Response> };
  uploadsDir?: string;
}

export async function handleRequest(request: Request, ctx: AppContext): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      const trimmed = url.pathname.replace(/\/+$/, "") || "/";
      return new Response(null, { status: 308, headers: { location: trimmed + url.search } });
    }
    if (request.method === "GET" && url.pathname.startsWith("/uploads/")) return await serveUpload(request, url.pathname, ctx);
    if (request.method === "GET" && (isStatic(url.pathname) || url.pathname === "/favicon.ico")) {
      return await serveAsset(request, ctx);
    }
    if (request.method === "GET" && url.pathname === "/") return await publicPage(ctx);
    if (request.method === "GET" && isAdminPage(url.pathname)) return html(renderAdminShell());
    if (url.pathname === "/api/login" && request.method === "POST") return await login(request, ctx);
    if (url.pathname === "/api/logout" && request.method === "POST") return await logout(request, ctx);
    if (url.pathname === "/api/me" && request.method === "GET") return await me(request, ctx);
    if (url.pathname === "/api/admin/content" && request.method === "GET") return await adminContent(request, ctx);
    if (url.pathname === "/api/admin/restaurant" && request.method === "PUT") return await updateRestaurant(request, ctx);
    if (url.pathname === "/api/admin/hours" && request.method === "PUT") return await updateHours(request, ctx);
    if (url.pathname === "/api/admin/menu" && request.method === "PUT") return await updateMenu(request, ctx);
    if (url.pathname === "/api/admin/photos" && request.method === "POST") return await uploadPhoto(request, ctx);
    if (url.pathname === "/api/admin/password" && request.method === "PUT") return await changePassword(request, ctx);
    if (url.pathname.startsWith("/api/")) return json({ error: "That action is not available." }, 404);
    return html(renderProblem("That page is not here.", "The link does not match anything on this site."), 404);
  } catch (error) {
    if (error instanceof ValidationError) return json({ error: error.message }, 400);
    if (error instanceof ForbiddenError) return json({ error: error.message }, 403);
    if (error instanceof AuthError) return json({ error: error.message }, 401);
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    logError("unhandled", error);
    return json({ error: "Something went wrong." }, 500);
  }
}

async function publicPage(ctx: AppContext): Promise<Response> {
  try {
    const content = await loadContent(ctx.db);
    return html(renderPublic(content));
  } catch (error) {
    if (error instanceof SetupError) {
      logError("restaurant_missing", error);
      return html(
        renderProblem(
          "The restaurant details have not been set up yet.",
          "The database is missing the restaurant row. Apply the local migrations and reload.",
        ),
        500,
      );
    }
    logError("public_read_failed", error);
    return html(
      renderProblem(
        "The page could not load the restaurant details.",
        "Reload the page in a moment. If you just started the site, wait for the database to finish opening.",
      ),
      500,
    );
  }
}

async function login(request: Request, ctx: AppContext): Promise<Response> {
  assertSameOrigin(request);
  assertSecret(ctx.sessionSecret);
  const { username, password } = parseLogin(await readJson(request));
  const admin = await findAdmin(ctx.db, username);
  const matches = admin ? await verifyPassword(password, admin.passwordHash) : false;
  if (!admin) await dummyVerify(password);
  if (!admin || !matches) {
    log("login_failed", { username });
    return json({ error: "That username or password is not right." }, 401);
  }
  log("login_succeeded", { username: admin.username });
  const cookie = await createSessionCookie(admin.username, ctx.sessionSecret, requestIsSecure(request));
  return json({ username: admin.username }, 200, { "set-cookie": cookie });
}

async function logout(request: Request, ctx: AppContext): Promise<Response> {
  assertSameOrigin(request);
  const username = await requireUser(request, ctx);
  log("logout", { username });
  return json({ ok: true }, 200, {
    "set-cookie": clearSessionCookie(requestIsSecure(request)),
  });
}

async function me(request: Request, ctx: AppContext): Promise<Response> {
  const username = await requireUser(request, ctx);
  return json({ username });
}

async function adminContent(request: Request, ctx: AppContext): Promise<Response> {
  await requireUser(request, ctx);
  return json(await readSite(ctx.db));
}

async function updateRestaurant(request: Request, ctx: AppContext): Promise<Response> {
  assertSameOrigin(request);
  await requireUser(request, ctx);
  const fields = parseRestaurant(await readJson(request));
  await saveRestaurant(ctx.db, fields);
  log("restaurant_saved");
  return json(await readSite(ctx.db));
}

async function updateHours(request: Request, ctx: AppContext): Promise<Response> {
  assertSameOrigin(request);
  await requireUser(request, ctx);
  const hours = parseHours(await readJson(request));
  await saveHours(ctx.db, hours);
  log("hours_saved", { rows: hours.length });
  return json(await readSite(ctx.db));
}

async function updateMenu(request: Request, ctx: AppContext): Promise<Response> {
  assertSameOrigin(request);
  await requireUser(request, ctx);
  const sections = parseMenu(await readJson(request));
  await saveMenu(ctx.db, sections);
  log("menu_saved", { sections: sections.length });
  return json(await readSite(ctx.db));
}

async function uploadPhoto(request: Request, ctx: AppContext): Promise<Response> {
  assertSameOrigin(request);
  await requireUser(request, ctx);
  const bytes = await readBytes(request, MAX_PHOTO);
  if (bytes.byteLength === 0) throw new ValidationError("Choose a photo to upload.");
  const kind = imageKind(bytes);
  if (!kind) throw new ValidationError("Use a JPEG, PNG, WebP, or GIF.");
  try {
    const url = await storePhoto(ctx, bytes, kind);
    log("photo_saved", { url });
    return json({ url });
  } catch (error) {
    logError("photo_save_failed", error);
    throw new HttpError("The photo could not be saved.", 500);
  }
}

async function storePhoto(ctx: AppContext, bytes: Uint8Array, kind: ReturnType<typeof imageKind>): Promise<string> {
  if (!kind) throw new Error("missing photo type");
  try {
    return await savePhoto(ctx.uploadsDir ?? defaultUploadsDir(), bytes, kind);
  } catch (error) {
    const url = await savePhotoLocally(bytes, ctx.sessionSecret);
    if (url) return url;
    throw error;
  }
}

async function serveUpload(request: Request, pathname: string, ctx: AppContext): Promise<Response> {
  try {
    const photo = await readPhoto(ctx.uploadsDir ?? defaultUploadsDir(), pathname);
    if (photo) return imageResponse(photo.bytes, photo.type);
  } catch (error) {
    logError("photo_read_failed", error);
  }
  try {
    const proxied = await fetch(`http://127.0.0.1:4398${pathname}`, {
      headers: { "x-upload-token": ctx.sessionSecret },
    });
    if (proxied.ok) {
      const type = proxied.headers.get("content-type") || "application/octet-stream";
      return imageResponse(new Uint8Array(await proxied.arrayBuffer()), type);
    }
  } catch (error) {
    logError("photo_read_failed", error);
  }
  const assetUrl = new URL(request.url);
  assetUrl.pathname = pathname;
  const asset = await ctx.assets.fetch(new Request(assetUrl, { method: "GET" }));
  if (asset.ok) return asset;
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...securityHeaders() },
  });
}

async function changePassword(request: Request, ctx: AppContext): Promise<Response> {
  assertSameOrigin(request);
  assertSecret(ctx.sessionSecret);
  const username = await requireUser(request, ctx);
  const { currentPassword, newPassword } = parsePasswordChange(await readJson(request));
  const admin = await findAdmin(ctx.db, username);
  if (!admin || !(await verifyPassword(currentPassword, admin.passwordHash))) {
    return json({ error: "The current password is not right." }, 400);
  }
  await updatePassword(ctx.db, username, await hashPassword(newPassword));
  log("password_changed", { username });
  return json({ ok: true });
}

async function readSite(db: AppDatabase): Promise<SiteContent> {
  try {
    return await loadContent(db);
  } catch (error) {
    logError("admin_read_failed", error);
    throw new HttpError("The dashboard could not read the restaurant details.", 500);
  }
}

async function requireUser(request: Request, ctx: AppContext): Promise<string> {
  assertSecret(ctx.sessionSecret);
  const username = await readSessionUsername(request, ctx.sessionSecret);
  if (!username) {
    throw new AuthError();
  }
  const admin = await findAdmin(ctx.db, username);
  if (!admin) throw new AuthError();
  return admin.username;
}

function assertSecret(secret: string): void {
  if (secret.length < 32) {
    logError("session_secret_missing", new Error("short_or_missing"));
    throw new HttpError("The server is missing its session secret.", 500);
  }
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) throw new ForbiddenError("That request was blocked.");
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new ForbiddenError("That request was blocked.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ForbiddenError("That request was blocked.");
  }
  const allowed = new Set<string>([new URL(request.url).host]);
  const host = request.headers.get("host");
  if (host) allowed.add(host);
  if (!allowed.has(parsed.host)) throw new ForbiddenError("That request was blocked.");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") throw new ForbiddenError("That request was blocked.");
}

async function readJson(request: Request): Promise<unknown> {
  const text = await readLimited(request, MAX_BODY);
  if (!text) throw new ValidationError("The request body was not valid JSON.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError("The request body was not valid JSON.");
  }
}

async function readLimited(request: Request, max: number): Promise<string> {
  const bytes = await readBytes(request, max, "That update is too large.");
  return new TextDecoder().decode(bytes);
}

async function readBytes(request: Request, max: number, tooLarge = "That photo is too large. Use one under 2 MB."): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > max) throw new ValidationError(tooLarge);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new ValidationError(tooLarge);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function imageResponse(bytes: Uint8Array, type: string): Response {
  return new Response(bytes, {
    headers: {
      "content-type": type,
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
      ...securityHeaders(),
    },
  });
}

function isAdminPage(pathname: string): boolean {
  if (pathname === "/admin") return true;
  const section = pathname.match(/^\/admin\/([^/]+)$/)?.[1];
  return section != null && ADMIN_SECTIONS.has(section);
}

function isStatic(pathname: string): boolean {
  return /^\/[a-z0-9.-]+\.(css|js|svg)$/.test(pathname);
}

async function serveAsset(request: Request, ctx: AppContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/favicon.ico") url.pathname = "/favicon.svg";
  const assetRequest = url.pathname === new URL(request.url).pathname ? request : new Request(url, request);
  const response = await ctx.assets.fetch(assetRequest);
  if (response.status === 404) {
    return html(renderProblem("That page is not here.", "The link does not match anything on this site."), 404);
  }
  return response;
}

class AuthError extends Error {
  constructor() {
    super("Sign in required.");
    this.name = "AuthError";
  }
}

class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...securityHeaders(),
    },
  });
}

function json(data: unknown, status = 200, extra?: Record<string, string>): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...securityHeaders(),
  });
  if (extra) {
    for (const [key, value] of Object.entries(extra)) headers.append(key, value);
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function securityHeaders(): Record<string, string> {
  return {
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
  };
}

function log(event: string, fields: Record<string, string | number | boolean> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

function logError(event: string, error: unknown): void {
  console.error(
    JSON.stringify({
      event,
      message: error instanceof Error ? error.message : "unknown",
    }),
  );
}
