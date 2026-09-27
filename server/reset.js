import { rmSync } from 'node:fs';
import { db, DB_PATH } from './db.js';

// Удаляем файл базы; при следующем старте схема и демо-данные создадутся заново.
db.close();
for (const suffix of ['', '-wal', '-shm']) rmSync(DB_PATH + suffix, { force: true });
console.log('База удалена. Запустите `npm start` — она создастся заново с демо-данными.');
