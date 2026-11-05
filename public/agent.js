/* A side bookmark opens a non-modal conversation, preserving camera playback. */
const AgentUI=(()=>{
  let user=null,root=null,open=false,busy=false,messages=[],controller=null;
  function reset(){controller?.abort();controller=null;root?.remove();root=null;user=null;open=false;busy=false;messages=[];document.body.classList.remove('has-agent','agent-collapsed');}
  function mount(){
    if(!state.user){reset();return;}if(user!==state.user.id){reset();user=state.user.id;}
    document.body.classList.add('has-agent');
    document.querySelector('.agent-toggle')?.remove();
    if(root?.isConnected)return;
    root=document.createElement('aside');root.className='agent-dock';
    root.innerHTML=`<button class="agent-bookmark" aria-label="Открыть помощника" aria-expanded="false" aria-controls="agentWindow"><span class="agent-bookmark-label">Помощник</span><span class="agent-bookmark-arrow" aria-hidden="true">‹</span></button><section id="agentWindow" class="agent-window" role="region" aria-hidden="true" inert aria-label="Помощник SmartKóz"><header><div class="agent-window-mark">✦</div><div><h2>Помощник</h2><p>SmartKóz</p></div><button class="agent-close" aria-label="Закрыть помощника">✕</button></header><div class="agent-messages" role="log" aria-live="polite"></div><div class="agent-suggestions"><button>Что сейчас важно?</button><button>Въезды за сегодня</button><button>Помоги со сменой</button></div><form class="agent-form"><label class="sr-only" for="agentQuestion">Ваш вопрос</label><textarea id="agentQuestion" rows="2" maxlength="3000" placeholder="О чём хотите спросить?" required></textarea><button type="submit" aria-label="Отправить вопрос">↑</button></form></section>`;
    document.body.append(root);
    root.querySelector('.agent-bookmark').onclick=()=>toggle(!open);
    root.querySelector('.agent-close').onclick=()=>toggle(false);
    root.querySelector('.agent-form').onsubmit=e=>{e.preventDefault();ask();};
    root.querySelector('textarea').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask();}};
    root.querySelectorAll('.agent-suggestions button').forEach(b=>b.onclick=()=>{root.querySelector('textarea').value=b.textContent;ask();});
    root.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();toggle(false);}};render();
  }
  function toggle(value){
    if(!root)return;open=Boolean(value);root.classList.toggle('is-open',open);
    const trigger=root.querySelector('.agent-bookmark'),window=root.querySelector('.agent-window');
    trigger.setAttribute('aria-expanded',String(open));window.inert=!open;window.setAttribute('aria-hidden',String(!open));
    if(open)root.querySelector('textarea').focus({preventScroll:true});else trigger.focus({preventScroll:true});
  }
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&open)toggle(false);});

  function render(){
    if(!root)return;const log=root.querySelector('.agent-messages');log.replaceChildren();
    if(!messages.length){const welcome=document.createElement('div');welcome.className='agent-welcome';welcome.innerHTML='<span>✦</span><h3>Давайте разберёмся.</h3><p>Спросите о смене, событиях или въездах.</p>';log.append(welcome);}
    for(const message of messages){const item=document.createElement('div');item.className='agent-message '+message.role;if(message.role==='assistant')item.innerHTML=formatAssistantAnswer(message.content);else item.textContent=message.content;log.append(item);}
    if(busy){const dots=document.createElement('div');dots.className='agent-thinking';dots.setAttribute('aria-label','Готовлю ответ');dots.innerHTML='<i></i><i></i><i></i>';log.append(dots);}
    root.querySelector('.agent-form button').disabled=busy;root.querySelectorAll('.agent-suggestions button').forEach(b=>b.disabled=busy);log.scrollTop=log.scrollHeight;
  }
  async function ask(){
    const input=root?.querySelector('textarea'),question=input?.value.trim();if(!question||busy)return;
    const owner=user;const history=messages.filter(m=>m.role==='user'||m.role==='assistant').slice(-8);
    messages.push({role:'user',content:question});input.value='';busy=true;render();controller=new AbortController();
    try{
      const response=await fetch('/api/assistant',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({question,history,language:I18n.language()})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Не удалось получить ответ');
      if(owner===user)messages.push({role:'assistant',content:result.answer});
    }catch(e){if(e.name!=='AbortError'&&owner===user)messages.push({role:'error',content:I18n.translate(e.message||'Не удалось ответить. Попробуйте ещё раз.')});}
    finally{if(owner===user){busy=false;controller=null;render();}}
  }
  return {mount,reset};
})();
