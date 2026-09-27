// Обёртка над fetch: единая обработка ошибок + журнал запросов для API-консоли.

export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

const entries = [];
const listeners = new Set();

export function onRequest(fn) {
  listeners.add(fn);
  entries.forEach(fn);
}

export async function api(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const started = performance.now();
  const entry = { method, path, body, status: 0, ms: 0, serverMs: null, response: null };
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body && JSON.stringify(body) });
  } catch {
    entry.response = { error: 'Сервер недоступен' };
    push(entry);
    throw new ApiError(0, 'Сервер недоступен. Проверьте, что он запущен.');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  Object.assign(entry, {
    status: res.status,
    ms: Math.round(performance.now() - started),
    serverMs: res.headers.get('X-Response-Time'),
    response: data,
  });
  push(entry);
  if (!res.ok) throw new ApiError(res.status, data?.error || `Ошибка ${res.status}`, data?.fields);
  return data;
}

function push(entry) {
  entry.at = new Date();
  entries.push(entry);
  listeners.forEach(fn => fn(entry));
}

export const rub = n => `${n.toLocaleString('ru-RU')} ₽`;

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Тёмный или светлый текст поверх цвета обложки. */
export function inkFor(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? '#15171b' : '#f4f5f1';
}

/** Панель «Под капотом»: показывает каждый запрос страницы к серверу. */
export function mountApiConsole() {
  const root = document.createElement('aside');
  root.className = 'apicon';
  root.innerHTML = `
    <button class="apicon-toggle" aria-expanded="false" aria-controls="apicon-panel">
      <span class="apicon-led"></span> API <span class="apicon-count">0</span>
    </button>
    <section class="apicon-panel" id="apicon-panel" hidden>
      <header>
        <strong>Запросы к серверу</strong>
        <span class="apicon-hint">Нажмите на строку, чтобы увидеть ответ</span>
      </header>
      <ol class="apicon-list"></ol>
    </section>`;
  document.body.append(root);

  const toggle = root.querySelector('.apicon-toggle');
  const panel = root.querySelector('.apicon-panel');
  const list = root.querySelector('.apicon-list');
  const count = root.querySelector('.apicon-count');
  const led = root.querySelector('.apicon-led');
  let n = 0;

  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });

  onRequest(e => {
    count.textContent = ++n;
    led.classList.remove('blink');
    void led.offsetWidth;
    led.classList.add('blink');

    const li = document.createElement('li');
    const kind = e.status >= 400 || e.status === 0 ? 'err' : 'ok';
    const json = JSON.stringify(e.response, null, 2) ?? '(пустой ответ)';
    li.innerHTML = `
      <details>
        <summary>
          <span class="m m-${e.method.toLowerCase()}">${e.method}</span>
          <span class="p">${escapeHtml(e.path)}</span>
          <span class="s s-${kind}">${e.status || '—'}</span>
          <span class="t" title="Сервер / вся сеть">${e.serverMs ? e.serverMs.replace('ms', '') + ' / ' : ''}${e.ms} мс</span>
        </summary>
        ${e.body ? `<p class="apicon-label">Тело запроса</p><pre>${escapeHtml(JSON.stringify(e.body, null, 2))}</pre>` : ''}
        <p class="apicon-label">Ответ</p>
        <pre>${escapeHtml(json.length > 4000 ? json.slice(0, 4000) + '\n…' : json)}</pre>
      </details>`;
    list.prepend(li);
    while (list.children.length > 60) list.lastChild.remove();
  });
}
