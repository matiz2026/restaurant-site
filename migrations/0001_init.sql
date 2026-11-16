-- Restaurant facts, menu, and the staff login.
-- The password column stores a PBKDF2 hash, not the password.

CREATE TABLE restaurant (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  intro TEXT NOT NULL,
  about TEXT NOT NULL,
  visit_note TEXT NOT NULL,
  hero_image_url TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  opens TEXT NOT NULL DEFAULT '',
  closes TEXT NOT NULL DEFAULT '',
  closed INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL
);

CREATE TABLE menu_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL
);

CREATE TABLE menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  photo_url TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL,
  FOREIGN KEY (section_id) REFERENCES menu_sections (id) ON DELETE CASCADE
);

CREATE INDEX idx_menu_items_section ON menu_items (section_id, sort_order);

CREATE TABLE admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO restaurant (
  id, name, city, phone, address, intro, about, visit_note, hero_image_url, updated_at
) VALUES (
  1,
  'Matiz',
  'Your city',
  '(000) 000-0000',
  '123 Example Street',
  'A placeholder welcome. Replace this line from the dashboard when the real introduction is ready.',
  'This about text is a placeholder. Use it to say what the restaurant is like, who cooks, and what a guest should expect. Nothing in this paragraph is final.',
  'This visit note is a placeholder. Add how to find the door, where to leave a car, or what the block is like.',
  '',
  '2026-11-13T00:00:00.000Z'
);

INSERT INTO hours (label, opens, closes, closed, sort_order) VALUES
  ('Monday', '11:00', '21:00', 0, 0),
  ('Tuesday', '11:00', '21:00', 0, 1),
  ('Wednesday', '11:00', '21:00', 0, 2),
  ('Thursday', '11:00', '21:00', 0, 3),
  ('Friday', '11:00', '22:00', 0, 4),
  ('Saturday', '11:00', '22:00', 0, 5),
  ('Sunday', '', '', 1, 6);

INSERT INTO menu_sections (id, name, note, sort_order) VALUES
  (1, 'Plates', 'Sample section. Rename it, or delete it and add your own.', 0),
  (2, 'Drinks', 'Sample section for drinks.', 1);

INSERT INTO menu_items (section_id, name, description, price, photo_url, sort_order) VALUES
  (1, 'Placeholder plate', 'Replace this dish with something you actually serve. The description and price are samples.', '$18', '', 0),
  (1, 'Placeholder second plate', 'A second sample so the menu has more than one line before you add real dishes.', '$14', '', 1),
  (2, 'Placeholder drink', 'Replace this with a real drink.', '$8', '', 0);

INSERT INTO admin_users (username, password_hash, updated_at) VALUES (
  'matiz',
  'pbkdf2-sha256$20000$7b51358a7484bbaa2b8cdbcb0046756b$0f6e821bb3548c7d82a0d511a89ab667d975bdeb6aeff82bc3b3fef2aab7f38a',
  '2026-11-13T00:00:00.000Z'
);
