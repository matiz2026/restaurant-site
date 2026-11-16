"use strict";

const app = document.querySelector("#app");

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else if (key === "value") node.value = String(value);
    else if (key === "checked") node.checked = Boolean(value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

function textInput(value, type = "text", extra = {}) {
  const input = el("input", { type, ...extra });
  input.value = value ?? "";
  return input;
}

function textArea(value, rows) {
  const area = el("textarea", { rows: String(rows) });
  area.value = value ?? "";
  return area;
}

function field(label, control, hint) {
  const children = [el("span", { text: label }), control];
  if (hint) children.push(el("small", { text: hint }));
  return el("label", { class: "field" }, children);
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      method: options.method || "GET",
      headers: options.body ? { "content-type": "application/json" } : undefined,
      body: options.body,
    });
  } catch {
    const error = new Error("The dashboard could not reach the site. Check that it is running, then try again.");
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "That did not save.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function renderLoading() {
  app.replaceChildren(
    el("section", { class: "panel", role: "status", "aria-live": "polite", "aria-busy": "true" }, [
      el("p", { class: "eyebrow", text: "Staff" }),
      el("h1", { text: "Loading the dashboard" }),
      el("div", { class: "skeleton" }),
      el("div", { class: "skeleton short" }),
    ]),
  );
}

function renderLoadError(message) {
  onSection = null;
  app.replaceChildren(
    el("section", { class: "login-card", role: "alert" }, [
      el("p", { class: "eyebrow", text: "Staff" }),
      el("h1", { text: "The dashboard could not load" }),
      el("p", { text: message || "Something went wrong." }),
      el("button", { class: "primary", type: "button", text: "Try again", onclick: () => void boot() }),
      el("p", {}, [el("a", { href: "/", text: "Back to the site" })]),
    ]),
  );
}

const SECTIONS = [
  ["details", "Details"],
  ["hours", "Hours"],
  ["menu", "Menu"],
];
const SECTION_IDS = new Set([...SECTIONS.map(([id]) => id), "password"]);

function sectionFromPath() {
  const section = location.pathname.match(/^\/admin\/([^/]+)$/)?.[1];
  return section && SECTION_IDS.has(section) ? section : "details";
}

function sectionPath(section) {
  return `/admin/${section}`;
}

let onSection = null;
window.addEventListener("popstate", () => {
  if (onSection) onSection(sectionFromPath());
});

function renderLogin(message) {
  onSection = null;
  document.title = "Staff sign-in";
  const username = textInput("", "text", { autocomplete: "username", required: true });
  const password = textInput("", "password", { autocomplete: "current-password", required: true });
  const error = el("p", { class: "status is-error", role: "alert", text: message || "" });
  const button = el("button", { class: "primary", type: "submit", text: "Sign in" });
  const form = el("form", { class: "stack" }, [
    field("Username", username),
    field("Password", password),
    error,
    button,
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    if (!username.value.trim() || !password.value) {
      error.textContent = "Enter a username and password.";
      return;
    }
    button.disabled = true;
    button.textContent = "Signing in…";
    try {
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ username: username.value.trim(), password: password.value }),
      });
      await boot();
    } catch (cause) {
      error.textContent = cause.message;
      button.disabled = false;
      button.textContent = "Sign in";
    }
  });
  app.replaceChildren(
    el("section", { class: "login-card" }, [
      el("p", { class: "eyebrow", text: "Staff" }),
      el("h1", { text: "Sign in" }),
      el("p", { text: "Edit the name, hours, and menu. Guests do not see this page." }),
      form,
      el("p", {}, [el("a", { href: "/", text: "Back to the site" })]),
    ]),
  );
  username.focus();
}

function renderDashboard(content, active, message) {
  document.title = content.restaurant.name ? `${content.restaurant.name} dashboard` : "Dashboard";
  const status = el("p", { class: message ? "status" : "status", role: "status", text: message || "" });
  function setStatus(text, isError) {
    status.textContent = text;
    status.classList.toggle("is-error", Boolean(isError));
  }

  const panels = {
    details: detailsPanel(content, setStatus),
    hours: hoursPanel(content, setStatus),
    menu: menuPanel(content, setStatus),
    password: passwordPanel(setStatus),
  };
  const navLinks = SECTIONS.map(([id, label]) => {
    const link = el("a", { href: sectionPath(id), text: label, "data-section": id });
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      show(id, "push");
    });
    return link;
  });
  const account = accountMenu(accountName, () => show("password", "push"), async () => {
    try {
      await api("/api/logout", { method: "POST" });
      renderLogin();
    } catch (cause) {
      setStatus(cause.message, true);
    }
  });
  function show(next, historyMode) {
    if (!SECTION_IDS.has(next)) next = "details";
    for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== next;
    for (const link of navLinks) {
      if (link.dataset.section === next) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    account.button.classList.toggle("is-current", next === "password");
    const path = sectionPath(next);
    if (location.pathname !== path) {
      const state = { section: next };
      if (historyMode === "push") history.pushState(state, "", path);
      else history.replaceState(state, "", path);
    }
  }
  show(SECTION_IDS.has(active) ? active : "details");
  onSection = (next) => show(next);

  app.replaceChildren(
    el("div", { class: "admin-shell" }, [
      el("div", { class: "admin-top" }, [
        el("div", {}, [
          el("p", { class: "eyebrow", text: "Dashboard" }),
          el("h1", { text: content.restaurant.name || "Restaurant" }),
        ]),
        el("div", { class: "admin-actions" }, [
          el("a", { class: "quiet", href: "/", target: "_blank", rel: "noopener", text: "View the site" }),
          account.wrap,
        ]),
      ]),
      status,
      el("nav", { class: "dash-nav", "aria-label": "Dashboard" }, navLinks),
      panels.details,
      panels.hours,
      panels.menu,
      panels.password,
    ]),
  );
}

function accountMenu(username, onPassword, onSignOut) {
  const label = username.trim() || "Account";
  const passwordItem = el("button", { type: "button", role: "menuitem", text: "Password" });
  const signOutItem = el("button", { type: "button", role: "menuitem", text: "Sign out" });
  const menu = el("div", { class: "account-menu", role: "menu", hidden: true }, [passwordItem, signOutItem]);
  const button = el("button", {
    class: "avatar",
    type: "button",
    text: label.charAt(0).toUpperCase(),
    "aria-label": `${label} menu`,
    "aria-haspopup": "menu",
    "aria-expanded": "false",
  });
  const wrap = el("div", { class: "account" }, [button, menu]);
  let open = false;
  function onDoc(event) {
    if (!wrap.contains(event.target)) setOpen(false);
  }
  function onKey(event) {
    if (event.key === "Escape" && open) {
      setOpen(false);
      button.focus();
    }
  }
  function setOpen(next) {
    open = next;
    menu.hidden = !open;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    document.removeEventListener("click", onDoc);
    document.removeEventListener("keydown", onKey);
    if (open) {
      document.addEventListener("click", onDoc);
      document.addEventListener("keydown", onKey);
    }
  }
  button.addEventListener("click", () => setOpen(!open));
  passwordItem.addEventListener("click", () => {
    setOpen(false);
    onPassword();
  });
  signOutItem.addEventListener("click", async () => {
    setOpen(false);
    signOutItem.disabled = true;
    try {
      await onSignOut();
    } finally {
      if (signOutItem.isConnected) signOutItem.disabled = false;
    }
  });
  return { wrap, button };
}

function detailsPanel(content, setStatus) {
  const restaurant = content.restaurant;
  const name = textInput(restaurant.name);
  const city = textInput(restaurant.city);
  const phone = textInput(restaurant.phone);
  const address = textArea(restaurant.address, 3);
  const intro = textArea(restaurant.intro, 3);
  const about = textArea(restaurant.about, 6);
  const visit = textArea(restaurant.visitNote, 4);
  const photo = photoControl(restaurant.heroImageUrl);
  const button = el("button", { class: "primary", type: "button", text: "Save details" });
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Saving…";
    setStatus("");
    try {
      const saved = await api("/api/admin/restaurant", {
        method: "PUT",
        body: JSON.stringify({
          name: name.value,
          city: city.value,
          phone: phone.value,
          address: address.value,
          intro: intro.value,
          about: about.value,
          visitNote: visit.value,
          heroImageUrl: photo.input.value,
        }),
      });
      renderDashboard(saved, "details", "Details saved.");
    } catch (cause) {
      setStatus(cause.message, true);
      button.disabled = false;
      button.textContent = "Save details";
    }
  });
  return el("section", { class: "panel" }, [
    field("Restaurant name", name),
    field("City", city),
    field("Phone", phone),
    field("Address", address, "One line, or several. The city is added on the site if it is not already here."),
    field("Intro", intro, "The line under the name on the public page."),
    field("About", about),
    field("Visit note", visit, "How to find the door, where to park, or what the block is like."),
    field("Hero photo URL", photo.input, "Paste a link to an image. Leave this blank for a text-only introduction."),
    photo.note,
    photo.frame,
    button,
  ]);
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function weekdayHours(saved) {
  const byLabel = new Map();
  for (const hour of saved ?? []) {
    const key = String(hour?.label ?? "").trim().toLowerCase();
    if (key && !byLabel.has(key)) byLabel.set(key, hour);
  }
  return WEEKDAYS.map((day) => {
    const hour = byLabel.get(day.toLowerCase());
    if (!hour) return { label: day, opens: "11:00", closes: "21:00", closed: false };
    return {
      label: day,
      opens: hour.opens ?? "",
      closes: hour.closes ?? "",
      closed: Boolean(hour.closed),
    };
  });
}

function hoursPanel(content, setStatus) {
  const list = el("div", { class: "stack" });
  for (const hour of weekdayHours(content.hours)) list.append(hourRow(hour));
  const saveButton = el("button", { class: "primary", type: "button", text: "Save hours" });
  saveButton.addEventListener("click", async () => {
    const hours = [...list.querySelectorAll(":scope > .hour-row")].map((row) => row.read());
    for (const hour of hours) {
      if (!hour.closed && (!hour.opens || !hour.closes)) {
        setStatus(`Add an open and close time for ${hour.label}, or set that day to closed.`, true);
        return;
      }
    }
    saveButton.disabled = true;
    saveButton.textContent = "Saving…";
    setStatus("");
    try {
      const saved = await api("/api/admin/hours", { method: "PUT", body: JSON.stringify({ hours }) });
      renderDashboard(saved, "hours", "Hours saved.");
    } catch (cause) {
      setStatus(cause.message, true);
      saveButton.disabled = false;
      saveButton.textContent = "Save hours";
    }
  });
  return el("section", { class: "panel" }, [
    el("p", { text: "These seven days are the hours on the public page. Set each day to open or closed." }),
    list,
    el("div", { class: "save-row hour-save" }, [saveButton]),
  ]);
}

function dayToggle(day, closed) {
  let isClosed = Boolean(closed);
  const openButton = el("button", { type: "button", text: "Open" });
  const closedButton = el("button", { type: "button", text: "Closed" });
  const group = el("div", { class: "day-toggle", role: "group", "aria-label": `${day}, open or closed` }, [
    openButton,
    closedButton,
  ]);
  function paint() {
    openButton.setAttribute("aria-pressed", isClosed ? "false" : "true");
    closedButton.setAttribute("aria-pressed", isClosed ? "true" : "false");
  }
  openButton.addEventListener("click", () => {
    if (!isClosed) return;
    isClosed = false;
    paint();
    group.dispatchEvent(new Event("change", { bubbles: true }));
  });
  closedButton.addEventListener("click", () => {
    if (isClosed) return;
    isClosed = true;
    paint();
    group.dispatchEvent(new Event("change", { bubbles: true }));
  });
  paint();
  group.isClosed = () => isClosed;
  return group;
}

function hourRow(hour) {
  const toggle = dayToggle(hour.label, hour.closed);
  const opens = textInput(hour.opens, "time", { "aria-label": `${hour.label} opens` });
  const closes = textInput(hour.closes, "time", { "aria-label": `${hour.label} closes` });
  const row = el("div", { class: "hour-row" }, [
    el("p", { class: "hour-day", text: hour.label }),
    toggle,
    field("Opens", opens),
    field("Closes", closes),
  ]);
  function syncTimes() {
    const closed = toggle.isClosed();
    opens.disabled = closed;
    closes.disabled = closed;
    row.classList.toggle("is-closed", closed);
  }
  toggle.addEventListener("change", syncTimes);
  syncTimes();
  row.read = () => ({
    label: hour.label,
    opens: opens.value,
    closes: closes.value,
    closed: toggle.isClosed(),
  });
  return row;
}

function menuPanel(content, setStatus) {
  const list = el("div", { class: "stack section-list" });
  const empty = el("p", { class: "empty", text: "No menu sections yet." });
  function sync() {
    empty.hidden = list.children.length > 0;
    refreshMoves(list, ".section-card");
  }
  function add(section) {
    list.append(sectionCard(section, list, sync));
    sync();
  }
  for (const section of content.menu) add(section);
  const saveButton = el("button", { class: "primary", type: "button", text: "Save menu" });
  saveButton.addEventListener("click", async () => {
    const sections = [...list.querySelectorAll(":scope > .section-card")].map((card) => card.read());
    for (const section of sections) {
      if (!section.name.trim()) {
        setStatus("Every section needs a name.", true);
        return;
      }
      if (section.items.some((item) => !item.name.trim())) {
        setStatus("Every dish needs a name.", true);
        return;
      }
    }
    saveButton.disabled = true;
    saveButton.textContent = "Saving…";
    setStatus("");
    try {
      const saved = await api("/api/admin/menu", { method: "PUT", body: JSON.stringify({ sections }) });
      renderDashboard(saved, "menu", "Menu saved.");
    } catch (cause) {
      setStatus(cause.message, true);
      saveButton.disabled = false;
      saveButton.textContent = "Save menu";
    }
  });
  return el("section", { class: "panel" }, [
    el("p", { text: "Add sections and dishes here. Nothing changes on the site until you save the menu." }),
    empty,
    list,
    el("div", { class: "save-row menu-save" }, [
      el("button", {
        class: "quiet",
        type: "button",
        text: "Add a section",
        onclick: () => add({ name: "", note: "", items: [] }),
      }),
      saveButton,
    ]),
  ]);
}

function sectionCard(section, list, sync) {
  const name = textInput(section.name, "text", { placeholder: "Plates" });
  const note = textInput(section.note, "text", { placeholder: "Optional note" });
  const items = el("div", { class: "stack" });
  const itemEmpty = el("p", { class: "empty", text: "This section has no dishes yet." });
  function syncItems() {
    itemEmpty.hidden = items.children.length > 0;
    refreshMoves(items, ".item-card");
  }
  function addItem(item) {
    items.append(itemCard(item, items, syncItems, name));
    syncItems();
  }
  for (const item of section.items) addItem(item);
  const card = el("article", { class: "section-card" }, [
    el("div", { class: "section-head" }, [
      field("Section name", name),
      field("Section note", note),
    ]),
    itemEmpty,
    items,
    el("div", { class: "save-row" }, [
      el("button", {
        class: "quiet",
        type: "button",
        text: "Add a dish",
        onclick: () => addItem({ name: "", description: "", price: "" }),
      }),
      moveButtons(list, ".section-card", sync, () => sectionRemoval(name.value)),
    ]),
  ]);
  card.read = () => ({
    name: name.value,
    note: note.value,
    items: [...items.querySelectorAll(":scope > .item-card")].map((item) => item.read()),
  });
  return card;
}

function itemCard(item, list, sync, sectionName) {
  const name = textInput(item.name, "text", { placeholder: "Dish name" });
  const price = textInput(item.price, "text", { placeholder: "$18" });
  const description = textArea(item.description, 3);
  const card = el("div", { class: "item-card" }, [
    el("div", { class: "item-top" }, [
      field("Dish", name),
      el("div", { class: "price-field" }, [
        field("Price", price),
        el("small", { text: "Shown as typed, such as $18 or MP." }),
      ]),
    ]),
    field("Description", description),
    moveButtons(list, ".item-card", sync, () => dishRemoval(name.value, sectionName.value)),
  ]);
  card.read = () => ({
    name: name.value,
    description: description.value,
    price: price.value,
  });
  return card;
}

function passwordPanel(setStatus) {
  const currentPassword = textInput("", "password", { autocomplete: "current-password" });
  const newPassword = textInput("", "password", { autocomplete: "new-password", minlength: "10" });
  const confirmPassword = textInput("", "password", { autocomplete: "new-password", minlength: "10" });
  const button = el("button", { class: "primary", type: "submit", text: "Change password" });
  const form = el("form", { class: "stack" }, [
    field("Current password", currentPassword),
    field("New password", newPassword, "At least 10 characters."),
    field("Confirm new password", confirmPassword),
    button,
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("");
    if (newPassword.value !== confirmPassword.value) {
      setStatus("Those new passwords do not match.", true);
      return;
    }
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      await api("/api/admin/password", {
        method: "PUT",
        body: JSON.stringify({ currentPassword: currentPassword.value, newPassword: newPassword.value }),
      });
      currentPassword.value = "";
      newPassword.value = "";
      confirmPassword.value = "";
      setStatus("Password changed. Use it the next time you sign in.");
    } catch (cause) {
      setStatus(cause.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "Change password";
    }
  });
  return el("section", { class: "panel" }, [
    el("p", { text: "This replaces the password for the staff sign-in. The username stays the same." }),
    form,
  ]);
}

function photoControl(value) {
  const input = textInput(value, "url", { placeholder: "https://example.com/photo.jpg" });
  const note = el("p", { class: "photo-note" });
  const frame = el("div", { class: "photo-frame" });
  function refresh() {
    const url = input.value.trim();
    frame.replaceChildren();
    if (!url) {
      note.textContent = "No photo yet.";
      return;
    }
    note.textContent = "Loading photo…";
    const img = el("img", { alt: "" });
    img.addEventListener("load", () => {
      note.textContent = "";
      frame.replaceChildren(img);
    });
    img.addEventListener("error", () => {
      note.textContent = "That photo URL did not load.";
      frame.replaceChildren();
    });
    img.src = url;
  }
  input.addEventListener("change", refresh);
  input.addEventListener("input", () => {
    if (!input.value.trim()) refresh();
  });
  refresh();
  return { input, note, frame };
}

function sectionRemoval(label) {
  const section = label.trim();
  return {
    title: section ? `Remove ${section}?` : "Remove this section?",
    message: section
      ? `Remove the ${section} section from the menu form, including its dishes. It stays on the site until you save the menu.`
      : "Remove this section from the menu form, including its dishes. It stays on the site until you save the menu.",
  };
}

function dishRemoval(label, sectionLabel) {
  const dish = label.trim();
  const section = sectionLabel.trim();
  const from = section ? `the ${section} section` : "this section";
  return {
    title: dish ? `Remove ${dish}?` : "Remove this dish?",
    message: dish
      ? `Remove ${dish} from ${from}. It stays on the site until you save the menu.`
      : `Remove this dish from ${from}. It stays on the site until you save the menu.`,
  };
}

function moveButtons(list, selector, sync, describeRemoval) {
  const up = el("button", { class: "quiet", type: "button", text: "Up", "data-move": "up" });
  const down = el("button", { class: "quiet", type: "button", text: "Down", "data-move": "down" });
  const remove = el("button", { class: "danger", type: "button", text: "Remove" });
  up.addEventListener("click", () => {
    const row = up.closest(selector);
    const previous = row?.previousElementSibling;
    if (row && previous) list.insertBefore(row, previous);
    sync();
  });
  down.addEventListener("click", () => {
    const row = down.closest(selector);
    const next = row?.nextElementSibling;
    if (row && next) list.insertBefore(next, row);
    sync();
  });
  remove.addEventListener("click", async () => {
    const confirmed = await confirmRemoval(describeRemoval());
    if (!confirmed) return;
    remove.closest(selector)?.remove();
    sync();
  });
  return el("div", { class: "row-actions" }, [up, down, remove]);
}

function confirmRemoval(copy) {
  return new Promise((resolve) => {
    const cancel = el("button", { class: "quiet", type: "button", text: "Keep it" });
    const remove = el("button", { class: "danger modal-remove", type: "button", text: "Remove" });
    const dialog = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "confirm-title" }, [
      el("div", { class: "modal-card" }, [
        el("h2", { id: "confirm-title", text: copy.title }),
        el("p", { id: "confirm-message", text: copy.message }),
        el("div", { class: "modal-actions" }, [cancel, remove]),
      ]),
    ]);
    dialog.setAttribute("aria-describedby", "confirm-message");
    function close(answer) {
      document.removeEventListener("keydown", onKey);
      dialog.remove();
      resolve(answer);
    }
    function onKey(event) {
      if (event.key === "Escape") close(false);
    }
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close(false);
    });
    cancel.addEventListener("click", () => close(false));
    remove.addEventListener("click", () => close(true));
    document.addEventListener("keydown", onKey);
    document.body.append(dialog);
    cancel.focus();
  });
}

function refreshMoves(list, selector) {
  const rows = [...list.querySelectorAll(`:scope > ${selector}`)];
  rows.forEach((row, index) => {
    const up = row.querySelector(":scope > .row-actions [data-move='up'], :scope > .save-row [data-move='up']");
    const down = row.querySelector(":scope > .row-actions [data-move='down'], :scope > .save-row [data-move='down']");
    if (up) up.disabled = index === 0;
    if (down) down.disabled = index === rows.length - 1;
  });
}

async function boot() {
  renderLoading();
  try {
    const session = await fetch("/api/me");
    if (session.status === 401) {
      renderLogin();
      return;
    }
    if (!session.ok) {
      const data = await session.json().catch(() => ({}));
      throw new Error(data.error || "The dashboard could not check the sign-in.");
    }
    const me = await session.json().catch(() => ({}));
    accountName = typeof me.username === "string" ? me.username : "";
    const content = await api("/api/admin/content");
    renderDashboard(content, sectionFromPath());
  } catch (cause) {
    renderLoadError(cause.message);
  }
}

let accountName = "";

void boot();
