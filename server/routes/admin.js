import { Router } from 'express';
import { db, transaction } from '../db.js';
import { createToken, rateLimit, requireAuth, verifyPassword } from '../auth.js';
import { HttpError, validate } from '../validate.js';
import { requestLog } from '../logger.js';

export const router = Router();

const STATUSES = ['new', 'packed', 'shipped', 'delivered', 'cancelled'];

// POST /api/auth/login  { username, password }
router.post('/auth/login', rateLimit({ limit: 5, windowMs: 60_000 }), (req, res) => {
  const { username, password } = validate(req.body, {
    username: { required: true, max: 50 },
    password: { required: true, max: 100 },
  });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new HttpError(401, 'Неверный логин или пароль');
  }
  res.json({ token: createToken({ sub: user.id, username: user.username }), username: user.username });
});

router.use('/admin', requireAuth);

router.get('/admin/stats', (_req, res) => {
  const totals = db.prepare(`
    SELECT COUNT(*) AS orders,
           COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total END), 0) AS revenue,
           COALESCE(ROUND(AVG(CASE WHEN status != 'cancelled' THEN total END)), 0) AS avg_check
    FROM orders`).get();

  const byStatus = db.prepare('SELECT status, COUNT(*) AS count FROM orders GROUP BY status').all();

  // Выручка по дням за 14 дней, включая дни без заказов (рекурсивный CTE)
  const byDay = db.prepare(`
    WITH RECURSIVE days(d) AS (
      SELECT date('now', '-13 days')
      UNION ALL SELECT date(d, '+1 day') FROM days WHERE d < date('now')
    )
    SELECT days.d AS day,
           COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total END), 0) AS revenue,
           COUNT(o.id) AS orders
    FROM days LEFT JOIN orders o ON date(o.created_at) = days.d
    GROUP BY days.d ORDER BY days.d`).all();

  const topRecords = db.prepare(`
    SELECT oi.title, oi.artist, SUM(oi.qty) AS sold, SUM(oi.qty * oi.price) AS revenue
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.status != 'cancelled'
    GROUP BY oi.record_id ORDER BY sold DESC, revenue DESC LIMIT 5`).all();

  const lowStock = db.prepare(
    'SELECT id, title, artist, stock FROM records WHERE stock <= 2 ORDER BY stock, title').all();

  res.json({ ...totals, byStatus, byDay, topRecords, lowStock });
});

router.get('/admin/orders', (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : null;
  const orders = db.prepare(`
    SELECT * FROM orders ${status ? 'WHERE status = ?' : ''} ORDER BY created_at DESC, id DESC LIMIT 200`)
    .all(...(status ? [status] : []));
  const itemsStmt = db.prepare('SELECT record_id, title, artist, qty, price FROM order_items WHERE order_id = ?');
  orders.forEach(o => { o.items = itemsStmt.all(o.id); });
  res.json(orders);
});

// PATCH /api/admin/orders/:id  { status }
router.patch('/admin/orders/:id', (req, res) => {
  const { status } = validate(req.body, { status: { required: true, oneOf: STATUSES } });
  const id = Number(req.params.id);

  const updated = transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) throw new HttpError(404, 'Заказ не найден');
    if (order.status === 'cancelled') throw new HttpError(409, 'Отменённый заказ нельзя изменить');

    // При отмене возвращаем пластинки на склад
    if (status === 'cancelled') {
      const restock = db.prepare('UPDATE records SET stock = stock + ? WHERE id = ?');
      db.prepare('SELECT record_id, qty FROM order_items WHERE order_id = ?').all(id)
        .forEach(i => i.record_id && restock.run(i.qty, i.record_id));
    }
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  });
  res.json(updated);
});

const recordSchema = {
  title:       { required: true, max: 120 },
  artist:      { required: true, max: 120 },
  year:        { required: true, type: 'int', min: 1900, max: 2100 },
  genre:       { required: true, max: 40 },
  format:      { oneOf: ['LP', '2LP', 'EP', '7"'] },
  condition:   { oneOf: ['M', 'NM', 'VG+', 'VG'] },
  price:       { required: true, type: 'int', min: 1, max: 1_000_000 },
  stock:       { required: true, type: 'int', min: 0, max: 10_000 },
  color:       { pattern: /^#[0-9a-f]{6}$/i, message: 'Цвет в формате #RRGGBB' },
  description: { max: 500 },
};

router.post('/admin/records', (req, res) => {
  const data = validate(req.body, recordSchema);
  const cols = Object.keys(data);
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO records (${cols.join(', ')}) VALUES (${cols.map(c => ':' + c).join(', ')})`).run(data);
  res.status(201).json(db.prepare('SELECT * FROM records WHERE id = ?').get(lastInsertRowid));
});

router.put('/admin/records/:id', (req, res) => {
  const data = validate(req.body, recordSchema, { partial: true });
  const cols = Object.keys(data);
  if (!cols.length) throw new HttpError(400, 'Нет полей для обновления');
  const { changes } = db.prepare(
    `UPDATE records SET ${cols.map(c => `${c} = :${c}`).join(', ')} WHERE id = :id`)
    .run({ ...data, id: Number(req.params.id) });
  if (!changes) throw new HttpError(404, 'Пластинка не найдена');
  res.json(db.prepare('SELECT * FROM records WHERE id = ?').get(Number(req.params.id)));
});

router.delete('/admin/records/:id', (req, res) => {
  const { changes } = db.prepare('DELETE FROM records WHERE id = ?').run(Number(req.params.id));
  if (!changes) throw new HttpError(404, 'Пластинка не найдена');
  res.status(204).end();
});

// Последние запросы к API — видно, как сервер работает «вживую»
router.get('/admin/logs', (_req, res) => res.json(requestLog.slice().reverse()));
