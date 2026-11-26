'use strict';
const $ = s => document.querySelector(s);
const all = s => [...document.querySelectorAll(s)];
const groups = {wallet:['Alipay','WeChat Pay'],purchase:['1688','Taobao','Alibaba'],invoice:['Инвойс поставщика']};
const services = [...Object.values(groups).flat(),'Доставка груза'];
const RATE = 12.84, MIN = 5000;
const BF_END = Date.UTC(2026,10,30,20,59), BF_MIN = 20000, BF_RATE = 0.10;
const bfActive = () => Date.now() < BF_END;
(function(){
  const bar=$('#bf-bar');
  if(!bar)return;
  const closed = () => { try { return localStorage.getItem('bf26-closed')==='1'; } catch(e){ return false; } };
  const hide = () => bar.remove();
  if(!bfActive() || closed()) hide();
  const btn=$('#bf-bar-close');
  if(btn)btn.addEventListener('click',()=>{ try{ localStorage.setItem('bf26-closed','1'); }catch(e){} hide(); });
})();
function metrikaGoal(name){if(typeof window.ym==='function')window.ym(114631425,'reachGoal',name);}
const format = (n, digits=2) => new Intl.NumberFormat('ru-RU',{maximumFractionDigits:digits}).format(n);
const money = n => new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
function parseAmount(value){
  const s = String(value).replace(/\s/g,'').replace(',','.');
  return /^\d{1,12}(?:\.\d{0,2})?$/.test(s) ? Number(s) : NaN;
}
function options(select,values){select.replaceChildren(...values.map(t=>new Option(t,t)));}
const calculatorService=()=>$('#calcservice :checked').value;
const validLeadAmount=amount=>Number.isFinite(amount)&&amount>=MIN&&amount<=999999999;
function calcChanged(source){
  const rub=$('#rub'), cny=$('#cny'), byRub=source===rub;
  const n=parseAmount(source.value);
  (byRub?cny:rub).value = Number.isFinite(n)&&n>0 ? money(byRub?n/RATE:n*RATE) : '';
  const r=parseAmount(rub.value);
  const valid=validLeadAmount(r);
  $('#calc-request').disabled=!valid;
  $('#calcerror').textContent=valid?'':r>999999999?'Для расчёта укажите сумму до 999 999 999 ₽.':'Минимальная сумма заявки — 5 000 ₽.';
  const bonus=$('#calc-bonus');
  if(bonus){
    const cnyVal=parseAmount($('#cny').value);
    const show=bfActive()&&Number.isFinite(r)&&r>=BF_MIN&&Number.isFinite(cnyVal);
    bonus.hidden=!show;
    if(show)bonus.textContent='🎁 Бонус по акции: +'+money(cnyVal*BF_RATE)+' CNY';
  }
  updateTelegramLink();
}
function updateTelegramLink(){
  const link=$('#calc-telegram'), rub=parseAmount($('#rub')?.value), cny=parseAmount($('#cny')?.value);
  if(!link)return;
  const amount=Number.isFinite(rub)?format(rub,2)+' ₽'+(Number.isFinite(cny)?' ('+format(cny,2)+' CNY)':''):'сумма не указана';
  const bf=bfActive()&&Number.isFinite(rub)&&rub>=BF_MIN&&Number.isFinite(cny)?'\nАкция «Чёрная пятница»: бонус +'+money(cny*BF_RATE)+' CNY к пополнению.':'';
  const message='Здравствуйте! Хочу получить расчёт.\nНаправление: Россия → Китай.\nУслуга: '+calculatorService()+'.\nСумма: '+amount+'.'+bf;
  link.href='https://t.me/pallada_cny?text='+encodeURIComponent(message);
}
if($('#calculator')){
  $('#calcservice').addEventListener('change',updateTelegramLink);
  [$('#rub'),$('#cny')].forEach(el=>{
    el.addEventListener('input',()=>calcChanged(el));
    el.addEventListener('blur',()=>{const n=parseAmount(el.value);if(Number.isFinite(n))el.value=format(n);});
  });calcChanged($('#rub'));
}
const menu=$('#menu');
menu.addEventListener('click',()=>{const state=$('#nav').classList.toggle('open');menu.setAttribute('aria-expanded',state);menu.setAttribute('aria-label',state?'Закрыть меню':'Открыть меню')});
$('#nav').addEventListener('click',()=>{$('#nav').classList.remove('open');menu.setAttribute('aria-expanded',false);menu.setAttribute('aria-label','Открыть меню')});
if($('#volume')){
  const fields=all('[data-dim]');function updateVolume(){
    const [l,w,h,c]=fields.map(x=>Number(x.value));
    $('#volume').textContent=fields.every(x=>x.value&&x.checkValidity())&&Number.isInteger(c)&&Number.isFinite(l*w*h*c)?'Общий объём — '+format(l*w*h*c/1e6,6)+' м³':'Укажите положительные размеры и целое число коробок.';
  }fields.forEach(x=>x.addEventListener('input',updateVolume));updateVolume();
}
const modal=$('#request');
const dialogForm=$('#lead');
const inlineForm=$('#calc-lead');
const consentVersion='telegram-contact-v1';
options($('#leadservice'),services);
function renderDialog(){
  const cargo=$('#leadservice').value==='Доставка груза';
  $('#payfield').hidden=cargo;
  $('#leadamount').required=!cargo;
  $('#cargofields').hidden=!cargo;
  $('#cargo').required=cargo;
  const amount=parseAmount($('#leadamount').value);
  $('#summary').textContent=cargo?'Укажите данные груза для расчёта маршрута.':Number.isFinite(amount)?'Ориентир по курсу 12,84 ₽ — '+money(amount/RATE)+' CNY.':'Укажите сумму для расчёта.';
}
all('[data-request]').forEach(button=>button.addEventListener('click',()=>{
  if(inlineForm && !button.dataset.request){
    $('#calc-contact').scrollIntoView({block:'center'});
    $('#calc-contact').focus({preventScroll:true});
    return;
  }
  if(dialogForm.dataset.pending==='true')return;
  dialogForm.reset();
  $('#leadservice').value=services.includes(button.dataset.request)?button.dataset.request:'Alipay';
  $('#leadamount').value='50 000';
  if($('#volume')&&$('#leadservice').value==='Доставка груза')$('#cargo').value=$('#volume').textContent;
  dialogForm.dispatchEvent(new Event('input'));
  renderDialog();
  modal.showModal();
  metrikaGoal('request_open');
}));
$('#close').addEventListener('click',()=>modal.close());
modal.addEventListener('click',event=>{
  if(event.target!==modal||event.clientX===0)return;
  const rect=modal.getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)modal.close();
});
$('#leadservice').addEventListener('change',renderDialog);
$('#leadamount').addEventListener('input',renderDialog);

function bindLead(form,inline){
  const button=form.querySelector('button[type=submit],button.primary');
  const label=button.querySelector('.btn-label')||button;
  const status=form.querySelector('[role=status]');
  const contact=form.querySelector(inline?'#calc-contact':'#contact');
  const consent=form.querySelector('[type=checkbox]');
  let lastBody='',requestId='',pending=false,completed=false,goalStarted=false;
  function changed(){
    contact.setCustomValidity('');
    if(pending)return;
    completed=false;
    button.disabled=inline&&!validLeadAmount(parseAmount($('#rub').value));
    label.textContent='Оставить заявку';
    status.textContent='';
  }
  form.addEventListener('input',event=>{
    changed();
    if(event.isTrusted&&!goalStarted){goalStarted=true;metrikaGoal('form_start');}
  });
  if(inline){
    for(const el of [$('#rub'),$('#cny')])el.addEventListener('input',()=>{changed();calcChanged(el);});
    $('#calcservice').addEventListener('change',changed);
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(pending||completed)return;
    const service=inline?calculatorService():$('#leadservice').value;
    const cargo=service==='Доставка груза';
    const amount=parseAmount(inline?$('#rub').value:$('#leadamount').value);
    if(!cargo&&!validLeadAmount(amount)){
      status.textContent='Укажите сумму от 5 000 до 999 999 999 ₽.';return;
    }
    const value=contact.value.trim();
    const phone=/^\+?[\d\s()-]+$/.test(value)&&/^\d{7,15}$/.test(value.replace(/\D/g,''));
    if(!/^@[a-zA-Z0-9_]{4,32}$/.test(value)&&!phone){
      contact.setCustomValidity('Введите @username или номер телефона с кодом страны.');
      contact.reportValidity();return;
    }
    const body={service,amount:cargo?null:amount,cargo:cargo?$('#cargo').value.trim():'',contact:value,consent:consent.checked,consentVersion};
    const key=JSON.stringify(body);
    if(key!==lastBody){requestId=crypto.randomUUID();lastBody=key;}
    pending=true;form.dataset.pending='true';
    const controls=inline?all('#calculator input,#calculator select,#calculator button'):Array.from(form.elements);
    const previouslyDisabled=controls.map(el=>el.disabled);
    controls.forEach(el=>el.disabled=true);
    label.textContent='Отправляем…';status.textContent='';
    try{
      const mode=await fetch('/api/status.json',{cache:'no-store',signal:AbortSignal.timeout(6000)});
      if(!mode.ok)throw Error('Сервер временно недоступен. Повторите отправку позже.');
      if((await mode.json()).mode==='preview'){
        status.textContent='Это предпросмотр. Отправка в Telegram будет доступна после подключения бота на рабочем сайте.';return;
      }
      const reply=await fetch('/api/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestId}),signal:AbortSignal.timeout(30000)});
      const data=await reply.json();
      if(!reply.ok||!data.number)throw Error(data.error||'Не удалось получить ответ. Повторите отправку.');
      completed=true;
      metrikaGoal('lead_submit');
      status.textContent=data.delivered?'Заявка № '+data.number+' доставлена менеджеру в Telegram.':'Заявка № '+data.number+' сохранена. Уведомление в очереди, повторно отправлять заявку не нужно.';
    }catch(error){
      status.textContent=error instanceof TypeError||error.name==='TimeoutError'?'Не удалось получить подтверждение сервера. Повторите отправку с теми же данными.':error.message;
    }finally{
      controls.forEach((el,i)=>el.disabled=previouslyDisabled[i]);
      pending=false;form.dataset.pending='false';button.disabled=completed;
      label.textContent=completed?'Заявка принята':'Оставить заявку';
    }
  });
}
bindLead(dialogForm,false);
if(inlineForm)bindLead(inlineForm,true);
