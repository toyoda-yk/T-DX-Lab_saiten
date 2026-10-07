let exams=[], users=[], currentUser=null, currentExam=null, accessibleExams=[];
const $=id=>document.getElementById(id);
let qrScanner=null;
async function loadData(){
  const [e,u]=await Promise.all([fetch('data/exams.json').then(r=>r.json()),fetch('data/users.json').then(r=>r.json())]);
  exams=e.exams||[];users=u.users||[];
}
function show(id){['loginPanel','examListPanel','examPanel','resultPanel'].forEach(x=>$(x).classList.toggle('hidden',x!==id))}
function eligible(exam,user){
  if(!exam.published)return false;
  const a=exam.access;
  if(!a||a.mode==='all')return true;
  const classes=a.classes||[], students=a.students||[];
  return classes.includes(user.classKey)||students.includes(user.studentCode);
}
async function login(){
  const code=$('studentCode').value.trim(),pass=$('accessCode').value.trim();
  if(!/^\d{4}$/.test(code)){ $('loginMsg').className='error small';$('loginMsg').textContent='4桁の数字を入力してください。';return;}
  const rec=users.find(u=>u.studentCode===code);
  if(!rec){$('loginMsg').className='error small';$('loginMsg').textContent='この番号は登録されていません。';return;}
  let verified=false, legacyMatched=[];
  if(rec.credential){
    verified=await TDX.verify(pass,rec.credential);
  }else if(rec.salt&&rec.hash){
    verified=await TDX.verify(pass,rec); // 旧版互換
  }else if(rec.examCredentials){
    for(const e of exams.filter(e=>eligible(e,rec))){
      const v=rec.examCredentials?.[e.id];if(v&&await TDX.verify(pass,v))legacyMatched.push(e);
    }
    verified=legacyMatched.length>0;
  }
  if(!verified){$('loginMsg').className='error small';$('loginMsg').textContent='4桁番号または年間アクセスキーが違います。';return;}
  currentUser=rec;
  accessibleExams=rec.credential||rec.salt?exams.filter(e=>eligible(e,rec)):legacyMatched;
  $('who').textContent=`ログイン中：${code}`;renderExamList();show('examListPanel');
}
function renderExamList(){
  const root=$('examList');root.innerHTML='';
  accessibleExams.forEach(e=>{const d=document.createElement('div');d.className='exam-card';d.innerHTML=`<span class="badge">${e.subject}</span><h3>${e.title}</h3><div class="muted small">${e.totalPoints}点満点 / ${e.questions.length}解答欄</div><div class="actions"><button data-id="${e.id}">この試験を開く</button></div>`;d.querySelector('button').onclick=()=>openExam(e.id);root.appendChild(d)});
  if(!accessibleExams.length)root.innerHTML='<div class="notice">現在、あなたに公開されている試験はありません。</div>';
}
function openExam(id){
  currentExam=accessibleExams.find(e=>e.id===id);if(!currentExam)return;
  $('examTitle').textContent=currentExam.title;$('examSubject').textContent=currentExam.subject;$('questionCount').textContent=currentExam.questions.length;$('submitNote').textContent=currentExam.formSubmission?'提出時にGoogleフォームへも自動送信します。':'現在は即時採点のみ動作します。Googleフォーム自動送信は次工程で接続します。';
  const f=$('answerForm');f.innerHTML='';let last='';
  currentExam.questions.forEach(q=>{if(q.section!==last){const s=currentExam.sections.find(x=>x.id===q.section);const h=document.createElement('h3');h.textContent=`${s.name}（${s.points}点）`;h.style.marginTop='28px';f.appendChild(h);last=q.section}
    const div=document.createElement('div');div.className='question';div.innerHTML=`<strong>${q.label}</strong><div class="choices">${q.options.map(o=>`<label class="choice"><input type="radio" name="q${q.id}" value="${o}"><span>${o}</span></label>`).join('')}</div>`;f.appendChild(div);
  });
  f.querySelectorAll('input').forEach(i=>i.addEventListener('change',updateProgress));updateProgress();show('examPanel');window.scrollTo(0,0);
}
function collectAnswers(){const a={};currentExam.questions.forEach(q=>{const x=document.querySelector(`input[name=q${q.id}]:checked`);if(x)a[q.id]=x.value});return a}
function updateProgress(){const n=Object.keys(collectAnswers()).length;$('answeredCount').textContent=n;$('answerProgress').style.width=`${100*n/currentExam.questions.length}%`}
function submitExam(){const answers=collectAnswers(),missing=currentExam.questions.length-Object.keys(answers).length;if(missing&&!confirm(`未回答が${missing}個あります。このまま提出しますか？`))return;const result=TDX.scoreExam(currentExam,answers);renderResult(result,answers);show('resultPanel');window.scrollTo(0,0)}
function renderResult(r,answers){
  $('resultTitle').textContent=currentExam.title;$('scoreValue').textContent=r.total;$('resultCode').textContent=`4桁番号：${currentUser.studentCode}`;
  const bars=$('sectionBars');bars.innerHTML='';currentExam.sections.forEach(s=>{const sc=r.sectionScores[s.id]||0,pct=Math.round(sc/s.points*100);bars.insertAdjacentHTML('beforeend',`<div class="bar-row"><strong>${s.name}</strong><div class="bar"><div style="width:${pct}%"></div></div><div>${sc}/${s.points}<br><span class="small muted">${pct}%</span></div></div>`) });
  const body=$('detailBody');body.innerHTML='';r.detail.forEach(d=>{const answer=d.answer||'未回答';let correctText=d.q.answer;if(d.q.type.includes('unordered')&&d.q.groupAnswers)correctText=d.q.groupAnswers.join('・');const earned=d.groupAward??d.earned;body.insertAdjacentHTML('beforeend',`<tr><td>${d.q.label}</td><td>${answer}</td><td>${correctText}</td><td class="${d.correct?'ok':'ng'}">${d.correct?'○':'×'}</td><td>${earned}</td></tr>`) });
}
async function pdf(){const el=$('resultSheet'),name=`${currentExam.subject}_${currentExam.title}_${currentUser.studentCode}.pdf`.replace(/[\\/:*?"<>|]/g,'_');if(window.html2pdf){await html2pdf().set({margin:8,filename:name,image:{type:'jpeg',quality:.96},html2canvas:{scale:1.5},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'},pagebreak:{mode:['css','legacy']}}).from(el).save();}else window.print()}
function parseQrPayload(text){
  const m=String(text||'').trim().match(/^TDX\|(\d{4})\|([A-Z0-9-]{10,})$/i);if(!m)return null;return {studentCode:m[1],accessCode:m[2].toUpperCase()};
}
async function openQrScanner(){
  const modal=$('qrModal');modal.classList.remove('hidden');$('qrScanMsg').textContent='カメラへのアクセスを許可してください。';
  if(!window.Html5Qrcode){$('qrScanMsg').textContent='QR読取ライブラリを読み込めませんでした。アクセスキーを手入力してください。';return}
  try{
    qrScanner=new Html5Qrcode('qrReader');
    await qrScanner.start({facingMode:'environment'},{fps:10,qrbox:{width:240,height:240}},async decoded=>{
      const p=parseQrPayload(decoded);if(!p){$('qrScanMsg').textContent='T-DX LabのQRコードではありません。';return}
      $('studentCode').value=p.studentCode;$('accessCode').value=p.accessCode;$('qrScanMsg').textContent='QRコードを読み取りました。';
      await closeQrScanner();setTimeout(login,120);
    },()=>{});
  }catch(e){console.error(e);$('qrScanMsg').textContent='カメラを起動できませんでした。ブラウザのカメラ権限を確認するか、アクセスキーを手入力してください。'}
}
async function closeQrScanner(){
  if(qrScanner){try{await qrScanner.stop()}catch(e){} try{await qrScanner.clear()}catch(e){} qrScanner=null}
  $('qrModal').classList.add('hidden');
}
$('loginBtn').onclick=login;$('logoutBtn').onclick=()=>{currentUser=null;accessibleExams=[];show('loginPanel')};$('backBtn').onclick=()=>show('examListPanel');$('resultBackBtn').onclick=()=>show('examListPanel');$('submitBtn').onclick=submitExam;$('pdfBtn').onclick=pdf;
$('qrLoginBtn').onclick=openQrScanner;$('qrCloseBtn').onclick=closeQrScanner;
loadData().catch(e=>{$('loginMsg').className='error small';$('loginMsg').textContent='データ読み込みに失敗しました。GitHub PagesまたはローカルWebサーバーで開いてください。'});
