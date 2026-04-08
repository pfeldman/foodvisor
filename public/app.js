/* ===================================================
   FOODVISOR — App Logic
   Data: localStorage (persists on device)
   Server: only proxies OpenAI API calls
   =================================================== */

// ─── State ────────────────────────────────────────
const state = {
  view: 'today',
  weekOffset: 0,
  selectedDay: null,
  pendingResult: null,
  pendingImageDataUrl: null,
};

// ─── Utils ────────────────────────────────────────
const $ = id => document.getElementById(id);

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Always use T12:00:00 when constructing date from YYYY-MM-DD string to avoid timezone shifts
function localDate(isoDate) {
  return new Date(isoDate + 'T12:00:00');
}

const fmt = {
  iso(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  time(isoString) {
    // isoString from created_at: "2025-03-10T14:30:00.000Z" or local
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch { return isoString.slice(11, 16); }
  },

  longDate(d) {
    return capitalize(d.toLocaleDateString('es-AR', {
      weekday: 'long', day: 'numeric', month: 'long'
    }));
  },

  shortDate(d) {
    return capitalize(d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' }));
  },

  fullDate(d) {
    return capitalize(d.toLocaleDateString('es-AR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }));
  },

  dayName(d) {
    return d.toLocaleDateString('es-AR', { weekday: 'short' }).slice(0, 3);
  },

  number(n) {
    return n.toLocaleString('es-AR');
  },
};

// ─── LocalStorage Data Layer ──────────────────────
const DB = {
  KEY: 'foodvisor_entries',

  load() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY) || '[]');
    } catch { return []; }
  },

  save(entries) {
    localStorage.setItem(this.KEY, JSON.stringify(entries));
  },

  all() {
    return this.load();
  },

  byDate(dateIso) {
    return this.load().filter(e => e.date === dateIso);
  },

  byRange(fromIso, toIso) {
    return this.load().filter(e => e.date >= fromIso && e.date <= toIso);
  },

  add(entry) {
    const entries = this.load();
    entries.push(entry);
    this.save(entries);
    return entry;
  },

  remove(id) {
    const entries = this.load().filter(e => e.id !== id);
    this.save(entries);
  },
};

// ─── Init ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  state.selectedDay = fmt.iso(new Date());
  updateHeaderDate();
  renderView('today');
  setupNav();
  setupCamera();
  setupResultModal();
  setupExportModal();
  registerSW();
});

function updateHeaderDate() {
  const now = new Date();
  const parts = now.toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long'
  }).split(', ');
  $('header-date').textContent = capitalize(now.toLocaleDateString('es-AR', {
    day: 'numeric', month: 'short', year: 'numeric'
  }));
}

function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderView(btn.dataset.view);
    });
  });
}

// ─── Routing ──────────────────────────────────────
function renderView(view) {
  state.view = view;
  const main = $('main');
  if (view === 'today')   renderToday(main);
  else if (view === 'week')    renderWeek(main);
  else if (view === 'history') renderHistory(main);
}

// ─── TODAY VIEW ───────────────────────────────────
function renderToday(container) {
  const todayIso = fmt.iso(new Date());
  const entries  = DB.byDate(todayIso).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const totalCal = entries.reduce((s, e) => s + e.calories, 0);
  const meals    = entries.length;

  container.innerHTML = `
    <div class="today-view">
      <div class="capture-hero">
        <button class="capture-btn" id="capture-btn">
          <div class="capture-glow"></div>
          <div class="capture-grain"></div>
          <div class="capture-inner">
            <div class="capture-ring">
              <div class="pulse-outer"></div>
              <div class="pulse-inner"></div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </div>
            <span class="capture-title">Fotografiá tu comida</span>
            <span class="capture-sub">La IA identifica el plato y las calorías</span>
          </div>
        </button>
      </div>

      <div class="day-summary">
        <div class="summary-card">
          <div class="summary-num">${fmt.number(totalCal)}</div>
          <div class="summary-lbl">kcal hoy</div>
        </div>
        <div class="summary-card">
          <div class="summary-num neutral">${meals}</div>
          <div class="summary-lbl">${meals === 1 ? 'comida' : 'comidas'}</div>
        </div>
      </div>

      <div class="entries-wrap">
        ${entries.length > 0 ? `
          <div class="section-label">Registro de hoy</div>
          ${entries.map(renderEntryCard).join('')}
        ` : `
          <div class="empty-state">
            <span class="empty-icon">🍽</span>
            <div class="empty-title">Sin registros todavía</div>
            <div class="empty-sub">Fotografiá tu primera comida del día</div>
          </div>
        `}
      </div>
    </div>
  `;

  $('capture-btn').addEventListener('click', () => {
    $('camera-input').click();
  });

  bindDeleteButtons(container, () => renderView('today'));
}

// ─── WEEK VIEW ────────────────────────────────────
function renderWeek(container) {
  const today = new Date();
  const todayIso = fmt.iso(today);

  // Compute Monday of selected week
  const base = new Date(today);
  const dow  = today.getDay() === 0 ? 6 : today.getDay() - 1; // Mon=0
  base.setDate(today.getDate() - dow + state.weekOffset * 7);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return d;
  });

  const fromIso = fmt.iso(days[0]);
  const toIso   = fmt.iso(days[6]);

  const allEntries = DB.byRange(fromIso, toIso);

  // Group by date
  const byDate = {};
  allEntries.forEach(e => {
    (byDate[e.date] = byDate[e.date] || []).push(e);
  });

  // Auto-select today if in this week, else first day
  if (!state.selectedDay || state.selectedDay < fromIso || state.selectedDay > toIso) {
    state.selectedDay = todayIso >= fromIso && todayIso <= toIso ? todayIso : fromIso;
  }

  const weekTotal = allEntries.reduce((s, e) => s + e.calories, 0);
  const weekMeals = allEntries.length;

  const selectedEntries = (byDate[state.selectedDay] || [])
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const selectedTotal = selectedEntries.reduce((s, e) => s + e.calories, 0);

  const rangeLabel = `${fmt.shortDate(days[0])} – ${fmt.shortDate(days[6])}`;

  const selectedDateObj = localDate(state.selectedDay);

  container.innerHTML = `
    <div class="week-view">
      <div class="week-nav-bar">
        <button class="week-nav-btn" id="btn-week-prev">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div class="week-title">${rangeLabel}</div>
        <button class="week-nav-btn" id="btn-week-next" ${state.weekOffset >= 0 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>

      <div class="day-pills" id="day-pills">
        ${days.map(d => {
          const iso   = fmt.iso(d);
          const total = (byDate[iso] || []).reduce((s, e) => s + e.calories, 0);
          const isSelected = iso === state.selectedDay;
          const isToday    = iso === todayIso;
          return `
            <div class="day-pill ${isSelected ? 'active' : ''} ${isToday && !isSelected ? 'is-today' : ''}"
                 data-day="${iso}">
              <span class="day-pill-name">${capitalize(fmt.dayName(d))}</span>
              <span class="day-num">${d.getDate()}</span>
              <span class="day-kcal">${total > 0 ? fmt.number(total) : '—'}</span>
            </div>
          `;
        }).join('')}
      </div>

      <div class="week-summary-bar">
        <div class="summary-card">
          <div class="summary-num">${fmt.number(weekTotal)}</div>
          <div class="summary-lbl">kcal semana</div>
        </div>
        <div class="summary-card">
          <div class="summary-num neutral">${weekMeals}</div>
          <div class="summary-lbl">${weekMeals === 1 ? 'comida' : 'comidas'}</div>
        </div>
      </div>

      <div class="week-day-heading">
        <div class="week-day-title">${fmt.longDate(selectedDateObj)}</div>
        ${selectedTotal > 0 ? `<div class="week-day-kcal">${fmt.number(selectedTotal)} kcal</div>` : ''}
      </div>

      <div class="week-entries">
        ${selectedEntries.length > 0
          ? selectedEntries.map(renderEntryCard).join('')
          : `<div class="no-entries">Sin registros este día</div>`
        }
      </div>
    </div>
  `;

  // Day pill click
  container.querySelectorAll('.day-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      state.selectedDay = pill.dataset.day;
      renderView('week');
    });
  });

  // Scroll today pill into view
  const todayPill = container.querySelector('.day-pill.active, .day-pill.is-today');
  if (todayPill) {
    todayPill.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  $('btn-week-prev').addEventListener('click', () => {
    state.weekOffset -= 1;
    state.selectedDay = null;
    renderView('week');
  });

  const nextBtn = $('btn-week-next');
  if (nextBtn && !nextBtn.disabled) {
    nextBtn.addEventListener('click', () => {
      state.weekOffset += 1;
      state.selectedDay = null;
      renderView('week');
    });
  }

  bindDeleteButtons(container, () => renderView('week'));
}

// ─── HISTORY VIEW ─────────────────────────────────
function renderHistory(container) {
  const today   = fmt.iso(new Date());
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoIso = fmt.iso(weekAgo);

  container.innerHTML = `
    <div class="history-view">
      <div class="filter-section">
        <div class="filter-title">Buscar por período</div>
        <div class="filter-row">
          <div class="filter-group">
            <div class="filter-label">Desde</div>
            <input type="date" id="filter-from" class="date-input"
              value="${weekAgoIso}" max="${today}">
          </div>
          <div class="filter-group">
            <div class="filter-label">Hasta</div>
            <input type="date" id="filter-to" class="date-input"
              value="${today}" max="${today}">
          </div>
          <button class="btn-search" id="btn-search-hist">Buscar</button>
        </div>
      </div>
      <div id="history-results"></div>
    </div>
  `;

  $('btn-search-hist').addEventListener('click', runHistorySearch);
  // Auto-run on load
  runHistorySearch();
}

function runHistorySearch() {
  const from = $('filter-from')?.value;
  const to   = $('filter-to')?.value;
  if (!from || !to) return;

  const entries = DB.byRange(from, to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));

  const results = $('history-results');
  if (!results) return;

  if (entries.length === 0) {
    results.innerHTML = `<div class="no-entries">Sin registros en este período</div>`;
    return;
  }

  // Group by date
  const byDate = {};
  entries.forEach(e => {
    (byDate[e.date] = byDate[e.date] || []).push(e);
  });

  const totalCal = entries.reduce((s, e) => s + e.calories, 0);
  const dayCount = Object.keys(byDate).length;
  const avgCal   = dayCount > 0 ? Math.round(totalCal / dayCount) : 0;

  let html = `
    <div class="history-totals">
      <div class="summary-card">
        <div class="summary-num">${fmt.number(totalCal)}</div>
        <div class="summary-lbl">kcal total</div>
      </div>
      <div class="summary-card">
        <div class="summary-num neutral">${fmt.number(avgCal)}</div>
        <div class="summary-lbl">kcal/día prom.</div>
      </div>
    </div>
  `;

  Object.keys(byDate).sort().reverse().forEach(dateIso => {
    const dayEntries = byDate[dateIso];
    const dayTotal   = dayEntries.reduce((s, e) => s + e.calories, 0);
    const dateObj    = localDate(dateIso);

    html += `
      <div class="history-day-group">
        <div class="history-day-header">
          <span class="history-day-name">${fmt.longDate(dateObj)}</span>
          <span class="history-day-total">${fmt.number(dayTotal)} kcal</span>
        </div>
        ${dayEntries.map(renderEntryCard).join('')}
      </div>
    `;
  });

  html += `
    <button class="export-btn" id="btn-export-hist">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
        <polyline points="16 6 12 2 8 6"/>
        <line x1="12" y1="2" x2="12" y2="15"/>
      </svg>
      Exportar para nutricionista
    </button>
  `;

  results.innerHTML = html;

  bindDeleteButtons(results, runHistorySearch);

  $('btn-export-hist')?.addEventListener('click', () => {
    const from = $('filter-from')?.value;
    const to   = $('filter-to')?.value;
    showExport(byDate, from, to, totalCal, avgCal);
  });
}

// ─── Entry Card ───────────────────────────────────
function renderEntryCard(entry) {
  const time = fmt.time(entry.created_at);
  return `
    <div class="entry-card">
      <span class="entry-time">${escHtml(time)}</span>
      <div class="entry-info">
        <div class="entry-name">${escHtml(entry.dish_name)}</div>
        ${entry.description ? `<div class="entry-desc">${escHtml(entry.description)}</div>` : ''}
      </div>
      <span class="entry-kcal">${fmt.number(entry.calories)} kcal</span>
      <button class="entry-del" data-del="${escHtml(entry.id)}" title="Eliminar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </div>
  `;
}

function bindDeleteButtons(container, onDelete) {
  container.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('¿Eliminás este registro?')) return;
      DB.remove(btn.dataset.del);
      vibrate([8]);
      onDelete();
    });
  });
}

// ─── Camera & Analysis ────────────────────────────
function setupCamera() {
  const input = $('camera-input');
  input.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    input.value = '';

    try {
      const resized = await resizeImage(file, 1024);
      state.pendingImageDataUrl = resized;
      await analyzeFood(resized);
    } catch (err) {
      alert('No se pudo leer la imagen. Intentá de nuevo.');
      console.error(err);
    }
  });
}

function resizeImage(file, maxDim = 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > height) {
        if (width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
      } else {
        if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function analyzeFood(imageDataUrl) {
  showOverlay(true);
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageDataUrl }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Error desconocido' }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    const data = await res.json();
    showResultModal(data, imageDataUrl);
  } catch (err) {
    console.error('analyzeFood error:', err);
    alert(`No se pudo analizar la imagen.\n${err.message}`);
  } finally {
    showOverlay(false);
  }
}

function showOverlay(show) {
  $('analyze-overlay').classList.toggle('hidden', !show);
}

// ─── Result Modal ─────────────────────────────────
function showResultModal(data, imageDataUrl) {
  const { plato = '', calorias = 0, descripcion = '', confianza = 'baja' } = data;

  // Photo preview (small)
  const photoWrap = $('result-photo-wrap');
  if (imageDataUrl) {
    photoWrap.innerHTML = `<img src="${imageDataUrl}" alt="Foto capturada">`;
    photoWrap.classList.remove('hidden');
  } else {
    photoWrap.innerHTML = '';
  }

  $('result-cal-num').textContent = calorias;
  $('result-dish-input').value    = capitalize(plato);
  $('result-cal-input').value     = calorias;
  $('result-desc').textContent    = descripcion;

  const confEl = $('result-confidence');
  const confLabels = { alta: 'Confianza alta', media: 'Confianza media', baja: 'Confianza baja' };
  confEl.textContent  = confLabels[confianza] || 'Confianza baja';
  confEl.className    = `confidence-pill ${confianza}`;

  state.pendingResult = { plato, calorias, descripcion, confianza };
  $('result-modal').classList.remove('hidden');

  // Focus the dish input for quick editing
  setTimeout(() => $('result-dish-input')?.focus(), 400);
}

function setupResultModal() {
  // Sync calories display as user edits the input
  $('result-cal-input').addEventListener('input', e => {
    const val = parseInt(e.target.value) || 0;
    $('result-cal-num').textContent = val;
  });

  // +/- buttons
  $('cal-plus').addEventListener('click', () => {
    const cur = parseInt($('result-cal-input').value) || 0;
    const next = Math.min(cur + 50, 9999);
    $('result-cal-input').value = next;
    $('result-cal-num').textContent = next;
  });

  $('cal-minus').addEventListener('click', () => {
    const cur = parseInt($('result-cal-input').value) || 0;
    const next = Math.max(cur - 50, 0);
    $('result-cal-input').value = next;
    $('result-cal-num').textContent = next;
  });

  $('btn-discard').addEventListener('click', closeResultModal);
  $('result-backdrop').addEventListener('click', closeResultModal);
  $('btn-save').addEventListener('click', saveEntry);
}

function closeResultModal() {
  $('result-modal').classList.add('hidden');
  state.pendingResult = null;
  state.pendingImageDataUrl = null;
}

function saveEntry() {
  const dish     = $('result-dish-input').value.trim();
  const calories = parseInt($('result-cal-input').value) || 0;
  const desc     = state.pendingResult?.descripcion || '';

  if (!dish) {
    $('result-dish-input').focus();
    return;
  }

  const now = new Date();
  DB.add({
    id:          genId(),
    created_at:  now.toISOString(),
    date:        fmt.iso(now),
    dish_name:   dish,
    calories,
    description: desc,
  });

  vibrate([10, 30, 10]);
  closeResultModal();
  renderView(state.view);
}

// ─── Export Modal ─────────────────────────────────
function showExport(byDate, from, to, totalCal, avgCal) {
  const fromObj = localDate(from);
  const toObj   = localDate(to);

  let text = `REGISTRO ALIMENTARIO — FOODVISOR\n`;
  text += `Período: ${fmt.fullDate(fromObj)} al ${fmt.fullDate(toObj)}\n`;
  text += `Total: ${fmt.number(totalCal)} kcal | Promedio diario: ${fmt.number(avgCal)} kcal\n`;
  text += `${'─'.repeat(45)}\n`;

  Object.keys(byDate).sort().forEach(dateIso => {
    const dayEntries = byDate[dateIso];
    const dayTotal   = dayEntries.reduce((s, e) => s + e.calories, 0);
    const dateObj    = localDate(dateIso);

    text += `\n${fmt.longDate(dateObj)} (${fmt.number(dayTotal)} kcal)\n`;
    dayEntries
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .forEach(e => {
        text += `  ${fmt.time(e.created_at)}  ${e.dish_name}: ${e.calories} kcal\n`;
      });
  });

  text += `\n${'─'.repeat(45)}\n`;
  text += `Generado con Foodvisor\n`;

  $('export-preview').textContent = text;
  $('export-modal').classList.remove('hidden');
}

function setupExportModal() {
  $('btn-close-export').addEventListener('click', () => {
    $('export-modal').classList.add('hidden');
  });

  $('export-backdrop').addEventListener('click', () => {
    $('export-modal').classList.add('hidden');
  });

  $('btn-copy-export').addEventListener('click', async () => {
    const text = $('export-preview').textContent;
    try {
      await navigator.clipboard.writeText(text);
      const btn = $('btn-copy-export');
      const orig = btn.innerHTML;
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        ¡Copiado!
      `;
      setTimeout(() => { btn.innerHTML = orig; }, 2200);
      vibrate([10, 20, 10]);
    } catch {
      // Fallback: select the text
      const el = $('export-preview');
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });
}

// ─── Helpers ──────────────────────────────────────
function escHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str)));
  return d.innerHTML;
}

function vibrate(pattern) {
  if ('vibrate' in navigator) {
    try { navigator.vibrate(pattern); } catch {}
  }
}

// ─── Service Worker ───────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('SW registration failed:', err);
    });
  }
}
