import { api, ApiError, escapeHtml as esc, mountApiConsole, rub } from './api.js';

mountApiConsole();

const $ = s => document.querySelector(s);
const main = $('#main');
const auth = {
  get token() { return sessionStorage.getItem('token'); },
  set token(v) { v ? sessionStorage.setItem('token', v) : sessionStorage.removeItem('token'); },
};

const STATUS = {
  new: 'Новый', packed: 'Упакован', shipped: 'В пути', delivered: 'Доставлен', cancelled: 'Отменён',
};

/** Запрос с токеном; при 401 возвращает на экран входа. */
async function adminApi(path, opts = {}) {
  try {
    return await api(path, { ...opts, token: auth.token });
  } catch (err) {
    if (err.status === 401) {
      auth.token = null;
      showLogin('Сессия истекла, войдите снова');
    }
    throw err;
  }
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

const fmtDate = s => new Date(s.replace(' ', 'T') + 'Z')
  .toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// ---------- Вход ----------

function showLogin(message) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  const box = $('#loginError');
  box.hidden = !message;
  box.textContent = message || '';
  $('#loginForm').username.focus();
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    const { token, username } = await api('/auth/login', {
      method: 'POST', body: Object.fromEntries(new FormData(e.target)),
    });
    auth.token = token;
    sessionStorage.setItem('username', username);
    e.target.reset();
    showApp();
  } catch (err) {
    $('#loginError').textContent = err.message;
    $('#loginError').hidden = false;
  } finally {
    btn.disabled = false;
  }
});

$('#logout').addEventListener('click', () => {
  auth.token = null;
  showLogin();
});

function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#whoami').textContent = `Вы вошли как ${sessionStorage.getItem('username') || 'admin'}`;
  openTab(location.hash.slice(1) || 'overview');
}

// ---------- Навигация ----------

const tabs = { overview: renderOverview, orders: renderOrders, records: renderRecords, logs: renderLogs };

function openTab(name) {
  if (!tabs[name]) name = 'overview';
  history.replaceState(null, '', `#${name}`);
  document.querySelectorAll('[data-tab]').forEach(b => b.removeAttribute('aria-current'));
  document.querySelector(`[data-tab="${name}"]`).setAttribute('aria-current', 'page');
  clearInterval(renderLogs.timer);
  main.innerHTML = '<p class="muted">Загружаем…</p>';
  tabs[name]().catch(err => {
    if (err.status !== 401) main.innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
  });
}

document.querySelector('.side-nav').addEventListener('click', e => {
  const btn = e.target.closest('[data-tab]');
  if (btn) openTab(btn.dataset.tab);
});

// ---------- Обзор ----------

async function renderOverview() {
  const s = await adminApi('/admin/stats');
  const count = st => s.byStatus.find(x => x.status === st)?.count || 0;
  const maxSold = Math.max(1, ...s.topRecords.map(r => r.sold));

  main.innerHTML = `
    <div class="page-head"><h1>Обзор магазина</h1></div>
    <div class="kpis">
      <div class="kpi"><p>Выручка без отменённых</p><strong>${rub(s.revenue)}</strong></div>
      <div class="kpi"><p>Всего заказов</p><strong>${s.orders}</strong></div>
      <div class="kpi"><p>Средний чек</p><strong>${rub(s.avg_check)}</strong></div>
    </div>
    <div class="panels">
      <section class="panel">
        <h2>Выручка за 14 дней</h2>
        <div class="chart" id="chart"></div>
      </section>
      <section class="panel">
        <h2>Лидеры продаж</h2>
        <ul class="bars-list">
          ${s.topRecords.map(r => `
            <li>
              <div class="row"><span>${esc(r.artist)} — ${esc(r.title)}</span><strong>${r.sold} шт.</strong></div>
              <div class="track"><div class="fill" style="width:${(r.sold / maxSold) * 100}%"></div></div>
            </li>`).join('') || '<li class="muted">Продаж пока нет</li>'}
        </ul>
      </section>
      <section class="panel">
        <h2>Заказы по статусам</h2>
        <ul class="low-stock">
          ${Object.entries(STATUS).map(([k, label]) =>
            `<li><span class="badge badge-${k}">${label}</span><strong>${count(k)}</strong></li>`).join('')}
        </ul>
      </section>
      <section class="panel">
        <h2>Заканчиваются на складе</h2>
        ${s.lowStock.length ? `<ul class="low-stock">${s.lowStock.map(r => `
          <li><span>${esc(r.artist)} — ${esc(r.title)}</span>
          <strong style="color:${r.stock ? 'inherit' : 'var(--bad)'}">${r.stock ? `${r.stock} шт.` : 'нет'}</strong></li>`).join('')}</ul>`
          : '<p class="muted">Всех пластинок хватает.</p>'}
      </section>
    </div>`;
  drawRevenueChart($('#chart'), s.byDay);
}

/** Столбчатый график на SVG без библиотек: одна серия, подсказка при наведении. */
function drawRevenueChart(el, days) {
  const W = 640, H = 240, pad = { t: 12, r: 8, b: 26, l: 52 };
  const max = Math.max(...days.map(d => d.revenue), 1);
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const bw = iw / days.length;
  const barW = Math.min(bw - 6, 26);
  const y = v => pad.t + ih - (v / top) * ih;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Выручка по дням">`;
  for (let v = 0; v <= top; v += step) {
    svg += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis-label" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${v ? `${v / 1000}к` : '0'}</text>`;
  }
  days.forEach((d, i) => {
    const cx = pad.l + bw * i + bw / 2;
    const h = Math.max(0, ih - (y(d.revenue) - pad.t));
    const r = Math.min(4, h / 2);
    // Столбик со скруглённым верхом и прямым основанием
    const x0 = cx - barW / 2, x1 = cx + barW / 2, yb = pad.t + ih, yt = yb - h;
    const path = h ? `M${x0},${yb} V${yt + r} Q${x0},${yt} ${x0 + r},${yt} H${x1 - r} Q${x1},${yt} ${x1},${yt + r} V${yb} Z` : '';
    svg += `<rect class="hit" data-i="${i}" x="${pad.l + bw * i}" y="${pad.t}" width="${bw}" height="${ih}"/>
      <path class="bar" d="${path}"/>`;
    if (i % 2 === days.length % 2 || days.length < 8) {
      const label = new Date(d.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
      svg += `<text class="axis-label" x="${cx}" y="${H - 6}" text-anchor="middle">${label}</text>`;
    }
  });
  svg += '</svg>';

  el.innerHTML = svg + '<div class="tooltip" hidden></div>';
  const tip = el.querySelector('.tooltip');
  el.querySelectorAll('.hit').forEach(hit => {
    hit.addEventListener('mouseenter', () => {
      const d = days[hit.dataset.i];
      const box = hit.getBoundingClientRect(), host = el.getBoundingClientRect();
      const bar = hit.nextElementSibling.getBoundingClientRect();
      tip.innerHTML = `<strong>${new Date(d.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</strong><br>
        ${rub(d.revenue)}, заказов: ${d.orders}`;
      tip.style.left = `${box.left - host.left + box.width / 2}px`;
      tip.style.top = `${(bar.height ? bar.top : box.bottom - 26) - host.top - 8}px`;
      tip.hidden = false;
    });
    hit.addEventListener('mouseleave', () => { tip.hidden = true; });
  });
}

function niceStep(raw) {
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
}

// ---------- Заказы ----------

let orderFilter = '';

async function renderOrders() {
  const orders = await adminApi(`/admin/orders${orderFilter ? `?status=${orderFilter}` : ''}`);
  main.innerHTML = `
    <div class="page-head"><h1>Заказы</h1></div>
    <div class="tabs" id="orderTabs">
      ${[['', 'Все'], ...Object.entries(STATUS)].map(([k, l]) =>
        `<button data-status="${k}" aria-pressed="${k === orderFilter}">${l}</button>`).join('')}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Номер</th><th>Дата</th><th>Покупатель</th><th>Состав</th><th class="num">Сумма</th><th>Статус</th></tr></thead>
        <tbody>
          ${orders.map(o => `
            <tr>
              <td class="code">${esc(o.code)}</td>
              <td>${fmtDate(o.created_at)}</td>
              <td>${esc(o.name)}<div class="small">${esc(o.phone)}<br>${esc(o.email)}</div></td>
              <td>${o.items.map(i => `${esc(i.artist)} — ${esc(i.title)}${i.qty > 1 ? ` ×${i.qty}` : ''}`).join('<br>')}
                <div class="small">${esc(o.address)}</div></td>
              <td class="num">${rub(o.total)}</td>
              <td>${o.status === 'cancelled'
                ? '<span class="badge badge-cancelled">Отменён</span>'
                : `<select class="status-select" data-order="${o.id}" aria-label="Статус заказа ${esc(o.code)}">
                    ${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${l}</option>`).join('')}
                  </select>`}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="muted">Заказов с таким статусом нет</td></tr>'}
        </tbody>
      </table>
    </div>`;

  $('#orderTabs').onclick = e => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    orderFilter = b.dataset.status;
    renderOrders();
  };
  main.querySelectorAll('.status-select').forEach(sel => {
    sel.dataset.prev = sel.value;
    sel.onchange = async () => {
      if (sel.value === 'cancelled' && !confirm('Отменить заказ? Пластинки вернутся на склад, изменить статус потом будет нельзя.')) {
        sel.value = sel.dataset.prev;
        return;
      }
      try {
        const o = await adminApi(`/admin/orders/${sel.dataset.order}`, { method: 'PATCH', body: { status: sel.value } });
        toast(`${o.code}: ${STATUS[o.status].toLowerCase()}`);
        sel.dataset.prev = sel.value;
        if (o.status === 'cancelled') renderOrders();
      } catch (err) {
        sel.value = sel.dataset.prev;
        toast(err.message);
      }
    };
  });
}

// ---------- Каталог ----------

async function renderRecords() {
  const { items } = await api('/records?sort=new');
  main.innerHTML = `
    <div class="page-head">
      <h1>Каталог</h1>
      <button class="btn btn-dark" id="addRecord">Добавить пластинку</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Пластинка</th><th>Жанр</th><th>Год</th><th>Формат</th><th class="num">Цена</th><th class="num">Склад</th><th></th></tr></thead>
        <tbody>
          ${items.map(r => `
            <tr>
              <td><span class="swatch" style="background:${r.color}"></span><strong>${esc(r.title)}</strong>
                <div class="small">${esc(r.artist)}</div></td>
              <td>${esc(r.genre)}</td>
              <td>${r.year}</td>
              <td>${esc(r.format)}, ${esc(r.condition)}</td>
              <td class="num">${rub(r.price)}</td>
              <td class="num" style="${r.stock <= 2 ? 'color:var(--bad);font-weight:700' : ''}">${r.stock}</td>
              <td><div class="row-actions">
                <button class="btn btn-ghost btn-sm" data-edit="${r.id}">Изменить</button>
                <button class="btn btn-ghost btn-sm" data-del="${r.id}" aria-label="Удалить ${esc(r.title)}">Удалить</button>
              </div></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  $('#addRecord').onclick = () => openRecordForm();
  main.querySelector('tbody').onclick = async e => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) openRecordForm(items.find(r => r.id === Number(edit.dataset.edit)));
    if (del) {
      const r = items.find(x => x.id === Number(del.dataset.del));
      if (!confirm(`Удалить «${r.title}» из каталога? В старых заказах позиция сохранится.`)) return;
      try {
        await adminApi(`/admin/records/${r.id}`, { method: 'DELETE' });
        toast(`«${r.title}» удалена`);
        renderRecords();
      } catch (err) { toast(err.message); }
    }
  };
}

function openRecordForm(r) {
  const dlg = $('#recordForm');
  const v = k => esc(r?.[k] ?? '');
  const opt = (name, values, current) => values.map(x =>
    `<option ${x === current ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const f = (name, label, attrs = '', cls = '') => `
    <label class="field ${cls}" data-field="${name}"><span>${label}</span>
      <input name="${name}" value="${v(name)}" ${attrs}><span class="err"></span></label>`;

  dlg.innerHTML = `
    <form novalidate>
      <h2 id="recordFormTitle">${r ? 'Изменить пластинку' : 'Новая пластинка'}</h2>
      <div class="form-error full" hidden></div>
      ${f('title', 'Название', 'required')}
      ${f('artist', 'Исполнитель', 'required')}
      ${f('genre', 'Жанр', 'required list="genreList"')}
      ${f('year', 'Год', 'type="number" required')}
      <label class="field" data-field="format"><span>Формат</span><select name="format">${opt('format', ['LP', '2LP', 'EP', '7"'], r?.format || 'LP')}</select><span class="err"></span></label>
      <label class="field" data-field="condition"><span>Состояние</span><select name="condition">${opt('condition', ['M', 'NM', 'VG+', 'VG'], r?.condition || 'NM')}</select><span class="err"></span></label>
      ${f('price', 'Цена, ₽', 'type="number" min="1" required')}
      ${f('stock', 'На складе, шт.', 'type="number" min="0" required')}
      <label class="field" data-field="color"><span>Цвет обложки</span><input type="color" name="color" value="${r?.color || '#23395b'}"><span class="err"></span></label>
      <label class="field full" data-field="description"><span>Описание</span><textarea name="description" maxlength="500">${v('description')}</textarea><span class="err"></span></label>
      <datalist id="genreList">${['Рок', 'Русский рок', 'Джаз', 'Электроника', 'Трип-хоп', 'Поп'].map(g => `<option value="${g}">`).join('')}</datalist>
      <div class="actions">
        <button type="button" class="btn btn-ghost" value="cancel">Отмена</button>
        <button class="btn btn-dark">${r ? 'Сохранить изменения' : 'Добавить в каталог'}</button>
      </div>
    </form>`;

  const form = dlg.querySelector('form');
  form.querySelector('[value="cancel"]').onclick = () => dlg.close();
  form.onsubmit = async e => {
    e.preventDefault();
    form.querySelectorAll('.field').forEach(x => { x.classList.remove('invalid'); x.querySelector('.err').textContent = ''; });
    const body = Object.fromEntries(new FormData(form));
    try {
      await adminApi(r ? `/admin/records/${r.id}` : '/admin/records', { method: r ? 'PUT' : 'POST', body });
      dlg.close();
      toast(r ? 'Изменения сохранены' : 'Пластинка добавлена в каталог');
      renderRecords();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        for (const [name, msg] of Object.entries(err.fields)) {
          const box = form.querySelector(`[data-field="${name}"]`);
          if (box) { box.classList.add('invalid'); box.querySelector('.err').textContent = msg; }
        }
      } else {
        const box = form.querySelector('.form-error');
        box.textContent = err.message;
        box.hidden = false;
      }
    }
  };
  dlg.showModal();
}

// ---------- Журнал ----------

async function renderLogs() {
  const draw = async () => {
    const logs = await adminApi('/admin/logs');
    const list = $('#logList');
    if (!list) return;
    list.innerHTML = logs.map(l => `
      <div class="log-row">
        <span class="log-time">${new Date(l.time).toLocaleTimeString('ru-RU')}</span>
        <span class="m m-${l.method.toLowerCase()}">${l.method}</span>
        <span>${esc(l.path)}</span>
        <span class="s s-${l.status >= 400 ? 'err' : 'ok'}">${l.status}</span>
        <span class="t">${l.ms} мс</span>
      </div>`).join('');
  };
  main.innerHTML = `
    <div class="page-head">
      <h1>Журнал сервера</h1>
      <p class="muted">Последние 200 запросов к API. Обновляется каждые 3 секунды.</p>
    </div>
    <div class="log" id="logList"></div>`;
  await draw();
  renderLogs.timer = setInterval(() => draw().catch(() => clearInterval(renderLogs.timer)), 3000);
}

// ---------- Старт ----------

auth.token ? showApp() : showLogin();
