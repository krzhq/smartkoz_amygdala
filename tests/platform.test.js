const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const temp = fs.mkdtempSync(path.join(os.tmpdir(),'smartkoz-test-'));
process.env.NODE_ENV = 'test';
process.env.SMARTKOZ_DB = path.join(temp,'test.db');
process.env.SMARTKOZ_UPLOADS = path.join(temp,'uploads');
const instance = require('../server');
let base, server, admin, alice, bob, offShift, emergencyId, aliceCheck, bobCheck;
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8ioAAAAASUVORK5CYII=';
async function request(url,body,cookie,method=body===undefined?'GET':'POST') {
  const res=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await res.json(); return {status:res.status,data,cookie:res.headers.get('set-cookie')?.split(';')[0]};
}
async function register(name,email) {
  const r=await request('/api/register',{name,email,password:'test-password-123',confirm_password:'test-password-123',role:'ADMIN',department:'Test department'});
  assert.equal(r.status,201);return {cookie:r.cookie,user:r.data.user};
}
async function getData(cookie=admin){return (await request('/api/platform',undefined,cookie)).data;}
before(async()=>{server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{instance.platform.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));instance.db.close();fs.rmSync(temp,{recursive:true,force:true});});

test('clean database has one hashed administrator and no synthetic operational data',async()=>{
  const u=instance.db.prepare('SELECT * FROM users').all();assert.equal(u.length,1);assert.equal(u[0].role,'ADMIN');assert.notEqual(u[0].password_hash,'admin');
  const login=await request('/api/login',{email:'rukovod@gmail.com',password:'admin'});assert.equal(login.status,200);admin=login.cookie;
  const d=await getData();assert.equal(d.employees.length,0);assert.equal(d.shifts.length,0);assert.equal(d.emergencies.length,0);
  const dashboard=(await request('/api/dashboard',undefined,admin)).data;
  assert.equal(dashboard.metrics.employeesOnSite,0);assert.equal(dashboard.metrics.activeCameras,0);assert.equal(dashboard.sensors.length,0);
  assert.equal((await request('/api/session',undefined,admin)).data.user.token,undefined);
  assert.equal(instance.db.pragma('foreign_keys',{simple:true}),1);
});
test('registration validates confirmation and duplicates and cannot elevate role',async()=>{
  assert.equal((await request('/api/register',{name:'X',email:'invalid',password:'123',confirm_password:'456'})).status,400);
  alice=await register('Alice Test','alice@example.test');assert.equal(alice.user.role,'EMPLOYEE');
  bob=await register('Bob Test','bob@example.test');offShift=await register('Off shift Test','off@example.test');
  assert.equal((await request('/api/register',{name:'Duplicate',email:'ALICE@example.test',password:'test-password-123',confirm_password:'test-password-123'})).status,409);
  const d=await getData();assert.equal(d.employees.length,3);assert.ok(d.employees.every(e=>e.user_id));
});
test('authorization rejects administrative operations and cross-origin writes',async()=>{
  assert.equal((await request('/api/platform')).status,401);
  for(const [url,body] of [['/api/emergencies',{}],['/api/maps',{}],['/api/zones',{}],['/api/ppe/1/approve',{comment:'no'}],['/api/telemetry',{}]])assert.equal((await request(url,body,alice.cookie)).status,403);
  const r=await fetch(base+'/api/shifts/end',{method:'POST',headers:{Origin:'https://untrusted.example',Cookie:alice.cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);
  assert.equal((await request('/api/not-a-route',undefined,admin)).status,404);
});
test('SSE delivers registration changes to administrator and reconnect starts from database',async()=>{
  const controller=new AbortController();
  const res=await fetch(base+'/api/events',{headers:{Cookie:admin},signal:controller.signal});assert.equal(res.status,200);
  const reader=res.body.getReader(),decoder=new TextDecoder();assert.match(decoder.decode((await reader.read()).value),/connected/);
  const fourth=await register('Live Test','live@example.test');
  const chunk=await reader.read();assert.match(decoder.decode(chunk.value),/employee_registered/);controller.abort();
  assert.equal((await getData()).employees.length,4);
  assert.equal((await getData(fourth.cookie)).employees.length,0);
});
test('PPE refuses invalid files and shift start requires a successful owned inspection',async()=>{
  assert.equal((await request('/api/ppe',{file:'data:image/png;base64,SGVsbG8='},alice.cookie)).status,400);
  assert.equal((await request('/api/ppe',{file:'data:image/svg+xml;base64,PHN2Zz4='},alice.cookie)).status,400);
  assert.equal((await request('/api/shifts/start',{inspection_id:999},alice.cookie)).status,409);
  const result=await request('/api/ppe',{file:png},alice.cookie);assert.equal(result.status,201);aliceCheck=result.data.id;
  // A 1-pixel image can never pass the PPE requirements, with or without Python.
  assert.ok(['unavailable','failed'].includes(result.data.result));
  assert.equal((await request('/api/shifts/start',{inspection_id:aliceCheck},alice.cookie)).status,409);
  assert.equal((await request(`/api/ppe/${aliceCheck}/photo`,undefined,bob.cookie)).status,403);
  assert.equal((await request(`/api/ppe/${aliceCheck}/approve`,{comment:'Verified in person by test administrator'},admin)).status,200);
  assert.equal((await request('/api/shifts/start',{inspection_id:aliceCheck},bob.cookie)).status,409);
  assert.equal((await request('/api/shifts/start',{inspection_id:aliceCheck},alice.cookie)).status,201);
  assert.equal((await request('/api/shifts/start',{inspection_id:aliceCheck},alice.cookie)).status,409);
  const br=await request('/api/ppe',{file:png},bob.cookie);bobCheck=br.data.id;
  await request(`/api/ppe/${bobCheck}/approve`,{comment:'PPE verified in person'},admin);
  assert.equal((await request('/api/shifts/start',{inspection_id:bobCheck},bob.cookie)).status,201);
  assert.equal((await getData()).shifts.filter(s=>!s.ended_at).length,2);
});
test('emergency snapshots active shifts, not all registered workers, and rejects duplicate creation',async()=>{
  const input={type:'fire',title:'Test evacuation',description:'Leave the test area',severity:'critical'};
  const result=await request('/api/emergencies',input,admin);assert.equal(result.status,201);emergencyId=result.data.id;assert.equal(result.data.recipients,2);
  assert.equal((await request('/api/emergencies',input,admin)).status,409);
  assert.equal((await getData()).records.filter(r=>r.emergency_id===emergencyId).length,2);
  assert.equal((await getData(offShift.cookie)).emergencies.length,0);
  assert.equal((await getData(alice.cookie)).notifications[0].title,input.title);
  assert.equal((await request(`/api/emergencies/${emergencyId}/safe`,{},offShift.cookie)).status,403);
  assert.equal((await request('/api/shifts/start',{inspection_id:aliceCheck},alice.cookie)).status,409);
});
test('self-report is idempotent and scoped to authenticated employee',async()=>{
  await request(`/api/emergencies/${emergencyId}/safe`,{employee_id:bob.user.id},alice.cookie);
  const first=(await getData(alice.cookie)).records[0].safe_confirmed_at;
  assert.equal((await request(`/api/emergencies/${emergencyId}/safe`,{},alice.cookie)).status,200);
  const d=await getData();assert.equal(d.records.find(r=>r.user_id===alice.user.id).safe_confirmed_at,first);
  assert.equal(d.records.find(r=>r.user_id===bob.user.id).safe_confirmed_at,null);
});
test('server enforces 300 seconds, creates one case only, and persists deadline after restart',async()=>{
  const started=Date.parse((await getData()).emergencies[0].started_at);
  assert.deepEqual(instance.platform.recover(started+299999),[]);
  assert.equal(instance.platform.recover(started+300000).length,1);
  assert.deepEqual(instance.platform.recover(started+300001),[]);
  const d=await getData();assert.equal(d.cases.length,1);assert.equal(d.cases[0].name,'Bob Test');assert.equal(d.cases[0].image_path!==null,true);
  const reopened=new Database(process.env.SMARTKOZ_DB);assert.equal(reopened.prepare('SELECT COUNT(*) c FROM missing_person_cases').get().c,1);assert.equal(reopened.prepare('SELECT started_at FROM emergencies WHERE id=?').get(emergencyId).started_at,new Date(started).toISOString());reopened.close();
});
test('last-seen reports preserve independent sources and map coordinates',async()=>{
  const map=await request('/api/maps',{name:'Test plan',file:png},admin);assert.equal(map.status,201);
  assert.equal((await request('/api/zones',{map_id:map.data.id,name:'Area A',points:[[0,0],[1,0],[1,1]]},admin)).status,201);
  assert.equal((await request('/api/zones',{map_id:map.data.id,name:'bad',points:[[0,2]]},admin)).status,400);
  const c=(await getData()).cases[0];
  const report={map_id:map.data.id,map_x:.2,map_y:.7,observed_at:new Date().toISOString(),description:'Witness note'};
  assert.equal((await request(`/api/cases/${c.id}/reports`,report,alice.cookie)).status,201);
  assert.equal((await request(`/api/cases/${c.id}/reports`,{...report,map_x:.8},offShift.cookie)).status,201);
  assert.equal((await request(`/api/cases/${c.id}/reports`,{...report,map_x:7},alice.cookie)).status,400);
  assert.equal((await request(`/api/cases/${c.id}/reports`,{...report,observed_at:'2099-01-01'},alice.cookie)).status,400);
  const reports=(await getData()).reports;assert.equal(reports.length,2);assert.notEqual(reports[0].reported_by,reports[1].reported_by);
});
test('SVG plans are rebuilt from an inert allowlist and reject active content',async()=>{
  const upload=svg=>({name:'SVG test plan',file:'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64')});
  const result=await request('/api/maps',upload('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect x="10" y="10" width="200" height="100" fill="blue"/><text x="20" y="40">Plan</text></svg>'),admin);
  assert.equal(result.status,201);
  const image=await fetch(base+`/api/maps/${result.data.id}/image`,{headers:{Cookie:admin}});
  assert.equal(image.status,200);assert.match(image.headers.get('content-security-policy'),/sandbox/);assert.match(await image.text(),/rect/);
  for(const svg of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>','<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>','<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x"/></svg>','<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///secret">]><svg>&x;</svg>','<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://example.com/paint)"/></svg>'])assert.equal((await request('/api/maps',upload(svg),admin)).status,400);
});
test('video upload has honest unavailable status and protected manual playback without Python',async()=>{
  const d=await getData(),c=d.cases[0],zone=d.zones[0];
  const bytes=fs.readFileSync(path.join(__dirname,'..','fall','fall.mp4'));
  const previous=process.env.PYTHON;process.env.PYTHON=path.join(temp,'not-installed');
  let result;
  try{result=await request(`/api/cases/${c.id}/videos`,{file:'data:video/mp4;base64,'+bytes.toString('base64'),zone_id:zone.id,recorded_at:new Date().toISOString()},admin);}
  finally{if(previous===undefined)delete process.env.PYTHON;else process.env.PYTHON=previous;}
  assert.equal(result.status,202);
  for(let i=0;i<20&&instance.db.prepare('SELECT status FROM video_jobs WHERE id=?').get(result.data.id).status==='processing';i++)await new Promise(resolve=>setTimeout(resolve,20));
  const job=(await getData()).jobs.find(j=>j.id===result.data.id);assert.equal(job.status,'unavailable');assert.ok(job.error);
  assert.equal((await fetch(base+`/api/videos/${job.id}`,{headers:{Cookie:admin,Range:'bytes=0-100'}})).status,206);
  assert.equal((await request(`/api/videos/${job.id}`,undefined,alice.cookie)).status,403);
  assert.equal((await getData()).detections.length,0);
});
test('late self-report leaves case open for human safety confirmation and audited closure',async()=>{
  const c=(await getData()).cases[0];
  assert.equal((await request(`/api/cases/${c.id}`,{status:'closed',comment:'Skip safety'},admin,'PATCH')).status,409);
  assert.equal((await request(`/api/cases/${c.id}`,{status:'searching',comment:'Search begun'},bob.cookie,'PATCH')).status,403);
  await request(`/api/cases/${c.id}`,{status:'searching',comment:'Search begun'},admin,'PATCH');
  await request(`/api/emergencies/${emergencyId}/safe`,{},bob.cookie);
  assert.equal((await getData()).cases[0].status,'awaiting_safety');
  assert.equal((await request(`/api/cases/${c.id}`,{status:'safe',comment:'Verified at assembly point',services_informed:true},admin,'PATCH')).status,200);
  assert.equal((await request(`/api/cases/${c.id}`,{status:'closed',comment:'Safety confirmed; closing search'},admin,'PATCH')).status,200);
  const closed=(await getData()).cases[0];assert.ok(closed.closed_at);assert.ok(closed.safety_confirmed_at);assert.equal(closed.closed_by,1);
  assert.equal((await request(`/api/cases/${c.id}/reports`,{},alice.cookie)).status,409);
  assert.equal((await request(`/api/emergencies/${emergencyId}/resolve`,{comment:'All participants accounted for'},admin)).status,200);
  assert.ok((await getData()).audit.some(a=>a.action==='emergency_resolved'));
});
test('unresolved emergency requires explicit override and audits outstanding counts',async()=>{
  const e=await request('/api/emergencies',{type:'gas',severity:'warning',title:'Second test',description:'Test instructions'},admin);
  assert.equal((await request(`/api/emergencies/${e.data.id}/resolve`,{comment:'Must warn'},admin)).status,409);
  assert.equal((await request(`/api/emergencies/${e.data.id}/resolve`,{comment:'Responsible decision recorded',force:true},admin)).status,200);
  const log=(await getData()).audit.find(a=>a.action==='emergency_resolved');assert.equal(JSON.parse(log.details).pending,2);
});
test('photos can be deleted without deleting inspection audit and shift history',async()=>{
  assert.equal((await request(`/api/ppe/${aliceCheck}/photo`,{},admin,'DELETE')).status,200);
  assert.equal((await request(`/api/ppe/${aliceCheck}/photo`,undefined,alice.cookie)).status,404);
  assert.ok((await getData()).audit.some(a=>a.action==='photo_deleted'));
  assert.equal((await request('/api/shifts/end',{},alice.cookie)).status,200);
  assert.equal((await request('/api/shifts/start',{inspection_id:aliceCheck},alice.cookie)).status,409);
});
test('telemetry stores real submitted values and validates payload',async()=>{
  assert.equal((await request('/api/telemetry',{type:'CO2',zone:'Test zone',value:512,unit:'ppm',status:'normal',source:'Test meter'},admin)).status,200);
  const dashboard=(await request('/api/dashboard',undefined,admin)).data;assert.equal(dashboard.sensors[0].value,512);
  assert.equal((await request('/api/telemetry',{value:'bad'},admin)).status,400);
});

test('a real server process restart restores evacuation and creates overdue cases without browser timers',async()=>{
  const {fork}=require('node:child_process');
  const file=path.join(temp,'restart.db');let child;
  async function launch(){child=fork(path.join(__dirname,'restart.fixture.js'),[],{env:{...process.env,SMARTKOZ_DB:file,SMARTKOZ_UPLOADS:path.join(temp,'restart-uploads'),PYTHON:path.join(temp,'missing-python')},stdio:['ignore','ignore','pipe','ipc']});return new Promise((resolve,reject)=>{child.once('message',m=>resolve(`http://127.0.0.1:${m.port}`));child.once('error',reject);});}
  async function stop(){if(!child||child.exitCode!==null)return;const stopped=new Promise(resolve=>child.once('exit',resolve));child.send('stop');await stopped;}
  try{
    let address=await launch();
    const call=async(url,body,cookie)=>{const r=await fetch(address+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
    const manager=await call('/api/login',{email:'rukovod@gmail.com',password:'admin'});
    const worker=await call('/api/register',{name:'Restart Employee',email:'restart@example.test',password:'test-password-123',confirm_password:'test-password-123'});
    const check=await call('/api/ppe',{file:png},worker.cookie);
    await call(`/api/ppe/${check.data.id}/approve`,{comment:'Verified before restart'},manager.cookie);
    await call('/api/shifts/start',{inspection_id:check.data.id},worker.cookie);
    const emergency=await call('/api/emergencies',{type:'fire',severity:'critical',title:'Restart test',description:'Test'},manager.cookie);
    await stop();
    const original=new Date(Date.now()-301000).toISOString();
    const stored=new Database(file);stored.prepare('UPDATE emergencies SET started_at=? WHERE id=?').run(original,emergency.data.id);stored.close();
    address=await launch();
    const recovered=await call('/api/platform',undefined,manager.cookie);
    assert.equal(recovered.status,200);assert.equal(recovered.data.emergencies[0].started_at,original);assert.equal(recovered.data.cases.length,1);assert.equal(recovered.data.cases[0].name,'Restart Employee');
  }finally{await stop();}
});

test('production bootstrap requires password change, revokes old sessions and disables demo reset',async()=>{
  const {fork,spawnSync}=require('node:child_process');
  const file=path.join(temp,'production.db');
  const env={...process.env,NODE_ENV:'production',SMARTKOZ_DB:file,ADMIN_EMAIL:'production@example.test',ADMIN_PASSWORD:'bootstrap-password-123'};
  const child=fork(path.join(__dirname,'restart.fixture.js'),[],{env,stdio:['ignore','ignore','pipe','ipc']});
  try{
    const port=await new Promise((resolve,reject)=>{child.once('message',m=>resolve(m.port));child.once('error',reject);});
    async function call(url,body,cookie){const r=await fetch(`http://127.0.0.1:${port}${url}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0],header:r.headers.get('set-cookie')};}
    const login=await call('/api/login',{email:'production@example.test',password:env.ADMIN_PASSWORD});assert.equal(login.status,200);assert.match(login.header,/Secure/);assert.match(login.header,/HttpOnly/);
    assert.equal((await call('/api/platform',undefined,login.cookie)).status,403);
    const changed=await call('/api/password',{current_password:env.ADMIN_PASSWORD,password:'replacement-password-456'},login.cookie);assert.equal(changed.status,200);
    assert.equal((await call('/api/session',undefined,login.cookie)).status,401);
    assert.equal((await call('/api/platform',undefined,changed.cookie)).status,200);
    const reset=spawnSync(process.execPath,[path.join(__dirname,'..','scripts/reset-demo.js')],{env,encoding:'utf8'});assert.equal(reset.status,1);assert.match(reset.stderr,/disabled in production/);
    assert.equal((await call('/api/session',undefined,changed.cookie)).status,200);
  }finally{const stopped=new Promise(resolve=>child.once('exit',resolve));child.send('stop');await stopped;}
});
