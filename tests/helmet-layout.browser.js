// Real browser camera capture; deterministic boxes isolate image/overlay geometry.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smartkoz-helmet-layout-'));
process.env.NODE_ENV='test';process.env.SMARTKOZ_DB=path.join(dir,'test.db');process.env.SMARTKOZ_UPLOADS=path.join(dir,'uploads');
const instance=require('../server');
function jpegSize(image){
  const bytes=Buffer.from(image.split(',')[1],'base64');
  for(let offset=2;offset+8<bytes.length;){
    if(bytes[offset]!==0xff){offset++;continue;}
    const marker=bytes[offset+1],length=bytes.readUInt16BE(offset+2);
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return {width:bytes.readUInt16BE(offset+7),height:bytes.readUInt16BE(offset+5)};
    offset+=length+2;
  }
  throw new Error('Camera frame has no JPEG dimensions');
}
async function main(){
  let server,browser;
  try{
    server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));
    const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].filter(Boolean).find(file=>fs.existsSync(file));
    browser=await chromium.launch({executablePath,headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
    let camera={width:640,height:480};
    await page.route('**/api/helmet/preview',route=>{
      const request=route.request().postDataJSON(),{width,height}=jpegSize(request.image);
      return route.fulfill({json:{preview:true,status:'NORMAL',width,height,sequence:request.sequence,fps:3,eye_state:'OPEN',visibility:'VISIBLE',closed_seconds:0,active_alerts:[],detections:[{eye_side:'left',eye_state:'OPEN',label:'eyeLeftOpen',confidence:.99,box:[width*.2,height*.3,width*.4,height*.5]}]}});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('input[name=email]').fill('rukovod@gmail.com');await page.locator('input[name=password]').fill('admin');await page.locator('#authForm button[type=submit]').click();
    await page.locator('.top-nav [data-page=helmet]').click();await page.locator('#helmetStart').click();await page.waitForSelector('#helmetImage',{state:'visible'});
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
      await page.setViewportSize(viewport);
      for(camera of [{width:640,height:480},{width:1280,height:720},{width:360,height:640}]){
        await page.locator('.helmet-local-preview').evaluate((video,size)=>{Object.defineProperty(video,'videoWidth',{get:()=>size.width,configurable:true});Object.defineProperty(video,'videoHeight',{get:()=>size.height,configurable:true});},camera);
        const scale=Math.min(1,640/Math.max(camera.width,camera.height)),width=Math.round(camera.width*scale),height=Math.round(camera.height*scale);
        await page.waitForFunction(({width,height})=>{const image=document.querySelector('#helmetImage');return image&&!image.hidden&&image.naturalWidth===width&&image.naturalHeight===height;},{width,height});
        const geometry=await page.evaluate(()=>{
          const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
          const image=document.querySelector('#helmetImage'),canvas=document.querySelector('#helmetOverlay');
          return {stage:rect(document.querySelector('#helmetStage')),image:rect(image),canvas:rect(canvas),pixel:canvas.getContext('2d').getImageData(Math.round(canvas.width*.2),Math.round(canvas.height*.3),1,1).data[3]};
        });
        for(const key of ['x','y','width','height']){assert.ok(Math.abs(geometry.stage[key]-geometry.image[key])<1);assert.ok(Math.abs(geometry.image[key]-geometry.canvas[key])<1);}
        assert.ok(Math.abs(geometry.image.width/geometry.image.height-width/height)<.01);
        assert.ok(geometry.image.height<=viewport.height*.73+1);assert.ok(geometry.pixel>0);assert.ok(geometry.image.width>150);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      }
    }
    await page.locator('#helmetStop').click();await page.waitForFunction(()=>!document.querySelector('.helmet-local-preview'));
    assert.equal(await page.locator('#helmetStage').evaluate(e=>e.classList.contains('has-frame')),false);assert.deepEqual(errors,[]);
    console.log('PASS: camera start/stop; 4:3, 16:9 and portrait; desktop/mobile; image and boxes occupy identical bounds.');
  }finally{await browser?.close();instance.platform.close();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));instance.db.close();fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
