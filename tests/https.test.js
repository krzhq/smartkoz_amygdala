const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),https=require('node:https');
const {spawn,spawnSync}=require('node:child_process');
const candidates=[process.env.OPENSSL_PATH,'C:/Program Files/Git/usr/bin/openssl.exe','/usr/bin/openssl'];
const openssl=candidates.filter(Boolean).find(p=>fs.existsSync(p));
test('optional HTTPS entry point serves the same application without changing machine trust', {skip:!openssl},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smartkoz-tls-test-')),cert=path.join(dir,'cert.pem'),key=path.join(dir,'key.pem');let child;
  try{
    const created=spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',key,'-out',cert],{encoding:'utf8',windowsHide:true});assert.equal(created.status,0,created.stderr);
    child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,NODE_ENV:'test',PORT:'0',SMARTKOZ_DB:path.join(dir,'test.db'),SMARTKOZ_UPLOADS:path.join(dir,'uploads'),TLS_CERT_FILE:cert,TLS_KEY_FILE:key},windowsHide:true,stdio:['ignore','pipe','pipe']});
    const port=await new Promise((resolve,reject)=>{let output='';child.stdout.on('data',chunk=>{output+=chunk;const match=/https:\/\/localhost:(\d+)/.exec(output);if(match)resolve(Number(match[1]));});child.once('error',reject);child.once('exit',code=>reject(new Error('TLS server exited: '+code)));});
    const response=await new Promise((resolve,reject)=>{https.get({hostname:'127.0.0.1',port,path:'/',rejectUnauthorized:false},r=>{let html='';r.on('data',c=>html+=c);r.on('end',()=>resolve({status:r.statusCode,html}));}).on('error',reject);});
    assert.equal(response.status,200);assert.match(response.html,/\/helmet.js/);
  }finally{if(child&&child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await ended;}fs.rmSync(dir,{recursive:true,force:true});}
});
