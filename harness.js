// Shared jsdom harness for frontend tests. Usage: const {boot}=require('./harness.js')
const {JSDOM,VirtualConsole}=require('jsdom');
const fs=require('fs');
const OPEN=[];
function closeAll(){while(OPEN.length){try{OPEN.pop().close();}catch(e){}}}
function boot(opts){
  opts=opts||{};
  const html=fs.readFileSync(opts.file||require('path').join(__dirname,'..','index.html'),'utf8');
  const errors=[];const vc=new VirtualConsole();
  vc.on('jsdomError',e=>{if(!/scrollTo|Not implemented: (HTMLCanvas|navigation)/.test(e.message))errors.push((e.detail&&e.detail.stack||e.message).split('\n').slice(0,4).join(' | '));});
  vc.on('error',e=>errors.push('console.error: '+String(e).slice(0,300)));
  const fetchLog=[];
  const dom=new JSDOM(html,{runScripts:'dangerously',url:opts.url||'http://localhost:3000/',virtualConsole:vc,pretendToBeVisual:true,
    beforeParse(w){
      w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
      w.HTMLDialogElement.prototype.close=function(){const was=this.open;this.open=false;if(was)this.dispatchEvent(new w.Event('close'));};
      w.scrollTo=()=>{};
      w.TextEncoder=w.TextEncoder||TextEncoder;
      w.URL.createObjectURL=()=>'blob:x';w.URL.revokeObjectURL=()=>{};
      if(opts.storage)for(const [k,v] of Object.entries(opts.storage))w.localStorage.setItem(k,typeof v==='string'?v:JSON.stringify(v));
      if(opts.fetch)w.fetch=async(url,o)=>{fetchLog.push({url:String(url),opts:o});return opts.fetch(String(url),o,w);};
      if(opts.date){const R=w.Date;const base=new R(opts.date).getTime(),t0=R.now();
        class D extends R{constructor(...a){if(a.length)super(...a);else super(base+(R.now()-t0));}static now(){return base+(R.now()-t0);}}
        w.Date=D;}
    }});
  OPEN.push(dom.window);
  return {dom,w:dom.window,d:dom.window.document,errors,fetchLog};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// A fake server answering like server.js
function fakeServer(over){
  over=over||{};
  return async(url,o)=>{
    const u=new URL(url,'http://localhost:3000');const body=o&&o.body?JSON.parse(o.body):null;
    const res=(status,j)=>({ok:status<400,status,json:async()=>j});
    if(u.pathname==='/api/status')return res(200,over.status||{ok:true,providers:{openai:{label:'OpenAI',configured:true,models:['gpt-6-luna','gpt-6.1-sol'],defaultModel:'gpt-6-luna'},gemini:{label:'Google Gemini',configured:false,models:['gemini-3.5-flash-lite','gemini-3.8-flash'],defaultModel:'gemini-3.5-flash-lite'}},limits:{ratePerMinute:20,dailyLimit:200,usedToday:0,maxInputChars:24000,maxOutputTokens:2000},authRequired:false});
    if(u.pathname==='/api/test')return over.test?over.test(body):res(200,{ok:true,provider:body.provider,model:body.model||'m',text:'OK',usage:{}});
    if(u.pathname==='/api/chat')return over.chat?over.chat(body,res):res(200,{ok:true,provider:body.provider,model:body.model,text:'Mock answer',truncated:false});
    return res(404,{ok:false,code:'not_found',error:'nf'});
  };
}
module.exports={boot,sleep,fakeServer,closeAll};
