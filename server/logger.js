const MAX_ENTRIES = 200;

/** Кольцевой буфер последних запросов к API. */
export const requestLog = [];

export function logger(req, res, next) {
  const start = process.hrtime.bigint();
  const originalWriteHead = res.writeHead;
  // Заголовок с временем ответа нужно выставить до отправки заголовков
  res.writeHead = function (...args) {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    res.setHeader('X-Response-Time', `${ms.toFixed(1)}ms`);
    return originalWriteHead.apply(this, args);
  };
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const entry = {
      time: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms: Math.round(ms * 10) / 10,
    };
    requestLog.push(entry);
    if (requestLog.length > MAX_ENTRIES) requestLog.shift();
    const color = res.statusCode >= 500 ? 31 : res.statusCode >= 400 ? 33 : 32;
    console.log(`\x1b[${color}m${entry.status}\x1b[0m ${entry.method.padEnd(6)} ${entry.path} ${entry.ms}ms`);
  });
  next();
}
