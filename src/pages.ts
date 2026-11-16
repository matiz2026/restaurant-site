import type { HourFields, SiteContent } from "./db.ts";
import { isUploadPath } from "./validate.ts";

export function renderPublic(content: SiteContent): string {
  const { restaurant, hours, menu } = content;
  const title = restaurant.city ? `${restaurant.name} · ${restaurant.city}` : restaurant.name;
  const description = restaurant.intro || `${restaurant.name} menu, hours, and address.`;
  const phoneLink = telHref(restaurant.phone);
  const heroPhoto = image(restaurant.heroImageUrl, restaurant.name, "hero-img");
  const maps = mapsHref(restaurant.address, restaurant.city);

  const body = `
    <a class="skip" href="#content">Skip to content</a>
    <header class="site-header">
      <div class="wrap header-bar">
        <a class="wordmark" href="/">${escapeHtml(restaurant.name)}</a>
        <nav aria-label="Sections">
          <a href="#menu">Menu</a>
          <a href="#hours">Hours</a>
          <a href="#about">About</a>
          <a href="#visit">Visit</a>
        </nav>
        ${
          phoneLink
            ? `<a class="header-phone" href="${escapeHtml(phoneLink)}">${escapeHtml(restaurant.phone)}</a>`
            : ""
        }
      </div>
    </header>
    <main id="content">
      <div class="wrap">
        <section class="hero${heroPhoto ? " has-photo" : ""}">
          <div>
            ${restaurant.city ? `<p class="eyebrow">${escapeHtml(restaurant.city)}</p>` : ""}
            <h1>${escapeHtml(restaurant.name)}</h1>
            ${restaurant.intro ? `<p class="intro">${escapeHtml(restaurant.intro)}</p>` : ""}
          </div>
          ${heroPhoto ? `<div class="hero-photo">${heroPhoto}</div>` : ""}
        </section>

        <section class="facts" aria-label="Hours, address, and phone">
          <div id="hours">
            <h2 class="eyebrow">Hours</h2>
            ${hoursList(hours)}
          </div>
          <div id="address">
            <h2 class="eyebrow">Address</h2>
            ${addressBlock(restaurant.address, restaurant.city)}
          </div>
          <div id="phone">
            <h2 class="eyebrow">Phone</h2>
            ${
              phoneLink
                ? `<p><a href="${escapeHtml(phoneLink)}">${escapeHtml(restaurant.phone)}</a></p>`
                : `<p class="empty">No phone number yet.</p>`
            }
          </div>
        </section>

        <section id="menu" class="menu-block">
          <h2 class="section-heading">Menu</h2>
          ${menuHtml(menu)}
        </section>

        <section id="about" class="about-grid">
          <h2 class="section-heading">About</h2>
          <div class="prose">
            ${
              restaurant.about
                ? paragraphs(restaurant.about)
                : `<p class="empty">The about text has not been written yet.</p>`
            }
          </div>
        </section>

        <section id="visit">
          <div class="visit-band">
            <h2 class="section-heading">Visit</h2>
            <div class="visit-grid">
              <div>
                ${addressBlock(restaurant.address, restaurant.city)}
                ${
                  maps
                    ? `<p><a class="pill" href="${escapeHtml(maps)}" target="_blank" rel="noopener noreferrer">Open in maps</a></p>`
                    : ""
                }
              </div>
              <div>
                ${hoursList(hours)}
                ${
                  phoneLink
                    ? `<p class="visit-phone"><a href="${escapeHtml(phoneLink)}">${escapeHtml(restaurant.phone)}</a></p>`
                    : ""
                }
                ${
                  restaurant.visitNote
                    ? `<div class="prose">${paragraphs(restaurant.visitNote)}</div>`
                    : `<p class="empty">A note for visitors has not been added yet.</p>`
                }
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
    <footer class="site-footer">
      <div class="wrap footer-grid">
        <div>
          <p class="wordmark">${escapeHtml(restaurant.name)}</p>
          ${restaurant.city ? `<p>${escapeHtml(restaurant.city)}</p>` : ""}
        </div>
        <div>
          ${addressBlock(restaurant.address, restaurant.city)}
          ${
            phoneLink
              ? `<p><a href="${escapeHtml(phoneLink)}">${escapeHtml(restaurant.phone)}</a></p>`
              : ""
          }
        </div>
        <div>
          <a href="/admin">Staff sign-in</a>
        </div>
      </div>
    </footer>
    <script src="/site.js"></script>`;

  return document({ title, description, body });
}

export function renderAdminShell(): string {
  const body = `
    <div id="app">
      <section class="panel" role="status" aria-live="polite" aria-busy="true">
        <p class="eyebrow">Staff</p>
        <h1>Loading the dashboard</h1>
        <div class="skeleton"></div>
        <div class="skeleton short"></div>
      </section>
    </div>
    <noscript>
      <section class="panel">
        <h1>JavaScript is required</h1>
        <p>The dashboard needs JavaScript to sign in and edit the restaurant.</p>
        <p><a href="/">Back to the site</a></p>
      </section>
    </noscript>
    <script src="/admin.js"></script>`;
  return document({
    title: "Staff sign-in",
    description: "Edit the restaurant details, hours, and menu.",
    body,
    robots: "noindex",
    bodyClass: "admin-page",
  });
}

export function renderProblem(title: string, message: string): string {
  const body = `
    <header class="site-header">
      <div class="wrap header-bar">
        <a class="wordmark" href="/">Home</a>
      </div>
    </header>
    <main id="content" class="wrap problem">
      <p class="eyebrow">Matiz</p>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <p><a class="pill" href="/">Back to the restaurant</a></p>
    </main>`;
  return document({ title, description: message, body });
}

function document(options: {
  title: string;
  description: string;
  body: string;
  robots?: string;
  bodyClass?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)}</title>
  <meta name="description" content="${escapeHtml(options.description)}">
  ${options.robots ? `<meta name="robots" content="${escapeHtml(options.robots)}">` : ""}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/site.css">
</head>
<body class="${options.bodyClass ?? ""}">
${options.body}
</body>
</html>`;
}

function hoursList(hours: HourFields[]): string {
  if (hours.length === 0) return `<p class="empty">Hours have not been added yet.</p>`;
  const rows = hours
    .map(
      (hour) =>
        `<div><dt>${escapeHtml(hour.label)}</dt><dd>${escapeHtml(hoursLine(hour))}</dd></div>`,
    )
    .join("");
  return `<dl class="hours-list">${rows}</dl>`;
}

function hoursLine(hour: HourFields): string {
  if (hour.closed) return "Closed";
  if (!hour.opens || !hour.closes) return "Hours not set";
  return `${formatTime(hour.opens)} – ${formatTime(hour.closes)}`;
}

function formatTime(value: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return value;
  const hours = Number(match[1]);
  const suffix = hours >= 12 ? "p.m." : "a.m.";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${match[2]} ${suffix}`;
}

function menuHtml(menu: SiteContent["menu"]): string {
  if (menu.length === 0) {
    return `<div class="empty-block">
      <p>The menu has not been added yet.</p>
      <p>Call the restaurant and ask what they are serving.</p>
    </div>`;
  }
  return `<div class="menu-sections">${menu
    .map((section) => {
      const items =
        section.items.length === 0
          ? `<p class="empty">Nothing is listed in this section yet.</p>`
          : `<ul>${section.items.map(itemHtml).join("")}</ul>`;
      return `<article>
        <h3>${escapeHtml(section.name)}</h3>
        ${section.note ? `<p class="note">${escapeHtml(section.note)}</p>` : ""}
        ${items}
      </article>`;
    })
    .join("")}</div>`;
}

function itemHtml(item: SiteContent["menu"][number]["items"][number]): string {
  const price = item.price
    ? `<span class="dots" aria-hidden="true"></span><span class="price">${escapeHtml(item.price)}</span>`
    : "";
  const photo = image(item.photoUrl, item.name, "item-photo");
  return `<li>
    <div class="item-line"><span class="item-name">${escapeHtml(item.name)}</span>${price}</div>
    ${item.description ? `<p class="desc">${escapeHtml(item.description)}</p>` : ""}
    ${photo}
  </li>`;
}

function addressBlock(address: string, city: string): string {
  const lines = address
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (city && !address.toLowerCase().includes(city.toLowerCase())) lines.push(city);
  if (lines.length === 0) return `<p class="empty">The address has not been added yet.</p>`;
  return `<p>${lines.map((line) => escapeHtml(line)).join("<br>")}</p>`;
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((part) => `<p>${escapeHtml(part).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

function image(url: string, alt: string, className: string): string {
  const safe = displayUrl(url);
  if (!safe) return "";
  return `<img class="${className}" src="${escapeHtml(safe)}" alt="${escapeHtml(alt)}" data-photo>`;
}

function displayUrl(value: string): string {
  if (!value) return "";
  if (isUploadPath(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

function telHref(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  return cleaned ? `tel:${cleaned}` : "";
}

function mapsHref(address: string, city: string): string {
  const query = [address.replaceAll("\n", ", "), city].filter(Boolean).join(", ");
  if (!query.trim()) return "";
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
