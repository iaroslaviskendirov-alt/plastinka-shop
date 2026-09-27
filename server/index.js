import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { logger } from './logger.js';
import { HttpError } from './validate.js';
import { router as publicRouter } from './routes/public.js';
import { router as adminRouter } from './routes/admin.js';

const PORT = Number(process.env.PORT) || 3000;
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // за прокси хостинга req.ip — реальный IP клиента (важно для лимита входа)
app.use(express.json({ limit: '20kb' }));
app.use((_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});

app.use('/api', logger);
app.get('/api/health', (_req, res) => {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM records').get();
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), records: n, node: process.version });
});
app.use('/api', publicRouter);
app.use('/api', adminRouter);
app.use('/api', (_req, _res) => { throw new HttpError(404, 'Такого эндпоинта нет'); });

app.use(express.static(publicDir, { extensions: ['html'] }));

// Единый обработчик ошибок: HttpError → понятный JSON, остальное → 500
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Некорректный JSON');
  if (!(err instanceof HttpError)) {
    console.error(err);
    err = new HttpError(500, 'Внутренняя ошибка сервера');
  }
  res.status(err.status).json({ error: err.message, ...(err.details && { fields: err.details }) });
});

app.listen(PORT, () => {
  console.log(`\n  Пластинка запущена: http://localhost:${PORT}`);
  console.log(`  Админка:            http://localhost:${PORT}/admin`);
  console.log(`  Документация API:   http://localhost:${PORT}/docs\n`);
});
