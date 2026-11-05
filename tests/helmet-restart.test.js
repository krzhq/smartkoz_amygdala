const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {fork}=require('node:child_process');
test('helmet history and the same active session survive a real process restart, without restoring NORMAL',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smartkoz-helmet-restart-')),file=path.join(dir,'restart.db');let child,base;
  async function launch(){
    child=fork(path.join(__dirname,'restart.fixture.js'),[],{env:{...process.env,NODE_ENV:'test',SMARTKOZ_DB:file,SMARTKOZ_UPLOADS:path.join(dir,'uploads'),PYTHON:path.join(dir,'missing-python')},stdio:['ignore','ignore','ignore','ipc']});
    const port=await new Promise((resolve,reject)=>{child.once('message',m=>resolve(m.port));child.once('error',reject);});base=`http://127.0.0.1:${port}`;
  }
  async function stop(){if(!child||child.exitCode!==null)return;const done=new Promise(resolve=>child.once('exit',resolve));child.send('stop');await done;}
  async function req(url,body,cookie){const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  try{
    await launch();
    const worker=await req('/api/register',{name:'Restart helmet employee',email:'helmet-restart@example.test',password:'restart-helmet-123',confirm_password:'restart-helmet-123'});
    const D=require('better-sqlite3'),d=new D(file),e=d.prepare('SELECT id FROM employees WHERE user_id=?').get(worker.data.user.id);
    const p=d.prepare("INSERT INTO ppe_inspections(employee_id,result,method,checked_at) VALUES(?,'approved','manual',?)").run(e.id,new Date().toISOString());d.close();
    await req('/api/shifts/start',{inspection_id:Number(p.lastInsertRowid)},worker.cookie);
    const started=await req('/api/helmet/sessions',{},worker.cookie),sid=started.data.session.id;
    const image='data:image/jpeg;base64,'+Buffer.from([255,216,255,224]).toString('base64');
    await req(`/api/helmet/sessions/${sid}/frames`,{image,sequence:1,producer_token:started.data.producer_token},worker.cookie);
    await stop();await launch();
    const state=(await req('/api/helmet',undefined,worker.cookie)).data;
    assert.equal(state.sessions[0].id,sid);assert.equal(state.sessions[0].status,'CAMERA_DISCONNECTED');assert.equal(state.sessions[0].frame_available,false);
    assert.equal(state.events.filter(e=>e.event_type==='AI_UNAVAILABLE').length,1);assert.equal(state.events.filter(e=>e.event_type==='CAMERA_DISCONNECTED').length,1);
    await req(`/api/helmet/sessions/${sid}/stop`,{},worker.cookie);
  }finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
});
