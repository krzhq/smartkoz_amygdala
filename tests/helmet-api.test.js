const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smartkoz-helmet-api-'));
process.env.NODE_ENV='test';process.env.SMARTKOZ_DB=path.join(dir,'test.db');process.env.SMARTKOZ_UPLOADS=path.join(dir,'uploads');
const instance=require('../server');let server,base,admin,employee,other,session,token;
const jpeg='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,0]).toString('base64');
async function req(url,body,cookie,method=body?'POST':'GET'){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function register(email){const r=await req('/api/register',{name:'Helmet integration employee',email,password:'test-password-123',confirm_password:'test-password-123'});return r;}
before(async()=>{
  server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));base=`http://127.0.0.1:${server.address().port}`;
  admin=(await req('/api/login',{email:'rukovod@gmail.com',password:'admin'})).cookie;
  employee=await register('helmet@example.test');other=await register('other@example.test');
  // Only the inference boundary is replaced in this test process. There is no
  // production endpoint accepting synthetic observations or a simulated mode.
  instance.platform.helmet.worker.start=()=>({status:'error'});
  instance.platform.helmet.worker.infer=async()=>{throw Object.assign(new Error('Intentional test model outage'),{status:503});};
});
after(async()=>{instance.platform.close();server.closeAllConnections();await new Promise(r=>server.close(r));instance.db.close();fs.rmSync(dir,{recursive:true,force:true});});
test('helmet requires an active shift and cannot be started by an administrator',async()=>{
  assert.equal((await req('/api/helmet/sessions',{},admin)).status,403);
  assert.equal((await req('/api/helmet/sessions',{},employee.cookie)).status,409);
  const e=instance.db.prepare('SELECT id FROM employees WHERE user_id=?').get(employee.data.user.id);
  const p=instance.db.prepare("INSERT INTO ppe_inspections(employee_id,result,method,checked_at) VALUES(?,'approved','manual',?)").run(e.id,new Date().toISOString());
  await req('/api/shifts/start',{inspection_id:Number(p.lastInsertRowid)},employee.cookie);
  const result=await req('/api/helmet/sessions',{},employee.cookie);assert.equal(result.status,201);session=result.data.session.id;token=result.data.producer_token;
  assert.equal(result.data.session.status,'WARMING_UP');assert.equal((await req('/api/helmet/sessions',{},employee.cookie)).status,409);
});
test('one producer token protects the same session viewed by admin; no public frame access',async()=>{
  const data=(await req('/api/helmet',undefined,admin)).data;assert.equal(data.sessions[0].id,session);assert.equal(data.sessions[0].producer_hash,undefined);assert.equal(data.sessions[0].producer_token,undefined);
  assert.equal((await req('/api/helmet/sessions/'+session+'/frame')).status,401);
  assert.equal((await req('/api/helmet/sessions/'+session+'/frame',undefined,other.cookie)).status,403);
  assert.equal((await req('/api/helmet/sessions/'+session+'/frames',{image:jpeg,sequence:1,producer_token:'a'.repeat(64)},employee.cookie)).status,403);
  assert.equal((await req('/api/helmet/sessions/'+session+'/frames',{image:jpeg,sequence:1,producer_token:token},admin)).status,403);
});
test('AI outage is durable, deduplicated, delivered through SSE and never NORMAL',async()=>{
  const controller=new AbortController(),response=await fetch(base+'/api/events',{headers:{Cookie:admin},signal:controller.signal});const reader=response.body.getReader();await reader.read();
  assert.equal((await req(`/api/helmet/sessions/${session}/frames`,{image:jpeg,sequence:1,producer_token:token},employee.cookie)).status,503);
  const bytes=await reader.read();assert.match(new TextDecoder().decode(bytes.value),/helmet_alert_created|helmet_status/);controller.abort();
  const data=(await req('/api/helmet',undefined,admin)).data;assert.equal(data.sessions[0].status,'AI_UNAVAILABLE');assert.equal(data.events[0].event_type,'AI_UNAVAILABLE');
  assert.equal(data.events.filter(e=>e.event_type==='AI_UNAVAILABLE').length,1);
  assert.ok(instance.db.prepare("SELECT * FROM notifications WHERE type='helmet_alert'").get());
  assert.equal((await req(`/api/helmet/sessions/${session}/frames`,{image:jpeg,sequence:1,producer_token:token},employee.cookie)).status,409);
  assert.equal((await req(`/api/helmet/sessions/${session}/frames`,{image:jpeg,sequence:2,producer_token:token},employee.cookie)).status,429);
});
test('camera disconnect is distinct from AI failure and event acknowledgement does not resolve it',async()=>{
  await req(`/api/helmet/sessions/${session}/disconnect`,{producer_token:token},employee.cookie);
  const d=(await req('/api/helmet',undefined,admin)).data;assert.equal(d.sessions[0].status,'CAMERA_DISCONNECTED');
  const e=d.events.find(e=>e.event_type==='CAMERA_DISCONNECTED');assert.ok(e);assert.equal((await req(`/api/helmet/events/${e.id}/acknowledge`,{},employee.cookie)).status,403);
  await req(`/api/helmet/events/${e.id}/acknowledge`,{},admin);
  const row=instance.db.prepare('SELECT * FROM helmet_events WHERE id=?').get(e.id);assert.ok(row.acknowledged_at);assert.equal(row.ended_at,null);
  assert.equal((await req(`/api/helmet/sessions/${session}/frame`,undefined,admin)).status,404);
});
test('a late inference result cannot restore NORMAL after camera disconnect',async()=>{
  await new Promise(r=>setTimeout(r,280));
  const previous=instance.platform.helmet.worker.infer;let resolveInference;
  instance.platform.helmet.worker.infer=()=>new Promise(resolve=>{resolveInference=resolve;});
  const pending=req(`/api/helmet/sessions/${session}/frames`,{image:jpeg,sequence:3,producer_token:token},employee.cookie);
  while(!resolveInference)await new Promise(r=>setTimeout(r,10));
  await req(`/api/helmet/sessions/${session}/disconnect`,{producer_token:token},employee.cookie);
  resolveInference({eye_state:'OPEN',eyes_visible:true,confidence:.99,detections:[],width:640,height:480});
  assert.equal((await pending).status,409);assert.equal(instance.db.prepare('SELECT status FROM helmet_sessions WHERE id=?').get(session).status,'CAMERA_DISCONNECTED');
  instance.platform.helmet.worker.infer=previous;
});
test('stop closes session, clears volatile imagery and retains event history after reopening SQLite',async()=>{
  assert.equal((await req(`/api/helmet/sessions/${session}/stop`,{},other.cookie)).status,403);
  assert.equal((await req(`/api/helmet/sessions/${session}/stop`,{},admin)).status,200);
  assert.equal(instance.db.prepare("SELECT actor_id FROM audit_logs WHERE action='helmet_session_stopped' ORDER BY id DESC LIMIT 1").get().actor_id,1);
  assert.equal((await req(`/api/helmet/sessions/${session}/frames`,{image:jpeg,sequence:3,producer_token:token},employee.cookie)).status,409);
  const D=require('better-sqlite3'),reopened=new D(process.env.SMARTKOZ_DB);const events=reopened.prepare('SELECT * FROM helmet_events').all();assert.ok(events.length>=2);assert.ok(events.every(e=>e.ended_at));assert.ok(reopened.prepare('SELECT ended_at FROM helmet_sessions').get().ended_at);reopened.close();
});
test('a shift ending stops its helmet session through the server watchdog',async()=>{
  const fresh=await req('/api/helmet/sessions',{},employee.cookie);assert.equal(fresh.status,201);
  await req('/api/shifts/end',{},employee.cookie);instance.platform.helmet.sweep();
  assert.ok(instance.db.prepare('SELECT ended_at FROM helmet_sessions WHERE id=?').get(fresh.data.session.id).ended_at);
});
test('the server detects capture timeout without a browser timer',async()=>{
  const e=instance.db.prepare('SELECT id FROM employees WHERE user_id=?').get(employee.data.user.id);
  const p=instance.db.prepare("INSERT INTO ppe_inspections(employee_id,result,method,checked_at) VALUES(?,'approved','manual',?)").run(e.id,new Date().toISOString());
  await req('/api/shifts/start',{inspection_id:Number(p.lastInsertRowid)},employee.cookie);
  const started=await req('/api/helmet/sessions',{},employee.cookie),sid=started.data.session.id;
  instance.db.prepare('UPDATE helmet_sessions SET started_at=? WHERE id=?').run(new Date(Date.now()-7000).toISOString(),sid);
  instance.platform.helmet.sweep();const state=(await req('/api/helmet',undefined,employee.cookie)).data;
  assert.equal(state.sessions[0].status,'CAMERA_DISCONNECTED');assert.ok(state.events.some(e=>e.session_id===sid&&e.event_type==='CAMERA_DISCONNECTED'));
});
