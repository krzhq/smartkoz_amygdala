const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const sanitizeSvg = require('./svg');

module.exports = function platform({ app, db, auth, managerOnly, hashPassword, verifyPassword, root }) {
  const now = () => new Date().toISOString();
  const uploads = process.env.SMARTKOZ_UPLOADS || path.join(root, 'data', 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  const addColumn = (table, column, definition) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  addColumn('users', 'created_at', 'TEXT');
  addColumn('users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('employees', 'user_id', 'INTEGER REFERENCES users(id)');
  addColumn('employees', 'department', "TEXT NOT NULL DEFAULT ''");
  addColumn('sensors', 'source', "TEXT NOT NULL DEFAULT ''");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_casefold ON users(lower(email));
    CREATE UNIQUE INDEX IF NOT EXISTS employee_user ON employees(user_id);
    CREATE TABLE IF NOT EXISTS ppe_inspections (
      id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), image_path TEXT,
      result TEXT NOT NULL CHECK(result IN ('pending','passed','failed','unavailable','approved')),
      helmet_detected INTEGER, vest_detected INTEGER, method TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
      checked_at TEXT NOT NULL, approved_by INTEGER REFERENCES users(id), approved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
      inspection_id INTEGER UNIQUE REFERENCES ppe_inspections(id), started_at TEXT NOT NULL, ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_shift ON shifts(employee_id) WHERE ended_at IS NULL;
    CREATE TABLE IF NOT EXISTS factory_maps (id INTEGER PRIMARY KEY, name TEXT NOT NULL, file_path TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS factory_zones (id INTEGER PRIMARY KEY, map_id INTEGER NOT NULL REFERENCES factory_maps(id), name TEXT NOT NULL, polygon_data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cameras (id INTEGER PRIMARY KEY, name TEXT NOT NULL, zone_id INTEGER REFERENCES factory_zones(id), source TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS emergencies (
      id INTEGER PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      severity TEXT NOT NULL, zone_id INTEGER REFERENCES factory_zones(id), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved')),
      created_by INTEGER NOT NULL REFERENCES users(id), started_at TEXT NOT NULL, resolved_at TEXT, resolution_note TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_emergency ON emergencies(status) WHERE status='active';
    CREATE TABLE IF NOT EXISTS evacuation_records (
      id INTEGER PRIMARY KEY, emergency_id INTEGER NOT NULL REFERENCES emergencies(id), employee_id INTEGER NOT NULL REFERENCES employees(id),
      shift_id INTEGER NOT NULL REFERENCES shifts(id), status TEXT NOT NULL DEFAULT 'waiting', notified_at TEXT NOT NULL,
      safe_confirmed_at TEXT, verified_at TEXT, verification_method TEXT, UNIQUE(emergency_id,employee_id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY, recipient_id INTEGER NOT NULL REFERENCES users(id), emergency_id INTEGER REFERENCES emergencies(id),
      title TEXT NOT NULL, message TEXT NOT NULL, type TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notification_recipient ON notifications(recipient_id,id);
    CREATE TABLE IF NOT EXISTS missing_person_cases (
      id INTEGER PRIMARY KEY, emergency_id INTEGER NOT NULL REFERENCES emergencies(id), employee_id INTEGER NOT NULL REFERENCES employees(id),
      status TEXT NOT NULL DEFAULT 'unconfirmed' CHECK(status IN ('unconfirmed','searching','observation','located','awaiting_safety','safe','closed')),
      search_started_at TEXT NOT NULL, found_at TEXT, safety_confirmed_at TEXT, closed_at TEXT,
      closed_by INTEGER REFERENCES users(id), source TEXT, services_informed INTEGER NOT NULL DEFAULT 0, comment TEXT,
      UNIQUE(emergency_id,employee_id)
    );
    CREATE TABLE IF NOT EXISTS last_seen_reports (
      id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES missing_person_cases(id), reported_by INTEGER NOT NULL REFERENCES users(id),
      map_id INTEGER NOT NULL REFERENCES factory_maps(id), zone_id INTEGER REFERENCES factory_zones(id), map_x REAL NOT NULL CHECK(map_x BETWEEN 0 AND 1),
      map_y REAL NOT NULL CHECK(map_y BETWEEN 0 AND 1), observed_at TEXT NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS video_jobs (
      id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES missing_person_cases(id), zone_id INTEGER NOT NULL REFERENCES factory_zones(id),
      camera_id INTEGER REFERENCES cameras(id), file_path TEXT NOT NULL, recorded_at TEXT NOT NULL, status TEXT NOT NULL,
      error TEXT, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS camera_detections (
      id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES video_jobs(id), case_id INTEGER NOT NULL REFERENCES missing_person_cases(id),
      zone_id INTEGER REFERENCES factory_zones(id), detected_at TEXT NOT NULL, time_offset REAL NOT NULL, confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
      box_data TEXT NOT NULL, verification_status TEXT NOT NULL DEFAULT 'unreviewed', reviewed_by INTEGER REFERENCES users(id), review_note TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES users(id), action TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id INTEGER, timestamp TEXT NOT NULL, details TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS evacuation_pending ON evacuation_records(emergency_id,safe_confirmed_at);
    CREATE INDEX IF NOT EXISTS report_case ON last_seen_reports(case_id,observed_at);
    CREATE INDEX IF NOT EXISTS detection_case ON camera_detections(case_id,detected_at);
  `);
  // Existing shifts keep their IDs and history; a clothing inspection is optional.
  if(db.prepare('PRAGMA table_info(shifts)').all().find(c=>c.name==='inspection_id')?.notnull){
    if(process.env.NODE_ENV!=='test'&&db.name!==':memory:'){
      const directory=path.join(path.dirname(db.name),'backups');fs.mkdirSync(directory,{recursive:true});
      db.prepare('VACUUM INTO ?').run(path.join(directory,`before-direct-shifts-${Date.now()}.db`));
    }
    const foreignKeys=db.pragma('foreign_keys',{simple:true});db.pragma('foreign_keys=OFF');
    try{db.transaction(()=>{
      db.exec(`CREATE TABLE shifts_optional_inspection (
        id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
        inspection_id INTEGER UNIQUE REFERENCES ppe_inspections(id), started_at TEXT NOT NULL, ended_at TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended'))
      );
      INSERT INTO shifts_optional_inspection SELECT id,employee_id,inspection_id,started_at,ended_at,status FROM shifts;
      DROP TABLE shifts;
      ALTER TABLE shifts_optional_inspection RENAME TO shifts;
      CREATE UNIQUE INDEX one_active_shift ON shifts(employee_id) WHERE ended_at IS NULL;`);
      if(db.pragma('foreign_key_check').length)throw new Error('Shift migration failed foreign key verification');
    })();}finally{db.pragma(`foreign_keys=${foreignKeys?'ON':'OFF'}`);}
  }
  if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
    const production = process.env.NODE_ENV === 'production';
    if (production && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12)) throw new Error('Production requires ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters)');
    db.prepare('INSERT INTO users(name,email,password_hash,role,position,zone,status,created_at,must_change_password) VALUES(?,?,?,?,?,?,?,?,?)')
      .run('Руководитель', process.env.ADMIN_EMAIL || 'rukovod@gmail.com', hashPassword(process.env.ADMIN_PASSWORD || 'admin'), 'ADMIN', 'Руководитель предприятия', '', 'active', now(), 1);
  }
  // Interrupted jobs cannot claim to be running after a process restart.
  db.prepare("UPDATE video_jobs SET status='unavailable',error='Анализ прерван перезапуском; загрузите запись повторно' WHERE status='processing'").run();
  db.prepare("UPDATE ppe_inspections SET result='unavailable',details='Проверка прервана; повторите или запросите ручную проверку' WHERE result='pending'").run();

  function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
  function text(value, label, max = 1000) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`Проверьте поле «${label}»`); return value.trim(); }
  function id(value) { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) fail('Некорректный идентификатор'); return n; }
  function date(value) { const d = new Date(value); if (!value || !Number.isFinite(d.getTime()) || d > new Date(Date.now() + 60000)) fail('Проверьте время наблюдения'); return d.toISOString(); }
  const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, position: u.position, zone: u.zone, must_change_password: Boolean(u.must_change_password) });
  const audit = (actor, action, entity, entityId, details = {}) => db.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,timestamp,details) VALUES(?,?,?,?,?,?)').run(actor, action, entity, entityId, now(), JSON.stringify(details));
  const notify = (recipient, emergency, title, message, type) => db.prepare('INSERT INTO notifications(recipient_id,emergency_id,title,message,type,created_at) VALUES(?,?,?,?,?,?)').run(recipient, emergency, title, message, type, now());
  const admins = () => db.prepare("SELECT id FROM users WHERE role='ADMIN' AND status='active'").all();
  const employee = user => { const row = db.prepare('SELECT * FROM employees WHERE user_id=?').get(user.id); if (!row) fail('Доступно сотруднику', 403); return row; };
  const caseRow = value => { const row = db.prepare('SELECT * FROM missing_person_cases WHERE id=?').get(id(value)); if (!row) fail('Поисковый случай не найден', 404); return row; };
  const streams = new Set();
  function emit(type, entityId, actor = null, recipients = null) {
    const event = { type, entity_id: entityId, actor_id: actor, time: now() };
    for (const client of streams) {
      if (client.user.role === 'ADMIN' || recipients?.includes(client.user.id)) client.res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  }
  const route = fn => async (req, res, next) => { try { await fn(req, res); } catch (e) { if (e.code?.startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({error:'Запись уже существует или действие конфликтует с текущим состоянием'}); if (e.status) return res.status(e.status).json({error:e.message}); next(e); } };
  function cookie(res, user) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare("INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,datetime('now'),datetime('now','+8 hours'))").run(token, user.id);
    res.cookie('smartkoz_token', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 28800000 });
  }
  const attempts = new Map();
  app.post('/api/login', route((req,res) => {
    const key = req.ip;
    const a = attempts.get(key) || { count: 0, until: Date.now() + 900000 };
    if (a.until < Date.now()) { a.count = 0; a.until = Date.now() + 900000; }
    if (a.count >= 30) fail('Слишком много попыток; повторите через 15 минут', 429);
    a.count++; attempts.set(key,a);
    const u = db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE').get(String(req.body.email || '').trim());
    if (typeof req.body.password !== 'string' || req.body.password.length > 256 || !u || u.status !== 'active' || !verifyPassword(req.body.password, u.password_hash)) fail('Неверный email или пароль',401);
    attempts.delete(key); cookie(res,u); res.json({user:publicUser(u)});
  }));
  app.post('/api/register', route((req,res) => {
    const name = text(req.body.name,'ФИО',120), email = text(req.body.email,'Email',254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Некорректный email');
    const password = text(req.body.password,'Пароль',256);
    if (password.length < 8 || password !== req.body.confirm_password) fail('Пароль должен содержать от 8 символов; подтверждение должно совпадать');
    const department = String(req.body.department || '').slice(0,120), position = String(req.body.position || '').slice(0,120);
    const userId = db.transaction(() => {
      const uid = Number(db.prepare('INSERT INTO users(name,email,password_hash,role,position,zone,status,created_at) VALUES(?,?,?,?,?,?,?,?)').run(name,email,hashPassword(password),'EMPLOYEE',position,'','active',now()).lastInsertRowid);
      db.prepare("INSERT INTO employees(user_id,name,position,department,zone,status,ppe_status,warnings,last_seen) VALUES(?,?,?,?,?,'off_shift','not_checked',0,?)").run(uid,name,position,department,'',now());
      audit(uid,'employee_registered','users',uid); return uid;
    })();
    cookie(res,{id:userId}); emit('employee_registered',userId,userId); res.status(201).json({user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(userId))});
  }));
  app.post('/api/password', auth, route((req,res) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!verifyPassword(text(req.body.current_password,'Текущий пароль',256),u.password_hash)) fail('Неверный текущий пароль',403);
    const password = text(req.body.password,'Новый пароль',256);
    if (password.length < 12 || password === req.body.current_password) fail('Используйте новый пароль от 12 символов');
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?').run(hashPassword(password),u.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id); audit(u.id,'password_changed','users',u.id);
    })();
    for (const client of streams) if (client.user.id === u.id) client.res.end();
    cookie(res,u); res.json({ok:true});
  }));
  // A production bootstrap password may only be used to set a new password.
  app.use('/api', (req,res,next) => {
    if (process.env.NODE_ENV !== 'production' || ['/login','/register','/password','/logout','/session'].includes(req.path)) return next();
    auth(req,res,() => {
      const u = db.prepare('SELECT must_change_password FROM users WHERE id=?').get(req.user.id);
      if (u.must_change_password) return res.status(403).json({error:'Сначала смените временный пароль'});
      next();
    });
  });
  app.get('/api/events', auth, (req,res) => {
    res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive'}); res.flushHeaders();
    const client = {user:req.user,res,token:req.cookies.smartkoz_token}; streams.add(client);
    res.write(`data: ${JSON.stringify({type:'connected',time:now()})}\n\n`);
    const heartbeat = setInterval(() => {
      if (!db.prepare("SELECT token FROM sessions WHERE token=? AND expires_at>datetime('now')").get(client.token)) return res.end();
      res.write(': heartbeat\n\n');
    },15000);
    req.on('close',() => {clearInterval(heartbeat); streams.delete(client);});
  });

  function recover(at = Date.now()) {
    const inserted = db.transaction(() => {
      const rows = db.prepare(`SELECT r.*, e.started_at FROM evacuation_records r JOIN emergencies e ON e.id=r.emergency_id
        WHERE e.status='active' AND r.safe_confirmed_at IS NULL AND r.verified_at IS NULL`).all();
      const created = [];
      for (const r of rows) {
        if (at - Date.parse(r.started_at) < 300000) continue;
        const out = db.prepare('INSERT OR IGNORE INTO missing_person_cases(emergency_id,employee_id,search_started_at) VALUES(?,?,?)').run(r.emergency_id,r.employee_id,new Date(at).toISOString());
        if (!out.changes) continue;
        db.prepare("UPDATE evacuation_records SET status='unconfirmed' WHERE id=?").run(r.id);
        const e = db.prepare('SELECT name FROM employees WHERE id=?').get(r.employee_id);
        for (const a of admins()) notify(a.id,r.emergency_id,'Местонахождение не подтверждено',e.name,'missing_case_created');
        audit(null,'missing_case_created','missing_person_cases',Number(out.lastInsertRowid)); created.push(Number(out.lastInsertRowid));
      }
      return created;
    })();
    const witnesses = db.prepare("SELECT id FROM users WHERE role='EMPLOYEE' AND status='active'").all().map(u=>u.id);
    inserted.forEach(value => emit('missing_case_created',value,null,witnesses)); return inserted;
  }
  recover();
  const timer = setInterval(() => { try { recover(); } catch(e) { console.error('Deadline recovery:',e.message); } },1000); timer.unref();

  function data(user) {
    const admin = user.role === 'ADMIN';
    const employees = admin ? db.prepare(`SELECT e.*,s.id shift_id,s.started_at, p.id inspection_id,p.image_path,p.result,p.method,p.checked_at FROM employees e
      LEFT JOIN shifts s ON s.employee_id=e.id AND s.ended_at IS NULL LEFT JOIN ppe_inspections p ON p.id=s.inspection_id ORDER BY e.id DESC`).all() : [];
    const me = admin ? null : employee(user);
    const emergencies = db.prepare("SELECT * FROM emergencies ORDER BY id DESC").all();
    const allowed = admin ? null : db.prepare('SELECT DISTINCT emergency_id FROM evacuation_records WHERE employee_id=?').all(me.id).map(r=>r.emergency_id);
    const visible = admin ? emergencies : emergencies.filter(e=>allowed.includes(e.id));
    const records = db.prepare('SELECT r.*,e.name,e.department,e.user_id FROM evacuation_records r JOIN employees e ON e.id=r.employee_id').all().filter(r=>admin || r.employee_id===me.id);
    const cases = db.prepare(`SELECT c.*,e.name,e.department,s.started_at shift_started_at,p.image_path,p.id inspection_id FROM missing_person_cases c
      JOIN employees e ON e.id=c.employee_id JOIN evacuation_records r ON r.emergency_id=c.emergency_id AND r.employee_id=c.employee_id
      JOIN shifts s ON s.id=r.shift_id LEFT JOIN ppe_inspections p ON p.id=s.inspection_id ORDER BY c.id DESC`).all().filter(c=>admin || c.status!=='closed');
    const maps = db.prepare('SELECT * FROM factory_maps ORDER BY id DESC').all();
    return {employees,me,emergencies:visible,records,cases,maps,zones:db.prepare('SELECT * FROM factory_zones').all(),
      notifications:db.prepare('SELECT * FROM notifications WHERE recipient_id=? ORDER BY id DESC LIMIT 100').all(user.id),
      inspections: me ? db.prepare('SELECT * FROM ppe_inspections WHERE employee_id=? ORDER BY id DESC').all(me.id) : db.prepare("SELECT p.*,e.name FROM ppe_inspections p JOIN employees e ON e.id=p.employee_id WHERE p.result IN ('failed','unavailable','pending') ORDER BY p.id DESC").all(),
      shifts:db.prepare('SELECT * FROM shifts WHERE (?=1 OR employee_id=?) ORDER BY id DESC').all(admin?1:0,me?.id||0),
      reports:db.prepare('SELECT r.*,u.name author,z.name zone_name FROM last_seen_reports r JOIN users u ON u.id=r.reported_by LEFT JOIN factory_zones z ON z.id=r.zone_id ORDER BY observed_at DESC').all().filter(r=>cases.some(c=>c.id===r.case_id)),
      detections:admin?db.prepare('SELECT d.*,z.name zone_name FROM camera_detections d LEFT JOIN factory_zones z ON z.id=d.zone_id ORDER BY d.id DESC').all():[],
      jobs:admin?db.prepare('SELECT * FROM video_jobs ORDER BY id DESC').all():[],
      audit:admin?db.prepare('SELECT a.*,u.name actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200').all():[],
      cameras:admin?db.prepare('SELECT * FROM cameras').all():[],
      helmet_sessions:helmet.summary(user),server_time:now(),connected_clients:admin?streams.size:undefined,deadline_seconds:300};
  }
  app.get('/api/platform',auth,route((req,res)=>res.json(data(req.user))));
  app.patch('/api/notifications/read',auth,route((req,res)=>{ db.prepare('UPDATE notifications SET is_read=1 WHERE recipient_id=?').run(req.user.id);emit('notifications_read',null,req.user.id,[req.user.id]); res.json({ok:true}); }));

  function saveFile(body, kind) {
    const match = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(body.file || '');
    if (!match) fail('Выберите файл');
    let bytes = Buffer.from(match[2],'base64');
    if (!bytes.length || bytes.length>(kind==='video'?25:8)*1024*1024) fail('Превышен лимит файла');
    const isPng = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const isJpg = bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
    const isMp4 = bytes.subarray(4,8).toString()==='ftyp';
    const isWebm = bytes.subarray(0,4).equals(Buffer.from([26,69,223,163]));
    let ext;
    if (kind==='video') { if (match[1]==='video/mp4'&&isMp4) ext='.mp4'; else if (match[1]==='video/webm'&&isWebm) ext='.webm'; }
    else { if (match[1]==='image/png'&&isPng) ext='.png'; else if (match[1]==='image/jpeg'&&isJpg) ext='.jpg'; else if(kind==='map'&&match[1]==='image/svg+xml'){try{bytes=sanitizeSvg(bytes);ext='.svg';}catch(error){fail(error.message);}} }
    if (!ext) fail('Разрешены PNG/JPG, безопасный SVG для планов и MP4/WebM для видео');
    const filename = crypto.randomUUID()+ext; fs.writeFileSync(path.join(uploads,filename),bytes,{flag:'wx'}); return filename;
  }
  function sendFile(res,filename) { res.set('Cache-Control','private, no-store');if(filename.endsWith('.svg'))res.set('Content-Security-Policy',"default-src 'none'; sandbox"); res.sendFile(path.join(uploads,path.basename(filename))); }
  function python(args) {
    return new Promise((resolve,reject)=>{
      const venvPython = path.join(root,'.venv',process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python');
      const child=spawn(process.env.PYTHON || (fs.existsSync(venvPython)?venvPython:'python'),args,{cwd:root,windowsHide:true});
      let stdout='',stderr='',settled=false;
      const timeout=setTimeout(()=>{child.kill();done(new Error('Превышено время анализа'));},120000);
      function done(error){if(settled)return;settled=true;clearTimeout(timeout);error?reject(error):resolve(stdout);}
      child.stdout.on('data',c=>{stdout=(stdout+c).slice(-2000000);}); child.stderr.on('data',c=>{stderr=(stderr+c).slice(-3000);});
      child.on('error',done); child.on('close',code=>done(code===0?null:new Error(stderr || `Python: код ${code}`)));
    });
  }
  app.post('/api/ppe',auth,route(async(req,res)=>{
    const e=employee(req.user); const file=saveFile(req.body,'image');
    const pid=Number(db.prepare("INSERT INTO ppe_inspections(employee_id,image_path,result,method,checked_at) VALUES(?,?,'pending','AI',?)").run(e.id,file,now()).lastInsertRowid);
    try {
      const output=await python([path.join(root,'scripts','inspect_ppe.py'),'--image',path.join(uploads,file),'--model',path.join(root,'outfit','outfitcheck.pt')]);
      const result=JSON.parse(output.trim().split('\n').at(-1));
      db.prepare('UPDATE ppe_inspections SET result=?,helmet_detected=?,vest_detected=?,details=?,checked_at=? WHERE id=?').run(result.passed?'passed':'failed',Number(result.helmet),Number(result.vest),JSON.stringify(result),now(),pid);
    } catch(error) { db.prepare("UPDATE ppe_inspections SET result='unavailable',details=? WHERE id=?").run('AI недоступен: '+error.message.slice(-1200),pid); }
    audit(req.user.id,'ppe_check_completed','ppe_inspections',pid); emit('ppe_check_completed',pid,req.user.id,[req.user.id]); res.status(201).json(db.prepare('SELECT * FROM ppe_inspections WHERE id=?').get(pid));
  }));
  app.get('/api/ppe/:id/photo',auth,route((req,res)=>{
    const p=db.prepare('SELECT p.*,e.user_id FROM ppe_inspections p JOIN employees e ON e.id=p.employee_id WHERE p.id=?').get(id(req.params.id));
    if(!p?.image_path)fail('Фото отсутствует',404);
    const activeCase=db.prepare(`SELECT c.id FROM missing_person_cases c
      JOIN evacuation_records r ON r.emergency_id=c.emergency_id AND r.employee_id=c.employee_id
      JOIN shifts s ON s.id=r.shift_id WHERE c.employee_id=? AND c.status!='closed' AND s.inspection_id=?`).get(p.employee_id,p.id);
    if(req.user.role!=='ADMIN'&&p.user_id!==req.user.id&&!activeCase)fail('Нет доступа к фото',403); sendFile(res,p.image_path);
  }));
  app.delete('/api/ppe/:id/photo',auth,managerOnly,route((req,res)=>{
    const p=db.prepare('SELECT * FROM ppe_inspections WHERE id=?').get(id(req.params.id)); if(!p)fail('Проверка не найдена',404);
    db.prepare('UPDATE ppe_inspections SET image_path=NULL WHERE id=?').run(p.id); if(p.image_path)fs.rmSync(path.join(uploads,path.basename(p.image_path)),{force:true});
    const owner=db.prepare('SELECT user_id FROM employees WHERE id=?').get(p.employee_id);
    audit(req.user.id,'photo_deleted','ppe_inspections',p.id); emit('photo_deleted',p.id,req.user.id,[owner.user_id]);res.json({ok:true});
  }));
  app.post('/api/ppe/:id/approve',auth,managerOnly,route((req,res)=>{
    const comment=text(req.body.comment,'Основание ручной проверки');
    const p=db.prepare('SELECT * FROM ppe_inspections WHERE id=?').get(id(req.params.id)); if(!p)fail('Проверка не найдена',404);
    if(p.result==='pending')fail('Дождитесь окончания AI-проверки',409);
    db.transaction(()=>{ db.prepare("UPDATE ppe_inspections SET result='approved',method='manual',approved_by=?,approved_at=? WHERE id=?").run(req.user.id,now(),p.id); audit(req.user.id,'ppe_manually_approved','ppe_inspections',p.id,{comment}); })();
    const u=db.prepare('SELECT user_id FROM employees WHERE id=?').get(p.employee_id); emit('ppe_check_completed',p.id,req.user.id,[u.user_id]);res.json({ok:true});
  }));
  app.post('/api/shifts/start',auth,route((req,res)=>{
    const e=employee(req.user);
    const sid=db.transaction(()=>{
      if(db.prepare("SELECT id FROM emergencies WHERE status='active'").get())fail('Начало смены во время ЧП запрещено',409);
      let p=null;
      if(req.body.inspection_id!==undefined&&req.body.inspection_id!==null){
        p=db.prepare("SELECT * FROM ppe_inspections WHERE id=? AND employee_id=? AND result IN ('passed','approved')").get(id(req.body.inspection_id),e.id);
        if(!p || Date.now()-Date.parse(p.checked_at)>3600000)fail('Проверка не найдена или устарела',409);
      }
      const sid=Number(db.prepare('INSERT INTO shifts(employee_id,inspection_id,started_at) VALUES(?,?,?)').run(e.id,p?.id||null,now()).lastInsertRowid);
      db.prepare("UPDATE employees SET status='on_shift',last_seen=? WHERE id=?").run(now(),e.id);
      for(const a of admins())notify(a.id,null,'Сотрудник начал смену',e.name,'shift_started');
      audit(req.user.id,'shift_started','shifts',sid);return sid;
    })(); emit('shift_started',sid,req.user.id,[req.user.id]);res.status(201).json({id:sid});
  }));
  app.post('/api/shifts/end',auth,route((req,res)=>{
    const e=employee(req.user);
    db.transaction(()=>{ const s=db.prepare('SELECT * FROM shifts WHERE employee_id=? AND ended_at IS NULL').get(e.id);if(!s)fail('Нет активной смены',409);
      db.prepare("UPDATE shifts SET ended_at=?,status='ended' WHERE id=?").run(now(),s.id);db.prepare("UPDATE employees SET status='off_shift' WHERE id=?").run(e.id);audit(req.user.id,'shift_ended','shifts',s.id);
    })();emit('shift_ended',e.id,req.user.id,[req.user.id]);res.json({ok:true});
  }));
  app.post('/api/emergencies',auth,managerOnly,route((req,res)=>{
    const title=text(req.body.title,'Заголовок',160), description=text(req.body.description,'Сообщение',4000);
    if(!['fire','gas','equipment','chemical','other'].includes(req.body.type)||!['warning','critical'].includes(req.body.severity))fail('Проверьте тип и критичность');
    const recipients=[];
    const eid=db.transaction(()=>{
      const eid=Number(db.prepare('INSERT INTO emergencies(type,title,description,severity,zone_id,created_by,started_at) VALUES(?,?,?,?,?,?,?)').run(req.body.type,title,description,req.body.severity,req.body.zone_id||null,req.user.id,now()).lastInsertRowid);
      const shifts=db.prepare('SELECT s.*,e.user_id FROM shifts s JOIN employees e ON e.id=s.employee_id WHERE s.ended_at IS NULL').all();
      for(const s of shifts){ db.prepare('INSERT INTO evacuation_records(emergency_id,employee_id,shift_id,notified_at) VALUES(?,?,?,?)').run(eid,s.employee_id,s.id,now()); notify(s.user_id,eid,title,description,'emergency_created');recipients.push(s.user_id); }
      audit(req.user.id,'emergency_created','emergencies',eid,{recipients:recipients.length});return eid;
    })();emit('emergency_created',eid,req.user.id,recipients);res.status(201).json({id:eid,recipients:recipients.length});
  }));
  app.post('/api/emergencies/:id/safe',auth,route((req,res)=>{
    const e=employee(req.user), eid=id(req.params.id);
    let resolved=false;
    db.transaction(()=>{
      const r=db.prepare("SELECT r.* FROM evacuation_records r JOIN emergencies e ON e.id=r.emergency_id WHERE r.emergency_id=? AND r.employee_id=?").get(eid,e.id);
      if(!r)fail('Вы не участвуете в активной эвакуации',403);
      if(r.safe_confirmed_at)return;
      if(!db.prepare("SELECT id FROM emergencies WHERE id=? AND status='active'").get(eid))fail('Эвакуация уже завершена',409);
      db.prepare("UPDATE evacuation_records SET safe_confirmed_at=?,status='self_reported',verification_method='self' WHERE id=?").run(now(),r.id);
      db.prepare("UPDATE missing_person_cases SET status='awaiting_safety' WHERE emergency_id=? AND employee_id=? AND status NOT IN ('closed','safe')").run(eid,e.id);
      for(const a of admins())notify(a.id,eid,'Сообщил, что в безопасности',e.name,'safety_confirmed');audit(req.user.id,'self_reported_safe','emergencies',eid);
      const pending=db.prepare('SELECT COUNT(*) c FROM evacuation_records WHERE emergency_id=? AND safe_confirmed_at IS NULL AND verified_at IS NULL').get(eid).c;
      const open=db.prepare("SELECT COUNT(*) c FROM missing_person_cases WHERE emergency_id=? AND status!='closed'").get(eid).c;
      if(!pending&&!open){
        const comment='Все участники эвакуации сообщили о безопасности';
        db.prepare("UPDATE emergencies SET status='resolved',resolved_at=?,resolution_note=? WHERE id=? AND status='active'").run(now(),comment,eid);
        audit(req.user.id,'emergency_resolved','emergencies',eid,{comment,automatic:true});resolved=true;
        for(const a of admins())notify(a.id,eid,'Сбор подтверждений завершён',comment,'emergency_resolved');
      }
    })();const recipients=db.prepare('SELECT e.user_id FROM evacuation_records r JOIN employees e ON e.id=r.employee_id WHERE r.emergency_id=?').all(eid).map(r=>r.user_id);
    emit(resolved?'emergency_resolved':'safety_confirmed',eid,req.user.id,recipients);res.json({ok:true,resolved});
  }));
  app.post('/api/emergencies/:id/resolve',auth,managerOnly,route((req,res)=>{
    const eid=id(req.params.id),comment=text(req.body.comment,'Итоговый комментарий');
    db.transaction(()=>{
      const e=db.prepare("SELECT * FROM emergencies WHERE id=? AND status='active'").get(eid);if(!e)fail('Нет активного ЧП',409);
      const pending=db.prepare('SELECT COUNT(*) c FROM evacuation_records WHERE emergency_id=? AND safe_confirmed_at IS NULL AND verified_at IS NULL').get(eid).c;
      const open=db.prepare("SELECT COUNT(*) c FROM missing_person_cases WHERE emergency_id=? AND status!='closed'").get(eid).c;
      if((pending||open)&&req.body.force!==true)fail('Есть неподтвержденные сотрудники или незакрытые поиски. Требуется явное подтверждение',409);
      db.prepare("UPDATE emergencies SET status='resolved',resolved_at=?,resolution_note=? WHERE id=?").run(now(),comment,eid);audit(req.user.id,'emergency_resolved','emergencies',eid,{comment,force:req.body.force===true,pending,open});
    })();emit('emergency_resolved',eid,req.user.id,db.prepare('SELECT e.user_id FROM evacuation_records r JOIN employees e ON e.id=r.employee_id WHERE r.emergency_id=?').all(eid).map(r=>r.user_id));res.json({ok:true});
  }));
  app.patch('/api/cases/:id',auth,managerOnly,route((req,res)=>{
    const c=caseRow(req.params.id),status=req.body.status,comment=text(req.body.comment,'Источник и комментарий');
    const transitions={unconfirmed:['searching','located','safe'],searching:['located','safe'],observation:['searching','located','safe'],located:['awaiting_safety','safe'],awaiting_safety:['located','safe'],safe:['closed'],closed:[]};
    if(!transitions[c.status].includes(status))fail('Недопустимый переход статуса',409);
    db.transaction(()=>{
      db.prepare('UPDATE missing_person_cases SET status=?,source=?,services_informed=?,comment=?,found_at=CASE WHEN ?=\'located\' THEN ? ELSE found_at END,safety_confirmed_at=CASE WHEN ?=\'safe\' THEN ? ELSE safety_confirmed_at END,closed_at=CASE WHEN ?=\'closed\' THEN ? ELSE closed_at END,closed_by=CASE WHEN ?=\'closed\' THEN ? ELSE closed_by END WHERE id=?')
        .run(status,comment,req.body.services_informed===true?1:0,comment,status,now(),status,now(),status,now(),status,req.user.id,c.id);
      if(status==='safe')db.prepare("UPDATE evacuation_records SET status='verified',verified_at=?,verification_method='admin' WHERE emergency_id=? AND employee_id=?").run(now(),c.emergency_id,c.employee_id);
      audit(req.user.id,'search_status_changed','missing_person_cases',c.id,{from:c.status,status,comment,services_informed:req.body.services_informed===true});
    })();emit('search_status_changed',c.id,req.user.id,db.prepare("SELECT id FROM users WHERE role='EMPLOYEE'").all().map(u=>u.id));res.json({ok:true});
  }));
  app.post('/api/maps',auth,managerOnly,route((req,res)=>{
    const name=text(req.body.name,'Название плана',120),file=saveFile(req.body,'map');
    const mid=Number(db.prepare('INSERT INTO factory_maps(name,file_path,created_at) VALUES(?,?,?)').run(name,file,now()).lastInsertRowid);audit(req.user.id,'map_uploaded','factory_maps',mid);emit('map_updated',mid,req.user.id,db.prepare("SELECT id FROM users WHERE role='EMPLOYEE'").all().map(u=>u.id));res.status(201).json({id:mid});
  }));
  app.get('/api/maps/:id/image',auth,route((req,res)=>{const map=db.prepare('SELECT * FROM factory_maps WHERE id=?').get(id(req.params.id));if(!map)fail('План не найден',404);sendFile(res,map.file_path);}));
  app.post('/api/zones',auth,managerOnly,route((req,res)=>{
    const points=req.body.points;
    if(!Array.isArray(points)||points.length<3||points.length>100||!points.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1)))fail('Укажите минимум три точки границы зоны');
    const zid=Number(db.prepare('INSERT INTO factory_zones(map_id,name,polygon_data) VALUES(?,?,?)').run(id(req.body.map_id),text(req.body.name,'Название зоны',120),JSON.stringify(points)).lastInsertRowid);audit(req.user.id,'zone_created','factory_zones',zid);emit('map_updated',zid,req.user.id,db.prepare("SELECT id FROM users WHERE role='EMPLOYEE'").all().map(u=>u.id));res.status(201).json({id:zid});
  }));
  app.post('/api/cases/:id/reports',auth,route((req,res)=>{
    const c=caseRow(req.params.id);if(c.status==='closed')fail('Поиск закрыт',409);
    const x=req.body.map_x,y=req.body.map_y;
    if(![x,y].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1))fail('Выберите точку на карте');
    const observed=date(req.body.observed_at),description=text(req.body.description,'Комментарий'),mapId=id(req.body.map_id);
    if(req.body.zone_id&&!db.prepare('SELECT id FROM factory_zones WHERE id=? AND map_id=?').get(id(req.body.zone_id),mapId))fail('Зона не относится к плану');
    const rid=db.transaction(()=>{
      const rid=Number(db.prepare('INSERT INTO last_seen_reports(case_id,reported_by,map_id,zone_id,map_x,map_y,observed_at,description,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(c.id,req.user.id,mapId,req.body.zone_id||null,x,y,observed,description,now()).lastInsertRowid);
      db.prepare("UPDATE missing_person_cases SET status='observation' WHERE id=? AND status IN ('unconfirmed','searching')").run(c.id);
      for(const a of admins())notify(a.id,c.emergency_id,'Новое сообщение очевидца',description,'last_seen_report_created');audit(req.user.id,'last_seen_report_created','last_seen_reports',rid);return rid;
    })();emit('last_seen_report_created',rid,req.user.id,db.prepare("SELECT id FROM users WHERE role='EMPLOYEE'").all().map(u=>u.id));res.status(201).json({id:rid});
  }));
  app.post('/api/cameras',auth,managerOnly,route((req,res)=>{
    const cid=Number(db.prepare('INSERT INTO cameras(name,zone_id,source) VALUES(?,?,?)').run(text(req.body.name,'Камера',120),id(req.body.zone_id),text(req.body.source,'Источник',500)).lastInsertRowid);
    audit(req.user.id,'camera_configured','cameras',cid);emit('camera_configured',cid,req.user.id);res.status(201).json({id:cid});
  }));
  app.post('/api/telemetry',auth,managerOnly,route((req,res)=>{
    if(typeof req.body.value!=='number'||!Number.isFinite(req.body.value)||!['normal','warning','critical'].includes(req.body.status))fail('Некорректное измерение');
    const type=text(req.body.type,'Показатель',120),zone=text(req.body.zone,'Зона',120),unit=text(req.body.unit,'Единица измерения',30),source=text(req.body.source,'Источник',300);
    const s=db.prepare('SELECT id FROM sensors WHERE type=? AND zone=?').get(type,zone);
    db.transaction(()=>{
      if(s)db.prepare('UPDATE sensors SET value=?,unit=?,status=?,updated_at=?,source=? WHERE id=?').run(req.body.value,unit,req.body.status,now(),source,s.id);
      else db.prepare('INSERT INTO sensors(type,zone,value,unit,status,updated_at,source) VALUES(?,?,?,?,?,?,?)').run(type,zone,req.body.value,unit,req.body.status,now(),source);
      audit(req.user.id,'telemetry_received','sensors',s?.id||null,{type,zone,source});
    })();emit('telemetry_received',s?.id||null,req.user.id);res.json({ok:true});
  }));
  app.post('/api/cases/:id/videos',auth,managerOnly,route((req,res)=>{
    const c=caseRow(req.params.id);if(c.status==='closed')fail('Поиск закрыт',409);
    const zone=id(req.body.zone_id),recorded=date(req.body.recorded_at);
    if(!db.prepare('SELECT id FROM factory_zones WHERE id=?').get(zone))fail('Зона не найдена');
    const file=saveFile(req.body,'video');
    const jid=Number(db.prepare("INSERT INTO video_jobs(case_id,zone_id,file_path,recorded_at,status,created_by,created_at) VALUES(?,?,?,?,'processing',?,?)").run(c.id,zone,file,recorded,req.user.id,now()).lastInsertRowid);
    const output=path.join(uploads,`${jid}-detections.json`);
    python([path.join(root,'scripts','analyze_yolo_video.py'),'--model',path.join(root,'outfit','outfitcheck.pt'),'--video',path.join(uploads,file),'--output',output]).then(()=>{
      const payload=JSON.parse(fs.readFileSync(output,'utf8'));
      db.transaction(()=>{
        const insert=db.prepare('INSERT INTO camera_detections(job_id,case_id,zone_id,detected_at,time_offset,confidence,box_data) VALUES(?,?,?,?,?,?,?)');
        for(const frame of payload.frames.filter((_,i)=>i%Math.max(1,Math.round(payload.video.fps))===0))for(const d of frame.detections.filter(d=>d.label.toLowerCase()==='person'))insert.run(jid,c.id,zone,new Date(Date.parse(recorded)+frame.time*1000).toISOString(),frame.time,d.confidence,JSON.stringify({box:d.box,width:payload.video.width,height:payload.video.height}));
        if(db.prepare('SELECT COUNT(*) n FROM camera_detections WHERE job_id=?').get(jid).n)db.prepare("UPDATE missing_person_cases SET status='observation' WHERE id=? AND status IN ('unconfirmed','searching')").run(c.id);
        db.prepare("UPDATE video_jobs SET status='ready' WHERE id=?").run(jid);audit(req.user.id,'ai_detection_created','video_jobs',jid);
      })();emit('ai_detection_created',jid,req.user.id);
    }).catch(error=>{db.prepare("UPDATE video_jobs SET status='unavailable',error=? WHERE id=?").run(error.message.slice(-1200),jid);emit('ai_unavailable',jid,req.user.id);});
    res.status(202).json({id:jid});
  }));
  app.get('/api/videos/:id',auth,managerOnly,route((req,res)=>{const j=db.prepare('SELECT * FROM video_jobs WHERE id=?').get(id(req.params.id));if(!j)fail('Видео не найдено',404);sendFile(res,j.file_path);}));
  app.patch('/api/detections/:id',auth,managerOnly,route((req,res)=>{
    if(!['rejected','possible_match','identity_confirmed'].includes(req.body.status))fail('Некорректный статус');
    const d=db.prepare('SELECT * FROM camera_detections WHERE id=?').get(id(req.params.id));if(!d)fail('Наблюдение не найдено',404);
    const note=text(req.body.comment,'Основание проверки');db.prepare('UPDATE camera_detections SET verification_status=?,reviewed_by=?,review_note=? WHERE id=?').run(req.body.status,req.user.id,note,d.id);
    audit(req.user.id,'detection_reviewed','camera_detections',d.id,{status:req.body.status,note});emit('search_status_changed',d.case_id,req.user.id);res.json({ok:true});
  }));
  const helmet=require('./helmet')({app,db,auth,managerOnly,root,emit,audit,notify,route,fail,id});
  return { recover, data, helmet, close(){helmet.close();clearInterval(timer);for(const s of streams)s.res.end();} };
};
