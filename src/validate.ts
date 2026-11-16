import type { HourFields, MenuSectionFields, RestaurantFields } from "./db.ts";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseLogin(value: unknown): { username: string; password: string } {
  const record = recordOf(value, "Enter a username and password.");
  const username = line(record.username, "Username", 80, true);
  const password = typeof record.password === "string" ? record.password : "";
  if (!username || !password) throw new ValidationError("Enter a username and password.");
  if (password.length > 200) throw new ValidationError("That password is too long.");
  return { username, password };
}

export function parsePasswordChange(value: unknown): { currentPassword: string; newPassword: string } {
  const record = recordOf(value, "Enter the current password and a new one.");
  const currentPassword = typeof record.currentPassword === "string" ? record.currentPassword : "";
  const newPassword = typeof record.newPassword === "string" ? record.newPassword : "";
  if (!currentPassword || !newPassword) {
    throw new ValidationError("Enter the current password and a new one.");
  }
  if (newPassword.length < 10) throw new ValidationError("Use at least 10 characters.");
  if (newPassword.length > 200) throw new ValidationError("That password is too long.");
  if (newPassword === currentPassword) {
    throw new ValidationError("Choose a different password than the one you use now.");
  }
  return { currentPassword, newPassword };
}

export function parseRestaurant(value: unknown): RestaurantFields {
  const record = recordOf(value, "The restaurant details were not valid.");
  return {
    name: line(record.name, "Restaurant name", 80, true),
    city: line(record.city, "City", 80, false),
    phone: line(record.phone, "Phone", 40, false),
    address: block(record.address, "Address", 240),
    intro: block(record.intro, "Intro", 320),
    about: block(record.about, "About", 2000),
    visitNote: block(record.visitNote, "Visit note", 1000),
    heroImageUrl: imageUrl(record.heroImageUrl),
  };
}

export function parseHours(value: unknown): HourFields[] {
  const record = recordOf(value, "The hours were not valid.");
  if (!Array.isArray(record.hours)) throw new ValidationError("The hours were not valid.");
  if (record.hours.length > 21) throw new ValidationError("Use 21 hours rows or fewer.");
  return record.hours.map((entry) => {
    const hour = recordOf(entry, "One of the hours rows was not valid.");
    const closed = hour.closed === true;
    const opens = line(hour.opens, "Opening time", 5, false);
    const closes = line(hour.closes, "Closing time", 5, false);
    if (!closed) {
      if (!TIME.test(opens) || !TIME.test(closes)) {
        throw new ValidationError("Use opening and closing times like 11:00, or mark the row closed.");
      }
    }
    return {
      label: line(hour.label, "Hours label", 40, true),
      opens: closed ? "" : opens,
      closes: closed ? "" : closes,
      closed,
    };
  });
}

export function parseMenu(value: unknown): MenuSectionFields[] {
  const record = recordOf(value, "The menu was not valid.");
  if (!Array.isArray(record.sections)) throw new ValidationError("The menu was not valid.");
  if (record.sections.length > 24) throw new ValidationError("Use 24 menu sections or fewer.");
  let itemCount = 0;
  const sections = record.sections.map((entry) => {
    const section = recordOf(entry, "One of the menu sections was not valid.");
    if (!Array.isArray(section.items)) throw new ValidationError("One of the menu sections was not valid.");
    if (section.items.length > 40) throw new ValidationError("Use 40 dishes in a section or fewer.");
    const items = section.items.map((itemEntry) => {
      itemCount += 1;
      const item = recordOf(itemEntry, "One of the dishes was not valid.");
      return {
        name: line(item.name, "Dish name", 80, true),
        description: block(item.description, "Dish description", 400),
        price: line(item.price, "Price", 16, false),
        photoUrl: imageUrl(item.photoUrl),
      };
    });
    return {
      name: line(section.name, "Section name", 60, true),
      note: line(section.note, "Section note", 180, false),
      items,
    };
  });
  if (itemCount > 200) throw new ValidationError("Use 200 dishes or fewer.");
  return sections;
}

function recordOf(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError(message);
  return value as Record<string, unknown>;
}

function line(value: unknown, label: string, max: number, required: boolean): string {
  return clean(value, label, max, required, false);
}

function block(value: unknown, label: string, max: number): string {
  return clean(value, label, max, false, true);
}

function clean(value: unknown, label: string, max: number, required: boolean, allowNewlines: boolean): string {
  if (value == null) {
    if (required) throw new ValidationError(`${label} is required.`);
    return "";
  }
  if (typeof value !== "string") throw new ValidationError(`${label} was not valid.`);
  const withoutControls = allowNewlines
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    : value.replace(/[\u0000-\u001F]/g, "");
  const text = withoutControls.trim();
  if (required && !text) throw new ValidationError(`${label} is required.`);
  if (text.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer.`);
  return text;
}

export function isUploadPath(value: string): boolean {
  return /^\/uploads\/[a-z0-9][a-z0-9.-]*\.(?:jpe?g|png|gif|webp)$/.test(value);
}

function imageUrl(value: unknown): string {
  const text = line(value, "Photo URL", 500, false);
  if (!text) return "";
  if (isUploadPath(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ValidationError("Photo URL must start with http:// or https://.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("Photo URL must start with http:// or https://.");
  }
  if (url.username || url.password) throw new ValidationError("Photo URL cannot include a username or password.");
  return url.href;
}
