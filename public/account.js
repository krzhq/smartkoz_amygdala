const AccountUI=(()=>{
  let panel,controller;
  function close(){controller?.abort();controller=null;if(panel&&typeof panel.hidePopover==='function'){try{panel.hidePopover();}catch{}}panel?.remove();panel=null;}
  function open(){
    if(panel?.isConnected){close();return;}close();
    const person=state.user,me=operational().me;
    panel=document.createElement('section');panel.className='account-popover';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Личный кабинет');
    panel.innerHTML=`<div class="account-popover-head"><h2>Личный кабинет</h2><button type="button" aria-label="Закрыть">×</button></div><strong data-no-translate>${safe(person.name)}</strong><span data-no-translate>${safe(person.email)}</span><dl><div><dt>Доступ</dt><dd>${isAdmin()?'Руководитель':'Сотрудник'}</dd></div><div><dt>Отдел</dt><dd data-no-translate>${safe(me?.department||person.department||'—')}</dd></div><div><dt>Должность</dt><dd data-no-translate>${safe(person.position||'—')}</dd></div></dl><div class="account-actions"><button type="button" data-password>Изменить пароль</button><button type="button" data-exit>Выйти →</button></div>`;
    const anchor=document.activeElement?.closest('[data-action=account]')||document.querySelector('.profile-button');
    panel.setAttribute('tabindex','-1');
    if(typeof panel.showPopover==='function')panel.setAttribute('popover','auto');
    document.body.append(panel);
    if(typeof panel.showPopover==='function')panel.showPopover();
    I18n.apply(panel);
    const bounds=anchor.getBoundingClientRect(),width=panel.offsetWidth,height=panel.offsetHeight;
    panel.style.left=Math.max(12,Math.min(innerWidth-width-12,bounds.right-width))+'px';
    panel.style.top=Math.max(12,Math.min(innerHeight-height-12,bounds.bottom+10))+'px';
    panel.querySelector('.account-popover-head button').onclick=close;
    panel.querySelector('[data-password]').onclick=()=>{close();action('profile').catch(e=>toast(e.message,true));};
    panel.querySelector('[data-exit]').onclick=()=>{close();action('logout').catch(e=>toast(e.message,true));};
    controller=new AbortController();const signal=controller.signal;
    document.addEventListener('pointerdown',e=>{if(!panel?.isConnected){close();return;}if(!panel.contains(e.target)&&!e.target.closest('[data-action=account]'))close();},{signal});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')close();},{signal});
    window.addEventListener('resize',close,{signal});
    panel.addEventListener('toggle',e=>{if(e.newState==='closed')close();},{signal});
    panel.querySelector('button').focus({preventScroll:true});
  }
  return {open,close};
})();
