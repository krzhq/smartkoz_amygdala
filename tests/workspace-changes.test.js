const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'smartkoz-workspace-'));
process.env.NODE_ENV='test';
process.env.SMARTKOZ_DB=path.join(tmp,'test.db');
process.env.SMARTKOZ_UPLOADS=path.join(tmp,'uploads');
const instance=require('../server');
let server,base,admin,worker;
async function request(url,body,cookie){
  const r=await fetch(base+url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
before(async()=>{
  server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));base=`http://127.0.0.1:${server.address().port}`;
  admin=(await request('/api/login',{email:'rukovod@gmail.com',password:'admin'})).cookie;
});
after(async()=>{instance.platform.close();server.closeAllConnections();await new Promise(r=>server.close(r));instance.db.close();fs.rmSync(tmp,{recursive:true,force:true});});
test('last employee confirmation completes evacuation, repeated confirmation is harmless',async()=>{
  worker=(await request('/api/register',{name:'Test Worker',email:'worker@example.test',password:'password-123',confirm_password:'password-123'})).cookie;
  const db=instance.db;
  assert.equal((await request('/api/shifts/start',{},worker)).status,201);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ppe_inspections').get().c,0);
  assert.equal(db.prepare('SELECT inspection_id FROM shifts').get().inspection_id,null);
  assert.equal((await request('/api/shifts/start',{},worker)).status,409);
  const emergency=await request('/api/emergencies',{type:'fire',title:'Test emergency',description:'Leave the area',severity:'critical'},admin);
  assert.equal(emergency.data.recipients,1);
  const result=await request(`/api/emergencies/${emergency.data.id}/safe`,{},worker);
  assert.equal(result.data.resolved,true);
  const row=db.prepare('SELECT * FROM emergencies WHERE id=?').get(emergency.data.id);
  assert.equal(row.status,'resolved');assert.ok(row.resolved_at);
  assert.equal((await request(`/api/emergencies/${emergency.data.id}/safe`,{},worker)).status,200);
});
test('legacy shift migration preserves IDs and evacuation references',async()=>{
  const Database=require('better-sqlite3'),express=require('express');
  const filename=path.join(tmp,'legacy-migration.db');await instance.db.backup(filename);
  const clone=new Database(filename);let platform;
  try{
    const employee=clone.prepare('SELECT id FROM employees LIMIT 1').get().id;
    const inspection=clone.prepare("INSERT INTO ppe_inspections(employee_id,result,method,checked_at) VALUES(?,'approved','migration fixture',?)").run(employee,new Date().toISOString()).lastInsertRowid;
    clone.prepare('UPDATE shifts SET inspection_id=?').run(inspection);
    clone.pragma('foreign_keys=OFF');
    clone.exec(`CREATE TABLE shifts_legacy (id INTEGER PRIMARY KEY,employee_id INTEGER NOT NULL REFERENCES employees(id),inspection_id INTEGER NOT NULL UNIQUE REFERENCES ppe_inspections(id),started_at TEXT NOT NULL,ended_at TEXT,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')));
      INSERT INTO shifts_legacy SELECT * FROM shifts;DROP TABLE shifts;ALTER TABLE shifts_legacy RENAME TO shifts;CREATE UNIQUE INDEX one_active_shift ON shifts(employee_id) WHERE ended_at IS NULL;`);
    clone.pragma('foreign_keys=ON');
    const original=clone.prepare('SELECT * FROM shifts').all();
    platform=require('../lib/platform')({app:express(),db:clone,auth:()=>{},managerOnly:()=>{},hashPassword:()=>'',verifyPassword:()=>false,root:path.join(__dirname,'..')});
    assert.deepEqual(clone.prepare('SELECT * FROM shifts').all(),original);
    assert.equal(clone.prepare('PRAGMA table_info(shifts)').all().find(c=>c.name==='inspection_id').notnull,0);
    assert.deepEqual(clone.pragma('foreign_key_check'),[]);
    assert.equal(clone.pragma('foreign_keys',{simple:true}),1);
  }finally{platform?.close();clone.close();}
});
test('gate uses OCR text from actual video, persists time and deduplicates repeated event',async()=>{
  for(const [kind,plate] of [['car1','001 XXX 01'],['car2','777 XVX 01']]){
    const source=await request(`/api/vision/${kind}`,undefined,admin);
    assert.equal(source.data.plate,plate);assert.ok(source.data.detections.plateRecognition.samples>=2);
    assert.equal((await request('/api/gate-events',{kind,observed_ms:2999},admin)).status,409);
    const first=await request('/api/gate-events',{kind,observed_ms:3000},admin);
    assert.equal(first.status,200);assert.equal(first.data.entry.plate,plate);assert.ok(first.data.entry.created_at);
    assert.equal(first.data.entry.driver,'Иван Иванов Иванович');
    const second=await request('/api/gate-events',{kind,observed_ms:3000},admin);assert.equal(first.data.entry.id,second.data.entry.id);
    assert.equal((await request('/api/gate-events',{kind},worker)).status,403);
  }
  assert.equal(instance.db.prepare('SELECT COUNT(*) c FROM vehicle_entries').get().c,2);
});
test('browser keeps three monitor videos, nested gate journal, side agent and compact helmet picker',{skip:process.env.SMARTKOZ_BROWSER_CHECK!=='1'},async()=>{
  const {chromium}=require('playwright-core');
  const browser=await chromium.launch({executablePath:[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(p=>fs.existsSync(p)),headless:true});
  try{
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.locator('input[name=email]').fill('rukovod@gmail.com');await page.locator('input[name=password]').fill('admin');await page.locator('#authForm button[type=submit]').click();
    await page.waitForSelector('.workspace-shortcuts');
    assert.equal(await page.locator('[data-connection]').count(),0);
    await page.locator('.profile-button').click();
    await page.waitForSelector('.account-popover');
    assert.equal(await page.locator('.account-popover').evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}),true);
    await page.keyboard.press('Escape');
    await page.locator('[data-language=en]').click();
    assert.equal(await page.locator('.top-nav [data-page=overview]').innerText(),'Overview');
    await page.locator('[data-language=kk]').click();
    assert.equal(await page.locator('.top-nav [data-page=overview]').innerText(),'Шолу');
    await page.locator('[data-language=ru]').click();
    assert.equal(await page.locator('[data-page=equipment],[data-page=air],[data-page=map],[data-page=assistant]').count(),0);
    assert.equal(await page.locator('.v-brand').innerText(),'SmartKóz');
    await page.locator('.top-nav [data-page=cameras]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.vision-loader.hidden').length===3);
    assert.equal(await page.locator('.vision-video').count(),3);
    assert.equal(await page.locator('[data-vision-kind=car1],[data-vision-kind=car2]').count(),0);
    assert.equal(await page.locator('.vision-video').evaluateAll(v=>v.every(e=>e.srcObject===null)),true);
    await page.locator('.vision-video').first().evaluate(e=>e.dataset.languageProbe='preserve');
    await page.locator('[data-language=en]').click();
    assert.equal(await page.locator('.vision-video').first().getAttribute('data-language-probe'),'preserve');
    await page.locator('[data-language=ru]').click();
    await page.evaluate(()=>{for(let i=0;i<5;i++)showSafetyToast({title:'Test alert',text:'Test'});});
    assert.equal(await page.locator('.monitor-notice').count(),1);
    assert.equal(await page.locator('#safetyToastStack').count(),0);
    await page.locator('.vision-video').evaluateAll(v=>v.forEach(e=>e.pause()));
    await page.evaluate(()=>document.querySelectorAll('dialog').forEach(d=>d.close()));
    await page.locator('.top-nav [data-page=transport]').click();
    await page.waitForSelector('[data-gate-camera=car2]');await page.locator('[data-gate-camera=car2]').click();
    assert.equal(await page.locator('[data-vision-kind=car2]').count(),1);
    await page.waitForSelector('.arrival-card',{timeout:15000});
    assert.ok(await page.locator('.vehicle-plate').count()>=2);
    assert.equal(await page.locator('.top-nav [data-page=gate-journal]').count(),0);
    assert.match(await page.locator('.arrival-grid').innerText(),/Иван Иванов Иванович/);
    await page.route('**/api/assistant',r=>r.fulfill({json:{answer:'Test answer'}}));
    await page.locator('.agent-bookmark').click();await page.locator('#agentQuestion').fill('Hello');await page.locator('.agent-form button').click();
    await page.waitForFunction(()=>document.querySelector('.agent-message.assistant')?.textContent==='Test answer');
    await page.locator('.agent-close').click();
    await page.locator('.top-nav [data-page=helmet]').click();await page.waitForSelector('#helmetStart');
    await page.locator('#helmetSessionOpen').click();assert.ok(await page.locator('#helmetSessionDialog').evaluate(e=>e.open));
    assert.ok((await page.locator('#helmetSessionDialog').boundingBox()).width<=420);
    await page.locator('#helmetSessionApply').click();
    assert.doesNotMatch(await page.locator('#v-content').innerText(),/\.pt|YOLO|SQLite|LIVE INFERENCE|Bounding boxes/);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
test('search cases remain visible for shifts started without a clothing inspection',async()=>{
  const created=await request('/api/emergencies',{type:'fire',title:'Test search',description:'Leave the area',severity:'critical'},admin);
  assert.equal(created.status,201);
  const emergency=instance.db.prepare('SELECT * FROM emergencies WHERE id=?').get(created.data.id);
  instance.platform.recover(Date.parse(emergency.started_at)+300001);
  const data=await request('/api/platform',undefined,worker);
  assert.equal(data.data.cases.filter(c=>c.emergency_id===created.data.id).length,1);
});
