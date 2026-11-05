/* One camera producer; all viewers subscribe to the same server session. */
const HelmetUI=(()=>{
  const labels={NORMAL:'Норма',EYES_CLOSED:'Глаза закрыты',EYES_CLOSED_WARNING:'Внимание: длительное закрытие глаз',VISIBILITY_LOST:'Потеря видимости / возможное снятие каски',CAMERA_DISCONNECTED:'Соединение с камерой потеряно',AI_UNAVAILABLE:'AI-мониторинг недоступен',AI_LOADING:'Подготовка наблюдения',WARMING_UP:'Ожидание устойчивых данных',STOPPED:'Камера отключена'};
  const eventLabels={EYES_CLOSED_WARNING:'Глаза закрыты более 3 секунд. Возможная сонливость или ухудшение самочувствия',VISIBILITY_LOST:'Возможное снятие каски: глаза не обнаружены камерой',CAMERA_DISCONNECTED:'Соединение с камерой потеряно',AI_UNAVAILABLE:'AI-мониторинг недоступен'};
  let data={sessions:[],events:[],model:{status:'idle',model:'dreameye.pt'}},selected=null,stream=null,video=null,producer=null;
  let previewing=false,previewResult=null,deviceId='',devices=[],pumping=false,timer=null,heartbeat=null,refreshTimer=null,fetching=false,showBoxes=true,lastPacket=null,facing='user',intentional=false,disposed=false;
  let captureGeneration=0,renderGeneration=0;
  const key=()=>`smartkoz-helmet-${state.user?.id}`;
  const active=()=>data.sessions.find(s=>s.id===selected)||data.sessions.find(s=>!s.ended_at)||data.sessions[0];
  const own=s=>s&&s.user_id===state.user?.id;
  function cameraControls(){return `<label>Источник камеры<select id="helmetDevice"><option value="">Камера по умолчанию</option>${devices.map((d,i)=>`<option value="${safe(d.deviceId)}" ${d.deviceId===deviceId?'selected':''}>${safe(d.label||'Камера '+(i+1))}</option>`).join('')}</select></label><label>Камера телефона<select id="helmetFacing"><option value="user" ${facing==='user'?'selected':''}>Фронтальная</option><option value="environment" ${facing==='environment'?'selected':''}>Основная</option></select></label><button class="v-btn primary" id="helmetStart">Включить камеру</button>`;}
  async function listDevices(){if(!navigator.mediaDevices?.enumerateDevices)return;devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');const select=document.querySelector('#helmetDevice');if(select){select.innerHTML='<option value="">Камера по умолчанию</option>'+devices.map((d,i)=>`<option value="${safe(d.deviceId)}" ${d.deviceId===deviceId?'selected':''}>${safe(d.label||'Камера '+(i+1))}</option>`).join('');}}
  async function request(url,body){
    let r;
    try{r=await fetch(url,{credentials:'include',headers:{'Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});}
    catch(error){connectionLost();throw error;}
    const value=await r.json();if(!r.ok)throw Object.assign(new Error(value.error||'Ошибка запроса'),{status:r.status,...value});return value;
  }
  function view(){
    const shift=operational().shifts.find(s=>!s.ended_at);
    return `<div class="helmet-workspace"><div class="helmet-intro"><div><div class="eyebrow">БЕЗОПАСНОСТЬ СОТРУДНИКА</div><h2>Умная каска</h2><p>Наблюдение за состоянием сотрудника</p></div><span class="status" id="helmetModelBadge">Наблюдение</span></div><div class="helmet-toolbar panel"><button class="v-btn soft" id="helmetSessionOpen">Выбрать сеанс <span id="helmetSelectedName"></span> ↗</button><span id="helmetConnection" class="status">Камера отключена</span><span class="muted" id="helmetUpdated">Обновлений пока нет</span></div><dialog id="helmetSessionDialog" class="v-dialog helmet-session-dialog"><div class="panel-head"><h2>Наблюдение за сотрудником</h2><button type="button" class="text-button" id="helmetSessionCancel" aria-label="Закрыть">✕</button></div><label>Выберите сеанс<select id="helmetSession"><option value="">Сеансов пока нет</option></select></label><div class="button-row"><button type="button" class="v-btn primary" id="helmetSessionApply">Готово</button></div></dialog><div class="helmet-grid"><article class="panel helmet-video-panel"><div class="panel-head"><h2>Видеопоток с каски</h2><label class="check-label"><input type="checkbox" id="helmetBoxes" ${showBoxes?'checked':''}> Показывать рамки</label></div><div class="helmet-stage" id="helmetStage"><div class="helmet-placeholder" id="helmetPlaceholder">${icon('videocam_off')}<strong>Нет обработанного видеопотока</strong><p>${isAdmin()?'Включите камеру ноутбука/Iriun ниже или выберите сессию сотрудника.':'Включите камеру ноутбука, телефона или Iriun.'}</p></div><img id="helmetImage" alt="Изображение с камеры сотрудника" hidden><canvas id="helmetOverlay" aria-hidden="true"></canvas><div class="helmet-frame-label" id="helmetFrameLabel">Ожидание изображения</div></div><div class="helmet-preview" id="helmetPreview"></div><div class="helmet-controls">${cameraControls()}<button class="v-btn soft" id="helmetStop">Остановить мониторинг</button></div>${!isAdmin()&&!shift?'<p class="warning-box">Без смены доступна проверка камеры. Для сохранения событий сотрудника начните смену.</p>':''}<p class="helmet-error" id="helmetError" role="alert"></p><p class="muted">На большом экране показан именно обработанный кадр. Рамки показывают обнаруженные области. Кадры не записываются на диск.</p></article><aside class="panel helmet-state" id="helmetState"><div class="eyebrow">СОСТОЯНИЕ РАБОТНИКА</div><span class="helmet-state-symbol">${icon('visibility')}</span><h2 id="helmetStatus" role="status">Камера отключена</h2><p id="helmetPerson">Сессия не выбрана</p><dl><div><dt>Глаза</dt><dd id="helmetEyes">Нет данных</dd></div><div><dt>Закрыты подряд</dt><dd id="helmetClosed">—</dd></div><div><dt>Видимость</dt><dd id="helmetVisibility">Нет данных</dd></div><div><dt>Кадров в секунду</dt><dd id="helmetFps">—</dd></div><div><dt>Время обработки</dt><dd id="helmetLatency">—</dd></div></dl><div id="helmetAlerts"></div><button class="v-btn soft" id="helmetRetry">Повторить подключение</button><p class="muted">Это предупреждение о возможном риске, а не диагноз. Потеря детекции не доказывает снятие каски.</p></aside></div><div class="panel source-panel"><div class="panel-head"><h2>История предупреждений</h2><span class="status">События сохранены</span></div><div id="helmetHistory">${empty('Событий пока нет')}</div></div><details class="panel source-panel"><summary>Как работает наблюдение</summary><p id="helmetClasses">Модель загружается при запуске мониторинга.</p><p>Порог закрытых глаз — 3 секунды достоверной последовательности; порог потери видимости — 2 секунды после устойчивого обнаружения глаз. Короткие пропуски сглаживаются.</p></details></div>`;
  }
  async function refresh(includeFrame=true){
    const userId=state.user?.id,next=await request('/api/helmet');if(!userId||state.user?.id!==userId)return;data=next;
    if(!data.sessions.some(s=>s.id===selected))selected=data.sessions.find(s=>!s.ended_at)?.id||data.sessions[0]?.id||null;
    updateRegistry();if(state.page!=='helmet')return;
    fillSessions();updateStatus(active());renderHistory();
    if(includeFrame&&!pumping)await fetchFrame();
  }
  function fillSessions(){
    const select=document.querySelector('#helmetSession');if(!select)return;
    if(previewing){select.innerHTML='<option>Проверка камеры</option>';select.disabled=true;return;}select.disabled=false;
    select.innerHTML=data.sessions.length?data.sessions.map(s=>`<option value="${s.id}" ${s.id===selected?'selected':''}>${safe(s.name)} · #${s.id} · ${s.ended_at?'завершена':labels[s.status]||s.status}</option>`).join(''):'<option value="">Сессии пока нет</option>';
  }
  function updateStatus(s){
    if(state.page!=='helmet')return;
    if(previewing)s={status:previewResult?.status||'WARMING_UP',result:previewResult||{},camera_status:'connected',last_analysis_at:previewResult?.analyzed_at};
    const put=(selector,value)=>{const el=document.querySelector(selector);if(el)el.textContent=value;};
    const result=s?.result||{},status=s?.ended_at?'STOPPED':s?.status||'STOPPED';
    put('#helmetStatus',labels[status]||'Ожидание данных');
    put('#helmetSelectedName',previewing?'· Проверка камеры':s?'· '+s.name:'');
    put('#helmetPerson',previewing?`${state.user.name} · локальная проверка камеры, без смены`:s?`${s.name}`:'Можно включить камеру ноутбука или Iriun без сессии');
    put('#helmetEyes',({OPEN:'Открыты',CLOSED:'Закрыты',UNKNOWN:'Недостаточно данных'})[result.eye_state]||'Нет данных');
    put('#helmetClosed',typeof result.closed_seconds==='number'?`${result.closed_seconds.toFixed(1)} с`:'—');
    put('#helmetVisibility',({VISIBLE:'Глаза обнаружены',ACQUIRING:'Подтверждение видимости',TEMPORARILY_LOST:'Короткая потеря детекции',LOST:'Потеря видимости',UNKNOWN:'Нет устойчивых данных'})[result.visibility]||'Нет данных');
    put('#helmetFps',result.fps??'—');put('#helmetLatency',result.inference_ms?`${Math.round(result.inference_ms)} мс`:'—');
    put('#helmetConnection',s&&!s.ended_at?s.camera_status==='connected'?'Кадры поступают':s.camera_status==='connecting'?'Подключение камеры':'Камера потеряна':'Камера отключена');
    put('#helmetUpdated',s?.last_analysis_at?'Последний анализ: '+dt(s.last_analysis_at):'Обработанных кадров пока нет');
    put('#helmetModelBadge',`Наблюдение · ${{idle:'не запущена',loading:'загрузка',ready:'работает',error:'ошибка'}[data.model.status]}`);
    put('#helmetClasses','Наблюдение помогает заметить длительное закрытие глаз и потерю видимости.');
    const card=document.querySelector('#helmetState');if(card)card.dataset.status=status;
    const alertBox=document.querySelector('#helmetAlerts');if(alertBox)alertBox.innerHTML=(result.active_alerts||[]).map(type=>`<p class="helmet-alert">${safe(eventLabels[type]||type)}</p>`).join('');
    const stop=document.querySelector('#helmetStop');if(stop)stop.disabled=!s||Boolean(s.ended_at);
    const start=document.querySelector('#helmetStart');if(start){start.disabled=pumping;start.textContent=pumping?'Камера включена':'Включить камеру';}
    const facingSelect=document.querySelector('#helmetFacing');if(facingSelect)facingSelect.disabled=pumping;
    const retry=document.querySelector('#helmetRetry');if(retry)retry.hidden=data.model.status!=='error';
    if((s?.ended_at||s?.camera_status==='disconnected'||status==='AI_UNAVAILABLE')&&document.querySelector('#helmetImage'))clearFrame();
  }
  function renderHistory(){const el=document.querySelector('#helmetHistory');if(!el)return;el.innerHTML=data.events.length?`<div class="table-scroll"><table><thead><tr><th>Сотрудник / событие</th><th>Начало</th><th>Завершение</th><th>Длительность</th><th>Проверка руководителем</th></tr></thead><tbody>${data.events.map(e=>`<tr><td><strong>${safe(e.name)}</strong><small>${safe(eventLabels[e.event_type])}</small></td><td>${dt(e.started_at)}</td><td>${e.ended_at?dt(e.ended_at):'<span class="status bad">Активно</span>'}</td><td>${e.ended_at?e.duration_seconds.toFixed(1)+' с':'Продолжается'}</td><td>${e.acknowledged_at?dt(e.acknowledged_at):isAdmin()?`<button class="v-btn soft" data-helmet-ack="${e.id}">Ознакомлен</button>`:'Ожидается'}</td></tr>`).join('')}</tbody></table></div>`:empty('Событий пока нет','Предупреждения сохранятся в истории сотрудника.');el.querySelectorAll('[data-helmet-ack]').forEach(b=>b.onclick=()=>guard(async()=>{await request(`/api/helmet/events/${b.dataset.helmetAck}/acknowledge`,{});await refresh(false);}));}
  function updateRegistry(){
    document.querySelectorAll('[data-helmet-employee]').forEach(cell=>{const s=data.sessions.find(s=>s.employee_id===Number(cell.dataset.helmetEmployee));cell.innerHTML=s?`<span class="status ${s.status==='NORMAL'?'good':['EYES_CLOSED_WARNING','VISIBILITY_LOST'].includes(s.status)?'bad':''}">${safe(labels[s.ended_at?'STOPPED':s.status]||s.status)}</span><small>${s.last_analysis_at?dt(s.last_analysis_at):'Нет обработанных кадров'}</small>`:'<span class="status">Не подключена</span>';});
  }
  function clearFrame(){
    renderGeneration++;
    const img=document.querySelector('#helmetImage');if(img){img.hidden=true;img.removeAttribute('src');}
    const canvas=document.querySelector('#helmetOverlay');if(canvas)canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
    const holder=document.querySelector('#helmetPlaceholder');if(holder)holder.hidden=false;
    const stage=document.querySelector('#helmetStage');if(stage){stage.classList.remove('has-frame');stage.style.removeProperty('--helmet-frame-ratio');stage.style.aspectRatio='';stage.style.minHeight='';}
    lastPacket=null;
  }
  function display(packet){
    if(state.page!=='helmet')return;
    const current=document.querySelector('#helmetImage'),width=Number(packet.result?.width),height=Number(packet.result?.height);
    if(!current||!packet.image||!width||!height)return;
    const generation=++renderGeneration,frame=new Image();frame.id=current.id;frame.alt=current.alt;
    frame.onload=()=>{
      frame.onload=null;frame.onerror=null;
      if(generation!==renderGeneration||state.page!=='helmet'||!current.isConnected)return;
      if(frame.naturalWidth!==width||frame.naturalHeight!==height){clearFrame();return;}
      const stage=document.querySelector('#helmetStage');
      stage.style.setProperty('--helmet-frame-ratio',String(width/height));stage.classList.add('has-frame');
      document.querySelector('#helmetPlaceholder').hidden=true;
      frame.hidden=false;current.replaceWith(frame);lastPacket=packet;draw(packet.result);
      const label=document.querySelector('#helmetFrameLabel');if(label)label.textContent=`Изображение обновлено · ${packet.result.fps??'—'} кадров/с`;
    };
    frame.onerror=()=>{frame.onload=null;frame.onerror=null;if(generation===renderGeneration)clearFrame();};
    frame.src=packet.image;
  }
  function draw(result){
    const canvas=document.querySelector('#helmetOverlay');if(!canvas)return;canvas.width=result.width;canvas.height=result.height;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);if(!showBoxes)return;
    for(const d of result.detections||[]){
      if(!d.eye_side||!d.box)continue;
      const [x1,y1,x2,y2]=d.box;
      const color=d.eye_state==='OPEN'?'#2cb281':d.eye_state==='CLOSED'?(result.status==='EYES_CLOSED_WARNING'?'#ee5564':'#e5bd35'):'#e39645';
      ctx.strokeStyle=color;ctx.lineWidth=2;ctx.strokeRect(x1,y1,x2-x1,y2-y1);ctx.font='12px Space Grotesk, Montserrat, sans-serif';
      const label=`${d.label} ${(d.confidence*100).toFixed(0)}%`,width=ctx.measureText(label).width+8,y=Math.max(15,y1);
      ctx.fillStyle='#102233dd';ctx.fillRect(x1,Math.max(0,y-16),width,18);ctx.fillStyle=color;ctx.fillText(label,x1+4,y-3);
    }
  }
  async function fetchFrame(){
    if(fetching||!selected||state.page!=='helmet')return;fetching=true;const sid=selected;
    try{const packet=await request(`/api/helmet/sessions/${sid}/frame`);if(selected===sid){data.sessions=data.sessions.map(s=>s.id===sid?packet.session:s);display(packet);updateStatus(packet.session);}}
    catch(e){if(e.status===404){if(e.session){data.sessions=data.sessions.map(s=>s.id===sid?e.session:s);updateStatus(e.session);}clearFrame();}else throw e;}
    finally{fetching=false;}
  }
  function guard(fn){return Promise.resolve().then(fn).catch(e=>{const error=document.querySelector('#helmetError');if(error)error.textContent=e.message;else toast(e.message,true);});}
  async function mount(){
    disposed=false;
    const picker=document.querySelector('#helmetSessionDialog');
    document.querySelector('#helmetSessionOpen').onclick=()=>picker.showModal();
    document.querySelector('#helmetSessionCancel').onclick=()=>picker.close();
    document.querySelector('#helmetSessionApply').onclick=()=>picker.close();
    picker.onclick=e=>{if(e.target===picker){const r=picker.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)picker.close();}};
    document.querySelector('#helmetSession').onchange=e=>{selected=Number(e.target.value)||null;clearFrame();updateStatus(active());guard(fetchFrame);};
    document.querySelector('#helmetBoxes').onchange=e=>{showBoxes=e.target.checked;if(lastPacket)draw(lastPacket.result);};
    document.querySelector('#helmetFacing')?.addEventListener('change',e=>{facing=e.target.value;});
    document.querySelector('#helmetDevice')?.addEventListener('change',e=>{deviceId=e.target.value;if(pumping)guard(async()=>{const wasPreview=previewing,p=producer;release(false);if(wasPreview)await request('/api/helmet/preview/stop',{});else if(p)await request(`/api/helmet/sessions/${p.id}/disconnect`,{producer_token:p.token});await start();});});
    listDevices().catch(()=>{});
    document.querySelector('#helmetStart')?.addEventListener('click',()=>guard(start));
    document.querySelector('#helmetStop').onclick=()=>{if(previewing){guard(async()=>{release(false);await request('/api/helmet/preview/stop',{});await refresh(false);clearFrame();});return;}const s=active();if(s&&confirm('Остановить мониторинг этой сессии?'))guard(async()=>{await request(`/api/helmet/sessions/${s.id}/stop`,{});if(producer?.id===s.id)release();await refresh(false);clearFrame();});};
    document.querySelector('#helmetRetry').onclick=()=>guard(async()=>{await request('/api/helmet/model/retry',{});await refresh(false);});
    if(video&&stream)document.querySelector('#helmetPreview').append(video);
    await refresh();clearInterval(refreshTimer);refreshTimer=setInterval(()=>{if(state.page==='helmet')guard(()=>refresh(!pumping));},2500);
  }
  async function start(){
    if(pumping)return;
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('Для камеры нужен HTTPS с доверенным сертификатом или localhost. Откройте защищённый адрес сервера; инструкция — SMART_HELMET.md.');
    const button=document.querySelector('#helmetStart');if(button)button.disabled=true;
    try{
      intentional=false;
      stream=await navigator.mediaDevices.getUserMedia({video:{...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:facing}}),width:{ideal:640},height:{ideal:480},frameRate:{ideal:15,max:20}},audio:false});
      video=document.createElement('video');video.muted=true;video.autoplay=true;video.playsInline=true;video.srcObject=stream;video.className='helmet-local-preview';
      document.querySelector('#helmetPreview')?.append(video);await video.play();
      await listDevices();
      previewing=isAdmin()||!operational().shifts.some(s=>!s.ended_at);
      if(previewing){producer={id:null,sequence:0};stream.getVideoTracks().forEach(t=>t.onended=()=>{if(!intentional){release(false);clearFrame();updateStatus(null);}});pumping=true;await refresh(false);pump();return;}
      const stored=JSON.parse(sessionStorage.getItem(key())||'null');
      if(stored&&data.sessions.some(s=>s.id===stored.id&&!s.ended_at)){
        const response=await request(`/api/helmet/sessions/${stored.id}/resume`,{producer_token:stored.token});producer={...stored,sequence:response.session.last_sequence};
      }else{
        const response=await request('/api/helmet/sessions',{});producer={id:response.session.id,token:response.producer_token,sequence:response.session.last_sequence};sessionStorage.setItem(key(),JSON.stringify(producer));
      }
      selected=producer.id;stream.getVideoTracks().forEach(track=>track.onended=()=>{if(!intentional&&producer){pumping=false;clearTimeout(timer);guard(()=>request(`/api/helmet/sessions/${producer.id}/disconnect`,{producer_token:producer.token}));guard(()=>refresh(false));}});
      pumping=true;let lastVideoTime=-1;
      heartbeat=setInterval(()=>{if(!producer||!video)return;if(video.readyState>=2&&video.currentTime!==lastVideoTime){lastVideoTime=video.currentTime;request(`/api/helmet/sessions/${producer.id}/heartbeat`,{producer_token:producer.token}).catch(()=>{});}},2000);
      await refresh(false);pump();
    }catch(e){release(false);const names={NotAllowedError:'Нет разрешения на камеру. Разрешите доступ в настройках браузера.',NotFoundError:'Камера не найдена.',NotReadableError:'Камера занята другим приложением.'};if(names[e.name])e.message=names[e.name];throw e;}
    finally{if(button)button.disabled=pumping;}
  }
  async function pump(){
    if(!pumping||!video||!producer)return;
    const generation=captureGeneration;
    let delay=320;
    try{
      if(!video.videoWidth||video.readyState<2)throw Object.assign(new Error('Камера ещё не передаёт кадры'),{status:503});
      const scale=Math.min(1,640/Math.max(video.videoWidth,video.videoHeight)),canvas=document.createElement('canvas');canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
      const image=canvas.toDataURL('image/jpeg',.72),sid=producer.id;
      const result=await request(previewing?'/api/helmet/preview':`/api/helmet/sessions/${sid}/frames`,{producer_token:producer.token,sequence:++producer.sequence,image});
      if(!pumping||producer?.id!==sid||generation!==captureGeneration)return;
      if(!previewing)sessionStorage.setItem(key(),JSON.stringify(producer));else previewResult=result;
      data.model.status='ready';
      const session=data.sessions.find(s=>s.id===sid);if(session){session.result=result;session.status=result.status;session.camera_status='connected';session.last_analysis_at=result.analyzed_at;session.last_frame_at=result.analyzed_at;}
      if(previewing||selected===sid){display({image,result});updateStatus(session);}const el=document.querySelector('#helmetError');if(el)el.textContent='';
    }catch(e){if(generation!==captureGeneration)return;delay=e.status===429?500:900;if(previewing&&e.status&&e.status!==429){previewResult={status:/загружается/.test(e.message)?'AI_LOADING':'AI_UNAVAILABLE',eye_state:'UNKNOWN',visibility:'UNKNOWN',active_alerts:[]};clearFrame();updateStatus(null);}if(!e.status)connectionLost();if(e.status===401||e.status===403||e.status===409){release(false);}if(e.status!==429){const el=document.querySelector('#helmetError');if(el)el.textContent=e.message;}}
    if(pumping)timer=setTimeout(pump,delay);
  }
  function release(clearToken=true){captureGeneration++;const wasPreview=previewing;previewing=false;previewResult=null;intentional=true;pumping=false;clearTimeout(timer);clearInterval(heartbeat);stream?.getTracks().forEach(t=>t.stop());stream=null;if(video){video.srcObject=null;video.remove();}video=null;if(clearToken&&state.user&&!wasPreview)sessionStorage.removeItem(key());producer=null;}
  async function shutdown(){const p=producer,wasPreview=previewing;release();clearInterval(refreshTimer);disposed=true;try{if(wasPreview)await request('/api/helmet/preview/stop',{});else if(p)await request(`/api/helmet/sessions/${p.id}/stop`,{});}catch{}data={sessions:[],events:[],model:{status:'idle',model:'dreameye.pt'}};selected=null;}
  async function onEvent(change){
    if(change.type==='helmet_frame'){
      if(state.page==='helmet'&&!pumping&&selected===change.entity_id)await fetchFrame();
      if(state.page==='employees')await refresh(false);
    }else{
      await refresh(state.page==='helmet'&&!pumping);
      if(pumping&&!previewing&&producer&&!data.sessions.some(s=>s.id===producer.id&&!s.ended_at))release();
      if(change.type==='helmet_alert_created'){const count=await api('/api/platform');state.platform=count;const b=document.querySelector('.notification-button b');if(b)b.textContent=count.notifications.filter(n=>!n.is_read).length;if(state.page!=='helmet')toast('Каска: новое предупреждение. Откройте вкладку «Каска».',true);}
    }
  }
  window.addEventListener('pagehide',()=>{if(producer){fetch(previewing?'/api/helmet/preview/stop':`/api/helmet/sessions/${producer.id}/disconnect`,{method:'POST',credentials:'include',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({producer_token:producer.token})}).catch(()=>{});}release(false);});
  function connectionLost(){if(state.page!=='helmet')return;clearFrame();const status=document.querySelector('#helmetStatus');if(status)status.textContent='Нет связи с сервером';const card=document.querySelector('#helmetState');if(card)card.dataset.status='CAMERA_DISCONNECTED';const eyes=document.querySelector('#helmetEyes');if(eyes)eyes.textContent='Нет актуальных данных';const connection=document.querySelector('#helmetConnection');if(connection)connection.textContent='Связь потеряна';}
  return {view,mount,onEvent,shutdown,refresh,updateRegistry,connectionLost};
})();
