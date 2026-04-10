/* ===================================================
   FOODVISOR — App Logic v2
   New: Wizard, ingredients, macros, quality scores,
        bookmarkable metrics, Coach Nuri, recommendations
   =================================================== */

// ─── State ────────────────────────────────────────
const state = {
  view: 'today',
  weekOffset: 0,
  selectedDay: null,
  pendingResult: null,
  pendingImageDataUrl: null,
  nuriMessages: [],       // chat history for current session
  nuriLoading: false,
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

// ─── Profile / Settings Storage ──────────────────
const Profile = {
  KEY: 'foodvisor_profile',

  load() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { return null; }
  },

  save(data) {
    localStorage.setItem(this.KEY, JSON.stringify(data));
  },

  exists() {
    return this.load() !== null;
  },

  getMetrics() {
    const p = this.load();
    return p?.metrics || ['calorias', 'proteinas'];
  },

  getTDEE() {
    const p = this.load();
    if (!p) return null;
    // Mifflin-St Jeor
    let tmb;
    if (p.sexo === 'M') {
      tmb = 10 * p.peso + 6.25 * p.altura - 5 * p.edad + 5;
    } else {
      tmb = 10 * p.peso + 6.25 * p.altura - 5 * p.edad - 161;
    }
    const factors = { sedentario: 1.2, ligero: 1.375, moderado: 1.55, activo: 1.725, muy_activo: 1.9 };
    return Math.round(tmb * (factors[p.actividad] || 1.4));
  },
};

// ─── LocalStorage Data Layer ──────────────────────
const DB = {
  KEY: 'foodvisor_entries',

  load() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch { return []; }
  },

  save(entries) {
    localStorage.setItem(this.KEY, JSON.stringify(entries));
  },

  all() { return this.load(); },

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
  renderView('today');
  setupNav();
  setupCamera();
  setupResultModal();
  setupExportModal();
  setupSettings();
  registerSW();

  // Show wizard if no profile
  if (!Profile.exists()) {
    setTimeout(() => showWizard(), 400);
  }

  // Try to init health on startup (non-blocking)
  initHealth();
});

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
  if (view === 'today')        renderToday(main);
  else if (view === 'week')    renderWeek(main);
  else if (view === 'nuri')    renderNuri(main);
  else if (view === 'history') renderHistory(main);
}

// ─── TODAY VIEW ───────────────────────────────────
function renderToday(container) {
  const todayIso = fmt.iso(new Date());
  const entries  = DB.byDate(todayIso).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const totalCal = entries.reduce((s, e) => s + (e.totales?.calorias || e.calories || 0), 0);
  const meals    = entries.length;

  // Aggregate macros for bookmarked metrics
  const metrics = Profile.getMetrics();
  const tdee = Profile.getTDEE();
  const totals = aggregateMacros(entries);

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
            <span class="capture-title">Fotografia tu comida</span>
            <span class="capture-sub">La IA identifica ingredientes y nutrientes</span>
          </div>
        </button>
      </div>

      <div class="metrics-grid" id="metrics-grid">
        ${renderMetricCards(totals, metrics, tdee, meals)}
      </div>

      ${renderGoalsSection(totals)}

      <div class="entries-wrap">
        ${entries.length > 0 ? `
          <div class="section-label">Registro de hoy</div>
          ${entries.map(renderEntryCard).join('')}
        ` : `
          <div class="empty-state">
            <span class="empty-icon">&#127869;</span>
            <div class="empty-title">Sin registros todavia</div>
            <div class="empty-sub">Fotografia tu primera comida del dia</div>
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

function aggregateMacros(entries) {
  const t = { calorias: 0, proteinas: 0, carbohidratos: 0, grasas: 0, fibra: 0 };
  entries.forEach(e => {
    const src = e.totales || {};
    t.calorias += src.calorias || e.calories || 0;
    t.proteinas += src.proteinas || 0;
    t.carbohidratos += src.carbohidratos || 0;
    t.grasas += src.grasas || 0;
    t.fibra += src.fibra || 0;
  });
  return t;
}

const METRIC_META = {
  calorias:       { label: 'Calorias',  unit: 'kcal', color: 'var(--accent)' },
  proteinas:      { label: 'Proteinas', unit: 'g',    color: 'var(--green)' },
  carbohidratos:  { label: 'Carbos',    unit: 'g',    color: 'var(--amber)' },
  grasas:         { label: 'Grasas',    unit: 'g',    color: '#8B6CC1' },
  fibra:          { label: 'Fibra',     unit: 'g',    color: '#5B8C5A' },
};

function renderMetricCards(totals, metrics, tdee, meals) {
  let html = '';
  metrics.forEach(key => {
    const meta = METRIC_META[key];
    if (!meta) return;
    const val = Math.round(totals[key] || 0);
    // For calories, show progress vs TDEE if available
    let progressHtml = '';
    if (key === 'calorias' && tdee) {
      const pct = Math.min(100, Math.round((val / tdee) * 100));
      progressHtml = `
        <div class="metric-progress">
          <div class="metric-progress-bar" style="width:${pct}%;background:${meta.color}"></div>
        </div>
        <div class="metric-target">${fmt.number(tdee)} objetivo</div>
      `;
    }
    html += `
      <div class="metric-card">
        <div class="metric-value" style="color:${meta.color}">${fmt.number(val)}</div>
        <div class="metric-unit">${meta.unit}</div>
        <div class="metric-label">${meta.label}</div>
        ${progressHtml}
      </div>
    `;
  });

  // Always show meals count
  html += `
    <div class="metric-card">
      <div class="metric-value neutral">${meals}</div>
      <div class="metric-unit">&nbsp;</div>
      <div class="metric-label">${meals === 1 ? 'Comida' : 'Comidas'}</div>
    </div>
  `;
  return html;
}

function renderGoalsSection(totals) {
  const profile = Profile.load();
  if (!profile) return '';

  const tdee = Profile.getTDEE();
  if (!tdee) return '';

  // Calculate daily targets based on objective
  let calTarget = tdee;
  let protTarget, carbTarget, fatTarget;

  const peso = profile.peso || 70;

  switch (profile.objetivo) {
    case 'bajar':
      calTarget = Math.round(tdee * 0.8);  // 20% deficit
      protTarget = Math.round(peso * 2);     // high protein to preserve muscle
      break;
    case 'subir':
      calTarget = Math.round(tdee * 1.15);  // 15% surplus
      protTarget = Math.round(peso * 2.2);
      break;
    case 'mantener':
    default:
      protTarget = Math.round(peso * 1.6);
      break;
  }

  // Protein calories = protTarget * 4, rest split 45/55 carbs/fat
  const protCal = protTarget * 4;
  const remaining = calTarget - protCal;
  carbTarget = Math.round((remaining * 0.55) / 4);
  fatTarget = Math.round((remaining * 0.45) / 9);

  const goals = [
    { key: 'calorias', label: 'Calorias', current: totals.calorias, target: calTarget, unit: 'kcal', color: 'var(--accent)' },
    { key: 'proteinas', label: 'Proteina', current: totals.proteinas, target: protTarget, unit: 'g', color: 'var(--green)' },
    { key: 'carbohidratos', label: 'Carbos', current: totals.carbohidratos, target: carbTarget, unit: 'g', color: 'var(--amber)' },
    { key: 'grasas', label: 'Grasas', current: totals.grasas, target: fatTarget, unit: 'g', color: '#8B6CC1' },
  ];

  return `
    <div class="goals-section" style="padding:0 16px 12px">
      <div class="section-label">Objetivos del dia</div>
      <div class="goals-list">
        ${goals.map(g => {
          const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
          const over = g.current > g.target;
          return `
            <div class="goal-row">
              <div class="goal-info">
                <span class="goal-label">${g.label}</span>
                <span class="goal-nums">${Math.round(g.current)} / ${g.target} ${g.unit}</span>
              </div>
              <div class="goal-bar">
                <div class="goal-bar-fill ${over ? 'over' : ''}" style="width:${pct}%;background:${g.color}"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// ─── WEEK VIEW ────────────────────────────────────
function renderWeek(container) {
  const today = new Date();
  const todayIso = fmt.iso(today);

  const base = new Date(today);
  const dow  = today.getDay() === 0 ? 6 : today.getDay() - 1;
  base.setDate(today.getDate() - dow + state.weekOffset * 7);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return d;
  });

  const fromIso = fmt.iso(days[0]);
  const toIso   = fmt.iso(days[6]);

  const allEntries = DB.byRange(fromIso, toIso);

  const byDate = {};
  allEntries.forEach(e => {
    (byDate[e.date] = byDate[e.date] || []).push(e);
  });

  if (!state.selectedDay || state.selectedDay < fromIso || state.selectedDay > toIso) {
    state.selectedDay = todayIso >= fromIso && todayIso <= toIso ? todayIso : fromIso;
  }

  const weekTotal = allEntries.reduce((s, e) => s + (e.totales?.calorias || e.calories || 0), 0);
  const weekMeals = allEntries.length;

  const selectedEntries = (byDate[state.selectedDay] || [])
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const selectedTotal = selectedEntries.reduce((s, e) => s + (e.totales?.calorias || e.calories || 0), 0);

  const rangeLabel = `${fmt.shortDate(days[0])} - ${fmt.shortDate(days[6])}`;
  const selectedDateObj = localDate(state.selectedDay);

  // Weekly food breakdown
  const foodBreakdown = getWeeklyFoodBreakdown(allEntries);

  container.innerHTML = `
    <div class="week-view">
      <div class="week-nav-bar">
        <button class="week-nav-btn" id="btn-week-prev">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="week-title">${rangeLabel}</div>
        <button class="week-nav-btn" id="btn-week-next" ${state.weekOffset >= 0 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      <div class="day-pills" id="day-pills">
        ${days.map(d => {
          const iso   = fmt.iso(d);
          const total = (byDate[iso] || []).reduce((s, e) => s + (e.totales?.calorias || e.calories || 0), 0);
          const isSelected = iso === state.selectedDay;
          const isToday    = iso === todayIso;
          return `
            <div class="day-pill ${isSelected ? 'active' : ''} ${isToday && !isSelected ? 'is-today' : ''}"
                 data-day="${iso}">
              <span class="day-pill-name">${capitalize(fmt.dayName(d))}</span>
              <span class="day-num">${d.getDate()}</span>
              <span class="day-kcal">${total > 0 ? fmt.number(total) : '-'}</span>
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

      <!-- Weekly food breakdown -->
      ${foodBreakdown.length > 0 ? `
        <div class="week-breakdown">
          <div class="section-label" style="padding:0 16px;margin-bottom:10px">Alimentos de la semana</div>
          <div class="breakdown-list" style="padding:0 16px">
            ${foodBreakdown.slice(0, 8).map(f => `
              <div class="breakdown-item">
                <span class="breakdown-name">${escHtml(f.name)}</span>
                <span class="breakdown-count">${f.count}x</span>
                <span class="breakdown-cal">${fmt.number(f.totalCal)} kcal</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div class="week-day-heading">
        <div class="week-day-title">${fmt.longDate(selectedDateObj)}</div>
        ${selectedTotal > 0 ? `<div class="week-day-kcal">${fmt.number(selectedTotal)} kcal</div>` : ''}
      </div>

      <div class="week-entries">
        ${selectedEntries.length > 0
          ? selectedEntries.map(renderEntryCard).join('')
          : `<div class="no-entries">Sin registros este dia</div>`
        }
      </div>
    </div>
  `;

  container.querySelectorAll('.day-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      state.selectedDay = pill.dataset.day;
      renderView('week');
    });
  });

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

function getWeeklyFoodBreakdown(entries) {
  const map = {};
  entries.forEach(e => {
    const name = (e.dish_name || '').toLowerCase().trim();
    if (!name) return;
    if (!map[name]) map[name] = { name: e.dish_name, count: 0, totalCal: 0 };
    map[name].count++;
    map[name].totalCal += e.totales?.calorias || e.calories || 0;
  });
  return Object.values(map).sort((a, b) => b.count - a.count);
}

// ─── NURI (Coach) VIEW ────────────────────────────
function renderNuri(container) {
  const profile = Profile.load();
  const name = profile?.nombre || 'amigo/a';

  container.innerHTML = `
    <div class="nuri-view">
      <div class="nuri-header">
        <div class="nuri-avatar">N</div>
        <div class="nuri-intro">
          <div class="nuri-name">Nuri</div>
          <div class="nuri-role">Tu coach nutricional</div>
        </div>
      </div>

      <div class="nuri-chat" id="nuri-chat">
        ${state.nuriMessages.length === 0 ? `
          <div class="nuri-welcome">
            <p class="nuri-welcome-text">Hola ${escHtml(name)}! Soy Nuri, tu coach nutricional. Preguntame lo que quieras:</p>
            <div class="nuri-suggestions">
              <button class="nuri-suggestion" data-msg="Como me fue hoy?">Como me fue hoy?</button>
              <button class="nuri-suggestion" data-msg="Que me falta esta semana?">Que me falta esta semana?</button>
              <button class="nuri-suggestion" data-msg="Dame una receta saludable para hoy">Receta para hoy</button>
              <button class="nuri-suggestion" data-msg="Que deberia mejorar de mi alimentacion?">Que deberia mejorar?</button>
            </div>
          </div>
        ` : state.nuriMessages.map(m => `
          <div class="nuri-msg ${m.role}">
            ${m.role === 'assistant' ? '<div class="nuri-msg-avatar">N</div>' : ''}
            <div class="nuri-msg-bubble">${formatNuriMessage(m.content)}</div>
          </div>
        `).join('')}
        ${state.nuriLoading ? `
          <div class="nuri-msg assistant">
            <div class="nuri-msg-avatar">N</div>
            <div class="nuri-msg-bubble nuri-typing">
              <span></span><span></span><span></span>
            </div>
          </div>
        ` : ''}
      </div>

      <div class="nuri-input-wrap">
        <input type="text" id="nuri-input" class="nuri-input" placeholder="Preguntale a Nuri..." autocomplete="off">
        <button class="nuri-send" id="nuri-send">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  // Scroll to bottom
  const chat = $('nuri-chat');
  chat.scrollTop = chat.scrollHeight;

  // Suggestion buttons
  container.querySelectorAll('.nuri-suggestion').forEach(btn => {
    btn.addEventListener('click', () => sendNuriMessage(btn.dataset.msg));
  });

  // Input handling
  const input = $('nuri-input');
  const sendBtn = $('nuri-send');

  sendBtn.addEventListener('click', () => {
    const msg = input.value.trim();
    if (msg) sendNuriMessage(msg);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const msg = input.value.trim();
      if (msg) sendNuriMessage(msg);
    }
  });

  // Focus input
  setTimeout(() => input?.focus(), 300);
}

async function sendNuriMessage(text) {
  if (state.nuriLoading) return;

  state.nuriMessages.push({ role: 'user', content: text });
  state.nuriLoading = true;
  renderView('nuri');

  try {
    // Get last 7 days of entries for context
    const today = fmt.iso(new Date());
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const history = DB.byRange(fmt.iso(weekAgo), today).map(e => ({
      fecha: e.date,
      hora: fmt.time(e.created_at),
      plato: e.dish_name,
      calorias: e.totales?.calorias || e.calories || 0,
      proteinas: e.totales?.proteinas || 0,
      carbohidratos: e.totales?.carbohidratos || 0,
      grasas: e.totales?.grasas || 0,
      fibra: e.totales?.fibra || 0,
    }));

    const profile = Profile.load();

    // Check if it's a recipe request — use /api/recommend
    const isRecipeRequest = /receta|cocinar|preparar|comer hoy|que hago de|que cocino/i.test(text);

    if (isRecipeRequest) {
      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, history, context: text }),
      });

      if (!res.ok) throw new Error('Error del servidor');
      const data = await res.json();

      if (data.recetas && data.recetas.length > 0) {
        const formatted = formatRecipes(data.recetas);
        state.nuriMessages.push({ role: 'assistant', content: formatted });
      } else {
        state.nuriMessages.push({ role: 'assistant', content: 'No pude generar recetas ahora. Intenta de nuevo.' });
      }
    } else {
      const res = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, profile, history }),
      });

      if (!res.ok) throw new Error('Error del servidor');
      const data = await res.json();

      state.nuriMessages.push({ role: 'assistant', content: data.response });
    }
  } catch (err) {
    state.nuriMessages.push({ role: 'assistant', content: 'Perdon, hubo un error. Intenta de nuevo.' });
  } finally {
    state.nuriLoading = false;
    renderView('nuri');
  }
}

function formatRecipes(recetas) {
  return recetas.map(r => {
    let text = `**${r.nombre}**\n`;
    if (r.descripcion) text += `${r.descripcion}\n`;
    if (r.tiempo) text += `Tiempo: ${r.tiempo}\n`;
    text += '\n';

    if (r.ingredientes?.length > 0) {
      text += '**Ingredientes:**\n';
      r.ingredientes.forEach(i => {
        text += `- ${i.nombre}: ${i.gramos}g${i.detalle ? ` (${i.detalle})` : ''}\n`;
      });
      text += '\n';
    }

    if (r.pasos?.length > 0) {
      text += '**Pasos:**\n';
      r.pasos.forEach((p, i) => {
        text += `${i + 1}. ${p}\n`;
      });
      text += '\n';
    }

    if (r.totales) {
      text += `**Nutricion:** ${r.totales.calorias} kcal | P:${r.totales.proteinas}g C:${r.totales.carbohidratos}g G:${r.totales.grasas}g F:${r.totales.fibra}g\n`;
    }

    if (r.tags?.length > 0) {
      text += r.tags.map(t => `#${t}`).join(' ') + '\n';
    }

    return text;
  }).join('\n---\n\n');
}

function formatNuriMessage(text) {
  // Basic markdown-like formatting
  return escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
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
        <div class="filter-title">Buscar por periodo</div>
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
    results.innerHTML = `<div class="no-entries">Sin registros en este periodo</div>`;
    return;
  }

  const byDate = {};
  entries.forEach(e => {
    (byDate[e.date] = byDate[e.date] || []).push(e);
  });

  const totalCal = entries.reduce((s, e) => s + (e.totales?.calorias || e.calories || 0), 0);
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
        <div class="summary-lbl">kcal/dia prom.</div>
      </div>
    </div>
  `;

  Object.keys(byDate).sort().reverse().forEach(dateIso => {
    const dayEntries = byDate[dateIso];
    const dayTotal   = dayEntries.reduce((s, e) => s + (e.totales?.calorias || e.calories || 0), 0);
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
  const cal = entry.totales?.calorias || entry.calories || 0;
  const prot = entry.totales?.proteinas || 0;
  const hasQuality = entry.calidad && (entry.calidad.metabolico || entry.calidad.digestivo || entry.calidad.cardiovascular);

  return `
    <div class="entry-card">
      <span class="entry-time">${escHtml(time)}</span>
      <div class="entry-info">
        <div class="entry-name">${escHtml(entry.dish_name)}</div>
        ${entry.description ? `<div class="entry-desc">${escHtml(entry.description)}</div>` : ''}
        ${prot > 0 ? `<div class="entry-macros-mini">P:${Math.round(prot)}g C:${Math.round(entry.totales?.carbohidratos || 0)}g G:${Math.round(entry.totales?.grasas || 0)}g</div>` : ''}
      </div>
      <div class="entry-right">
        <span class="entry-kcal">${fmt.number(cal)} kcal</span>
        ${hasQuality ? renderQualityDots(entry.calidad) : ''}
      </div>
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

function renderQualityDots(calidad) {
  if (!calidad) return '';
  const levels = [calidad.metabolico?.nivel, calidad.digestivo?.nivel, calidad.cardiovascular?.nivel].filter(Boolean);
  if (levels.length === 0) return '';
  return `<div class="quality-dots">${levels.map(l => `<span class="q-dot q-${l}"></span>`).join('')}</div>`;
}

function bindDeleteButtons(container, onDelete) {
  container.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Eliminas este registro?')) return;
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
      alert('No se pudo leer la imagen. Intenta de nuevo.');
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

// ─── Result Modal (with ingredients) ─────────────
function showResultModal(data, imageDataUrl) {
  const {
    plato = '', calorias = 0, descripcion = '', confianza = 'baja',
    ingredientes = [], totales = {}, calidad = {}
  } = data;

  state.pendingResult = data;
  state.pendingIngredients = ingredientes.map(i => ({ ...i }));

  // Photo preview
  const photoWrap = $('result-photo-wrap');
  if (imageDataUrl) {
    photoWrap.innerHTML = `<img src="${imageDataUrl}" alt="Foto capturada">`;
    photoWrap.classList.remove('hidden');
  } else {
    photoWrap.innerHTML = '';
  }

  $('result-dish-input').value = capitalize(plato);
  $('result-desc').textContent = descripcion;

  const confEl = $('result-confidence');
  const confLabels = { alta: 'Alta', media: 'Media', baja: 'Baja' };
  confEl.textContent = confLabels[confianza] || 'Baja';
  confEl.className = `confidence-pill ${confianza}`;

  // Quality scores
  renderQualityRow(calidad);

  // Macros bar
  renderMacroBar(totales);

  // Ingredients list
  renderIngredientsList();

  // Total
  updateResultTotals();

  $('result-modal').classList.remove('hidden');
  setTimeout(() => $('result-dish-input')?.focus(), 400);
}

function renderQualityRow(calidad) {
  const row = $('quality-row');
  if (!calidad || (!calidad.metabolico && !calidad.digestivo && !calidad.cardiovascular)) {
    row.innerHTML = '';
    return;
  }

  const axes = [
    { key: 'metabolico', label: 'Metabolico', icon: '&#9889;' },
    { key: 'digestivo', label: 'Digestivo', icon: '&#129744;' },
    { key: 'cardiovascular', label: 'Cardiovascular', icon: '&#10084;' },
  ];

  const levelLabels = { 1: 'Pobre', 2: 'Regular', 3: 'Bueno', 4: 'Excelente' };

  row.innerHTML = axes.map(ax => {
    const data = calidad[ax.key];
    if (!data) return '';
    const nivel = data.nivel || 2;
    return `
      <div class="quality-item q-level-${nivel}" title="${escHtml(data.detalle || '')}">
        <span class="quality-icon">${ax.icon}</span>
        <span class="quality-label">${ax.label}</span>
        <span class="quality-level">${levelLabels[nivel]}</span>
      </div>
    `;
  }).join('');
}

function renderMacroBar(totales) {
  const bar = $('result-macros');
  if (!totales || !totales.proteinas) {
    bar.innerHTML = '';
    return;
  }

  bar.innerHTML = `
    <div class="macro-item"><span class="macro-val" style="color:var(--green)">${Math.round(totales.proteinas || 0)}g</span><span class="macro-lbl">Prot</span></div>
    <div class="macro-item"><span class="macro-val" style="color:var(--amber)">${Math.round(totales.carbohidratos || 0)}g</span><span class="macro-lbl">Carbs</span></div>
    <div class="macro-item"><span class="macro-val" style="color:#8B6CC1">${Math.round(totales.grasas || 0)}g</span><span class="macro-lbl">Grasas</span></div>
    <div class="macro-item"><span class="macro-val" style="color:#5B8C5A">${Math.round(totales.fibra || 0)}g</span><span class="macro-lbl">Fibra</span></div>
  `;
}

function renderIngredientsList() {
  const list = $('ingredients-list');
  list.innerHTML = state.pendingIngredients.map((ing, i) => `
    <div class="ing-row" data-idx="${i}">
      <div class="ing-main">
        <input type="text" class="ing-name" value="${escHtml(ing.nombre)}" data-field="nombre" data-idx="${i}">
        <button class="ing-del" data-remove="${i}" title="Quitar">&times;</button>
      </div>
      <div class="ing-details">
        <div class="ing-field">
          <input type="number" class="ing-num" value="${ing.gramos}" data-field="gramos" data-idx="${i}" min="0" step="10">
          <span class="ing-unit">g</span>
        </div>
        <div class="ing-field">
          <input type="number" class="ing-num" value="${ing.calorias}" data-field="calorias" data-idx="${i}" min="0" step="5">
          <span class="ing-unit">kcal</span>
        </div>
        <div class="ing-field">
          <input type="number" class="ing-num" value="${Math.round(ing.proteinas)}" data-field="proteinas" data-idx="${i}" min="0" step="1">
          <span class="ing-unit">P</span>
        </div>
        <div class="ing-field">
          <input type="number" class="ing-num" value="${Math.round(ing.carbohidratos)}" data-field="carbohidratos" data-idx="${i}" min="0" step="1">
          <span class="ing-unit">C</span>
        </div>
        <div class="ing-field">
          <input type="number" class="ing-num" value="${Math.round(ing.grasas)}" data-field="grasas" data-idx="${i}" min="0" step="1">
          <span class="ing-unit">G</span>
        </div>
      </div>
    </div>
  `).join('');

  // Bind ingredient field changes
  list.querySelectorAll('.ing-num, .ing-name').forEach(input => {
    input.addEventListener('change', e => {
      const idx = parseInt(e.target.dataset.idx);
      const field = e.target.dataset.field;
      if (field === 'nombre') {
        state.pendingIngredients[idx].nombre = e.target.value;
      } else {
        const oldGramos = state.pendingIngredients[idx].gramos || 1;
        state.pendingIngredients[idx][field] = parseFloat(e.target.value) || 0;

        // If grams changed, scale other nutrients proportionally
        if (field === 'gramos') {
          const newGramos = parseFloat(e.target.value) || 1;
          const ratio = newGramos / oldGramos;
          ['calorias', 'proteinas', 'carbohidratos', 'grasas', 'fibra'].forEach(f => {
            state.pendingIngredients[idx][f] = Math.round(state.pendingIngredients[idx][f] * ratio);
          });
          renderIngredientsList(); // re-render to show scaled values
        }
      }
      updateResultTotals();
    });
  });

  // Bind remove buttons
  list.querySelectorAll('.ing-del').forEach(btn => {
    btn.addEventListener('click', () => {
      state.pendingIngredients.splice(parseInt(btn.dataset.remove), 1);
      renderIngredientsList();
      updateResultTotals();
    });
  });
}

function updateResultTotals() {
  const t = { calorias: 0, proteinas: 0, carbohidratos: 0, grasas: 0, fibra: 0 };
  state.pendingIngredients.forEach(i => {
    t.calorias += i.calorias || 0;
    t.proteinas += i.proteinas || 0;
    t.carbohidratos += i.carbohidratos || 0;
    t.grasas += i.grasas || 0;
    t.fibra += i.fibra || 0;
  });
  $('result-total-cal').textContent = `${fmt.number(Math.round(t.calorias))} kcal`;
  renderMacroBar(t);
}

function setupResultModal() {
  $('btn-add-ingredient').addEventListener('click', () => {
    state.pendingIngredients.push({
      nombre: 'Nuevo ingrediente', gramos: 100, calorias: 0,
      proteinas: 0, carbohidratos: 0, grasas: 0, fibra: 0,
    });
    renderIngredientsList();
    // Focus the new ingredient name
    const inputs = $('ingredients-list').querySelectorAll('.ing-name');
    inputs[inputs.length - 1]?.focus();
  });

  $('btn-discard').addEventListener('click', closeResultModal);
  $('result-backdrop').addEventListener('click', closeResultModal);
  $('btn-save').addEventListener('click', saveEntry);
}

function closeResultModal() {
  $('result-modal').classList.add('hidden');
  state.pendingResult = null;
  state.pendingImageDataUrl = null;
  state.pendingIngredients = [];
}

function saveEntry() {
  const dish = $('result-dish-input').value.trim();
  if (!dish) {
    $('result-dish-input').focus();
    return;
  }

  // Calculate totals from ingredients
  const totales = { calorias: 0, proteinas: 0, carbohidratos: 0, grasas: 0, fibra: 0 };
  state.pendingIngredients.forEach(i => {
    totales.calorias += i.calorias || 0;
    totales.proteinas += i.proteinas || 0;
    totales.carbohidratos += i.carbohidratos || 0;
    totales.grasas += i.grasas || 0;
    totales.fibra += i.fibra || 0;
  });

  const now = new Date();
  const entry = {
    id:            genId(),
    created_at:    now.toISOString(),
    date:          fmt.iso(now),
    dish_name:     dish,
    calories:      Math.round(totales.calorias),  // backward compat
    description:   state.pendingResult?.descripcion || '',
    ingredientes:  state.pendingIngredients,
    totales,
    calidad:       state.pendingResult?.calidad || null,
  };
  DB.add(entry);

  // Write to Apple Health / Google Health Connect (non-blocking)
  writeEntryToHealth(entry);

  vibrate([10, 30, 10]);
  closeResultModal();
  renderView(state.view);
}

// ─── Export Modal ─────────────────────────────────
function showExport(byDate, from, to, totalCal, avgCal) {
  const fromObj = localDate(from);
  const toObj   = localDate(to);

  let text = `REGISTRO ALIMENTARIO - FOODVISOR\n`;
  text += `Periodo: ${fmt.fullDate(fromObj)} al ${fmt.fullDate(toObj)}\n`;
  text += `Total: ${fmt.number(totalCal)} kcal | Promedio diario: ${fmt.number(avgCal)} kcal\n`;
  text += `${'─'.repeat(45)}\n`;

  Object.keys(byDate).sort().forEach(dateIso => {
    const dayEntries = byDate[dateIso];
    const dayTotal   = dayEntries.reduce((s, e) => s + (e.totales?.calorias || e.calories || 0), 0);
    const dateObj    = localDate(dateIso);

    text += `\n${fmt.longDate(dateObj)} (${fmt.number(dayTotal)} kcal)\n`;
    dayEntries
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .forEach(e => {
        const cal = e.totales?.calorias || e.calories || 0;
        text += `  ${fmt.time(e.created_at)}  ${e.dish_name}: ${cal} kcal`;
        if (e.totales?.proteinas) {
          text += ` | P:${Math.round(e.totales.proteinas)}g C:${Math.round(e.totales.carbohidratos || 0)}g G:${Math.round(e.totales.grasas || 0)}g`;
        }
        text += '\n';
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
        Copiado!
      `;
      setTimeout(() => { btn.innerHTML = orig; }, 2200);
      vibrate([10, 20, 10]);
    } catch {
      const el = $('export-preview');
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });
}

// ─── Settings ─────────────────────────────────────
function setupSettings() {
  $('btn-settings').addEventListener('click', showSettings);
  $('settings-backdrop').addEventListener('click', () => {
    $('settings-modal').classList.add('hidden');
  });
}

function showSettings() {
  const profile = Profile.load() || {};
  const metrics = profile.metrics || ['calorias', 'proteinas'];
  const allMetrics = Object.keys(METRIC_META);

  const body = $('settings-body');
  body.innerHTML = `
    <h2 class="modal-title">Configuracion</h2>

    <div class="settings-section">
      <div class="field-label">Metricas en inicio</div>
      <div class="settings-desc">Elegí que datos ver en la pantalla principal</div>
      <div class="metric-toggles">
        ${allMetrics.map(key => {
          const meta = METRIC_META[key];
          const checked = metrics.includes(key);
          return `
            <label class="metric-toggle ${checked ? 'active' : ''}">
              <input type="checkbox" value="${key}" ${checked ? 'checked' : ''}>
              <span class="metric-toggle-dot" style="background:${meta.color}"></span>
              <span>${meta.label}</span>
            </label>
          `;
        }).join('')}
      </div>
    </div>

    <div class="settings-section">
      <div class="field-label">Perfil</div>
      ${profile.nombre ? `
        <div class="settings-profile-summary">
          ${profile.nombre} | ${profile.peso}kg | ${profile.altura}cm | ${profile.edad} anios
          <br>Objetivo: ${profile.objetivo || '-'} | TDEE: ${Profile.getTDEE() || '-'} kcal
        </div>
      ` : `<div class="settings-desc">No configurado</div>`}
      <button class="btn-secondary" id="btn-rerun-wizard" style="margin-top:10px">
        ${profile.nombre ? 'Editar perfil' : 'Configurar perfil'}
      </button>
    </div>

    <div class="modal-actions">
      <button class="btn-primary" id="btn-save-settings">Guardar</button>
    </div>
  `;

  // Toggle active class
  body.querySelectorAll('.metric-toggle input').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.closest('.metric-toggle').classList.toggle('active', cb.checked);
    });
  });

  $('btn-rerun-wizard').addEventListener('click', () => {
    $('settings-modal').classList.add('hidden');
    showWizard();
  });

  $('btn-save-settings').addEventListener('click', () => {
    const selected = [];
    body.querySelectorAll('.metric-toggle input:checked').forEach(cb => {
      selected.push(cb.value);
    });
    if (selected.length === 0) selected.push('calorias');

    const p = Profile.load() || {};
    p.metrics = selected;
    Profile.save(p);

    $('settings-modal').classList.add('hidden');
    renderView(state.view);
  });

  $('settings-modal').classList.remove('hidden');
}

// ─── Wizard / Onboarding ─────────────────────────
const WIZARD_STEPS = [
  {
    id: 'welcome',
    render: () => `
      <div class="wizard-step wizard-welcome">
        <div class="wizard-emoji">&#127869;</div>
        <h2 class="wizard-title">Bienvenido a Foodvisor</h2>
        <p class="wizard-text">Vamos a configurar tu perfil para personalizar la experiencia. Son solo unas preguntas rapidas.</p>
        <button class="btn-primary wizard-next" data-next="nombre">Empezar</button>
      </div>
    `,
  },
  {
    id: 'nombre',
    render: (data) => `
      <div class="wizard-step">
        <h2 class="wizard-title">Como te llamas?</h2>
        <p class="wizard-text">Para que Nuri, tu coach nutricional, sepa como hablarte.</p>
        <input type="text" id="wiz-nombre" class="wizard-input" placeholder="Tu nombre" value="${data.nombre || ''}" autocomplete="off">
        <button class="btn-primary wizard-next" data-next="sexo">Siguiente</button>
      </div>
    `,
    save: () => ({ nombre: $('wiz-nombre')?.value.trim() || '' }),
  },
  {
    id: 'sexo',
    render: (data) => `
      <div class="wizard-step">
        <h2 class="wizard-title">Sexo biologico</h2>
        <p class="wizard-text">Lo necesitamos para calcular tu metabolismo basal.</p>
        <div class="wizard-options">
          <button class="wizard-option ${data.sexo === 'M' ? 'active' : ''}" data-val="M">Masculino</button>
          <button class="wizard-option ${data.sexo === 'F' ? 'active' : ''}" data-val="F">Femenino</button>
        </div>
        <button class="btn-primary wizard-next" data-next="health">Siguiente</button>
      </div>
    `,
    init: () => {
      document.querySelectorAll('.wizard-option').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.wizard-option').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          wizardData.sexo = btn.dataset.val;
        });
      });
    },
    save: () => ({ sexo: wizardData.sexo }),
  },
  {
    id: 'cuerpo',
    render: (data) => `
      <div class="wizard-step">
        <h2 class="wizard-title">Tus datos</h2>
        <p class="wizard-text">Para calcular tus necesidades caloricas diarias.</p>
        <div class="wizard-fields">
          <div class="wizard-field">
            <label>Edad</label>
            <input type="number" id="wiz-edad" class="wizard-input" placeholder="30" value="${data.edad || ''}" min="10" max="120">
          </div>
          <div class="wizard-field">
            <label>Peso (kg)</label>
            <input type="number" id="wiz-peso" class="wizard-input" placeholder="70" value="${data.peso || ''}" min="20" max="300" step="0.5">
          </div>
          <div class="wizard-field">
            <label>Altura (cm)</label>
            <input type="number" id="wiz-altura" class="wizard-input" placeholder="170" value="${data.altura || ''}" min="100" max="250">
          </div>
        </div>
        <button class="btn-primary wizard-next" data-next="actividad">Siguiente</button>
      </div>
    `,
    save: () => ({
      edad: parseInt($('wiz-edad')?.value) || 30,
      peso: parseFloat($('wiz-peso')?.value) || 70,
      altura: parseInt($('wiz-altura')?.value) || 170,
    }),
  },
  {
    id: 'actividad',
    render: (data) => `
      <div class="wizard-step">
        <h2 class="wizard-title">Nivel de actividad</h2>
        <p class="wizard-text">Que tan activo sos en tu dia a dia?</p>
        <div class="wizard-options vertical">
          <button class="wizard-option ${data.actividad === 'sedentario' ? 'active' : ''}" data-val="sedentario">Sedentario <small>Trabajo de escritorio, poco ejercicio</small></button>
          <button class="wizard-option ${data.actividad === 'ligero' ? 'active' : ''}" data-val="ligero">Ligero <small>Ejercicio 1-3 dias/semana</small></button>
          <button class="wizard-option ${data.actividad === 'moderado' ? 'active' : ''}" data-val="moderado">Moderado <small>Ejercicio 3-5 dias/semana</small></button>
          <button class="wizard-option ${data.actividad === 'activo' ? 'active' : ''}" data-val="activo">Activo <small>Ejercicio 6-7 dias/semana</small></button>
          <button class="wizard-option ${data.actividad === 'muy_activo' ? 'active' : ''}" data-val="muy_activo">Muy activo <small>Trabajo fisico + ejercicio intenso</small></button>
        </div>
        <button class="btn-primary wizard-next" data-next="objetivo">Siguiente</button>
      </div>
    `,
    init: () => {
      document.querySelectorAll('.wizard-option').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.wizard-option').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          wizardData.actividad = btn.dataset.val;
        });
      });
    },
    save: () => ({ actividad: wizardData.actividad }),
  },
  {
    id: 'objetivo',
    render: (data) => `
      <div class="wizard-step">
        <h2 class="wizard-title">Tu objetivo</h2>
        <p class="wizard-text">Que queres lograr con tu alimentacion?</p>
        <div class="wizard-options vertical">
          <button class="wizard-option ${data.objetivo === 'bajar' ? 'active' : ''}" data-val="bajar">Bajar de peso</button>
          <button class="wizard-option ${data.objetivo === 'mantener' ? 'active' : ''}" data-val="mantener">Mantener peso</button>
          <button class="wizard-option ${data.objetivo === 'subir' ? 'active' : ''}" data-val="subir">Ganar masa muscular</button>
          <button class="wizard-option ${data.objetivo === 'salud' ? 'active' : ''}" data-val="salud">Comer mas saludable</button>
          <button class="wizard-option ${data.objetivo === 'energia' ? 'active' : ''}" data-val="energia">Tener mas energia</button>
        </div>
        <button class="btn-primary wizard-next" data-next="restricciones">Siguiente</button>
      </div>
    `,
    init: () => {
      document.querySelectorAll('.wizard-option').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.wizard-option').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          wizardData.objetivo = btn.dataset.val;
        });
      });
    },
    save: () => ({ objetivo: wizardData.objetivo }),
  },
  {
    id: 'restricciones',
    render: (data) => `
      <div class="wizard-step">
        <h2 class="wizard-title">Restricciones alimentarias?</h2>
        <p class="wizard-text">Selecciona las que apliquen (o ninguna).</p>
        <div class="wizard-options vertical multi">
          ${['Vegetariano', 'Vegano', 'Celiaco', 'Sin lactosa', 'Diabetes', 'Hipertension', 'Ninguna'].map(r => `
            <button class="wizard-option ${(data.restricciones || []).includes(r) ? 'active' : ''}" data-val="${r}">${r}</button>
          `).join('')}
        </div>
        <button class="btn-primary wizard-next" data-next="metrics">Siguiente</button>
      </div>
    `,
    init: () => {
      if (!wizardData.restricciones) wizardData.restricciones = [];
      document.querySelectorAll('.wizard-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const val = btn.dataset.val;
          if (val === 'Ninguna') {
            wizardData.restricciones = ['Ninguna'];
            document.querySelectorAll('.wizard-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
          } else {
            wizardData.restricciones = wizardData.restricciones.filter(r => r !== 'Ninguna');
            document.querySelector('.wizard-option[data-val="Ninguna"]')?.classList.remove('active');
            if (wizardData.restricciones.includes(val)) {
              wizardData.restricciones = wizardData.restricciones.filter(r => r !== val);
              btn.classList.remove('active');
            } else {
              wizardData.restricciones.push(val);
              btn.classList.add('active');
            }
          }
        });
      });
    },
    save: () => ({ restricciones: wizardData.restricciones }),
  },
  {
    id: 'health',
    render: (data) => {
      const isNative = typeof Health !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform();
      if (!isNative) {
        // Skip this step in browser — auto-advance to cuerpo
        return `
          <div class="wizard-step" style="display:none">
            <button class="btn-primary wizard-next" data-next="cuerpo" id="health-auto-skip">skip</button>
          </div>
        `;
      }
      return `
        <div class="wizard-step wizard-welcome">
          <div class="wizard-emoji">&#129505;</div>
          <h2 class="wizard-title">Sincronizar con Salud</h2>
          <p class="wizard-text">Podemos leer tu peso y altura de Apple Health / Google Health para pre-llenar tus datos y registrar automaticamente la nutricion de cada comida.</p>
          <button class="btn-primary" id="btn-health-sync" style="width:100%;margin-bottom:12px">Conectar con Salud</button>
          <button class="btn-secondary wizard-next" data-next="cuerpo" style="width:100%">Omitir por ahora</button>
          <div id="health-status" style="margin-top:12px;font-size:13px;color:var(--text-2);text-align:center"></div>
        </div>
      `;
    },
    init: () => {
      const isNative = typeof Health !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform();
      if (!isNative) {
        // Auto-skip in browser
        setTimeout(() => {
          document.getElementById('health-auto-skip')?.click();
        }, 50);
        return;
      }

      const syncBtn = document.getElementById('btn-health-sync');
      if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
          const statusEl = document.getElementById('health-status');
          statusEl.textContent = 'Conectando...';
          syncBtn.disabled = true;

          try {
            const hp = window.Capacitor?.Plugins?.Health || null;
            let weightVal = null;

            if (hp) {
              try {
                const availResult = await hp.isAvailable();
                if (availResult?.available) {
                  await hp.requestAuthorization({
                    read: ['weight', 'height', 'steps'],
                    write: ['calories'],
                  });

                  const now = new Date().toISOString();

                  // Read weight (last 90 days)
                  const ago90 = new Date(Date.now() - 90 * 86400000).toISOString();
                  const wRes = await hp.readSamples({ dataType: 'weight', startDate: ago90, endDate: now, limit: 1 });
                  const wSamples = wRes?.samples || [];
                  if (wSamples.length > 0) weightVal = Math.round(wSamples[0].value * 10) / 10;

                  // Read height (last 10 years — rarely changes)
                  const ago10y = new Date(Date.now() - 3650 * 86400000).toISOString();
                  const hRes = await hp.readSamples({ dataType: 'height', startDate: ago10y, endDate: now, limit: 1 });
                  const hSamples = hRes?.samples || [];
                  if (hSamples.length > 0) {
                    const v = hSamples[0].value;
                    heightVal = v > 3 ? Math.round(v) : Math.round(v * 100);
                  }
                }
              } catch (e) {
                console.warn('Health sync error:', e);
              }
            }

            let healthResult = (weightVal || heightVal) ? { weight: weightVal, height: heightVal } : null;

            // Try to read name + age from Contacts
            let ownerName = null;
            let ownerAge = null;
            try {
              if (typeof Health !== 'undefined' && Health.getOwnerInfo) {
                const info = await Health.getOwnerInfo();
                if (info?.name) ownerName = info.name;
                if (info?.age) ownerAge = info.age;
              }
            } catch (e) {
              console.warn('Contacts error:', e);
            }

            if (ownerName && !wizardData.nombre) wizardData.nombre = ownerName;
            if (ownerAge && !wizardData.edad) wizardData.edad = ownerAge;
            if (healthResult) {
              if (healthResult.weight) wizardData.peso = healthResult.weight;
              if (healthResult.height) wizardData.altura = healthResult.height;
            }
            wizardData.healthSync = true;

            const parts = [];
            if (ownerName) parts.push(`${ownerName}`);
            if (ownerAge) parts.push(`${ownerAge} anios`);
            if (healthResult?.weight) parts.push(`${healthResult.weight}kg`);
            if (healthResult?.height) parts.push(`${healthResult.height}cm`);

            if (parts.length > 0) {
              statusEl.innerHTML = `Sincronizado! ${parts.join(' | ')}`;
            } else {
              statusEl.textContent = 'Conectado. No se encontraron datos recientes.';
            }
            setTimeout(() => renderWizardStep('cuerpo'), 1500);
          } catch {
            statusEl.textContent = 'No se pudo conectar. Podes intentarlo despues en Configuracion.';
            syncBtn.disabled = false;
          }
        });
      }
    },
    save: () => ({ healthSync: wizardData.healthSync || false }),
  },
  {
    id: 'metrics',
    render: (data) => `
      <div class="wizard-step">
        <h2 class="wizard-title">Que queres ver en tu inicio?</h2>
        <p class="wizard-text">Elegí las metricas que te importan. Podes cambiarlas despues.</p>
        <div class="wizard-options vertical multi">
          ${Object.entries(METRIC_META).map(([key, meta]) => `
            <button class="wizard-option ${(data.metrics || ['calorias', 'proteinas']).includes(key) ? 'active' : ''}" data-val="${key}">
              <span class="metric-toggle-dot" style="background:${meta.color}"></span>
              ${meta.label} (${meta.unit})
            </button>
          `).join('')}
        </div>
        <button class="btn-primary wizard-next" data-next="done">Finalizar</button>
      </div>
    `,
    init: () => {
      if (!wizardData.metrics) wizardData.metrics = ['calorias', 'proteinas'];
      document.querySelectorAll('.wizard-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const val = btn.dataset.val;
          if (wizardData.metrics.includes(val)) {
            if (wizardData.metrics.length > 1) {
              wizardData.metrics = wizardData.metrics.filter(m => m !== val);
              btn.classList.remove('active');
            }
          } else {
            wizardData.metrics.push(val);
            btn.classList.add('active');
          }
        });
      });
    },
    save: () => ({ metrics: wizardData.metrics }),
  },
  {
    id: 'done',
    render: (data) => {
      // Calculate TDEE preview
      let tmb, tdee;
      if (data.sexo === 'M') {
        tmb = 10 * (data.peso || 70) + 6.25 * (data.altura || 170) - 5 * (data.edad || 30) + 5;
      } else {
        tmb = 10 * (data.peso || 70) + 6.25 * (data.altura || 170) - 5 * (data.edad || 30) - 161;
      }
      const factors = { sedentario: 1.2, ligero: 1.375, moderado: 1.55, activo: 1.725, muy_activo: 1.9 };
      tdee = Math.round(tmb * (factors[data.actividad] || 1.4));

      return `
        <div class="wizard-step wizard-welcome">
          <div class="wizard-emoji">&#127881;</div>
          <h2 class="wizard-title">Listo, ${escHtml(data.nombre || '')}!</h2>
          <p class="wizard-text">Tu gasto calorico diario estimado es de <strong>${fmt.number(tdee)} kcal</strong>. Nuri va a usar estos datos para ayudarte.</p>
          <button class="btn-primary wizard-next" data-next="finish">Empezar a usar Foodvisor</button>
        </div>
      `;
    },
  },
];

let wizardData = {};
let wizardStep = 0;

function showWizard() {
  // Pre-fill with existing profile if editing
  wizardData = Profile.load() || {};
  wizardStep = 0;
  $('wizard-modal').classList.remove('hidden');
  renderWizardStep('welcome');
}

function renderWizardStep(stepId) {
  const step = WIZARD_STEPS.find(s => s.id === stepId);
  if (!step) return;

  // Progress
  const total = WIZARD_STEPS.length - 1; // exclude done
  const idx = WIZARD_STEPS.indexOf(step);
  const pct = Math.round((idx / total) * 100);
  $('wizard-progress').innerHTML = `<div class="wizard-progress-bar" style="width:${pct}%"></div>`;

  $('wizard-content').innerHTML = step.render(wizardData);

  // Init step-specific logic
  if (step.init) step.init();

  // Bind next button
  const nextBtn = $('wizard-content').querySelector('.wizard-next');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      // Save current step data
      if (step.save) {
        Object.assign(wizardData, step.save());
      }

      const nextId = nextBtn.dataset.next;
      if (nextId === 'finish') {
        finishWizard();
      } else {
        renderWizardStep(nextId);
      }
    });
  }
}

function finishWizard() {
  Profile.save(wizardData);
  $('wizard-modal').classList.add('hidden');
  renderView(state.view);
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

// ─── Health Integration ───────────────────────────
async function initHealth() {
  if (typeof Health === 'undefined') return;
  const available = await Health.isAvailable();
  if (available) {
    console.log('Health APIs available on', Health.getPlatform());
  }
}

async function syncHealthToProfile() {
  if (typeof Health === 'undefined') return;
  if (!(await Health.isAvailable())) return;

  const authorized = await Health.requestAuthorization();
  if (!authorized) return;

  const weight = await Health.getWeight();
  const height = await Health.getHeight();

  if (weight || height) {
    const p = Profile.load() || {};
    if (weight) p.peso = weight;
    if (height) p.altura = height;
    p.healthSync = true;
    Profile.save(p);
    return { weight, height };
  }
  return null;
}

async function writeEntryToHealth(entry) {
  if (typeof Health === 'undefined') return;
  if (!(await Health.isAvailable())) return;

  const profile = Profile.load();
  if (!profile?.healthSync) return;

  await Health.writeNutrition({
    calories: entry.totales?.calorias || entry.calories || 0,
    date: entry.created_at,
  });
}

// ─── Service Worker ───────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('SW registration failed:', err);
    });
  }
}
