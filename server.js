const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const express = require("express");
const cookieParser = require("cookie-parser");
const Database = require("better-sqlite3");
const PDFDocument = require("pdfkit");

const loadEnvFile = require("./lib/env");

loadEnvFile();

const app = express();
const databasePath = process.env.SMARTKOZ_DB || path.join(__dirname, "data", "smartkoz.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
const PORT = process.env.PORT || 3000;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || "";
const VISION_ASSET_DIR = path.join(__dirname, "public", "assets", "vision");
const CARGO_ASSET_DIR = path.join(__dirname, "public", "assets", "cargo");
const visionJobs = new Map();
const plateJobs = new Map();
const visionConfigs = {
  outfit: {
    title: "Контроль СИЗ",
    model: path.join(__dirname, "outfit", "outfitcheck.pt"),
    video: path.join(__dirname, "outfit", "manwithnooutfit.mp4"),
    publicVideo: "/assets/vision/manwithnooutfit.mp4",
    output: path.join(VISION_ASSET_DIR, "outfit-detections.json"),
  },
  dream: {
    title: "Состояние водителя",
    model: path.join(__dirname, "microdream", "dreameye.pt"),
    video: path.join(__dirname, "microdream", "microsleepdriver.mp4"),
    publicVideo: "/assets/vision/microsleepdriver.mp4",
    output: path.join(VISION_ASSET_DIR, "dream-detections.json"),
  },
  fall: {
    title: "Контроль падений",
    model: path.join(__dirname, "fall", "falling.pt"),
    video: path.join(__dirname, "fall", "fall.mp4"),
    publicVideo: "/assets/vision/fall.mp4",
    output: path.join(VISION_ASSET_DIR, "fall-detections.json"),
  },
  car1: {
    title: "КПП 1",
    model: path.join(__dirname, "FORTRANSPORT", "carsnumber.pt"),
    video: path.join(__dirname, "FORTRANSPORT", "CAR1.mp4"),
    publicVideo: "/assets/vision/CAR1.mp4",
    output: path.join(VISION_ASSET_DIR, "car1-detections.json"),
  },
  car2: {
    title: "КПП 2",
    model: path.join(__dirname, "FORTRANSPORT", "carsnumber.pt"),
    video: path.join(__dirname, "FORTRANSPORT", "CAR2.mp4"),
    publicVideo: "/assets/vision/CAR2.mp4",
    output: path.join(VISION_ASSET_DIR, "car2-detections.json"),
  },
};

app.use(express.json({ limit: "40mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.get("host")}`) return res.status(403).json({error:"Недопустимый источник запроса"});
  next();
});
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

function ensureVisionAssets() {
  fs.mkdirSync(VISION_ASSET_DIR, { recursive: true });
  fs.mkdirSync(CARGO_ASSET_DIR, { recursive: true });
  for (const cfg of Object.values(visionConfigs)) {
    const target = path.join(__dirname, "public", cfg.publicVideo);
    if (!fs.existsSync(target) && fs.existsSync(cfg.video)) fs.copyFileSync(cfg.video, target);
  }
  [
    ["TRUCK_ENTERING.mp4", path.join(__dirname, "etr", "TRUCK_ENTERING.mp4")],
    ["out.mp4", path.join(__dirname, "etr", "out.mp4")],
  ].forEach(([name, source]) => {
    const target = path.join(CARGO_ASSET_DIR, name);
    if (!fs.existsSync(target) && fs.existsSync(source)) fs.copyFileSync(source, target);
  });
}

ensureVisionAssets();

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(":");
  return crypto.timingSafeEqual(Buffer.from(hashPassword(password, salt).split(":")[1]), Buffer.from(expected));
}

function run(sql, params = []) {
  return db.prepare(sql).run(params);
}

function seed() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('ADMIN','EMPLOYEE')),
      position TEXT NOT NULL,
      zone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      position TEXT NOT NULL,
      zone TEXT NOT NULL,
      status TEXT NOT NULL,
      ppe_status TEXT NOT NULL,
      warnings INTEGER NOT NULL DEFAULT 0,
      last_seen TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      zone TEXT NOT NULL,
      severity TEXT NOT NULL,
      employee_id INTEGER,
      status TEXT NOT NULL DEFAULT 'open',
      action TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      assigned_to INTEGER NOT NULL,
      created_by INTEGER NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL,
      due_at TEXT NOT NULL,
      FOREIGN KEY(assigned_to) REFERENCES users(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS sensors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      zone TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plate TEXT NOT NULL,
      driver TEXT NOT NULL,
      vehicle_type TEXT NOT NULL,
      cargo TEXT NOT NULL,
      status TEXT NOT NULL,
      weight_t REAL NOT NULL,
      gate_time TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vehicle_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plate TEXT NOT NULL,
      driver TEXT NOT NULL,
      cargo TEXT NOT NULL,
      camera TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'entry',
      action TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      context_snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  try { db.prepare("ALTER TABLE employees ADD COLUMN category TEXT NOT NULL DEFAULT 'worker'").run(); } catch {}
  try { db.prepare("ALTER TABLE employees ADD COLUMN driver_status TEXT NOT NULL DEFAULT 'not_driver'").run(); } catch {}
  try { db.prepare("ALTER TABLE tasks ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending'").run(); } catch {}
  try { db.prepare("ALTER TABLE tasks ADD COLUMN approved_at TEXT").run(); } catch {}

}

seed();
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

function auth(req, res, next) {
  const token = req.cookies.smartkoz_token;
  if (!token) return res.status(401).json({ error: "Требуется вход" });
  const row = db.prepare(`
    SELECT s.token, u.id, u.name, u.email, u.role, u.position, u.zone, u.status
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);
  if (!row) return res.status(401).json({ error: "Сессия истекла" });
  if (row.status !== "active") return res.status(403).json({error:"Учетная запись отключена"});
  delete row.token;
  req.user = row;
  next();
}

function managerOnly(req, res, next) {
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Доступно только руководителю смены" });
  next();
}

function buildPdf(res, title, text) {
  const doc = new PDFDocument({ size: "A4", margin: 56 });
  const fontPath = path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "arial.ttf");
  const boldPath = path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "arialbd.ttf");
  if (fs.existsSync(fontPath)) doc.font(fontPath);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(title).replace(/%/g, "")}.pdf"`);
  doc.pipe(res);
  if (fs.existsSync(boldPath)) doc.font(boldPath);
  doc.fontSize(18).fillColor("#111318").text(title, { align: "left" });
  if (fs.existsSync(fontPath)) doc.font(fontPath);
  doc.moveDown(0.4).fontSize(9).fillColor("#6f7683").text(`Smartkóz · ${new Date().toLocaleString("ru-RU")}`);
  doc.moveDown(1).fontSize(11).fillColor("#111318");
  String(text || "").split(/\n+/).forEach((line) => {
    const clean = line.replace(/\*\*/g, "").replace(/^#{1,6}\s*/, "").trim();
    if (!clean) return doc.moveDown(0.4);
    const isHeading = /^(Сводка|Факты|Данные|Риски|Действия|Рекомендации|Срочность)/i.test(clean);
    if (isHeading && fs.existsSync(boldPath)) doc.moveDown(0.6).font(boldPath).fontSize(13).text(clean).font(fontPath).fontSize(11);
    else doc.text(clean, { lineGap: 4 });
  });
  doc.end();
}

function readVisionPayload(cfg) {
  return JSON.parse(fs.readFileSync(cfg.output, "utf-8"));
}

function preparePlateText(kind,cfg) {
  if(plateJobs.has(kind))return plateJobs.get(kind);
  const job={status:'processing'};plateJobs.set(kind,job);
  const python=process.env.PYTHON || (fs.existsSync(path.join(__dirname,'.venv','Scripts','python.exe'))?path.join(__dirname,'.venv','Scripts','python.exe'):'python');
  const child=spawn(python,[path.join(__dirname,'scripts','read_vehicle_plate.py'),cfg.video,cfg.output],{cwd:__dirname,windowsHide:true});
  child.stdout.resume();child.stderr.resume();
  const timeout=setTimeout(()=>{job.status='error';child.kill();},45000);timeout.unref();
  child.on('error',()=>{clearTimeout(timeout);job.status='error';});
  child.on('close',code=>{clearTimeout(timeout);job.status=code===0?'ready':'error';});
  return job;
}

function startVisionJob(kind, cfg) {
  const existing = visionJobs.get(kind);
  if (existing?.status === "processing") return existing;

  const job = { status: "processing", progress: 0, total: 0, error: null };
  visionJobs.set(kind, job);
  const child = spawn(process.env.PYTHON || (fs.existsSync(path.join(__dirname, '.venv', 'Scripts', 'python.exe')) ? path.join(__dirname, '.venv', 'Scripts', 'python.exe') : 'python'), [
    path.join(__dirname, "scripts", "analyze_yolo_video.py"),
    "--model", cfg.model,
    "--video", cfg.video,
    "--output", cfg.output,
    "--imgsz", "640",
    "--conf", "0.25",
  ], { cwd: __dirname, windowsHide: true });

  child.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
      try {
        const update = JSON.parse(line);
        if (update.progress) job.progress = update.progress;
        if (update.total) job.total = update.total;
      } catch {}
    }
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text) job.error = text.slice(-1000);
  });
  child.on("error", error => { job.status = "error"; job.error = error.message; });
  child.on("exit", (code) => {
    if (code === 0 && fs.existsSync(cfg.output)) {
      job.status = "ready";
      job.progress = job.total || job.progress;
      job.error = null;
    } else {
      job.status = "error";
      job.error = job.error || `YOLO exited with code ${code}`;
    }
  });
  return job;
}

function snapshot(user) {
  const employees = db.prepare("SELECT * FROM employees WHERE (? = 'ADMIN' OR user_id=?) ORDER BY name").all(user.role, user.id);
  const incidents = db.prepare(`SELECT i.*, e.name AS employee_name FROM incidents i LEFT JOIN employees e ON e.id = i.employee_id WHERE (?='ADMIN' OR e.user_id=?) ORDER BY i.id DESC LIMIT 8`).all(user.role,user.id);
  const tasks = user.role === "ADMIN"
    ? db.prepare(`SELECT t.*, u.name AS assigned_name FROM tasks t JOIN users u ON u.id=t.assigned_to ORDER BY t.id DESC`).all()
    : db.prepare(`SELECT t.*, u.name AS assigned_name FROM tasks t JOIN users u ON u.id=t.assigned_to WHERE assigned_to=? ORDER BY t.id DESC`).all(user.id);
  const sensors = db.prepare("SELECT * FROM sensors ORDER BY status DESC, value DESC").all();
  const vehicles = user.role === 'ADMIN' ? db.prepare("SELECT * FROM vehicles ORDER BY id DESC").all() : [];
  const vehicleEntries = user.role === 'ADMIN' ? db.prepare("SELECT * FROM vehicle_entries ORDER BY id DESC LIMIT 60").all() : [];
  const warningRows = db.prepare("SELECT COUNT(*) AS c FROM incidents WHERE date(created_at)=date('now','localtime')").get();
  const criticalRows = db.prepare("SELECT COUNT(*) AS c FROM incidents WHERE severity='critical' AND status!='closed'").get();
  const activeRows = db.prepare("SELECT COUNT(*) AS c FROM incidents WHERE status!='closed'").get();
  const metrics = {
    employeesOnSite: db.prepare("SELECT COUNT(*) c FROM shifts WHERE ended_at IS NULL").get().c,
    activeCameras: db.prepare("SELECT COUNT(*) c FROM cameras WHERE is_active=1").get().c,
    vehiclesOnSite: vehicles.filter(v => v.status === "on_site").length,
    dustLevel: sensors.find(s => s.type.includes("PM2.5"))?.value ?? null,
    warningsToday: warningRows.c,
    criticalIncidents: criticalRows.c,
    activeIncidents: activeRows.c,
    riskLevel: null,
    activeSensors: sensors.length,
  };
  return { user, metrics, employees, incidents, tasks, sensors, vehicles, vehicleEntries };
}

function compactAssistantContext(data) {
  return {
    user: { name: data.user.name, role: data.user.role, position: data.user.position, zone: data.user.zone },
    metrics: data.metrics,
    employees: data.employees.map((e) => ({
      id: e.id,
      name: e.name,
      position: e.position,
      category: e.category,
      zone: e.zone,
      status: e.status,
      warnings: e.warnings,
      driver_status: e.driver_status,
    })),
    incidents: data.incidents.slice(0, 8).map((i) => ({
      id: i.id,
      title: i.title,
      source: i.source,
      zone: i.zone,
      severity: i.severity,
      status: i.status,
      employee_name: i.employee_name,
      created_at: i.created_at,
    })),
    tasks: data.tasks.slice(0, 12).map((t) => ({
      id: t.id,
      title: t.title,
      assigned_name: t.assigned_name,
      status: t.status,
      approval_status: t.approval_status,
      priority: t.priority,
      due_at: t.due_at,
    })),
    sensors: data.sensors.map((s) => ({
      type: s.type,
      zone: s.zone,
      value: s.value,
      unit: s.unit,
      status: s.status,
    })),
    vehicleEntries: data.vehicleEntries.slice(0, 20).map((v) => ({
      plate: v.plate,
      driver: v.driver,
      cargo: v.cargo,
      camera: v.camera,
      action: v.action,
      created_at: v.created_at,
    })),
  };
}

const platform = require("./lib/platform")({app, db, auth, managerOnly, hashPassword, verifyPassword, root: __dirname});

app.post("/api/logout", auth, (req, res) => {
  run("DELETE FROM sessions WHERE token=?", [req.cookies.smartkoz_token]);
  res.clearCookie("smartkoz_token");
  res.json({ ok: true });
});

app.get("/api/session", auth, (req, res) => res.json({ user: req.user }));
app.get("/api/dashboard", auth, (req, res) => res.json(snapshot(req.user)));

app.get("/api/vision/:kind", auth, managerOnly, (req, res) => {
  const cfg = visionConfigs[req.params.kind];
  if (!cfg) return res.status(404).json({ error: "Видеоаналитика не найдена" });
  if (!fs.existsSync(cfg.model) || !fs.existsSync(cfg.video)) return res.status(404).json({ error: "Модель или видео не найдены" });
  if (fs.existsSync(cfg.output)) {
    const detections=readVisionPayload(cfg);
    if(['car1','car2'].includes(req.params.kind)&&!detections.plateRecognition){
      const job=preparePlateText(req.params.kind,cfg);
      if(job.status==='processing')return res.status(202).json({status:'processing',progress:0,total:0});
    }
    return res.json({
      status: "ready",
      title: cfg.title,
      video: cfg.publicVideo,
      plate: detections.plateRecognition?.plate || null,
      plateSource: 'ocr',
      detections,
    });
  }
  const job = startVisionJob(req.params.kind, cfg);
  if (job.status === "error") return res.status(500).json({ status: "error", error: job.error });
  res.status(202).json({ status: "processing", progress: job.progress, total: job.total });
});

app.post("/api/gate-events", auth, managerOnly, (req, res) => {
  let {plate,driver,cargo,camera} = req.body;
  if(req.body.kind){
    if(Number(req.body.observed_ms)<3000||!Number.isFinite(Number(req.body.observed_ms)))return res.status(409).json({error:'Наблюдение за номером продолжается'});
    const source=visionConfigs[req.body.kind];
    if(!['car1','car2'].includes(req.body.kind)||!source||!fs.existsSync(source.output))return res.status(400).json({error:'Выберите камеру КПП'});
    const payload=readVisionPayload(source);
    if(!payload.frames.some(f=>f.detections?.length))return res.status(409).json({error:'Номер автомобиля не обнаружен'});
    plate=payload.plateRecognition?.plate;
    if(!plate)return res.status(409).json({error:'Номер не удалось прочитать. Укажите его вручную в журнале въездов.'});
    driver='Иван Иванов Иванович';cargo='—';camera=req.body.kind==='car1'?'КПП 1':'КПП 2';
  }
  if (![plate,driver,cargo,camera].every(v=>typeof v==='string' && v.trim() && v.length<=200)) return res.status(400).json({ error: "Укажите номер, водителя, груз и камеру" });
  const cfg = {plate:plate.trim(),driver:driver.trim(),cargo:cargo.trim(),title:camera.trim()};
  const recent = db.prepare(`
    SELECT * FROM vehicle_entries
    WHERE plate=? AND camera=? AND created_at > datetime('now','-20 seconds','localtime')
  `).get(cfg.plate, cfg.title);
  if (!recent) {
    run(
      "INSERT INTO vehicle_entries (plate,driver,cargo,camera,direction,action,created_at) VALUES (?,?,?,?,?,?,datetime('now','localtime'))",
      [cfg.plate, cfg.driver, cfg.cargo, cfg.title, "entry", `Заехала машина с грузом: ${cfg.cargo}`]
    );
  }
  res.json({ ok: true, entry: recent || db.prepare("SELECT * FROM vehicle_entries WHERE plate=? AND camera=? ORDER BY id DESC LIMIT 1").get(cfg.plate,cfg.title), data: snapshot(req.user) });
});

app.delete("/api/gate-events", auth, managerOnly, (req, res) => {
  run("DELETE FROM vehicle_entries");
  res.json({ ok: true, data: snapshot(req.user) });
});

app.get("/api/weather/astana", auth, async (req, res) => {
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=Astana,kz&units=metric&lang=ru&appid=${OPENWEATHER_API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`OpenWeather ${response.status}`);
    const data = await response.json();
    res.json({
      city: "Астана",
      temp: Math.round(data.main.temp),
      feels: Math.round(data.main.feels_like),
      description: data.weather?.[0]?.description || "погода обновляется",
      wind: data.wind?.speed || 0,
    });
  } catch (error) {
    res.json({ city: "Астана", temp: null, feels: null, description: "погода временно недоступна", wind: 0 });
  }
});

app.post("/api/tasks", auth, managerOnly, (req, res) => {
  const { title, description, assigned_to, priority } = req.body;
  if (!title || !description || !assigned_to) return res.status(400).json({ error: "Заполните задачу, описание и работника" });
  if (!db.prepare("SELECT id FROM users WHERE id=? AND role='EMPLOYEE' AND status='active'").get(assigned_to)) return res.status(400).json({error:"Сотрудник не найден"});
  const result = run("INSERT INTO tasks (title,description,assigned_to,created_by,priority,status,created_at,due_at) VALUES (?,?,?,?,?,'new',datetime('now','localtime'),datetime('now','+2 hours','localtime'))", [title, description, assigned_to, req.user.id, priority || "medium"]);
  res.json({ id: result.lastInsertRowid });
});

app.patch("/api/tasks/:id", auth, (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(req.params.id);
  if (!task) return res.status(404).json({ error: "Задача не найдена" });
  if (req.user.role !== "ADMIN" && task.assigned_to !== req.user.id) return res.status(403).json({ error: "Нет доступа к задаче" });
  const status = ["new", "in_progress", "done"].includes(req.body.status) ? req.body.status : task.status;
  run("UPDATE tasks SET status=? WHERE id=?", [status, task.id]);
  res.json({ ok: true });
});

app.patch("/api/tasks/:id/approval", auth, managerOnly, (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(req.params.id);
  if (!task) return res.status(404).json({ error: "Задача не найдена" });
  const approval = ["approved", "rejected", "pending"].includes(req.body.approval_status) ? req.body.approval_status : "pending";
  run("UPDATE tasks SET approval_status=?, approved_at=datetime('now','localtime') WHERE id=?", [approval, task.id]);
  res.json({ ok: true, data: snapshot(req.user) });
});

app.post("/api/incidents", auth, managerOnly, (req, res) => {
  const { title, source, zone, severity, action, employee_id } = req.body;
  run("INSERT INTO incidents (title,source,zone,severity,employee_id,status,action,created_at) VALUES (?,?,?,?,?,'open',?,datetime('now','localtime'))", [title, source, zone, severity, employee_id || null, action || "Создано вручную"]);
  res.json({ ok: true });
});

app.post("/api/vision-events", auth, managerOnly, (req, res) => {
  const { title, source, zone, severity, action, employee_id } = req.body;
  if (!title || !source || !zone) return res.status(400).json({ error: "Недостаточно данных события" });
  const level = ["critical", "warning", "medium", "low"].includes(severity) ? severity : "warning";
  run(
    "INSERT INTO incidents (title,source,zone,severity,employee_id,status,action,created_at) VALUES (?,?,?,?,?,'open',?,datetime('now','localtime'))",
    [title, source, zone, level, employee_id || null, action || "Событие создано камерой"]
  );
  if (employee_id) run("UPDATE employees SET warnings=warnings+1 WHERE id=?", [employee_id]);
  res.json({ ok: true, data: snapshot(req.user) });
});

async function requestGroq(messages, { maxTokens = 520, temperature = 0.2, timeoutMs = 9000 } = {}) {
  const key=loadEnvFile.get('GROQ_API_KEY');
  if(!key)throw Object.assign(new Error('Assistant credential is not configured'),{status:401});
  const configuredModel=loadEnvFile.get('GROQ_MODEL')||'openai/gpt-oss-20b';
  const models = [...new Set([configuredModel, "openai/gpt-oss-20b", "openai/gpt-oss-120b"])];
  let lastError = null;
  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, temperature, max_tokens: maxTokens, messages, ...(model.startsWith('openai/gpt-oss-')?{reasoning_effort:'low'}:{}) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastError = new Error(`Groq ${response.status}: ${payload.error?.message || "request failed"}`);
        lastError.status=response.status;
        if ([400,404,429].includes(response.status) || response.status >= 500) continue;
        throw lastError;
      }
      const content=payload.choices?.[0]?.message?.content?.trim();
      if(content)return content;
      lastError=new Error('Assistant returned an empty answer');
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("Groq request failed");
}

async function groqReport(prompt, fallback) {
  try {
    return await requestGroq([
      { role: "system", content: "Отвечай на русском как структурированный рабочий отчет. Без markdown-символов ** и ###. Короткие секции: Сводка, Факты, Риски, Действия." },
      { role: "user", content: prompt },
    ], { maxTokens: 520, timeoutMs: 9000 }) || fallback;
  } catch (error) {
    console.error("[Groq]", error.message);
    return fallback;
  }
}

app.get("/api/replay/today", auth, async (req, res) => {
  const incidents = db.prepare("SELECT * FROM incidents WHERE date(created_at)=date('now','localtime') ORDER BY id DESC").all();
  const answer = await groqReport(
    `Данные инцидентов за сегодня:\n${JSON.stringify(incidents, null, 2)}\nСоставь краткий AI Incident Replay.`,
    `Сводка\nЗа сегодня зафиксировано событий: ${incidents.length}.\n\nФакты\n${incidents.map((i) => `${i.created_at}: ${i.title} (${i.source})`).join("\n") || "Событий пока нет."}\n\nРиски\nОценка зависит от новых событий камер.\n\nДействия\nПроверить журнал камер и закрыть подтвержденные инциденты.`
  );
  res.json({ answer, incidents });
});

app.get("/api/tasks/report", auth, managerOnly, async (req, res) => {
  const data = snapshot(req.user);
  const answer = await groqReport(
    `Задачи и сотрудники:\n${JSON.stringify({ tasks: data.tasks, employees: data.employees }, null, 2)}\nСоставь отчет по выполнению задач.`,
    `Сводка\nВсего задач: ${data.tasks.length}. Выполнено: ${data.tasks.filter((t) => t.status === "done").length}.\n\nФакты\n${data.tasks.map((t) => `${t.assigned_name}: ${t.title} — ${t.status}`).join("\n") || "Задач пока нет."}\n\nРиски\nПросроченные или новые задачи требуют контроля.\n\nДействия\nНазначить ответственных и обновить статусы после выполнения.`
  );
  res.json({ answer, data });
});

app.post("/api/reports/pdf", auth, managerOnly, (req, res) => {
  buildPdf(res, req.body.title || "Smartkóz report", req.body.text || "");
});

app.get("/api/zones/analysis", auth, async (req, res) => {
  const data = snapshot(req.user);
  const today = db.prepare("SELECT * FROM incidents WHERE date(created_at)=date('now','localtime') ORDER BY id DESC").all();
  if (!today.length) {
    return res.json({ answer: "Сводка\nПо событиям камер за сегодня опасных зон не обнаружено.\n\nФакты\nКарта показывает одну стабильную зеленую зону. Инциденты с камер пока отсутствуют.\n\nРиски\nКритических зон по текущим данным нет.\n\nДействия\nПродолжать мониторинг камер, воздуха и микрофона." });
  }
  const answer = await groqReport(
    `Зоны объекта и события камер за сегодня:\n${JSON.stringify({ incidents: today, sensors: data.sensors, vehicleEntries: data.vehicleEntries }, null, 2)}\nОпредели опасные зоны только на основе событий и датчиков. Если событий нет, скажи что опасных зон по камерам нет.`,
    `Сводка\nОпасные зоны рассчитываются по событиям камер и датчиков за сегодня.\n\nФакты\n${today.length ? today.map((i) => `${i.zone}: ${i.title}`).join("\n") : "Событий камер за сегодня нет."}\n\nРиски\n${today.length ? "Требуется проверка зон с критическими событиями." : "Критических зон по камерам сейчас нет."}\n\nДействия\nПродолжать мониторинг камер и датчиков.`
  );
  res.json({ answer });
});

app.post("/api/assistant", auth, async (req, res) => {
  const question = String(req.body.question || "").trim();
  if (!question) return res.status(400).json({ error: "Напишите вопрос" });
  if(question.length>3000)return res.status(400).json({error:"Сократите вопрос до 3000 символов"});
  const language=['en','kk'].includes(req.body.language)?req.body.language:'ru';
  const data = snapshot(req.user);
  if (/(машин|авто|номер|заезж|въезж|кпп|груз)/i.test(question)) {
    const entries = db.prepare("SELECT * FROM vehicle_entries WHERE date(created_at)=date('now','localtime') ORDER BY created_at DESC").all();
    const hourMatch = question.match(/(?:в\s*)?(\d{1,2})(?:[:.]\d{2})?\s*(?:утра|час|:|$)/i);
    const hour = hourMatch ? Number(hourMatch[1]) : null;
    const filtered = hour === null ? entries : entries.filter((e) => Number(String(e.created_at).slice(11, 13)) === hour);
    const answer = `Сводка\n${filtered.length ? `Сегодня найдено заездов: ${filtered.length}.` : "По указанному времени заездов не найдено."}\n\nСведения SmartKóz\n${filtered.map((e) => `${e.created_at.slice(11, 16)} — ${e.plate}, водитель: ${e.driver}, груз: ${e.cargo}, камера: ${e.camera}.`).join("\n") || "Подходящих въездов пока нет."}\n\nРекомендации\nСверьте запись КПП с журналом смены и грузовой накладной.\n\nСрочность\nНизкая, если номер и груз совпадают с планом въезда.`;
    run("INSERT INTO ai_reports (user_id,question,answer,context_snapshot,created_at) VALUES (?,?,?,?,datetime('now','localtime'))", [req.user.id, question, answer, JSON.stringify({ vehicleEntries: entries }, null, 2)]);
    return res.json({ answer });
  }
  const context = JSON.stringify(data, null, 2);
  const system = `Ты AI-ассистент Smartkóz по промышленной безопасности. Отвечай на ${language==='en'?'английском':language==='kk'?'казахском':'русском'} понятно и полезно. Если вопрос связан с Smartkóz, сотрудниками, машинами, инцидентами, задачами, датчиками или объектом, используй переданный контекст базы как главный источник фактов и не выдумывай записи. Если вопрос общий или ответа нет в базе, отвечай по своим общим знаниям и прямо отделяй это от данных базы. Отвечай естественно, кратко и по делу. На приветствие отвечай приветствием. Используй списки только когда они помогают; не добавляй пустые разделы и сообщения об отсутствии контекста. Не используй markdown-разметку, символы **, ###, таблицы и длинные вступления. Для въездов машин используй переданные сведения о номере, водителе, камере и времени. Не упоминай названия таблиц, JSON, SQLite, API, backend, провайдеров модели и внутреннее устройство системы. Не заявляй о выполненных действиях, если ты только дал совет. Роль пользователя: ${req.user.role === "ADMIN" ? "руководитель смены" : "работник"}.`;
  let answer = "";
  try {
    answer = await requestGroq([
      { role: "system", content: system },
      ...(Array.isArray(req.body.history)?req.body.history.filter(m=>m&&["user","assistant"].includes(m.role)&&typeof m.content==="string").slice(-8).map(m=>({role:m.role,content:m.content.slice(0,3000)})):[]),
      { role: "user", content: `Рабочие сведения:\n${context}\n\nВопрос: ${question}` },
    ], { maxTokens: 560, timeoutMs: 9000 });
  } catch (error) {
    console.error("[Groq assistant]", error.message);
    const messages={ru:'Помощник временно недоступен. Попробуйте ещё раз.',en:'The assistant is temporarily unavailable. Please try again.',kk:'Көмекші уақытша қолжетімсіз. Қайталап көріңіз.'};
    return res.status(503).json({error:messages[language],code:error.status===401?'ASSISTANT_AUTH':error.status===429?'ASSISTANT_LIMIT':'ASSISTANT_UNAVAILABLE'});
  }
  run("INSERT INTO ai_reports (user_id,question,answer,context_snapshot,created_at) VALUES (?,?,?,?,datetime('now','localtime'))", [req.user.id, question, answer, context]);
  res.json({ answer,source:'groq' });
});

app.use("/api", (req,res) => res.status(404).json({error:"API маршрут не найден"}));
app.use((error,req,res,next) => { console.error(error.message); res.status(error.status || 500).json({error: error.status === 413 ? "Файл слишком большой" : "Не удалось выполнить запрос"}); });

app.get(/.*/, (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

if (require.main === module) {
  if(Boolean(process.env.TLS_CERT_FILE)!==Boolean(process.env.TLS_KEY_FILE))throw new Error('Set both TLS_CERT_FILE and TLS_KEY_FILE');
  const tls=Boolean(process.env.TLS_CERT_FILE);
  const listener=tls?require('node:https').createServer({cert:fs.readFileSync(process.env.TLS_CERT_FILE),key:fs.readFileSync(process.env.TLS_KEY_FILE)},app):require('node:http').createServer(app);
  listener.listen(PORT,'0.0.0.0',()=>console.log(`SmartKoz running on ${tls?'https':'http'}://localhost:${listener.address().port}`));
  const shutdown=()=>{platform.close();listener.closeAllConnections();listener.close(()=>{db.close();process.exit(0);});};
  process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
module.exports = {app, db, platform};
