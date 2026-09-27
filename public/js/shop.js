import { api, ApiError, escapeHtml as esc, inkFor, mountApiConsole, rub } from './api.js';

mountApiConsole();

const $ = s => document.querySelector(s);
const state = { genre: '', records: [], cart: loadCart() };

// ---------- Общие куски разметки ----------

export function coverHtml(r) {
  return `
    <div class="cover cover-p${r.id % 4}" style="--c:${r.color};--fg:${inkFor(r.color)}">
      <span class="cover-artist">${esc(r.artist)}</span>
      <span class="cover-title">${esc(r.title)}</span>
    </div>`;
}

const stickerHtml = r => r.stock > 0
  ? `<span class="sticker" aria-hidden="true">${r.price.toLocaleString('ru-RU')}<small>рублей</small></span>`
  : `<span class="sticker" aria-hidden="true">Нет<small>в наличии</small></span>`;

function stockText(r) {
  if (r.stock === 0) return '<p class="item-stock low">Нет в наличии</p>';
  if (r.stock <= 2) return `<p class="item-stock low">Осталось ${r.stock} шт.</p>`;
  return `<p class="item-stock">В наличии</p>`;
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- Каталог ----------

async function loadGenres() {
  const genres = await api('/genres');
  const total = genres.reduce((s, g) => s + g.count, 0);
  $('#genres').innerHTML = [{ name: '', label: 'Все', count: total }, ...genres]
    .map(g => `<button type="button" class="chip" data-genre="${esc(g.name)}"
      aria-pressed="${g.name === state.genre}">${esc(g.label || g.name)}<sup>${g.count}</sup></button>`)
    .join('');
}

$('#genres').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.genre = chip.dataset.genre;
  document.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
  loadRecords();
});

let searchTimer;
$('#filters').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadRecords, e.target.name === 'q' ? 300 : 0);
});
$('#filters').addEventListener('submit', e => e.preventDefault());

async function loadRecords() {
  const form = new FormData($('#filters'));
  const params = new URLSearchParams();
  if (state.genre) params.set('genre', state.genre);
  if (form.get('q')) params.set('q', form.get('q'));
  if (form.get('sort')) params.set('sort', form.get('sort'));
  if (form.get('in_stock')) params.set('in_stock', '1');

  try {
    const { items, count } = await api(`/records?${params}`);
    state.records = items;
    $('#resultCount').textContent = `${count} ${plural(count, 'пластинка', 'пластинки', 'пластинок')}`;
    renderGrid();
  } catch (err) {
    $('#grid').innerHTML = `<li class="grid-empty"><p>${esc(err.message)}</p></li>`;
  }
}

function renderGrid() {
  const grid = $('#grid');
  if (!state.records.length) {
    grid.innerHTML = `<li class="grid-empty">
      <p>По этому запросу ничего нет. Попробуйте другой жанр или сбросьте поиск.</p>
      <button class="btn btn-ghost" id="resetFilters">Сбросить фильтры</button></li>`;
    $('#resetFilters').onclick = () => {
      $('#filters').reset();
      state.genre = '';
      loadGenres();
      loadRecords();
    };
    return;
  }
  grid.innerHTML = state.records.map(r => `
    <li class="item ${r.stock ? '' : 'sold-out'}">
      <button class="item-open" data-id="${r.id}" aria-label="${esc(r.artist)} — ${esc(r.title)}, ${rub(r.price)}">
        <div class="sleeve">
          <div class="vinyl" style="--label:${r.color}"><div class="vinyl-label"></div></div>
          ${coverHtml(r)}
        </div>
      </button>
      ${stickerHtml(r)}
      <div class="item-meta">
        <h3>${esc(r.title)}</h3>
        <p>${esc(r.artist)}, ${r.year}</p>
        ${stockText(r)}
      </div>
    </li>`).join('');
}

function renderSkeleton() {
  $('#grid').innerHTML = Array.from({ length: 8 }, () =>
    '<li class="item skeleton"><div class="sleeve"><div class="cover"></div></div></li>').join('');
}

$('#grid').addEventListener('click', e => {
  const btn = e.target.closest('.item-open');
  if (btn) openRecord(Number(btn.dataset.id));
});

// ---------- Карточка пластинки ----------

const conditions = { M: 'Новая, запечатана', NM: 'Почти идеальное', 'VG+': 'Очень хорошее, лёгкие потёртости', VG: 'Хорошее, слышны щелчки' };

async function openRecord(id) {
  const modal = $('#recordModal');
  try {
    const r = await api(`/records/${id}`); // свежие остатки прямо из базы
    modal.innerHTML = `
      <button class="icon-btn modal-close" data-close aria-label="Закрыть">✕</button>
      <div class="modal-body">
        ${coverHtml(r)}
        <div>
          <h2 id="recordModalTitle">${esc(r.title)}</h2>
          <p class="modal-artist">${esc(r.artist)}</p>
          <dl class="facts">
            <dt>Год</dt><dd>${r.year}</dd>
            <dt>Жанр</dt><dd>${esc(r.genre)}</dd>
            <dt>Формат</dt><dd>${esc(r.format)}</dd>
            <dt>Состояние</dt><dd>${esc(r.condition)} — ${conditions[r.condition] || ''}</dd>
            <dt>На складе</dt><dd>${r.stock ? `${r.stock} шт.` : 'Закончилась'}</dd>
          </dl>
          <p class="modal-desc">${esc(r.description)}</p>
          <div class="modal-buy">
            <span class="modal-price">${rub(r.price)}</span>
            <button class="btn btn-sticker" data-add="${r.id}" ${r.stock ? '' : 'disabled'}>
              ${r.stock ? 'Добавить в корзину' : 'Нет в наличии'}</button>
          </div>
        </div>
      </div>`;
    modal.showModal();
  } catch (err) {
    toast(err.message);
  }
}

document.addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  if (add) {
    const id = Number(add.dataset.add);
    const r = state.records.find(x => x.id === id) || state.hero;
    if (r) addToCart(r);
    add.closest('dialog')?.close();
  }
  if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
});

// Клик по затемнению закрывает диалог
document.querySelectorAll('dialog').forEach(d =>
  d.addEventListener('click', e => { if (e.target === d) d.close(); }));

// ---------- Hero ----------

async function loadHero() {
  const { items } = await api('/records?in_stock=1&sort=price_desc');
  if (!items.length) return;
  const r = items[Math.floor(Math.random() * Math.min(items.length, 6))];
  state.hero = r;
  const vinyl = $('#heroVinyl');
  vinyl.style.setProperty('--label', r.color);
  vinyl.querySelector('span').textContent = r.artist;
  vinyl.querySelector('span').style.color = inkFor(r.color);
  $('#heroPick').innerHTML = `
    <p class="hero-pick-label">Сейчас на проигрывателе</p>
    <p class="hero-pick-title">${esc(r.title)}<small>${esc(r.artist)}, ${r.year}, ${rub(r.price)}</small></p>
    <button class="btn btn-sticker btn-sm" data-add="${r.id}">В корзину</button>`;
}

// ---------- Корзина ----------

function loadCart() {
  try { return JSON.parse(localStorage.getItem('cart')) || []; } catch { return []; }
}
function saveCart() {
  localStorage.setItem('cart', JSON.stringify(state.cart));
  const n = state.cart.reduce((s, l) => s + l.qty, 0);
  const badge = $('#cartCount');
  badge.textContent = n;
  badge.classList.remove('bump');
  void badge.offsetWidth;
  badge.classList.add('bump');
}

function addToCart(r) {
  const line = state.cart.find(l => l.id === r.id);
  if (line) {
    if (line.qty >= r.stock) return toast(`Больше «${r.title}» на складе нет`);
    line.qty++;
  } else {
    const { id, title, artist, price, color, stock } = r;
    state.cart.push({ id, title, artist, price, color, stock, qty: 1 });
  }
  saveCart();
  toast(`«${r.title}» в корзине`);
}

$('#cartOpen').addEventListener('click', () => {
  renderCart();
  $('#cartDrawer').showModal();
});

function renderCart() {
  const body = $('#cartBody');
  if (!state.cart.length) {
    body.innerHTML = `<div class="cart-empty">
      <p>В корзине пока пусто. Выберите пластинку в каталоге.</p>
      <a class="btn btn-dark" href="#catalog" data-close>Перейти в каталог</a></div>`;
    return;
  }
  const total = state.cart.reduce((s, l) => s + l.price * l.qty, 0);
  body.innerHTML = `
    <ul class="cart-lines">
      ${state.cart.map(l => `
        <li class="cart-line">
          ${coverHtml(l)}
          <div>
            <h3>${esc(l.title)}</h3>
            <p>${esc(l.artist)}</p>
            <div class="qty">
              <button data-qty="${l.id}" data-d="-1" aria-label="Убрать одну">−</button>
              <span>${l.qty}</span>
              <button data-qty="${l.id}" data-d="1" aria-label="Добавить ещё одну">+</button>
            </div>
          </div>
          <span class="line-price">${rub(l.price * l.qty)}</span>
        </li>`).join('')}
    </ul>
    <p class="cart-total"><span>Итого</span><strong>${rub(total)}</strong></p>
    <form class="checkout" id="checkout" novalidate>
      <h3>Доставка</h3>
      <div class="form-error" id="checkoutError" hidden></div>
      ${field('name', 'Имя и фамилия', 'text', 'name')}
      ${field('phone', 'Телефон', 'tel', 'tel', '+7 900 123-45-67')}
      ${field('email', 'Email для номера заказа', 'email', 'email')}
      ${field('address', 'Адрес доставки', 'text', 'street-address', 'Город, улица, дом, квартира')}
      <button class="btn btn-sticker" id="checkoutBtn">Оформить заказ на ${rub(total)}</button>
    </form>`;
}

const field = (name, label, type, autocomplete, placeholder = '') => `
  <label class="field" data-field="${name}">
    <span>${label}</span>
    <input name="${name}" type="${type}" autocomplete="${autocomplete}" placeholder="${placeholder}" required>
    <span class="err"></span>
  </label>`;

$('#cartBody').addEventListener('click', e => {
  const btn = e.target.closest('[data-qty]');
  if (!btn) return;
  const line = state.cart.find(l => l.id === Number(btn.dataset.qty));
  const next = line.qty + Number(btn.dataset.d);
  if (next > line.stock) return toast('Больше на складе нет');
  if (next <= 0) state.cart = state.cart.filter(l => l !== line);
  else line.qty = next;
  // сохраняем введённые данные при перерисовке
  const draft = $('#checkout') && Object.fromEntries(new FormData($('#checkout')));
  saveCart();
  renderCart();
  if (draft && $('#checkout')) for (const [k, v] of Object.entries(draft)) $('#checkout').elements[k].value = v;
});

$('#cartBody').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const btn = $('#checkoutBtn');
  const errorBox = $('#checkoutError');
  form.querySelectorAll('.field').forEach(f => { f.classList.remove('invalid'); f.querySelector('.err').textContent = ''; });
  errorBox.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Отправляем заказ…';

  try {
    const order = await api('/orders', {
      method: 'POST',
      body: {
        customer: Object.fromEntries(new FormData(form)),
        items: state.cart.map(({ id, qty }) => ({ id, qty })),
      },
    });
    state.cart = [];
    saveCart();
    $('#cartBody').innerHTML = `
      <div class="success">
        <div class="vinyl" style="--label:var(--sticker)"><div class="vinyl-label"></div></div>
        <h3>Заказ оформлен</h3>
        <p>Сохраните номер — по нему можно проверить статус.</p>
        <span class="success-code">${esc(order.code)}</span>
        <p>Сумма: <strong>${rub(order.total)}</strong></p>
        <p style="margin-top:20px"><a class="btn btn-dark" href="#track" data-close data-track="${esc(order.code)}">Отследить заказ</a></p>
      </div>`;
    loadRecords();
    loadGenres();
  } catch (err) {
    if (err instanceof ApiError && Object.keys(err.fields).length) {
      for (const [name, msg] of Object.entries(err.fields)) {
        const f = form.querySelector(`[data-field="${name}"]`);
        if (f) { f.classList.add('invalid'); f.querySelector('.err').textContent = msg; }
      }
      form.querySelector('.invalid input')?.focus();
    } else {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      if (err.status === 409) loadRecords(); // остатки изменились — обновим витрину
    }
    btn.disabled = false;
    btn.textContent = 'Оформить заказ ещё раз';
  }
});

// ---------- Отслеживание ----------

const STEPS = [['new', 'Принят'], ['packed', 'Упакован'], ['shipped', 'В пути'], ['delivered', 'Доставлен']];

async function trackOrder(code) {
  const out = $('#trackResult');
  try {
    const o = await api(`/orders/${encodeURIComponent(code)}`);
    const idx = STEPS.findIndex(([s]) => s === o.status);
    const date = new Date(o.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    out.innerHTML = `
      <div class="track-summary"><strong>${esc(o.code)}</strong><span>от ${date}, ${rub(o.total)}</span></div>
      ${o.status === 'cancelled'
        ? '<p class="track-cancelled">Заказ отменён. Пластинки вернулись на склад.</p>'
        : `<ol class="steps">${STEPS.map(([, label], i) =>
            `<li class="${i <= idx ? 'done' : ''} ${i === idx ? 'current' : ''}">${label}</li>`).join('')}</ol>`}
      <ul class="track-items">${o.items.map(i => `<li>${esc(i.artist)} — ${esc(i.title)}, ${i.qty} шт.</li>`).join('')}</ul>`;
  } catch (err) {
    out.innerHTML = `<p class="track-error">${esc(err.message)}</p>`;
  }
}

$('#trackForm').addEventListener('submit', e => {
  e.preventDefault();
  trackOrder(e.target.code.value.trim());
});

document.addEventListener('click', e => {
  const link = e.target.closest('[data-track]');
  if (!link) return;
  $('#trackForm').code.value = link.dataset.track;
  trackOrder(link.dataset.track);
});

// ---------- Утилиты ----------

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// ---------- Старт ----------

$('#cartCount').textContent = state.cart.reduce((s, l) => s + l.qty, 0);
renderSkeleton();
Promise.all([loadGenres(), loadRecords(), loadHero()]).catch(err => toast(err.message));
