const app = document.querySelector("#app");

let state = {
  user: null,
  data: null,
  page: "overview",
  loading: true,
  assistantBusy: false,
  visionCache: {},
  employeeFilter: "all",
  cameraKind: "outfit",
  incidentPage: 0,
  transportPage: 0,
  taskFilter: "all",
  taskMode: "tasks",
  weather: null,
  taskReport: null,
  replayReport: null,
  cargoMismatchLastAt: 0,
  soundStream: null,
  soundAudioContext: null
};

const pages = [
  ["overview", "dashboard", "Обзор"],
  ["cameras", "videocam", "Камеры"],
  ["sound", "mic", "Звук"],
  ["transport", "local_shipping", "Транспорт"],
  ["cargo", "inventory_2", "Контроль груза"],
  ["employees", "badge", "Сотрудники"],
  ["incidents", "warning", "Инциденты"],
  ["tasks", "assignment", "Задания"],

];

const roleName = (role) => role === "ADMIN" ? "Руководитель смены" : "Работник";
const sev = { critical: "Критично", warning: "Внимание", medium: "Средне", low: "Низко" };
const statusText = { new: "Новое", in_progress: "В работе", done: "Готово", open: "Открыт", investigating: "Расследуется", closed: "Закрыт" };
const icon = (name, cls = "") => {
  const shapes={
    map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3ZM9 3v15M15 6v15"/>',
    assignment:'<rect x="4" y="4" width="16" height="18" rx="3"/><path d="M9 2h6v4H9zM8 11h8M8 15h5"/>',
    psychology:'<path d="M8 21v-4c-5-2-5-10-1-13s12-1 12 5l3 4h-4v5h-5v3"/><path d="M10 7v5M7.5 9.5h5"/>',
    local_shipping:'<path d="M2 5h12v12H2zM14 10h4l4 4v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    verified_user:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
    visibility:'<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    groups:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',
    notifications:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    history:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
    shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
    badge:'<rect x="4" y="5" width="16" height="17" rx="3"/><path d="M9 5V2h6v3M8 17h8"/><circle cx="12" cy="11" r="2"/>',
    emergency:'<path d="M6 17V9a6 6 0 0 1 12 0v8M3 21h18M3 4l2 2M21 4l-2 2M12 1v2"/>',
    videocam:'<rect x="2" y="6" width="14" height="13" rx="2"/><path d="m16 10 6-3v11l-6-3"/>',
    videocam_off:'<path d="m2 2 20 20M7 6h7a2 2 0 0 1 2 2v3l6-4v11l-4-2M16 19H4a2 2 0 0 1-2-2V8"/>',
    close:'<path d="m6 6 12 12M18 6 6 18"/>',
    chevron_left:'<path d="m15 6-6 6 6 6"/>',
    chevron_right:'<path d="m9 6 6 6-6 6"/>',
    check:'<path d="m4 12 5 5L20 6"/>',
    warning:'<path d="m12 3 10 18H2Z"/><path d="M12 9v5M12 17h.01"/>'
  };
  return `<svg class="material-symbols-outlined app-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name]||'<circle cx="12" cy="12" r="9"/><path d="M12 7v5M12 16h.01"/>'}</svg>`;
};
const brandMark = () => `<svg class="brand-mark" viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="18" width="36" height="14" rx="5" fill="currentColor" opacity=".16"/><path d="M11 27h26l-3.2-8.2A5 5 0 0 0 29.2 16H18.8a5 5 0 0 0-4.6 2.8L11 27Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M9 27h30v7H9z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle cx="16" cy="35" r="3.5" fill="currentColor"/><circle cx="32" cy="35" r="3.5" fill="currentColor"/><path d="M18 21h12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
const hiddenForWorker = new Set(["cameras", "cargo", "employees"]);
const visiblePages = () => pages.filter(([id]) => state.user?.role === "ADMIN" || !hiddenForWorker.has(id));
const categoryText = { all: "Все", worker: "Рабочие", driver: "Водители", safety: "ОТ", lab: "Лаборатория", maintenance: "Техслужба" };
const driverStatusText = { active_trip: "везет груз", idle: "не везет груз", not_driver: "не водитель" };

function metricSvg(name, colorClass = "text-primary") {
  const attrs = `viewBox="0 0 24 24" fill="none" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const icons = {
    groups: `<svg ${attrs}><path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M3.5 19c.6-3.2 2.3-5 4.5-5s3.9 1.8 4.5 5"/><path d="M11.5 19c.6-3.2 2.3-5 4.5-5s3.9 1.8 4.5 5"/></svg>`,
    videocam: `<svg ${attrs}><path d="M4.5 7.5h9a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z"/><path d="m15.5 10 5-2.8v9.6l-5-2.8"/></svg>`,
    local_shipping: `<svg ${attrs}><path d="M3 6h11v10H3z"/><path d="M14 10h3.5l3.5 3.5V16h-7z"/><path d="M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg>`,
    grain: `<svg ${attrs}><circle cx="7" cy="7" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none"/><circle cx="17" cy="7" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="7" cy="17" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none"/><circle cx="17" cy="17" r="1.4" fill="currentColor" stroke="none"/></svg>`,
    notifications: `<svg ${attrs}><path d="M18 9a6 6 0 1 0-12 0c0 7-2.5 7-2.5 7h17S18 16 18 9Z"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/></svg>`,
    error: `<svg ${attrs}><circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 17h.01"/></svg>`,
    speed: `<svg ${attrs}><path d="M4 14a8 8 0 1 1 16 0"/><path d="M12 14l4-4"/><path d="M7 17h10"/></svg>`,
    sensors: `<svg ${attrs}><path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/><path d="m6.3 17.7-1.4 1.4"/></svg>`
  };
  return `<span class="metric-icon ${colorClass}">${icons[name] || icons.sensors}</span>`;
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Ошибка запроса");
  return json;
}

async function boot() {
  try {
    const session = await api("/api/session");
    state.user = session.user;
    await loadData();
  } catch {
    state.user = null;
  }
  state.loading = false;
  render();
}

async function loadData() {
  state.data = await api("/api/dashboard");
  if (!state.weather) {
    try { state.weather = await api("/api/weather/astana"); } catch { state.weather = { temp: null, description: "погода недоступна" }; }
  }
}

function loginView(error = "") {
  app.innerHTML = `
    <main class="min-h-screen grid lg:grid-cols-[1fr_520px]">
      <section class="p-6 md:p-12 flex flex-col justify-between">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-2xl bg-accent/20 flex items-center justify-center text-primary">${brandMark()}</div>
          <div>
            <div class="text-2xl font-black text-primary">Smartkóz</div>
            <div class="text-sm uppercase tracking-[.16em] text-muted font-bold">Enterprise Safety</div>
          </div>
        </div>
        <div class="max-w-3xl py-16">
          <p class="text-sm font-black uppercase tracking-[.18em] text-primary mb-5">Промышленный центр безопасности</p>
          <h1 class="text-5xl md:text-7xl font-black tracking-tight leading-[1.02]">Оперативный мониторинг предприятия в реальном времени.</h1>
          <p class="mt-6 text-xl text-muted max-w-2xl">Камеры, датчики воздуха, микрофоны, транспорт, сотрудники, пропускной контроль и инциденты работают в едином контуре Smartkóz.</p>
          <div class="grid sm:grid-cols-3 gap-4 mt-10">
            ${["Активные камеры: 8", "Предупреждений сегодня: 12", "Критических инцидентов: 1"].map((t) => `<div class="glass rounded-2xl p-5 font-bold">${t}</div>`).join("")}
          </div>
        </div>
        <div class="text-sm text-muted">Тестовый контур: manager@smartkoz.kz / admin123 или worker@smartkoz.kz / worker123</div>
      </section>
      <aside class="glass-strong m-4 md:m-8 rounded-[28px] p-6 md:p-8 self-center">
        <div class="mb-8">
          <h2 class="text-3xl font-black">Вход в систему</h2>
          <p class="text-muted mt-2">Без серверного токена доступ к панелям закрыт.</p>
        </div>
        <form id="loginForm" class="space-y-4">
          <label class="block text-sm font-bold">Email<input class="field mt-2" name="email" value="manager@smartkoz.kz" autocomplete="username"></label>
          <label class="block text-sm font-bold">Пароль<input class="field mt-2" name="password" value="admin123" type="password" autocomplete="current-password"></label>
          <div class="grid grid-cols-2 gap-3">
            <button type="button" data-demo="manager" class="btn btn-soft">Руководитель</button>
            <button type="button" data-demo="worker" class="btn btn-soft">Работник</button>
          </div>
          ${error ? `<div class="rounded-xl bg-red-50 border border-red-200 text-danger p-3 text-sm font-bold">${error}</div>` : ""}
          <button class="btn btn-primary w-full" type="submit">${icon("login")} Получить токен и войти</button>
        </form>
      </aside>
    </main>`;

  document.querySelectorAll("[data-demo]").forEach((btn) => btn.addEventListener("click", () => {
    const f = document.querySelector("#loginForm");
    f.email.value = btn.dataset.demo === "manager" ? "manager@smartkoz.kz" : "worker@smartkoz.kz";
    f.password.value = btn.dataset.demo === "manager" ? "admin123" : "worker123";
  }));
  document.querySelector("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      const result = await api("/api/login", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
      state.user = result.user;
      state.page = "overview";
      await loadData();
      render();
    } catch (err) {
      loginView(err.message);
    }
  });
}

function shell() {
  if (!visiblePages().some(([id]) => id === state.page)) state.page = "overview";
  const navPages = visiblePages();
  const activeIncidents = state.data.metrics?.activeIncidents ?? state.data.incidents.filter((i) => i.status !== "closed").length;
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar glass p-5 flex flex-col">
        <div class="flex items-center gap-3 mb-8">
          <div class="w-11 h-11 rounded-2xl bg-accent/20 flex items-center justify-center text-primary">${brandMark()}</div>
          <div><div class="font-black text-primary text-xl">Smartkóz</div><div class="text-xs text-muted font-bold">Industrial Safety</div></div>
        </div>
        <nav class="space-y-1 flex-1 overflow-auto">
          ${navPages.map(([id, ic, label]) => `<button class="nav-link w-full ${state.page === id ? "active" : ""}" data-page="${id}">${icon(ic)}<span>${label}</span>${id === "incidents" ? `<b class="ml-auto text-xs bg-danger text-white px-2 py-1 rounded-full">${activeIncidents}</b>` : ""}</button>`).join("")}
        </nav>
        <div class="pt-5 border-t border-line/40">
          <div class="text-sm font-black">${state.user.name}</div>
          <div class="text-xs text-muted">${roleName(state.user.role)} · ${state.user.zone}</div>
          <button id="logout" class="btn btn-soft w-full mt-4">${icon("logout")} Выйти</button>
        </div>
      </aside>
      <main class="main-canvas">
        <div class="content-frame">
          <header class="glass rounded-[24px] p-5 md:p-6 flex flex-col xl:flex-row xl:items-end justify-between gap-4 mb-6 fade-in">
            <div>
              ${state.page === "overview" ? overviewHeader() : `<h1 class="text-2xl md:text-3xl font-black tracking-tight">${titleForPage()}</h1>`}
            </div>
            <div class="flex gap-3 flex-wrap">
              <button class="btn btn-soft" id="refresh">${icon("sync")} Обновить</button>
              <button class="btn btn-primary" data-page="assistant">${icon("psychology")} Спросить ИИ</button>
            </div>
          </header>
          <section id="content" class="page-panel">${content()}</section>
        </div>
      </main>
      <aside class="right-panel">
        ${rightPanel()}
      </aside>
    </div>`;
  bindShell();
}

function overviewHeader() {
  const w = state.weather;
  return `<div class="overview-weather-head">
    <div>
      <div class="text-sm uppercase tracking-[.14em] font-black text-primary">Добро пожаловать</div>
      <h1>Привет, ${state.user.name.split(" ")[0]}!</h1>
    </div>
    <div class="weather-pill">
      ${icon("partly_cloudy_day")}
      <div><b>${w?.temp !== null && w?.temp !== undefined ? `${w.temp}°C` : "--°C"}</b><span>Астана · ${w?.description || "обновление"}</span></div>
    </div>
  </div>`;
}

function titleForPage() {
  return visiblePages().find(([id]) => id === state.page)?.[2] || "Обзор";
}

function subtitleForPage() {
  const map = {
    overview: "Главный dashboard предприятия: риски, зоны, сотрудники, датчики и критические события.",
    cameras: "Компьютерное зрение: СИЗ, падения, опасные зоны и сближение с техникой.",
    sound: "Анализ микрофонов: крики, удары, сирены и нестандартная работа оборудования.",
    air: "Пыль, дым, CO2 и качество воздуха с предупреждениями для работников.",
    transport: "Въезд, выезд, номера, грузы и честный учет времени на территории.",
    cargo: "Сопоставление камер склада и въезда: контроль вывоза груза и расхождений.",
    employees: "Статусы работников, местоположение, нарушения и пропускной контроль.",
    incidents: "Автоматический журнал происшествий и действия системы.",
    replay: "Временная шкала события для быстрого расследования причин аварии.",
    tasks: "Задачи из базы: руководитель назначает, работник видит и меняет статус.",
    assistant: "ИИ-ассистент отвечает на рабочие вопросы и использует базу Smartkóz как приоритетный контекст."
  };
  return map[state.page];
}

function metric(label, value, hint) {
  return `<div class="metric glass"><div class="metric-title">${label}</div><div class="text-5xl font-black mt-5 relative z-[2]">${value}</div><div class="text-sm text-muted mt-2 relative z-[2]">${hint}</div></div>`;
}

function content() {
  if (!visiblePages().some(([id]) => id === state.page)) state.page = "overview";
  const d = state.data;
  const m = d.metrics;
  if (state.page === "overview") return `
    <div class="grid xl:grid-cols-3 sm:grid-cols-2 gap-5">
      ${metric("Сотрудников на объекте", m.employeesOnSite, "Пропускной контур активен")}
      ${metric("Активные камеры", m.activeCameras, "CV-анализ работает штатно")}
      ${metric("Транспортных средств", m.vehiclesOnSite, "На территории предприятия")}
      ${metric("Уровень пыли", `${m.dustLevel}%`, "Превышение в зоне Склад 4")}
      ${metric("Предупреждений сегодня", m.warningsToday, "Обнаружены системой")}
      ${metric("Критических инцидентов", m.criticalIncidents, "Требуется проверка зоны")}
    </div>
    <div class="grid xl:grid-cols-[1.35fr_.9fr] gap-5 mt-5">
      <div class="glass rounded-2xl p-5 min-h-[420px]">
        <div class="flex justify-between mb-4"><h2 class="text-xl font-black">Карта здания и опасные зоны</h2><span class="text-sm font-bold text-muted">Сектор Альфа-1</span></div>
        ${mapView()}
        <div class="zone-ai-analysis mt-4">
          <div class="flex items-center gap-2 font-black text-primary">${icon("psychology")} AI-анализ зон</div>
          <div id="zoneAiAnalysis" class="text-sm text-muted mt-2">Анализирую события камер и инциденты...</div>
        </div>
      </div>
      <div class="glass rounded-2xl p-5">
        <h2 class="text-xl font-black mb-4">Лента событий</h2>
        ${incidentList(d.incidents.slice(0, 5))}
      </div>
    </div>
    <div class="grid xl:grid-cols-[1fr_1fr] gap-5 mt-5 items-start">
      <div class="glass rounded-2xl p-5">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-black">Динамика риска за смену</h2>
          <span class="text-sm text-muted font-bold">08:00 - 18:00</span>
        </div>
        ${riskChart()}
      </div>
      <div class="glass rounded-2xl p-5">
        <h2 class="text-xl font-black mb-4">Операционные уведомления</h2>
        ${opsFeed()}
      </div>
    </div>`;
  if (state.page === "cameras") return camerasView();
  if (state.page === "sound") return soundView();
  if (state.page === "air") return airView();
  if (state.page === "transport") return transportView();
  if (state.page === "cargo") return cargoControlView();
  if (state.page === "employees") return employeesView();
  if (state.page === "incidents") return incidentsView();
  if (state.page === "replay") return replayView();
  if (state.page === "tasks") return tasksView();
  if (state.page === "assistant") return assistantView();
}

function mapView() {
  return `<div class="industrial-map relative rounded-[26px] overflow-hidden p-4">
    <div class="absolute inset-4 rounded-[22px] border border-white/70 pointer-events-none"></div>
    <div class="zone-card safe-zone left-[18%] top-[22%] w-[56%] h-[42%] p-4">
      <div class="text-sm font-black text-primary">Складской коридор B2</div>
      <div class="text-xs text-muted mt-1">Зона стабильна · активных инцидентов нет</div>
    </div>
    <div class="map-marker left-[42%] top-[42%]"></div>
    <div class="absolute left-6 bottom-6 map-legend-card p-3 text-sm font-bold">
      <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-accent inline-block"></span><span>Нормальная зона</span></div>
    </div>
  </div>`;
}

function riskChart() {
  const values = [18, 22, 24, 31, 29, 42, 37, 45, 39, 34, 37];
  const bars = values.map((v, i) => {
    const x = 18 + i * 34;
    const h = v * 2.1;
    const y = 128 - h;
    const fill = v > 40 ? "var(--danger)" : v > 32 ? "var(--amber)" : "var(--accent-strong)";
    return `<rect x="${x}" y="${y}" width="20" height="${h}" rx="8" fill="${fill}" opacity=".96"></rect>`;
  }).join("");
  const labels = values.map((_, i) => `<text x="${28 + i * 34}" y="152" text-anchor="middle" font-size="9" fill="var(--muted)">${i + 8}:00</text>`).join("");
  return `<div class="w-full overflow-hidden rounded-2xl bg-white/45 border border-white/60 p-3">
    <svg class="w-full block" viewBox="0 0 390 166" preserveAspectRatio="none" role="img" aria-label="Динамика риска за смену">
      <line x1="12" y1="132" x2="378" y2="132" stroke="rgba(163,181,164,.55)" stroke-width="1"></line>
      ${bars}
      ${labels}
    </svg>
  </div>`;
}

function opsFeed() {
  return `<div id="overviewEventLog">${liveEventLogHtml()}</div>`;
}

function dot(kind) {
  const color = kind === "danger" ? "bg-danger" : kind === "warn" ? "bg-warn" : "bg-accent";
  return `<div class="w-5 h-5 rounded-full ${color} pulse ring-4 ring-white shadow-lg"></div>`;
}

function incidentList(items) {
  if (!items.length) return `<div class="soft-card p-5 text-muted font-bold">Журнал пуст. События появятся после обнаружения нарушения камерой.</div>`;
  return `<div class="space-y-3">${items.map((i) => `<div class="soft-card p-4 ${i.severity === "critical" ? "!bg-red-50 !border-red-200" : ""}">
    <div class="flex gap-3"><div>${icon(i.severity === "critical" ? "error" : "warning", i.severity === "critical" ? "text-danger" : "text-warn")}</div><div><div class="font-black">${i.title}</div><div class="text-sm text-muted">${i.zone} · ${i.source} · ${sev[i.severity] || i.severity}</div><div class="text-xs mt-2">${i.action}</div></div></div>
  </div>`).join("")}</div>`;
}

function camerasView() {
  const cameras = {
    outfit: { label: "СИЗ", title: "PPE-CAM 12", subtitle: "Цех сборки #1 · контроль рабочей одежды", status: "YOLOv8 · outfitcheck.pt", badge: "СИЗ / PPE" },
    car1: { label: "КПП 1", title: "GATE-CAM 01", subtitle: "КПП 1 · распознавание номера", status: "YOLOv8 · carsnumber.pt", badge: "Въезд" },
    car2: { label: "КПП 2", title: "GATE-CAM 02", subtitle: "КПП 2 · распознавание номера", status: "YOLOv8 · carsnumber.pt", badge: "Въезд" },
  };
  const current = cameras[state.cameraKind] || cameras.outfit;
  return `<div class="camera-tabs glass rounded-2xl p-3 mb-5">
    ${Object.entries(cameras).map(([kind, cam]) => `<button class="camera-tab ${state.cameraKind === kind ? "active" : ""}" data-camera-kind="${kind}" type="button">${cam.label}</button>`).join("")}
  </div>
  <div class="grid xl:grid-cols-[1fr_340px] gap-5 items-start">
    ${visionPanel(state.cameraKind, current)}
    <div class="glass rounded-2xl p-5">
      <h2 class="text-xl font-black">События камеры</h2>
      <div class="vision-event-list mt-4">
        <div><span>Камера</span><strong>${current.title}</strong></div>
        <div><span>Модель</span><strong>${state.cameraKind === "outfit" ? "outfitcheck.pt" : "carsnumber.pt"}</strong></div>
        <div><span>Зона</span><strong>${current.subtitle.split(" · ")[0]}</strong></div>
        <div><span>Действие</span><strong>${state.cameraKind === "outfit" ? "контроль СИЗ активен" : "ожидание завершения въезда"}</strong></div>
      </div>
    </div>
  </div>`;
}

function soundView() {
  return `<div class="grid xl:grid-cols-[1fr_360px] gap-5 items-start">
    ${visionPanel("fall", { title: "FALL-CAM 03", subtitle: "Зона наблюдения · классы stand / sit / fall", status: "YOLOv8 · falling.pt", badge: "FALL" })}
    <div class="glass rounded-2xl p-5">
      <h2 class="text-xl font-black">Микрофон зоны</h2>
      <p id="micStatus" class="text-muted text-sm mt-1">Ожидание доступа к микрофону</p>
      <div class="mic-meter mt-5"><span id="micMeter"></span></div>
      <div class="flex justify-between mt-3 text-sm font-black"><span>MIC-03</span><span id="micValue">42%</span></div>
      <button class="btn btn-soft w-full mt-4" id="micPermissionBtn" type="button">${icon("mic")} Подключить микрофон</button>
      <div class="sound-bars mt-6">${Array.from({length: 28}, () => `<i></i>`).join("")}</div>
    </div>
  </div>`;
}

function airView() {
  return `<div class="grid gap-5">
    <div id="airDemo" class="air-demo">
      <div class="air-video-card">
        <video id="airDemoVideo"  autoplay muted loop playsinline preload="auto"></video>
        <div id="airOfflineScreen" class="air-offline-screen" aria-hidden="true">
          <div class="air-static"></div>
          <div class="air-offline-copy">
            <span id="airOfflineCam">CAM 02</span>
            <strong>NO SIGNAL</strong>
            <small>LINK LOST</small>
          </div>
        </div>
        <button class="air-cam-arrow air-cam-prev" id="airCamPrev" type="button" aria-label="Предыдущая камера">${icon("chevron_left")}</button>
        <button class="air-cam-arrow air-cam-next" id="airCamNext" type="button" aria-label="Следующая камера">${icon("chevron_right")}</button>
        <div class="air-warning-banner">
          <div class="air-warning-icon">${icon("air")}</div>
          <div>
            <strong id="airAlertTitle">Качество воздуха стабильное</strong>
            <p id="airAlertText">Показатели в пределах нормы. Вентиляция активна, зона доступна для персонала.</p>
          </div>
        </div>
      </div>
      <div class="air-readout-panel">
        <div class="air-status-card glass rounded-2xl p-5">
          <div class="air-status-title">
            <div>
              <h2 class="text-xl font-black">Мониторинг воздуха</h2>
              <p id="airPostLabel" class="text-sm text-muted mt-1">Северная галерея · пост AIR-CAM 04</p>
            </div>
            <span id="airStatusPill" class="air-status-pill">Норма</span>
          </div>
          <p id="airStatusText" class="text-muted mt-4">Пост наблюдения передает видео и телеметрию в реальном времени. Контур оповещения активен.</p>
        </div>
        <div class="air-telemetry-card glass rounded-2xl p-5">
          <div class="air-telemetry-head">
            <h3>Показания датчиков</h3>
            <span id="airUpdated">обновлено сейчас</span>
          </div>
          <div class="air-param-list">
            ${airParam("Пыль PM2.5", "airPmValue", "24 мкг/м3", "airPmMeter", 28)}
            ${airParam("CO2", "airCo2Value", "620 ppm", "airCo2Meter", 30)}
            ${airParam("Дым", "airSmokeValue", "3%", "airSmokeMeter", 12)}
            ${airParam("AQI", "airAqiValue", "42", "airAqiMeter", 24)}
          </div>
        </div>
        <div class="air-event-card glass rounded-2xl p-5">
          <h3>Состояние зоны</h3>
          <div class="air-event-row"><span>Доступ</span><strong id="airAccessValue">разрешен</strong></div>
          <div class="air-event-row"><span>Вентиляция</span><strong id="airVentValue">штатно</strong></div>
          <div class="air-event-row"><span>Оповещение</span><strong id="airNotifyValue">канал готов</strong></div>
        </div>
      </div>
    </div>
  </div>`;
}

function airParam(label, valueId, value, meterId, width) {
  return `<div class="air-param">
    <div class="air-param-main">
      <span>${label}</span>
      <strong id="${valueId}">${value}</strong>
    </div>
    <div class="air-meter-wrap">
      <div class="air-meter"><span id="${meterId}" style="--value:${width}%"></span></div>
      <span id="${meterId}Label">${width}%</span>
    </div>
  </div>`;
}

function transportView() {
  const entries = state.data.vehicleEntries || [];
  const perPage = 4;
  const pages = Math.max(1, Math.ceil(entries.length / perPage));
  state.transportPage = Math.min(Math.max(state.transportPage || 0, 0), pages - 1);
  const visibleEntries = entries.slice(state.transportPage * perPage, state.transportPage * perPage + perPage);
  const groups = visibleEntries.reduce((acc, entry) => {
    const day = String(entry.created_at || "").slice(0, 10) || "Сегодня";
    acc[day] = acc[day] || [];
    acc[day].push(entry);
    return acc;
  }, {});
  const from = entries.length ? state.transportPage * perPage + 1 : 0;
  const to = Math.min(entries.length, (state.transportPage + 1) * perPage);
  return `<div class="grid gap-5">
    <div class="glass rounded-2xl p-5 transport-head">
      <div><h2 class="text-xl font-black">Заезды КПП</h2><p class="text-sm text-muted mt-1">Журнал въезда транспорта на территорию</p></div>
      <div class="transport-actions">
        <button class="btn btn-soft" data-page="cameras">${icon("videocam")} Открыть камеры</button>
        ${state.user?.role === "ADMIN" ? `<button class="btn btn-danger-soft" id="clearGateEntries" type="button">${icon("delete")} Очистить заезды</button>` : ""}
      </div>
    </div>
    ${entries.length ? Object.entries(groups).map(([day, rows]) => `<section class="glass rounded-2xl p-5">
      <h3 class="font-black text-lg mb-4">${day}</h3>
      <div class="gate-entry-list">${rows.map((entry) => gateEntryCard(entry)).join("")}</div>
    </section>`).join("") : `<div class="glass rounded-2xl p-6 text-muted font-bold">Заездов пока нет. Откройте камеру КПП и дождитесь завершения видео.</div>`}
    ${entries.length > perPage ? `<div class="transport-pager glass rounded-2xl p-3">
      <button class="btn btn-soft !px-3" data-transport-dir="-1" ${state.transportPage === 0 ? "disabled" : ""}>${icon("chevron_left")}</button>
      <span>${from}-${to} из ${entries.length}</span>
      <button class="btn btn-soft !px-3" data-transport-dir="1" ${state.transportPage >= pages - 1 ? "disabled" : ""}>${icon("chevron_right")}</button>
    </div>` : ""}
  </div>`;
}

function cargoControlView() {
  return `<div class="cargo-control-shell">
    <div class="cargo-summary glass rounded-2xl p-5">
      <div>
        <div class="cargo-kicker">${icon("inventory_2")} Контур материального контроля</div>
        <h2>Сопоставление груза по двум точкам</h2>
        <p>Складской выезд и въезд на территорию анализируются одновременно. Система фиксирует наличие цемента на первой точке и отсутствие груза на второй.</p>
      </div>
      <div class="cargo-verdict-card">
        <span>Статус проверки</span>
        <strong id="cargoGlobalStatus">наблюдение активно</strong>
      </div>
    </div>
    <div class="cargo-grid">
      ${cargoCameraCard({
        id: "cargoEnter",
        src: "/assets/cargo/TRUCK_ENTERING.mp4",
        label: "CARGO-CAM 01",
        title: "Точка 1 · складской выезд",
        state: "поиск груза",
        note: "Ожидание объекта в зоне контроля.",
        tone: "ok",
      })}
      ${cargoCameraCard({
        id: "cargoOut",
        src: "/assets/cargo/out.mp4",
        label: "CARGO-CAM 02",
        title: "Точка 2 · въездной контур",
        state: "сопоставление",
        note: "Проверяется наличие груза после проезда.",
        tone: "warn",
      })}
    </div>
    <div class="cargo-investigation glass rounded-2xl p-5">
      <div>
        <h3>Материальная проверка</h3>
        <p id="cargoInvestigationText">Система сопоставляет камеры по времени и классу груза.</p>
      </div>
      <div class="cargo-timeline">
        <div><b>01</b><span>выезд со склада</span></div>
        <div><b>02</b><span>сверка на въезде</span></div>
        <div><b>03</b><span>создание проверки</span></div>
      </div>
    </div>
  </div>`;
}

function cargoCameraCard(cam) {
  return `<section class="cargo-camera glass rounded-2xl p-4" data-cargo-camera="${cam.id}">
    <div class="cargo-camera-head">
      <div>
        <span>${cam.label}</span>
        <h3>${cam.title}</h3>
      </div>
      <b class="cargo-state ${cam.tone}" data-cargo-state>${cam.state}</b>
    </div>
    <div class="cargo-stage">
      <video class="cargo-video" src="${cam.src}" muted autoplay loop playsinline preload="auto"></video>
      <canvas class="cargo-canvas"></canvas>
      <div class="cargo-scanline"></div>
    </div>
    <div class="cargo-camera-note" data-cargo-note>${cam.note}</div>
  </section>`;
}

function plateView(plate) {
  const normalized=String(plate).replace(/\s+/g,' ').trim();
  const match=normalized.match(/^(.+)\s(\d{2})$/);
  return `<div class="vehicle-plate" aria-label="Номер автомобиля ${escapeHtml(normalized)}"><div class="vehicle-plate-country"><span>☀</span><b>KZ</b></div><strong>${escapeHtml(match?match[1]:normalized)}</strong>${match?`<em>${escapeHtml(match[2])}</em>`:''}</div>`;
}

function gateEntryCard(entry) {
  return `<div class="gate-entry-card">
    ${plateView(entry.plate)}
    <div>
      <div class="font-black">${entry.driver}</div>
      <div class="text-sm text-muted">${entry.action}</div>
    </div>
    <div class="gate-entry-meta"><strong>${String(entry.created_at || "").slice(11, 16)}</strong><span>${entry.camera}</span></div>
  </div>`;
}

function employeesView() {
  const filters = ["all", "worker", "driver", "safety", "lab", "maintenance"];
  const employees = state.employeeFilter === "all"
    ? state.data.employees
    : state.data.employees.filter((e) => e.category === state.employeeFilter);
  return `<div class="employee-filter-bar glass rounded-2xl p-3 mb-5">
    ${filters.map((filter) => `<button class="employee-filter ${state.employeeFilter === filter ? "active" : ""}" data-employee-filter="${filter}" type="button">${categoryText[filter]}</button>`).join("")}
  </div>
  <div class="grid xl:grid-cols-2 gap-5">${employees.map((e) => {
    const driverActive = e.category === "driver" && e.driver_status === "active_trip";
    const clickable = state.user.role === "ADMIN" && driverActive;
    return `<button class="employee-card glass rounded-2xl p-5 text-left ${clickable ? "is-clickable" : ""}" ${clickable ? `data-employee-id="${e.id}"` : ""}>
      <div class="flex justify-between gap-4">
        <div>
          <div class="text-xl font-black">${e.name}</div>
          <div class="text-muted">${e.position} · ${e.zone}</div>
          <div class="employee-tag-row mt-3">
            <span>${categoryText[e.category] || e.category}</span>
            ${e.category === "driver" ? `<span class="${driverActive ? "danger" : ""}">${driverStatusText[e.driver_status] || e.driver_status}</span>` : ""}
          </div>
        </div>
        ${dot(e.warnings > 2 ? "danger" : e.warnings ? "warn" : "normal")}
      </div>
      <div class="grid grid-cols-3 gap-3 mt-5 text-sm">
        <div class="bg-white/70 rounded-xl p-3"><b>Статус</b><br>${e.status}</div>
        <div class="bg-white/70 rounded-xl p-3"><b>СИЗ</b><br>${e.ppe_status}</div>
        <div class="bg-white/70 rounded-xl p-3"><b>Нарушения</b><br>${e.warnings}</div>
      </div>
      ${e.category === "driver" ? `<div class="employee-card-hint mt-4">${driverActive ? `${icon("visibility")} Открыть мониторинг состояния` : `${icon("do_not_disturb_on")} Камера кабины не активна`}</div>` : ""}
    </button>`;
  }).join("") || `<div class="glass rounded-2xl p-5 text-muted font-bold">В выбранной группе нет сотрудников.</div>`}</div>
  <div id="employeeVisionModal" class="vision-modal" aria-hidden="true"></div>`;
}

function visionPanel(kind, meta) {
  return `<div class="vision-panel glass rounded-2xl p-5" data-vision-kind="${kind}" ${meta.employeeId ? `data-vision-employee-id="${meta.employeeId}"` : ""}>
    <div class="vision-head">
      <div>
        <h2>${meta.title}</h2>
        <p>${meta.subtitle}</p>
      </div>
      <span>${meta.badge}</span>
    </div>
    <div class="vision-stage">
      <video class="vision-video" muted autoplay loop playsinline preload="auto"></video>
      <canvas class="vision-canvas"></canvas>
      <div class="vision-loader">
        <strong>Подготовка видеоаналитики</strong>
        <p>Загрузка модели и расчет координат объектов</p>
      </div>
    </div>
    <div class="vision-foot">
      <span class="vision-status">${meta.status}</span>
      <span class="vision-count">0 объектов</span>
    </div>
    ${kind === "dream" ? `<div class="vision-violation-strip">${icon("warning")} Нарушений за просмотр: <strong class="vision-violation-count">0</strong></div>` : ""}
  </div>`;
}

function visionObjectText(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return I18n.translate(`${count} объект`);
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return I18n.translate(`${count} объекта`);
  return I18n.translate(`${count} объектов`);
}

function incidentsView() {
  const pageSize = 3;
  const items = state.data.incidents || [];
  const pagesCount = Math.max(1, Math.ceil(items.length / pageSize));
  state.incidentPage = Math.min(state.incidentPage, pagesCount - 1);
  const slice = items.slice(state.incidentPage * pageSize, state.incidentPage * pageSize + pageSize);
  return `<div class="grid xl:grid-cols-[1fr_420px] gap-5 items-start">
    <div class="glass rounded-2xl p-5">
      <div class="flex items-center justify-between gap-3 mb-4">
        <h2 class="text-xl font-black">Инциденты и Replay</h2>
        <div class="flex gap-2">
          <button class="btn btn-soft !px-3" data-incident-dir="-1">${icon("chevron_left")}</button>
          <button class="btn btn-soft !px-3" data-incident-dir="1">${icon("chevron_right")}</button>
        </div>
      </div>
      ${incidentList(slice)}
      <div class="text-sm text-muted font-bold mt-4">Страница ${state.incidentPage + 1} из ${pagesCount}</div>
    </div>
    <div class="glass rounded-2xl p-5">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-xl font-black">AI Replay за сегодня</h2>
        <button class="btn btn-soft !px-3" id="downloadReplayReport" type="button">${icon("download")} PDF</button>
      </div>
      <div id="replayReport" class="ai-report mt-4"><div class="chat-loading">ИИ анализирует сегодняшние события...</div></div>
    </div>
  </div>`;
}

function incidentForm() {
  return `<form id="incidentForm" class="glass rounded-2xl p-5 space-y-3"><h2 class="font-black text-xl">Создать инцидент</h2><input class="field" name="title" placeholder="Название"><input class="field" name="source" placeholder="Источник: камера/датчик"><input class="field" name="zone" placeholder="Зона"><select class="field" name="severity"><option value="warning">Внимание</option><option value="critical">Критично</option><option value="medium">Средне</option></select><input class="field" name="action" placeholder="Действие системы"><button class="btn btn-primary w-full">${icon("add")} Добавить</button></form>`;
}

function replayView() {
  const steps = state.data.incidents.slice(0, 8);
  return `<div class="glass rounded-2xl p-6"><h2 class="text-xl font-black mb-5">AI Incident Replay</h2>${steps.length ? `<div class="space-y-4">${steps.map((s) => `<div class="flex gap-4"><div class="w-24 font-black text-primary">${String(s.created_at || "").slice(11, 19) || "--:--"}</div><div class="w-3 h-3 rounded-full bg-accent mt-1.5 ${s.severity === "critical" ? "bg-danger" : ""}"></div><div><div class="font-semibold">${s.title}</div><div class="text-sm text-muted">${s.zone} · ${s.source}</div></div></div>`).join("")}</div>` : `<div class="soft-card p-5 text-muted font-bold">Нет событий для восстановления таймлайна.</div>`}</div>`;
}

function tasksView() {
  const d = state.data;
  const tasks = state.taskFilter === "all" ? d.tasks : d.tasks.filter((t) => t.status === state.taskFilter);
  const reviewTasks = d.tasks.filter((t) => t.status === "done");
  return `<div class="grid xl:grid-cols-[1fr_390px] gap-5 items-start">
    <div class="glass rounded-2xl p-5">
      ${state.user.role === "ADMIN" ? `<div class="task-mode-bar mb-4">
        <button class="employee-filter ${state.taskMode === "tasks" ? "active" : ""}" data-task-mode="tasks" type="button">Задания</button>
        <button class="employee-filter ${state.taskMode === "review" ? "active" : ""}" data-task-mode="review" type="button">Проверка выполнения</button>
      </div>` : ""}
      <div class="task-filter-bar mb-4">
        ${["all","new","in_progress","done"].map((f) => `<button class="employee-filter ${state.taskFilter === f ? "active" : ""}" data-task-filter="${f}" type="button">${f === "all" ? "Все" : statusText[f]}</button>`).join("")}
      </div>
      <div class="task-board">${(state.taskMode === "review" ? reviewTasks.map(reviewTaskCard) : tasks.map(taskCard)).join("") || `<div class="soft-card p-5 text-muted font-bold">Заданий в выбранном разделе нет.</div>`}</div>
    </div>
    <div class="grid gap-5">
      ${state.user.role === "ADMIN" ? taskForm() : workerPassPanel()}
      <div class="glass rounded-2xl p-5">
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-black text-xl">AI-отчет</h2>
          ${state.user.role === "ADMIN" ? `<button class="btn btn-primary" id="taskReportBtn" type="button">${icon("summarize")} Отчет</button>` : ""}
        </div>
        <div id="taskReportBox" class="task-report-box mt-4">${state.taskReport ? formatCompactAssistantAnswer(state.taskReport) : "Нажмите «Отчет», чтобы проанализировать выполнение задач."}</div>
      </div>
    </div>
  </div>
  <div id="taskReportModal" class="vision-modal" aria-hidden="true"></div>`;
}

function taskCard(t) {
  return `<div class="task-card ${t.status}">
    <div>
      <div class="task-card-head"><strong>${t.title}</strong><span>${statusText[t.status]}</span></div>
      <p>${t.description}</p>
      <small>Исполнитель: ${t.assigned_name} · до ${t.due_at} · проверка: ${approvalText(t.approval_status)}</small>
    </div>
    <select class="field" data-task="${t.id}">
      <option value="new" ${t.status === "new" ? "selected" : ""}>Новое</option>
      <option value="in_progress" ${t.status === "in_progress" ? "selected" : ""}>В работе</option>
      <option value="done" ${t.status === "done" ? "selected" : ""}>Готово</option>
    </select>
  </div>`;
}

function approvalText(value) {
  return value === "approved" ? "одобрено" : value === "rejected" ? "не одобрено" : "ожидает";
}

function reviewTaskCard(t) {
  return `<div class="task-card ${t.status}">
    <div>
      <div class="task-card-head"><strong>${t.title}</strong><span>${approvalText(t.approval_status)}</span></div>
      <p>${t.description}</p>
      <small>Исполнитель: ${t.assigned_name} · выполнено к ${t.due_at}</small>
    </div>
    <div class="review-actions">
      <button class="btn btn-primary" data-task-approval="${t.id}" data-approval-status="approved" type="button">${icon("check")} Одобрено</button>
      <button class="btn btn-soft" data-task-approval="${t.id}" data-approval-status="rejected" type="button">${icon("close")} Не одобрено</button>
    </div>
  </div>`;
}

function taskForm() {
  return `<form id="taskForm" class="glass rounded-2xl p-5 space-y-3"><h2 class="font-black text-xl">Назначить сотруднику</h2><input class="field" name="title" placeholder="Задача" required><textarea class="field" name="description" placeholder="Описание" required></textarea><select class="field" name="assigned_to" required><option value="">Выберите сотрудника</option>${state.data.employees.map(e => `<option value="${e.user_id}">${escapeHtml(e.name)}</option>`).join("")}</select><select class="field" name="priority"><option value="high">Высокий</option><option value="medium">Средний</option><option value="low">Низкий</option></select><button class="btn btn-primary w-full">${icon("send")} Назначить</button></form>`;
}

function workerPassPanel() {
  return `<div class="glass rounded-2xl p-5"><h2 class="font-black text-xl">Пропускной статус</h2><p class="text-muted mt-2">Камера КПП подтверждает рабочую одежду и СИЗ. Если проверка не пройдет, доступ будет запрещен и появится инцидент.</p><div class="mt-5 rounded-2xl bg-[#eef6f8] border border-[#d3e6ec] p-4 font-black text-[#467f92]">${icon("verified")} Доступ разрешен</div></div>`;
}

function assistantView() {
  const promptText = state.user.role === "ADMIN"
    ? "Задайте вопрос по смене, инцидентам, заездам КПП, задачам или состоянию сотрудников."
    : "Задайте вопрос по личным заданиям, правилам безопасности или действиям при тревоге.";
  return `<div class="grid xl:grid-cols-[1fr_360px] gap-5 items-start">
    <div class="glass rounded-[26px] p-5">
      <div id="chatLog" class="min-h-[420px] space-y-4 report">
        <div class="ai-report">
          <section class="ai-section">
            <h3>Готов к отчету</h3>
            <p>${promptText}</p>
          </section>
        </div>
      </div>
      <form id="assistantForm" class="flex gap-3 mt-4">
        <input class="field" name="question" placeholder="Спросите ИИ о безопасности, смене или любом вопросе">
        <button class="btn btn-primary" aria-label="Отправить">${icon("send")}</button>
      </form>
    </div>
    <div class="glass rounded-[26px] p-5">
      <h2 class="font-black text-xl">Контекст для ИИ</h2>
      <p class="text-muted mt-2">По вопросам Smartkóz ассистент использует SQLite: сотрудники, датчики, транспорт, задачи и инциденты, доступные вашей роли. На общие вопросы отвечает без привязки к базе.</p>
      <div class="grid gap-3 mt-5">
        <div class="soft-card p-4"><b>Формат</b><p class="text-sm text-muted mt-1">Сводка, данные, рекомендации, срочность.</p></div>
        <div class="soft-card p-4"><b>Источник</b><p class="text-sm text-muted mt-1">База Smartkóz для фактов системы и общие знания для справочных вопросов.</p></div>
      </div>
    </div>
  </div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
}

function inlineReportText(value) {
  return escapeHtml(String(value).replace(/\\([*_`#])/g,'$1'))
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/__([^_]+)__/g,'<strong>$1</strong>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*([^*]+)\*/g,'<em>$1</em>')
    .replace(/\*\*|__/g,'');
}
function cleanHeading(line) {
  return line.replace(/^#{1,6}\s*/, '').replace(/\*\*|__/g, '').replace(/:$/, '').trim();
}
function isReportHeading(line) {
  if(/^#{1,6}\s+/.test(line))return true;
  if(line.length<=120&&/^(\*\*|__)(.+)\1:?$/.test(line))return true;
  return ['сводка','данные из базы','данные smartkóz','сведения smartkóz','рекомендации','срочность','статус','риски','действия','вывод','факты','summary','findings','facts','recommendations','priority','status','risks','actions','conclusion','қысқаша шолу','қорытынды','ұсынымдар','ұсыныстар','деректер','тәуекелдер','әрекеттер'].includes(cleanHeading(line).toLowerCase());
}
function formatAssistantAnswer(raw) {
  const lines=String(raw||'').replace(/\\([*_`#])/g,'$1').replace(/\r/g,'').split('\n').map(line=>line.trim()).filter(Boolean);
  const sections=[];let current={title:'',body:[]};
  for(const line of lines){
    if(/^[-*_]{3,}$/.test(line))continue;
    if(isReportHeading(line)){
      if(current.body.length||current.title)sections.push(current);
      current={title:cleanHeading(line),body:[]};
    }else current.body.push(line);
  }
  if(current.body.length||current.title||!sections.length)sections.push(current);
  function bodyHtml(lines){
    const output=[];let type=null,items=[];
    function flush(){if(type)output.push(`<${type}>${items.map(text=>`<li>${inlineReportText(text)}</li>`).join('')}</${type}>`);type=null;items=[];}
    for(const line of lines){
      const bullet=line.match(/^[-*•]\s+(.+)$/),numbered=line.match(/^\d+[.)]\s+(.+)$/);
      const next=bullet?'ul':numbered?'ol':null;
      if(next){if(type!==next)flush();type=next;items.push((bullet||numbered)[1]);}
      else{flush();output.push(`<p>${inlineReportText(line.replace(/^>\s?/,''))}</p>`);}
    }flush();return output.join('');
  }
  return `<div class="ai-report">${sections.map(section=>`<section class="ai-section">${section.title?`<h3>${escapeHtml(section.title)}</h3>`:''}${bodyHtml(section.body)}</section>`).join('')}</div>`;
}

function formatCompactAssistantAnswer(raw) {
  return String(raw || "")
    .replace(/\r/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((line) => inlineReportText(line))
    .join("<br>");
}

function sensorRow(id, zone, text, status) {
  return `<div class="flex items-center justify-between gap-4 p-4 rounded-2xl bg-white/70 border border-line/40 mb-3"><div><div class="font-black">${id}</div><div class="text-sm text-muted">${zone}</div></div><div class="font-bold">${text}</div>${dot(status === "normal" ? "normal" : "warn")}</div>`;
}

function rightPanel() {
  const d = state.data;
  const riskSensors = d.sensors.filter((s) => s.status !== "normal");
  return `<div class="help-panel-card glass-strong rounded-3xl p-5">
    <div class="flex items-center gap-3 mb-5">${icon("support_agent", "text-primary text-3xl")}<div><div class="font-black text-xl">Панель помощи</div><div class="text-sm text-muted">${roleName(state.user.role)}</div></div></div>
    <div class="help-section-stack">
      <section class="help-section"><b>Фокус смены</b><div class="help-inner"><p>${state.user.role === "ADMIN" ? "Закрыть критические инциденты и распределить задачи." : "Проверить личные задания и соблюдать СИЗ."}</p></div></section>
      <section class="help-section"><b>Риски воздуха</b><div class="help-inner"><p>${riskSensors.map((s) => `${s.type}: ${s.value}${s.unit}`).join(", ") || "Все показатели в норме"}</p></div></section>
      <section class="help-section"><b>Логи камер</b><div class="help-inner" id="liveEventLog">${liveEventLogHtml()}</div></section>
      <section class="help-section"><b>Быстрые действия</b><div class="help-inner grid gap-2"><button class="btn btn-primary" id="helpChatOpen" type="button">${icon("psychology")} Чат ИИ</button><button class="btn btn-soft" data-page="tasks">${icon("assignment")} Задания</button></div></section>
    </div>
  </div>
  <div class="help-chat-drawer" aria-hidden="true">
    <div class="help-chat-head">
      <div>
        <div class="font-black text-xl text-primary">Smartkóz</div>
        <div class="text-sm text-muted">Оперативный помощник смены</div>
      </div>
      <button class="btn btn-soft !min-h-[38px]" id="helpChatClose" type="button" aria-label="Закрыть">${icon("close")}</button>
    </div>
    <div id="helpChatLog" class="help-chat-log">
      <div class="help-msg ai"><strong>Готов к запросу.</strong><br>Могу объяснить риски Smartkóz по базе или ответить на общий вопрос.</div>
    </div>
    <form id="helpAssistantForm" class="help-chat-form">
      <input class="field" name="question" placeholder="Спросить ИИ">
      <button class="btn btn-primary" type="submit" aria-label="Отправить">${icon("send")}</button>
    </form>
  </div>`;
}

function liveEventLogHtml() {
  const items = state.data?.incidents?.slice(0, 4) || [];
  if (!items.length) return `<div class="text-sm text-muted font-bold">Нарушений с камер пока нет.</div>`;
  return `<div class="live-log-list">${items.map((event) => `<div class="live-log-item ${event.severity === "critical" ? "danger" : ""}">
    <strong>${event.title}</strong>
    <span>${String(event.created_at || "").slice(11, 16) || "--:--"} · ${event.source}</span>
  </div>`).join("")}</div>`;
}

function bindShell() {
  document.querySelectorAll("[data-page]").forEach((btn) => btn.addEventListener("click", async () => {
    if (state.page === btn.dataset.page) return;
    state.page = btn.dataset.page;
    render();
  }));
  document.querySelector("#logout")?.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    state.user = null;
    state.data = null;
    render();
  });
  document.querySelector("#refresh")?.addEventListener("click", async () => {
    await loadData();
    render();
  });
  document.querySelector("#taskForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await api("/api/tasks", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) });
    await loadData();
    render();
  });
  document.querySelectorAll("[data-task]").forEach((sel) => sel.addEventListener("change", async () => {
    await api(`/api/tasks/${sel.dataset.task}`, { method: "PATCH", body: JSON.stringify({ status: sel.value }) });
    await loadData();
    render();
  }));
  document.querySelector("#incidentForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await api("/api/incidents", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) });
    await loadData();
    render();
  });
  document.querySelector("#helpChatOpen")?.addEventListener("click", () => {
    document.querySelector(".right-panel")?.classList.add("chat-open");
  });
  document.querySelector("#helpChatClose")?.addEventListener("click", () => {
    document.querySelector(".right-panel")?.classList.remove("chat-open");
  });
  document.querySelector("#helpAssistantForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = e.currentTarget.question;
    const q = input.value.trim();
    if (!q) return;
    const log = document.querySelector("#helpChatLog");
    log.insertAdjacentHTML("beforeend", `<div class="help-msg user">${escapeHtml(q)}</div><div class="help-msg loading">ИИ анализирует запрос и контекст Smartkóz...</div>`);
    input.value = "";
    log.scrollTop = log.scrollHeight;
    try {
      const res = await api("/api/assistant", { method: "POST", body: JSON.stringify({ question: q }) });
      log.lastElementChild.outerHTML = `<div class="help-msg ai">${formatCompactAssistantAnswer(res.answer)}</div>`;
    } catch (error) {
      log.lastElementChild.outerHTML = `<div class="help-msg ai"><strong>Ошибка.</strong><br>${escapeHtml(error.message)}</div>`;
    }
    log.scrollTop = log.scrollHeight;
  });
  setupAirDemo();
  setupSoundMonitor();
  setupVisionPanels();
  setupCargoControl();
  bindCameraTabs();
  bindEmployeeFilters();
  bindEmployeeCards();
  bindIncidentPager();
  bindTransportTools();
  loadReplayReport();
  bindReplayDownload();
  bindTaskTools();
  loadZoneAnalysis();
  document.querySelector("#assistantForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = e.currentTarget.question;
    const q = input.value.trim();
    if (!q) return;
    const log = document.querySelector("#chatLog");
    log.insertAdjacentHTML("beforeend", `<div class="chat-user">${escapeHtml(q)}</div><div class="chat-loading">Формирую структурированный ответ...</div>`);
    input.value = "";
    const res = await api("/api/assistant", { method: "POST", body: JSON.stringify({ question: q }) });
    log.lastElementChild.outerHTML = formatAssistantAnswer(res.answer);
  });
}

function setupVisionPanels() {
  document.querySelectorAll("[data-vision-kind]").forEach((panel) => loadVisionPanel(panel, panel.dataset.visionKind));
}

function setupCargoControl() {
  document.querySelectorAll("[data-cargo-camera]").forEach((panel) => initCargoCamera(panel));
}

function bindCameraTabs() {
  document.querySelectorAll("[data-camera-kind]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.cameraKind = btn.dataset.cameraKind;
      render();
    });
  });
}

function bindIncidentPager() {
  document.querySelectorAll("[data-incident-dir]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const count = Math.max(1, Math.ceil((state.data.incidents || []).length / 3));
      state.incidentPage = (state.incidentPage + Number(btn.dataset.incidentDir) + count) % count;
      render();
    });
  });
}

function bindTransportTools() {
  document.querySelectorAll("[data-transport-dir]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const count = Math.max(1, Math.ceil((state.data.vehicleEntries || []).length / 4));
      state.transportPage = Math.min(Math.max((state.transportPage || 0) + Number(btn.dataset.transportDir), 0), count - 1);
      render();
    });
  });
  document.querySelector("#clearGateEntries")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const res = await api("/api/gate-events", { method: "DELETE" });
      state.data = res.data;
      state.transportPage = 0;
      showSafetyToast({ title: "Журнал КПП очищен", text: "Записи заездов удалены из базы.", tone: "ok" });
      render();
    } catch (error) {
      showSafetyToast({ title: "Ошибка очистки", text: error.message, tone: "danger" });
      btn.disabled = false;
    }
  });
}

function bindTaskTools() {
  document.querySelectorAll("[data-task-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.taskFilter = btn.dataset.taskFilter;
      render();
    });
  });
  document.querySelectorAll("[data-task-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.taskMode = btn.dataset.taskMode;
      render();
    });
  });
  document.querySelectorAll("[data-task-approval]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const res = await api(`/api/tasks/${btn.dataset.taskApproval}/approval`, {
        method: "PATCH",
        body: JSON.stringify({ approval_status: btn.dataset.approvalStatus }),
      });
      if (res.data) state.data = res.data;
      render();
    });
  });
  document.querySelector("#taskReportBtn")?.addEventListener("click", async () => {
    const box = document.querySelector("#taskReportBox");
    if (box) box.innerHTML = `<div class="chat-loading">ИИ анализирует задачи...</div>`;
    const res = await api("/api/tasks/report");
    state.taskReport = res.answer;
    if (box) box.innerHTML = formatCompactAssistantAnswer(res.answer);
    openTaskReportModal(res.answer);
  });
}

function openTaskReportModal(answer) {
  const modal = document.querySelector("#taskReportModal");
  if (!modal) return;
  modal.innerHTML = `<div class="vision-modal-backdrop" data-close-task-report></div>
    <div class="report-modal-card">
      <div class="vision-modal-head no-print">
        <div><h2>Отчет по заданиям</h2><p>Smartkóz · ${new Date().toLocaleString("ru-RU")}</p></div>
        <div class="flex gap-2"><button class="btn btn-primary" id="downloadTaskReport" type="button">${icon("download")} Скачать PDF</button><button class="btn btn-soft" data-close-task-report>${icon("close")} Закрыть</button></div>
      </div>
      <article class="a4-report">${formatAssistantAnswer(answer)}</article>
    </div>`;
  modal.classList.add("open");
  modal.querySelectorAll("[data-close-task-report]").forEach((el) => el.addEventListener("click", () => {
    modal.classList.remove("open");
    modal.innerHTML = "";
  }));
  modal.querySelector("#downloadTaskReport")?.addEventListener("click", () => downloadReportPdf("Отчет по заданиям", answer));
}

async function downloadReportPdf(title, text) {
  const response = await fetch("/api/reports/pdf", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, text }),
  });
  if (!response.ok) throw new Error("PDF не сформирован");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.replace(/[\\/:*?"<>|]/g, "_")}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function loadReplayReport() {
  const box = document.querySelector("#replayReport");
  if (!box) return;
  try {
    const res = await api("/api/replay/today");
    state.replayReport = res.answer;
    box.innerHTML = formatAssistantAnswer(res.answer);
  } catch (error) {
    box.innerHTML = `<div class="chat-loading">${escapeHtml(error.message)}</div>`;
  }
}

function bindReplayDownload() {
  document.querySelector("#downloadReplayReport")?.addEventListener("click", () => {
    if (state.replayReport) downloadReportPdf("AI Replay за сегодня", state.replayReport);
  });
}

async function loadZoneAnalysis() {
  const box = document.querySelector("#zoneAiAnalysis");
  if (!box) return;
  try {
    const res = await api("/api/zones/analysis");
    box.innerHTML = formatCompactAssistantAnswer(res.answer);
  } catch (error) {
    box.textContent = error.message;
  }
}

function setupSoundMonitor() {
  const meter = document.querySelector("#micMeter");
  const value = document.querySelector("#micValue");
  const status = document.querySelector("#micStatus");
  const button = document.querySelector("#micPermissionBtn");
  if (!meter || !value) return;
  let triggered = false;
  let loudStart = null;

  const stop = () => {
    state.soundStream?.getTracks().forEach((track) => track.stop());
    state.soundStream = null;
    if (state.soundAudioContext) state.soundAudioContext.close().catch(() => {});
    state.soundAudioContext = null;
  };

  const start = async () => {
    try {
      stop();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } });
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContext();
      if (audioContext.state === "suspended") await audioContext.resume();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      state.soundStream = stream;
      state.soundAudioContext = audioContext;
      if (status) status.textContent = "Микрофон активен";
      if (button) button.textContent = "Микрофон подключен";

      const draw = () => {
        if (state.page !== "sound" || !meter.isConnected) {
          stop();
          return;
        }
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        let peak = 0;
        for (const sample of data) {
          const centered = (sample - 128) / 128;
          sum += centered * centered;
          peak = Math.max(peak, Math.abs(centered));
        }
        const rms = Math.sqrt(sum / data.length);
        const level = Math.min(100, Math.round(Math.max(rms * 1200, peak * 180)));
        meter.style.width = `${level}%`;
        value.textContent = `${level}%`;
        meter.classList.toggle("danger", level >= 90);
        document.querySelectorAll(".sound-bars i").forEach((bar, index) => {
          const height = Math.max(12, Math.min(100, level * (0.45 + ((index % 7) / 10))));
          bar.style.height = `${height}%`;
        });
        const now = performance.now();
        if (level >= 90) {
          loudStart = loudStart || now;
          if (!triggered && now - loudStart > 260) {
            triggered = true;
            showSafetyToast({ title: "Резкий звук в зоне", text: "Микрофон зафиксировал пик выше 90%. Возможен крик или падение.", tone: "danger" });
            recordVisionEvent({
              key: `sound-${Date.now()}`,
              title: "Аварийный звук",
              source: "MIC-03",
              zone: "Зона наблюдения",
              severity: "warning",
              action: "Микрофон зафиксировал резкий звук выше 90%.",
            });
          }
        } else {
          loudStart = null;
        }
        requestAnimationFrame(draw);
      };
      draw();
    } catch (error) {
      if (status) status.textContent = "Микрофон недоступен: разрешите доступ в браузере";
      if (button) button.textContent = "Повторить подключение";
    }
  };

  button?.addEventListener("click", start);
  if (navigator.mediaDevices?.getUserMedia) start();
  else if (status) status.textContent = "Браузер не поддерживает доступ к микрофону";
}

function bindEmployeeCards() {
  document.querySelectorAll("[data-employee-id]").forEach((card) => {
    card.addEventListener("click", () => {
      const employee = state.data.employees.find((item) => String(item.id) === String(card.dataset.employeeId));
      if (employee) openEmployeeVision(employee);
    });
  });
}

function bindEmployeeFilters() {
  document.querySelectorAll("[data-employee-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.employeeFilter = btn.dataset.employeeFilter;
      render();
    });
  });
}

function openEmployeeVision(employee) {
  if (state.user.role !== "ADMIN") return;
  const modal = document.querySelector("#employeeVisionModal");
  if (!modal) return;
  modal.innerHTML = `<div class="vision-modal-backdrop" data-close-vision></div>
    <div class="vision-modal-card">
      <div class="vision-modal-head">
        <div>
          <div class="text-sm uppercase font-black text-primary tracking-[.14em]">DRIVER-CAM 02</div>
          <h2>${employee.name}</h2>
          <p>${employee.position} · ${employee.zone} · нарушений: ${employee.warnings}</p>
        </div>
        <button class="btn btn-soft" type="button" data-close-vision>${icon("close")} Закрыть</button>
      </div>
      ${visionPanel("dream", {
        title: "Контроль состояния водителя",
        subtitle: "Кабина транспорта · анализ взгляда и микросна",
        status: "YOLOv8 · dreameye.pt",
        badge: "DREAM EYE",
        employeeId: employee.id,
      })}
    </div>`;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  modal.querySelectorAll("[data-close-vision]").forEach((el) => el.addEventListener("click", closeEmployeeVision));
  setupVisionPanels();
}

function closeEmployeeVision() {
  const modal = document.querySelector("#employeeVisionModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML = "";
}

async function loadVisionPanel(panel, kind) {
  if (panel.dataset.loaded === "true") return;
  panel.dataset.loaded = "true";
  const loader = panel.querySelector(".vision-loader");
  const status = panel.querySelector(".vision-status");
  const count = panel.querySelector(".vision-count");

  const setLoading = (text) => {
    if (loader) loader.classList.remove("hidden");
    if (loader) loader.querySelector("p").textContent = text;
    if (status) status.textContent = text;
  };

  try {
    setLoading("Подготовка видео");
    let payload = state.visionCache[kind];
    while (!payload || payload.status !== "ready") {
      payload = await api(`/api/vision/${kind}`);
      if (payload.status === "ready") break;
      const progress = payload.total ? `${payload.progress}/${payload.total}` : "очередь обработки";
      setLoading(`анализ кадров: ${progress}`);
      await new Promise((resolve) => setTimeout(resolve, 1400));
    }
    state.visionCache[kind] = payload;
    renderVisionOverlay(panel, payload, kind);
    if (loader) loader.classList.add("hidden");
    if (status) status.textContent = "Наблюдение активно";
    if (count) count.textContent = visionObjectText(0);
  } catch (error) {
    if (loader) loader.querySelector("p").textContent = error.message;
    if (status) status.textContent = "ошибка видеоаналитики";
  }
}

function renderVisionOverlay(panel, payload, kind) {
  const video = panel.querySelector(".vision-video");
  const canvas = panel.querySelector(".vision-canvas");
  const count = panel.querySelector(".vision-count");
  const ctx = canvas.getContext("2d");
  const meta = payload.detections.video;
  const frames = payload.detections.frames;
  const sleepState = { closeStart: null, lastClosed: null, triggered: false, lastTime: 0, restarting: false };
  const ppeState = { riskStart: null, triggered: false, lastTime: 0 };
  const fallState = { triggered: false, lastTime: 0, fallStart: null, lastFall: null };
  const gateState = { triggered: false, visibleSeconds:0, lastTime:null,lastWall:null };
  canvas.width = meta.width;
  canvas.height = meta.height;
  video.src = payload.video;

  const draw = () => {
    if (!panel.isConnected) return;
    const frameIndex = Math.min(frames.length - 1, Math.max(0, Math.round(video.currentTime * meta.fps)));
    const frame = frames[frameIndex] || { detections: [] };
    let detections = kind === "outfit" ? enhancePpeDetections(frame.detections) : frame.detections;
    if (kind === "car1" || kind === "car2") detections = detections.map((det) => ({ ...det, label: payload.plate || "Номер не прочитан", risk: true }));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    detections.forEach((det) => drawDetection(ctx, det));
    if (kind === "dream") detectMicrosleep(panel, video, frame, sleepState);
    if (kind === "outfit") detectPpeViolation(panel, video, detections, ppeState);
    if (kind === "fall") detectFallEvent(panel, video, detections, fallState);
    if(kind==='car1'||kind==='car2'){
      const t=video.currentTime,wall=performance.now(),delta=gateState.lastTime===null?0:t-gateState.lastTime;
      const elapsed=gateState.lastWall===null?0:(wall-gateState.lastWall)/1000;
      if(delta<0||delta>.3||elapsed>.3||!detections.length||video.paused||video.seeking)gateState.visibleSeconds=0;
      else if(delta>0)gateState.visibleSeconds+=elapsed;
      gateState.lastTime=t;gateState.lastWall=wall;
      const progress=document.querySelector('#gateProgress'),label=document.querySelector('#gateObservation');
      if(progress)progress.value=gateState.visibleSeconds;
      if(label)label.textContent=detections.length?`${payload.plate||'Номер'} · ${Math.min(3,gateState.visibleSeconds).toFixed(1)} / 3 с`:'Ожидание номера';
      if(detections.length&&gateState.visibleSeconds>=3&&!video.paused)registerGateEntry(kind,payload,gateState);
    }
    if (count) { const label=visionObjectText(detections.length);if(count.textContent!==label)count.textContent=label; }
    requestAnimationFrame(draw);
  };

  video.addEventListener("loadedmetadata", () => {
    video.play().catch(() => {});
    requestAnimationFrame(draw);
  }, { once: true });
  if (kind === "car1" || kind === "car2") {

    video.loop = false;
  }
}

async function registerGateEntry(kind, payload, gateState) {
  if (gateState.triggered) return;
  gateState.triggered = true;
  try {
    const res = await api("/api/gate-events", { method: "POST", body: JSON.stringify({ kind }) });
    if (res.data) state.data = res.data;
    showSafetyToast({ title: "Заезд зарегистрирован", text: `${payload.plate} · ${payload.driver} · ${payload.cargo}`, tone: "success" });
    setTimeout(() => {
      state.page = "transport";
      render();
    }, 900);
  } catch (error) {
    showSafetyToast({ title: "Заезд не записан", text: error.message, tone: "danger" });
  }
}

function centerOf(box) {
  return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
}

function pointInBox(point, box) {
  return point[0] >= box[0] && point[0] <= box[2] && point[1] >= box[1] && point[1] <= box[3];
}

function ppeInsidePerson(item, person, zone = "full") {
  const [cx, cy] = centerOf(item.box);
  const [x1, y1, x2, y2] = person.box;
  const height = y2 - y1;
  let area = [x1, y1, x2, y2];
  if (zone === "head") area = [x1, y1, x2, y1 + height * 0.48];
  if (zone === "body") area = [x1, y1 + height * 0.18, x2, y1 + height * 0.9];
  return pointInBox([cx, cy], area);
}

function enhancePpeDetections(detections) {
  const people = detections.filter((det) => det.label === "person" && det.box);
  const helmets = detections.filter((det) => det.label === "helmet" && det.box);
  const vests = detections.filter((det) => det.label === "vest" && det.box);

  const peopleWithRisk = people.map((person) => {
    const hasHelmet = helmets.some((helmet) => ppeInsidePerson(helmet, person, "head"));
    const hasVest = vests.some((vest) => ppeInsidePerson(vest, person, "body"));
    const risk = !hasHelmet || !hasVest;
    return {
      ...person,
      risk,
      label: risk ? "человек без СИЗ" : "person",
      missing: { helmet: !hasHelmet, vest: !hasVest },
    };
  });

  const peopleSet = new Set(people);
  return [
    ...detections.filter((det) => !peopleSet.has(det)),
    ...peopleWithRisk,
  ];
}

function detectPpeViolation(panel, video, detections, ppeState) {
  const time = video.currentTime || 0;
  if (time < ppeState.lastTime - 0.25) {
    ppeState.riskStart = null;
    ppeState.triggered = false;
  }
  ppeState.lastTime = time;

  const riskPerson = detections.find((det) => det.risk);
  if (!riskPerson) {
    ppeState.riskStart = null;
    return;
  }
  if (ppeState.riskStart === null) ppeState.riskStart = time;
  if (!ppeState.triggered && time - ppeState.riskStart >= 0.5) {
    ppeState.triggered = true;
    showSafetyToast({
      title: "Нарушение СИЗ",
      text: "На территории обнаружен человек без специальной одежды.",
      tone: "danger",
    });
    recordVisionEvent({
      key: `ppe-${Math.floor(time)}`,
      title: "Человек без специальной одежды",
      source: "PPE-CAM 12",
      zone: "Цех сборки #1",
      severity: "critical",
      action: "Камера обнаружила сотрудника без полного комплекта СИЗ.",
    });
  }
}

function detectFallEvent(panel, video, detections, fallState) {
  const time = video.currentTime || 0;
  if (time < fallState.lastTime - 0.25) {
    fallState.triggered = false;
    fallState.fallStart = null;
    fallState.lastFall = null;
  }
  fallState.lastTime = time;
  const fall = detections.find((det) => /fall/i.test(det.label));
  if (fall) {
    if (fallState.fallStart === null || (fallState.lastFall !== null && time - fallState.lastFall > 0.35)) {
      fallState.fallStart = time;
    }
    fallState.lastFall = time;
  } else if (fallState.lastFall !== null && time - fallState.lastFall > 0.35) {
    fallState.fallStart = null;
    fallState.lastFall = null;
  }
  if (fall && !fallState.triggered && fallState.fallStart !== null && time - fallState.fallStart >= 0.6) {
    fallState.triggered = true;
    showSafetyToast({ title: "Падение обнаружено камерой", text: "Обнаружено падение сотрудника. Проверьте состояние человека.", tone: "danger" });
    recordVisionEvent({
      key: `fall-video-${Math.floor(time)}`,
      title: "Падение сотрудника",
      source: "FALL-CAM 03",
      zone: "Зона наблюдения",
      severity: "critical",
      action: "Камера обнаружила падение сотрудника.",
    });
  }
}

function detectMicrosleep(panel, video, frame, sleepState) {
  const time = video.currentTime || 0;
  if (time < sleepState.lastTime - 0.25) {
    sleepState.closeStart = null;
    sleepState.lastClosed = null;
    sleepState.triggered = false;
    sleepState.restarting = false;
  }
  sleepState.lastTime = time;

  const closed = frame.detections.some((det) => /eyeLeftClose|eyeRightClose|microsleep/i.test(det.label));
  if (closed) {
    if (sleepState.closeStart === null || (sleepState.lastClosed !== null && time - sleepState.lastClosed > 0.35)) {
      sleepState.closeStart = time;
      sleepState.triggered = false;
    }
    sleepState.lastClosed = time;
  } else if (sleepState.lastClosed !== null && time - sleepState.lastClosed > 0.35) {
    sleepState.closeStart = null;
    sleepState.lastClosed = null;
    sleepState.triggered = false;
  }

  if (sleepState.closeStart !== null && !sleepState.triggered && time - sleepState.closeStart >= 1.5) {
    sleepState.triggered = true;
    sleepState.restarting = true;
    const total = Number(panel.dataset.microsleepViolations || 0) + 1;
    panel.dataset.microsleepViolations = String(total);
    const counter = panel.querySelector(".vision-violation-count");
    if (counter) counter.textContent = String(total);
    showSafetyToast({
      title: "Обнаружен микросон",
      text: "Иван Иванов Иванович · длительное закрытие глаз. Проверьте состояние сотрудника.",
      tone: "danger",
    });
    recordVisionEvent({
      key: `microsleep-${panel.dataset.visionEmployeeId || "driver"}-${Math.floor(time)}`,
      title: "Микросон водителя",
      source: "DRIVER-CAM 02",
      zone: "Кабина транспорта",
      severity: "critical",
      employee_id: panel.dataset.visionEmployeeId,
      action: "Глаза закрыты более 1.5 секунд. Требуется остановка и проверка состояния водителя.",
    });
  }
}

async function recordVisionEvent(event) {
  if (state.user?.role !== "ADMIN") return;
  try {
    const res = await api("/api/vision-events", { method: "POST", body: JSON.stringify(event) });
    if (res.data) {
      state.data = res.data;
      refreshLiveEventPanels();
    }
  } catch (error) {
    showSafetyToast({ title: "Событие не записано", text: error.message, tone: "danger" });
  }
}

function refreshLiveEventPanels() {
  const active = state.data.metrics?.activeIncidents ?? state.data.incidents.filter((item) => item.status !== "closed").length;
  const badge = document.querySelector('[data-page="incidents"] b');
  if (badge) badge.textContent = active;
  const log = document.querySelector("#liveEventLog");
  if (log) log.innerHTML = liveEventLogHtml();
  const overview = document.querySelector("#overviewEventLog");
  if (overview) overview.innerHTML = liveEventLogHtml();
}

function showSafetyToast({ title, text, tone = "danger" }) {
  let stack = document.querySelector("#safetyToastStack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "safetyToastStack";
    stack.className = "safety-toast-stack";
    document.body.appendChild(stack);
  }
  const toast = document.createElement("div");
  toast.className = `safety-toast ${tone}`;
  toast.innerHTML = `<div class="safety-toast-icon">${icon("warning")}</div><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>`;
  stack.prepend(toast);
  setTimeout(() => toast.classList.add("show"), 20);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 260);
  }, 5200);
}

function drawDetection(ctx, det) {
  const label = `${det.label} ${Math.round(det.confidence * 100)}%`;
  const isRisk = det.risk || /no|without|close|microsleep|squint|отсутств|без/i.test(det.label);
  ctx.lineWidth = 3;
  ctx.strokeStyle = isRisk ? "#d93444" : "#10b981";
  ctx.fillStyle = ctx.strokeStyle;
  ctx.font = "500 16px Space Grotesk, Montserrat, sans-serif";

  if (det.type === "obb" && det.points?.length) {
    ctx.beginPath();
    det.points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    ctx.stroke();
    drawVisionLabel(ctx, label, det.points[0][0], det.points[0][1] - 8);
    return;
  }

  const [x1, y1, x2, y2] = det.box;
  ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  drawVisionLabel(ctx, label, x1, y1 - 8);
}

function drawVisionLabel(ctx, label, x, y) {
  const metrics = ctx.measureText(label);
  const pad = 7;
  const height = 26;
  const safeY = Math.max(2, y - height);
  ctx.fillRect(Math.max(2, x), safeY, metrics.width + pad * 2, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, Math.max(2, x) + pad, safeY + 18);
}

function initCargoCamera(panel) {
  if (panel.dataset.loaded === "true") return;
  panel.dataset.loaded = "true";
  const kind = panel.dataset.cargoCamera;
  const video = panel.querySelector(".cargo-video");
  const canvas = panel.querySelector(".cargo-canvas");
  const note = panel.querySelector("[data-cargo-note]");
  const stateEl = panel.querySelector("[data-cargo-state]");
  if (!video || !canvas) return;
  const ctx = canvas.getContext("2d");
  const run = { cargoSeen: false, mismatchSeen: false, lastTime: 0 };

  const resize = () => {
    const rect = video.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const setStatus = (tone, text, message) => {
    if (stateEl) {
      stateEl.className = `cargo-state ${tone}`;
      stateEl.textContent = text;
    }
    if (note) note.textContent = message;
  };

  const drawCargoObb = (box, label, risk = false) => {
    const rect = video.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const points = box.map(([x, y]) => [x * w, y * h]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = risk ? "#d93444" : "#16a34a";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = "800 14px Inter, Arial, sans-serif";
    ctx.beginPath();
    points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    ctx.stroke();
    drawVisionLabel(ctx, label, points[0][0], points[0][1] - 8);
  };

  const draw = () => {
    if (!panel.isConnected) return;
    resize();
    const rect = video.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    const t = video.currentTime || 0;
    if (t < run.lastTime - 0.25) {
      run.cargoSeen = false;
      run.mismatchSeen = false;
      setStatus(kind === "cargoEnter" ? "ok" : "warn", kind === "cargoEnter" ? "поиск груза" : "сопоставление", kind === "cargoEnter" ? "Ожидание объекта в зоне контроля." : "Проверяется наличие груза после проезда.");
    }
    run.lastTime = t;

    if (kind === "cargoEnter" && t >= 4.5) {
      const wobble = Math.sin(t * 2.2) * 0.015;
      drawCargoObb([[0.48 + wobble, 0.48], [0.72 + wobble, 0.45], [0.76 + wobble, 0.66], [0.51 + wobble, 0.7]], "cement 8kg");
      setStatus("ok", "груз обнаружен", "CARGO-CAM 01 видит цемент у водителя на выезде со склада.");
      if (!run.cargoSeen) {
        run.cargoSeen = true;
        document.querySelector("#cargoGlobalStatus") && (document.querySelector("#cargoGlobalStatus").textContent = "груз найден на точке 1");
        document.querySelector("#cargoInvestigationText") && (document.querySelector("#cargoInvestigationText").textContent = "На складском выезде зафиксирован цемент. Ожидается подтверждение на второй камере.");
      }
    }

    if (kind === "cargoOut" && t >= 2) {
      setStatus("danger", "груз отсутствует", "На второй точке груз отсутствует. Проверьте маршрут, складскую накладную и ответственного водителя.");
      if (!run.mismatchSeen) {
        run.mismatchSeen = true;
        const now = Date.now();
        document.querySelector("#cargoGlobalStatus") && (document.querySelector("#cargoGlobalStatus").textContent = "обнаружено расхождение");
        document.querySelector("#cargoInvestigationText") && (document.querySelector("#cargoInvestigationText").textContent = "Груз был виден на складском выезде, но отсутствует на въездном контуре. Создана проверка материального расхождения.");
        if (now - (state.cargoMismatchLastAt || 0) > 45000) {
          state.cargoMismatchLastAt = now;
          showSafetyToast({
            title: "Расхождение по грузу",
            text: "Цемент зафиксирован на точке 1, но не подтвержден на точке 2. Проверьте маршрут и груз.",
            tone: "danger",
          });
          recordVisionEvent({
            key: `cargo-mismatch-${Math.floor(now / 120000)}`,
            title: "Расхождение по грузу",
            source: "CARGO-CAM 01 / CARGO-CAM 02",
            zone: "Материальный контроль",
            severity: "critical",
            action: "Цемент обнаружен на складском выезде и отсутствует на следующей точке контроля.",
          });
        }
      }
    }
    requestAnimationFrame(draw);
  };

  video.addEventListener("loadedmetadata", () => {
    resize();
    video.play().catch(() => {});
    requestAnimationFrame(draw);
  }, { once: true });
}

function setupAirDemo() {
  const demo = document.querySelector("#airDemo");
  const video = document.querySelector("#airDemoVideo");
  if (!demo || !video) return;
  const offlineCam = document.querySelector("#airOfflineCam");
  const prevBtn = document.querySelector("#airCamPrev");
  const nextBtn = document.querySelector("#airCamNext");
  const cameras = [
    { label: "AIR-CAM 04", zone: "Северная галерея · улица", online: true },
    { label: "CAM 02", zone: "Западный въезд · улица", online: false },
    { label: "CAM 03", zone: "Склад 4 · внешний контур", online: false },
  ];
  let activeCam = 0;

  const values = {
    normal: {
      pill: "Норма",
      title: "Качество воздуха стабильное",
      alert: "Показатели в пределах нормы. Вентиляция активна, зона доступна для персонала.",
      status: "Пост наблюдения передает видео и телеметрию в реальном времени. Контур оповещения активен.",
      pm: ["24 мкг/м3", 28],
      co2: ["620 ppm", 30],
      smoke: ["3%", 12],
      aqi: ["42", 24],
      access: "разрешен",
      vent: "штатно",
      notify: "канал готов",
      updated: "обновлено сейчас",
    },
    danger: {
      pill: "Опасно",
      title: "Опасное качество воздуха",
      alert: "Уровень загрязнения вырос. Покиньте данную зону и дождитесь проверки вентиляции.",
      status: "Система создала предупреждение: превышение PM2.5, рост CO2 и признаки задымления в зоне камеры.",
      pm: ["148 мкг/м3", 92],
      co2: ["1760 ppm", 86],
      smoke: ["41%", 74],
      aqi: ["167", 88],
      access: "закрыт",
      vent: "усиленный режим",
      notify: "отправлено HSE",
      updated: "критическое обновление",
    },
    offline: {
      pill: "Нет сигнала",
      title: "Канал камеры недоступен",
      alert: "Последний пакет данных сохранен. Датчики зоны остаются на контроле.",
      status: "Видеоканал не передает кадры. Контур датчиков продолжает обновлять показания зоны.",
      pm: ["--", 0],
      co2: ["--", 0],
      smoke: ["--", 0],
      aqi: ["--", 0],
      access: "ожидание",
      vent: "контроль",
      notify: "канал HSE готов",
      updated: "камера недоступна",
    },
  };

  const setText = (id, text) => {
    const el = document.querySelector(id);
    if (el) el.textContent = text;
  };
  const setMeter = (id, width) => {
    const el = document.querySelector(id);
    const label = document.querySelector(`${id}Label`);
    if (el) el.style.setProperty("--value", `${width}%`);
    if (label) label.textContent = `${width}%`;
  };
  const apply = (mode) => {
    const v = values[mode];
    demo.classList.toggle("danger", mode === "danger");
    demo.classList.toggle("offline", mode === "offline");
    setText("#airStatusPill", v.pill);
    setText("#airAlertTitle", v.title);
    setText("#airAlertText", v.alert);
    setText("#airStatusText", v.status);
    setText("#airUpdated", v.updated);
    setText("#airPmValue", v.pm[0]);
    setText("#airCo2Value", v.co2[0]);
    setText("#airSmokeValue", v.smoke[0]);
    setText("#airAqiValue", v.aqi[0]);
    setText("#airAccessValue", v.access);
    setText("#airVentValue", v.vent);
    setText("#airNotifyValue", v.notify);
    setMeter("#airPmMeter", v.pm[1]);
    setMeter("#airCo2Meter", v.co2[1]);
    setMeter("#airSmokeMeter", v.smoke[1]);
    setMeter("#airAqiMeter", v.aqi[1]);
  };

  let lastMode = "";
  let dangerTimer = null;
  let previousTime = 0;
  let airAlertShown = false;
  const updateCameraChrome = () => {
    const cam = cameras[activeCam];
    setText("#airPostLabel", `${cam.zone} · пост ${cam.label}`);
    if (offlineCam) offlineCam.textContent = cam.label;
  };
  const setCamera = (direction) => {
    activeCam = (activeCam + direction + cameras.length) % cameras.length;
    const cam = cameras[activeCam];
    clearTimeout(dangerTimer);
    dangerTimer = null;
    previousTime = 0;
    if (!cam.online) {
      video.pause();
      lastMode = "offline";
      apply("offline");
      updateCameraChrome();
      return;
    }
    demo.classList.remove("offline");
    video.currentTime = 0;
    video.play().catch(() => {});
    startCycle();
  };
  const update = () => {
    if (!cameras[activeCam].online) return;
    const mode = video.currentTime >= 3 ? "danger" : "normal";
    if (mode !== lastMode) {
      lastMode = mode;
      apply(mode);
      updateCameraChrome();
    }
  };
  const startCycle = () => {
    if (!cameras[activeCam].online) return;
    clearTimeout(dangerTimer);
    lastMode = "normal";
    airAlertShown = false;
    apply("normal");
    updateCameraChrome();
    dangerTimer = setTimeout(() => {
      lastMode = "danger";
      apply("danger");
      updateCameraChrome();
      if (!airAlertShown) {
        airAlertShown = true;
        showSafetyToast({ title: "Опасное качество воздуха", text: "Покиньте данную зону и дождитесь проверки вентиляции.", tone: "danger" });
      }
    }, 3000);
  };
  video.addEventListener("timeupdate", () => {
    if (video.currentTime < 0.45 && previousTime > 2) startCycle();
    previousTime = video.currentTime;
  });
  video.addEventListener("loadedmetadata", startCycle);
  video.addEventListener("play", () => {
    if (!dangerTimer && lastMode !== "danger") startCycle();
  });
  prevBtn?.addEventListener("click", () => setCamera(-1));
  nextBtn?.addEventListener("click", () => setCamera(1));
  video.play().catch(() => {});
  startCycle();
}

function render() {
  if (state.loading) {
    app.innerHTML = `<div class="min-h-screen grid place-items-center"><div class="glass rounded-3xl p-8 font-black text-primary">Smartkóz загружается...</div></div>`;
    return;
  }
  if (!state.user) return loginView();
  shell();
}

// Boot is started by platform.js after the operational workspace is installed.
