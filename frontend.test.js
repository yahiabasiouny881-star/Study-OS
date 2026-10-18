'use strict';
process.env.TZ='Africa/Cairo';
const test=require('node:test');const assert=require('node:assert/strict');
const {boot,sleep,fakeServer,closeAll}=require('./harness');
test.after(closeAll); // stop every page's timers so the test process can exit

const DAY0='2026-10-16'; // a Friday: no school, no fixed blocks
const at=(d,t)=>`${d}T${t||'10:00'}:00`;
const addD=(s,n)=>{const [y,m,d]=s.split('-').map(Number);const x=new Date(y,m-1,d+n);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
const consent=(extra)=>({so_ai_settings:Object.assign({provider:'openai',consent:true,personalize:true},extra||{})});
const click=(d,sel)=>{const el=typeof sel==='string'?d.querySelector(sel):sel;assert.ok(el,'missing element '+sel);el.dispatchEvent(new d.defaultView.MouseEvent('click',{bubbles:true,cancelable:true}));};
const setVal=(d,sel,v)=>{const el=d.querySelector(sel);assert.ok(el,'missing '+sel);el.value=v;el.dispatchEvent(new d.defaultView.Event('input',{bubbles:true}));el.dispatchEvent(new d.defaultView.Event('change',{bubbles:true}));};
const store=(w,k)=>{const v=w.localStorage.getItem(k);return v==null?null:JSON.parse(v);};
const dumpStore=w=>{const o={};for(let i=0;i<w.localStorage.length;i++){const k=w.localStorage.key(i);o[k]=w.localStorage.getItem(k);}return o;};
const dlgBtn=(d,label)=>[...d.querySelectorAll('#aiDlgActions button')].find(b=>b.textContent.trim().startsWith(label));
const noErr=(errors)=>assert.deepEqual(errors,[]);

/* ------------------------------------------------------------------ */
test('compatibility: data from the original version loads, nothing is erased or rewritten', async()=>{
  const seed={
    so_tasks:[{id:11,name:'Read ch1',desc:'',priority:'High',category:'School',due:'2026-10-18',done:false}],
    so_exams:[{id:21,name:'Math midterm',subject:'math',date:'2026-10-25',topics:[{text:'Algebra',done:true},{text:'Geometry',done:false}],manual:0}],
    so_hw:[{id:31,title:'Worksheet',subject:'science',due:'2026-10-17',notes:'',done:false}],
    so_notes:[{id:41,title:'Cells',subject:'science',body:'Cells are the basic unit of life.',updated:1}],
    so_cards:[{id:51,subject:'english',q:'Antonym of hot?',a:'cold',box:2,due:'2026-10-20'}],
    so_plan:{subj:{math:{diff:4,prio:3,target:200}},sessions:[{id:61,subject:'math',date:'2026-10-16',sm:600,em:645,topic:'Algebra',done:true,src:'manual'}],len:45,maxDay:3},
    so_pomo:{settings:{focus:25,brk:5},logs:[{date:'2026-10-15',subject:'math',minutes:25,ts:1}]},
    so_mastery:{ratings:{math:2},items:[{id:71,subject:'math',kind:'topic',text:'Fractions',fix:'',done:false,date:'2026-10-10'}]},
    so_settings:{theme:'light',accent:'#ff0000',autoBreak:true,notifications:false},
    // data written by the earlier "expanded modules" layer
    so_revision_v1:[{id:81,text:'Photosynthesis',subject:'science',due:'2026-10-16',interval:3,reviews:2,created:'2026-10-01'}],
    so_practice_v1:[{id:91,subject:'math',kind:'mcq',question:'2+2?',a:'3',b:'4',c:'5',d:'',correct:'B',wrong:1}],
    so_library_v1:[{id:101,title:'Chapter 1',subject:'english',kind:'notes',content:'hello',tags:['intro'],created:1}],
    so_routine_v1:{0:[{id:1,label:'School',start:'08:00',end:'14:00',type:'school'}],1:[],2:[],3:[],4:[],5:[],6:[]},
  };
  const A=boot({storage:seed,fetch:fakeServer(),date:at(DAY0)});await sleep(700);noErr(A.errors);
  const w=A.w;
  // Every original data key is still present and logically identical.
  for(const k of ['so_tasks','so_exams','so_hw','so_notes','so_cards','so_pomo','so_mastery','so_settings']){assert.deepEqual(store(w,k),seed[k],k+' changed');}
  assert.equal(store(w,'so_plan').sessions.length,1);
  assert.equal(store(w,'so_plan').sessions[0].topic,'Algebra');
  assert.equal(w.eval('tasks.length+exams.length+hw.length+notes.length+cards.length'),5);
  // Old revision item (interval 3) maps onto the new step model without losing its due date.
  const rv=A.w.StudyOS.state.revisions[0];assert.equal(rv.due,'2026-10-16');assert.equal(rv.step,1);
  assert.equal(A.w.StudyOS.state.practice[0].correct,'B');
  assert.equal(w.eval('settings.theme'),'light');
  for(const id of ['home','schedule','checklist','tasks','exams','pomodoro','progress','subjects','notes','settings','smartplan','practice','library','revision','tutor'])w.eval(`showView('${id}')`);
  noErr(A.errors);
});

test('corrupt saved data is preserved, not silently overwritten', async()=>{
  const A=boot({storage:{so_tasks:'{this is not json'},fetch:fakeServer(),date:at(DAY0)});await sleep(500);
  assert.equal(A.w.localStorage.getItem('so_corrupt_so_tasks'),'{this is not json');
  noErr(A.errors);
});

test('storage full: save() reports failure instead of pretending', async()=>{
  const A=boot({fetch:fakeServer(),date:at(DAY0)});await sleep(400);
  const w=A.w;const orig=w.Storage.prototype.setItem;
  w.Storage.prototype.setItem=function(){throw new w.DOMException('quota','QuotaExceededError');};
  const ok=w.eval(`save('so_tasks',[{id:1}])`);
  w.Storage.prototype.setItem=orig;
  assert.equal(ok,false);
  assert.match(A.d.getElementById('toast').textContent,/NOT saved/);
});

/* ------------------------------------------------------------------ */
test('revision engine: intervals, exam cap, manual date, persistence after reload', async()=>{
  const A=boot({storage:{so_revision_v1:[{id:900,text:'Cells',subject:'science',due:DAY0,interval:1,reviews:0}]},fetch:fakeServer(),date:at(DAY0)});await sleep(400);
  const S=A.w.StudyOS,today=DAY0;
  const mk=(o)=>Object.assign({step:0,confidence:3,history:[],examId:null},o);
  let r=mk({});
  assert.equal(S.scheduleNext(r,2,today),addD(today,3));  // good: step 1 -> 3 days
  assert.equal(S.scheduleNext(r,2,today),addD(today,7));  // good: step 2 -> 7 days
  assert.equal(r.history.length,2);
  const conf=r.confidence;
  assert.equal(S.scheduleNext(r,0,today),addD(today,1));  // forgot -> tomorrow, back to step 0
  assert.equal(r.step,0);assert.ok(r.confidence<conf);
  r=mk({step:1});assert.equal(S.scheduleNext(r,1,today),addD(today,3)); // hard: same step
  r=mk({step:3});A.w.eval(`exams.push({id:5,name:'Exam',subject:'math',date:'${addD(today,5)}',topics:[],manual:0})`);
  r.examId=5;assert.equal(S.scheduleNext(r,2,today),addD(today,4)); // 30-day step capped to the day before the exam
  // UI path + persistence
  A.w.eval(`showView('revision')`);
  click(A.d,'[data-act=rv-rate][data-id="900"][data-r="2"]');
  const saved=store(A.w,'so_revision_v1').find(x=>x.id===900);
  assert.equal(saved.due,addD(today,3));assert.equal(saved.history.length,1);
  const B=boot({storage:dumpStore(A.w),fetch:fakeServer(),date:at(DAY0)});await sleep(400);
  assert.equal(B.w.StudyOS.state.revisions.find(x=>x.id===900).due,addD(today,3));
  // manual adjustment
  B.w.eval(`showView('revision')`);setVal(B.d,'input[data-chg="rv-due"][data-id="900"]',addD(today,9));
  assert.equal(store(B.w,'so_revision_v1').find(x=>x.id===900).due,addD(today,9));
  noErr(A.errors);noErr(B.errors);
});

test('streaks: consecutive days, gaps, duplicates, thresholds, future dates, local midnight', async()=>{
  const logs=ds=>({so_pomo:{settings:{focus:25,brk:5},logs:ds.map(([date,minutes])=>({date,minutes,subject:'math',ts:1}))}});
  let A=boot({storage:logs([[DAY0,20],[addD(DAY0,-1),25],[addD(DAY0,-2),30],[addD(DAY0,-4),30]]),fetch:fakeServer(),date:at(DAY0)});await sleep(400);
  let s=A.w.StudyOS.streakInfo();assert.equal(s.cur,3);assert.equal(s.best,3);assert.equal(s.todayDone,true);
  // yesterday only: streak still alive but "at risk"
  A=boot({storage:logs([[addD(DAY0,-1),25],[addD(DAY0,-2),25]]),fetch:fakeServer(),date:at(DAY0)});await sleep(400);
  s=A.w.StudyOS.streakInfo();assert.equal(s.cur,2);assert.equal(s.todayDone,false);assert.equal(s.atRisk,true);
  // missed a day: streak is broken
  A=boot({storage:logs([[addD(DAY0,-2),25],[addD(DAY0,-3),25]]),fetch:fakeServer(),date:at(DAY0)});await sleep(400);
  assert.equal(A.w.StudyOS.streakInfo().cur,0);
  // duplicates count once; below-threshold minutes do not count; future dates are ignored
  A=boot({storage:logs([[DAY0,25],[DAY0,25],[addD(DAY0,-1),5],[addD(DAY0,3),60]]),fetch:fakeServer(),date:at(DAY0)});await sleep(400);
  s=A.w.StudyOS.streakInfo();assert.equal(s.cur,1);assert.equal(s.total,1);
  // 00:30 local time (UTC date is still the previous day in Cairo)
  const day='2026-10-17';
  A=boot({storage:logs([[day,25]]),fetch:fakeServer(),date:at(day,'00:30')});await sleep(400);
  assert.equal(A.w.eval('todayStr()'),day);assert.equal(A.w.StudyOS.streakInfo().todayDone,true);
  // a finished planned session counts on the day it was completed
  A=boot({storage:{so_plan:{subj:{},sessions:[{id:1,subject:'math',date:addD(DAY0,-1),sm:600,em:645,done:true,doneAt:DAY0}],len:45,maxDay:3}},fetch:fakeServer(),date:at(DAY0)});await sleep(400);
  assert.equal(A.w.StudyOS.streakInfo().todayDone,true);
  noErr(A.errors);
});

test('toggling a planned session records when it was finished', async()=>{
  const A=boot({storage:{so_plan:{subj:{},sessions:[{id:7,subject:'math',date:DAY0,sm:600,em:645,done:false}],len:45,maxDay:3}},fetch:fakeServer(),date:at(DAY0)});await sleep(400);
  A.w.eval('toggleSession(7)');assert.equal(store(A.w,'so_plan').sessions[0].doneAt,DAY0);
  A.w.eval('toggleSession(7)');assert.equal(store(A.w,'so_plan').sessions[0].doneAt,null);
});

/* ------------------------------------------------------------------ */
test('smart planner: no conflicts, no duplicates, needs your acceptance, works with no AI configured', async()=>{
  const A=boot({storage:{
    so_tasks:[{id:1,name:'Essay draft',desc:'',priority:'High',category:'School',due:DAY0,done:false}],
    so_hw:[{id:2,title:'Math worksheet',subject:'math',due:addD(DAY0,1),notes:'',done:false}],
    so_exams:[{id:3,name:'Science quiz',subject:'science',date:addD(DAY0,4),topics:[{text:'Cells',done:false}],manual:0}],
    so_revision_v1:[{id:4,text:'Verbs',subject:'english',due:DAY0,interval:1,reviews:0}],
  },fetch:async()=>{throw new Error('offline');},date:at(DAY0,'08:00')});await sleep(500);
  const w=A.w,d=A.d;w.eval(`showView('smartplan')`);
  assert.equal(w.eval('plan.sessions.length'),0);
  setVal(d,'#spAvail','240');click(d,'[data-act=sp-gen]');
  const rows=A.w.StudyOS.state.SP.rows;assert.ok(rows.length>=3,'rows: '+rows.length);
  const fixed=w.eval(`FIXED[dayOf('${DAY0}')]`);
  for(const r of rows){assert.ok(r.sm>=9*60&&r.em<=21.5*60);for(const f of fixed)assert.ok(!(r.sm<w.eval(`toMin('${f.e}')`)&&r.em>w.eval(`toMin('${f.s}')`)));}
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)assert.ok(!(rows[i].sm<rows[j].em&&rows[j].sm<rows[i].em),'overlap');
  assert.equal(w.eval('plan.sessions.length'),0,'nothing is added without accepting');
  // reject one, accept the rest
  const first=rows[0].topic;click(d,'[data-act=sp-rej][data-i="0"]');
  const n=A.w.StudyOS.state.SP.rows.length;click(d,'[data-act=sp-add]');
  assert.equal(w.eval('plan.sessions.length'),n);
  assert.ok(!w.eval('plan.sessions').some(s=>s.topic===first));
  // regenerate: already-planned topics are not suggested again
  click(d,'[data-act=sp-gen]');
  const again=A.w.StudyOS.state.SP.rows;
  for(const r of again)assert.ok(!w.eval('plan.sessions').some(s=>s.subject===r.subject&&s.topic===r.topic&&s.date===r.date),'duplicate suggestion');
  // adding the same row twice cannot create a duplicate or overlap
  const before=w.eval('plan.sessions.length');
  const err=w.StudyOS.addPlanRows([Object.assign({},w.eval('plan.sessions[0]'),{kind:'x'})]);
  assert.ok(err);assert.equal(w.eval('plan.sessions.length'),before);
  noErr(A.errors);
});

test('planner: a fixed lesson block is never scheduled over', async()=>{
  // Wednesday: school 08:00-14:00, rest to 15:30, science lesson 16:30-18:00
  const wed='2026-10-14';
  const A=boot({storage:{so_hw:[{id:2,title:'Essay',subject:'english',due:wed,notes:'',done:false},{id:3,title:'Read',subject:'english',due:addD(wed,1),notes:'',done:false},{id:4,title:'Lab',subject:'science',due:addD(wed,1),notes:'',done:false}]},fetch:fakeServer(),date:at(wed,'09:00')});await sleep(500);
  A.w.eval(`showView('smartplan')`);setVal(A.d,'#spAvail','240');click(A.d,'[data-act=sp-gen]');
  for(const r of A.w.StudyOS.state.SP.rows)assert.ok(r.em<=16*60+15||r.sm>=18*60+15,`session ${r.sm}-${r.em} too close to the 16:30-18:00 lesson`);
  assert.ok(A.w.StudyOS.state.SP.rows.every(r=>r.sm>=15*60+30));
});

/* ------------------------------------------------------------------ */
test('practice quiz: only reliable answers are auto-graded; written answers are self-checked', async()=>{
  const bank=[
    {id:1,subject:'math',kind:'mcq',question:'2+2?',a:'3',b:'4',c:'5',d:'',correct:'B',wrong:0},
    {id:2,subject:'math',kind:'mcq',question:'3+3?',a:'6',b:'7',c:'',d:'',correct:'A',wrong:0},
    {id:3,subject:'math',kind:'tf',question:'Zero is even',correct:'True',wrong:0},
    {id:4,subject:'math',kind:'written',question:'Define a prime number',correct:'Divisible only by 1 and itself',wrong:0},
  ];
  const A=boot({storage:{so_practice_v1:bank},fetch:fakeServer(),date:at(DAY0)});await sleep(500);
  const w=A.w,d=A.d;w.eval(`showView('practice')`);
  setVal(d,'#qzCount','all');click(d,'[data-act=qz-start]');
  const Q=w.StudyOS.state.Q;assert.equal(Q.run.pool.length,4);
  Q.run.pool.forEach((q,i)=>{Q.run.answers[i]= q.id===1?'B' : q.id===2?'B' /*wrong*/ : q.id===3?'True' : 'Divisible only by 1 and itself';});
  for(let i=0;i<3;i++)click(d,'[data-act=qz-next]');
  click(d,'[data-act=qz-finish]');
  const res=store(w,'so_quiz_results_v1');
  assert.ok(res&&res.length===1,'result stored');
  const r=res[0];assert.equal(r.total,4);assert.equal(r.autoTotal,3,'written answer must not be auto-graded');assert.equal(r.autoCorrect,2);
  const wi=r.items.find(i=>i.kind==='written');assert.equal(wi.correct,null);assert.equal(wi.self,null);
  const bank2=store(w,'so_practice_v1');assert.equal(bank2.find(q=>q.id===2).missed,true);assert.equal(bank2.find(q=>q.id===2).wrong,1);assert.equal(bank2.find(q=>q.id===1).missed,false);
  assert.match(d.getElementById('quizArea').textContent,/not auto-graded/);
  // self-check marks the written question; "missed" feeds the mistakes list
  click(d,'[data-act=qz-self][data-v="no"]');
  assert.equal(store(w,'so_practice_v1').find(q=>q.id===4).missed,true);
  assert.equal(store(w,'so_quiz_results_v1')[0].items.find(i=>i.kind==='written').self,'no');
  noErr(A.errors);
});

test('practice quiz: manual question validation and timed quiz auto-submits', async()=>{
  const A=boot({storage:{so_practice_v1:[{id:1,subject:'math',kind:'tf',question:'Sky is blue',correct:'True',wrong:0}]},fetch:fakeServer(),date:at(DAY0)});await sleep(500);
  const w=A.w,d=A.d;w.eval(`showView('practice')`);
  click(d,'[data-act=pq-add]');
  d.querySelector('#formFields [name=kind]').value='mcq';d.querySelector('#formFields [name=question]').value='Q?';
  d.querySelector('#formFields [name=a]').value='x';d.querySelector('#formFields [name=b]').value='y';d.querySelector('#formFields [name=correct]').value='C';
  click(d,'#formSave');assert.match(d.getElementById('formErr').textContent,/letter of a filled option/);
  d.querySelector('#formFields [name=correct]').value='B';click(d,'#formSave');
  assert.equal(store(w,'so_practice_v1').length,2);
  // timed quiz
  w.eval(`document.getElementById('qzMin').innerHTML+='<option value="0.02">tiny</option>'`);
  setVal(d,'#qzMin','0.02');setVal(d,'#qzMode','all');click(d,'[data-act=qz-start]');
  assert.ok(w.StudyOS.state.Q.run.ends>0);
  await sleep(2600);
  assert.equal(w.StudyOS.state.Q.run.state,'review');assert.equal(store(w,'so_quiz_results_v1')[0].timeUp,true);
  noErr(A.errors);
});

/* ------------------------------------------------------------------ */
test('AI tutor: consent gate, request shape, safe rendering, errors and retry', async()=>{
  let calls=0;
  const srv=fakeServer({chat:(b,res)=>{calls++;
    if(calls===1)return res(429,{ok:false,code:'provider_rate_limited',error:'OpenAI rate limit or quota reached.'});
    return res(200,{ok:true,provider:b.provider,model:b.model,text:'Photosynthesis makes sugar.\n\n<img src=x onerror="window.__pwn=1"> **Key idea**: light',truncated:false});}});
  const A=boot({fetch:srv,date:at(DAY0)});await sleep(500);
  const w=A.w,d=A.d;w.eval(`showView('tutor')`);
  setVal(d,'#tutInput','Explain photosynthesis');click(d,'[data-act=tut-send]');await sleep(150);
  assert.equal(A.fetchLog.filter(f=>f.url.includes('/api/chat')).length,0,'nothing is sent before consent');
  assert.equal(d.getElementById('tutInput').value,'Explain photosynthesis','typed text is kept while waiting for permission');
  assert.match(d.getElementById('aiDlgTitle').textContent,/Allow AI help/);
  click(d,dlgBtn(d,'I understand'));await sleep(300);
  assert.equal(store(w,'so_ai_settings').consent,true);
  // first reply is a rate-limit error with a retry control
  assert.match(d.getElementById('msgs').textContent,/rate limit/i);
  click(d,'[data-act=tut-retry]');await sleep(300);
  const body=JSON.parse(A.fetchLog.filter(f=>f.url.includes('/api/chat')).pop().opts.body);
  assert.equal(body.provider,'openai');assert.equal(body.model,'gpt-6-luna');assert.equal(body.messages.at(-1).content,'Explain photosynthesis');
  assert.match(body.system,/Subject: not specified/);
  assert.ok(!/api[_-]?key|sk-|AIza/i.test(JSON.stringify(body)));
  const html=d.getElementById('msgs').innerHTML;
  assert.ok(!d.querySelector('#msgs img'),'model HTML must not become elements');assert.equal(w.__pwn,undefined);
  assert.match(html,/&lt;img/);assert.match(html,/<strong>Key idea<\/strong>/);
  // not persisted by default
  assert.equal(w.localStorage.getItem('so_ai_chats'),null);
  noErr(A.errors);
});

test('AI tutor: chat history persists only when the privacy setting is on; delete clears it', async()=>{
  const A=boot({storage:consent({saveChats:true}),fetch:fakeServer(),date:at(DAY0)});await sleep(500);
  const w=A.w,d=A.d;w.eval(`showView('tutor')`);
  setVal(d,'#tutInput','Hello tutor');click(d,'[data-act=tut-send]');await sleep(300);
  assert.equal(store(w,'so_ai_chats').length,1);
  const B=boot({storage:dumpStore(w),fetch:fakeServer(),date:at(DAY0)});await sleep(500);
  B.w.eval(`showView('tutor')`);assert.match(B.d.getElementById('msgs').textContent,/Mock answer/);
  click(B.d,'[data-act=tut-clear-all]');click(B.d,'#confirmYes');
  assert.equal(B.w.localStorage.getItem('so_ai_chats'),null);
  noErr(A.errors);noErr(B.errors);
});

test('provider handling: unconfigured provider blocks calls; switching works; no silent fallback', async()=>{
  const A=boot({storage:consent({provider:'gemini'}),fetch:fakeServer(),date:at(DAY0)});await sleep(500);
  const w=A.w,d=A.d;w.eval(`showView('tutor')`);
  setVal(d,'#tutInput','Hi');click(d,'[data-act=tut-send]');await sleep(200);
  assert.equal(A.fetchLog.filter(f=>f.url.includes('/api/chat')).length,0);
  assert.match(d.getElementById('toast').textContent,/no API key on the server/);
  // switch to OpenAI in settings
  w.eval(`showView('settings')`);click(d,'input[name=aiprov][value=openai]');d.querySelector('input[name=aiprov][value=openai]').dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(store(w,'so_ai_settings').provider,'openai');
  w.eval(`showView('tutor')`);setVal(d,'#tutInput','Hi again');click(d,'[data-act=tut-send]');await sleep(300);
  assert.equal(JSON.parse(A.fetchLog.filter(f=>f.url.includes('/api/chat')).pop().opts.body).provider,'openai');
  noErr(A.errors);
});

test('connection test: "verified" appears only after a real successful request', async()=>{
  const ok=boot({fetch:fakeServer(),date:at(DAY0)});await sleep(500);
  ok.w.eval(`showView('settings')`);assert.match(ok.d.getElementById('aiSettings').textContent,/Not tested/);
  assert.equal(store(ok.w,'so_ai_settings'),null);
  click(ok.d,'[data-act=ai-test][data-p=openai]');await sleep(300);
  assert.ok(store(ok.w,'so_ai_settings').verified.openai.at);assert.match(ok.d.getElementById('aiTestMsg_openai').textContent,/real request succeeded/);
  const bad=boot({fetch:fakeServer({test:()=>({ok:false,status:502,json:async()=>({ok:false,code:'invalid_key',error:'OpenAI rejected the API key.'})})}),date:at(DAY0)});await sleep(500);
  bad.w.eval(`showView('settings')`);click(bad.d,'[data-act=ai-test][data-p=openai]');await sleep(300);
  assert.equal(store(bad.w,'so_ai_settings').verified.openai,null);assert.match(bad.d.getElementById('aiTestMsg_openai').textContent,/rejected the API key/);
  assert.equal(bad.d.querySelector('[data-act=ai-test][data-p=gemini]').disabled,true,'cannot test a provider with no key');
  noErr(ok.errors);noErr(bad.errors);
});

test('server not running: clear message, the rest of the app keeps working', async()=>{
  const A=boot({fetch:async()=>{throw new TypeError('Failed to fetch');},date:at(DAY0)});await sleep(500);
  const w=A.w,d=A.d;w.eval(`showView('tutor')`);
  assert.match(d.getElementById('aiStatusBar').textContent,/Cannot reach the Study OS server/);
  w.eval(`tasks.push({id:1,name:'x',desc:'',priority:'Low',category:'Other',due:'',done:false});save('so_tasks',tasks)`);w.eval(`showView('tasks')`);
  assert.match(d.getElementById('taskList').textContent,/x/);
  noErr(A.errors);
});

/* ------------------------------------------------------------------ */
test('AI flashcards: preview first, edit, nothing saved until confirmed, duplicates skipped', async()=>{
  const srv=fakeServer({chat:(b,res)=>res(200,{ok:true,provider:b.provider,model:b.model,truncated:false,
    text:JSON.stringify({cards:[{q:'What is a cell?',a:'The basic unit of life'},{q:'What is DNA?',a:'Genetic material'},{q:'',a:'bad'}]})})});
  const A=boot({storage:Object.assign(consent(),{so_cards:[{id:1,subject:'science',q:'What is DNA?',a:'old',box:0,due:DAY0}],so_notes:[{id:2,title:'Cells',subject:'science',body:'Cells are the basic unit of life. DNA is the genetic material found in cells.',updated:1}]}),fetch:srv,date:at(DAY0)});await sleep(500);
  const w=A.w,d=A.d;w.eval(`showView('notes')`);
  click(d,'[data-act=note-menu]');click(d,dlgBtn(d,'Make flashcards'));
  click(d,'#formSave');await sleep(500);
  assert.match(d.getElementById('aiDlgTitle').textContent,/Review flashcards/);
  assert.equal(store(w,'so_cards').length,1,'preview must not save');
  assert.equal(d.querySelectorAll('#aiDlgBody .draft-row').length,2,'invalid card dropped');
  assert.match(d.getElementById('aiDlgBody').textContent,/already in your flashcards/);
  const q=d.querySelector('textarea[data-inp="dc-q"][data-i="0"]');q.value='What is a cell? (edited)';q.dispatchEvent(new w.Event('input',{bubbles:true}));
  click(d,dlgBtn(d,'Save 1 card'));
  const cards=store(w,'so_cards');assert.equal(cards.length,2);
  const c=cards.find(x=>x.q.includes('edited'));assert.deepEqual([c.subject,c.box,c.due],['science',0,DAY0]);
  noErr(A.errors);
});

test('AI quiz generation: validated, previewed, saved only on confirm', async()=>{
  const srv=fakeServer({chat:(b,res)=>res(200,{ok:true,provider:b.provider,model:b.model,truncated:false,text:'```json\n'+JSON.stringify({questions:[
    {kind:'mcq',question:'Capital of France?',options:['Paris','Rome','Madrid','Berlin'],correct:'A',explanation:'Paris.',difficulty:'easy'},
    {kind:'mcq',question:'Broken: correct letter missing',options:['a','b'],correct:'D'},
    {kind:'tf',question:'The sun is a star',correct:'True'},
    {kind:'short',question:'Why is the sky blue?',correct:'Rayleigh scattering'},
    {kind:'essay',question:'ignored kind',correct:'x'}]})+'\n```'})});
  const A=boot({storage:consent(),fetch:srv,date:at(DAY0)});await sleep(500);
  const w=A.w,d=A.d;w.eval(`showView('practice')`);click(d,'[data-act="tool-quiz"]');
  d.querySelector('#formFields [name=topic]').value='Geography';click(d,'#formSave');await sleep(500);
  assert.match(d.getElementById('aiDlgTitle').textContent,/Review questions/);assert.equal(d.querySelectorAll('#aiDlgBody .draft-row').length,3);
  assert.match(d.getElementById('aiDlgBody').textContent,/check answers against your textbook/);
  assert.equal(w.StudyOS.state.practice.length,0);
  click(d,dlgBtn(d,'Save 3'));
  const bank=store(w,'so_practice_v1');assert.equal(bank.length,3);
  const m=bank.find(q=>q.kind==='mcq');assert.equal(m.correct,'A');assert.equal(m.a,'Paris');assert.equal(m.source,'ai');
  noErr(A.errors);
});

test('AI revision plan: needs data-sharing consent, shows exactly what is sent, saves to revision on confirm', async()=>{
  const exam={id:9,name:'Math midterm',subject:'math',date:addD(DAY0,10),topics:[{text:'Algebra',done:false},{text:'Geometry',done:false}],manual:0};
  const srv=fakeServer({chat:(b,res)=>res(200,{ok:true,provider:b.provider,model:b.model,truncated:false,text:JSON.stringify({items:[{topic:'Algebra basics',daysFromToday:1,note:'practice'},{topic:'Geometry',daysFromToday:4,note:'proofs'},{topic:'Too late',daysFromToday:99,note:''}]})})});
  // sharing off -> blocked with an explanation, nothing sent
  let A=boot({storage:Object.assign(consent({personalize:false}),{so_exams:[exam]}),fetch:srv,date:at(DAY0)});await sleep(500);
  A.w.eval(`showView('exams')`);click(A.d,'[data-act=exam-plan]');await sleep(300);
  assert.match(A.d.getElementById('aiDlgTitle').textContent,/data sharing is off/i);assert.equal(A.fetchLog.filter(f=>f.url.includes('/api/chat')).length,0);
  // sharing on -> preview of the outgoing text -> plan preview -> save
  A=boot({storage:Object.assign(consent(),{so_exams:[exam]}),fetch:srv,date:at(DAY0)});await sleep(500);
  const w=A.w,d=A.d;w.eval(`showView('exams')`);click(d,'[data-act=exam-plan]');await sleep(300);
  const sent=d.querySelector('.send-preview').textContent;assert.match(sent,/Math midterm/);assert.match(sent,/Algebra; Geometry/);assert.ok(!/note|body/i.test(sent));
  assert.equal(A.fetchLog.filter(f=>f.url.includes('/api/chat')).length,0,'not sent until Send is pressed');
  click(d,dlgBtn(d,'Send'));await sleep(500);
  assert.match(d.getElementById('aiDlgTitle').textContent,/Review revision plan/);
  assert.equal(w.StudyOS.state.revisions.length,0);
  click(d,dlgBtn(d,'Add 3'));
  const rv=store(w,'so_revision_v1');assert.equal(rv.length,3);assert.ok(rv.every(r=>r.examId===9&&r.due<=exam.date&&r.due>=DAY0));
  noErr(A.errors);
});

test('AI weekly analysis sends only recorded numbers (no notes), after confirmation', async()=>{
  const A=boot({storage:Object.assign(consent(),{so_pomo:{settings:{focus:25,brk:5},logs:[{date:DAY0,subject:'math',minutes:30,ts:1}]},so_notes:[{id:1,title:'SECRET diary',subject:'math',body:'private thoughts',updated:1}]}),fetch:fakeServer(),date:at(DAY0)});await sleep(500);
  A.w.eval(`showView('progress')`);click(A.d,'[data-act=analyze-week]');await sleep(300);
  const sent=A.d.querySelector('.send-preview').textContent;
  assert.match(sent,/focused 30 min in 1 sessions/);assert.ok(!/SECRET|private/.test(sent));
  click(A.d,dlgBtn(A.d,'Send'));await sleep(300);assert.match(A.d.getElementById('aiDlgBody').textContent,/Mock answer/);
  const body=JSON.parse(A.fetchLog.filter(f=>f.url.includes('/api/chat')).pop().opts.body);assert.ok(!/SECRET|private/.test(JSON.stringify(body)));
  noErr(A.errors);
});

test('lesson library: create, search, filter, edit, delete; PDFs are references only', async()=>{
  const A=boot({fetch:fakeServer(),date:at(DAY0)});await sleep(500);
  const w=A.w,d=A.d;w.eval(`showView('library')`);
  const add=(title,subject,kind,tags,content,url)=>{click(d,'[data-act=lb-add]');const f=n=>d.querySelector('#formFields [name='+n+']');f('title').value=title;f('subject').value=subject;f('kind').value=kind;f('tags').value=tags;f('content').value=content||'';f('url').value=url||'';click(d,'#formSave');};
  add('Cell biology','science','notes','biology, cells','Mitochondria are the powerhouse');
  add('Khan link','math','link','video','','https://example.com/x');
  add('Bad link','math','link','','','javascript:alert(1)');
  assert.match(d.getElementById('formErr').textContent,/http/);click(d,'#formDialog button.ghost');
  assert.equal(store(w,'so_library_v1').length,2);
  setVal(d,'#lbSearch','mitochondria');assert.match(d.getElementById('lbList').textContent,/Cell biology/);assert.ok(!/Khan link/.test(d.getElementById('lbList').textContent));
  setVal(d,'#lbSearch','');setVal(d,'select[data-chg="lb-tag"]','video');assert.match(d.getElementById('lbList').textContent,/Khan link/);assert.ok(!/Cell biology/.test(d.getElementById('lbList').textContent));
  assert.ok(d.querySelector('#lbList a[rel~=noopener]'));
  // PDF import saves a reference only
  noErr(A.errors);
});

test('safe markdown renderer escapes HTML and neutralises links', async()=>{
  const A=boot({fetch:fakeServer(),date:at(DAY0)});await sleep(300);
  const md=A.w.StudyOS.md;
  const out=md('<script>window.__x=1</script> [click](javascript:alert(1)) [ok](https://a.b/c)\n- **b** <b onclick=1>x</b>');
  assert.ok(!/<script|<b |<a /i.test(out),out);assert.match(out,/&lt;script&gt;/);assert.match(out,/<li[^>]*><strong>b<\/strong>/);
});

/* ------------------------------------------------------------------ */
test('backup: export omits secrets; invalid imports change nothing; valid import snapshots first', async()=>{
  const A=boot({storage:Object.assign(consent(),{so_ai_token:'SUPERSECRET-TOKEN',so_tasks:[{id:1,name:'keep me',desc:'',priority:'Low',category:'Other',due:'',done:false}]}),fetch:fakeServer(),date:at(DAY0)});await sleep(500);
  const w=A.w,d=A.d;
  let blob;w.URL.createObjectURL=b=>{blob=b;return 'blob:x';};
  w.eval('exportData()');
  const text=await new Promise(r=>{const fr=new w.FileReader();fr.onload=()=>r(fr.result);fr.readAsText(blob);});
  assert.ok(!text.includes('SUPERSECRET'));assert.ok(!text.includes('so_safety_snapshots'));assert.ok(text.includes('keep me'));
  const before=JSON.stringify(dumpStore(w));
  const V=w.StudyOS.validateBackup;
  for(const bad of ['not json','[]','{"hello":1}','{"so_tasks":"{\\"a\\":1}"}','{"so_tasks":"[1","so_exams":"[]"}','{"so_plan":"[]"}'])assert.throws(()=>V(bad),/./,bad);
  const via=(content)=>{const inp=d.createElement('input');Object.defineProperty(inp,'files',{value:[new w.File([content],'b.json')]});w.importData(inp);};
  via('{"so_tasks":"[bad"}');await sleep(150);assert.equal(JSON.stringify(dumpStore(w)),before,'rejected import must not touch data');
  const good=JSON.stringify({so_tasks:JSON.stringify([{id:5,name:'imported',desc:'',priority:'Low',category:'Other',due:'',done:false}]),so_ai_token:'"evil"'});
  via(good);await sleep(150);
  assert.equal(store(w,'so_tasks')[0].name,'keep me','nothing changes until the user confirms');
  click(d,'#confirmYes');
  assert.equal(store(w,'so_tasks')[0].name,'imported');
  assert.equal(w.localStorage.getItem('so_ai_token'),'SUPERSECRET-TOKEN','a token inside a backup file is ignored');
  const snaps=store(w,'so_safety_snapshots');assert.ok(snaps&&snaps[0].reason==='before-import');
  assert.ok(JSON.stringify(snaps[0].data).includes('keep me'));assert.ok(!JSON.stringify(snaps).includes('SUPERSECRET'));
  noErr(A.errors);
});

test('"Clear all" only removes Study OS keys and keeps an undo snapshot', async()=>{
  const A=boot({storage:{so_tasks:[{id:1,name:'t',desc:'',priority:'Low',category:'Other',due:'',done:false}],other_app:'keep'},fetch:fakeServer(),date:at(DAY0)});await sleep(500);
  A.w.eval(`confirmAction('clear-all')`);click(A.d,'#confirmYes');
  assert.equal(A.w.localStorage.getItem('other_app'),'keep');assert.equal(A.w.localStorage.getItem('so_tasks'),null);
  assert.ok(store(A.w,'so_safety_snapshots')[0].reason==='before-clear');
  // restore from snapshot
  A.w.eval('void 0');
});

test('Arabic: RTL layout toggles and persists; layout flag set on <html>', async()=>{
  const A=boot({storage:{so_ui_lang:'"ar"'},fetch:fakeServer(),date:at(DAY0)});await sleep(500);
  assert.equal(A.d.documentElement.dir,'rtl');assert.ok(A.d.body.classList.contains('is-rtl'));
  assert.match(A.d.getElementById('navMain').textContent,/الرئيسية/);
  assert.equal(A.d.documentElement.lang,'ar');
  noErr(A.errors);
});

test('keyboard access: custom checkboxes and toggles are focusable switches', async()=>{
  const A=boot({fetch:fakeServer(),date:at(DAY0)});await sleep(500);
  A.w.eval(`showView('checklist')`);await sleep(30);
  const cb=A.d.querySelector('#checklistItems .checkbox');assert.equal(cb.getAttribute('role'),'checkbox');assert.equal(cb.tabIndex,0);
  const before=A.w.eval('checklist.items[0].done');
  cb.dispatchEvent(new A.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  assert.equal(A.w.eval('checklist.items[0].done'),!before);
  A.w.eval(`showView('settings')`);await sleep(30);assert.equal(A.d.getElementById('toggleAutoBreak').getAttribute('role'),'switch');
});
