// Real Python/YOLO -> authenticated API -> SQLite, using only isolated data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smartkoz-ai-api-'));
process.env.NODE_ENV='test';process.env.SMARTKOZ_DB=path.join(dir,'ai.db');process.env.SMARTKOZ_UPLOADS=path.join(dir,'uploads');
const python=process.env.PYTHON||path.join(__dirname,'..','.venv',process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python');
const instance=require('../server');
async function main(){
  const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const cached=JSON.parse(fs.readFileSync(path.join(__dirname,'..','public/assets/vision/outfit-detections.json'),'utf8'));
    const detections=cached.frames[0].detections;
    const inside=(box,p)=>{const x=(box[0]+box[2])/2,y=(box[1]+box[3])/2;return x>=p[0]&&x<=p[2]&&y>=p[1]&&y<=p[3];};
    const person=detections.find(p=>p.label==='person'&&['helmet','vest'].every(label=>detections.some(d=>d.label===label&&inside(d.box,p.box))))||detections.find(p=>p.label==='person');
    const prepare=`import cv2,json,sys\nfrom pathlib import Path\np=Path(sys.argv[1]);cap=cv2.VideoCapture(sys.argv[2]);ok,frame=cap.read();assert ok\nx1,y1,x2,y2=[int(v) for v in json.loads(sys.argv[3])];cv2.imwrite(str(p/'crop.jpg'),frame[max(0,y1-8):y2+8,max(0,x1-8):x2+8]);h,w=frame.shape[:2];out=cv2.VideoWriter(str(p/'clip.mp4'),cv2.VideoWriter_fourcc(*'mp4v'),24,(w,h));assert out.isOpened()\nfor i in range(4):\n out.write(frame);ok,frame=cap.read()\nout.release();cap.release()`;
    const prepared=spawnSync(python,['-c',prepare,dir,path.join(__dirname,'..','outfit/manwithnooutfit.mp4'),JSON.stringify(person.box)],{encoding:'utf8'});assert.equal(prepared.status,0,prepared.stderr);
    async function call(url,body,cookie,method=body?'POST':'GET'){
      const res=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await res.json();assert.ok(res.ok,JSON.stringify(data));return {data,cookie:res.headers.get('set-cookie')?.split(';')[0]};
    }
    const admin=await call('/api/login',{email:'rukovod@gmail.com',password:'admin'});
    const worker=await call('/api/register',{name:'AI Pipeline Test',email:'ai-test@example.test',password:'pipeline-password-123',confirm_password:'pipeline-password-123'});
    const inspection=await call('/api/ppe',{file:'data:image/jpeg;base64,'+fs.readFileSync(path.join(dir,'crop.jpg')).toString('base64')},worker.cookie);
    assert.notEqual(inspection.data.result,'unavailable',inspection.data.details);
    console.log('Real PPE API:',inspection.data.result,inspection.data.details);
    if(inspection.data.result!=='passed')await call(`/api/ppe/${inspection.data.id}/approve`,{comment:'Manual approval for isolated pipeline testing'},admin.cookie);
    await call('/api/shifts/start',{inspection_id:inspection.data.id},worker.cookie);
    const emergency=await call('/api/emergencies',{type:'fire',title:'AI pipeline evacuation',description:'Isolated test',severity:'critical'},admin.cookie);
    instance.db.prepare('UPDATE emergencies SET started_at=? WHERE id=?').run(new Date(Date.now()-301000).toISOString(),emergency.data.id);instance.platform.recover();
    const state=(await call('/api/platform',undefined,admin.cookie)).data,c=state.cases[0];
    const map=await call('/api/maps',{name:'Isolated plan',file:'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="white"/></svg>').toString('base64')},admin.cookie);
    const zone=await call('/api/zones',{map_id:map.data.id,name:'Test camera area',points:[[0,0],[1,0],[1,1]]},admin.cookie);
    const job=await call(`/api/cases/${c.id}/videos`,{zone_id:zone.data.id,recorded_at:new Date().toISOString(),file:'data:video/mp4;base64,'+fs.readFileSync(path.join(dir,'clip.mp4')).toString('base64')},admin.cookie);
    let data;
    for(let i=0;i<240;i++){data=(await call('/api/platform',undefined,admin.cookie)).data;if(data.jobs.find(j=>j.id===job.data.id).status!=='processing')break;await new Promise(r=>setTimeout(r,500));}
    const stored=data.jobs.find(j=>j.id===job.data.id);assert.equal(stored.status,'ready',stored.error);
    assert.ok(data.detections.length>0);assert.ok(data.detections.every(d=>d.verification_status==='unreviewed'));
    assert.equal(data.cases[0].status,'observation');assert.equal(data.records[0].verified_at,null);assert.equal(data.records[0].safe_confirmed_at,null);
    await call(`/api/detections/${data.detections[0].id}`,{status:'possible_match',comment:'Human review for test; identity not established'},admin.cookie,'PATCH');
    const final=(await call('/api/platform',undefined,admin.cookie)).data;assert.notEqual(final.cases[0].status,'closed');assert.equal(final.cases[0].safety_confirmed_at,null);
    console.log(`PASS: real uploaded video produced ${data.detections.length} persisted person detections; review never inferred safety or closed the case`);
  }finally{instance.platform.close();server.closeAllConnections();await new Promise(r=>server.close(r));instance.db.close();fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
