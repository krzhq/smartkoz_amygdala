// Chromium's test camera is used only by this test runner. Inference is real YOLO.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smartkoz-helmet-browser-'));
process.env.NODE_ENV='test';process.env.SMARTKOZ_DB=path.join(dir,'browser.db');process.env.SMARTKOZ_UPLOADS=path.join(dir,'uploads');
const instance=require('../server');
async function main(){
  const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].filter(Boolean).find(p=>fs.existsSync(p));
  const browser=await chromium.launch({executablePath,headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
  try{
    const ac=await browser.newContext({viewport:{width:1440,height:900}}),ec=await browser.newContext({viewport:{width:390,height:844},permissions:['camera']});
    const a=await ac.newPage(),e=await ec.newPage(),errors=[];for(const p of [a,e])p.on('pageerror',err=>errors.push(err.message));
    await a.goto(base);await a.getByLabel('Email',{exact:true}).fill('rukovod@gmail.com');await a.getByLabel('Пароль',{exact:true}).fill('admin');await a.getByRole('button',{name:'Войти в систему'}).click();await a.getByRole('button',{name:'Каска',exact:true}).click();
    try{await a.getByRole('heading',{name:'Умная каска',exact:true}).waitFor({timeout:10000});}catch(error){console.error('Initial page:',await a.locator('body').innerText(),'Runtime errors:',errors);throw error;}assert.notEqual(await a.locator('#helmetStatus').innerText(),'Норма');
    const registered=await ec.request.post(base+'/api/register',{data:{name:'Helmet browser employee',email:'helmet-browser@example.test',password:'browser-helmet-123',confirm_password:'browser-helmet-123'}});assert.equal(registered.status(),201);
    assert.equal((await ec.request.post(base+'/api/shifts/start',{data:{}})).status(),201);
    await e.goto(base);await e.getByRole('button',{name:'Каска',exact:true}).click();await e.getByRole('button',{name:'Включить камеру',exact:true}).click();
    await e.locator('#helmetImage').waitFor({state:'visible',timeout:55000});await a.locator('#helmetImage').waitFor({state:'visible',timeout:15000});
    const sessions=instance.db.prepare('SELECT * FROM helmet_sessions').all();assert.equal(sessions.length,1);assert.ok(sessions[0].last_analysis_at);assert.notEqual(sessions[0].status,'NORMAL');
    const sid=sessions[0].id;assert.match(await a.locator('#helmetPerson').innerText(),/Helmet browser employee/);assert.match(await e.locator('#helmetPerson').innerText(),/Helmet browser employee/);
    const prior=instance.db.prepare('SELECT last_sequence FROM helmet_sessions WHERE id=?').get(sid).last_sequence;
    await ac.setOffline(true);await a.locator('#helmetStatus').filter({hasText:'Нет связи с сервером'}).waitFor();
    await ac.setOffline(false);await a.locator('#helmetImage').waitFor({state:'visible',timeout:20000});
    await e.getByLabel('Показывать рамки',{exact:true}).uncheck();
    for(let i=0;i<30;i++){if(instance.db.prepare('SELECT last_sequence FROM helmet_sessions WHERE id=?').get(sid).last_sequence>=prior+2)break;await new Promise(r=>setTimeout(r,300));}
    assert.ok(instance.db.prepare('SELECT last_sequence FROM helmet_sessions WHERE id=?').get(sid).last_sequence>=prior+2,'Bounding box toggle must not stop analysis');
    fs.mkdirSync('test-results',{recursive:true});await e.screenshot({path:'test-results/helmet-employee-390.png',fullPage:true});await a.screenshot({path:'test-results/helmet-admin-1440.png',fullPage:true});
    assert.equal(await e.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);assert.equal(await a.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
    a.once('dialog',d=>d.accept());await a.getByRole('button',{name:'Остановить мониторинг',exact:true}).click();
    await e.waitForFunction(()=>!document.querySelector('#helmetPreview video'));
    assert.ok(instance.db.prepare('SELECT ended_at FROM helmet_sessions WHERE id=?').get(sid).ended_at);
    assert.equal(fs.readdirSync(process.env.SMARTKOZ_UPLOADS).length,0,'Helmet frames must never be written to disk');
    assert.deepEqual(errors,[]);console.log('PASS: getUserMedia, real YOLO, one shared session on two clients, mobile/desktop UI, box toggle, administrator stop and camera release; zero runtime errors');
  }finally{await browser.close();instance.platform.close();server.closeAllConnections();await new Promise(r=>server.close(r));instance.db.close();fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
