import { Router } from 'express';
import { db, transaction, generateOrderCode } from '../db.js';
import { HttpError, validate } from '../validate.js';

export const router = Router();

const SORTS = {
  new: 'created_at DESC, id DESC',
  price_asc: 'price ASC',
  price_desc: 'price DESC',
  year: 'year ASC',
};

// GET /api/records?genre=Рок&q=kino&sort=price_asc&in_stock=1
router.get('/records', (req, res) => {
  const where = [];
  const params = {};
  if (req.query.genre) {
    where.push('genre = :genre');
    params.genre = String(req.query.genre);
  }
  if (req.query.q) {
    where.push('(title LIKE :q OR artist LIKE :q)');
    params.q = `%${String(req.query.q).slice(0, 60)}%`;
  }
  if (req.query.in_stock === '1') where.push('stock > 0');

  const order = SORTS[req.query.sort] || SORTS.new;
  const sql = `SELECT * FROM records ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`;
  const items = db.prepare(sql).all(params);
  res.json({ count: items.length, items });
});

router.get('/records/:id', (req, res) => {
  const record = db.prepare('SELECT * FROM records WHERE id = ?').get(Number(req.params.id));
  if (!record) throw new HttpError(404, 'Пластинка не найдена');
  res.json(record);
});

router.get('/genres', (_req, res) => {
  res.json(db.prepare(
    'SELECT genre AS name, COUNT(*) AS count FROM records GROUP BY genre ORDER BY count DESC').all());
});

const customerSchema = {
  name:    { required: true, min: 2, max: 80 },
  phone:   { required: true, pattern: /^\+?[\d\s()-]{10,20}$/, message: 'Например, +7 900 123-45-67' },
  email:   { required: true, max: 120, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Неверный email' },
  address: { required: true, min: 5, max: 200 },
};

// POST /api/orders  { customer: {...}, items: [{ id, qty }] }
router.post('/orders', (req, res) => {
  const customer = validate(req.body?.customer, customerSchema);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) throw new HttpError(400, 'Корзина пуста');
  if (items.length > 50) throw new HttpError(400, 'Слишком много позиций');

  const getRecord = db.prepare('SELECT * FROM records WHERE id = ?');
  const takeStock = db.prepare('UPDATE records SET stock = stock - ? WHERE id = ? AND stock >= ?');
  const insertOrder = db.prepare(`
    INSERT INTO orders (code, name, phone, email, address, total) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, record_id, title, artist, qty, price) VALUES (?, ?, ?, ?, ?, ?)`);

  // Цены и остатки берём только из БД — клиенту не доверяем.
  const order = transaction(() => {
    const lines = items.map(({ id, qty }) => {
      qty = Number(qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw new HttpError(400, 'Неверное количество');
      const record = getRecord.get(Number(id));
      if (!record) throw new HttpError(400, `Пластинка #${id} не найдена`);
      if (takeStock.run(qty, record.id, qty).changes === 0) {
        throw new HttpError(409, `«${record.title}» осталось только ${record.stock} шт.`);
      }
      return { record, qty };
    });
    const total = lines.reduce((sum, l) => sum + l.record.price * l.qty, 0);
    const code = generateOrderCode();
    const { lastInsertRowid } = insertOrder.run(
      code, customer.name, customer.phone, customer.email, customer.address, total);
    for (const { record, qty } of lines) {
      insertItem.run(lastInsertRowid, record.id, record.title, record.artist, qty, record.price);
    }
    return { id: Number(lastInsertRowid), code, total, status: 'new' };
  });

  res.status(201).json(order);
});

// GET /api/orders/:code — публичное отслеживание, без персональных данных
router.get('/orders/:code', (req, res) => {
  const order = db.prepare(
    'SELECT id, code, status, total, created_at, updated_at FROM orders WHERE code = ?')
    .get(String(req.params.code).toUpperCase().trim());
  if (!order) throw new HttpError(404, 'Заказ с таким номером не найден');
  order.items = db.prepare(
    'SELECT title, artist, qty, price FROM order_items WHERE order_id = ?').all(order.id);
  delete order.id;
  res.json(order);
});
