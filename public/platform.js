/* Operational extensions of the existing SmartKóz application. */
const oldContent = content;
const oldBindShell = bindShell;
const safe = escapeHtml;
let liveSource, connected = false, registerMode = false, selectedCase = null, selectedMap = null;
let mapPoint = null, zonePoints = [], zoneEditing = false, zoom = 1, cameraStream = null;
let pendingReload = false, offset = 0, previousEmergency = null;
const isAdmin = () => state.user?.role === 'ADMIN';
const operational = () => state.platform || {employees:[],shifts:[],cases:[],records:[],emergencies:[],notifications:[],maps:[],zones:[],inspections:[],reports:[],audit:[],jobs:[],detections:[],cameras:[]};
const dt = value => value ? new Date(value).toLocaleString(I18n.locale()) : '—';
const activeEmergency = () => operational().emergencies.find(e=>e.status==='active');
const statusNames = {waiting:'Ожидается подтверждение',self_reported:'Сообщил, что в безопасности',verified:'Безопасность подтверждена руководителем',unconfirmed:'Местонахождение не подтверждено',searching:'Поиск ведётся',observation:'Получено предполагаемое наблюдение',located:'Местонахождение подтверждено',awaiting_safety:'Ожидается подтверждение безопасности',safe:'Безопасность подтверждена',closed:'Поиск закрыт',passed:'СИЗ обнаружены',failed:'Проверка не пройдена',unavailable:'AI недоступен',approved:'Одобрено руководителем',pending:'Проверка выполняется',ready:'Анализ завершён',processing:'Обработка записи'};
const badge = (value,label) => `<span class="status ${['passed','approved','safe','verified','closed','ready'].includes(value)?'good':['unconfirmed','failed'].includes(value)?'bad':''}">${safe(label || statusNames[value] || value)}</span>`;
const btn = (label,action,cls='soft',extra='') => `<button class="v-btn ${cls}" data-action="${action}" ${extra}>${label}</button>`;
const empty = (title,detail='') => `<div class="empty"><span class="empty-symbol">◌</span><h3>${title}</h3>${detail?`<p>${detail}</p>`:''}</div>`;
const field = (label,name,type='text',extra='') => `<label>${label}<input name="${name}" type="${type}" ${extra}></label>`;
function toast(message,error=false){let t=document.querySelector('#notice');if(!t){t=document.createElement('div');t.id='notice';t.setAttribute('role','status');document.body.append(t);}t.className=error?'notice error':'notice';t.textContent=message;clearTimeout(t.timer);t.timer=setTimeout(()=>t.remove(),6500);}
async function send(url,body={},method='POST'){return api(url,{method,body:JSON.stringify(body)});}
async function refreshData(renderNow=true){await loadData();if(renderNow)render();}
loadData = async function(){
  [state.data,state.platform] = await Promise.all([api('/api/dashboard'),api('/api/platform')]);
  offset = Date.parse(state.platform.server_time)-Date.now();
};
function startLive(){
  liveSource?.close();liveSource=new EventSource('/api/events');
  let firstConnection=true;
  liveSource.onopen=()=>{connected=true;updateConnection();};
  liveSource.onerror=()=>{connected=false;updateConnection();HelmetUI.connectionLost();};
  liveSource.onmessage=async event=>{
    const change=JSON.parse(event.data);
    try{
      if(change.type.startsWith('helmet_')){await HelmetUI.onEvent(change);return;}
      const initial=change.type==='connected'&&firstConnection;
      firstConnection=false;
      const before=activeEmergency()?.id;
      await loadData();
      const after=activeEmergency();
      if(initial&&before===after?.id)return;
      if(after&&after.id!==before&&!isAdmin()){
        stopCamera();
        state.page='emergency';
        window.scrollTo(0,0);
        if('Notification' in window && Notification.permission==='granted'){
          try{new Notification('Объявлена эвакуация',{body:after.title});}catch{ /* In-app evacuation remains the primary delivery channel. */ }
        }
      }
      // Keep a form draft or video playback intact during unrelated updates.
      const editing=document.activeElement?.closest('form')||document.querySelector('dialog[open], form[data-dirty]');
      if(editing&&change.type!=='emergency_created'){pendingReload=true;return;}
      if(['cameras','transport','cargo','sound'].includes(state.page)&&change.type!=='emergency_created'){pendingReload=true;return;}
      render();
    }catch(error){toast(error.message,true);}
  };
}
function updateConnection(){document.querySelectorAll('[data-connection]').forEach(el=>{el.classList.toggle('offline',!connected);el.textContent=connected?'Синхронизация активна':'Связь потеряна · переподключение';});}
loginView = function(error=''){
  liveSource?.close();connected=false;AgentUI.reset();AccountUI.close();
  app.innerHTML=`<main class="auth-layout"><section class="auth-story"><a class="v-brand" href="/">${brandMark()}<strong>SmartKóz</strong></a><div class="auth-copy"><div class="eyebrow">БЕЗОПАСНОСТЬ ПРЕДПРИЯТИЯ</div><h1>Безопасность.<br>В едином поле<br><em>зрения.</em></h1><p>Люди, события и решения — в одной системе промышленной безопасности.</p><div class="auth-features"><span>01 / AI-мониторинг</span><span>02 / Учёт присутствия</span><span>03 / Экстренное реагирование</span></div></div><small>SmartKóz · Вместе заботимся о безопасности</small></section><section class="auth-panel"><div class="auth-card"><div class="eyebrow">ЛИЧНЫЙ КАБИНЕТ</div><h2>${registerMode?'Регистрация сотрудника':'Добро пожаловать'}</h2><p>${registerMode?'Создайте личную учётную запись предприятия.':'Войдите в свою рабочую область.'}</p><form id="authForm">${registerMode?field('ФИО','name','text','required maxlength="120" autocomplete="name"'):''}${field('Email','email','email','required autocomplete="username"')}${registerMode?`<div class="two">${field('Отдел','department')}${field('Должность','position')}</div>`:''}${field('Пароль','password','password',`required autocomplete="${registerMode?'new':'current'}-password" ${registerMode?'minlength="8"':''}`)}${registerMode?field('Повторите пароль','confirm_password','password','required minlength="8" autocomplete="new-password"'):''}<div class="form-error" role="alert">${safe(error)}</div><button class="v-btn primary" type="submit">${registerMode?'Создать аккаунт':'Войти в систему'} <span>↗</span></button></form><button class="text-button" id="toggleAuth">${registerMode?'Уже есть аккаунт? Войти':'Новый сотрудник? Зарегистрироваться'}</button><p class="auth-note">Доступ к рабочим данным определяется вашей ролью.</p></div></section></main>`;
  I18n.mount();
  document.querySelector('#toggleAuth').onclick=()=>{registerMode=!registerMode;loginView();};
  document.querySelector('#authForm').onsubmit=async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');b.disabled=true;try{const result=await send(registerMode?'/api/register':'/api/login',Object.fromEntries(new FormData(e.currentTarget)));state.user=result.user;state.page='overview';try{await loadData();}catch(error){if(error.message.includes('пароль')){passwordGate();return;}throw error;}render();startLive();}catch(err){document.querySelector('.form-error').textContent=err.message;}finally{b.disabled=false;}};
};
const nav = () => isAdmin() ? [['overview','Обзор'],['cameras','AI-мониторинг'],['transport','Транспорт'],['tasks','Задания'],['employees','Сотрудники'],['helmet','Каска'],['emergency','Экстренные ситуации']] : [['overview','Моя смена'],['helmet','Каска'],['emergency','Безопасность'],['notifications','Уведомления']];
shell = function(){
  if(['air','equipment','map','assistant'].includes(state.page))state.page='overview';
  const p=operational(),em=activeEmergency();
  const title=({overview:isAdmin()?'Обзор безопасности':'Моя рабочая смена',cameras:'AI-мониторинг',helmet:'Каска',employees:'Сотрудники',emergency:'Центр экстренного реагирования',equipment:'Оборудование',air:'Качество воздуха',map:'Карта предприятия',history:'История событий',notifications:'Центр уведомлений',transport:'Транспорт','gate-journal':'Журнал въездов',cargo:'Контроль груза',sound:'Мониторинг звука',tasks:'Задания',assistant:'ИИ-ассистент'})[state.page]||'SmartKóz';
  app.innerHTML=`<div class="v-app ${em?'emergency-mode':''} ${!isAdmin()&&em&&['overview','emergency'].includes(state.page)?'evacuation-priority':''}"><header class="v-header"><a class="v-brand" href="/">${brandMark()}<strong>SmartKóz</strong></a><div class="header-right"><button class="notification-button" data-page="notifications" aria-label="Уведомления">${icon('notifications')}<b>${p.notifications.filter(n=>!n.is_read).length}</b></button><button class="profile-button" data-action="account" aria-label="Личный кабинет"><span>${safe(state.user.name.charAt(0))}</span><strong>${safe(state.user.name)}</strong></button><button class="text-button" data-action="logout">Выйти</button></div></header><div class="nav-wrap"><nav class="top-nav" aria-label="Основная навигация">${nav().map(([key,label])=>`<button data-page="${key}" class="${(state.page==='gate-journal'?'transport':state.page)===key?'selected':''}" ${(state.page==='gate-journal'?'transport':state.page)===key?'aria-current="page"':''}>${label}</button>`).join('')}</nav>${isAdmin()?`<button class="history-button ${state.page==='history'?'selected':''}" data-page="history">${icon('history')} История</button>`:''}</div>${em?`<div class="emergency-banner"><span class="pulse-dot"></span><strong>Активная эвакуация · ${safe(em.title)}</strong><button data-page="emergency">Открыть центр →</button></div>`:''}<main class="v-main"><div class="page-heading"><div><div class="eyebrow">${isAdmin()?'КОНТРОЛЬ ПРЕДПРИЯТИЯ':'ЛИЧНАЯ БЕЗОПАСНОСТЬ'} <span>/</span> <span data-current-date>${new Date().toLocaleDateString(I18n.locale(),{day:'numeric',month:'long',year:'numeric'})}</span></div><h1>${title}</h1><p>${isAdmin()?'Актуальные данные. Согласованные действия.':safe(state.user.name)+' · '+safe(p.me?.department||'Отдел не указан')}</p></div><div class="heading-actions">${btn('↻ Обновить','refresh')}${isAdmin()&&state.page==='overview'?`<button class="v-btn primary" data-page="emergency">Центр реагирования ↗</button>`:''}</div></div><section id="v-content">${workspaceContent()}</section></main><footer class="v-footer"><span>SmartKóz <b>·</b> Безопасность предприятия</span><span>Люди · Безопасность · Контроль</span></footer></div>`;
  if(!isAdmin()&&state.page==='overview'&&!em)document.querySelector('.employee-safety')?.insertAdjacentHTML('beforeend','<button class="v-btn soft" data-page="tasks">Мои задания →</button>');
  document.querySelector('.v-app')?.classList.toggle('helmet-page',state.page==='helmet');
  bindWorkspace();
  if(['cameras','transport','cargo','sound','tasks','assistant'].includes(state.page)){
    setupVisionPanels();setupCargoControl();setupSoundMonitor();bindCameraTabs();bindTransportTools();bindTaskTools();
    if(state.page==='assistant')document.querySelector('#assistantForm')?.addEventListener('submit',async e=>{e.preventDefault();try{const result=await send('/api/assistant',{question:e.currentTarget.question.value});document.querySelector('#chatLog').insertAdjacentHTML('beforeend',formatAssistantAnswer(result.answer));}catch(err){toast(err.message,true);}});
    if(state.page==='tasks'){
      formHandler('#taskForm',v=>send('/api/tasks',v));
      document.querySelectorAll('[data-task]').forEach(select=>select.onchange=async()=>{try{await send(`/api/tasks/${select.dataset.task}`,{status:select.value},'PATCH');await refreshData();}catch(error){toast(error.message,true);}});
    }
  }
  setupMap();drawJobOverlay();updateTimers();GlassUI.mount();AgentUI.mount();I18n.mount();
  if(state.page==='helmet')HelmetUI.mount().catch(error=>toast(error.message,true));
};
function metricCard(label,value,note,ic){return `<article class="v-metric"><div class="metric-top"><span>${label}</span>${icon(ic)}</div><strong>${value}</strong><small>${note}</small></article>`;}
function workspaceContent(){
  const p=operational();
  if(state.page==='helmet')return HelmetUI.view();
  if(state.page==='overview')return isAdmin()?overviewWorkspace():employeeWorkspace();
  if(state.page==='employees')return employeeRegistry();
  if(state.page==='emergency')return emergencyWorkspace();
  if(state.page==='map')return mapWorkspace();
  if(state.page==='history')return historyWorkspace();
  if(state.page==='notifications')return `<div class="panel"><div class="panel-head"><h2>Ваши уведомления</h2>${btn('Отметить прочитанными','read')}</div>${p.notifications.map(n=>`<article class="notification-item ${n.is_read?'':'unread'}"><div><h3>${safe(n.title)}</h3><p>${safe(n.message)}</p></div><time>${dt(n.created_at)}</time></article>`).join('')||empty('Уведомлений пока нет')}</div>`;
  if(state.page==='equipment')return telemetryWorkspace();
  if(state.page==='transport')return transportWorkspace();
  if(state.page==='gate-journal')return transportJournalWorkspace();
  if(state.page==='cameras')return recordedMonitoringView();
  return oldContent();
}
function recordedMonitoringView(){
  const recordings=[
    ['outfit','Контроль СИЗ','outfitcheck.pt'],
    ['fall','Обнаружение падений','falling.pt'],
    ['dream','Сонливость сотрудника','dreameye.pt']
  ];
  return `<div class="info-bar">Безопасность сотрудников. Выберите наблюдение для быстрого перехода.</div><div class="monitoring-links">${recordings.map(([kind,title])=>`<button class="v-btn soft" data-scroll-camera="${kind}">${title}</button>`).join('')}</div><div class="recorded-monitoring-grid">${recordings.map(([kind,title,model])=>visionPanel(kind,{title,subtitle:kind==='dream'?'Иван Иванов Иванович':'Контроль безопасности сотрудников',status:'Наблюдение активно',badge:'Видео'})).join('')}</div>`;
}
function overviewWorkspace(){
  const p=operational(),onShift=p.shifts.filter(s=>!s.ended_at).length,em=activeEmergency();
  return `${GlassUI.hero()}<div class="workspace-shortcuts"><button data-page="cameras" class="workspace-shortcut"><span>Наблюдение</span><small>Безопасность на рабочих местах</small><b>↗</b></button><button data-page="transport" class="workspace-shortcut"><span>Транспорт</span><small>Камеры КПП и журнал въездов</small><b>↗</b></button><button data-page="helmet" class="workspace-shortcut"><span>Умная каска</span><small>Состояние сотрудника в реальном времени</small><b>↗</b></button><button data-page="tasks" class="workspace-shortcut"><span>Задания</span><small>Поручения для сотрудников</small><b>↗</b></button></div><div class="metrics-grid">${metricCard('Сотрудники',p.employees.length,'Зарегистрированы в системе','groups')}${metricCard('На смене',onShift,'Присутствие зарегистрировано','badge')}${metricCard('Активные нарушения',state.data.metrics.activeIncidents,'Требуют внимания','shield')}${metricCard('Чрезвычайные ситуации',em?1:0,em?'Активна эвакуация':'Нет активных происшествий','emergency')}</div><div class="overview-grid"><article class="panel readiness"><div class="panel-head"><div><span class="eyebrow">ГОТОВНОСТЬ К РЕАГИРОВАНИЮ</span><h2>${em?'Эвакуация продолжается':'Готовность к быстрому решению'}</h2></div><span class="round-icon">${icon('verified_user')}</span></div><p>Присутствие сотрудников, оповещения и статусы безопасности в одном контуре.</p><div class="readiness-lines"><div><span>Система оповещений</span><b class="${connected?'positive':''}">${connected?'Подключена':'Переподключение'}</b></div><div><span>Источники наблюдения</span><b>${p.cameras.length||'Не подключены'}</b></div></div><button class="v-btn ${em?'danger':'primary'}" data-page="emergency">Открыть центр реагирования <span>↗</span></button></article><article class="panel"><div class="panel-head"><h2>Последние события</h2><button class="text-button" data-page="history">Все события ↗</button></div>${p.audit.slice(0,4).map(a=>`<div class="event-row"><span class="event-dot"></span><div><strong>${auditLabel(a.action)}</strong><p>${safe(a.actor||'Серверный контроль')}</p></div><time>${dt(a.timestamp)}</time></div>`).join('')||empty('Событий пока нет','События появятся после регистрации сотрудников и начала работы.')}</article></div>`;
}
function employeeWorkspace(){
  const p=operational(),shift=p.shifts.find(s=>!s.ended_at),em=activeEmergency();
  if(em)return emergencyWorkspace();
  return `${GlassUI.hero()}<div class="employee-grid"><article class="panel shift-card"><div class="shift-entry-icon">${icon('badge')}</div><span class="eyebrow">ПРИСУТСТВИЕ НА ОБЪЕКТЕ</span><h2>${shift?'Вы на смене':'Начните рабочую смену'}</h2><p>${shift?'Начало: '+dt(shift.started_at):'Отметьте начало смены, чтобы оставаться на связи с командой.'}</p>${shift?badge('passed','Присутствие зарегистрировано'):''}<div class="shift-actions">${shift?btn('Завершить смену','endShift','primary'):btn('Начать смену','startShift','primary')}<button class="v-btn soft" data-page="helmet">Открыть каску ↗</button></div></article><div><article class="panel"><h2>Мой профиль</h2><dl class="profile-list"><dt>Сотрудник</dt><dd>${safe(state.user.name)}</dd><dt>Email</dt><dd>${safe(state.user.email)}</dd><dt>Отдел</dt><dd>${safe(p.me?.department||'Не указан')}</dd><dt>Должность</dt><dd>${safe(state.user.position||'Не указана')}</dd></dl>${btn('Изменить пароль','profile')}</article><article class="panel employee-safety"><h2>Всегда на связи</h2><p>Держите приложение открытым для получения оповещений. После восстановления соединения данные обновятся автоматически.</p>${btn('Разрешить уведомления','permission')}<div class="contact-links"><a href="tel:112">112 <small>Экстренная помощь</small></a></div></article></div></div>`;
}
function helmetRegistryCell(employeeId){
  const s=(operational().helmet_sessions||[]).find(h=>h.employee_id===employeeId);
  if(!s)return '<span class="status">Не подключена</span>';
  const names={NORMAL:'Глаза открыты',EYES_CLOSED:'Глаза закрыты',EYES_CLOSED_WARNING:'Предупреждение о сонливости',VISIBILITY_LOST:'Потеря видимости',CAMERA_DISCONNECTED:'Камера потеряна',AI_UNAVAILABLE:'Ошибка AI',WARMING_UP:'Ожидание данных',AI_LOADING:'Загрузка модели',STOPPED:'Не подключена'};
  return `<span class="status ${s.status==='NORMAL'?'good':['VISIBILITY_LOST','EYES_CLOSED_WARNING'].includes(s.status)?'bad':''}">${names[s.ended_at?'STOPPED':s.status]||'Ожидание данных'}</span><small>${dt(s.last_analysis_at)}</small>`;
}
function employeeRegistry(){
  const p=operational();
  return `<div class="registry-stats"><span><b>${p.employees.length}</b> зарегистрировано</span><span><b>${p.shifts.filter(s=>!s.ended_at).length}</b> на смене</span></div><div class="panel">${p.employees.length?`<div class="table-scroll"><table><thead><tr><th>Сотрудник</th><th>Отдел / должность</th><th>Присутствие</th><th>Начало смены</th><th>Эвакуация</th><th>Smart Helmet</th></tr></thead><tbody>${p.employees.map(e=>{const r=p.records.find(r=>r.employee_id===e.id&&r.emergency_id===activeEmergency()?.id);return `<tr><td><div class="person-cell">${e.image_path?`<img src="/api/ppe/${e.inspection_id}/photo" alt="Фото ${safe(e.name)}">`:'<span class="avatar">'+safe(e.name.charAt(0))+'</span>'}<strong>${safe(e.name)}</strong></div></td><td>${safe(e.department||'—')}<small>${safe(e.position)}</small></td><td>${badge(e.shift_id?'passed':'inactive',e.shift_id?'На смене':'Не на смене')}</td><td>${dt(e.started_at)}</td><td>${r?badge(r.status):'Не участвует'}</td><td data-helmet-employee="${e.id}">${helmetRegistryCell(e.id)}</td></tr>`;}).join('')}</tbody></table></div>`:empty('Сотрудники пока не зарегистрированы','После регистрации на другом устройстве сотрудник появится здесь автоматически.')}</div>`;
}
function emergencyWorkspace(){
  const p=operational(),em=activeEmergency(),cases=p.cases.filter(c=>c.status!=='closed');
  if(!isAdmin()){
    const r=p.records.find(r=>r.emergency_id===em?.id);
    return `${em?`<article class="evacuation-screen"><div class="eyebrow">ЭКСТРЕННОЕ ОПОВЕЩЕНИЕ</div><h2>ОБЪЯВЛЕНА<br>ЭВАКУАЦИЯ</h2><h3>${safe(em.title)}</h3><p>${safe(em.description)}</p><p>Начало: ${dt(em.started_at)} · <strong data-timer="${em.started_at}"></strong></p><div class="evacuation-instructions">Покиньте опасную зону по утверждённому маршруту. Сообщайте о безопасности после выхода из опасной зоны.</div>${r?.safe_confirmed_at||r?.verified_at?`<div class="safety-sent">✓ Ваш статус передан руководству</div><p>Самостоятельная отметка — ваше заявление о безопасности.</p>`:btn('Я в безопасности','safe','safety',`data-id="${em.id}"`)}</article>`:`<article class="panel calm-state"><div class="calm-symbol">✓</div><h2>Нет активных чрезвычайных ситуаций</h2><p>Оповещения поступают в открытое приложение.</p></article>`}<div class="panel source-panel"><h2>Экстренные контакты · Казахстан</h2><div class="contact-links">${[['112','Единая служба'],['101','Пожарная охрана'],['102','Полиция'],['103','Скорая помощь']].map(([n,label])=>`<a href="tel:${n}">${n}<small>${label}</small></a>`).join('')}</div></div>${caseList(cases)}${selectedCase?caseWorkspace():''}`;
  }
  const records=p.records.filter(r=>r.emergency_id===em?.id),safeCount=records.filter(r=>r.safe_confirmed_at||r.verified_at).length;
  return `${em?`<article class="panel live-evacuation"><div class="panel-head"><div><span class="eyebrow">АКТИВНАЯ ЭВАКУАЦИЯ</span><h2>${safe(em.title)}</h2><p>${safe(em.description)}</p></div><strong class="evacuation-timer" data-timer="${em.started_at}"></strong></div><div class="evacuation-numbers"><div><strong>${records.length}</strong><span>Участников</span></div><div><strong>${safeCount}</strong><span>Сообщили о безопасности</span></div><div><strong>${records.length-safeCount}</strong><span>Без подтверждения</span></div><div><strong>${cases.filter(c=>c.emergency_id===em.id).length}</strong><span>Поисковых случаев</span></div></div><progress max="${records.length||1}" value="${safeCount}"></progress><p>${safeCount} / ${records.length} · Самоотметка не подтверждает физическое местонахождение независимо.</p><div class="table-scroll"><table><thead><tr><th>Сотрудник</th><th>Статус</th><th>Время сообщения</th></tr></thead><tbody>${records.map(r=>`<tr><td>${safe(r.name)}</td><td>${badge(r.status)}</td><td>${dt(r.safe_confirmed_at||r.verified_at)}</td></tr>`).join('')}</tbody></table></div><div class="button-row">${btn('Завершить ЧП','resolve','soft',`data-id="${em.id}"`)}<span class="muted">Когда все участники подтвердят безопасность, эвакуация завершится автоматически.</span></div></article>`:`<div class="emergency-ready-grid"><article class="panel calm-state"><div class="calm-symbol">✓</div><span class="eyebrow">ШТАТНЫЙ РЕЖИМ</span><h2>Нет активных чрезвычайных ситуаций</h2><p>На смене: ${p.shifts.filter(s=>!s.ended_at).length} · ${connected?'Оповещения подключены':'Соединение восстанавливается'}</p>${btn('Объявить чрезвычайную ситуацию','declare','primary')}</article><article class="panel"><h2>Порядок реагирования</h2><ol class="shift-steps"><li>Объявите ЧП и передайте инструкции сотрудникам на смене.</li><li>Контролируйте сообщения о безопасности в реальном времени.</li><li>Через 5 минут сотрудники без ответа попадут в список поиска.</li><li>Проверьте наблюдения и подтвердите результат поиска.</li></ol><p class="muted">Отсутствие отметки не означает, что человек пропал.</p></article></div>`}${caseList(cases)}${selectedCase?caseWorkspace():''}<div class="panel source-panel"><h2>История происшествий</h2>${p.emergencies.filter(e=>e.status==='resolved').map(e=>`<div class="event-row"><div><strong>${safe(e.title)}</strong><p>${dt(e.started_at)} — ${dt(e.resolved_at)}</p><p>${safe(e.resolution_note||'')}</p></div><span class="status good">Завершено</span></div>`).join('')||empty('Завершённых происшествий нет')}</div>`;
}
function caseList(cases){return `<div class="section-heading"><h2>Проверка местонахождения</h2><span>${cases.length} активных случаев</span></div>${cases.length?`<div class="case-grid">${cases.map(c=>`<article class="panel case-card">${c.image_path?`<img src="/api/ppe/${c.inspection_id}/photo" alt="Фото проверки ${safe(c.name)}">`:'<div class="no-photo">Фото отсутствует</div>'}<div><h3>${safe(c.name)}</h3><p>${safe(c.department||'Отдел не указан')}</p>${badge(c.status)}<p>Смена: ${dt(c.shift_started_at)}<br>Поиск: ${dt(c.search_started_at)}</p><button class="v-btn primary" data-case="${c.id}">Открыть поисковый случай ↗</button></div></article>`).join('')}</div>`:empty('Нет активных поисковых случаев','Сервер создаст случай после 300 секунд без сообщения о безопасности.')}`;}
function zoneSelect(name='zone_id',required=true){return `<label>Зона<select name="${name}" ${required?'required':''}><option value="">Выберите зону</option>${operational().zones.map(z=>`<option value="${z.id}">${safe(z.name)}</option>`).join('')}</select></label>`;}
function caseWorkspace(){
  const p=operational(),c=p.cases.find(c=>c.id===selectedCase);if(!c)return '';
  const reports=p.reports.filter(r=>r.case_id===c.id),jobs=p.jobs.filter(j=>j.case_id===c.id),detections=p.detections.filter(d=>d.case_id===c.id);
  const transitions={unconfirmed:['searching','located','safe'],searching:['located','safe'],observation:['searching','located','safe'],located:['awaiting_safety','safe'],awaiting_safety:['located','safe'],safe:['closed'],closed:[]};
  const ranked=[...new Set([...reports.filter(r=>r.zone_id).map(r=>r.zone_id),...detections.map(d=>d.zone_id)])];
  return `<section class="panel case-detail" id="caseDetail"><div class="panel-head"><div><span class="eyebrow">ПОИСКОВЫЙ СЛУЧАЙ #${c.id}</span><h2>${safe(c.name)}</h2></div>${btn('Закрыть карточку','closeCase')}</div><p>Последнее сообщение: ${reports[0]?dt(reports[0].observed_at)+' · '+safe(reports[0].zone_name||'Наблюдение'):'Нет зарегистрированных наблюдений'}</p><div class="info-bar">Наблюдения и AI-результаты требуют проверки человеком. Обнаружение человека не доказывает его личность и безопасность.</div><div class="witness-list">${reports.map(r=>`<article><strong>${safe(r.author)} · ${dt(r.observed_at)}</strong><p>${safe(r.description)}</p><small>Сообщение очевидца · ${safe(r.zone_name||'Наблюдение')} · не проверено</small></article>`).join('')}</div>${isAdmin()?`<div class="case-admin"><h3>Решение руководителя</h3><form id="caseStatusForm"><input name="case_id" type="hidden" value="${c.id}"><div class="two"><label>Следующий статус<select name="status" required>${transitions[c.status].map(s=>`<option value="${s}">${statusNames[s]}</option>`).join('')}</select></label>${field('Источник информации / итог','comment','text','required')}</div><label class="check-label"><input name="services_informed" type="checkbox"> Информация передана экстренным службам</label><button class="v-btn primary" ${c.status==='closed'?'disabled':''}>Сохранить решение</button></form><h3>Рекомендованный порядок проверки зон</h3><p>${ranked.map((z,i)=>(i+1)+'. '+safe(p.zones.find(zone=>zone.id===z)?.name||'Зона')).join(' → ')||'Нет наблюдений для приоритизации зон'}</p><p class="muted">Порядок основан на свежих сообщениях очевидцев, затем на зонах обнаружения людей; это не маршрут и не установленное местонахождение.</p><h3>Анализ видеозаписи</h3><form id="videoForm"><input type="hidden" name="case_id" value="${c.id}"><div class="three">${field('Запись MP4 / WebM, до 25 МБ','video','file','accept="video/mp4,video/webm" required')}${zoneSelect()}${field('Время начала записи','recorded_at','datetime-local','required')}</div><button class="v-btn primary">Загрузить и анализировать</button></form>${jobs.map(j=>`<article class="video-job"><div>${badge(j.status)}<p>${safe(j.error||'Результаты относятся к людям в кадре; личность не установлена автоматически.')}</p></div><div class="search-video-stage"><video src="/api/videos/${j.id}" controls preload="metadata" data-job="${j.id}"></video><canvas aria-hidden="true"></canvas></div><div class="detections-list">${detections.filter(d=>d.job_id===j.id).map(d=>`<div><strong>Обнаружен человек</strong><span>${d.time_offset.toFixed(1)} сек · ${(d.confidence*100).toFixed(0)}% · ${safe(d.zone_name||'')}</span><span>${safe(({unreviewed:'Личность не установлена',possible_match:'Возможное совпадение',identity_confirmed:'Личность подтверждена человеком',rejected:'Отклонено'})[d.verification_status])}</span>${btn('Проверить результат','reviewDetection','soft',`data-id="${d.id}"`)}</div>`).join('')}</div></article>`).join('')}</div>`:''}</section>`;
}
function mapWorkspace(embedded=false){
  const p=operational(),map=p.maps.find(m=>m.id===selectedMap)||p.maps[0];if(map)selectedMap=map.id;
  const reports=p.reports.filter(r=>r.map_id===map?.id&&(!selectedCase||r.case_id===selectedCase));
  return `<div class="${embedded?'embedded-map':'panel'}"><div class="panel-head"><h2>${map?safe(map.name):'Карта предприятия'}</h2><div class="button-row">${map?`${btn('−','zoomOut','soft','aria-label="Уменьшить карту"')}${btn('+','zoomIn','soft','aria-label="Увеличить карту"')}${btn('Сброс','zoomReset')}`:''}${isAdmin()&&!embedded?btn(zoneEditing?'Отменить разметку':'Добавить зону','editZone'):''}</div></div>${p.maps.length>1?`<label>План<select id="mapSelect">${p.maps.map(m=>`<option value="${m.id}" ${m.id===map.id?'selected':''}>${safe(m.name)}</option>`).join('')}</select></label>`:''}${map?`<div class="map-viewport" tabindex="0" aria-label="Карта: прокрутка и масштабирование"><div class="map-stage" id="mapStage" style="width:${zoom*100}%"><img src="/api/maps/${map.id}/image" alt="${safe(map.name)}" draggable="false"><svg viewBox="0 0 1000 1000" preserveAspectRatio="none">${p.zones.filter(z=>z.map_id===map.id).map(z=>{const points=JSON.parse(z.polygon_data);return `<polygon points="${points.map(([x,y])=>`${x*1000},${y*1000}`).join(' ')}"><title>${safe(z.name)}</title></polygon><text x="${points[0][0]*1000}" y="${points[0][1]*1000}">${safe(z.name)}</text>`;}).join('')}${zoneEditing?`<polyline points="${zonePoints.map(([x,y])=>`${x*1000},${y*1000}`).join(' ')}"/>`:''}</svg>${reports.map((r,i)=>`<span class="map-pin" style="left:${r.map_x*100}%;top:${r.map_y*100}%" title="${safe(r.author)} · ${dt(r.observed_at)} · ${safe(r.description)}">${i+1}</span>`).join('')}${mapPoint?`<span class="map-pin chosen" style="left:${mapPoint.x*100}%;top:${mapPoint.y*100}%">+</span>`:''}</div></div><p class="muted">${zoneEditing?'Нажмите на план, чтобы задать вершины границы. Минимум 3 точки.':embedded?'Нажмите на план, чтобы выбрать точку наблюдения.':'Масштаб: кнопки +/−. Перемещение: прокрутка или жест на сенсорном экране.'}</p>${zoneEditing?`<form id="zoneForm" class="inline-form">${field('Название зоны','name','text','required')}<span id="pointCount">Точек: ${zonePoints.length}</span><button class="v-btn primary">Сохранить границу</button></form>`:''}`:empty('План предприятия не загружен','Руководитель может добавить реальную схему предприятия.')}${isAdmin()&&!embedded?`<form id="mapForm" class="inline-form">${field('Название плана','name','text','required')}${field('Схема PNG / JPG / SVG, до 8 МБ','image','file','accept="image/png,image/jpeg,image/svg+xml" required')}<button class="v-btn primary">Загрузить план</button></form><p class="muted">Загрузите схему предприятия в формате изображения.</p>`:''}</div>`;
}
function telemetryWorkspace(){const sensors=state.data.sensors;return `<div class="panel"><div class="panel-head"><h2>Измерения и состояние источников</h2><span class="status">${sensors.length?sensors.length+' показателей':'Источник не подключён'}</span></div>${sensors.length?`<div class="table-scroll"><table><thead><tr><th>Показатель</th><th>Зона</th><th>Измерение</th><th>Состояние</th><th>Обновление</th></tr></thead><tbody>${sensors.map(s=>`<tr><td>${safe(s.type)}</td><td>${safe(s.zone)}</td><td>${s.value} ${safe(s.unit)}</td><td>${badge(s.status)}</td><td>${dt(s.updated_at)}</td></tr>`).join('')}</tbody></table></div>`:empty('Нет данных','Подключите источник через POST /api/telemetry или внесите фактическое измерение ниже.')}<details class="source-panel"><summary>Добавить фактическое измерение</summary><form id="telemetryForm"><div class="three">${field('Показатель','type','text','required')}${field('Зона','zone','text','required')}${field('Значение','value','number','required step="any"')}${field('Единица','unit','text','required')}${field('Источник / прибор','source','text','required')}<label>Состояние<select name="status"><option value="normal">Норма</option><option value="warning">Предупреждение</option><option value="critical">Критическое</option></select></label></div><button class="v-btn primary">Сохранить измерение</button></form></details></div>`;}
function auditLabel(action){return ({employee_registered:'Сотрудник зарегистрирован',shift_started:'Начало смены',shift_ended:'Смена завершена',ppe_check_completed:'Проверка СИЗ выполнена',ppe_manually_approved:'Ручное одобрение СИЗ',emergency_created:'Объявлена эвакуация',self_reported_safe:'Сотрудник сообщил о безопасности',missing_case_created:'Местонахождение не подтверждено',last_seen_report_created:'Получено сообщение очевидца',search_status_changed:'Обновлён статус поиска',emergency_resolved:'ЧП завершено',map_uploaded:'План предприятия загружен',zone_created:'Зона сохранена',photo_deleted:'Фото удалено',ai_detection_created:'Получен результат анализа',detection_reviewed:'Наблюдение проверено',password_changed:'Пароль изменён',camera_configured:'Источник камеры сохранён',telemetry_received:'Измерение получено'})[action]||action;}
function historyWorkspace(){const p=operational();return `<div class="panel"><h2>Происшествия и поисковые случаи</h2>${p.emergencies.map(e=>{const rows=p.records.filter(r=>r.emergency_id===e.id);return `<details class="history-entry"><summary>${safe(e.title)} · ${dt(e.started_at)} · ${e.status==='active'?'Активно':'Завершено'}</summary><p>${safe(e.description)}</p><p>Участников: ${rows.length} · Сообщили о безопасности: ${rows.filter(r=>r.safe_confirmed_at||r.verified_at).length}</p><p>${safe(e.resolution_note||'')}</p>${p.cases.filter(c=>c.emergency_id===e.id).map(c=>`<p>${safe(c.name)} · ${statusNames[c.status]} · ${dt(c.search_started_at)} — ${dt(c.closed_at)} · ${safe(c.comment||'')}${btn('Открыть','historyCase','soft',`data-id="${c.id}"`)}</p>`).join('')}</details>`;}).join('')||empty('История происшествий пуста')}</div><div class="panel source-panel"><h2>Журнал действий</h2>${p.audit.map(a=>`<details class="audit-entry"><summary><time>${dt(a.timestamp)}</time><strong>${auditLabel(a.action)}</strong><span>${safe(a.actor||'Сервер')}</span></summary><p>Запись № ${a.entity_id||'—'}</p></details>`).join('')||empty('Журнал пока пуст')}</div>`;}

function transportWorkspace(){
  const kind=state.gateCamera||'car1';
  return `<div class="transport-cameras panel"><div class="panel-head"><div><span class="eyebrow">КОНТРОЛЬ ВЪЕЗДА</span><h2>Камеры КПП</h2></div><div class="button-row"><button class="v-btn soft" data-page="gate-journal">Журнал въездов · ${state.data.vehicleEntries.length} ↗</button><button class="v-btn ${kind==='car1'?'primary':'soft'}" data-gate-camera="car1">← КПП 1</button><button class="v-btn ${kind==='car2'?'primary':'soft'}" data-gate-camera="car2">КПП 2 →</button></div></div>${visionPanel(kind,{title:kind==='car2'?'КПП 2':'КПП 1',subtitle:'Иван Иванов Иванович',status:'Ожидание автомобиля',badge:'Въезд'})}<div class="gate-observation"><span class="gate-scan-dot"></span><span id="gateObservation">Ожидание номера</span><progress id="gateProgress" max="3" value="0" aria-label="Время наблюдения за номером"></progress></div></div>`;
}
function transportJournalWorkspace(){
  return `<div class="panel-head"><button class="v-btn soft" data-page="transport">← Камеры КПП</button><span class="status">${state.data.vehicleEntries.length} въездов</span></div><div id="gateJournal" class="arrival-grid">${transportJournal()}</div>`;
}
function transportJournal(){
  return state.data.vehicleEntries.length?state.data.vehicleEntries.map(e=>`<article class="panel arrival-card"><div class="panel-head"><span class="eyebrow">ВЪЕЗД ЗАРЕГИСТРИРОВАН</span><span class="status good">${safe(e.camera)}</span></div>${plateView(e.plate)}<h2>${safe(e.driver)}</h2><dl><div><dt>Дата въезда</dt><dd>${safe(new Date(e.created_at).toLocaleDateString('ru-RU'))}</dd></div><div><dt>Время въезда</dt><dd>${safe(new Date(e.created_at).toLocaleTimeString('ru-RU'))}</dd></div></dl></article>`).join(''):empty('Въездов пока нет');
}

function modal(title,body,submit){
  const d=document.createElement('dialog');d.className='v-dialog';d.innerHTML=`<form><div class="panel-head"><h2>${title}</h2><button type="button" class="text-button" data-close aria-label="Закрыть">✕</button></div>${body}<p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="v-btn soft" data-close>Отмена</button><button type="submit" class="v-btn primary">Подтвердить</button></div></form>`;document.body.append(d);d.showModal();
  d.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>d.close());d.onclose=()=>{d.remove();if(pendingReload){pendingReload=false;render();}};
  d.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await submit(Object.fromEntries(new FormData(e.currentTarget)));d.close();await refreshData();}catch(error){d.querySelector('.form-error').textContent=error.message;}finally{b.disabled=false;}};
}
function readFile(file){return new Promise((resolve,reject)=>{if(!file||!file.size)return reject(new Error('Выберите файл'));if(file.size>25*1024*1024)return reject(new Error('Файл слишком большой'));const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Не удалось прочитать файл'));r.readAsDataURL(file);});}
function formHandler(selector,fn){document.querySelector(selector)?.addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,b=e.submitter;b.disabled=true;try{await fn(Object.fromEntries(new FormData(form)));await refreshData();toast('Данные сохранены');}catch(error){toast(error.message,true);}finally{b.disabled=false;}});}
function bindWorkspace(){
  document.querySelectorAll('[data-scroll-camera]').forEach(b=>b.onclick=()=>document.querySelector(`[data-vision-kind="${b.dataset.scrollCamera}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}));
  document.querySelectorAll('[data-gate-camera]').forEach(b=>b.onclick=()=>{state.gateCamera=b.dataset.gateCamera;render();});
  document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{stopCamera();state.page=b.dataset.page;mapPoint=null;render();});
  document.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{state.cameraKind=b.dataset.kind;render();});
  document.querySelectorAll('[data-case]').forEach(b=>b.onclick=()=>{selectedCase=Number(b.dataset.case);mapPoint=null;render();document.querySelector('#caseDetail')?.scrollIntoView({block:'start'});});
  document.querySelectorAll('[data-action]').forEach(b=>b.onclick=async()=>{try{await action(b.dataset.action,b.dataset.id);}catch(error){toast(error.message,true);}});
  formHandler('#ppeForm',async v=>{toast('Проверка СИЗ выполняется…');await send('/api/ppe',{file:await readFile(v.photo)});});
  formHandler('#mapForm',async v=>{await send('/api/maps',{name:v.name,file:await readFile(v.image)});});
  formHandler('#zoneForm',async v=>{await send('/api/zones',{name:v.name,map_id:selectedMap,points:zonePoints});zonePoints=[];zoneEditing=false;});
  formHandler('#reportForm',async v=>{if(!mapPoint)throw new Error('Выберите точку на плане');await send(`/api/cases/${v.case_id}/reports`,{...v,map_id:selectedMap,zone_id:v.zone_id?Number(v.zone_id):null,map_x:mapPoint.x,map_y:mapPoint.y,observed_at:new Date(v.observed_at).toISOString()});mapPoint=null;});
  formHandler('#caseStatusForm',async v=>send(`/api/cases/${v.case_id}`,{...v,services_informed:v.services_informed==='on'},'PATCH'));
  formHandler('#videoForm',async v=>send(`/api/cases/${v.case_id}/videos`,{file:await readFile(v.video),zone_id:Number(v.zone_id),recorded_at:new Date(v.recorded_at).toISOString()}));
  formHandler('#telemetryForm',v=>send('/api/telemetry',{...v,value:Number(v.value)}));
  formHandler('#gateForm',v=>send('/api/gate-events',v));
  document.querySelector('#mapSelect')?.addEventListener('change',e=>{selectedMap=Number(e.target.value);mapPoint=null;zonePoints=[];render();});
}
async function action(key,value){
  const p=operational(),em=activeEmergency();
  if(key==='refresh'){await refreshData();toast('Данные обновлены');}
  if(key==='logout'){await HelmetUI.shutdown();await send('/api/logout');liveSource?.close();stopCamera();state.user=null;state.data=null;state.platform=null;render();}
  if(key==='account'){AccountUI.open();return;}
  if(key==='profile')modal('Изменить пароль',`${field('Текущий пароль','current_password','password','required autocomplete="current-password"')}${field('Новый пароль, от 12 символов','password','password','required minlength="12" autocomplete="new-password"')}`,v=>send('/api/password',v));
  if(key==='permission'){if(!('Notification'in window))throw new Error('Браузер не поддерживает уведомления');const status=await Notification.requestPermission();toast(status==='granted'?'Уведомления разрешены для открытого приложения':'Разрешение не предоставлено');}
  if(key==='read'){await send('/api/notifications/read',{},'PATCH');await refreshData();}
  if(key==='startShift'){await send('/api/shifts/start',{});await refreshData();}
  if(key==='endShift')modal('Завершить смену?','<p>Ваше присутствие будет отмечено как завершённое. Участие в текущей эвакуации сохраняется.</p>',()=>send('/api/shifts/end'));
  if(key==='approve')modal('Ручная проверка СИЗ','<p>Подтвердите результат после проверки фото или личного осмотра. Решение и основание сохранятся в аудите.</p>'+field('Основание проверки','comment','text','required'),v=>send(`/api/ppe/${value}/approve`,v));
  if(key==='declare'){
    const recipients=p.shifts.filter(s=>!s.ended_at).length;
    modal('Объявить эвакуацию',`<p class="warning-box">Оповещение получат ${recipients} сотрудников на активной смене. Подтверждение объявит ЧП.</p><label>Тип происшествия<select name="type"><option value="fire">Пожар</option><option value="gas">Утечка газа</option><option value="equipment">Авария оборудования</option><option value="chemical">Химическая опасность</option><option value="other">Другое</option></select></label>${field('Заголовок','title','text','required maxlength="160"')}<label>Текст оповещения<textarea name="description" required maxlength="4000">Внимание! Объявлена эвакуация. Покиньте опасную зону по утверждённому маршруту. После выхода подтвердите свою безопасность в SmartKóz.</textarea></label><label>Критичность<select name="severity"><option value="critical">Критическая</option><option value="warning">Предупреждение</option></select></label>${zoneSelect('zone_id',false)}`,v=>send('/api/emergencies',{...v,zone_id:v.zone_id?Number(v.zone_id):null}));
  }
  if(key==='safe')modal('Вы вышли из опасной зоны?','<p>Нажимая «Подтвердить», вы сообщаете руководству, что находитесь в безопасности.</p>',()=>send(`/api/emergencies/${value}/safe`));
  if(key==='resolve'){
    const pending=p.records.filter(r=>r.emergency_id===Number(value)&&!r.safe_confirmed_at&&!r.verified_at).length,open=p.cases.filter(c=>c.emergency_id===Number(value)&&c.status!=='closed').length;
    modal('Завершение чрезвычайной ситуации',`<p class="${pending||open?'warning-box':''}">Без подтверждения: ${pending}. Незакрытых поисков: ${open}.</p>${field('Итог и основание решения','comment','text','required')}${pending||open?'<label class="check-label"><input type="checkbox" name="force" required> Подтверждаю завершение при неподтвержденных статусах. Решение будет записано в аудит.</label>':''}`,v=>send(`/api/emergencies/${value}/resolve`,{...v,force:v.force==='on'}));
  }
  if(key==='closeCase'){selectedCase=null;mapPoint=null;render();}
  if(key==='historyCase'){selectedCase=Number(value);state.page='emergency';render();document.querySelector('#caseDetail')?.scrollIntoView();}
  if(key==='editZone'){zoneEditing=!zoneEditing;zonePoints=[];render();}
  if(['zoomIn','zoomOut','zoomReset'].includes(key)){zoom=key==='zoomReset'?1:Math.min(4,Math.max(1,zoom+(key==='zoomIn'?.25:-.25)));const el=document.querySelector('#mapStage');if(el)el.style.width=zoom*100+'%';}
  if(key==='reviewDetection')modal('Проверка наблюдения',`<p>Личность не устанавливается моделью автоматически. Укажите независимое основание проверки.</p><label>Результат<select name="status"><option value="possible_match">Возможное совпадение</option><option value="identity_confirmed">Личность подтверждена человеком</option><option value="rejected">Отклонено</option></select></label>${field('Источник и основание','comment','text','required')}`,v=>send(`/api/detections/${value}`,v,'PATCH'));
  if(key==='camera')await startCamera();
}
function setupMap(){const stage=document.querySelector('#mapStage');if(!stage)return;stage.onclick=e=>{if(!zoneEditing&&!selectedCase)return;const box=stage.getBoundingClientRect(),x=(e.clientX-box.left)/box.width,y=(e.clientY-box.top)/box.height;if(zoneEditing){zonePoints.push([x,y]);stage.querySelector('polyline')?.setAttribute('points',zonePoints.map(([x,y])=>`${x*1000},${y*1000}`).join(' '));document.querySelector('#pointCount').textContent='Точек: '+zonePoints.length;}else{mapPoint={x,y};stage.querySelector('.chosen')?.remove();stage.insertAdjacentHTML('beforeend',`<span class="map-pin chosen" style="left:${x*100}%;top:${y*100}%">+</span>`);const text=document.querySelector('#reportForm>p');if(text)text.textContent='Точка выбрана. Укажите время и отправьте наблюдение.';}};}
function updateTimers(){document.querySelectorAll('[data-timer]').forEach(el=>{const s=Math.max(0,Math.floor((Date.now()+offset-Date.parse(el.dataset.timer))/1000));el.textContent=`${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;});}
function stopCamera(){cameraStream?.getTracks().forEach(t=>t.stop());cameraStream=null;}
async function startCamera(){
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Камера требует HTTPS или localhost. Используйте загрузку фотографии с телефона.');
  stopCamera();cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});const area=document.querySelector('#captureArea');area.innerHTML='<video id="captureVideo" autoplay muted playsinline></video><button class="v-btn primary" id="takePhoto">Снять и проверить</button>';const video=area.querySelector('video');video.srcObject=cameraStream;
  area.querySelector('button').onclick=async e=>{e.currentTarget.disabled=true;try{const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);stopCamera();toast('Проверка СИЗ выполняется…');await send('/api/ppe',{file:canvas.toDataURL('image/jpeg',.85)});await refreshData();}catch(error){toast(error.message,true);}};
}
function drawJobOverlay(){document.querySelectorAll('video[data-job]').forEach(video=>{const canvas=video.parentElement.querySelector('canvas'),ctx=canvas.getContext('2d');video.ontimeupdate=()=>{canvas.width=video.videoWidth;canvas.height=video.videoHeight;ctx.clearRect(0,0,canvas.width,canvas.height);for(const d of operational().detections.filter(d=>d.job_id===Number(video.dataset.job)&&Math.abs(d.time_offset-video.currentTime)<.55)){const b=JSON.parse(d.box_data).box;if(!b)continue;ctx.strokeStyle='#44e6bc';ctx.lineWidth=3;ctx.strokeRect(b[0],b[1],b[2]-b[0],b[3]-b[1]);ctx.fillStyle='#173d39';ctx.fillRect(b[0],Math.max(0,b[1]-25),225,24);ctx.fillStyle='#fff';ctx.font='14px sans-serif';ctx.fillText('Человек · личность не установлена',b[0]+4,Math.max(17,b[1]-8));}};});}
// Bundled replay analysis must not create operational incidents or fictional gate traffic.
recordVisionEvent = async () => {};
registerGateEntry = async function(kind,payload,gateState){
  if(gateState.triggered||state.page!=='transport')return;gateState.triggered=true;
  try{
    const result=await send('/api/gate-events',{kind,observed_ms:Math.floor((gateState.visibleSeconds||0)*1000),plate:payload.plate,driver:'Иван Иванов Иванович',cargo:'—',camera:kind==='car1'?'КПП 1':'КПП 2'});
    state.data=result.data;
    if(state.page!=='transport')return;
    state.page='gate-journal';render();
    toast('Въезд зарегистрирован · '+result.entry.plate);
  }catch(error){toast(error.message,true);}
};
const monitorNoticeTimes=new Map();
showSafetyToast = function({title,text,tone='danger'}){
  const stamp=Date.now();if(stamp-(monitorNoticeTimes.get(title)||0)<30000)return;monitorNoticeTimes.set(title,stamp);
  let stack=document.querySelector('#monitorNoticeStack');if(!stack){stack=document.createElement('div');stack.id='monitorNoticeStack';stack.className='monitor-notice-stack';stack.setAttribute('aria-live','polite');document.body.append(stack);}
  while(stack.children.length>=2)stack.firstElementChild.remove();
  const notice=document.createElement('article');notice.className='monitor-notice '+tone;
  notice.innerHTML=`${icon('warning')}<div><strong>${safe(title)}</strong><p>${safe(text)}</p></div><button aria-label="Закрыть уведомление">✕</button>`;
  notice.querySelector('button').onclick=()=>notice.remove();stack.append(notice);setTimeout(()=>notice.remove(),4500);
};

workerPassPanel = function(){const shift=operational().shifts.find(s=>!s.ended_at);return `<div class="panel"><h2>Статус присутствия</h2><p>${shift?'Смена начата: '+dt(shift.started_at):'Смена не начата. Отметьте начало в личном кабинете.'}</p></div>`;};
function passwordGate(){state.loading=false;loginView();modal('Требуется смена пароля',field('Текущий пароль','current_password','password','required')+field('Новый пароль, от 12 символов','password','password','required minlength="12"'),async v=>{await send('/api/password',v);await loadData();startLive();});}
boot = async function(){try{const session=await api('/api/session');state.user=session.user;await loadData();}catch(error){if(state.user&&error.message.includes('пароль')){passwordGate();return;}state.user=null;}state.loading=false;render();if(state.user)startLive();};
setInterval(updateTimers,1000);
document.addEventListener('input',e=>{if(e.target.closest('form'))e.target.closest('form').dataset.dirty='true';});
document.addEventListener('change',e=>{if(e.target.closest('form'))e.target.closest('form').dataset.dirty='true';});
boot();
