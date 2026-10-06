let exams=[], users=[], currentUser=null, currentExam=null;
const $=id=>document.getElementById(id);
async function loadData(){
  const [e,u]=await Promise.all([fetch('data/exams.json').then(r=>r.json()),fetch('data/users.json').then(r=>r.json())]);
  exams=e.exams||[];users=u.users||[];
}
function show(id){['loginPanel','examListPanel','examPanel','resultPanel'].forEach(x=>$(x).classList.toggle('hidden',x!==id))}
async function login(){
  const code=$('studentCode').value.trim(),pass=$('accessCode').value.trim();
  if(!/^\d{4}$/.test(code)){ $('loginMsg').className='error small';$('loginMsg').textContent='4桁の数字を入力してください。';return;}
  const rec=users.find(u=>u.studentCode===code);
  if(!rec){$('loginMsg').className='error small';$('loginMsg').textContent='この番号は登録されていません。';return;}
  if(!(await TDX.verify(pass,rec))){$('loginMsg').className='error small';$('loginMsg').textContent='ログインコードが違います。';return;}
  currentUser=rec;$('who').textContent=`ログイン中：${code}`;renderExamList();show('examListPanel');
}
function renderExamList(){
  const root=$('examList');root.innerHTML='';
  exams.filter(e=>e.published).forEach(e=>{const d=document.createElement('div');d.className='exam-card';d.innerHTML=`<span class="badge">${e.subject}</span><h3>${e.title}</h3><div class="muted small">${e.totalPoints}点満点 / ${e.questions.length}解答欄</div><div class="actions"><button data-id="${e.id}">この試験を開く</button></div>`;d.querySelector('button').onclick=()=>openExam(e.id);root.appendChild(d)});
}
function openExam(id){
  currentExam=exams.find(e=>e.id===id);$('examTitle').textContent=currentExam.title;$('examSubject').textContent=currentExam.subject;$('questionCount').textContent=currentExam.questions.length;$('submitNote').textContent=currentExam.formSubmission?'提出時にGoogleフォームへも自動送信します。':'試作版：Googleフォーム自動送信設定は未接続です。採点機能は動作します。';
  const f=$('answerForm');f.innerHTML='';let last='';
  currentExam.questions.forEach(q=>{if(q.section!==last){const s=currentExam.sections.find(x=>x.id===q.section);const h=document.createElement('h3');h.textContent=`${s.name}（${s.points}点）`;h.style.marginTop='28px';f.appendChild(h);last=q.section}
    const div=document.createElement('div');div.className='question';div.innerHTML=`<strong>${q.label}</strong><div class="choices">${q.options.map(o=>`<label class="choice"><input type="radio" name="q${q.id}" value="${o}"><span>${o}</span></label>`).join('')}</div>`;f.appendChild(div);
  });
  f.querySelectorAll('input').forEach(i=>i.addEventListener('change',updateProgress));updateProgress();show('examPanel');window.scrollTo(0,0);
}
function collectAnswers(){const a={};currentExam.questions.forEach(q=>{const x=document.querySelector(`input[name=q${q.id}]:checked`);if(x)a[q.id]=x.value});return a}
function updateProgress(){const n=Object.keys(collectAnswers()).length;$('answeredCount').textContent=n;$('answerProgress').style.width=`${100*n/currentExam.questions.length}%`}
function submitExam(){
  const answers=collectAnswers(),missing=currentExam.questions.length-Object.keys(answers).length;
  if(missing && !confirm(`未回答が${missing}個あります。このまま提出しますか？`))return;
  const result=TDX.scoreExam(currentExam,answers);renderResult(result,answers);show('resultPanel');window.scrollTo(0,0);
}
function renderResult(r,answers){
  $('resultTitle').textContent=currentExam.title;$('scoreValue').textContent=r.total;$('resultCode').textContent=`4桁番号：${currentUser.studentCode}`;
  const bars=$('sectionBars');bars.innerHTML='';currentExam.sections.forEach(s=>{const sc=r.sectionScores[s.id]||0,pct=Math.round(sc/s.points*100);bars.insertAdjacentHTML('beforeend',`<div class="bar-row"><strong>${s.name}</strong><div class="bar"><div style="width:${pct}%"></div></div><div>${sc}/${s.points}<br><span class="small muted">${pct}%</span></div></div>`)});
  const body=$('detailBody');body.innerHTML='';r.detail.forEach(d=>{const answer=d.answer||'未回答';let correctText=d.q.answer; if(d.q.type.includes('unordered')&&d.q.groupAnswers)correctText=d.q.groupAnswers.join('・'); const earned=d.groupAward??d.earned;body.insertAdjacentHTML('beforeend',`<tr><td>${d.q.label}</td><td>${answer}</td><td>${correctText}</td><td class="${d.correct?'ok':'ng'}">${d.correct?'○':'×'}</td><td>${earned}</td></tr>`)});
}
async function pdf(){
  const el=$('resultSheet'),name=`${currentExam.subject}_${currentExam.title}_${currentUser.studentCode}.pdf`.replace(/[\\/:*?"<>|]/g,'_');
  if(window.html2pdf){await html2pdf().set({margin:8,filename:name,image:{type:'jpeg',quality:.96},html2canvas:{scale:1.5},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'},pagebreak:{mode:['css','legacy']}}).from(el).save();} else window.print();
}
$('loginBtn').onclick=login;$('logoutBtn').onclick=()=>{currentUser=null;show('loginPanel')};$('backBtn').onclick=()=>show('examListPanel');$('resultBackBtn').onclick=()=>show('examListPanel');$('submitBtn').onclick=submitExam;$('pdfBtn').onclick=pdf;
loadData().catch(e=>{$('loginMsg').className='error small';$('loginMsg').textContent='データ読み込みに失敗しました。GitHub PagesまたはローカルWebサーバーで開いてください。'});
