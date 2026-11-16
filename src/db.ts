export type SqlValue = string | number | null;

export interface Prepared {
  bind(...values: SqlValue[]): Prepared;
  all<T extends Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T extends Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number; last_row_id: number } }>;
}

export interface AppDatabase {
  prepare(sql: string): Prepared;
  batch(statements: Prepared[]): Promise<void>;
}

export class SetupError extends Error {
  constructor() {
    super("missing_restaurant");
    this.name = "SetupError";
  }
}

export interface RestaurantFields {
  name: string;
  city: string;
  phone: string;
  address: string;
  intro: string;
  about: string;
  visitNote: string;
  heroImageUrl: string;
}

export interface HourFields {
  label: string;
  opens: string;
  closes: string;
  closed: boolean;
}

export interface MenuItemFields {
  name: string;
  description: string;
  price: string;
  photoUrl: string;
}

export interface MenuSectionFields {
  name: string;
  note: string;
  items: MenuItemFields[];
}

export interface SiteContent {
  restaurant: RestaurantFields;
  hours: HourFields[];
  menu: MenuSectionFields[];
}

interface RestaurantRow extends Record<string, unknown> {
  name: string;
  city: string;
  phone: string;
  address: string;
  intro: string;
  about: string;
  visit_note: string;
  hero_image_url: string;
}

interface HourRow extends Record<string, unknown> {
  label: string;
  opens: string;
  closes: string;
  closed: number | boolean | string;
}

interface SectionRow extends Record<string, unknown> {
  id: number;
  name: string;
  note: string;
}

interface ItemRow extends Record<string, unknown> {
  section_id: number;
  name: string;
  description: string;
  price: string;
  photo_url: string;
}

interface AdminRow extends Record<string, unknown> {
  username: string;
  password_hash: string;
}

class D1Statement implements Prepared {
  private readonly statement: D1PreparedStatement;

  constructor(statement: D1PreparedStatement) {
    this.statement = statement;
  }

  bind(...values: SqlValue[]): Prepared {
    return new D1Statement(this.statement.bind(...values));
  }

  async all<T extends Record<string, unknown>>(): Promise<{ results: T[] }> {
    const result = await this.statement.all<T>();
    return { results: result.results ?? [] };
  }

  async first<T extends Record<string, unknown>>(): Promise<T | null> {
    return (await this.statement.first<T>()) ?? null;
  }

  async run(): Promise<{ meta: { changes: number; last_row_id: number } }> {
    const result = await this.statement.run();
    return {
      meta: {
        changes: result.meta.changes ?? 0,
        last_row_id: result.meta.last_row_id ?? 0,
      },
    };
  }

  unwrap(): D1PreparedStatement {
    return this.statement;
  }
}

export function fromD1(database: D1Database): AppDatabase {
  return {
    prepare(sql: string): Prepared {
      return new D1Statement(database.prepare(sql));
    },
    async batch(statements: Prepared[]): Promise<void> {
      const inner = statements.map((statement) => {
        if (!(statement instanceof D1Statement)) {
          throw new Error("Expected a D1 statement.");
        }
        return statement.unwrap();
      });
      await database.batch(inner);
    },
  };
}

export async function loadContent(db: AppDatabase): Promise<SiteContent> {
  const restaurant = await db
    .prepare(
      `SELECT name, city, phone, address, intro, about, visit_note, hero_image_url
       FROM restaurant WHERE id = 1`,
    )
    .first<RestaurantRow>();
  if (!restaurant) throw new SetupError();

  const hours = await db
    .prepare("SELECT label, opens, closes, closed FROM hours ORDER BY sort_order, id")
    .all<HourRow>();
  const sections = await db
    .prepare("SELECT id, name, note FROM menu_sections ORDER BY sort_order, id")
    .all<SectionRow>();
  const items = await db
    .prepare(
      "SELECT section_id, name, description, price, photo_url FROM menu_items ORDER BY sort_order, id",
    )
    .all<ItemRow>();

  const itemsBySection = new Map<number, MenuItemFields[]>();
  for (const item of items.results) {
    const list = itemsBySection.get(item.section_id) ?? [];
    list.push({
      name: item.name,
      description: item.description,
      price: item.price,
      photoUrl: item.photo_url,
    });
    itemsBySection.set(item.section_id, list);
  }

  return {
    restaurant: {
      name: restaurant.name,
      city: restaurant.city,
      phone: restaurant.phone,
      address: restaurant.address,
      intro: restaurant.intro,
      about: restaurant.about,
      visitNote: restaurant.visit_note,
      heroImageUrl: restaurant.hero_image_url,
    },
    hours: hours.results.map((hour) => ({
      label: hour.label,
      opens: hour.opens,
      closes: hour.closes,
      closed: hour.closed === 1 || hour.closed === true || hour.closed === "1",
    })),
    menu: sections.results.map((section) => ({
      name: section.name,
      note: section.note,
      items: itemsBySection.get(section.id) ?? [],
    })),
  };
}

export async function saveRestaurant(db: AppDatabase, fields: RestaurantFields): Promise<void> {
  await db
    .prepare(
      `UPDATE restaurant
       SET name = ?, city = ?, phone = ?, address = ?, intro = ?, about = ?, visit_note = ?,
           hero_image_url = ?, updated_at = ?
       WHERE id = 1`,
    )
    .bind(
      fields.name,
      fields.city,
      fields.phone,
      fields.address,
      fields.intro,
      fields.about,
      fields.visitNote,
      fields.heroImageUrl,
      new Date().toISOString(),
    )
    .run();
}

export async function saveHours(db: AppDatabase, hours: HourFields[]): Promise<void> {
  const statements: Prepared[] = [db.prepare("DELETE FROM hours")];
  hours.forEach((hour, index) => {
    statements.push(
      db
        .prepare(
          "INSERT INTO hours (label, opens, closes, closed, sort_order) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(hour.label, hour.closed ? "" : hour.opens, hour.closed ? "" : hour.closes, hour.closed ? 1 : 0, index),
    );
  });
  await db.batch(statements);
}

export async function saveMenu(db: AppDatabase, sections: MenuSectionFields[]): Promise<void> {
  const statements: Prepared[] = [
    db.prepare("DELETE FROM menu_items"),
    db.prepare("DELETE FROM menu_sections"),
  ];
  sections.forEach((section, sectionIndex) => {
    statements.push(
      db
        .prepare("INSERT INTO menu_sections (name, note, sort_order) VALUES (?, ?, ?)")
        .bind(section.name, section.note, sectionIndex),
    );
    section.items.forEach((item, itemIndex) => {
      statements.push(
        db
          .prepare(
            `INSERT INTO menu_items (section_id, name, description, price, photo_url, sort_order)
             VALUES ((SELECT id FROM menu_sections WHERE sort_order = ?), ?, ?, ?, ?, ?)`,
          )
          .bind(sectionIndex, item.name, item.description, item.price, item.photoUrl, itemIndex),
      );
    });
  });
  await db.batch(statements);
}

export async function findAdmin(
  db: AppDatabase,
  username: string,
): Promise<{ username: string; passwordHash: string } | null> {
  const row = await db
    .prepare("SELECT username, password_hash FROM admin_users WHERE username = ?")
    .bind(username)
    .first<AdminRow>();
  if (!row) return null;
  return { username: row.username, passwordHash: row.password_hash };
}

export async function updatePassword(db: AppDatabase, username: string, passwordHash: string): Promise<void> {
  await db
    .prepare("UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE username = ?")
    .bind(passwordHash, new Date().toISOString(), username)
    .run();
}
