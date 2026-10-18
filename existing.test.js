'use strict';
// Regression tests for the ORIGINAL Study OS features (they must keep working after the upgrade).
process.env.TZ='Africa/Cairo';
const test=require('node:test');const assert=require('node:assert/strict');
const {boot,sleep,fakeServer,closeAll}=require('./harness');
test.after(closeAll);
const DAY='2026-10-16';const at=(d,t)=>`${d}T${t||'10:00'}:00`;
const store=(w,k)=>{const v=w.localStorage.getItem(k);return v==null?null:JSON.parse(v);};
const click=(d,sel)=>{const el=typeof sel==='string'?d.querySelector(sel):sel;assert.ok(el,'missing '+sel);el.dispatchEvent(new d.defaultView.MouseEvent('click',{bubbles:true,cancelable:true}));};

test('pomodoro: a finished focus session is logged and completes its linked planned session', async()=>{
  const A=boot({storage:{so_plan:{subj:{},sessions:[{id:7,subject:'math',date:DAY,sm:600,em:645,done:false}],len:45,maxDay:3}},fetch:fakeServer(),date:at(DAY)});await sleep(500);
  const w=A.w;
  w.eval(`startFocusFromSchedule('math',7)`);w.eval('toggleTimer()');
  assert.equal(w.eval('timerState.running'),true);
  w.eval('timerState.endAt=Date.now()-1000;tick()');
  const logs=store(w,'so_pomo').logs;assert.equal(logs.length,1);assert.deepEqual([logs[0].date,logs[0].subject,logs[0].minutes],[DAY,'math',25]);
  const s=store(w,'so_plan').sessions[0];assert.equal(s.done,true);assert.equal(s.doneAt,DAY);
  assert.equal(w.eval('timerState.mode'),'break');
  // skipping a focus session must NOT count
  w.eval('resetTimer();toggleTimer();skipTimer()');assert.equal(store(w,'so_pomo').logs.length,1);
  assert.deepEqual(A.errors,[]);
});

test('theme and accent colour persist across reloads', async()=>{
  const A=boot({fetch:fakeServer(),date:at(DAY)});await sleep(400);
  A.w.eval(`showView('settings')`);click(A.d,'.theme-swatch:nth-child(3)');
  const acc=A.d.getElementById('accentPicker');acc.value='#ff8800';acc.dispatchEvent(new A.w.Event('input'));
  const B=boot({storage:Object.fromEntries(Object.keys(A.w.localStorage).map(k=>[k,A.w.localStorage.getItem(k)])),fetch:fakeServer(),date:at(DAY)});await sleep(400);
  assert.equal(B.d.documentElement.getAttribute('data-theme'),'deepblue');
  assert.equal(B.d.documentElement.style.getPropertyValue('--accent'),'#ff8800');
});

test('tasks: add, validation, complete, overdue filter, delete', async()=>{
  const A=boot({fetch:fakeServer(),date:at(DAY)});await sleep(400);const w=A.w,d=A.d;
  w.eval(`showView('tasks')`);
  d.getElementById('taskName').value='';w.eval('addTask()');assert.match(d.getElementById('toast').textContent,/name/i);
  d.getElementById('taskName').value='Write essay';d.getElementById('taskDue').value='2026-10-10';w.eval('addTask()');
  assert.equal(store(w,'so_tasks').length,1);
  w.eval(`taskFilter='Overdue';renderTasks()`);assert.match(d.getElementById('taskList').textContent,/Write essay/);
  const id=store(w,'so_tasks')[0].id;w.eval(`toggleTask(${id})`);assert.equal(store(w,'so_tasks')[0].doneAt,DAY);
  w.eval(`taskFilter='Overdue';renderTasks()`);assert.ok(!/Write essay/.test(d.getElementById('taskList').textContent),'completed tasks are not overdue');
  w.eval(`deleteTask(${id})`);click(d,'#confirmYes');assert.equal(store(w,'so_tasks').length,0);
});

test('flashcard spaced repetition: boxes and due dates', async()=>{
  const A=boot({storage:{so_cards:[{id:1,subject:'english',q:'hot?',a:'cold',box:0,due:DAY}]},fetch:fakeServer(),date:at(DAY)});await sleep(400);const w=A.w;
  w.eval(`noteTab='review';showView('notes');startReview()`);
  w.eval('revFlip();revGrade(true)');let c=store(w,'so_cards')[0];assert.deepEqual([c.box,c.due],[1,'2026-10-17']);
  w.eval(`cards[0].due='${DAY}';startReview();revFlip();revGrade(true)`);c=store(w,'so_cards')[0];assert.deepEqual([c.box,c.due],[2,'2026-10-19']);
  w.eval(`cards[0].due='${DAY}';startReview();revFlip();revGrade(false)`);c=store(w,'so_cards')[0];assert.deepEqual([c.box,c.due],[0,DAY]);
});

test('translator (mocked service): translate, cache, save as flashcard, wrong-direction guard', async()=>{
  let net=0;const base=fakeServer();
  const A=boot({fetch:async(u,o)=>{if(u.includes('mymemory')){net++;return {ok:true,status:200,json:async()=>({responseStatus:200,responseData:{translatedText:'مرحبا'}})};}return base(u,o);},date:at(DAY)});await sleep(400);const w=A.w;
  const r1=await w.eval(`translateText('hello','en-ar')`);assert.equal(r1.text,'مرحبا');assert.equal(r1.cached,false);
  const r2=await w.eval(`translateText('hello','en-ar')`);assert.equal(r2.cached,true);assert.equal(net,1,'second lookup must come from the cache');
  await assert.rejects(()=>w.eval(`translateText('مرحبا','en-ar')`),/Arabic/);
  w.eval(`trState.src='hello';trState.out='مرحبا';trSave()`);assert.equal(store(w,'so_cards').length,1);
});

test('checklist rolls over at a new local day and keeps history', async()=>{
  const A=boot({storage:{so_checklist:{date:'2026-10-15',items:[{id:1,text:'A',done:true},{id:2,text:'B',done:false}],history:{}}},fetch:fakeServer(),date:at(DAY,'00:20')});await sleep(400);
  const c=store(A.w,'so_checklist');assert.equal(c.date,DAY);assert.deepEqual(c.history['2026-10-15'],{done:1,total:2});assert.ok(c.items.every(i=>!i.done));
});

test('schedule and exams: manual session conflicts are rejected; exam preparation %', async()=>{
  const wed='2026-10-14';const A=boot({storage:{so_exams:[{id:1,name:'E',subject:'math',date:'2026-10-30',topics:[{text:'a',done:true},{text:'b',done:false}],manual:0}]},fetch:fakeServer(),date:at(wed)});await sleep(400);const w=A.w;
  assert.match(w.eval(`sessionConflict('${wed}',600,660)`),/School/);          // during school
  assert.equal(w.eval(`sessionConflict('${wed}',15*60+30,16*60+15)`),'');        // free slot
  assert.match(w.eval(`sessionConflict('${wed}',16*60+45,17*60+15)`),/Science Lesson/);
  assert.equal(w.eval('examPct(exams[0])'),50);
});
