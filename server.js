
import http from 'http';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';

const PORT = process.env.PORT || 10000;
const rooms = new Map();
const QUESTIONS = buildQuestions();
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomCode=()=>Array.from({length:4},()=>ALPHABET[Math.floor(Math.random()*ALPHABET.length)]).join('');
const safeName=n=>String(n||'لاعب').replace(/[<>]/g,'').trim().slice(0,18)||'لاعب';
const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
const send=(ws,type,data={})=>{if(ws?.readyState===1)ws.send(JSON.stringify({type,...data}))};
function broadcast(room,type,data={}){for(const p of [room.host,room.guest])send(p?.ws,type,data)}
function publicQuestion(q){return {id:q.id,text:q.text,choices:q.choices,kind:q.kind,level:q.level,points:q.points||10};}
function stats(p){return {name:p.name,score:p.score,correct:p.correct,wrong:p.wrong,blank:p.blank};}
function startQuestion(r){
  if(!r.started || r.index>=r.questions.length)return endGame(r);
  r.phase='question'; r.questionStart=Date.now(); r.questionEnd=r.questionStart+r.time*1000;
  const q=r.questions[r.index]; r.answers={host:null,guest:null};
  broadcast(r,'question',{index:r.index,total:r.questions.length,question:publicQuestion(q),startAt:r.questionStart,endAt:r.questionEnd,serverNow:Date.now()});
  clearTimeout(r.timer); r.timer=setTimeout(()=>reveal(r),r.time*1000+40);
}
function reveal(r){
  if(r.phase!=='question')return;
  r.phase='reveal'; clearTimeout(r.timer);
  const q=r.questions[r.index];
  for(const key of ['host','guest']){
    const p=r[key]; const a=r.answers[key];
    if(a===null){p.blank++} else if(a===q.answer){p.score+=10;p.correct++} else p.wrong++;
  }
  broadcast(r,'reveal',{index:r.index,correct:q.answer,explain:q.explain,rule:q.rule,trap:q.trap,players:{host:stats(r.host),guest:stats(r.guest)}});
  r.timer=setTimeout(()=>{r.index++;startQuestion(r)},5200);
}
function endGame(r){
  r.phase='done';clearTimeout(r.timer);
  broadcast(r,'result',{players:{host:stats(r.host),guest:stats(r.guest)}});
}
function makeRoom(){let c;do c=roomCode();while(rooms.has(c));return c}
function cleanup(ws){
  for(const [code,r] of rooms){
    for(const key of ['host','guest']) if(r[key]?.ws===ws){
      const wasHost=key==='host'; r[key]=null; if(r.timer)clearTimeout(r.timer);
      if(wasHost){broadcast(r,'roomClosed');rooms.delete(code)}else broadcast(r,'opponentLeft');
      return;
    }
  }
}
function handle(ws,msg){
  if(!msg||typeof msg.type!=='string')return;
  if(msg.type==='create'){
    if(ws.room) return;
    const code=makeRoom(), name=safeName(msg.name); const r={code,host:{ws,name,score:0,correct:0,wrong:0,blank:0},guest:null,time:20,count:10,questions:[],index:0,phase:'lobby',started:false,timer:null,answers:{}};
    ws.room=code;ws.role='host';rooms.set(code,r);send(ws,'created',{room:code,role:'host',name});return;
  }
  if(msg.type==='join'){
    if(ws.room)return; const code=String(msg.room||'').toUpperCase(); const r=rooms.get(code);
    if(!r||!r.host){send(ws,'joinFailed',{reason:'لم يتم العثور على غرفة بهذا الرمز.'});return}
    if(r.guest){send(ws,'joinFailed',{reason:'الغرفة ممتلئة.'});return}
    r.guest={ws,name:safeName(msg.name),score:0,correct:0,wrong:0,blank:0};ws.room=code;ws.role='guest';
    send(ws,'joined',{room:code,role:'guest',name:r.guest.name,hostName:r.host.name});
    send(r.host.ws,'playerJoined',{name:r.guest.name});return;
  }
  if(!ws.room)return; const r=rooms.get(ws.room); if(!r)return;
  if(msg.type==='ping'){send(ws,'pong',{serverNow:Date.now(),clientNow:msg.clientNow});return}
  if(msg.type==='start'&&ws.role==='host'){
    if(!r.guest){send(ws,'error',{message:'انتظر اللاعب الثاني.'});return}
    r.time=[15,20,30,45].includes(+msg.time)?+msg.time:20;r.count=Math.min(30,Math.max(5,+msg.count||10));
    const uniqueByText=arr=>{const seen=new Set();return arr.filter(q=>{const k=q.text+'|'+q.choices.join('¦');if(seen.has(k))return false;seen.add(k);return true})};
const pickQuestions=(count,level)=>{
  if(level!=='mixed'){
    const pool=uniqueByText(QUESTIONS.filter(q=>q.level===level));
    return shuffle(pool.length>=count?pool:uniqueByText(QUESTIONS)).slice(0,count);
  }
  const nF=Math.floor(count*0.2), nA=Math.floor(count*0.4), nD=count-nF-nA;
  const take=(lvl,n)=>shuffle(uniqueByText(QUESTIONS.filter(q=>q.level===lvl))).slice(0,n);
  let picked=[...take('foundation',nF),...take('application',nA),...take('deep',nD)];
  if(picked.length<count){
    const used=new Set(picked.map(q=>q.text+'|'+q.choices.join('¦')));
    const rest=shuffle(uniqueByText(QUESTIONS)).filter(q=>!used.has(q.text+'|'+q.choices.join('¦')));
    picked.push(...rest.slice(0,count-picked.length));
  }
  return shuffle(picked);
};
r.questions=pickQuestions(r.count,msg.level);
    r.index=0;r.started=true;r.phase='countdown';
    for(const k of ['host','guest']){Object.assign(r[k],{score:0,correct:0,wrong:0,blank:0})}
    broadcast(r,'countdown',{startAt:Date.now()+3000,serverNow:Date.now()});
    clearTimeout(r.timer);r.timer=setTimeout(()=>startQuestion(r),3000);return;
  }
  if(msg.type==='answer'){
    if(r.phase!=='question'||msg.index!==r.index)return;
    if(Date.now()>r.questionEnd)return;
    const q=r.questions[r.index];
    if(!q||!Array.isArray(q.choices)){send(ws,'error',{message:'تعذر التحقق من السؤال الحالي.'});return;}
    const p=r[ws.role]; if(!p||r.answers[ws.role]!==null)return;
    const choice=Number(msg.choice); if(!Number.isInteger(choice)||choice<0||choice>=q.choices.length){send(ws,'error',{message:'الإجابة غير صالحة لهذا السؤال.'});return;}
    r.answers[ws.role]=choice; send(ws,'answerAccepted');
    const other=r[ws.role==='host'?'guest':'host'];
    if(other?.ws)send(other.ws,'opponentAnswered');
    if(r.answers.host!==null&&r.answers.guest!==null)reveal(r);return;
  }
  if(msg.type==='rematch'&&ws.role==='host'&&r.guest){r.started=false;r.phase='lobby';broadcast(r,'rematchReady');}
}

const server=http.createServer((req,res)=>{
  if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,rooms:rooms.size}));return}
  if(req.url==='/'||req.url==='/index.html'){
    import('fs').then(({readFile})=>readFile(new URL('./public/index.html',import.meta.url),(e,d)=>{if(e){res.writeHead(500);res.end('error')}else{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(d)}}));return;
  }
  res.writeHead(404);res.end('Not found');
});
const wss=new WebSocketServer({server});
wss.on('connection',ws=>{ws.id=crypto.randomUUID();ws.on('message',b=>{try{handle(ws,JSON.parse(b.toString()))}catch(e){send(ws,'error',{message:'حدث خطأ في الخادم.'})}});ws.on('close',()=>cleanup(ws));ws.on('error',()=>cleanup(ws));send(ws,'hello',{serverNow:Date.now()})});
server.listen(PORT,()=>console.log(`Logic Challenge server listening on ${PORT}`));

function buildQuestions(){
 const q=[]; let id=1; const add=(text,choices,answer,explain,rule,trap,level='application',kind='mc')=>q.push({id:id++,text,choices,answer,explain,rule,trap,level,kind});
 // Foundation
 add('أي عبارة مما يلي تُعد قضية منطقية؟',['افتح الكتاب.','x+3=7','7 عدد أولي.','هل ذهبت؟'],2,'يمكن الحكم على العبارة بأنها صواب أو خطأ، ولا تطلب تنفيذًا أو تعتمد على متغير غير محدد.','القضية المنطقية لها قيمة صواب واحدة: T أو F.','الخلط بين القضية والجملة المفتوحة.','foundation');
 add('أي عبارة جملة مفتوحة؟',['5>2','x-4=9','9 عدد فردي.','2+3=5'],1,'قيمة صدق x-4=9 تعتمد على قيمة x.','الجملة المفتوحة تحتوي متغيرًا ولم تتحدد قيمتها بعد.','اعتبار وجود علامة = كافيًا لجعل العبارة قضية.','foundation');
 add('إذا كانت p=T، فما قيمة ¬p؟',['T','F','غير محددة','T وF معًا'],1,'نفي القضية يقلب قيمة الصواب.','P=T ⇒ ¬P=F.','اعتقاد أن النفي يترك قيمة الصواب كما هي.','foundation');
 add('أي رمز يمثل الاقتران؟',['∨','∧','→','↔'],1,'الاقتران يعني أن القضيتين معًا صحيحتان.','p ∧ q.','الخلط بين ∧ و∨.','foundation');
 add('أي رمز يمثل الفصل المنطقي؟',['∧','¬','∨','→'],2,'الفصل هو «أو» المنطقية.','p ∨ q.','قراءة ∨ كأنها اقتران.','foundation');
 add('في p→q، ما الفرض؟',['q','¬p','p','¬q'],2,'السهم يبدأ من p، ولذلك p هو الفرض.','p→q تعني: إذا كانت p فإن q.','عكس الفرض والنتيجة بسبب RTL.','foundation');
 add('في p→q، متى تكون القضية كاذبة؟',['p=T,q=T','p=T,q=F','p=F,q=T','p=F,q=F'],1,'الحالة الوحيدة التي تخالف الشرط هي تحقق الفرض وعدم تحقق النتيجة.','p→q تكون F فقط عندما p=T وq=F.','اعتبار أي حالة فيها p=F كاذبة.','foundation');
 add('أي صيغة تمثل المعاكس الإيجابي لـ p→q؟',['q→p','¬p→¬q','¬q→¬p','p∧¬q'],2,'نفي الطرفين مع عكس الاتجاه يعطي المعاكس الإيجابي.','p→q ≡ ¬q→¬p.','الخلط بين المعاكس الإيجابي والمعكوس.','foundation');
 add('ما نفي p→q؟',['¬p→¬q','q→p','p∧¬q','¬q→¬p'],2,'نفي الشرط يطلب تحقق الفرض وفشل النتيجة.','¬(p→q) ≡ p∧¬q.','اعتبار المعكوس أو العكس نفيًا.','foundation');
 add('ما معنى ∀؟',['يوجد','لكل','ليس','إذا وفقط إذا'],1,'المسوّر الكلي يربط العبارة بكل عناصر المجال.','∀ = لكل/جميع.','الخلط بين ∀ و∃.','foundation');
 add('ما معنى ∃؟',['لكل','ينفي','يوجد على الأقل عنصر','إذا'],2,'يكفي وجود عنصر واحد يحقق العبارة.','∃ = يوجد/يوجد على الأقل.','الاعتقاد أن كل العناصر يجب أن تحققها.','foundation');
 add('أي مجال يمثله ℤ؟',['الأعداد الطبيعية','الأعداد الصحيحة','الأعداد النسبية','الأعداد الحقيقية'],1,'ℤ يضم الأعداد الصحيحة السالبة والصفر والموجبة.','ℕ, ℤ, ℚ, ℝ مجالات عددية مختلفة.','اعتبار ℤ مساويًا لـℕ.','foundation');
 // Applications and quantifiers
 const templates=[
  ['قيمة: ∀ x∈ℝ, x²≥0؟',['T','F','لا يمكن تحديدها','تتغير حسب x'],0,'مربع أي عدد حقيقي غير سالب.','العبارة كلية ويكفي فحص الخاصية العامة.'],
  ['قيمة: ∀ x∈ℝ, x²>x؟',['T','F','T وF','غير قضية'],1,'عند x=0 نحصل على 0>0، وهذا خطأ؛ فالمثال المضاد يكفي.','لإسقاط قضية كلية يكفي مثال مضاد واحد.'],
  ['قيمة: ∃ x∈ℝ, x²=9؟',['T','F','غير محددة','تتوقف على x'],0,'x=3 أو x=-3 يحقق العبارة.','الوجود يحتاج عنصرًا واحدًا على الأقل.'],
  ['قيمة: ∃ x∈ℕ, x²=-1؟',['T','F','غير محددة','T إذا x=−1'],1,'مربع أي عدد حقيقي، وبالتالي الطبيعي، غير سالب.','المجال جزء من القضية.'],
  ['قيمة: ∃ x∈ℤ, x²=4؟',['T','F','غير محددة','لا يوجد مجال'],0,'x=2 أو x=-2 مثالان.','لا تنس المجال.'],
  ['قيمة: ∃ x∈ℕ, x>5؟',['T','F','غير محددة','فقط x=5'],0,'مثلًا x=6 يحققها.','«يوجد» لا تعني أن كل الأعداد أكبر من 5.'],
  ['نفي: ∀x∈ℝ, x²≥0؟',['∀x∈ℝ,x²<0','∃x∈ℝ,x²<0','∃x∈ℝ,x²≥0','∀x∈ℝ,x²≤0'],1,'نفي لكل يحول المسوّر إلى يوجد، مع نفي العلاقة.','¬∀x P(x) ≡ ∃x ¬P(x).'],
  ['نفي: ∃x∈ℝ, x²=4؟',['∃x∈ℝ,x²≠4','∀x∈ℝ,x²≠4','∀x∈ℝ,x²=4','¬∀x∈ℝ,x²=4'],1,'نفي الوجود يعني أن كل عنصر لا يحقق العبارة.','¬∃x P(x) ≡ ∀x ¬P(x).'],
  ['ما نفي x>7؟',['x≥7','x<7','x≤7','x≠7'],2,'عدم كون x أكبر من 7 يعني x≤7.','¬(x>a) ≡ x≤a.'],
  ['ما نفي x≤−2؟',['x<−2','x≥−2','x>−2','x=−2'],2,'نفي «أصغر من أو يساوي» هو «أكبر من».','¬(x≤a) ≡ x>a.'],
  ['ما نفي x=5؟',['x>5','x<5','x≠5','x≤5'],2,'النفي يعني أن x لا يساوي 5.','¬(x=a) ≡ x≠a.'],
  ['أي صيغة تمثل «كل عدد حقيقي مربعه غير سالب»؟',['∃x∈ℝ,x²≥0','∀x∈ℝ,x²≥0','∀x∈ℝ,x²>0','∃x∈ℝ,x²<0'],1,'«كل» تتطلب ∀.','تحديد المسوّر قبل الرمز الرياضي.'],
  ['أي صيغة تمثل «يوجد عدد حقيقي مربعه يساوي 16»؟',['∀x∈ℝ,x²=16','∃x∈ℝ,x²=16','∃x∈ℝ,x²≠16','∀x∈ℝ,x²≠16'],1,'«يوجد» تتطلب ∃.','الخلط بين ∀ و∃.'],
  ['أي عبارة لفظية تقابل ∀x∈ℝ, x+1>x؟',['يوجد x يحققها','كل عدد حقيقي x يحقق x+1>x','كل x يحقق x+1=x','يوجد x لا يحققها'],1,'لكل عدد حقيقي، إضافة 1 تزيد العدد.','قراءة ∀ كـ«يوجد».'],
  ['أي عبارة لفظية تقابل ∃x∈ℝ,x²=16؟',['لكل x مربعُه 16','يوجد عدد حقيقي مربعه 16','لا يوجد عدد مربعه 16','لكل x مربعه لا يساوي 16'],1,'مثلًا x=4 يحققها.','الوجود لا يعني العموم.']
 ];
 for(let round=0;round<3;round++) for(const t of templates) add(t[0],t[1],t[2],t[3],t[4],t[5],round===0?'application':'deep');
 // conditionals/equivalence
 const cond=[
 ['إذا p=T وq=F، فقيمة p→q؟',['T','F'],1,'هذه هي الحالة الوحيدة التي تجعل الشرط كاذبًا.','p→q = F فقط عند T→F.'],
 ['إذا p=F وq=F، فقيمة p→q؟',['T','F'],0,'لم يتحقق الفرض، فلا يوجد خرق للشرط.','كل الحالات الأخرى صادقة.'],
 ['أي قضية تكافئ p→q؟',['q→p','¬p→¬q','¬q→¬p','p∧¬q'],2,'المعاكس الإيجابي مكافئ للشرط الأصلي.','p→q ≡ ¬q→¬p.'],
 ['هل p→q وq→p متكافئتان دائمًا؟',['نعم','لا'],1,'العكس لا يلزم أن يكون مكافئًا للأصل.','التكافؤ يحتاج سببًا منطقيًا إضافيًا.'],
 ['هل ¬p→¬q هو نفي p→q؟',['نعم','لا'],1,'هذه هي صيغة المعكوس، وليست نفي الشرط.','نفي الشرط = p∧¬q.'],
 ['إذا كانت p→q صادقة وp صادقة، ماذا نستنتج؟',['q صحيحة','q خاطئة','¬q صحيحة','لا يمكن الاستنتاج'],0,'بتحقيق الفرض في شرط صادق تلزم النتيجة.','هذا استدلال مباشر صحيح.'],
 ['إذا كانت p→q صادقة وq خاطئة، ماذا نستنتج عن p؟',['p صحيحة','p خاطئة','لا شيء','p وq صحيحتان'],1,'لو كانت p صحيحة لكان الشرط T→F كاذبًا، لذا p خاطئة.','هذا نمط استدلال من المعاكس.'],
 ];
 for(let r=0;r<5;r++)for(const t of cond)add(t[0],t[1],t[2],t[3],t[4],t[5],r<2?'application':'deep');
 // proof/multiple concept questions
 const proofs=[
 ['في برهان مباشر لإثبات q، ومعطى p→q وp، ما الخطوة الأنسب؟',['نفترض ¬q','نستنتج q من p→q وp','نفترض q','نثبت ¬p'],1,'المعطى p يطابق فرض الشرط، فيلزم q.','البرهان المباشر يبدأ من المعطيات ويتقدم نحو المطلوب.'],
 ['في البرهان غير المباشر لإثبات p، ماذا نفترض عادة؟',['p','¬p','q فقط','p∧q'],1,'نفرض نقيض المطلوب ثم نصل إلى تناقض.','خطأ شائع: افتراض المطلوب بدل نقيضه.'],
 ['أي عبارة تُعد نظرية؟',['عبارة تُقبل دون برهان','تحديد معنى مفهوم','عبارة رياضية تحتاج إلى برهان','رمز لمتغير'],2,'النظرية نتيجة رياضية مثبتة ببرهان.','الخلط بين المسلمة والنظرية.'],
 ['أي عبارة تُعد تعريفًا؟',['عبارة تحتاج برهانًا','تحديد معنى مفهوم رياضي','تجربة عددية واحدة','مثال مضاد'],1,'التعريف يحدد معنى المصطلح بدقة.','اعتبار كل قاعدة نظرية.'],
 ['لإثبات أن ∀x∈A,P(x) كاذبة، ماذا يكفي؟',['إثبات P لعنصر واحد','إيجاد a∈A بحيث ¬P(a)','إثبات ¬P لكل العناصر','لا شيء'],1,'عنصر واحد يخالف القضية الكلية هو مثال مضاد.','محاولة فحص جميع العناصر لإسقاط كلية.'],
 ['إذا كانت P: ∀x∈ℝ,x²+1>0، فما نفيها؟',['∀x∈ℝ,x²+1≤0','∃x∈ℝ,x²+1≤0','∃x∈ℝ,x²+1>0','∀x∈ℝ,x²+1<0'],1,'نفي ∀ يتحول إلى ∃، ونفي > هو ≤.','نفي المسوّر دون نفي العلاقة.'],
 ['للقضية P: ∀x∈ℝ,x²+1>0، ما قيمة ¬P؟',['T','F'],1,'لا يوجد حقيقي مربعه +1 أقل من أو يساوي صفرًا.','نسيان أن P و¬P قيمتهما متعاكسة.'],
 ['للقضية P: ∀x∈ℤ,x²≥x، هل يوجد مثال مضاد؟',['نعم، x=2','نعم، x=−1','لا','نعم، x=0'],2,'عند x=−1: 1≥−1 صحيحة؛ إذن ليس مثالًا مضادًا. لا يوجد مثال مضاد، فالعبارة صحيحة.','اختيار عنصر دون فحص العلاقة كاملة.'],
 ['أي مثال مضاد لـ ∀x∈ℝ,x²>x؟',['x=2','x=0','x=3','x=10'],1,'عند x=0 نحصل على 0²>0 أي 0>0، وهذا خطأ؛ لذلك x=0 مثال مضاد.','المثال المضاد يجب أن يجعل العبارة نفسها خاطئة.'],
 ['ما النفي الصحيح لـ ∃x∈ℕ,x>10؟',['∃x∈ℕ,x≤10','∀x∈ℕ,x≤10','∀x∈ℕ,x>10','¬∀x∈ℕ,x>10'],1,'نفي الوجود يتحول إلى لكل مع نفي العلاقة.','نسيان تغيير ∃ إلى ∀.'],
 ];
 for(let r=0;r<4;r++)for(const t of proofs)add(t[0],t[1],t[2],t[3],t[4],t[5],'deep', 'mc');
 // Add focused variants to exceed 100
 const vars=[
  ['ما نفي x<3؟',['x≤3','x≥3','x>3','x=3'],1,'كل ما ليس أصغر من 3 هو أكبر من أو يساوي 3.','¬(x<3) ≡ x≥3.'],
  ['ما نفي x≥−5؟',['x>−5','x≤−5','x<−5','x≠−5'],1,'نفي ≥ هو <.','¬(x≥a) ≡ x<a.'],
  ['ما نفي x≠2؟',['x=2','x>2','x<2','x≥2'],0,'نفي عدم المساواة هو المساواة.','¬(x≠a) ≡ x=a.'],
  ['أي صيغة تمثل «بعض الأعداد الحقيقية أكبر من 5»؟',['∀x∈ℝ,x>5','∃x∈ℝ,x>5','∃x∈ℝ,x≤5','∀x∈ℝ,x≤5'],1,'«بعض/يوجد» تعني ∃.','اختيار ∀ بسبب كلمة الأعداد.'],
  ['نفي ∀x∈ℝ,x≤4 هو:',['∀x∈ℝ,x>4','∃x∈ℝ,x>4','∃x∈ℝ,x≤4','∀x∈ℝ,x≥4'],1,'نفي ≤ هو >، مع تبديل ∀ إلى ∃.','نفي العلاقة دون تغيير المسوّر.'],
  ['إذا P=F، فقيمة ¬P؟',['T','F'],0,'النفي يعكس قيمة الصواب.','نسيان أن النفي عكس القيمة.'],
  ['إذا p→q و¬q صادقتان، فأي نتيجة صحيحة؟',['p صحيحة','p خاطئة','q صحيحة','لا يمكن معرفة p'],1,'لو p صحيحة مع ¬q لحدث T→F.','الخلط بين هذا والاستدلال العكسي غير الصحيح.'],
  ['ما الصيغة التي تمثل نفي الشرط p→q؟',['¬p∨q','p∧¬q','¬p∧q','q∧¬p'],1,'النفي لا يقلب كل رمز عشوائيًا؛ ينتج p∧¬q.','استخدام ¬p→¬q كنفي.'],
 ];
 for(let r=0;r<4;r++)for(const t of vars)add(t[0],t[1],t[2],t[3],t[4],t[5],r<1?'application':'deep');
 return q;
     }
