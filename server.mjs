import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync,createReadStream,statSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';

process.umask(0o077);
const base=path.dirname(fileURLToPath(import.meta.url));
const pub=path.join(base,'dist');
const {BOT_TOKEN,GROUP_CHAT_ID,SOCKS5H_PROXY,MANAGER_PASSWORD}=process.env;
const origin=new URL(process.env.PUBLIC_ORIGIN||'https://pallada.cc').origin;
if(!origin.startsWith('https://')||!/^\d{5,16}:[\w-]{20,}$/.test(BOT_TOKEN||'')||!/^-[0-9]+$/.test(GROUP_CHAT_ID||'')||!MANAGER_PASSWORD||MANAGER_PASSWORD.length<20)throw Error('Проверьте PUBLIC_ORIGIN, BOT_TOKEN, GROUP_CHAT_ID и MANAGER_PASSWORD в конфигурации.');
const proxy=new URL(SOCKS5H_PROXY);
if(proxy.protocol!=='socks5h:'||!proxy.hostname||!proxy.port||/[\r\n]/.test(SOCKS5H_PROXY))throw Error('Нужен SOCKS5H_PROXY в формате socks5h://user:password@host:port.');
const data=path.resolve(process.env.DATA_DIR||path.join(base,'data'));
if(data===pub||data.startsWith(pub+path.sep))throw Error('Каталог данных должен находиться вне dist.');
mkdirSync(data,{recursive:true,mode:0o700});
const db=new DatabaseSync(path.join(data,'requests.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY, number TEXT UNIQUE NOT NULL, created INTEGER NOT NULL,
  service TEXT NOT NULL, rub REAL, contact TEXT NOT NULL, cargo TEXT NOT NULL,
  consent_version TEXT NOT NULL, sent INTEGER DEFAULT 0, tries INTEGER DEFAULT 0,
  next_try INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS due ON leads(sent,next_try);`);
const DAY=86400000;
function purge(){db.prepare('DELETE FROM leads WHERE created <= ?').run(Date.now()-30*DAY);db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}
purge();setInterval(purge,60000).unref();
const services=['Alipay','WeChat Pay','1688','Taobao','Alibaba','Инвойс поставщика','Доставка груза'];
const digest=t=>createHash('sha256').update(t).digest();
const manager=digest('Basic '+Buffer.from('manager:'+MANAGER_PASSWORD).toString('base64'));
const quota=new Map();
function limited(key,max){
  const now=Date.now();let bucket=quota.get(key);
  if(!bucket||bucket.until<now){bucket={n:0,until:now+600000};quota.set(key,bucket);}
  return ++bucket.n>max;
}
setInterval(()=>{for(const [k,v] of quota)if(v.until<Date.now())quota.delete(k);},60000).unref();
function send(res,code,type,body){res.writeHead(code,{'Content-Type':type+'; charset=utf-8'});res.end(body);}
function json(res,code,value){send(res,code,'application/json',JSON.stringify(value));}
function ip(req){const addr=req.headers['x-real-ip'];return typeof addr==='string'&&isIP(addr)?addr:req.socket.remoteAddress;}
function clean(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fields(v){
  if(!v||!/^\w{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(v.requestId)||!services.includes(v.service)||v.consent!==true)return false;
  if(typeof v.contact!=='string'||v.contact.length>80)return false;
  if(!/^@[a-zA-Z0-9_]{4,32}$/.test(v.contact)&&!(/^\+?[\d\s()-]+$/.test(v.contact)&&/^\d{7,15}$/.test(v.contact.replace(/\D/g,''))))return false;
  return v.service==='Доставка груза'?typeof v.cargo==='string'&&v.cargo.trim().length>0&&v.cargo.length<=500:
    Number.isFinite(v.amount)&&v.amount>=5000&&v.amount<=999999999&&Math.abs(Math.round(v.amount*100)-v.amount*100)<0.00002;
}
function toConfig(value){return '"'+String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\r/g,'\\r')+'"';}
function notify(row){
  const link=origin+'/manager/'+row.number;
  const sum=row.rub===null?'':('\n'+row.rub.toLocaleString('ru-RU')+' ₽ · '+(row.rub/12.84).toLocaleString('ru-RU',{maximumFractionDigits:2})+' CNY');
  const contactLine=row.consent_version==='telegram-contact-v1'?'\nКонтакт: '+row.contact:'';
  const payload=JSON.stringify({chat_id:GROUP_CHAT_ID,text:'Новая заявка № '+row.number+'\n'+row.service+sum+contactLine+'\nКарточка заявки: '+link,link_preview_options:{is_disabled:true}});
  const config=['url = '+toConfig('https://api.telegram.org/bot'+BOT_TOKEN+'/sendMessage'),'proxy = '+toConfig(SOCKS5H_PROXY),'noproxy = ""','header = "Content-Type: application/json"','data-binary = '+toConfig(payload)].join('\n');
  return new Promise(resolve=>{
    const child=spawn('curl',['-q','--silent','--proto','=https','--max-time','18','--connect-timeout','7','--config','-'],{stdio:['pipe','pipe','ignore'],env:{PATH:process.env.PATH,LANG:'C.UTF-8',...(process.env.CURL_CA_BUNDLE?{CURL_CA_BUNDLE:process.env.CURL_CA_BUNDLE}:{})}});
    let output='';child.stdout.on('data',part=>{if(output.length<131072)output+=part;});
    child.on('error',()=>resolve(false));child.stdin.on('error',()=>{});
    child.on('close',code=>{try{resolve(code===0&&JSON.parse(output).ok===true);}catch{resolve(false);}});child.stdin.end(config+'\n');
  });
}
async function deliver(row){
  // Reserve before the network call. An interrupted delivery can be retried with the same public number.
  const lease=Date.now()+60000;
  const lock=db.prepare('UPDATE leads SET next_try=? WHERE id=? AND sent=0 AND next_try=?').run(lease,row.id,row.next_try);
  if(!lock.changes)return false;
  if(await notify(row)){
    db.prepare('UPDATE leads SET sent=1 WHERE id=?').run(row.id);
    return true;
  }
  else{db.prepare('UPDATE leads SET tries=tries+1,next_try=? WHERE id=?').run(Date.now()+Math.min(3600000,15000*2**Math.min(8,row.tries)),row.id);console.warn('Telegram: повтор для заявки '+row.number+' запланирован.');}
  return false;
}
let busy=false;
async function flush(){
  if(busy)return;busy=true;
  try{
    for(let i=0;i<20;i++){
      const row=db.prepare('SELECT * FROM leads WHERE sent=0 AND next_try<=? ORDER BY next_try LIMIT 1').get(Date.now());
      if(!row)break;
      await deliver(row);
    }
  }catch{console.error('Не удалось обработать очередь уведомлений.');}finally{busy=false;}
}
setInterval(flush,5000).unref();
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.woff':'font/woff','.png':'image/png','.webp':'image/webp','.txt':'text/plain; charset=utf-8','.xml':'application/xml'};
const server=http.createServer(async(req,res)=>{
  try{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' https://mc.yandex.ru; img-src 'self' data: https://mc.yandex.ru; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' https://mc.yandex.ru; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const route=decodeURIComponent(new URL(req.url,'http://local').pathname);
    if(route==='/api/status.json'&&req.method==='GET')return json(res,200,{mode:'live'});
    if(route==='/api/requests'&&req.method==='POST'){
      if(req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json'))return json(res,403,{error:'Обновите страницу сайта и повторите отправку.'});
      if(limited('req:'+ip(req),35))return json(res,429,{error:'Слишком много запросов. Повторите через 10 минут.'});
      let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>8192)return json(res,413,{error:'Слишком большой запрос.'});chunks.push(c);}
      let v;try{v=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(res,400,{error:'Некорректный формат заявки.'});}
      if(!fields(v))return json(res,422,{error:'Проверьте контакт, услугу, сумму и согласие.'});
      const old=db.prepare('SELECT number,sent FROM leads WHERE id=?').get(v.requestId);if(old)return json(res,old.sent?200:202,{number:old.number,delivered:!!old.sent});
      const number=randomBytes(6).toString('hex').toUpperCase();const now=Date.now(),cargo=v.service==='Доставка груза';
      db.prepare('INSERT INTO leads(id,number,created,service,rub,contact,cargo,consent_version,next_try) VALUES(?,?,?,?,?,?,?,?,?)').run(v.requestId,number,now,v.service,cargo?null:v.amount,v.contact,cargo?v.cargo.trim():'',v.consentVersion==='telegram-contact-v1'?'telegram-contact-v1':'2026-11-23',now);
      const row=db.prepare('SELECT * FROM leads WHERE id=?').get(v.requestId);
      const delivered=await deliver(row);
      return json(res,delivered?201:202,{number,delivered});
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,'text/plain','Метод недоступен');
    if(route==='/manager'||route.startsWith('/manager/')){
      res.setHeader('X-Robots-Tag','noindex, nofollow');
      if(!timingSafeEqual(manager,digest(req.headers.authorization||''))){
        if(limited('auth:'+ip(req),40))return send(res,429,'text/plain','Повторите позже');
        res.setHeader('WWW-Authenticate','Basic realm="Pallada", charset="UTF-8"');return send(res,401,'text/plain','Вход для менеджера');
      }
      const num=route.slice('/manager/'.length);
      let body;
      if(!num){
        const rows=db.prepare('SELECT number,service,sent FROM leads ORDER BY created DESC').all();
        body='<h1>Заявки</h1>'+rows.map(r=>'<p><a href="/manager/'+r.number+'">'+r.number+'</a> · '+clean(r.service)+' · '+(r.sent?'уведомление отправлено':'в очереди')+'</p>').join('');
      }else{
        const row=db.prepare('SELECT * FROM leads WHERE number=?').get(num);
        if(!row)return send(res,404,'text/plain','Заявка не найдена');
        body='<a href="/manager/">Все заявки</a><h1>Заявка № '+row.number+'</h1><p>'+clean(row.service)+'</p><p>'+clean(row.contact)+'</p><p>'+clean(row.rub===null?row.cargo:row.rub+' ₽')+'</p><p>'+clean(new Date(row.created).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}))+' МСК</p>';
      }
      return send(res,200,'text/html','<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Заявки — Паллада</title><link rel="stylesheet" href="/site.css"><main class="article">'+body+'</main></html>');
    }
    let f=path.resolve(pub,'.'+route);if(f!==pub&&!f.startsWith(pub+path.sep))return send(res,404,'text/plain','Страница не найдена');
    let st=statSync(f,{throwIfNoEntry:false});if(st?.isDirectory()){f=path.join(f,'index.html');st=statSync(f,{throwIfNoEntry:false});}
    if(!st?.isFile()||!types[path.extname(f)])return send(res,404,'text/plain','Страница не найдена');
    res.writeHead(200,{'Content-Type':types[path.extname(f)],'Content-Length':st.size,'Cache-Control':f.includes('/assets/')?'public, max-age=86400':'no-cache'});
    if(req.method==='HEAD')return res.end();createReadStream(f).on('error',()=>res.destroy()).pipe(res);
  }catch{if(!res.headersSent)json(res,500,{error:'Сервер временно недоступен. Повторите отправку.'});else res.destroy();}
});
server.requestTimeout=15000;server.headersTimeout=12000;
server.listen(Number(process.env.PORT||8080),'127.0.0.1',()=>{console.log('Паллада: сервер запущен на loopback.');void flush();});
