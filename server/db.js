import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './auth.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = process.env.DB_PATH || join(root, 'data', 'shop.db');

mkdirSync(dirname(DB_PATH), { recursive: true });
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    artist      TEXT    NOT NULL,
    year        INTEGER NOT NULL,
    genre       TEXT    NOT NULL,
    format      TEXT    NOT NULL DEFAULT 'LP',
    condition   TEXT    NOT NULL DEFAULT 'NM',
    price       INTEGER NOT NULL CHECK (price > 0),
    stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    color       TEXT    NOT NULL DEFAULT '#c0392b',
    description TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT    NOT NULL UNIQUE,
    name       TEXT    NOT NULL,
    phone      TEXT    NOT NULL,
    email      TEXT    NOT NULL,
    address    TEXT    NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'new'
               CHECK (status IN ('new','packed','shipped','delivered','cancelled')),
    total      INTEGER NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    order_id  INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    record_id INTEGER REFERENCES records(id) ON DELETE SET NULL,
    title     TEXT    NOT NULL,
    artist    TEXT    NOT NULL,
    qty       INTEGER NOT NULL CHECK (qty > 0),
    price     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_records_genre ON records(genre);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
`);

/** Выполняет fn внутри транзакции; при исключении — откат. */
export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const SEED_RECORDS = [
  ['Группа крови', 'Кино', 1988, 'Русский рок', 'LP', 'NM', 4200, 6, '#b3261e', 'Переиздание на 180-граммовом виниле. Самый узнаваемый альбом группы.'],
  ['Звезда по имени Солнце', 'Кино', 1989, 'Русский рок', 'LP', 'VG+', 3900, 3, '#e0a100', 'Последний студийный альбом, записанный при жизни Виктора Цоя.'],
  ['Радио Африка', 'Аквариум', 1983, 'Русский рок', 'LP', 'VG+', 3600, 2, '#2e7d6b', 'Эксперименты с формой и звуком, собранные в один из главных альбомов ленинградского рока.'],
  ['Земфира', 'Земфира', 1999, 'Русский рок', 'LP', 'M', 4500, 5, '#6a1b9a', 'Дебютный альбом, переизданный на виниле с оригинальным мастерингом.'],
  ['The Dark Side of the Moon', 'Pink Floyd', 1973, 'Рок', 'LP', 'NM', 5200, 4, '#212121', 'Концептуальный альбом, который провёл в чартах Billboard больше 900 недель.'],
  ['OK Computer', 'Radiohead', 1997, 'Рок', '2LP', 'M', 5600, 7, '#5c8fb3', 'Двойной винил, 45 оборотов. Альбом о тревоге и технологиях.'],
  ['Nevermind', 'Nirvana', 1991, 'Рок', 'LP', 'NM', 3800, 8, '#1976d2', 'Альбом, который вывел гранж из клубов Сиэтла на радио.'],
  ['Rumours', 'Fleetwood Mac', 1977, 'Рок', 'LP', 'VG+', 3400, 1, '#8d6e63', 'Записан в разгар личных драм внутри группы — и слышно это в каждой песне.'],
  ['Kind of Blue', 'Miles Davis', 1959, 'Джаз', 'LP', 'NM', 4100, 5, '#0d47a1', 'Модальный джаз в эталонном исполнении. Самая продаваемая джазовая пластинка.'],
  ['A Love Supreme', 'John Coltrane', 1965, 'Джаз', 'LP', 'VG+', 4400, 2, '#37474f', 'Сюита из четырёх частей, записанная за один день.'],
  ['Random Access Memories', 'Daft Punk', 2013, 'Электроника', '2LP', 'M', 6200, 6, '#c9a227', 'Живые музыканты вместо сэмплов — дуэт вернулся к звуку конца 70-х.'],
  ['Computer World', 'Kraftwerk', 1981, 'Электроника', 'LP', 'NM', 3700, 3, '#f9a825', 'Про домашние компьютеры — за несколько лет до того, как они появились дома.'],
  ['Selected Ambient Works 85–92', 'Aphex Twin', 1992, 'Электроника', '2LP', 'M', 5100, 4, '#90a4ae', 'Ранние эмбиент-треки, записанные на самодельном оборудовании.'],
  ['Dummy', 'Portishead', 1994, 'Трип-хоп', 'LP', 'NM', 4300, 5, '#00695c', 'Дебют бристольской сцены: нуар-саундтрек к несуществующему фильму.'],
  ['Mezzanine', 'Massive Attack', 1998, 'Трип-хоп', '2LP', 'NM', 4800, 0, '#263238', 'Тёмный и плотный альбом с гитарами и тяжёлыми басами.'],
  ['Homogenic', 'Björk', 1997, 'Поп', 'LP', 'M', 4600, 3, '#ad1457', 'Струнный октет и битовая электроника — портрет исландского пейзажа.'],
];

function seed() {
  const hasRecords = db.prepare('SELECT COUNT(*) AS n FROM records').get().n > 0;
  if (!hasRecords) {
    const insert = db.prepare(`
      INSERT INTO records (title, artist, year, genre, format, condition, price, stock, color, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    transaction(() => SEED_RECORDS.forEach(r => insert.run(...r)));
    seedDemoOrders();
  }

  const hasUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
  if (!hasUsers) {
    const username = process.env.ADMIN_USER || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(username, hashPassword(password));
  }
}

/** Демо-заказы за последние две недели, чтобы в админке были графики. */
function seedDemoOrders() {
  const records = db.prepare('SELECT id, title, artist, price FROM records').all();
  const names = ['Анна К.', 'Михаил Р.', 'Ольга С.', 'Дмитрий Л.', 'Екатерина В.', 'Игорь П.', 'Мария Т.', 'Сергей Н.'];
  const statuses = ['delivered', 'delivered', 'delivered', 'shipped', 'packed', 'new', 'cancelled'];
  const insertOrder = db.prepare(`
    INSERT INTO orders (code, name, phone, email, address, status, total, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?))`);
  const insertItem = db.prepare(
    'INSERT INTO order_items (order_id, record_id, title, artist, qty, price) VALUES (?, ?, ?, ?, ?, ?)');

  let rnd = 7; // детерминированный генератор, чтобы демо было одинаковым
  const next = n => (rnd = (rnd * 16807) % 2147483647) % n;

  transaction(() => {
    for (let i = 0; i < 26; i++) {
      const daysAgo = 13 - Math.floor(i / 2);
      const offset = `-${daysAgo} days`;
      const picked = [records[next(records.length)], records[next(records.length)]]
        .filter((r, idx, arr) => arr.findIndex(x => x.id === r.id) === idx)
        .slice(0, 1 + next(2));
      const total = picked.reduce((s, r) => s + r.price, 0);
      const status = daysAgo > 4 ? statuses[next(4)] : statuses[next(statuses.length)];
      const { lastInsertRowid } = insertOrder.run(
        generateOrderCode(), names[next(names.length)], '+7 900 000-00-00',
        'demo@example.com', 'Москва, демо-адрес', status, total, offset, offset);
      picked.forEach(r => insertItem.run(lastInsertRowid, r.id, r.title, r.artist, 1, r.price));
    }
  });
}

export function generateOrderCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = 'PL-';
  for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

seed();
