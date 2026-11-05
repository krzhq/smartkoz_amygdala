const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {HelmetState}=require('./helmet-state');
const {HelmetWorker}=require('./helmet-worker');

const MESSAGES={
  EYES_CLOSED_WARNING:'Внимание! Глаза закрыты более 3 секунд. Возможная сонливость или ухудшение самочувствия',
  VISIBILITY_LOST:'Возможное снятие каски: глаза не обнаружены камерой',
  CAMERA_DISCONNECTED:'Соединение с камерой потеряно',
  AI_UNAVAILABLE:'AI-мониторинг недоступен'
};
module.exports=function helmet({app,db,auth,managerOnly,root,emit,audit,notify,route,fail,id}){
  db.exec(`
    CREATE TABLE IF NOT EXISTS helmet_sessions (
      id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), shift_id INTEGER NOT NULL REFERENCES shifts(id),
      started_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL, camera_status TEXT NOT NULL,
      last_frame_at TEXT, last_analysis_at TEXT, last_sequence INTEGER NOT NULL DEFAULT 0,
      producer_hash TEXT NOT NULL, last_result TEXT, model_name TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_helmet_employee ON helmet_sessions(employee_id) WHERE ended_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_helmet_shift ON helmet_sessions(shift_id) WHERE ended_at IS NULL;
    CREATE TABLE IF NOT EXISTS helmet_events (
      id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES helmet_sessions(id), employee_id INTEGER NOT NULL REFERENCES employees(id),
      event_type TEXT NOT NULL CHECK(event_type IN ('EYES_CLOSED_WARNING','VISIBILITY_LOST','CAMERA_DISCONNECTED','AI_UNAVAILABLE')),
      severity TEXT NOT NULL, started_at TEXT NOT NULL, triggered_at TEXT NOT NULL, ended_at TEXT,
      duration_seconds REAL NOT NULL DEFAULT 0, confidence REAL, acknowledged_at TEXT, acknowledged_by INTEGER REFERENCES users(id), end_reason TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_helmet_event ON helmet_events(session_id,event_type) WHERE ended_at IS NULL;
    CREATE INDEX IF NOT EXISTS helmet_events_employee ON helmet_events(employee_id,id);
  `);
  const worker=new HelmetWorker(root),runtimes=new Map(),previews=new Map();
  const now=()=>new Date().toISOString(),hash=t=>crypto.createHash('sha256').update(t).digest('hex');
  const fullSession=value=>db.prepare(`SELECT h.*,e.name,e.user_id,s.ended_at shift_ended_at FROM helmet_sessions h JOIN employees e ON e.id=h.employee_id JOIN shifts s ON s.id=h.shift_id WHERE h.id=?`).get(id(value));
  function requireSession(req){const s=fullSession(req.params.id);if(!s)fail('Сессия каски не найдена',404);if(req.user.role!=='ADMIN'&&s.user_id!==req.user.id)fail('Нет доступа к этой сессии',403);return s;}
  function producer(req,s){
    if(req.user.role!=='EMPLOYEE'||s.user_id!==req.user.id)fail('Передавать кадры может только сотрудник этой смены',403);
    const token=req.body.producer_token;
    if(typeof token!=='string'||token.length!==64||!crypto.timingSafeEqual(Buffer.from(hash(token),'hex'),Buffer.from(s.producer_hash,'hex')))fail('Эта камера не владеет сессией. Используйте исходную вкладку или завершите сессию',403);
    if(s.ended_at||s.shift_ended_at)fail('Сессия или смена завершена',409);
  }
  function serialize(s){
    const {producer_hash,shift_ended_at,...publicRow}=s;
    const runtime=runtimes.get(s.id);
    return {...publicRow,result:runtime?.result||JSON.parse(s.last_result||'null'),frame_available:Boolean(runtime?.frame),model:worker.info.model};
  }
  function event(s,e){
    const iso=new Date(e.wall).toISOString();
    db.transaction(()=>{
      if(e.action==='start'){
        const created=db.prepare('INSERT OR IGNORE INTO helmet_events(session_id,employee_id,event_type,severity,started_at,triggered_at,confidence) VALUES(?,?,?,?,?,?,?)')
          .run(s.id,s.employee_id,e.type,e.type==='EYES_CLOSED_WARNING'?'critical':'warning',iso,new Date(e.triggered).toISOString(),e.confidence??null);
        if(!created.changes)return;
        for(const admin of db.prepare("SELECT id FROM users WHERE role='ADMIN' AND status='active'").all())notify(admin.id,null,`Smart Helmet · ${s.name}`,`${MESSAGES[e.type]}. Сотрудник: ${s.name}`,'helmet_alert');
        audit(s.user_id,'helmet_alert_created','helmet_events',Number(created.lastInsertRowid),{session_id:s.id,type:e.type});
      }else{
        db.prepare('UPDATE helmet_events SET ended_at=?,duration_seconds=?,end_reason=? WHERE session_id=? AND event_type=? AND ended_at IS NULL').run(iso,e.duration,e.reason||'evidence_recovered',s.id,e.type);
      }
    })();
    emit(e.action==='start'?'helmet_alert_created':'helmet_alert_resolved',s.id,s.user_id,[s.user_id]);
  }
  function runtime(s){
    if(!runtimes.has(s.id)){
      const restored=db.prepare('SELECT * FROM helmet_events WHERE session_id=? AND ended_at IS NULL').all(s.id);
      const engine=new HelmetState(e=>event(s,e),restored);
      runtimes.set(s.id,{engine,result:null,frame:null,inflight:false,received:null,cameraSignal:null,lastSubmit:-Infinity,times:[],generation:0});
    }
    return runtimes.get(s.id);
  }
  function save(s,r,status){
    const result={...(r.result||{}),...status};r.result=result;
    db.prepare('UPDATE helmet_sessions SET status=?,last_result=? WHERE id=?').run(status.status,JSON.stringify(result),s.id);
    emit('helmet_status',s.id,s.user_id,[s.user_id]);return result;
  }
  function stop(s,reason='user_stopped',actor=s.user_id){
    const r=runtime(s);r.generation++;r.engine.onEvent=e=>event(s,{...e,reason});
    const result=r.engine.stop(Date.now());
    db.prepare("UPDATE helmet_sessions SET ended_at=?,status='STOPPED',camera_status='stopped',last_result=? WHERE id=? AND ended_at IS NULL").run(now(),JSON.stringify(result),s.id);
    r.frame=null;r.result=result;runtimes.delete(s.id);audit(actor,'helmet_session_stopped','helmet_sessions',s.id,{reason});emit('helmet_session_stopped',s.id,actor,[s.user_id]);
    if(!previews.size&&!db.prepare('SELECT id FROM helmet_sessions WHERE ended_at IS NULL LIMIT 1').get())worker.close();
  }
  function sweep(){
    for(const [user,p] of previews)if(!p.inflight&&performance.now()-p.last>15000)previews.delete(user);
    if(!previews.size&&worker.child&&!worker.pending&&!db.prepare('SELECT id FROM helmet_sessions WHERE ended_at IS NULL LIMIT 1').get())worker.close();
    for(const s of db.prepare(`SELECT h.*,e.name,e.user_id,s.ended_at shift_ended_at FROM helmet_sessions h JOIN employees e ON e.id=h.employee_id JOIN shifts s ON s.id=h.shift_id WHERE h.ended_at IS NULL`).all()){
      if(s.shift_ended_at){stop(s,'shift_ended');continue;}
      const r=runtime(s),last=r.cameraSignal;
      // Network/capture loss is independent of model absence or missing eye boxes.
      const elapsed=last===null?Date.now()-Date.parse(s.last_frame_at||s.started_at):performance.now()-last;
      if(elapsed>6000&&s.camera_status!=='disconnected'){
        r.frame=null;r.generation++;db.prepare("UPDATE helmet_sessions SET camera_status='disconnected' WHERE id=?").run(s.id);
        save(s,r,r.engine.fault('CAMERA_DISCONNECTED',performance.now(),Date.now()));
      }else if(elapsed<=6000&&s.last_analysis_at&&Date.now()-Date.parse(s.last_analysis_at)>6000&&s.status!=='AI_UNAVAILABLE'&&s.status!=='AI_LOADING'){
        r.frame=null;save(s,r,r.engine.fault('AI_UNAVAILABLE',performance.now(),Date.now()));
      }
    }
  }
  // Keep history and producer identity across restart; never restore an old NORMAL.
  for(const s of db.prepare(`SELECT h.*,e.name,e.user_id FROM helmet_sessions h JOIN employees e ON e.id=h.employee_id WHERE h.ended_at IS NULL`).all()){
    db.prepare("UPDATE helmet_sessions SET camera_status='disconnected' WHERE id=?").run(s.id);
    save(s,runtime(s),runtime(s).engine.fault('CAMERA_DISCONNECTED',performance.now(),Date.now()));
  }
  const timer=setInterval(()=>{try{sweep();}catch(error){console.error('Helmet watchdog:',error.message);}},1000);timer.unref();
  function summary(user){
    return db.prepare(`SELECT h.id,h.employee_id,h.shift_id,h.status,h.camera_status,h.started_at,h.ended_at,h.last_analysis_at,h.last_frame_at FROM helmet_sessions h
      JOIN employees e ON e.id=h.employee_id WHERE (?='ADMIN' OR e.user_id=?) ORDER BY h.id DESC`).all(user.role,user.id);
  }
  app.get('/api/helmet',auth,route((req,res)=>{
    res.set('Cache-Control','no-store');
    const sessions=db.prepare(`SELECT h.*,e.name,e.user_id FROM helmet_sessions h JOIN employees e ON e.id=h.employee_id WHERE (?='ADMIN' OR e.user_id=?) ORDER BY h.id DESC LIMIT 100`).all(req.user.role,req.user.id).map(serialize);
    const events=db.prepare(`SELECT v.*,e.name FROM helmet_events v JOIN employees e ON e.id=v.employee_id WHERE (?='ADMIN' OR e.user_id=?) ORDER BY v.id DESC LIMIT 150`).all(req.user.role,req.user.id);
    res.json({model:{...worker.info,error:worker.info.status==='error'?'AI-мониторинг недоступен. Проверьте Python, зависимости и файл модели.':null},sessions,events,server_time:now(),max_fps:4,thresholds:{closed_seconds:3,visibility_seconds:2,camera_timeout_seconds:6}});
  }));
  app.post('/api/helmet/sessions',auth,route((req,res)=>{
    if(req.user.role!=='EMPLOYEE')fail('Камеру запускает сотрудник на активной смене; руководство подключается к его сессии',403);
    const e=db.prepare('SELECT * FROM employees WHERE user_id=?').get(req.user.id);
    const shift=e&&db.prepare('SELECT * FROM shifts WHERE employee_id=? AND ended_at IS NULL').get(e.id);
    if(!shift)fail('Перед мониторингом необходимо начать смену',409);
    const existing=db.prepare('SELECT id FROM helmet_sessions WHERE employee_id=? AND ended_at IS NULL').get(e.id);
    if(existing)return res.status(409).json({error:'У сотрудника уже есть активная сессия. Подключитесь к ней из исходной вкладки или завершите её.',session_id:existing.id});
    const token=crypto.randomBytes(32).toString('hex');
    const sid=Number(db.prepare("INSERT INTO helmet_sessions(employee_id,shift_id,started_at,status,camera_status,producer_hash,model_name) VALUES(?,?,?,'WARMING_UP','connecting',?,?)").run(e.id,shift.id,now(),hash(token),worker.info.model).lastInsertRowid);
    audit(req.user.id,'helmet_session_started','helmet_sessions',sid);runtime(fullSession(sid));worker.start();emit('helmet_session_started',sid,req.user.id,[req.user.id]);
    res.status(201).json({session:serialize(fullSession(sid)),producer_token:token});
  }));
  app.post('/api/helmet/sessions/:id/resume',auth,route((req,res)=>{
    const s=requireSession(req);producer(req,s);const r=runtime(s);r.generation++;r.engine.resetEvidence();r.received=performance.now();r.cameraSignal=r.received;r.frame=null;
    db.prepare("UPDATE helmet_sessions SET camera_status='connecting',last_frame_at=? WHERE id=?").run(now(),s.id);save(s,r,{...r.engine.snapshot(),status:'WARMING_UP'});worker.start();res.json({session:serialize(fullSession(s.id))});
  }));
  app.post('/api/helmet/sessions/:id/frames',auth,route(async(req,res)=>{
    const s=requireSession(req);producer(req,s);const r=runtime(s),mono=performance.now(),wall=Date.now();
    const sequence=req.body.sequence;
    if(!Number.isSafeInteger(sequence)||sequence<=s.last_sequence)fail('Кадр устарел или повторяется',409);
    if(typeof req.body.image!=='string'||req.body.image.length>360000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(req.body.image))fail('Ожидается JPEG-кадр до 260 КБ',400);
    const b64=req.body.image.slice(req.body.image.indexOf(',')+1),bytes=Buffer.from(b64,'base64');
    if(bytes.length>260000||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)fail('Некорректный JPEG');
    if(r.inflight||mono-r.lastSubmit<250){res.set('Retry-After','1');fail('Отправляйте только свежие кадры, максимум 4 кадра/с',429);}
    r.received=mono;r.cameraSignal=mono;r.lastSubmit=mono;
    db.prepare("UPDATE helmet_sessions SET last_frame_at=?,last_sequence=?,camera_status='connected' WHERE id=?").run(new Date(wall).toISOString(),sequence,s.id);
    r.inflight=true;
    const generation=r.generation;
    try{
      const result=await worker.infer(b64);
      // Never publish a late result after the owning shift/session has ended.
      const current=fullSession(s.id);if(current.ended_at||current.shift_ended_at)fail('Смена или мониторинг завершены',409);
      if(r.generation!==generation)fail('Кадр относится к уже отключённой камере',409);
      if(performance.now()-mono>2000){save(s,r,r.engine.fault('AI_UNAVAILABLE',performance.now(),Date.now()));fail('AI обрабатывает кадр слишком долго; снизьте нагрузку',503);}
      const completed=performance.now();r.times.push(completed);r.times=r.times.slice(-12);
      const fps=r.times.length>1?(r.times.length-1)*1000/(completed-r.times[0]):null;
      const state=r.engine.sample(result,mono,wall);
      r.result={...result,...state,sequence,analyzed_at:now(),fps:fps===null?null:Math.round(fps*10)/10};
      r.frame={image:req.body.image,result:r.result};
      db.prepare('UPDATE helmet_sessions SET status=?,camera_status=?,last_analysis_at=?,last_result=? WHERE id=?').run(state.status,'connected',now(),JSON.stringify(r.result),s.id);
      emit('helmet_frame',s.id,req.user.id,[req.user.id]);res.json({session_id:s.id,...r.result});
    }catch(error){
      if(fullSession(s.id).ended_at)fail('Мониторинг завершён',409);
      if(error.status!==429&&error.status!==409){
        if(error.loading){save(s,r,{...r.engine.snapshot(),status:'AI_LOADING'});}
        else{r.frame=null;save(s,r,r.engine.fault('AI_UNAVAILABLE',performance.now(),Date.now()));console.error('Helmet AI:',error.message);}
      }
      if(error.status)throw error;fail('AI-мониторинг недоступен. Проверьте модель и повторите подключение',503);
    }finally{r.inflight=false;}
  }));
  app.get('/api/helmet/sessions/:id/frame',auth,route((req,res)=>{
    const s=requireSession(req);res.set('Cache-Control','no-store');const r=runtimes.get(s.id);
    if(!r?.frame||s.ended_at||s.camera_status==='disconnected')return res.status(404).json({error:'Свежего обработанного кадра нет',session:serialize(s)});
    res.json({...r.frame,session:serialize(s)});
  }));
  app.post('/api/helmet/sessions/:id/stop',auth,route((req,res)=>{
    const s=requireSession(req);if(!s.ended_at)stop(s,req.user.role==='ADMIN'?'admin_stopped':'user_stopped',req.user.id);res.json({ok:true});
  }));
  app.post('/api/helmet/sessions/:id/disconnect',auth,route((req,res)=>{
    const s=requireSession(req);producer(req,s);const r=runtime(s);r.generation++;r.frame=null;
    db.prepare("UPDATE helmet_sessions SET camera_status='disconnected' WHERE id=?").run(s.id);save(s,r,r.engine.fault('CAMERA_DISCONNECTED',performance.now(),Date.now()));res.json({ok:true});
  }));
  app.post('/api/helmet/sessions/:id/heartbeat',auth,route((req,res)=>{
    const s=requireSession(req);producer(req,s);runtime(s).cameraSignal=performance.now();res.json({ok:true});
  }));
  app.post('/api/helmet/model/retry',auth,route((req,res)=>{
    if(worker.info.status==='loading'||worker.pending)fail('Дождитесь текущего запроса',409);
    if(worker.info.status==='ready')return res.json({ok:true});
    worker.close();worker.info.status='idle';worker.start();res.json({ok:true});
  }));
  // Local camera diagnostics: real YOLO, no fabricated employee/shift/session.
  app.post('/api/helmet/preview',auth,route(async(req,res)=>{
    const image=req.body.image;
    if(typeof image!=='string'||image.length>360000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image))fail('Ожидается JPEG-кадр до 260 КБ');
    const raw=image.slice(image.indexOf(',')+1),bytes=Buffer.from(raw,'base64');
    if(bytes.length>260000||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)fail('Некорректный JPEG');
    const mono=performance.now(),wall=Date.now();
    let p=previews.get(req.user.id);if(!p){p={engine:new HelmetState(),last:-Infinity,inflight:false,times:[]};previews.set(req.user.id,p);}
    if(p.inflight||mono-p.last<250)fail('Предыдущий кадр ещё обрабатывается',429);
    p.last=mono;p.inflight=true;
    try{
      const result=await worker.infer(raw);
      if(performance.now()-mono>2000)fail('AI обрабатывает кадр слишком долго',503);
      const state=p.engine.sample(result,mono,wall);p.times.push(mono);p.times=p.times.slice(-10);
      res.json({...result,...state,sequence:req.body.sequence,analyzed_at:now(),fps:p.times.length>1?Math.round((p.times.length-1)*10000/(mono-p.times[0]))/10:null,preview:true});
    }finally{p.inflight=false;}
  }));
  app.post('/api/helmet/preview/stop',auth,route((req,res)=>{previews.delete(req.user.id);if(!previews.size&&!db.prepare('SELECT id FROM helmet_sessions WHERE ended_at IS NULL LIMIT 1').get())worker.close();res.json({ok:true});}));
  app.post('/api/helmet/events/:id/acknowledge',auth,managerOnly,route((req,res)=>{
    const e=db.prepare('SELECT * FROM helmet_events WHERE id=?').get(id(req.params.id));if(!e)fail('Событие не найдено',404);
    db.prepare('UPDATE helmet_events SET acknowledged_at=COALESCE(acknowledged_at,?),acknowledged_by=COALESCE(acknowledged_by,?) WHERE id=?').run(now(),req.user.id,e.id);
    audit(req.user.id,'helmet_alert_acknowledged','helmet_events',e.id);const s=fullSession(e.session_id);emit('helmet_event_acknowledged',s.id,req.user.id,[s.user_id]);res.json({ok:true});
  }));
  return {summary,sweep,worker,close(){clearInterval(timer);worker.close();runtimes.clear();}};
};
