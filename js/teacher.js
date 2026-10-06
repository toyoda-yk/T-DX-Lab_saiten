const $=id=>document.getElementById(id);
const ADMIN_HASH='e2ea9a3d893fb0d7a17736517404642f30fbca2154f95a1cda68839b4fb5b1a7'; // T-DXLab9999 のSHA-256
let exams=[],usersData={version:4,users:[],issuedCodeIds:[]},analysisRows=[],analysisExam=null,allExamData=null;
let publishRoster=[],publishSecrets=[];
let editorRows=[];
let rosterRanges=[];

async function init(){
  [allExamData,usersData]=await Promise.all([
    fetch('data/exams.json').then(r=>r.json()),
    fetch('data/users.json').then(r=>r.json()).catch(()=>({version:3,users:[],issuedCodeIds:[]}))
  ]);
  exams=allExamData.exams||[];
  usersData.users=usersData.users||[];
  usersData.issuedCodeIds=usersData.issuedCodeIds||[];
  usersData.users.forEach(u=>{u.classKey=u.classKey||String(u.studentCode||'').slice(0,2);u.examCredentials=u.examCredentials||{}});
  rosterRanges=compressRosterRanges(usersData.users.map(u=>u.studentCode));
  if(!rosterRanges.length) rosterRanges=[{start:'3101',end:'3130'}];
  refreshExamSelects();
  bind();
  renderRosterRanges();
  renderRosterSummary();
  loadPublishExam();
}
function refreshExamSelects(){
  const opts=exams.map(e=>`<option value="${e.id}">${e.title}</option>`).join('');
  ['analysisExam','publishExamSelect'].forEach(id=>{if($(id)) $(id).innerHTML=opts});
}
function bind(){
  $('adminLoginBtn').onclick=adminLogin;
  $('adminPass').addEventListener('keydown',e=>{if(e.key==='Enter')adminLogin()});
  $('adminLogoutBtn').onclick=()=>{$('adminApp').classList.add('hidden');$('adminGate').classList.remove('hidden');$('adminPass').value='';window.scrollTo({top:0,behavior:'smooth'})};
  document.querySelectorAll('.menuBtn').forEach(b=>b.onclick=()=>showSection(b.dataset.target));

  $('addRosterRangeBtn').onclick=()=>{rosterRanges.push({start:'',end:''});renderRosterRanges()};
  $('saveRosterBtn').onclick=saveRoster;
  $('exportRosterUsersBtn').onclick=exportUserData;

  $('readPdfBtn').onclick=readPdf;
  $('reparseTextBtn').onclick=()=>analyzePdfText($('pdfText').value);
  $('addQuestionRowBtn').onclick=()=>addEditorRow();
  $('applyDefaultOptionsBtn').onclick=applyDefaultOptions;
  $('checkPointsBtn').onclick=checkPoints;
  $('saveDraftExamBtn').onclick=saveDraft;
  $('registerExamBtn').onclick=registerExam;

  $('analyzeBtn').onclick=analyzeFile;
  $('classFilter').onchange=renderAnalysis;

  $('publishExamSelect').onchange=loadPublishExam;
  $('selectAllAudienceBtn').onclick=()=>setAllAudience(true);
  $('clearAudienceBtn').onclick=()=>setAllAudience(false);
  $('applyPublishBtn').onclick=applyPublish;
  $('generateAudienceCodesBtn').onclick=generateAudienceCodes;
  $('exportExamDataBtn').onclick=exportExamData;
  $('exportUserDataBtn').onclick=exportUserData;
  $('exportPublishSecretsBtn').onclick=exportPublishSecrets;
  $('printPublishSlipsBtn').onclick=printSlips;
  window.addEventListener('afterprint',()=>document.body.classList.remove('printing-slips'));
}
async function adminLogin(){
  const h=await TDX.sha256Hex($('adminPass').value);
  if(h!==ADMIN_HASH){$('adminMsg').className='error small';$('adminMsg').textContent='管理用パスワードが違います。';return}
  $('adminGate').classList.add('hidden');
  $('adminApp').classList.remove('hidden');
  $('adminMsg').textContent='';
  showSection('studentManager');
  requestAnimationFrame(()=>$('adminApp').scrollIntoView({behavior:'smooth',block:'start'}));
}
function showSection(id){
  document.querySelectorAll('.adminSection').forEach(x=>x.classList.toggle('hidden',x.id!==id));
  document.querySelectorAll('.menuBtn').forEach(x=>x.classList.toggle('active-look',x.dataset.target===id));
  if(id==='studentManager')renderRosterSummary();
  if(id==='publishManager')loadPublishExam();
  requestAnimationFrame(()=>document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'}));
}
function getOrCreateUser(studentCode,digits=2){
  let u=usersData.users.find(x=>x.studentCode===studentCode);
  if(!u){u={studentCode,classKey:studentCode.slice(0,digits),examCredentials:{}};usersData.users.push(u)}
  u.classKey=studentCode.slice(0,digits);u.examCredentials=u.examCredentials||{};return u
}
function compressRosterRanges(codes){
  const nums=[...new Set((codes||[]).filter(x=>/^\d{4}$/.test(String(x))).map(Number))].sort((a,b)=>a-b);
  const out=[];let start=null,prev=null;
  for(const n of nums){
    if(start===null){start=prev=n;continue}
    const sameClass=String(n).padStart(4,'0').slice(0,2)===String(prev).padStart(4,'0').slice(0,2);
    if(n===prev+1&&sameClass){prev=n;continue}
    out.push({start:String(start).padStart(4,'0'),end:String(prev).padStart(4,'0')});start=prev=n;
  }
  if(start!==null)out.push({start:String(start).padStart(4,'0'),end:String(prev).padStart(4,'0')});
  return out;
}
function renderRosterRanges(){
  const root=$('rosterRangeRows');if(!root)return;
  root.innerHTML=rosterRanges.map((r,i)=>`<div class="roster-range-row" data-range="${i}">
    <div class="roster-class-pill">${r.start&&/^\d{4}$/.test(r.start)?esc(r.start.slice(0,2)):'--'}組</div>
    <label>最初の4桁<input data-range-k="start" inputmode="numeric" maxlength="4" value="${esc(r.start)}" placeholder="3101"></label>
    <span class="range-arrow">→</span>
    <label>最後の4桁<input data-range-k="end" inputmode="numeric" maxlength="4" value="${esc(r.end)}" placeholder="3138"></label>
    <button type="button" class="row-delete" data-range-del="${i}" title="削除">×</button>
  </div>`).join('');
  root.querySelectorAll('[data-range-k]').forEach(el=>el.addEventListener('input',e=>{
    const row=e.target.closest('[data-range]'),i=Number(row.dataset.range),k=e.target.dataset.rangeK;
    rosterRanges[i][k]=e.target.value.replace(/\D/g,'').slice(0,4);
    if(k==='start')row.querySelector('.roster-class-pill').textContent=(rosterRanges[i].start.length===4?rosterRanges[i].start.slice(0,2):'--')+'組';
  }));
  root.querySelectorAll('[data-range-del]').forEach(b=>b.onclick=()=>{rosterRanges.splice(Number(b.dataset.rangeDel),1);if(!rosterRanges.length)rosterRanges.push({start:'',end:''});renderRosterRanges()});
}
function codesFromRosterRanges(){
  const codes=[];
  for(const [i,r] of rosterRanges.entries()){
    if(!/^\d{4}$/.test(r.start)||!/^\d{4}$/.test(r.end))throw new Error(`クラス範囲${i+1}の4桁番号を確認してください。`);
    if(r.start.slice(0,2)!==r.end.slice(0,2))throw new Error(`${r.start} ～ ${r.end} は同じクラス（先頭2桁）で指定してください。`);
    const a=Number(r.start),b=Number(r.end);if(a>b)throw new Error(`${r.start} ～ ${r.end} の順序を確認してください。`);
    if(b-a>99)throw new Error(`${r.start} ～ ${r.end} の範囲が広すぎます。`);
    for(let n=a;n<=b;n++)codes.push(String(n).padStart(4,'0'));
  }
  return [...new Set(codes)].sort();
}
function saveRoster(){
  try{
    const codes=codesFromRosterRanges(),old=new Map(usersData.users.map(u=>[u.studentCode,u]));
    usersData.users=codes.map(code=>{const u=old.get(code)||{studentCode:code,classKey:code.slice(0,2),examCredentials:{}};u.classKey=code.slice(0,2);u.examCredentials=u.examCredentials||{};return u});
    localStorage.setItem('tdxRosterRanges',JSON.stringify(rosterRanges));
    $('rosterMsg').className='success small';$('rosterMsg').textContent=`${codes.length}人を名簿に登録しました。年度をまたいで残す場合は users.json を書き出してGitHubの data/ に反映してください。`;
    renderRosterSummary();loadPublishExam();
  }catch(e){$('rosterMsg').className='error small';$('rosterMsg').textContent=e.message}
}
function renderRosterSummary(){
  if(!$('rosterSummary'))return;
  const groups={};usersData.users.forEach(u=>{const c=u.classKey||u.studentCode.slice(0,2);(groups[c]??=[]).push(u.studentCode)});
  const entries=Object.entries(groups).sort(([a],[b])=>a.localeCompare(b));
  $('rosterSummary').innerHTML=`<div class="kpi"><div class="muted small">登録生徒</div><div class="value">${usersData.users.length}</div></div><div class="kpi"><div class="muted small">クラス</div><div class="value">${entries.length}</div></div>`;
  $('rosterPreview').innerHTML=entries.length?entries.map(([c,list])=>`<div class="roster-class-preview"><strong>${c}組</strong><span>${list.length}人</span><small>${list[0]} ～ ${list[list.length-1]}</small></div>`).join(''):'<div class="notice small">まだ生徒名簿が登録されていません。</div>';
}
async function candidateCollides(pretty){
  const fp=await TDX.sha256Hex(pretty);
  if(usersData.issuedCodeIds.includes(fp)) return true;
  for(const u of usersData.users){for(const rec of Object.values(u.examCredentials||{})){if(rec.codeId===fp)return true;if(!rec.codeId&&rec.salt&&rec.hash&&await TDX.verify(pretty,rec))return true}}
  return false;
}
async function createUniqueAccessCode(){
  for(let tries=0;tries<100;tries++){
    const raw=TDX.randomCode(12),pretty=`${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8)}`;
    if(!(await candidateCollides(pretty))){const codeId=await TDX.sha256Hex(pretty);usersData.issuedCodeIds.push(codeId);return {pretty,codeId}}
  }
  throw new Error('一意なログインコードを生成できませんでした。');
}
async function generateForExam(examId,codes){
  const secrets=[];
  for(const studentCode of codes){
    const {pretty,codeId}=await createUniqueAccessCode(),v=await TDX.makeVerifier(pretty),u=getOrCreateUser(studentCode,2);
    u.examCredentials[examId]={salt:v.salt,hash:v.hash,codeId};
    secrets.push({examId,studentCode,accessCode:pretty,classKey:u.classKey});
  }
  return secrets;
}
function renderSlips(secrets,exam){
  $('slips').innerHTML=secrets.map((x,i)=>`<section class="slip">
    <div class="slip-brand"><strong>T-DX Lab☆問題演習システム</strong><span>${esc(exam?.subject||'')}</span></div>
    <h2>${esc(exam?.title||'')}</h2>
    <p class="slip-note">この試験専用のログイン票です。ほかの人に見せないでください。</p>
    <div class="slip-credentials"><div><span>4桁番号</span><strong>${x.studentCode}</strong></div><div><span>専用ログインコード</span><strong class="code">${x.accessCode}</strong></div></div>
    <p class="small">このコードは上記試験でのみ使用できます。</p>
    ${i%2===0?'<div class="cutline">✂</div>':''}
  </section>`).join('')
}
function printSlips(){document.body.classList.add('printing-slips');requestAnimationFrame(()=>window.print())}

// ===== PDF → editable exam draft =====
function toHalfWidth(s){return String(s||'').replace(/[０-９]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0xFEE0)).replace(/：/g,':').replace(/，/g,',').replace(/＝/g,'=')}
function extractPageLines(items){
  const pts=items.filter(x=>x.str&&x.str.trim()).map(x=>({str:x.str.trim(),x:x.transform?.[4]||0,y:x.transform?.[5]||0}));
  pts.sort((a,b)=>Math.abs(b.y-a.y)>2?b.y-a.y:a.x-b.x);
  const lines=[];
  for(const p of pts){let line=lines.find(l=>Math.abs(l.y-p.y)<2.2);if(!line){line={y:p.y,parts:[]};lines.push(line)}line.parts.push(p)}
  lines.sort((a,b)=>b.y-a.y);
  return lines.map(l=>l.parts.sort((a,b)=>a.x-b.x).map(p=>p.str).join(' '));
}
async function readPdf(){
  const f=$('answerPdf').files[0];if(!f){alert('PDFを選択してください。');return}
  try{
    const buf=await f.arrayBuffer(),pdfjs=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs';
    const pdf=await pdfjs.getDocument({data:buf}).promise;let pages=[];
    for(let p=1;p<=pdf.numPages;p++){const page=await pdf.getPage(p),tc=await page.getTextContent();pages.push(`--- page ${p} ---\n${extractPageLines(tc.items).join('\n')}`)}
    const text=pages.join('\n');$('pdfText').value=text;analyzePdfText(text);
  }catch(e){console.error(e);alert('PDF読み取りに失敗しました。文字として保存されたPDFか、ネットワーク環境を確認してください。')}
}
function deriveSection(label,current='第1問'){
  const m=label.match(/第\s*(\d+)\s*問\s*([A-DＡ-Ｄ]?)/);if(!m)return current;
  return `第${m[1]}問${m[2]?m[2].replace('Ａ','A').replace('Ｂ','B').replace('Ｃ','C').replace('Ｄ','D'):''}`;
}
function lastKana(label){const m=label.match(/([ア-ン])(?:\s*[（(]|\s*$)/);return m?m[1]:''}
function parseExamText(raw){
  const text=toHalfWidth(raw),lines=text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!/^--- page/.test(x));
  const rows=[];let currentSection='第1問';
  const seen=new Set();
  for(let i=0;i<lines.length;i++){
    const line=lines[i].replace(/\s+/g,' ');
    const sec=line.match(/第\s*(\d+)\s*問\s*([A-D]?)/);if(sec)currentSection=`第${sec[1]}問${sec[2]||''}`;
    let label='',answer='',confidence='要確認';
    const explicit=line.match(/^(.{1,80}?(?:第\s*\d+\s*問[A-D]?\s*)?(?:問\s*\d+\s*)?[ア-ンA-Za-z])\s*(?:正答|答|解答)\s*[:=]?\s*([0-9]+)\b/);
    const colon=line.match(/^(.{1,80}?(?:第\s*\d+\s*問[A-D]?\s*)?(?:問\s*\d+\s*)?[ア-ンA-Za-z])\s*[:=]\s*([0-9]+)\b/);
    const sameLine=line.match(/^((?:第\s*\d+\s*問[A-D]?\s*)+(?:問\s*\d+\s*)?[ア-ン])(?:\s*[（(][^）)]*[）)])?\s+([0-9]+)\s*$/);
    const m=explicit||colon||sameLine;
    if(m){label=m[1].replace(/\s+/g,' ').trim();answer=m[2];confidence=explicit?'高':'要確認'}
    if(!label)continue;
    const section=deriveSection(label,currentSection),key=`${section}|${label}|${answer}`;if(seen.has(key))continue;seen.add(key);
    const low=line.includes('順不同'),complete=line.includes('完答');
    rows.push({section,label,answer,points:'',type:complete?'complete_item':low?'unordered_item':'normal',group:'',groupPoints:'',options:'',confidence,sourceLine:line});
  }
  // 「Xと順不同」の組を自動グループ化
  rows.forEach((r,idx)=>{const m=r.sourceLine.match(/([ア-ン])\s*と\s*順不同/);if(!m)return;const a=lastKana(r.label),b=m[1];if(!a)return;const g=`u_${r.section.replace(/\W/g,'')}_${[a,b].sort().join('')}`;r.type='unordered_item';r.group=g;rows.forEach(x=>{if(x.section===r.section&&[a,b].includes(lastKana(x.label))){x.type='unordered_item';x.group=g}})});
  // 「ア、イ、ウは完答」のような記述を探して同一大問内へ適用
  for(const line of lines){const m=line.match(/([ア-ン](?:\s*[,、]\s*[ア-ン])+).*?完答/);if(!m)continue;const letters=m[1].match(/[ア-ン]/g)||[];if(letters.length<2)continue;const sm=line.match(/第\s*(\d+)\s*問\s*([A-D]?)/),section=sm?`第${sm[1]}問${sm[2]||''}`:null;const g=`c_${(section||'sec').replace(/\W/g,'')}_${letters.join('')}`;rows.forEach(x=>{if((!section||x.section===section)&&letters.includes(lastKana(x.label))){x.type='complete_item';x.group=g}})}
  return rows;
}
function analyzePdfText(text){
  editorRows=parseExamText(text);
  if(!editorRows.length) editorRows=[blankEditorRow()];
  $('examReviewPanel').classList.remove('hidden');renderEditor();
  $('examReviewPanel').scrollIntoView({behavior:'smooth',block:'start'});
}
function blankEditorRow(){return {section:'第1問',label:'',answer:'',points:'',type:'normal',group:'',groupPoints:'',options:'',confidence:'要確認',sourceLine:''}}
function addEditorRow(row=blankEditorRow()){editorRows.push({...row});renderEditor();setTimeout(()=>$('examEditorCards')?.lastElementChild?.scrollIntoView({behavior:'smooth',block:'center'}),0)}
function typeOptions(value){return [['normal','通常'],['unordered_item','順不同（各欄採点）'],['complete_item','完答'],['unordered_complete_item','順不同＋完答']].map(([v,t])=>`<option value="${v}" ${v===value?'selected':''}>${t}</option>`).join('')}
function reviewDisplayOptions(r){
  const explicit=String(r.options||'').split(/[,、\s]+/).map(x=>x.trim()).filter(Boolean);
  if(explicit.length)return {options:explicit,inferred:false};
  const n=Number(r.answer);if(Number.isInteger(n)&&n>=0&&n<=12)return {options:Array.from({length:Math.max(4,n+1)},(_,i)=>String(i)),inferred:true};
  return {options:[],inferred:true};
}
function renderEditor(){
  const root=$('examEditorCards');if(!root)return;
  let html='',lastSection='';
  editorRows.forEach((r,i)=>{
    if(r.section!==lastSection){html+=`<div class="review-section-heading"><span class="section-eyebrow">SECTION</span><h3>${esc(r.section||'大問未設定')}</h3></div>`;lastSection=r.section}
    const od=reviewDisplayOptions(r),choices=od.options.map(o=>`<button type="button" class="review-choice ${String(r.answer)===String(o)?'is-answer':''}" data-answer-row="${i}" data-answer="${esc(o)}">${esc(o)}</button>`).join('');
    html+=`<article class="review-question-card ${r.confidence==='要確認'?'needs-review':''}" data-row="${i}">
      <div class="review-question-top">
        <span class="review-number">${i+1}</span>
        <div class="review-question-title">
          <input class="review-label-input" data-k="label" value="${esc(r.label)}" placeholder="設問名">
          <div class="review-meta-line"><span class="review-status ${r.confidence==='高'?'ok-status':'warn-status'}">${r.confidence}</span><span>${esc(r.type==='normal'?'通常':r.type.includes('unordered')?'順不同':'完答')}</span>${od.inferred?'<span class="inferred-tag">選択肢は仮表示</span>':''}</div>
        </div>
        <button class="row-delete" data-del="${i}" type="button">×</button>
      </div>
      <div class="review-answer-zone">
        <div class="review-answer-caption">読み取った正答 <strong>${esc(r.answer||'未設定')}</strong></div>
        ${choices?`<div class="choices review-choices">${choices}</div>`:'<div class="notice small">選択肢を認識できていません。下の「詳細設定」で選択肢を入力してください。</div>'}
      </div>
      <details class="review-detail-settings">
        <summary>詳細設定を確認・修正</summary>
        <div class="review-detail-grid">
          <label>大問<input data-k="section" value="${esc(r.section)}"></label>
          <label>正答<input data-k="answer" value="${esc(r.answer)}"></label>
          <label>配点<input data-k="points" type="number" min="0" step="0.5" value="${esc(r.points)}"></label>
          <label>採点方式<select data-k="type">${typeOptions(r.type)}</select></label>
          <label>グループ<input data-k="group" value="${esc(r.group)}" placeholder="例：A"></label>
          <label>グループ配点<input data-k="groupPoints" type="number" min="0" step="0.5" value="${esc(r.groupPoints)}"></label>
          <label class="review-options-field">選択肢<input data-k="options" value="${esc(r.options)}" placeholder="0,1,2,3"></label>
        </div>
      </details>
    </article>`;
  });
  root.innerHTML=html||'<div class="notice">設問がありません。</div>';
  root.querySelectorAll('[data-k]').forEach(el=>el.addEventListener('change',e=>{
    const card=e.target.closest('[data-row]'),i=Number(card.dataset.row),k=e.target.dataset.k;
    editorRows[i][k]=e.target.value;editorRows[i].confidence='確認済';
    if(['section','answer','options','type'].includes(k))renderEditor();else updateParseSummary();
  }));
  root.querySelectorAll('[data-answer-row]').forEach(b=>b.onclick=()=>{
    const i=Number(b.dataset.answerRow);editorRows[i].answer=b.dataset.answer;editorRows[i].confidence='確認済';renderEditor();
  });
  root.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{editorRows.splice(Number(b.dataset.del),1);renderEditor()});
  updateParseSummary();
}
function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function updateParseSummary(){
  const n=editorRows.length,uncertain=editorRows.filter(r=>r.confidence==='要確認').length,special=editorRows.filter(r=>r.type!=='normal').length,sections=new Set(editorRows.map(r=>r.section).filter(Boolean)).size;
  $('parseSummary').innerHTML=`<div class="kpi"><div class="muted small">認識設問</div><div class="value">${n}</div></div><div class="kpi"><div class="muted small">大問</div><div class="value">${sections}</div></div><div class="kpi"><div class="muted small">特殊採点</div><div class="value">${special}</div></div><div class="kpi ${uncertain?'kpi-warn':''}"><div class="muted small">要確認</div><div class="value">${uncertain}</div></div>`;
}
function applyDefaultOptions(){const v=$('defaultOptions').value.trim();editorRows.forEach(r=>{if(!r.options)r.options=v});renderEditor()}
function rowPointTotal(rows=editorRows){
  let total=0,seen=new Set();
  for(const r of rows){if(['complete_item','unordered_complete_item'].includes(r.type)){const g=r.group||`__row_${rows.indexOf(r)}`;if(seen.has(g))continue;seen.add(g);total+=Number(r.groupPoints||0)}else total+=Number(r.points||0)}
  return total;
}
function checkPoints(){const total=rowPointTotal(),target=Number($('examTotalPoints').value)||100,ok=Math.abs(total-target)<0.0001;$('pointsCheckMsg').className=(ok?'success':'error')+' small';$('pointsCheckMsg').textContent=`現在の合計配点：${total}点 / 設定した満点：${target}点${ok?' ✓':'　※配点を確認してください。'}`;return ok}
function makeExamId(){let id;do{id=`exam_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${TDX.randomCode(6).toLowerCase()}`}while(exams.some(e=>e.id===id));return id}
function buildExamFromEditor(){
  const title=$('examName').value.trim(),subject=$('examSubjectInput').value.trim(),googleFormUrl=$('formUrl').value.trim(),target=Number($('examTotalPoints').value)||100;
  if(!title||!subject)throw new Error('試験名と教科を入力してください。');if(!editorRows.length)throw new Error('設問がありません。');
  const rows=editorRows.map(r=>({...r,section:r.section.trim(),label:r.label.trim(),answer:String(r.answer).trim(),points:Number(r.points||0),group:r.group.trim(),groupPoints:Number(r.groupPoints||0),options:r.options.split(/[,、\s]+/).map(x=>x.trim()).filter(Boolean)}));
  if(rows.some(r=>!r.section||!r.label||r.answer===''))throw new Error('大問・設問名・正答の空欄を確認してください。');
  const sectionNames=[...new Set(rows.map(r=>r.section))],sectionMap=new Map(sectionNames.map((n,i)=>[n,`s${i+1}`]));
  const questions=rows.map((r,i)=>({id:i+1,section:sectionMap.get(r.section),label:r.label,answer:r.answer,points:r.type==='complete_item'||r.type==='unordered_complete_item'?0:r.points,options:r.options.length?r.options:['0','1','2','3'],type:r.type,...(r.group?{group:r.group}:{}),...(['complete_item','unordered_complete_item'].includes(r.type)?{groupPoints:r.groupPoints}:{})}));
  const groups={};questions.forEach(q=>{if(q.group)(groups[q.group]??=[]).push(q)});Object.values(groups).forEach(gs=>{if(gs[0]?.type==='unordered_complete_item'){const answers=gs.map(q=>String(q.answer));gs.forEach(q=>q.groupAnswers=answers)}});
  const sections=sectionNames.map(name=>{const id=sectionMap.get(name),qs=questions.filter(q=>q.section===id);let points=0,seen=new Set();qs.forEach(q=>{if(['complete_item','unordered_complete_item'].includes(q.type)){if(!seen.has(q.group)){seen.add(q.group);points+=Number(q.groupPoints||0)}}else points+=Number(q.points||0)});return {id,name,points}});
  return {id:makeExamId(),title,subject,schoolYear:String(new Date().getFullYear()),published:false,totalPoints:target,googleFormUrl,formSubmission:null,access:{mode:'restricted',classes:[],students:[]},sections,questions,createdAt:new Date().toISOString()};
}
function saveDraft(){
  try{const draft={title:$('examName').value.trim(),subject:$('examSubjectInput').value.trim(),totalPoints:$('examTotalPoints').value,googleFormUrl:$('formUrl').value.trim(),pdfText:$('pdfText').value,editorRows,createdAt:new Date().toISOString()};localStorage.setItem('tdxDraftExam',JSON.stringify(draft));$('draftExamMsg').className='success small';$('draftExamMsg').textContent='編集内容をこのブラウザに保存しました。'}catch(e){$('draftExamMsg').className='error small';$('draftExamMsg').textContent=e.message}
}
function registerExam(){
  try{
    const exam=buildExamFromEditor(),total=rowPointTotal();if(Math.abs(total-exam.totalPoints)>0.0001&&!confirm(`合計配点は${total}点、満点設定は${exam.totalPoints}点です。このまま登録しますか？`))return;
    exams.push(exam);allExamData.exams=exams;refreshExamSelects();
    $('draftExamMsg').className='success small';$('draftExamMsg').innerHTML=`非公開で登録しました：<strong>${exam.title}</strong><br>試験ID：<code>${exam.id}</code><br>「公開管理」で受験者を選択してから公開してください。`;
    $('publishExamSelect').value=exam.id;loadPublishExam();
  }catch(e){$('draftExamMsg').className='error small';$('draftExamMsg').textContent=e.message}
}

async function readRows(file){if(/\.csv$/i.test(file.name)){return TDX.csvParse(await file.text())}const buf=await file.arrayBuffer(),wb=XLSX.read(buf,{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]];return XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:''})}
async function analyzeFile(){const f=$('responseFile').files[0];if(!f){alert('CSVまたはXLSXを選択してください。');return}analysisExam=exams.find(e=>e.id===$('analysisExam').value);const rows=await readRows(f);if(rows.length<2){alert('回答データが見つかりません。');return}const qCount=analysisExam.questions.length;analysisRows=[];for(const r of rows.slice(1)){const code=String(r[2]||'').trim();if(!/^\d{4}$/.test(code))continue;const ansVals=r.slice(r.length-qCount),answers={};analysisExam.questions.forEach((q,i)=>answers[q.id]=String(ansVals[i]??'').trim());const score=TDX.scoreExam(analysisExam,answers);analysisRows.push({code,classKey:code.slice(0,Number($('classDigits').value)||2),answers,score})}if(!analysisRows.length){alert('4桁番号を含む回答行を認識できませんでした。');return}const classes=[...new Set(analysisRows.map(r=>r.classKey))].sort();$('classFilter').innerHTML='<option value="ALL">全クラス</option>'+classes.map(c=>`<option value="${c}">${c}</option>`).join('');$('analysisOutput').classList.remove('hidden');renderAnalysis()}
function renderAnalysis(){if(!analysisRows.length)return;const key=$('classFilter').value,rows=key==='ALL'?analysisRows:analysisRows.filter(r=>r.classKey===key),scores=rows.map(r=>r.score.total),avg=scores.reduce((a,b)=>a+b,0)/scores.length,max=Math.max(...scores),min=Math.min(...scores);$('analysisKpis').innerHTML=`<div class="kpi"><div class="muted small">回答者</div><div class="value">${rows.length}</div></div><div class="kpi"><div class="muted small">平均点</div><div class="value">${avg.toFixed(1)}</div></div><div class="kpi"><div class="muted small">最高点</div><div class="value">${max}</div></div><div class="kpi"><div class="muted small">最低点</div><div class="value">${min}</div></div>`;renderHistogram(scores);renderSections(rows);renderQuestionRates(rows)}
function renderHistogram(scores){const bins=Array(10).fill(0);scores.forEach(s=>bins[Math.min(9,Math.floor(s/10))]++);const m=Math.max(...bins,1);$('histogram').innerHTML=bins.map((n,i)=>`<div class="col"><div class="stick" style="height:${Math.max(2,n/m*180)}px" title="${n}人"></div><div class="lab">${i*10}-${i===9?100:i*10+9}<br>${n}人</div></div>`).join('')}
function renderSections(rows){$('sectionAnalysis').innerHTML=analysisExam.sections.map(s=>{const sum=rows.reduce((a,r)=>a+(r.score.sectionScores[s.id]||0),0),pct=sum/(rows.length*s.points)*100;return `<div class="bar-row"><strong>${s.name}</strong><div class="bar"><div style="width:${pct.toFixed(1)}%"></div></div><div>${pct.toFixed(1)}%</div></div>`}).join('')}
function renderQuestionRates(rows){const body=$('questionRates');body.innerHTML='';analysisExam.questions.forEach(q=>{let ok=0;rows.forEach(r=>{const d=r.score.detail.find(x=>x.q.id===q.id);if(d&&d.correct)ok++});const pct=ok/rows.length*100;body.insertAdjacentHTML('beforeend',`<tr><td>${q.label}</td><td>${pct.toFixed(1)}%</td><td>${ok}/${rows.length}</td></tr>`)})}
function loadPublishExam(){
  const exam=exams.find(e=>e.id===$('publishExamSelect')?.value)||exams[0];
  if(!exam){
    if($('audienceBuilder'))$('audienceBuilder').innerHTML='<div class="notice">先にSTEP 1で試験を登録してください。</div>';
    return;
  }
  $('publishExamSelect').value=exam.id;$('publishToggle').checked=!!exam.published;
  buildAudience();renderRegisteredRosterSummary();
  requestAnimationFrame(()=>applyExistingAudience(exam));
}
function renderRegisteredRosterSummary(){
  if(!$('registeredRosterSummary'))return;
  const groups={};usersData.users.forEach(u=>{const c=u.classKey||u.studentCode.slice(0,2);(groups[c]??=[]).push(u.studentCode)});
  const entries=Object.entries(groups).sort(([a],[b])=>a.localeCompare(b));
  $('registeredRosterSummary').innerHTML=entries.length
    ? entries.map(([c,list])=>`<div><strong>${c}組：${list.length}人</strong><small>${list[0]} ～ ${list[list.length-1]}</small></div>`).join('')
    : '<div><strong>名簿未登録</strong><small>STEP 0で生徒名簿を登録してください。</small></div>';
}
function buildAudience(){
  const vals=usersData.users.map(u=>u.studentCode).filter(x=>/^\d{4}$/.test(x)).sort();publishRoster=vals;
  const groups={};vals.forEach(code=>{const c=code.slice(0,2);(groups[c]??=[]).push(code)});
  $('audienceBuilder').innerHTML=Object.entries(groups).sort().map(([c,list])=>`<div class="audience-class">
    <label class="audience-class-head"><input type="checkbox" class="class-check" data-class="${c}"><span><strong>${c}</strong> クラス全員</span><small>${list.length}人</small></label>
    <div class="audience-students">${list.map(code=>`<label><input type="checkbox" class="student-check" data-class="${c}" value="${code}"><span>${code}</span></label>`).join('')}</div>
  </div>`).join('')||'<div class="notice">STEP 0で生徒名簿を登録してください。</div>';
  document.querySelectorAll('.class-check').forEach(cb=>cb.onchange=()=>{document.querySelectorAll(`.student-check[data-class="${cb.dataset.class}"]`).forEach(x=>x.checked=cb.checked)});
  document.querySelectorAll('.student-check').forEach(cb=>cb.onchange=syncClassChecks);
}
function syncClassChecks(){document.querySelectorAll('.class-check').forEach(c=>{const xs=[...document.querySelectorAll(`.student-check[data-class="${c.dataset.class}"]`)];c.checked=xs.length&&xs.every(x=>x.checked);c.indeterminate=xs.some(x=>x.checked)&&!c.checked})}
function setAllAudience(flag){document.querySelectorAll('#audienceBuilder input[type=checkbox]').forEach(x=>{x.checked=flag;x.indeterminate=false})}
function applyExistingAudience(exam){
  const a=exam.access;if(!a||a.mode==='all'){setAllAudience(true);return}
  document.querySelectorAll('.student-check').forEach(x=>x.checked=(a.students||[]).includes(x.value)||(a.classes||[]).includes(x.dataset.class));syncClassChecks();
}
function collectAudience(){
  const classes=[],students=[];
  document.querySelectorAll('.audience-class').forEach(box=>{const cc=box.querySelector('.class-check'),ss=[...box.querySelectorAll('.student-check')];if(cc.checked)classes.push(cc.dataset.class);else ss.filter(x=>x.checked).forEach(x=>students.push(x.value))});
  return {classes,students}
}
function applyPublish(){
  const exam=exams.find(e=>e.id===$('publishExamSelect').value);if(!exam)return;
  const selected=selectedAudienceCodes();if($('publishToggle').checked&&!selected.length){alert('公開する場合は受験対象生徒を選択してください。');return}
  const a=collectAudience();exam.published=$('publishToggle').checked;exam.access={mode:'restricted',classes:a.classes,students:a.students};
  $('publishMsg').className='success small';$('publishMsg').textContent=`設定を反映しました：${exam.published?'公開':'非公開'} / 対象 ${selected.length}人。exams.jsonを書き出してGitHubへ反映してください。`;
}
function selectedAudienceCodes(){return [...document.querySelectorAll('.student-check:checked')].map(x=>x.value)}
async function generateAudienceCodes(){
  const exam=exams.find(e=>e.id===$('publishExamSelect').value),codes=selectedAudienceCodes();if(!exam)return;
  if(!codes.length){alert('受験対象生徒を選択してください。');return}
  publishSecrets=await generateForExam(exam.id,codes);
  $('exportPublishSecretsBtn').disabled=false;$('printPublishSlipsBtn').disabled=false;
  $('publishGeneratedPreview').innerHTML=`<h3>${esc(exam.title)}：対象者 ${codes.length}人の試験専用コード</h3><table><thead><tr><th>4桁番号</th><th>ログインコード</th><th>クラス</th></tr></thead><tbody>${publishSecrets.slice(0,20).map(x=>`<tr><td>${x.studentCode}</td><td><code>${x.accessCode}</code></td><td>${x.classKey}</td></tr>`).join('')}</tbody></table>${codes.length>20?`<p class="small muted">ほか ${codes.length-20}人</p>`:''}`;
  renderSlips(publishSecrets,exam);
  $('publishMsg').className='success small';$('publishMsg').textContent='対象者の試験専用ログインコードを生成しました。users.json・教員保管CSV・A4ログイン票を保存してください。';
}
function exportExamData(){TDX.download('exams.json',JSON.stringify(allExamData,null,2))}
function exportUserData(){TDX.download('users.json',JSON.stringify({version:4,note:'STEP 0で登録した生徒名簿と試験ごとの認証情報。平文ログインコードは含みません。issuedCodeIds は再発行時の重複防止用です。',issuedCodeIds:usersData.issuedCodeIds,users:usersData.users},null,2))}
function exportPublishSecrets(){const exam=exams.find(e=>e.id===$('publishExamSelect').value),csv='試験,4桁番号,ログインコード,クラス\n'+publishSecrets.map(x=>`"${exam?.title||''}",${x.studentCode},${x.accessCode},${x.classKey}`).join('\n');TDX.download(`T-DX_Lab_${exam?.title||'試験'}_ログインコード.csv`.replace(/[\\/:*?"<>|]/g,'_'),'\ufeff'+csv,'text/csv;charset=utf-8')}
init().catch(console.error);
