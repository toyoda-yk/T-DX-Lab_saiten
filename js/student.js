let exams=[], users=[], currentUser=null, currentExam=null, accessibleExams=[], lastResult=null, currentStudentName='', lastFormSendState=null;
const $=id=>document.getElementById(id);
let qrScanner=null;
async function loadData(){
  const bust=Date.now();
  const [e,u]=await Promise.all([
    fetch(`data/exams.json?v=${bust}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`exams.json: ${r.status}`);return r.json()}),
    fetch(`data/users.json?v=${bust}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`users.json: ${r.status}`);return r.json()})
  ]);
  exams=e.exams||[];
  // v1.5以前の配布用デモ3101だけを除外。本番で再発行済みの3101は残ります。
  users=(u.users||[]).filter(x=>x?.credential?.codeId!=='demo-annual-3101');
}

function show(id){['loginPanel','examListPanel','examPanel','resultPanel'].forEach(x=>$(x).classList.toggle('hidden',x!==id))}
function examStoredStatus(exam){
  const s=String(exam?.status||'').toLowerCase();
  if(['published','unpublished','ended'].includes(s))return s;
  return exam?.published?'published':'unpublished';
}
function parseExamDate(value){if(!value)return null;const t=Date.parse(value);return Number.isFinite(t)?t:null}
function examEffectiveStatus(exam,now=Date.now()){
  const stored=examStoredStatus(exam);
  if(stored!=='published')return stored;
  const start=parseExamDate(exam?.publishWindow?.startAt),end=parseExamDate(exam?.publishWindow?.endAt);
  if(start!==null&&now<start)return 'scheduled';
  if(end!==null&&now>=end)return 'ended';
  return 'published';
}
function formatExamDeadline(exam){
  const t=parseExamDate(exam?.publishWindow?.endAt);if(t===null)return '';
  const d=new Date(t);return new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
}
function eligible(exam,user){
  if(examEffectiveStatus(exam)!=='published')return false;
  const a=exam.access;
  if(!a||a.mode==='all')return true;
  const classes=a.classes||[], students=a.students||[];
  return classes.includes(user.classKey)||students.includes(user.studentCode);
}
async function login(){
  const code=$('studentCode').value.trim(),pass=$('accessCode').value.trim();
  $('loginMsg').className='small muted';$('loginMsg').textContent='最新の公開情報を確認しています…';
  try{await loadData()}catch(e){console.error(e);$('loginMsg').className='error small';$('loginMsg').textContent='最新データの読み込みに失敗しました。通信状態を確認して、もう一度お試しください。';return}

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
  accessibleExams=accessibleExams.filter(e=>eligible(e,currentUser));
  accessibleExams.forEach(e=>{const deadline=formatExamDeadline(e),d=document.createElement('div');d.className='exam-card';d.innerHTML=`<div class="exam-card-topline"><span class="exam-subject-chip"><small>教科</small><strong>${e.subject||'未設定'}</strong></span><span class="exam-public-chip">公開中</span></div><h3>${e.title}</h3><div class="muted small">${e.totalPoints}点満点 / ${e.questions.length}解答欄${deadline?` / <strong>受験期限 ${deadline}</strong>`:''}</div><div class="actions"><button data-id="${e.id}">この試験を開く</button></div>`;d.querySelector('button').onclick=()=>openExam(e.id);root.appendChild(d)});
  if(!accessibleExams.length)root.innerHTML='<div class="notice">現在、あなたに公開されている試験はありません。</div>';
}
function openExam(id){
  currentExam=accessibleExams.find(e=>e.id===id);if(!currentExam)return;
  if(!eligible(currentExam,currentUser)){renderExamList();show('examListPanel');alert('この試験の公開期間は終了しました。');return}
  const linked=!!currentExam.formSubmission;
  $('examTitle').textContent=currentExam.title;$('examSubject').textContent=currentExam.subject;$('questionCount').textContent=currentExam.questions.length;
  $('submitNote').textContent=linked?'提出時に氏名・4桁番号・解答をGoogleフォームへ自動送信します。Googleフォーム連携試験は全解答欄を回答してから提出してください。':'この試験はT-DX Lab内で即時採点します。';
  $('studentIdentityCard').classList.toggle('hidden',!linked);
  $('studentCodeReadonly').value=currentUser?.studentCode||'';
  $('studentName').value=currentStudentName||'';
  lastFormSendState=null;
  const f=$('answerForm');f.innerHTML='';let last='';
  currentExam.questions.forEach(q=>{if(q.section!==last){const s=currentExam.sections.find(x=>x.id===q.section);const h=document.createElement('h3');h.textContent=`${s.name}（${s.points}点）`;h.style.marginTop='28px';f.appendChild(h);last=q.section}
    const div=document.createElement('div');div.className='question';div.innerHTML=`<strong>${q.label}</strong><div class="choices">${q.options.map(o=>`<label class="choice"><input type="radio" name="q${q.id}" value="${o}"><span>${o}</span></label>`).join('')}</div>`;f.appendChild(div);
  });
  f.querySelectorAll('input').forEach(i=>i.addEventListener('change',updateProgress));updateProgress();show('examPanel');window.scrollTo(0,0);
}
function collectAnswers(){const a={};currentExam.questions.forEach(q=>{const x=document.querySelector(`input[name=q${q.id}]:checked`);if(x)a[q.id]=x.value});return a}
function updateProgress(){const n=Object.keys(collectAnswers()).length;$('answeredCount').textContent=n;$('answerProgress').style.width=`${100*n/currentExam.questions.length}%`}
function validFormSubmissionConfig(){
  const f=currentExam?.formSubmission;if(!f)return false;
  return f.provider==='google_forms'&&!!f.actionUrl&&!!f.nameEntry&&!!f.studentCodeEntry&&Array.isArray(f.questionEntries)&&f.questionEntries.length===currentExam.questions.length;
}
function postGoogleForm(actionUrl,fields){
  return new Promise((resolve,reject)=>{
    try{
      if(!navigator.onLine)throw new Error('ネットワークに接続されていません。');
      const frame=document.createElement('iframe');frame.name=`tdx_student_form_${Date.now()}_${Math.random().toString(36).slice(2)}`;frame.style.display='none';frame.setAttribute('aria-hidden','true');document.body.appendChild(frame);
      const form=document.createElement('form');form.method='POST';form.action=actionUrl;form.target=frame.name;form.style.display='none';form.acceptCharset='UTF-8';
      Object.entries(fields).forEach(([k,v])=>{const input=document.createElement('input');input.type='hidden';input.name=k;input.value=String(v??'');form.appendChild(input)});
      [['fvv','1'],['pageHistory','0']].forEach(([k,v])=>{const input=document.createElement('input');input.type='hidden';input.name=k;input.value=v;form.appendChild(input)});
      document.body.appendChild(form);
      let done=false;const finish=()=>{if(done)return;done=true;setTimeout(()=>frame.remove(),150);resolve()};
      frame.onload=()=>finish();HTMLFormElement.prototype.submit.call(form);form.remove();setTimeout(finish,2500);
    }catch(e){reject(e)}
  });
}
async function sendCurrentExamToGoogle(answers,name){
  if(!currentExam.formSubmission)return {sent:false,reason:'not_configured'};
  if(!validFormSubmissionConfig())throw new Error('Googleフォーム連携設定が不完全です。担当の先生に知らせてください。');
  const f=currentExam.formSubmission,fields={};
  fields[f.nameEntry]=name;fields[f.studentCodeEntry]=currentUser.studentCode;
  for(const m of f.questionEntries){fields[m.entry]=answers[m.questionId]??answers[String(m.questionId)]??''}
  await postGoogleForm(f.actionUrl,fields);
  return {sent:true,attemptedAt:new Date().toISOString()};
}
async function submitExam(){
  if(!eligible(currentExam,currentUser)){alert('この試験の公開期間は終了しました。回答は送信できません。');accessibleExams=exams.filter(e=>eligible(e,currentUser));renderExamList();show('examListPanel');return}
  const answers=collectAnswers(),missing=currentExam.questions.length-Object.keys(answers).length,linked=!!currentExam.formSubmission;
  if(linked&&missing){alert(`未回答が${missing}個あります。Googleフォームへ確実に記録するため、すべての解答欄を回答してから提出してください。`);return}
  if(!linked&&missing&&!confirm(`未回答が${missing}個あります。このまま提出しますか？`))return;
  let name='';
  if(linked){name=$('studentName').value.trim();if(!name){alert('氏名を入力してください。');$('studentName').focus();return}currentStudentName=name}
  const btn=$('submitBtn'),old=btn.textContent;btn.disabled=true;btn.textContent=linked?'Googleフォームへ送信中…':'採点中…';
  try{
    if(linked)lastFormSendState=await sendCurrentExamToGoogle(answers,name);else lastFormSendState={sent:false,reason:'not_configured'};
    const result=TDX.scoreExam(currentExam,answers);lastResult=result;renderResult(result,answers);show('resultPanel');window.scrollTo(0,0);
  }catch(e){console.error(e);if(!confirm(`Googleフォームへの送信処理でエラーが発生しました。\n${e.message||''}\n\nGoogleフォームへの記録なしで採点結果だけ表示しますか？`))return;lastFormSendState={sent:false,error:e.message||'送信エラー'};const result=TDX.scoreExam(currentExam,answers);lastResult=result;renderResult(result,answers);show('resultPanel');window.scrollTo(0,0)}finally{btn.disabled=false;btn.textContent=old}
}
function sectionStat(section,r){
  const rows=r.detail.filter(d=>d.q.section===section.id),correct=rows.filter(d=>d.correct).length,total=rows.length;
  return {score:r.sectionScores[section.id]||0,points:section.points||0,correct,total,rate:total?Math.round(correct/total*100):0};
}
function renderResult(r,answers){
  const totalPoints=currentExam.totalPoints||currentExam.sections.reduce((sum,s)=>sum+(Number(s.points)||0),0)||100;
  $('resultTitle').textContent=currentExam.title;$('scoreValue').textContent=r.total;$('scoreDen').textContent=` / ${totalPoints}`;$('resultCode').textContent=currentStudentName?`氏名：${currentStudentName}　｜　4桁番号：${currentUser.studentCode}`:`4桁番号：${currentUser.studentCode}`;
  const sendBox=$('formSendResult');if(currentExam.formSubmission){sendBox.classList.remove('hidden');if(lastFormSendState?.sent){sendBox.className='form-send-result success';sendBox.innerHTML='<strong>✓ Googleフォーム送信</strong><span>回答の送信処理を実行しました。速報PDFには氏名と4桁番号も記載されます。</span>'}else{sendBox.className='form-send-result error';sendBox.innerHTML=`<strong>⚠ Googleフォーム未送信</strong><span>${lastFormSendState?.error||'送信状態を確認できませんでした。'} 担当の先生に知らせてください。</span>`}}else{sendBox.classList.add('hidden');sendBox.innerHTML=''};
  const bars=$('sectionBars');bars.innerHTML='';currentExam.sections.forEach(s=>{const st=sectionStat(s,r);bars.insertAdjacentHTML('beforeend',`<div class="bar-row"><strong>${s.name}</strong><div class="bar"><div style="width:${st.rate}%"></div></div><div>${st.score}/${st.points}点<br><span class="small muted">正答率 ${st.rate}%</span></div></div>`) });
  const body=$('detailBody');body.innerHTML='';r.detail.forEach(d=>{const answer=d.answer||'未回答';let correctText=d.q.answer;if(d.q.type.includes('unordered')&&d.q.groupAnswers)correctText=d.q.groupAnswers.join('・');const earned=d.groupAward??d.earned;body.insertAdjacentHTML('beforeend',`<tr><td>${d.q.label}</td><td>${answer}</td><td>${correctText}</td><td class="${d.correct?'ok':'ng'}">${d.correct?'○':'×'}</td><td>${earned}</td></tr>`) });
}
function buildQuickPdfSheet(r){
  const totalPoints=currentExam.totalPoints||currentExam.sections.reduce((sum,s)=>sum+(Number(s.points)||0),0)||100;
  const overallRate=totalPoints?Math.round(r.total/totalPoints*100):0;
  const sheet=document.createElement('div');sheet.className='pdf-quick-sheet';
  const header=document.createElement('div');header.className='pdf-quick-header';
  header.innerHTML='<div><div class="pdf-brand">T-DX Lab☆問題演習システム</div><div class="pdf-kicker">QUICK RESULT / 速報版</div></div><div class="pdf-a4-badge">1 / 2</div>';
  sheet.appendChild(header);
  const title=document.createElement('h1');title.className='pdf-quick-title';title.textContent=currentExam.title;sheet.appendChild(title);
  const meta=document.createElement('div');meta.className='pdf-quick-meta';
  const metaItems=[['氏名',currentStudentName||'-'],['教科',currentExam.subject||'-'],['4桁番号',currentUser.studentCode],['実施日',new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())]];
  metaItems.forEach(([k,v])=>{const box=document.createElement('div');const key=document.createElement('span');key.textContent=k;const val=document.createElement('strong');val.textContent=v;box.append(key,val);meta.appendChild(box)});sheet.appendChild(meta);
  const score=document.createElement('div');score.className='pdf-quick-score';
  const scoreMain=document.createElement('div');scoreMain.className='pdf-score-main';scoreMain.innerHTML=`<span>${r.total}</span><small> / ${totalPoints} 点</small>`;
  const scoreRate=document.createElement('div');scoreRate.className='pdf-score-rate';scoreRate.innerHTML=`<strong>${overallRate}%</strong><span>得点率</span>`;
  score.append(scoreMain,scoreRate);sheet.appendChild(score);
  const sectionTitle=document.createElement('div');sectionTitle.className='pdf-section-title';sectionTitle.innerHTML='<span>SECTION PERFORMANCE</span><h2>大問別の得点・正答率</h2>';sheet.appendChild(sectionTitle);
  const grid=document.createElement('div');grid.className='pdf-section-grid';
  currentExam.sections.forEach(s=>{const st=sectionStat(s,r);const card=document.createElement('div');card.className='pdf-section-card';card.innerHTML=`<div class="pdf-section-card-top"><strong></strong><span>${st.score} / ${st.points}点</span></div><div class="pdf-rate-line"><div><i style="width:${st.rate}%"></i></div><b>${st.rate}%</b></div><div class="pdf-correct-count">正答 ${st.correct} / ${st.total}</div>`;card.querySelector('strong').textContent=s.name;grid.appendChild(card)});sheet.appendChild(grid);
  const note=document.createElement('div');note.className='pdf-quick-note';note.innerHTML='<strong>速報版</strong><span>このPDFは提出直後の採点結果です。クラス平均・全体分布などの集計結果は含みません。</span>';sheet.appendChild(note);
  const footer=document.createElement('div');footer.className='pdf-quick-footer';footer.textContent='T-DX Lab - 学びを、データで次の一問へ。';sheet.appendChild(footer);
  return sheet;
}
function buildQuestionPdfSheet(r){
  const sheet=document.createElement('div');sheet.className='pdf-question-sheet';
  const header=document.createElement('div');header.className='pdf-quick-header';
  header.innerHTML='<div><div class="pdf-brand">T-DX Lab☆問題演習システム</div><div class="pdf-kicker">QUESTION CHECK / 設問別結果</div></div><div class="pdf-a4-badge">2 / 2</div>';
  sheet.appendChild(header);
  const title=document.createElement('h1');title.className='pdf-question-title';title.textContent=currentExam.title;sheet.appendChild(title);
  const correctCount=r.detail.filter(d=>d.correct).length;
  const wrongCount=r.detail.length-correctCount;
  const summary=document.createElement('div');summary.className='pdf-question-summary';
  summary.innerHTML=`<div class="name"><span>氏名</span><strong>${currentStudentName||'-'}</strong></div><div><span>4桁番号</span><strong>${currentUser.studentCode}</strong></div><div class="good"><span>○ 正解</span><strong>${correctCount}</strong></div><div class="bad"><span>× 不正解</span><strong>${wrongCount}</strong></div><div><span>解答欄</span><strong>${r.detail.length}</strong></div>`;
  sheet.appendChild(summary);
  const note=document.createElement('div');note.className='pdf-question-note';note.textContent='各解答欄の判定を一覧で確認できます。完答問題は、グループ全体が正解した場合に○となります。';sheet.appendChild(note);
  const columnCount=r.detail.length>72?3:2;
  const grid=document.createElement('div');grid.className=`pdf-question-grid ${columnCount===3?'three-cols':'two-cols'}`;
  const perCol=Math.ceil(r.detail.length/columnCount);
  for(let c=0;c<columnCount;c++){
    const rows=r.detail.slice(c*perCol,(c+1)*perCol);
    if(!rows.length)continue;
    const table=document.createElement('table');table.className='pdf-question-table';
    table.innerHTML='<thead><tr><th>設問</th><th>判定</th></tr></thead><tbody></tbody>';
    const body=table.querySelector('tbody');
    rows.forEach(d=>{
      const tr=document.createElement('tr');
      const label=document.createElement('td');label.className='pdf-question-label';label.textContent=d.q.label;
      const mark=document.createElement('td');mark.className=`pdf-question-mark ${d.correct?'ok':'ng'}`;mark.textContent=d.correct?'○':'×';
      tr.append(label,mark);body.appendChild(tr);
    });
    grid.appendChild(table);
  }
  sheet.appendChild(grid);
  const footer=document.createElement('div');footer.className='pdf-quick-footer';footer.textContent='T-DX Lab - 学びを、データで次の一問へ。';sheet.appendChild(footer);
  return sheet;
}
async function capturePdfSheet(sheet){
  document.body.appendChild(sheet);
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const canvas=await html2canvas(sheet,{scale:2,backgroundColor:'#ffffff',useCORS:true,logging:false,scrollX:0,scrollY:0});
  sheet.remove();
  return canvas;
}
function addCanvasToPdfPage(doc,canvas){
  const pageW=210,pageH=297,margin=8,maxW=pageW-margin*2,maxH=pageH-margin*2,ratio=canvas.width/canvas.height;
  let w=maxW,h=w/ratio;if(h>maxH){h=maxH;w=h*ratio}
  const x=(pageW-w)/2,y=(pageH-h)/2;
  doc.addImage(canvas.toDataURL('image/jpeg',0.94),'JPEG',x,y,w,h,undefined,'FAST');
}
async function pdf(){
  if(!lastResult||!currentExam||!currentUser)return;
  const btn=$('pdfBtn'),old=btn.textContent;btn.disabled=true;btn.textContent='PDF作成中…';
  const name=`${currentExam.subject}_${currentExam.title}_${currentUser.studentCode}_速報版.pdf`.replace(/[\\/:*?"<>|]/g,'_');
  try{
    if(!window.html2canvas||!window.jspdf?.jsPDF)throw new Error('PDFライブラリを読み込めませんでした。');
    const first=await capturePdfSheet(buildQuickPdfSheet(lastResult));
    const second=await capturePdfSheet(buildQuestionPdfSheet(lastResult));
    const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
    addCanvasToPdfPage(doc,first);
    doc.addPage('a4','portrait');
    addCanvasToPdfPage(doc,second);
    doc.save(name);
  }catch(e){console.error(e);document.querySelectorAll('.pdf-quick-sheet,.pdf-question-sheet').forEach(x=>x.remove());alert(`PDFを作成できませんでした。${e.message||''}`)}finally{btn.disabled=false;btn.textContent=old}
}
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
$('loginBtn').onclick=login;$('logoutBtn').onclick=()=>{currentUser=null;currentExam=null;currentStudentName='';lastFormSendState=null;accessibleExams=[];$('studentName').value='';show('loginPanel')};$('backBtn').onclick=()=>show('examListPanel');$('resultBackBtn').onclick=()=>show('examListPanel');$('submitBtn').onclick=submitExam;$('pdfBtn').onclick=pdf;
$('qrLoginBtn').onclick=openQrScanner;$('qrCloseBtn').onclick=closeQrScanner;
loadData().catch(e=>{$('loginMsg').className='error small';$('loginMsg').textContent='データ読み込みに失敗しました。GitHub PagesまたはローカルWebサーバーで開いてください。'});
