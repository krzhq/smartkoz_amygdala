// Real inference on original eye-camera recordings, not synthetic detections.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smartkoz-helmet-real-'));
process.env.NODE_ENV='test';process.env.SMARTKOZ_DB=path.join(dir,'helmet.db');process.env.SMARTKOZ_UPLOADS=path.join(dir,'uploads');
const instance=require('../server');
const python=process.env.PYTHON||path.join(__dirname,'..','.venv',process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python');
async function main(){
  const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const code=`import cv2,sys,numpy as np\nfrom pathlib import Path\np=Path(sys.argv[1]);c=cv2.VideoCapture(sys.argv[2])\nfor name,index in [('open',0),('closed',52),('closed2',62),('closed3',74)]:\n c.set(cv2.CAP_PROP_POS_FRAMES,index);ok,f=c.read();assert ok;s=min(1,640/max(f.shape[:2]));f=cv2.resize(f,(round(f.shape[1]*s),round(f.shape[0]*s)));cv2.imwrite(str(p/(name+'.jpg')),f)\ncv2.imwrite(str(p/'none.jpg'),np.zeros((360,640,3),dtype=np.uint8));c.release()`;
    const prep=spawnSync(python,['-c',code,dir,path.join(__dirname,'..','microdream','microsleepdriver.mp4')],{encoding:'utf8'});assert.equal(prep.status,0,prep.stderr);
    async function req(url,body,cookie){const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return {data,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
    const admin=await req('/api/login',{email:'rukovod@gmail.com',password:'admin'});
    const worker=await req('/api/register',{name:'Helmet real inference test',email:'helmet-real@example.test',password:'helmet-test-123',confirm_password:'helmet-test-123'});
    const e=instance.db.prepare('SELECT id FROM employees WHERE user_id=?').get(worker.data.user.id),p=instance.db.prepare("INSERT INTO ppe_inspections(employee_id,result,method,checked_at) VALUES(?,'approved','manual',?)").run(e.id,new Date().toISOString());
    await req('/api/shifts/start',{inspection_id:Number(p.lastInsertRowid)},worker.cookie);
    const started=await req('/api/helmet/sessions',{},worker.cookie),sid=started.data.session.id,token=started.data.producer_token;
    for(let i=0;i<45;i++){const model=(await req('/api/helmet',undefined,admin.cookie)).data.model;if(model.status==='ready')break;if(model.status==='error')throw new Error(model.error);await req(`/api/helmet/sessions/${sid}/heartbeat`,{producer_token:token},worker.cookie);await new Promise(r=>setTimeout(r,1000));}
    let seq=0;
    async function frame(name){await new Promise(r=>setTimeout(r,300));return (await req(`/api/helmet/sessions/${sid}/frames`,{producer_token:token,sequence:++seq,image:'data:image/jpeg;base64,'+fs.readFileSync(path.join(dir,name+'.jpg')).toString('base64')},worker.cookie)).data;}
    const first=await frame('open');console.log('Actual classes:',(await req('/api/helmet',undefined,admin.cookie)).data.model.classes);console.log('Open observation:',first.eye_state,first.detections.map(d=>d.label));
    assert.equal(first.eye_state,'OPEN');await frame('open');assert.equal((await frame('open')).status,'NORMAL');
    const viewed=(await req(`/api/helmet/sessions/${sid}/frame`,undefined,admin.cookie)).data;assert.equal(viewed.session.id,sid);assert.equal(viewed.result.sequence,seq);assert.ok(viewed.image.startsWith('data:image/jpeg;base64,'));
    let closedName;
    for(const candidate of ['closed','closed2','closed3']){const result=await frame(candidate);console.log(candidate,result.eye_state,result.detections.map(d=>[d.label,d.confidence]));if(result.eye_state==='CLOSED'){closedName=candidate;break;}}
    assert.ok(closedName,'Original recording must yield confident left/right closed eyes');
    for(let i=0;i<10;i++){const result=await frame(closedName);if(result.status==='EYES_CLOSED_WARNING')break;}
    let state=(await req('/api/helmet',undefined,admin.cookie)).data;assert.equal(state.events.filter(e=>e.event_type==='EYES_CLOSED_WARNING').length,1);
    for(let i=0;i<8;i++)await frame('none');
    state=(await req('/api/helmet',undefined,admin.cookie)).data;assert.equal(state.sessions[0].status,'VISIBILITY_LOST');assert.equal(state.events.filter(e=>e.event_type==='VISIBILITY_LOST').length,1);
    await frame('open');await frame('open');await frame('open');state=(await req('/api/helmet',undefined,admin.cookie)).data;
    assert.equal(state.sessions[0].status,'NORMAL');assert.ok(state.events.every(e=>e.ended_at));
    await req(`/api/helmet/sessions/${sid}/disconnect`,{producer_token:token},worker.cookie);assert.equal((await req('/api/helmet',undefined,admin.cookie)).data.sessions[0].status,'CAMERA_DISCONNECTED');
    await req(`/api/helmet/sessions/${sid}/stop`,{},admin.cookie);
    console.log('PASS: real YOLO -> one shared camera session -> 3-second warning -> 2-second visibility loss -> stable recovery -> durable SQLite events');
  }finally{instance.platform.close();server.closeAllConnections();await new Promise(r=>server.close(r));instance.db.close();fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
