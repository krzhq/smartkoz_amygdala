/* Presentation only: operational state and camera lifecycles stay in their modules. */
const GlassUI=(()=>{
  const symbols={overview:'shield',cameras:'videocam',transport:'local_shipping',map:'map',tasks:'assignment',assistant:'psychology',employees:'groups',helmet:'badge',emergency:'emergency',notifications:'notifications'};
  function hero(){
    const p=operational(),admin=isAdmin(),shift=p.shifts.find(s=>!s.ended_at);
    return `<section class="glass-hero ${admin?'hero-admin':'hero-employee'}" aria-label="${admin?'Панель безопасности':'Моя рабочая область'}"><div class="hero-grid" aria-hidden="true"></div><div class="hero-copy"><div class="hero-kicker"><span class="hero-live-dot"></span> SMARTKÓZ <span class="hero-kicker-divider"></span> ${admin?'ЛЮДИ. БЕЗОПАСНОСТЬ. СВЯЗЬ.':'ВАША БЕЗОПАСНОСТЬ — В ЦЕНТРЕ'}</div><h2>${admin?'Всё под<br><em>контролем.</em>':'На связи.<br><em>В безопасности.</em>'}</h2><p>${admin?'Видеть важное. Действовать вовремя.<br>Единое пространство заботы о вашей команде.':`${safe(state.user.name)}, хорошей смены.<br>Всё для спокойной и безопасной работы — рядом.`}</p><div class="hero-actions"><button class="v-btn primary" data-page="${admin?'cameras':'helmet'}">${icon(admin?'videocam':'badge')} ${admin?'Открыть наблюдение':'Подключить каску'} <span>↗</span></button><button class="hero-secondary" data-page="${admin?'employees':'notifications'}">${admin?'Моя команда':'Уведомления'} <span>→</span></button></div><div class="hero-bottom"><span class="hero-mini-avatars" aria-hidden="true">${icon('groups')}</span><span>${admin?`<strong>${p.shifts.filter(s=>!s.ended_at).length}</strong> сотрудников на смене`:shift?'Ваша смена началась':'Подготовьтесь к началу смены'}</span><i></i><span>Вместе — безопаснее</span></div></div><div class="hero-art" aria-hidden="true"><div class="hero-halo halo-one"></div><div class="hero-halo halo-two"></div><div class="hero-orbit orbit-one"></div><div class="hero-orbit orbit-two"></div><div class="hero-glass-shield"><svg viewBox="0 0 200 230" fill="none"><defs><linearGradient id="shieldFill" x1="20" y1="10" x2="180" y2="210"><stop stop-color="white" stop-opacity=".85"/><stop offset=".5" stop-color="#fff" stop-opacity=".2"/><stop offset="1" stop-color="#f7364b" stop-opacity=".28"/></linearGradient><linearGradient id="shieldEdge"><stop stop-color="white"/><stop offset=".55" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="white"/></linearGradient></defs><path d="M100 12 181 43v65c0 55-81 106-81 106S19 163 19 108V43Z" fill="url(#shieldFill)" stroke="url(#shieldEdge)" stroke-width="3"/><path d="m63 111 26 26 49-56" stroke="#f7364b" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/></svg></div><span class="hero-art-caption">SMARTKÓZ / ЗАБОТА В КАЖДОМ РЕШЕНИИ</span></div></section>`;
  }
  let navObserver;
  function mount(){
    navObserver?.disconnect();
    const nav=document.querySelector('.top-nav');if(!nav||nav.dataset.glassBound)return;
    nav.dataset.glassBound='true';
    nav.querySelectorAll('button[data-page]').forEach(b=>{b.insertAdjacentHTML('afterbegin',icon(symbols[b.dataset.page]||'shield'));});
    const marker=document.createElement('span');marker.className='nav-liquid-marker';marker.setAttribute('aria-hidden','true');nav.prepend(marker);
    const buttons=[...nav.querySelectorAll('button[data-page]')];
    function mark(button){if(!button)return;buttons.forEach(b=>b.classList.toggle('drag-target',b===button));marker.style.width=button.offsetWidth+'px';marker.style.transform=`translateX(${button.offsetLeft}px)`;}
    const active=()=>buttons.find(b=>b.dataset.page===(state.page==='gate-journal'?'transport':state.page));
    requestAnimationFrame(()=>{mark(active());active()?.scrollIntoView({block:'nearest',inline:'nearest'});});
    if(matchMedia('(max-width:860px)').matches){const hint=document.createElement('div');hint.className='nav-scroll-hint';hint.textContent='Потяните вкладки, чтобы переключить ↔';nav.parentElement.insertAdjacentElement('afterend',hint);}
    let pointer=null,ignoreClick=false;
    const navigate=page=>{if(!page||page===state.page)return;stopCamera();state.page=page;mapPoint=null;render();};
    const next=document.createElement('button');next.className='dock-next';next.type='button';next.setAttribute('aria-label','Следующая вкладка');next.title='Следующая вкладка';next.innerHTML=icon('chevron_right');nav.insertAdjacentElement('afterend',next);
    next.onclick=()=>navigate(buttons[(Math.max(0,buttons.indexOf(active()))+1)%buttons.length]?.dataset.page);
    nav.addEventListener('pointerdown',e=>{if(e.button!==0)return;pointer={id:e.pointerId,start:e.clientX,last:e.clientX,scroll:nav.scrollLeft,dragging:false,target:null};});
    nav.addEventListener('pointermove',e=>{
      if(!pointer||pointer.id!==e.pointerId)return;
      const delta=e.clientX-pointer.start;if(Math.abs(delta)>12){pointer.dragging=true;nav.classList.add('is-dragging');nav.setPointerCapture(e.pointerId);}
      if(!pointer.dragging)return;
      const box=nav.getBoundingClientRect();if(e.clientX<box.left+45)nav.scrollLeft-=12;if(e.clientX>box.right-45)nav.scrollLeft+=12;
      const nearest=buttons.reduce((a,b)=>Math.abs(b.getBoundingClientRect().left+b.offsetWidth/2-e.clientX)<Math.abs(a.getBoundingClientRect().left+a.offsetWidth/2-e.clientX)?b:a,buttons[0]);
      pointer.target=nearest;mark(nearest);pointer.last=e.clientX;
    });
    function end(e){if(!pointer||pointer.id!==e.pointerId)return;const old=pointer;pointer=null;nav.classList.remove('is-dragging');if(nav.hasPointerCapture(e.pointerId))nav.releasePointerCapture(e.pointerId);if(old.dragging){ignoreClick=true;setTimeout(()=>ignoreClick=false,120);if(e.type==='pointerup'&&Math.abs(old.last-old.start)>32)navigate(old.target?.dataset.page);else mark(active());}}
    nav.addEventListener('pointerup',end);nav.addEventListener('pointercancel',end);
    nav.addEventListener('click',e=>{if(ignoreClick){e.preventDefault();e.stopImmediatePropagation();}},true);
    nav.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const index=buttons.indexOf(document.activeElement);const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:Math.min(buttons.length-1,Math.max(0,index+(e.key==='ArrowRight'?1:-1)));buttons[next]?.focus();});
    const resize=new ResizeObserver(()=>{if(!nav.isConnected){resize.disconnect();return;}nav.parentElement.classList.toggle('has-overflow',nav.scrollWidth>nav.clientWidth+2);mark(active());});resize.observe(nav);navObserver=resize;

  }
  return {hero,mount};
})();
