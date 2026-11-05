const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const readline=require('node:readline');
class HelmetWorker {
  constructor(root){
    this.root=root;this.model=process.env.HELMET_MODEL_PATH||path.join(root,'microdream','dreameye.pt');
    this.info={status:'idle',model:path.basename(this.model),classes:null,error:null};this.child=null;this.pending=null;this.serial=0;
  }
  start(){
    if(this.child)return this.info;
    if(this.info.status==='error')return this.info;
    if(!fs.existsSync(this.model)){this.info.status='error';this.info.error='Файл модели не найден';return this.info;}
    this.info={...this.info,status:'loading',error:null};
    const venv=path.join(this.root,'.venv',process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python');
    const child=spawn(process.env.PYTHON||(fs.existsSync(venv)?venv:'python'),['-u',path.join(this.root,'scripts','helmet_detection.py'),'--model',this.model],{cwd:this.root,windowsHide:true});
    this.child=child;let stderr='';
    this.startupTimer=setTimeout(()=>this.fail('Истекло время загрузки модели'),45000);this.startupTimer.unref();
    const reader=readline.createInterface({input:child.stdout});
    reader.on('line',line=>{
      let message;try{message=JSON.parse(line);}catch{return;}
      if(message.type==='ready'){clearTimeout(this.startupTimer);this.info={...this.info,status:'ready',classes:message.classes,mapping:message.mapping,error:null};}
      else if(message.type==='fatal')this.fail(message.error);
      else if(this.pending&&message.id===this.pending.id){const p=this.pending;this.pending=null;clearTimeout(p.timer);message.type==='result'?p.resolve(message):p.reject(new Error(message.error));}
    });
    child.stderr.on('data',c=>{stderr=(stderr+c).slice(-1800);});
    child.stdin.on('error',error=>this.fail(error.message));
    child.on('error',error=>this.fail(error.message));
    child.on('exit',()=>{if(this.child===child){this.fail(stderr||'Процесс модели остановлен');this.child=null;}});
    return this.info;
  }
  fail(error){
    clearTimeout(this.startupTimer);this.info.status='error';this.info.error=String(error).slice(-1800);
    if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error(this.info.error));this.pending=null;}
    const child=this.child;this.child=null;child?.kill();
  }
  infer(image){
    this.start();
    if(this.info.status!=='ready')return Promise.reject(Object.assign(new Error(this.info.status==='loading'?'Модель загружается':'AI-мониторинг недоступен'),{status:503,loading:this.info.status==='loading'}));
    if(this.pending)return Promise.reject(Object.assign(new Error('Обрабатывается другой кадр; отправьте свежий кадр позже'),{status:429}));
    return new Promise((resolve,reject)=>{
      const id=++this.serial,timer=setTimeout(()=>this.fail('Истекло время обработки кадра'),10000);timer.unref();
      this.pending={id,timer,resolve,reject};this.child.stdin.write(JSON.stringify({id,image})+'\n');
    });
  }
  close(){clearTimeout(this.startupTimer);const child=this.child;this.child=null;this.info.status='idle';if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error('Мониторинг остановлен'));this.pending=null;}child?.kill();}
}
module.exports={HelmetWorker};
