const $=id=>document.getElementById(id);
const TEACHER_PASSWORD='T-DXLab9999'; // 静的GitHub Pagesのため誤操作防止用の簡易ロック
const SYSTEM_ADMIN_PASSWORD='9999'; // システム管理者用の簡易ロック
const QR_VAULT_STORAGE='tdxQrReprintVaultV1';
let exams=[],usersData={version:6,users:[],issuedCodeIds:[]},analysisRows=[],analysisExam=null,allExamData=null;
let publishRoster=[],annualSecrets=[],accessVault=[];
let editorRows=[];
let editorSectionTargets={};
let rosterRanges=[];
let googleFormSetup={entries:[],viewUrl:'',actionUrl:'',testAttempted:false};
let previewMode='before';
let systemAdminUnlocked=false;
let teacherSessionPassword='';
let startupDataWarning='';
window.addEventListener('tdx-teacher-login-inline',e=>{teacherSessionPassword=String(e?.detail?.password||'').trim();});

function examStoredStatus(exam){
  const s=String(exam?.status||'').toLowerCase();
  if(['published','unpublished','ended'].includes(s))return s;
  return exam?.published?'published':'unpublished';
}
function parseExamDate(value){
  if(!value)return null;
  const t=Date.parse(value);return Number.isFinite(t)?t:null;
}
function examEffectiveStatus(exam,now=Date.now()){
  const stored=examStoredStatus(exam);
  if(stored==='unpublished')return 'unpublished';
  if(stored==='ended')return 'ended';
  const start=parseExamDate(exam?.publishWindow?.startAt);
  const end=parseExamDate(exam?.publishWindow?.endAt);
  if(start!==null&&now<start)return 'scheduled';
  if(end!==null&&now>=end)return 'ended_auto';
  return 'published';
}
function examStatusLabel(exam){return ({published:'公開中',scheduled:'公開予定',unpublished:'非公開',ended:'終了',ended_auto:'終了（自動）'})[examEffectiveStatus(exam)]||'非公開'}
function examStatusClass(exam){return ({published:'live',scheduled:'scheduled',unpublished:'off',ended:'ended',ended_auto:'ended'})[examEffectiveStatus(exam)]||'off'}
function formatLocalDateTime(value){
  const t=parseExamDate(value);if(t===null)return '';
  return new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t));
}
function toDatetimeLocal(value){
  const t=parseExamDate(value);if(t===null)return '';
  const d=new Date(t),pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function scheduleSummary(exam){
  if(examStoredStatus(exam)!=='published')return '';
  const s=formatLocalDateTime(exam?.publishWindow?.startAt),e=formatLocalDateTime(exam?.publishWindow?.endAt);
  if(s&&e)return `${s} ～ ${e}`;
  if(s)return `${s} から`;
  if(e)return `${e} まで`;
  return '期間指定なし（旧データ）';
}

async function loadCachedAccessVault(){
  let rows=[];
  try{rows=JSON.parse(localStorage.getItem(QR_VAULT_STORAGE)||'[]')}catch(_){rows=[]}
  if(!Array.isArray(rows)||!rows.length){accessVault=[];return}
  const valid=[];
  for(const row of rows){
    const code=String(row?.studentCode||'');
    const u=usersData.users.find(x=>x.studentCode===code);
    if(!u?.credential||!row?.accessCode)continue;
    try{if(await TDX.verify(String(row.accessCode).toUpperCase(),u.credential))valid.push({studentCode:code,accessCode:String(row.accessCode).toUpperCase(),classKey:String(row.classKey||code.slice(0,2))})}catch(_){/* ignore stale cache */}
  }
  accessVault=valid.sort((a,b)=>a.studentCode.localeCompare(b.studentCode));
  try{localStorage.setItem(QR_VAULT_STORAGE,JSON.stringify(accessVault))}catch(_){}
}
function persistAccessVault(){
  try{localStorage.setItem(QR_VAULT_STORAGE,JSON.stringify(accessVault))}catch(_){}
}
function setAccessMessage(text,type='muted'){
  const el=$('qrMsg')||$('rosterMsg');if(!el)return;
  el.className=(type==='success'?'success':type==='error'?'error':type==='notice'?'notice':'muted')+' small';
  el.textContent=text;
}
function updateSystemAdminUi(){
  const tools=$('qrAdminTools');if(tools)tools.classList.toggle('hidden',!systemAdminUnlocked);
  const btn=$('systemAdminBtn');if(btn)btn.textContent=systemAdminUnlocked?'管理者メニューを開く':'システム管理者';
}
async function init(){
  // ログイン操作はデータ読込より先に有効化する。
  // data/*.json の一時的な読込失敗や古いデータ形式の不整合があっても、
  // 教員ログイン自体が無反応にならないようにする。
  bind();

  try{
    const r=await fetch(`data/exams.json?v=${Date.now()}`,{cache:'no-store'});
    if(!r.ok)throw new Error(`exams.json: HTTP ${r.status}`);
    allExamData=await r.json();
  }catch(e){
    console.error(e);
    allExamData={version:5,systemName:'T-DX Lab☆問題演習システム',exams:[]};
    startupDataWarning='exams.jsonを読み込めませんでした。GitHubのdata/exams.jsonを確認してください。';
  }
  try{
    const r=await fetch(`data/users.json?v=${Date.now()}`,{cache:'no-store'});
    if(!r.ok)throw new Error(`users.json: HTTP ${r.status}`);
    usersData=await r.json();
  }catch(e){
    console.error(e);
    usersData={version:6,users:[],issuedCodeIds:[]};
    startupDataWarning+=(startupDataWarning?'\n':'')+'users.jsonを読み込めませんでした。GitHubのdata/users.jsonを確認してください。';
  }
  exams=allExamData.exams||[];
  exams.forEach(e=>{e.status=examStoredStatus(e);e.published=e.status==='published'});
  usersData.users=(usersData.users||[]).filter(u=>u?.credential?.codeId!=='demo-annual-3101');
  usersData.issuedCodeIds=usersData.issuedCodeIds||[];
  usersData.users.forEach(u=>{u.classKey=u.classKey||String(u.studentCode||'').slice(0,2);u.examCredentials=u.examCredentials||{};u.credential=u.credential||null;u.qrSecret=u.qrSecret||null});
  await loadCachedAccessVault();
  rosterRanges=compressRosterRanges(usersData.users.map(u=>u.studentCode));
  if(!rosterRanges.length) rosterRanges=[{start:'3101',end:'3130'}];
  refreshExamSelects();
  initChoiceRangeControls();
  renderRosterRanges();
  renderRosterSummary();
  renderAdminStudentList();
  renderAccessVaultManager();
  updateSystemAdminUi();
  loadPublishExam();
  renderExamExportSummary();
}

function refreshExamSelects(preferredPublishId=''){
  const opts=exams.map(e=>`<option value="${e.id}">${esc(e.title)}</option>`).join('');
  if($('analysisExam'))$('analysisExam').innerHTML=opts;
  refreshPublishSelectors(preferredPublishId);
}
function refreshPublishSelectors(preferredExamId=''){
  if(!$('publishSubjectSelect')||!$('publishExamSelect'))return;
  const subjects=[...new Set(exams.map(e=>String(e.subject||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ja'));
  const preferredExam=exams.find(e=>e.id===preferredExamId);
  let subject=preferredExam?.subject||$('publishSubjectSelect').value||subjects[0]||'';
  if(subject&&!subjects.includes(subject))subject=subjects[0]||'';
  $('publishSubjectSelect').innerHTML=subjects.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
  if(subject)$('publishSubjectSelect').value=subject;
  const filtered=exams.filter(e=>String(e.subject||'')===subject);
  $('publishExamSelect').innerHTML=filtered.map(e=>`<option value="${e.id}">${esc(e.title)}【${examStatusLabel(e)}】</option>`).join('');
  let examId=preferredExam&&preferredExam.subject===subject?preferredExam.id:$('publishExamSelect').value;
  if(!filtered.some(e=>e.id===examId))examId=filtered[0]?.id||'';
  if(examId)$('publishExamSelect').value=examId;
}
function bind(){
  if(!window.__TDX_INLINE_LOGIN_BOUND__){
    $('adminLoginBtn').onclick=adminLogin;
    $('adminPass').addEventListener('keydown',e=>{if(e.key==='Enter')adminLogin()});
  }
  $('adminLogoutBtn').onclick=()=>{systemAdminUnlocked=false;teacherSessionPassword='';updateSystemAdminUi();$('systemAdminGate')?.classList.add('hidden');$('adminApp').classList.add('hidden');$('adminGate').classList.remove('hidden');$('adminPass').value='';window.scrollTo({top:0,behavior:'smooth'})};
  document.querySelectorAll('.menuBtn').forEach(b=>b.onclick=()=>showSection(b.dataset.target));
  $('systemAdminBtn').onclick=()=>{if(systemAdminUnlocked){showSection('studentManager');return}$('systemAdminGate').classList.toggle('hidden');if(!$('systemAdminGate').classList.contains('hidden'))$('systemAdminPass').focus()};
  $('systemAdminCancelBtn').onclick=()=>{$('systemAdminGate').classList.add('hidden');$('systemAdminPass').value='';$('systemAdminMsg').textContent=''};
  $('systemAdminLoginBtn').onclick=systemAdminLogin;
  $('systemAdminPass').addEventListener('keydown',e=>{if(e.key==='Enter')systemAdminLogin()});
  $('forceReloadBtn')?.addEventListener('click',()=>{const u=new URL(location.href);u.searchParams.set('refresh',Date.now());location.replace(u.toString())});
  $('addSingleStudentBtn')?.addEventListener('click',addSingleStudent);
  $('adminStudentClassFilter')?.addEventListener('change',renderAdminStudentList);
  $('adminStudentSearch')?.addEventListener('input',renderAdminStudentList);

  $('addRosterRangeBtn').onclick=()=>{rosterRanges.push({start:'',end:''});renderRosterRanges()};
  $('saveRosterBtn').onclick=saveRoster;
  $('generateAnnualCodesBtn').onclick=()=>generateAnnualCodes(false);
  $('regenerateAnnualCodesBtn').onclick=()=>generateAnnualCodes(true);
  $('exportAnnualSecretsBtn').onclick=exportAnnualSecrets;
  $('printAnnualCardsBtn').onclick=printAnnualCards;
  $('printAllAnnualCardsBtn').onclick=printAllAnnualCards;
  $('exportRosterUsersBtn').onclick=exportUserData;
  $('importAnnualSecretsBtn').onclick=()=>$('importAnnualSecretsInput').click();
  $('importAnnualSecretsInput').onchange=importAnnualSecretsCsv;
  $('accessVaultClassFilter').onchange=renderAccessVaultManager;
  $('selectVisibleVaultBtn').onclick=()=>setVisibleVaultSelection(true);
  $('selectMissingVaultBtn').onclick=selectMissingVaultRows;
  $('clearVaultSelectionBtn').onclick=()=>setVisibleVaultSelection(false);
  $('reprintSelectedCardsBtn').onclick=reprintSelectedCards;
  $('reissueSelectedCodesBtn').onclick=reissueSelectedCodes;

  $('readPdfBtn').onclick=readPdf;
  $('parsePastedTextBtn').onclick=()=>analyzeAnswerSource('pasted');
  $('resetExamParseBtn').onclick=resetExamParse;
  $('copyTextTemplateBtn').onclick=copyTextTemplate;
  $('copyAiPromptBtn').onclick=copyAiPrompt;
  $('reparseTextBtn').onclick=()=>analyzeAnswerSource($('answerTextInput').value.trim()?'pasted':'pdf');
  $('addQuestionRowBtn').onclick=()=>addEditorRow();
  $('applyDefaultOptionsBtn').onclick=applyDefaultOptions;
  $('checkPointsBtn').onclick=checkPoints;
  $('saveDraftExamBtn').onclick=saveDraft;
  $('registerExamBtn').onclick=registerExam;
  $('analyzeFormLinkBtn').onclick=analyzeGoogleFormLink;
  $('autoMapFormBtn').onclick=autoMapGoogleFormAnswers;
  $('clearFormLinkBtn').onclick=resetGoogleFormLink;
  $('formNameEntrySelect').onchange=()=>{autoMapGoogleFormAnswers(true);renderGoogleFormStatus()};
  $('formCodeEntrySelect').onchange=()=>{autoMapGoogleFormAnswers(true);renderGoogleFormStatus()};
  $('testGoogleFormBtn').onclick=testGoogleFormSubmission;
  $('formTestConfirmed').onchange=renderGoogleFormStatus;

  $('analyzeBtn').onclick=analyzeFile;
  $('classFilter').onchange=renderAnalysis;

  $('publishSubjectSelect').onchange=()=>{refreshPublishSelectors();loadPublishExam()};
  $('publishExamSelect').onchange=loadPublishExam;
  $('publishStatusSelect').onchange=()=>{updatePublishScheduleVisibility();renderExamReadiness(exams.find(e=>e.id===$('publishExamSelect')?.value))};
  $('cloneExamBtn').onclick=cloneCurrentExam;
  $('togglePreviewBtn').onclick=toggleExamPreview;
  $('closePreviewBtn').onclick=()=>{$('examPreviewPanel')?.classList.add('hidden')};
  document.querySelectorAll('.previewModeBtn').forEach(b=>b.onclick=()=>{previewMode=b.dataset.previewMode||'before';renderExamPreview(previewMode)});
  $('deleteExamBtn').onclick=deleteCurrentExam;
  $('selectAllAudienceBtn').onclick=()=>setAllAudience(true);
  $('clearAudienceBtn').onclick=()=>setAllAudience(false);
  $('applyPublishBtn').onclick=applyPublish;
  $('exportExamDataBtn').onclick=exportExamData;
}
async function adminLogin(){
  // 教員ログインはWeb Cryptoの可否に依存させない。
  // GitHub Pages上の簡易ロックなので、入力文字列を直接比較する。
  const entered=String($('adminPass')?.value||'').trim();
  if(entered!==TEACHER_PASSWORD){$('adminMsg').className='error small';$('adminMsg').textContent='教員共通パスワードが違います。';return}
  teacherSessionPassword=entered;
  $('adminGate').classList.add('hidden');
  $('adminApp').classList.remove('hidden');
  $('adminMsg').textContent='';
  showSection('examManager');
  requestAnimationFrame(()=>$('adminApp').scrollIntoView({behavior:'smooth',block:'start'}));
  if(startupDataWarning){
    setTimeout(()=>alert('教員ログインは成功しましたが、データ読込に問題があります。\n\n'+startupDataWarning),50);
  }
}
async function systemAdminLogin(){
  const entered=String($('systemAdminPass')?.value||'');
  if(entered!==SYSTEM_ADMIN_PASSWORD){$('systemAdminMsg').className='error small';$('systemAdminMsg').textContent='システム管理者パスワードが違います。';return}
  systemAdminUnlocked=true;
  $('systemAdminMsg').className='success small';$('systemAdminMsg').textContent='管理者機能を開きました。';
  $('systemAdminPass').value='';$('systemAdminGate').classList.add('hidden');
  updateSystemAdminUi();showSection('studentManager');
}
function showSection(id){
  if(id==='studentManager'&&!systemAdminUnlocked){$('systemAdminGate')?.classList.remove('hidden');$('systemAdminPass')?.focus();return}
  document.querySelectorAll('.adminSection').forEach(x=>x.classList.toggle('hidden',x.id!==id));
  document.querySelectorAll('.menuBtn').forEach(x=>x.classList.toggle('active-look',x.dataset.target===id));
  if(id==='studentManager'){renderRosterSummary();renderAdminStudentList();}
  if(id==='qrManager')renderAccessVaultManager();
  if(id==='publishManager')loadPublishExam();
  requestAnimationFrame(()=>document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'}));
}
function getOrCreateUser(studentCode,digits=2){
  let u=usersData.users.find(x=>x.studentCode===studentCode);
  if(!u){u={studentCode,classKey:studentCode.slice(0,digits),credential:null,qrSecret:null,examCredentials:{}};usersData.users.push(u)}
  u.classKey=studentCode.slice(0,digits);u.examCredentials=u.examCredentials||{};u.credential=u.credential||null;u.qrSecret=u.qrSecret||null;return u
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
    usersData.users=codes.map(code=>{const u=old.get(code)||{studentCode:code,classKey:code.slice(0,2),credential:null,qrSecret:null,examCredentials:{}};u.classKey=code.slice(0,2);u.examCredentials=u.examCredentials||{};u.credential=u.credential||null;u.qrSecret=u.qrSecret||null;return u});
    localStorage.setItem('tdxRosterRanges',JSON.stringify(rosterRanges));
    $('rosterMsg').className='success small';$('rosterMsg').textContent=`${codes.length}人を名簿に登録しました。次に「年間アクセスキーを発行」を実行し、QRカードと users.json を保存してください。`;
    accessVault=accessVault.filter(x=>codes.includes(x.studentCode));
    renderRosterSummary();renderAdminStudentList();renderAccessVaultManager();loadPublishExam();
  }catch(e){$('rosterMsg').className='error small';$('rosterMsg').textContent=e.message}
}
function renderRosterSummary(){
  if(!$('rosterSummary'))return;
  const groups={};usersData.users.forEach(u=>{const c=u.classKey||u.studentCode.slice(0,2);(groups[c]??=[]).push(u.studentCode)});
  const entries=Object.entries(groups).sort(([a],[b])=>a.localeCompare(b));
  const issued=usersData.users.filter(u=>u.credential).length;
  $('rosterSummary').innerHTML=`<div class="kpi"><div class="muted small">登録生徒</div><div class="value">${usersData.users.length}</div></div><div class="kpi"><div class="muted small">クラス</div><div class="value">${entries.length}</div></div><div class="kpi"><div class="muted small">アクセスキー発行済</div><div class="value">${issued}</div></div>`;
  $('rosterPreview').innerHTML=entries.length?entries.map(([c,list])=>`<div class="roster-class-preview"><strong>${c}組</strong><span>${list.length}人</span><small>${list[0]} ～ ${list[list.length-1]}</small></div>`).join(''):'<div class="notice small">まだ生徒名簿が登録されていません。</div>';
}
async 
function refreshAdminStudentClassFilter(){
  const sel=$('adminStudentClassFilter');if(!sel)return;
  const current=sel.value;
  const classes=[...new Set(usersData.users.map(u=>u.classKey||String(u.studentCode||'').slice(0,2)).filter(Boolean))].sort();
  sel.innerHTML='<option value="">全クラス</option>'+classes.map(c=>`<option value="${esc(c)}">${esc(c)}組</option>`).join('');
  if(classes.includes(current))sel.value=current;
}
function renderAdminStudentList(){
  const root=$('adminStudentTable');if(!root)return;
  refreshAdminStudentClassFilter();
  const cls=$('adminStudentClassFilter')?.value||'',q=String($('adminStudentSearch')?.value||'').trim();
  const rows=usersData.users.slice().sort((a,b)=>a.studentCode.localeCompare(b.studentCode)).filter(u=>(!cls||(u.classKey||u.studentCode.slice(0,2))===cls)&&(!q||u.studentCode.includes(q)));
  if(!rows.length){root.innerHTML='<div class="notice small">条件に合う生徒はいません。</div>';return}
  root.innerHTML=`<div class="table-shell"><table><thead><tr><th>4桁番号</th><th>クラス</th><th>アクセス</th><th>QR</th><th>操作</th></tr></thead><tbody>${rows.map(u=>{
    const issued=!!u.credential,direct=userHasDirectQr(u),legacy=!direct&&userHasLegacyQr(u);
    const access=issued?'<span class="master-status ready">✓ 発行済</span>':'<span class="master-status unissued">○ 未発行</span>';
    const qr=!issued?'—':direct?'<span class="master-status ready">✓ 再印刷可</span>':legacy?'<span class="master-status missing">△ 移行待ち</span>':'<span class="master-status missing">△ 旧形式</span>';
    return `<tr><td><strong>${esc(u.studentCode)}</strong></td><td>${esc(u.classKey||u.studentCode.slice(0,2))}組</td><td>${access}</td><td>${qr}</td><td><div class="table-actions"><button class="mini-action edit-student-btn" data-code="${esc(u.studentCode)}" type="button">編集</button><button class="mini-action danger-text delete-student-btn" data-code="${esc(u.studentCode)}" type="button">削除</button></div></td></tr>`
  }).join('')}</tbody></table></div><p class="small muted">${rows.length}人表示中。4桁番号を変更した場合は新しい番号のQRを再印刷してください。</p>`;
  root.querySelectorAll('.edit-student-btn').forEach(b=>b.onclick=()=>editStudent(b.dataset.code));
  root.querySelectorAll('.delete-student-btn').forEach(b=>b.onclick=()=>deleteStudent(b.dataset.code));
}
function syncRosterAfterStudentChange(){
  rosterRanges=compressRosterRanges(usersData.users.map(u=>u.studentCode));
  if(!rosterRanges.length)rosterRanges=[{start:'',end:''}];
  renderRosterRanges();renderRosterSummary();renderAdminStudentList();renderAccessVaultManager();loadPublishExam();
}
function addSingleStudent(){
  if(!systemAdminUnlocked)return;
  const code=String(prompt('追加する生徒の4桁番号を入力してください。','')||'').trim();if(!code)return;
  if(!/^\d{4}$/.test(code)){alert('4桁の数字で入力してください。');return}
  if(usersData.users.some(u=>u.studentCode===code)){alert('その4桁番号はすでに登録されています。');return}
  usersData.users.push({studentCode:code,classKey:code.slice(0,2),credential:null,qrSecret:null,examCredentials:{}});
  usersData.users.sort((a,b)=>a.studentCode.localeCompare(b.studentCode));syncRosterAfterStudentChange();
  const msg=$('usersExportMsg');if(msg){msg.className='notice small';msg.textContent=`${code} を追加しました。アクセスキー発行後、users.jsonをGitHubへ反映してください。`}
}
function editStudent(oldCode){
  if(!systemAdminUnlocked)return;
  const u=usersData.users.find(x=>x.studentCode===oldCode);if(!u)return;
  const next=String(prompt('4桁番号を編集してください。',oldCode)||'').trim();if(!next||next===oldCode)return;
  if(!/^\d{4}$/.test(next)){alert('4桁の数字で入力してください。');return}
  if(usersData.users.some(x=>x.studentCode===next)){alert('その4桁番号はすでに登録されています。');return}
  if(!confirm(`${oldCode} → ${next} に変更します。\n\n現在のアクセスキーは維持しますが、QRに含まれる4桁番号が変わるため、変更後はQRカードを再印刷してください。`))return;
  u.studentCode=next;u.classKey=next.slice(0,2);
  const legacy=accessVault.find(x=>x.studentCode===oldCode);if(legacy){legacy.studentCode=next;legacy.classKey=next.slice(0,2);persistAccessVault()}
  let touched=0;
  exams.forEach(e=>{const arr=e.access?.students;if(Array.isArray(arr)&&arr.includes(oldCode)){e.access.students=[...new Set(arr.map(x=>x===oldCode?next:x))];touched++}});
  usersData.users.sort((a,b)=>a.studentCode.localeCompare(b.studentCode));syncRosterAfterStudentChange();renderExamExportSummary();
  const msg=$('usersExportMsg');if(msg){msg.className='notice small';msg.textContent=`${oldCode} を ${next} に変更しました。users.jsonを更新してください。${touched?` 個別指定されていた試験 ${touched}件もこの画面では更新したため、exams.jsonも書き出してください。`:''}`}
}
function deleteStudent(code){
  if(!systemAdminUnlocked)return;
  const u=usersData.users.find(x=>x.studentCode===code);if(!u)return;
  if(!confirm(`${code} を年度名簿から削除しますか？\n\nアクセスキーとQR再印刷データも削除されます。`))return;
  const typed=prompt('誤操作防止のため「削除」と入力してください。');if(typed!=='削除'){if(typed!==null)alert('入力が一致しないため削除しませんでした。');return}
  usersData.users=usersData.users.filter(x=>x.studentCode!==code);accessVault=accessVault.filter(x=>x.studentCode!==code);persistAccessVault();
  let touched=0;exams.forEach(e=>{if(Array.isArray(e.access?.students)&&e.access.students.includes(code)){e.access.students=e.access.students.filter(x=>x!==code);touched++}});
  syncRosterAfterStudentChange();renderExamExportSummary();
  const msg=$('usersExportMsg');if(msg){msg.className='notice small';msg.textContent=`${code} を削除しました。users.jsonをGitHubへ反映してください。${touched?` 個別指定されていた試験 ${touched}件からも削除したため、exams.jsonも更新してください。`:''}`}
}

async function candidateCollides(pretty){
  const fp=await TDX.sha256Hex(pretty);
  if(usersData.issuedCodeIds.includes(fp)) return true;
  for(const u of usersData.users){
    const rec=u.credential;
    if(rec){if(rec.codeId===fp)return true;if(!rec.codeId&&rec.salt&&rec.hash&&await TDX.verify(pretty,rec))return true}
    for(const legacy of Object.values(u.examCredentials||{})){if(legacy.codeId===fp)return true;if(!legacy.codeId&&legacy.salt&&legacy.hash&&await TDX.verify(pretty,legacy))return true}
  }
  return false;
}
async function createUniqueAccessCode(){
  for(let tries=0;tries<100;tries++){
    const raw=TDX.randomCode(16),pretty=`${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}-${raw.slice(12)}`;
    if(!(await candidateCollides(pretty))){const codeId=await TDX.sha256Hex(pretty);usersData.issuedCodeIds.push(codeId);return {pretty,codeId}}
  }
  throw new Error('一意なアクセスキーを生成できませんでした。');
}
async function generateAnnualCodes(regenerateAll=false){
  if(!usersData.users.length){alert('先に生徒名簿を登録してください。');return}
  if(regenerateAll&&!confirm('全生徒の年間アクセスキーを再発行します。以前のQRカードはすべて無効になります。よろしいですか？'))return;
  annualSecrets=[];
  for(const u of usersData.users){
    if(u.credential&&!regenerateAll)continue;
    const {pretty,codeId}=await createUniqueAccessCode(),v=await TDX.makeVerifier(pretty);
    u.credential={salt:v.salt,hash:v.hash,codeId,issuedAt:new Date().toISOString()};
    u.qrSecret=await TDX.encryptSecret(pretty,teacherSessionPassword);
    annualSecrets.push({studentCode:u.studentCode,accessCode:pretty,classKey:u.classKey});
  }
  mergeIntoAccessVault(annualSecrets);
  renderAnnualSecrets();renderAccessVaultManager();renderRosterSummary();renderAdminStudentList();
  if(annualSecrets.length){
    $('printAnnualCardsBtn').disabled=false;updateAnnualMasterButtons();
    $('rosterMsg').className='success small';
    $('rosterMsg').textContent=`${annualSecrets.length}人分の年間アクセスキーを発行しました。年間マスターCSVをバックアップ保存し、users.jsonをGitHubへ反映してください。以後のQR再印刷はCSV不要です。`;
  }else{
    $('rosterMsg').className='notice small';$('rosterMsg').textContent='全員すでに年間アクセスキー発行済みです。旧形式の生徒がいる場合は、年間マスターCSVを読み込んでv1.24形式へ移行してください。';
  }
}
function renderAnnualSecrets(){
  const root=$('annualCodePreview');if(!root)return;
  if(!annualSecrets.length){root.innerHTML='<div class="notice small">アクセスキーを新規発行すると、ここに今回発行分だけ表示されます。平文キーは users.json には保存されません。</div>';return}
  root.innerHTML=`<h3>今回発行したアクセスキー（${annualSecrets.length}人）</h3><div class="table-shell"><table><thead><tr><th>4桁番号</th><th>年間アクセスキー</th><th>クラス</th></tr></thead><tbody>${annualSecrets.slice(0,20).map(x=>`<tr><td>${x.studentCode}</td><td><code>${x.accessCode}</code></td><td>${x.classKey}</td></tr>`).join('')}</tbody></table></div>${annualSecrets.length>20?`<p class="small muted">ほか ${annualSecrets.length-20}人</p>`:''}`;
}
function accessSecretMap(){return new Map(accessVault.map(x=>[x.studentCode,x]))}
function userHasDirectQr(u){return !!(u?.credential&&u?.qrSecret?.data)}
function userHasLegacyQr(u){return !!(u?.credential&&accessSecretMap().has(u.studentCode))}
async function decryptUserAccessCode(u){
  if(!u?.credential)throw new Error('アクセスキーが未発行です。');
  if(u.qrSecret?.data){
    const code=(await TDX.decryptSecret(u.qrSecret,teacherSessionPassword)).toUpperCase();
    if(!(await TDX.verify(code,u.credential)))throw new Error('users.json内のQR再印刷データと認証情報が一致しません。');
    return {studentCode:u.studentCode,accessCode:code,classKey:u.classKey||u.studentCode.slice(0,2)};
  }
  const legacy=accessSecretMap().get(u.studentCode);
  if(legacy?.accessCode&&await TDX.verify(legacy.accessCode,u.credential))return {...legacy,classKey:legacy.classKey||u.classKey||u.studentCode.slice(0,2)};
  throw new Error('この生徒は旧形式のusers.jsonです。システム管理者が年間マスターCSVを読み込み、users.jsonを更新してください。');
}
async function migrateLegacyVaultToEncryptedSecrets(){
  let count=0;
  const m=accessSecretMap();
  for(const u of usersData.users){
    if(!u.credential||u.qrSecret?.data)continue;
    const row=m.get(u.studentCode);if(!row?.accessCode)continue;
    try{
      if(await TDX.verify(row.accessCode,u.credential)){
        u.qrSecret=await TDX.encryptSecret(row.accessCode,teacherSessionPassword);count++;
      }
    }catch(_){/* skip invalid legacy record */}
  }
  return count;
}
function annualMasterState(){
  const total=usersData.users.length;
  const issued=usersData.users.filter(u=>!!u.credential).length;
  const direct=usersData.users.filter(userHasDirectQr).length;
  const legacy=usersData.users.filter(u=>u.credential&&!u.qrSecret?.data&&userHasLegacyQr(u)).length;
  const missing=usersData.users.filter(u=>u.credential&&!u.qrSecret?.data&&!userHasLegacyQr(u)).length;
  const unissued=usersData.users.filter(u=>!u.credential).length;
  return {total,issued,direct,legacy,known:direct+legacy,missing,unissued,complete:total>0&&direct+legacy===total&&missing===0&&unissued===0};
}
function updateAnnualMasterButtons(){
  const st=annualMasterState();
  if($('exportAnnualSecretsBtn'))$('exportAnnualSecretsBtn').disabled=st.total===0;
  if($('printAllAnnualCardsBtn'))$('printAllAnnualCardsBtn').disabled=!st.complete;
  renderAnnualMasterStatus(st);
}
function renderAnnualMasterStatus(st=annualMasterState()){
  const el=$('annualMasterStatus');if(!el)return;
  if(!st.total){el.className='info-strip teacher-strip';el.innerHTML='<span>MASTER</span> 生徒名簿を登録すると、年間アクセスキーの状態がここに表示されます。';return}
  if(st.unissued||st.missing){
    const parts=[];if(st.direct)parts.push(`v1.24対応 ${st.direct}人`);if(st.legacy)parts.push(`旧形式・移行可能 ${st.legacy}人`);if(st.missing)parts.push(`旧形式・キー不明 ${st.missing}人`);if(st.unissued)parts.push(`未発行 ${st.unissued}人`);
    el.className='info-strip teacher-strip warning-strip';
    el.innerHTML=`<span>CHECK</span> ${parts.join(' / ')}。旧形式の生徒がいる場合は、旧年間マスターCSVを読み込んでusers.jsonを更新してください。`;return
  }
  if(st.legacy){
    el.className='info-strip teacher-strip warning-strip';
    el.innerHTML=`<span>MIGRATE</span> ${st.legacy}人はこの端末の旧データから移行できます。年間マスターCSVまたはusers.jsonを書き出すとv1.24形式へ暗号化して移行します。`;return
  }
  el.className='info-strip teacher-strip success-strip';
  el.innerHTML=`<span>READY</span> <strong>${st.direct}/${st.total}人</strong> がv1.24形式。一般教員はCSVなしで同じQRを再印刷できます。年間マスターCSVもいつでも再ダウンロードできます。`;
}
async function exportAnnualSecrets(){
  const st=annualMasterState();
  if(!usersData.users.length){alert('生徒名簿が登録されていません。');return}
  if(st.unissued){alert(`未発行の生徒が ${st.unissued}人います。先にアクセスキーを発行してください。`);return}
  if(st.missing){alert(`元のアクセスキーを復元できない生徒が ${st.missing}人います。v1.23以前の年間マスターCSVを読み込むか、必要な生徒だけアクセスキーを再発行してください。`);return}
  const migrated=await migrateLegacyVaultToEncryptedSecrets();
  const rows=[];
  try{
    for(const u of usersData.users.slice().sort((a,b)=>a.studentCode.localeCompare(b.studentCode)))rows.push(await decryptUserAccessCode(u));
  }catch(e){alert('年間マスターCSVを作成できません：'+e.message);return}
  const csv='4桁番号,年間アクセスキー,クラス\n'+rows.map(x=>`${x.studentCode},${x.accessCode},${x.classKey}`).join('\n');
  TDX.download('T-DX_Lab_年間アクセスキー_年間マスター.csv','\ufeff'+csv,'text/csv;charset=utf-8');
  if(migrated){
    renderAccessVaultManager();renderRosterSummary();
    const msg=$('usersExportMsg');if(msg){msg.className='notice small';msg.textContent=`旧形式 ${migrated}人分をv1.24形式へ移行しました。続けてusers.jsonを書き出し、GitHubのdata/users.jsonを更新してください。`}
  }
}
// v1.23互換。一般教員向けの別ファイルはv1.24から不要。
function exportQrReprintData(){alert('v1.24からQR再印刷用データの別ファイルは不要です。最新版users.jsonから直接再印刷できます。')}
function mergeIntoAccessVault(rows){
  const validCodes=new Set(usersData.users.map(u=>u.studentCode));
  const m=new Map(accessVault.filter(x=>validCodes.has(x.studentCode)).map(x=>[x.studentCode,x]));
  (rows||[]).forEach(x=>{if(x&&/^\d{4}$/.test(String(x.studentCode))&&x.accessCode&&validCodes.has(String(x.studentCode)))m.set(String(x.studentCode),{studentCode:String(x.studentCode),accessCode:String(x.accessCode).toUpperCase(),classKey:String(x.classKey||x.studentCode.slice(0,2))})});
  accessVault=[...m.values()].sort((a,b)=>a.studentCode.localeCompare(b.studentCode));
  persistAccessVault();refreshAccessVaultClassFilter();updateAnnualMasterButtons();
}
function refreshAccessVaultClassFilter(){
  const sel=$('accessVaultClassFilter');if(!sel)return;
  const current=sel.value;
  const classes=[...new Set(usersData.users.map(x=>x.classKey||x.studentCode.slice(0,2)))].sort();
  sel.innerHTML='<option value="">全クラス</option>'+classes.map(c=>`<option value="${esc(c)}">${esc(c)}組</option>`).join('');
  if(classes.includes(current))sel.value=current;
}
async function importAnnualSecretsCsv(e){
  const f=e.target.files?.[0];if(!f)return;
  if(!systemAdminUnlocked){alert('旧データの移行はシステム管理者だけが実行できます。');e.target.value='';return}
  try{
    const text=(await f.text()).replace(/^\uFEFF/,'');let rows=[];
    if(f.name.toLowerCase().endsWith('.json')||text.trim().startsWith('{')||text.trim().startsWith('[')){
      const obj=JSON.parse(text),src=Array.isArray(obj)?obj:(obj.users||obj.rows||[]);
      rows=src.map(x=>({studentCode:String(x.studentCode||x['4桁番号']||''),accessCode:String(x.accessCode||x['年間アクセスキー']||'').toUpperCase(),classKey:String(x.classKey||x['クラス']||'')})).filter(x=>/^\d{4}$/.test(x.studentCode)&&x.accessCode);
    }else{
      const table=TDX.csvParse(text),header=(table.shift()||[]).map(x=>String(x).trim());
      const idxCode=Math.max(0,header.findIndex(x=>/4桁番号|student/i.test(x))),idxKey=header.findIndex(x=>/アクセスキー|access/i.test(x)),idxClass=header.findIndex(x=>/クラス|class/i.test(x));
      rows=table.map(parts=>({studentCode:String(parts[idxCode]||'').trim(),accessCode:String(parts[idxKey>=0?idxKey:1]||'').trim().toUpperCase(),classKey:String(parts[idxClass>=0?idxClass:2]||'').trim()})).filter(x=>/^\d{4}$/.test(x.studentCode)&&x.accessCode);
    }
    if(!rows.length)throw new Error('有効な年間アクセスキーが見つかりませんでした。');
    const verified=[],stale=[],unknown=[];
    for(const row of rows){
      const u=usersData.users.find(x=>x.studentCode===row.studentCode);
      if(!u){unknown.push(row.studentCode);continue}
      if(!u.credential){stale.push(row.studentCode);continue}
      if(await TDX.verify(row.accessCode,u.credential)){
        u.qrSecret=await TDX.encryptSecret(row.accessCode,teacherSessionPassword);
        verified.push({...row,classKey:row.classKey||u.classKey||row.studentCode.slice(0,2)});
      }else stale.push(row.studentCode);
    }
    mergeIntoAccessVault(verified);renderAccessVaultManager();renderRosterSummary();renderAdminStudentList();
    const msg=$('usersExportMsg');if(msg){msg.className='notice small';msg.textContent=`旧データから ${verified.length}人分をv1.24形式へ移行しました。users.jsonを書き出してGitHubへ反映してください。`}
    setAccessMessage(`旧データから ${verified.length}人分を移行しました。`+(stale.length?` 不一致 ${stale.length}人。`:``)+(unknown.length?` 名簿外 ${unknown.length}人。`:``),stale.length||unknown.length?'notice':'success');
  }catch(err){setAccessMessage('旧データを読み込めませんでした：'+err.message,'error')}
  finally{e.target.value=''}
}
function currentManagedUsers(){
  const c=$('accessVaultClassFilter')?.value||'';
  return usersData.users.slice().sort((a,b)=>a.studentCode.localeCompare(b.studentCode)).filter(x=>!c||(x.classKey||x.studentCode.slice(0,2))===c);
}
function renderAccessVaultSummary(){
  const root=$('accessVaultSummary');if(!root)return;
  const st=annualMasterState();
  root.innerHTML=`<div class="kpi"><div class="muted small">登録生徒</div><div class="value">${st.total}</div></div><div class="kpi"><div class="muted small">直接再印刷可</div><div class="value">${st.direct}</div></div><div class="kpi ${st.legacy||st.missing?'kpi-warn':''}"><div class="muted small">管理者更新待ち</div><div class="value">${st.legacy+st.missing}</div></div><div class="kpi ${st.unissued?'kpi-warn':''}"><div class="muted small">アクセス未発行</div><div class="value">${st.unissued}</div></div>`;
  const cache=$('qrCacheStatus');if(cache){
    const ready=st.direct,legacy=st.legacy;
    cache.className='qr-cache-status '+(ready?'ready':'');
    cache.innerHTML=ready?`<span>READY</span> users.jsonから ${ready}人分を直接再印刷できます${legacy?`（旧形式 ${legacy}人は管理者更新待ち）`:''}`:'<span>CHECK</span> 再印刷用データを含む最新版users.jsonを確認してください';
  }
}
function renderAccessVaultManager(){
  const root=$('accessVaultManager');if(!root)return;
  refreshAccessVaultClassFilter();renderAccessVaultSummary();updateAnnualMasterButtons();updateSystemAdminUi();
  const rows=currentManagedUsers(),m=accessSecretMap();
  if(!usersData.users.length){root.innerHTML='<div class="notice small">生徒名簿がまだ登録されていません。システム管理者へ確認してください。</div>';updateVaultButtons();return}
  root.innerHTML=`<div class="table-shell"><table><thead><tr><th></th><th>4桁番号</th><th>クラス</th><th>QR再印刷</th></tr></thead><tbody>${rows.map(u=>{
    const direct=userHasDirectQr(u),legacy=!direct&&!!(u.credential&&m.has(u.studentCode)),issued=!!u.credential;
    const state=!issued?'<span class="master-status unissued">○ 未発行</span>':direct?'<span class="master-status ready">✓ 直接再印刷可</span>':legacy?'<span class="master-status missing">△ この端末のみ</span>':'<span class="master-status missing">△ 管理者更新待ち</span>';
    const canPrint=direct||legacy;
    return `<tr><td><input type="checkbox" class="vault-check" data-code="${esc(u.studentCode)}" ${(canPrint||systemAdminUnlocked)?'':'disabled'}></td><td><strong>${esc(u.studentCode)}</strong></td><td>${esc(u.classKey||u.studentCode.slice(0,2))}組</td><td>${state}</td></tr>`
  }).join('')}</tbody></table></div><p class="small muted">${rows.length}人表示中。「直接再印刷可」はCSV不要です。「管理者更新待ち」はシステム管理者が旧CSVを移行し、users.jsonを更新すると解消します。</p>`;
  root.querySelectorAll('.vault-check').forEach(x=>x.onchange=updateVaultButtons);updateVaultButtons();
}
function selectedManagedCodes(){return [...document.querySelectorAll('.vault-check:checked')].map(x=>x.dataset.code)}
function setVisibleVaultSelection(v){document.querySelectorAll('.vault-check').forEach(x=>x.checked=!!v&&!x.disabled);updateVaultButtons()}
function selectMissingVaultRows(){document.querySelectorAll('.vault-check').forEach(cb=>{const u=usersData.users.find(x=>x.studentCode===cb.dataset.code);cb.checked=!!(u?.credential&&!u.qrSecret?.data)});updateVaultButtons()}
function updateVaultButtons(){
  const codes=selectedManagedCodes();
  const printable=codes.filter(code=>{const u=usersData.users.find(x=>x.studentCode===code);return userHasDirectQr(u)||userHasLegacyQr(u)});
  if($('reprintSelectedCardsBtn'))$('reprintSelectedCardsBtn').disabled=!printable.length;
  if($('reissueSelectedCodesBtn'))$('reissueSelectedCodesBtn').disabled=!codes.length;
}
async function reprintSelectedCards(){
  const codes=selectedManagedCodes();if(!codes.length){alert('再印刷する生徒を選択してください。');return}
  const rows=[],errors=[];
  for(const code of codes){
    const u=usersData.users.find(x=>x.studentCode===code);if(!u)continue;
    try{rows.push(await decryptUserAccessCode(u))}catch(e){errors.push(`${code}: ${e.message}`)}
  }
  if(!rows.length){alert('選択した生徒のQRを再印刷できません。\n\n'+errors.join('\n'));return}
  if(errors.length&&!confirm(`${rows.length}人は再印刷できますが、${errors.length}人は管理者更新が必要です。再印刷可能な生徒だけPDFを作成しますか？`))return;
  await generateAccessCardsPdf(rows,'T-DX_Lab_年間アクセスカード_再印刷.pdf');
}
async function reissueSelectedCodes(){
  if(!systemAdminUnlocked){alert('アクセスキーの再発行はシステム管理者だけが実行できます。');return}
  const codes=selectedManagedCodes();if(!codes.length){alert('再発行する生徒を選択してください。');return}
  if(!confirm(`${codes.length}人の年間アクセスキーを再発行します。新しいusers.jsonをGitHubへ反映した時点で、以前のQRカードは使えなくなります。よろしいですか？`))return;
  const newly=[];
  for(const code of codes){
    const u=usersData.users.find(x=>x.studentCode===code);if(!u)continue;
    const {pretty,codeId}=await createUniqueAccessCode(),v=await TDX.makeVerifier(pretty);
    u.credential={salt:v.salt,hash:v.hash,codeId,issuedAt:new Date().toISOString()};
    u.qrSecret=await TDX.encryptSecret(pretty,teacherSessionPassword);
    newly.push({studentCode:u.studentCode,accessCode:pretty,classKey:u.classKey});
  }
  mergeIntoAccessVault(newly);annualSecrets=newly;
  renderAnnualSecrets();renderAccessVaultManager();renderRosterSummary();renderAdminStudentList();
  if($('printAnnualCardsBtn'))$('printAnnualCardsBtn').disabled=!newly.length;
  const msg=$('usersExportMsg');if(msg){msg.className='notice small';msg.textContent=`${newly.length}人のアクセスキーを再発行しました。新しいusers.jsonをGitHubへ反映し、年間マスターCSVも最新版に置き換えてください。`}
  setAccessMessage(`${newly.length}人のアクセスキーを再発行しました。新しいQRカードを配布してください。`,'success');
}
async function printAllAnnualCards(){
  const st=annualMasterState();if(!st.complete){alert('全員分のアクセスキーを確認できません。旧形式の生徒は年間マスターCSVを移行してください。');return}
  const rows=[];try{for(const u of usersData.users.slice().sort((a,b)=>a.studentCode.localeCompare(b.studentCode)))rows.push(await decryptUserAccessCode(u))}catch(e){alert(e.message);return}
  await generateAccessCardsPdf(rows,'T-DX_Lab_年間アクセスカード_全員分.pdf');
}
function renderAnnualCards(secrets){
  const pages=[];
  for(let i=0;i<secrets.length;i+=2){
    const pair=secrets.slice(i,i+2);
    pages.push(`<section class="slip-page annual-card-page">${pair.map((x,j)=>`<div class="slip-half annual-access-card">
      <div class="slip-brand"><strong>T-DX Lab☆問題演習システム</strong><span>年間アクセスカード</span></div>
      <h2>学習アクセスカード</h2>
      <p class="slip-note">このカードは年度内のT-DX Lab☆問題演習システム共通ログインに使用します。ほかの人に見せないでください。</p>
      <div class="annual-card-grid">
        <div class="slip-credentials"><div><span>4桁番号</span><strong>${x.studentCode}</strong></div><div><span>年間アクセスキー</span><strong class="code">${x.accessCode}</strong></div></div>
        <div class="annual-qr-wrap"><div class="annual-qr" data-qr-code="TDX|${x.studentCode}|${x.accessCode}"></div><small>ログイン時に読み取る</small></div>
      </div>
      <p class="small">QRコードが使えない場合は、4桁番号と年間アクセスキーを手入力してください。</p>
      ${j===0?'<div class="cutline">✂ 切り取り線</div>':''}
    </div>`).join('')}</section>`);
  }
  $('slips').innerHTML=pages.join('');
  document.querySelectorAll('.annual-qr').forEach(el=>{el.innerHTML='';new QRCode(el,{text:el.dataset.qrCode,width:130,height:130,correctLevel:QRCode.CorrectLevel.M})});
}
async function imageFromUrl(src){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=reject;
    img.src=src;
  });
}
async function qrCanvasFor(text,size=250){
  const host=document.createElement('div');
  host.style.cssText='position:fixed;left:0;top:0;width:'+size+'px;height:'+size+'px;opacity:.001;pointer-events:none;z-index:-1;background:#fff';
  document.body.appendChild(host);
  try{
    new QRCode(host,{text,width:size,height:size,correctLevel:QRCode.CorrectLevel.M});
    await new Promise(r=>setTimeout(r,80));
    const c=host.querySelector('canvas');
    if(c) return c;
    const img=host.querySelector('img');
    if(img){
      if(!img.complete) await new Promise((res,rej)=>{img.onload=res;img.onerror=rej});
      const out=document.createElement('canvas');out.width=size;out.height=size;
      out.getContext('2d').drawImage(img,0,0,size,size);return out;
    }
    throw new Error('QRコードの描画に失敗しました。');
  } finally { host.remove(); }
}
function roundRect(ctx,x,y,w,h,r,fill,stroke){
  ctx.beginPath();
  ctx.roundRect(x,y,w,h,r);
  if(fill){ctx.fillStyle=fill;ctx.fill()}
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke()}
}
function drawCardText(ctx,text,x,y,size=28,weight=600,color='#172033',align='left'){
  ctx.save();ctx.font=`${weight} ${size}px -apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic","Noto Sans JP",sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='alphabetic';ctx.fillText(text,x,y);ctx.restore();
}
async function drawAnnualAccessCard(ctx,x,y,w,h,secret,logo){
  const pad=44;
  roundRect(ctx,x+8,y+8,w-16,h-16,28,'#ffffff','#d8e4f3');
  // header
  if(logo){
    const maxH=62,maxW=150,scale=Math.min(maxW/logo.width,maxH/logo.height);
    ctx.drawImage(logo,x+pad,y+32,logo.width*scale,logo.height*scale);
  }
  drawCardText(ctx,'T-DX Lab☆問題演習システム',x+pad+(logo?170:0),y+70,28,800,'#0d3f8f');
  drawCardText(ctx,'年間 学習アクセスカード',x+pad,y+126,34,800,'#172033');
  drawCardText(ctx,'年度内のすべての教科・模擬試験で使用します。ほかの人には見せないでください。',x+pad,y+170,18,500,'#64748b');

  // credentials panel
  const panelX=x+pad,panelY=y+215,panelW=w-pad*2-310,panelH=300;
  roundRect(ctx,panelX,panelY,panelW,panelH,20,'#f4f8ff','#d5e4fa');
  drawCardText(ctx,'4桁番号',panelX+30,panelY+58,19,700,'#64748b');
  drawCardText(ctx,secret.studentCode,panelX+30,panelY+116,48,900,'#10264b');
  drawCardText(ctx,'年間アクセスキー',panelX+30,panelY+174,19,700,'#64748b');
  drawCardText(ctx,secret.accessCode,panelX+30,panelY+238,31,800,'#10264b');

  // qr
  const qr=await qrCanvasFor(`TDX|${secret.studentCode}|${secret.accessCode}`,250);
  const qrX=x+w-pad-250,qrY=panelY+8;
  ctx.fillStyle='#fff';ctx.fillRect(qrX-10,qrY-10,270,270);ctx.drawImage(qr,qrX,qrY,250,250);
  drawCardText(ctx,'ログイン時に読み取る',qrX+125,qrY+286,17,700,'#334155','center');

  drawCardText(ctx,'QRコードが使えない場合は、上記の4桁番号と年間アクセスキーを手入力してください。',x+pad,y+h-54,17,500,'#475569');
}
async function canvasToPngBytes(canvas){
  return new Promise((resolve,reject)=>{
    canvas.toBlob(async blob=>{
      if(!blob){reject(new Error('PNG画像の生成に失敗しました。'));return}
      try{resolve(new Uint8Array(await blob.arrayBuffer()))}catch(e){reject(e)}
    },'image/png');
  });
}
async function makeAccessCardCanvas(secret,logo){
  // A4半ページとほぼ同じ比率。日本語はCanvas側で描画し、PDFにはPNGとして埋め込む。
  const W=1190,H=842;
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);
  await drawAnnualAccessCard(ctx,18,18,W-36,H-36,secret,logo);
  return canvas;
}
async function generateAccessCardsPdf(secrets,filename='T-DX_Lab_年間アクセスカード.pdf'){
  if(!secrets?.length){alert('PDFに出力するアクセスキーがありません。');return}
  if(!window.PDFLib || typeof QRCode==='undefined'){
    alert('PDFまたはQRコード生成ライブラリを読み込めませんでした。インターネット接続を確認してページを再読み込みしてください。');
    return;
  }
  const btn=$('printAnnualCardsBtn'),oldText=btn?.textContent||'';
  if(btn){btn.disabled=true;btn.textContent='PDF作成中…'}
  try{
    const {PDFDocument,rgb}=window.PDFLib;
    const pdfDoc=await PDFDocument.create();
    let logo=null;try{logo=await imageFromUrl('assets/images/tdx-lab-logo.png')}catch(e){console.warn('logo load skipped',e)}
    const pageW=595.28,pageH=841.89,marginX=20,marginY=18,gap=12;
    const halfH=(pageH-marginY*2-gap)/2;
    for(let i=0;i<secrets.length;i+=2){
      const page=pdfDoc.addPage([pageW,pageH]);
      const topCanvas=await makeAccessCardCanvas(secrets[i],logo);
      const topPng=await pdfDoc.embedPng(await canvasToPngBytes(topCanvas));
      page.drawImage(topPng,{x:marginX,y:pageH-marginY-halfH,width:pageW-marginX*2,height:halfH});
      if(secrets[i+1]){
        const bottomCanvas=await makeAccessCardCanvas(secrets[i+1],logo);
        const bottomPng=await pdfDoc.embedPng(await canvasToPngBytes(bottomCanvas));
        page.drawImage(bottomPng,{x:marginX,y:marginY,width:pageW-marginX*2,height:halfH});
      }
      const cutY=marginY+halfH+gap/2;
      page.drawLine({start:{x:marginX,y:cutY},end:{x:pageW-marginX,y:cutY},thickness:0.7,color:rgb(0.55,0.6,0.68),dashArray:[5,4]});
    }
    const bytes=await pdfDoc.save({useObjectStreams:false});
    const blob=new Blob([bytes],{type:'application/pdf'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }catch(e){console.error(e);alert('年間アクセスカードPDFの生成に失敗しました。ページを再読み込みして、もう一度お試しください。')}
  finally{if(btn){btn.disabled=false;btn.textContent=oldText}}
}
async function printAnnualCards(){
  if(!annualSecrets.length){alert('今回新しく発行したアクセスキーがありません。既存カードは上部メニューの「QRカード再印刷」から生徒を選んで再印刷してください。');return}
  await generateAccessCardsPdf(annualSecrets,'T-DX_Lab_年間アクセスカード.pdf');
}

// ===== PDF / pasted text → editable exam draft =====
function toHalfWidth(s){
  return String(s||'')
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0xFEE0))
    .replace(/[：]/g,':').replace(/[，、]/g,',').replace(/[＝]/g,'=').replace(/[＋]/g,'+').replace(/[｜]/g,'|');
}
function initChoiceRangeControls(){
  const letters='abcdefghijklmnopqrstuvwxyz'.split('');
  const start=$('letterChoiceStart'),end=$('letterChoiceEnd');
  if(start&&end){
    start.innerHTML=letters.map(x=>`<option value="${x}" ${x==='a'?'selected':''}>${x}</option>`).join('');
    end.innerHTML=letters.map(x=>`<option value="${x}" ${x==='f'?'selected':''}>${x}</option>`).join('');
  }
  const kana=['ア','イ','ウ','エ','オ','カ','キ','ク','ケ','コ','サ','シ','ス','セ','ソ','タ','チ','ツ','テ','ト'];
  const ks=$('kanaChoiceStart'),ke=$('kanaChoiceEnd');
  if(ks&&ke){
    ks.innerHTML=kana.map(x=>`<option value="${x}" ${x==='ア'?'selected':''}>${x}</option>`).join('');
    ke.innerHTML=kana.map(x=>`<option value="${x}" ${x==='ト'?'selected':''}>${x}</option>`).join('');
  }
  ['useNumberChoices','numberChoiceStart','numberChoiceEnd','useLetterChoices','letterChoiceStart','letterChoiceEnd','useKanaChoices','kanaChoiceStart','kanaChoiceEnd'].forEach(id=>{
    $(id)?.addEventListener('change',()=>{renderGlobalChoicePreview();applyConfiguredOptionsToEmptyRows(false)});
    $(id)?.addEventListener('input',()=>{renderGlobalChoicePreview()});
  });
  renderGlobalChoicePreview();
}
function configuredChoices(){
  const out=[];
  if($('useNumberChoices')?.checked){
    let a=Math.max(0,Number($('numberChoiceStart')?.value||0)),b=Math.max(0,Number($('numberChoiceEnd')?.value||9));
    if(a>b)[a,b]=[b,a];
    for(let n=a;n<=b&&out.length<100;n++)out.push(String(n));
  }
  if($('useLetterChoices')?.checked){
    const alphabet='abcdefghijklmnopqrstuvwxyz',a=alphabet.indexOf($('letterChoiceStart')?.value||'a'),b=alphabet.indexOf($('letterChoiceEnd')?.value||'f');
    let lo=Math.max(0,Math.min(a,b)),hi=Math.max(0,Math.max(a,b));
    for(let i=lo;i<=hi;i++)out.push(alphabet[i]);
  }
  if($('useKanaChoices')?.checked){
    const kana=['ア','イ','ウ','エ','オ','カ','キ','ク','ケ','コ','サ','シ','ス','セ','ソ','タ','チ','ツ','テ','ト'];
    const a=kana.indexOf($('kanaChoiceStart')?.value||'ア'),b=kana.indexOf($('kanaChoiceEnd')?.value||'ト');
    let lo=Math.max(0,Math.min(a,b)),hi=Math.max(0,Math.max(a,b));
    for(let i=lo;i<=hi;i++)out.push(kana[i]);
  }
  return [...new Set(out)];
}
function configuredOptionsCsv(){return configuredChoices().join(',')}
function choiceRangeLabel(){
  const parts=[];
  if($('useNumberChoices')?.checked)parts.push(`${$('numberChoiceStart').value}〜${$('numberChoiceEnd').value}`);
  if($('useLetterChoices')?.checked)parts.push(`${$('letterChoiceStart').value}〜${$('letterChoiceEnd').value}`);
  if($('useKanaChoices')?.checked)parts.push(`${$('kanaChoiceStart').value}〜${$('kanaChoiceEnd').value}`);
  return parts.join(' / ')||'未設定';
}
function renderGlobalChoicePreview(){
  const opts=configuredChoices(),root=$('globalChoicePreview');
  if(root)root.innerHTML=opts.length?opts.map(x=>`<span>${esc(x)}</span>`).join(''):'<em>選択肢を1つ以上指定してください</em>';
  if($('reviewChoiceRangeText'))$('reviewChoiceRangeText').textContent=choiceRangeLabel();
}
function ensureChoicesConfigured(){
  if(configuredChoices().length)return true;
  alert('先に、この試験で使う選択肢の数字・英字・カタカナ範囲を指定してください。');
  $('useNumberChoices')?.focus();return false;
}
function applyConfiguredOptionsToEmptyRows(render=true){
  const csv=configuredOptionsCsv();
  if(!csv)return;
  editorRows.forEach(r=>{if(!r.options)r.options=csv});
  if(render&&editorRows.length)renderEditor();
}
function applyConfiguredOptionsToAllRows(){
  const csv=configuredOptionsCsv();if(!csv){ensureChoicesConfigured();return}
  editorRows.forEach(r=>r.options=csv);renderEditor();
}
function clusterLines(pts){
  const lines=[];
  for(const p of pts){let line=lines.find(l=>Math.abs(l.y-p.y)<2.2);if(!line){line={y:p.y,parts:[]};lines.push(line)}line.parts.push(p)}
  lines.sort((a,b)=>b.y-a.y);
  return lines.map(l=>l.parts.sort((a,b)=>a.x-b.x).map(p=>p.str).join(' '));
}
function extractPageLines(items,pageWidth=0){
  const pts=items.filter(x=>x.str&&x.str.trim()).map(x=>({str:x.str.trim(),x:x.transform?.[4]||0,y:x.transform?.[5]||0}));
  if(!pageWidth)return clusterLines(pts);
  const mid=pageWidth*0.5,left=pts.filter(p=>p.x<mid),right=pts.filter(p=>p.x>=mid);
  const enoughColumns=left.length>=8&&right.length>=8;
  if(enoughColumns)return [...clusterLines(left),...clusterLines(right)];
  return clusterLines(pts);
}
async function readPdf(){
  if(!ensureChoicesConfigured())return;
  const f=$('answerPdf').files[0];if(!f){alert('PDFを選択してください。');return}
  try{
    $('examSourceMsg').className='small muted';$('examSourceMsg').textContent='PDFを読み取っています…';
    const buf=await f.arrayBuffer(),pdfjs=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs';
    const pdf=await pdfjs.getDocument({data:buf}).promise;let pages=[];
    await renderPdfPages(pdf);
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p),tc=await page.getTextContent(),w=page.getViewport({scale:1}).width;
      pages.push(`--- page ${p} ---\n${extractPageLines(tc.items,w).join('\n')}`)
    }
    const text=pages.join('\n');$('pdfText').value=text;
    analyzeAnswerSource('pdf');
    $('examSourceMsg').className='success small';$('examSourceMsg').textContent='PDFを読み取りました。右側の確認画面で正答・配点を確認してください。崩れている場合は「解析をリセット」してテキスト解析へ切り替えられます。';
  }catch(e){console.error(e);$('examSourceMsg').className='error small';$('examSourceMsg').textContent='PDF読み取りに失敗しました。「解析をリセット」後、AI等で作成したT-DX Lab形式のテキストを貼り付けて解析してください。'}
}
async function renderPdfPages(pdf){
  const root=$('pdfPagePreview');if(!root)return;
  root.innerHTML='';
  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p),viewport=page.getViewport({scale:1.35});
    const wrap=document.createElement('div');wrap.className='pdf-preview-page';
    const lab=document.createElement('div');lab.className='pdf-preview-label';lab.textContent=`${p} / ${pdf.numPages}`;
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.width=viewport.width;canvas.height=viewport.height;
    wrap.append(lab,canvas);root.appendChild(wrap);
    await page.render({canvasContext:ctx,viewport}).promise;
  }
}
function resetExamParse(){
  editorRows=[];editorSectionTargets={};
  if($('answerPdf'))$('answerPdf').value='';
  if($('pdfText'))$('pdfText').value='';
  if($('pdfPagePreview'))$('pdfPagePreview').innerHTML='<div class="notice small">PDF解析をリセットしました。テキスト解析へ切り替える場合は、左側のテキスト欄へT-DX Lab形式の模範解答を貼り付けてください。</div>';
  if($('examEditorCards'))$('examEditorCards').innerHTML='';
  if($('parseSummary'))$('parseSummary').innerHTML='';
  if($('sectionPointsSummary'))$('sectionPointsSummary').innerHTML='';
  if($('pointsCheckMsg'))$('pointsCheckMsg').textContent='';
  $('examReviewPanel')?.classList.add('hidden');
  $('examSourceMsg').className='notice small';$('examSourceMsg').textContent='解析結果をリセットしました。選択肢の範囲と基本情報は残しています。テキスト模範解答を貼り付けて再解析できます。';
  $('answerTextInput')?.focus();
}
function deriveSection(label,current='第1問'){
  const m=label.match(/第\s*(\d+)\s*問\s*([A-DＡ-Ｄ]?)/);if(!m)return current;
  return `第${m[1]}問${m[2]?m[2].replace('Ａ','A').replace('Ｂ','B').replace('Ｃ','C').replace('Ｄ','D'):''}`;
}
function lastKana(label){const m=label.match(/([ア-ン])(?:\s*[（(]|\s*$)/);return m?m[1]:''}
function normalizeLettersToken(s){return (String(s||'').match(/[ア-ン]/g)||[])}
function normalizedChoiceValue(v){
  let s=toHalfWidth(v).trim();
  if(/^[A-Za-z]$/.test(s))s=s.toLowerCase();
  return s;
}
function parseAnswerValuesToken(s){
  const allowed=new Set(configuredChoices().map(normalizedChoiceValue));
  return toHalfWidth(s).replace(/[、]/g,',').split(',').map(x=>normalizedChoiceValue(x)).filter(x=>x&&allowed.has(x));
}
function extractSectionTargets(raw){
  const lines=toHalfWidth(raw).split(/\r?\n/).map(x=>x.trim()).filter(Boolean),targets={};let pending='';
  for(const src of lines){
    const line=src.replace(/\s+/g,' ');
    let m=line.match(/第\s*(\d+)\s*問\s*([A-D]?)\s*(?:[|]\s*)?(?:[（(]\s*)?(\d+(?:\.\d+)?)\s*(?:点)?\s*[）)]?/);
    if(m&&(/\||[（(]|点/.test(line))){targets[`第${m[1]}問${m[2]||''}`]=Number(m[3]);pending='';continue}
    m=line.match(/第\s*(\d+)\s*問\s*([A-D]?)/);if(m){pending=`第${m[1]}問${m[2]||''}`;const pm=line.match(/[（(]\s*(\d+(?:\.\d+)?)\s*(?:点)?\s*[）)]/);if(pm){targets[pending]=Number(pm[1]);pending=''};continue}
    if(pending){const pm=line.match(/^[（(]?\s*(\d+(?:\.\d+)?)\s*(?:点)?\s*[）)]?$/);if(pm){targets[pending]=Number(pm[1]);pending=''}}
  }
  return targets;
}
function gradingTypeFromText(v,multi=false){
  const t=String(v||'').replace(/\s+/g,'').replace(/＋/g,'+');
  if(/順不同.*完答|順序は問わない.*完答/.test(t))return 'unordered_complete_item';
  if(/順不同|順序は問わない/.test(t))return multi?'unordered_item':'unordered_item';
  if(/完答/.test(t))return 'complete_item';
  return multi?'complete_item':'normal';
}
function parseStructuredAnswerText(raw){
  const lines=toHalfWidth(raw).split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!/^#/.test(x));
  if(!lines.some(x=>x.includes('|')))return null;
  const rows=[],targets={};let currentSection='第1問',groupSeq=0,recognized=0;
  for(const src of lines){
    const parts=src.split('|').map(x=>x.trim());
    if(parts.length<2)continue;
    const key=parts[0];
    if(/^試験名$/.test(key)){if(!$('examName').value.trim())$('examName').value=parts.slice(1).join('|');continue}
    if(/^教科$/.test(key)){if(!$('examSubjectInput').value.trim())$('examSubjectInput').value=parts.slice(1).join('|');continue}
    if(/^満点$/.test(key)){const n=Number(parts[1]);if(Number.isFinite(n)&&n>0)$('examTotalPoints').value=n;continue}
    const sm=key.match(/^第\s*(\d+)\s*問\s*([A-D]?)$/);
    if(sm){currentSection=`第${sm[1]}問${sm[2]||''}`;const n=Number(parts[1]);if(Number.isFinite(n))targets[currentSection]=n;recognized++;continue}
    if(parts.length<3)continue;
    const labels=normalizeLettersToken(key),answers=parts[1].split(/[,、]/).map(normalizedChoiceValue).filter(Boolean),point=parts[2],mode=parts[3]||'';
    if(!labels.length)continue;
    const multi=labels.length>1,type=gradingTypeFromText(mode,multi),group=multi?`g_${currentSection.replace(/\W/g,'')}_${++groupSeq}`:'';
    const allowed=new Set(configuredChoices().map(normalizedChoiceValue));
    labels.forEach((letter,j)=>{
      const answer=answers[j]||'',valid=answer&&allowed.has(answer);
      rows.push({section:currentSection,label:`${currentSection} ${letter}`,answer,
        points:(multi&&['complete_item','unordered_complete_item'].includes(type))?'':point,
        type,group,groupPoints:(multi&&['complete_item','unordered_complete_item'].includes(type))?point:'',
        options:configuredOptionsCsv(),confidence:(valid&&answers.length>=labels.length)?'高':'要確認',sourceLine:src});
    });
    recognized++;
  }
  return recognized?{rows,targets}:null;
}
function tableStyleRows(lines){
  const rows=[];let currentSection='第1問',groupSeq=0;
  for(const src of lines){
    const line=toHalfWidth(src).replace(/[，、]/g,',').replace(/\s+/g,' ').trim();
    const sm=line.match(/第\s*(\d+)\s*問\s*([A-D]?)/);if(sm)currentSection=`第${sm[1]}問${sm[2]||''}`;
    const toks=line.split(' ').filter(Boolean);
    for(let i=0;i<toks.length-1;i++){
      const key=toks[i],ans=toks[i+1],letters=normalizeLettersToken(key),answers=parseAnswerValuesToken(ans);
      if(!letters.length||!answers.length||key.length>24||ans.length>40)continue;
      const pointTok=toks[i+2]&&/^\d+(?:\.\d+)?$/.test(toks[i+2])?toks[i+2]:'';
      const unordered=/順序は問わない|順不同/.test(line);
      const eachPoint=(line.match(/各\s*(\d+(?:\.\d+)?)/)||[])[1]||'';
      if(letters.length>1&&answers.length>=letters.length){
        const group=`g_${currentSection.replace(/\W/g,'')}_${++groupSeq}`;
        // 「各2」の記載がある順不同は各欄採点、それ以外の複数欄は1まとまりの完答として扱う。
        const type=unordered&&eachPoint?'unordered_item':unordered?'unordered_complete_item':'complete_item';
        letters.forEach((letter,j)=>rows.push({section:currentSection,label:`${currentSection} ${letter}`,answer:answers[j]||'',
          points:type==='unordered_item'?(eachPoint||''):'',type,group,groupPoints:type==='unordered_item'?'':(pointTok||''),
          options:configuredOptionsCsv(),confidence:(pointTok||eachPoint)?'高':'要確認',sourceLine:src}));
        i+=pointTok?2:1;continue;
      }
      const letter=letters[0],answer=answers[0];
      rows.push({section:currentSection,label:`${currentSection} ${letter}`,answer,points:pointTok||'',type:'normal',group:'',groupPoints:'',options:configuredOptionsCsv(),confidence:pointTok?'高':'要確認',sourceLine:src});
      i+=pointTok?2:1;
    }
  }
  return rows;
}
function parseExamText(raw){
  const structured=parseStructuredAnswerText(raw);
  if(structured)return structured;
  const text=toHalfWidth(raw),lines=text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!/^--- page/.test(x));
  const tableRows=tableStyleRows(lines),targets=extractSectionTargets(raw);
  if(tableRows.length){
    const dedup=[],keys=new Set();
    for(const r of tableRows){const key=`${r.section}|${r.label}|${r.answer}|${r.group}`;if(keys.has(key))continue;keys.add(key);dedup.push(r)}
    return {rows:dedup,targets};
  }
  const rows=[];let currentSection='第1問';const seen=new Set();
  for(const line0 of lines){
    const line=line0.replace(/\s+/g,' '),sec=line.match(/第\s*(\d+)\s*問\s*([A-D]?)/);if(sec)currentSection=`第${sec[1]}問${sec[2]||''}`;
    const m=line.match(/^(.{1,80}?[ア-ン])\s*(?:正答|答|解答|[:=])\s*([0-9A-Za-z]+(?:\s*[,、]\s*[0-9A-Za-z]+)*)/);if(!m)continue;
    const label=m[1].trim(),answers=m[2].split(/[,、]/).map(normalizedChoiceValue),answer=answers[0]||'',section=deriveSection(label,currentSection),key=`${section}|${label}|${answer}`;if(seen.has(key))continue;seen.add(key);
    rows.push({section,label,answer,points:'',type:'normal',group:'',groupPoints:'',options:configuredOptionsCsv(),confidence:'要確認',sourceLine:line});
  }
  return {rows,targets};
}
function analyzeAnswerSource(source='pdf'){
  if(!ensureChoicesConfigured())return;
  const text=source==='pasted'?$('answerTextInput').value:$('pdfText').value;
  if(!text.trim()){alert(source==='pasted'?'模範解答テキストを貼り付けてください。':'先にPDFを読み取ってください。');return}
  const parsed=parseExamText(text);editorRows=parsed.rows||[];editorSectionTargets=parsed.targets||{};
  if(!editorRows.length)editorRows=[blankEditorRow()];
  applyConfiguredOptionsToEmptyRows(false);
  $('examReviewPanel').classList.remove('hidden');
  document.querySelector('.pdf-review-workspace')?.classList.toggle('no-pdf-source',source==='pasted');
  renderEditor();
  $('examSourceMsg').className=editorRows.some(r=>r.confidence==='要確認')?'notice small':'success small';
  $('examSourceMsg').textContent=`${source==='pasted'?'テキスト':'PDF'}から ${editorRows.length}個の解答欄を解析しました。確認画面で正答と配点を確認してください。`;
  $('examReviewPanel').scrollIntoView({behavior:'smooth',block:'start'});
}
function analyzePdfText(text){$('pdfText').value=text;analyzeAnswerSource('pdf')}
function blankEditorRow(){return {section:'第1問',label:'',answer:'',points:'',type:'normal',group:'',groupPoints:'',options:configuredOptionsCsv(),confidence:'要確認',sourceLine:''}}
function addEditorRow(row=blankEditorRow()){editorRows.push({...row,options:row.options||configuredOptionsCsv()});renderEditor();setTimeout(()=>$('examEditorCards')?.lastElementChild?.scrollIntoView({behavior:'smooth',block:'center'}),0)}
function textFormatTemplate(){
  return `試験名|（試験名）\n教科|（教科名）\n満点|${$('examTotalPoints')?.value||100}\n\n第1問|20\nア,イ|0,3|2|完答\nウ|3|2|通常\nエ,オ|e,4|2|完答\n\n第2問|30\nア,イ|2,4|3|順不同+完答\nウ,エ,オ|4,8,1|3|完答\n\n# 採点方式は「通常」「完答」「順不同」「順不同+完答」のいずれか\n# 「順不同」は各欄採点。配点には各欄1つ分の点数を書く\n# 「完答」「順不同+完答」はグループ全体の配点を書く`;
}
async function copyTextTemplate(){
  try{await navigator.clipboard.writeText(textFormatTemplate());$('examSourceMsg').className='success small';$('examSourceMsg').textContent='T-DX Lab用の入力フォーマットをコピーしました。'}catch(e){alert(textFormatTemplate())}
}
function aiPromptText(){
  const choices=configuredChoices().join('、')||'（未設定）';
  return `添付した模範解答PDFを読み取り、T-DX Lab☆問題演習システムに貼り付けられるテキストへ変換してください。\n\n【厳守】\n・説明や前置きは書かず、最後に示すフォーマットだけを出力する。\n・PDFに書かれている「大問」「解答記号」「正答」「配点」を忠実に転記する。\n・推測しない。読めない箇所は正答または配点に「要確認」と書く。\n・この試験のマーク選択肢は ${choices}。選択肢そのものの一覧は出力しない。\n・複数の解答記号が1行にまとまり、その行全体で配点されている場合は「完答」。\n・「解答の順序は問わない」「順不同」等の注記があり、グループ全体で配点される場合は「順不同+完答」。\n・「解答の順序は問わない」かつ「各2点」のように各欄に配点される場合は「順不同」とし、配点欄には各欄1つ分の点数を書く。\n・単独の解答欄は「通常」。\n・大問ごとの配点も必ず出力する。\n\n【出力形式】\n試験名|PDFに記載された試験名\n教科|PDFに記載された教科\n満点|100\n\n第1問|20\nア,イ|0,3|2|完答\nウ|3|2|通常\nエ,オ|e,4|2|完答\n\n第2問|30\nア,イ|2,4|3|順不同+完答\n...\n\n各設問行は必ず「解答記号|正答|配点|採点方式」の4項目にしてください。`;
}
async function copyAiPrompt(){
  try{await navigator.clipboard.writeText(aiPromptText());$('examSourceMsg').className='success small';$('examSourceMsg').textContent='AI読取用プロンプトをコピーしました。模範解答PDFと一緒にChatGPTやClaude等へ渡してください。'}catch(e){alert(aiPromptText())}
}
function editorBlocks(){
  const blocks=[],used=new Set();
  editorRows.forEach((r,i)=>{
    if(used.has(i))return;
    if(r.group&&['complete_item','unordered_complete_item'].includes(r.type)){
      const idx=editorRows.map((x,j)=>x.group===r.group&&x.section===r.section?j:-1).filter(j=>j>=0);
      if(idx.length>1){idx.forEach(j=>used.add(j));blocks.push(idx);return}
    }
    used.add(i);blocks.push([i]);
  });
  return blocks;
}
function moveEditorBlock(index,dir){
  const blocks=editorBlocks(),bi=blocks.findIndex(b=>b.includes(index)),target=bi+dir;
  if(bi<0||target<0||target>=blocks.length)return;
  const reordered=[...blocks];[reordered[bi],reordered[target]]=[reordered[target],reordered[bi]];
  const old=[...editorRows];editorRows=reordered.flatMap(b=>b.map(i=>old[i]));
  renderEditor();
  setTimeout(()=>{
    const blocksNow=editorBlocks(),newBi=Math.max(0,Math.min(blocksNow.length-1,target));
    const firstIndex=blocksNow[newBi]?.[0];
    document.querySelector(`[data-row="${firstIndex}"]`)?.scrollIntoView({behavior:'smooth',block:'center'});
  },0);
}
function typeOptions(value){return [['normal','通常（1欄ずつ採点）'],['unordered_item','順不同（各欄採点）'],['complete_item','完答（全欄一致で得点）'],['unordered_complete_item','順不同＋完答（全欄一致で得点）']].map(([v,t])=>`<option value="${v}" ${v===value?'selected':''}>${t}</option>`).join('')}
function reviewDisplayOptions(r){
  const explicit=String(r.options||configuredOptionsCsv()).split(/[,、\s]+/).map(x=>x.trim()).filter(Boolean);
  return {options:explicit,inferred:false};
}
function groupPeers(index){
  const r=editorRows[index];
  if(!r?.group||!['complete_item','unordered_complete_item'].includes(r.type))return [r];
  return editorRows.filter(x=>x.group===r.group&&x.section===r.section);
}
function answerChoiceButtons(r,i){
  const od=reviewDisplayOptions(r);
  return {od,html:od.options.map(o=>`<button type="button" class="review-choice ${String(r.answer)===String(o)?'is-answer':''}" data-answer-row="${i}" data-answer="${esc(o)}">${esc(o)}</button>`).join('')};
}
function renderGroupCard(rows,indices){
  const first=rows[0],unordered=first.type==='unordered_complete_item',gp=first.groupPoints||'';
  const title=rows.map(r=>lastKana(r.label)||r.label).join('・');
  const subRows=rows.map((r,j)=>{
    const i=indices[j],c=answerChoiceButtons(r,i);
    return `<div class="group-answer-row" data-row="${i}">
      <div class="group-answer-label"><span>${esc(lastKana(r.label)||r.label)}</span><small>正答 ${esc(r.answer||'未設定')}</small></div>
      <div class="choices review-choices">${c.html||'<span class="muted small">選択肢未設定</span>'}</div>
      <button type="button" class="choice-edit-btn" data-edit-options="${i}">この設問の選択肢を変更</button>
    </div>`;
  }).join('');
  return `<article class="review-question-card review-group-card ${rows.some(r=>r.confidence==='要確認')?'needs-review':''}" data-group-card="${esc(first.group)}">
    <div class="review-question-top">
      <span class="review-number">${indices[0]+1}</span>
      <div class="review-question-title">
        <div class="review-group-title">${esc(first.section)} ${esc(title)}</div>
        <div class="review-meta-line"><span class="review-status ${rows.some(r=>r.confidence==='要確認')?'warn-status':'ok-status'}">${rows.some(r=>r.confidence==='要確認')?'要確認':'確認済'}</span><span>${unordered?'順不同＋完答':'完答'}</span><span class="group-award-badge">${gp?esc(gp)+'点':'配点未設定'}</span></div>
      </div>
      <div class="review-card-actions"><button class="row-move" data-move="${indices[0]}" data-dir="-1" type="button" title="上へ移動">↑</button><button class="row-move" data-move="${indices[0]}" data-dir="1" type="button" title="下へ移動">↓</button><button class="row-delete" data-del-group="${esc(first.group)}" type="button">×</button></div>
    </div>
    <div class="group-explain"><strong>${rows.length}つの解答欄をすべて正解したときだけ得点</strong>${unordered?'。解答の順番は問いません。':'。'}<br><span>各欄の青いボタンが現在の正答です。違う場合は正しい番号をクリックしてください。</span></div>
    <div class="group-answer-list">${subRows}</div>
    <details class="review-detail-settings">
      <summary>詳細設定を確認・修正</summary>
      <div class="review-detail-grid group-detail-grid">
        <label>大問<input data-group-k="section" data-group="${esc(first.group)}" value="${esc(first.section)}"></label>
        <label>採点方式<select data-group-k="type" data-group="${esc(first.group)}">${typeOptions(first.type)}</select></label>
        <label>グループ配点<input data-group-k="groupPoints" data-group="${esc(first.group)}" type="number" min="0" step="0.5" value="${esc(gp)}"></label>
        <label>グループID<input value="${esc(first.group)}" disabled></label>
      </div>
      <div class="group-detail-rows">${rows.map((r,j)=>`<div class="group-detail-row" data-row="${indices[j]}"><label>設問名<input data-k="label" value="${esc(r.label)}"></label><label>正答<input data-k="answer" value="${esc(r.answer)}"></label><label>選択肢<input data-k="options" value="${esc(r.options)}" placeholder="0,1,2,3"></label></div>`).join('')}</div>
    </details>
  </article>`;
}
function renderSingleCard(r,i){
  const c=answerChoiceButtons(r,i),od=c.od;
  return `<article class="review-question-card ${r.confidence==='要確認'?'needs-review':''}" data-row="${i}">
    <div class="review-question-top">
      <span class="review-number">${i+1}</span>
      <div class="review-question-title">
        <input class="review-label-input" data-k="label" value="${esc(r.label)}" placeholder="設問名">
        <div class="review-meta-line"><span class="review-status ${r.confidence==='高'?'ok-status':'warn-status'}">${r.confidence}</span><span>${esc(r.type==='normal'?'通常':r.type.includes('unordered')?'順不同':'完答')}</span>${od.inferred?'<span class="inferred-tag">選択肢は仮表示</span>':''}</div>
      </div>
      <div class="review-card-actions"><button class="row-move" data-move="${i}" data-dir="-1" type="button" title="上へ移動">↑</button><button class="row-move" data-move="${i}" data-dir="1" type="button" title="下へ移動">↓</button><button class="row-delete" data-del="${i}" type="button">×</button></div>
    </div>
    <div class="review-answer-zone">
      <div class="review-answer-caption">読み取った正答 <strong>${esc(r.answer||'未設定')}</strong></div>
      ${c.html?`<div class="choices review-choices">${c.html}</div>`:'<div class="notice small">選択肢を認識できていません。下の「詳細設定」で選択肢を入力してください。</div>'}
      <button type="button" class="choice-edit-btn" data-edit-options="${i}">この設問の選択肢を変更</button>
    </div>
    <details class="review-detail-settings">
      <summary>詳細設定を確認・修正</summary>
      <div class="review-detail-grid">
        <label>大問<input data-k="section" value="${esc(r.section)}"></label>
        <label>正答<input data-k="answer" value="${esc(r.answer)}"></label>
        <label>配点<input data-k="points" type="number" min="0" step="0.5" value="${esc(r.points)}"></label>
        <label>採点方式<select data-k="type">${typeOptions(r.type)}</select></label>
        <label>グループ<input data-k="group" value="${esc(r.group)}" placeholder="自動設定"></label>
        <label>グループ配点<input data-k="groupPoints" type="number" min="0" step="0.5" value="${esc(r.groupPoints)}"></label>
        <label class="review-options-field">選択肢<input data-k="options" value="${esc(r.options)}" placeholder="0,1,2,3"></label>
      </div>
    </details>
  </article>`;
}
function renderEditor(){
  const root=$('examEditorCards');if(!root)return;
  let html='',lastSection='';const used=new Set();
  editorRows.forEach((r,i)=>{
    if(used.has(i))return;
    if(r.section!==lastSection){html+=`<div class="review-section-heading"><span class="section-eyebrow">SECTION</span><h3>${esc(r.section||'大問未設定')}</h3></div>`;lastSection=r.section}
    const peers=groupPeers(i);
    if(peers.length>1&&r.group&&['complete_item','unordered_complete_item'].includes(r.type)){
      const indices=peers.map(x=>editorRows.indexOf(x));indices.forEach(x=>used.add(x));html+=renderGroupCard(peers,indices);
    }else{used.add(i);html+=renderSingleCard(r,i)}
  });
  root.innerHTML=html||'<div class="notice">設問がありません。</div>';
  root.querySelectorAll('[data-k]').forEach(el=>el.addEventListener('change',e=>{
    const row=e.target.closest('[data-row]'),i=Number(row.dataset.row),k=e.target.dataset.k;
    editorRows[i][k]=e.target.value;editorRows[i].confidence='確認済';
    if(['section','answer','options','type','group'].includes(k))renderEditor();else updateParseSummary();
  }));
  root.querySelectorAll('[data-group-k]').forEach(el=>el.addEventListener('change',e=>{
    const group=e.target.dataset.group,k=e.target.dataset.groupK,v=e.target.value;
    editorRows.filter(r=>r.group===group).forEach(r=>{r[k]=v;r.confidence='確認済'});renderEditor();
  }));
  root.querySelectorAll('[data-answer-row]').forEach(b=>b.onclick=()=>{
    const i=Number(b.dataset.answerRow);editorRows[i].answer=b.dataset.answer;editorRows[i].confidence='確認済';renderEditor();
  });
  root.querySelectorAll('[data-edit-options]').forEach(b=>b.onclick=()=>{
    const i=Number(b.dataset.editOptions);
    const card=b.closest('.review-question-card');
    const details=card?.querySelector('.review-detail-settings');
    if(details)details.open=true;
    const input=card?.querySelector(`.group-detail-row[data-row="${i}"] input[data-k="options"]`)||card?.querySelector('input[data-k="options"]');
    if(input){input.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>{input.focus();if(input.select)input.select()},250)}
  });
  root.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>moveEditorBlock(Number(b.dataset.move),Number(b.dataset.dir)));
  root.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{editorRows.splice(Number(b.dataset.del),1);renderEditor()});
  root.querySelectorAll('[data-del-group]').forEach(b=>b.onclick=()=>{const g=b.dataset.delGroup;editorRows=editorRows.filter(r=>r.group!==g);renderEditor()});
  updateParseSummary();
}
function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function updateParseSummary(){
  const n=editorRows.length,uncertain=editorRows.filter(r=>r.confidence==='要確認').length,special=editorRows.filter(r=>r.type!=='normal').length,sections=new Set(editorRows.map(r=>r.section).filter(Boolean)).size;
  $('parseSummary').innerHTML=`<div class="kpi"><div class="muted small">認識設問</div><div class="value">${n}</div></div><div class="kpi"><div class="muted small">大問</div><div class="value">${sections}</div></div><div class="kpi"><div class="muted small">特殊採点</div><div class="value">${special}</div></div><div class="kpi ${uncertain?'kpi-warn':''}"><div class="muted small">要確認</div><div class="value">${uncertain}</div></div>`;
  renderSectionPointsSummary();
}
function applyDefaultOptions(){applyConfiguredOptionsToAllRows()}
function rowPointTotal(rows=editorRows){
  let total=0,seen=new Set();
  for(const r of rows){if(['complete_item','unordered_complete_item'].includes(r.type)){const g=r.group||`__row_${rows.indexOf(r)}`;if(seen.has(g))continue;seen.add(g);total+=Number(r.groupPoints||0)}else total+=Number(r.points||0)}
  return total;
}
function sectionActualPoints(section){return rowPointTotal(editorRows.filter(r=>r.section===section))}
function renderSectionPointsSummary(){
  const root=$('sectionPointsSummary');if(!root)return;
  const sections=[...new Set([...Object.keys(editorSectionTargets),...editorRows.map(r=>r.section).filter(Boolean)])];
  const cards=sections.map(sec=>{const actual=sectionActualPoints(sec),expected=editorSectionTargets[sec],known=Number.isFinite(Number(expected)),ok=!known||Math.abs(actual-Number(expected))<.0001;return `<div class="section-score-card ${ok?'ok':'warn'}"><span>${esc(sec)}</span><strong>${actual}${known?` / ${Number(expected)}`:''}点</strong><small>${known?(ok?'✓ 配点一致':'⚠ 要確認'):'大問配点未取得'}</small></div>`}).join('');
  const total=rowPointTotal(),target=Number($('examTotalPoints').value)||100,totalOk=Math.abs(total-target)<.0001;
  root.innerHTML=`${cards}<div class="section-score-card total ${totalOk?'ok':'warn'}"><span>合計</span><strong>${total} / ${target}点</strong><small>${totalOk?'✓ 満点と一致':'⚠ 合計点を確認'}</small></div>`;
}
function checkPoints(){
  renderSectionPointsSummary();
  const total=rowPointTotal(),target=Number($('examTotalPoints').value)||100,totalOk=Math.abs(total-target)<0.0001;
  const sectionErrors=Object.entries(editorSectionTargets).filter(([sec,expected])=>Math.abs(sectionActualPoints(sec)-Number(expected))>.0001);
  const ok=totalOk&&!sectionErrors.length;
  $('pointsCheckMsg').className=(ok?'success':'error')+' small';
  $('pointsCheckMsg').textContent=ok?`配点チェックOK：大問別・合計とも一致しています（${total}/${target}点）。`:`配点を確認してください：合計 ${total}/${target}点${sectionErrors.length?` / 不一致：${sectionErrors.map(([s])=>s).join('、')}`:''}`;
  return ok;
}
function cleanGoogleFormUrlInput(raw){
  let text=String(raw||'').trim().replace(/&amp;/g,'&').replace(/\\&/g,'&');
  const m=text.match(/https:\/\/docs\.google\.com\/forms\/[^\s\])>]+/i);
  if(m)text=m[0];
  return text;
}
function googleFormEndpoints(raw){
  const cleaned=cleanGoogleFormUrlInput(raw);
  const u=new URL(cleaned);
  if(u.hostname!=='docs.google.com'||!u.pathname.includes('/forms/'))throw new Error('GoogleフォームのURLを貼り付けてください。');
  let path=u.pathname.replace(/\/(viewform|formResponse)\/?$/,'');
  if(path===u.pathname)throw new Error('Googleフォームの viewform / formResponse URLを確認してください。');
  const base=`${u.origin}${path}`;
  return {viewUrl:`${base}/viewform`,actionUrl:`${base}/formResponse`,formKey:path};
}
function googleFormEntryLabel(e,i){
  const v=String(e?.value??'');
  const short=v.length>24?`${v.slice(0,24)}…`:v;
  return `${i+1}. ${e.key}${short?` （${short}）`:''}`;
}
function googleEntryOptions(selected=''){
  return '<option value="">選択してください</option>'+googleFormSetup.entries.map((e,i)=>`<option value="${esc(e.key)}" ${e.key===selected?'selected':''}>${esc(googleFormEntryLabel(e,i))}</option>`).join('');
}
function currentEditorSignature(){return editorRows.map(r=>`${r.section}|${r.label}`).join('||')}
function entryByKey(key){return googleFormSetup.entries.find(e=>e.key===key)||null}
function detectGoogleIdentityEntries(entries){
  const code=entries.find(e=>/^\d{4}$/.test(String(e.value||'').trim()));
  const answerLike=v=>/^(?:\d{1,2}|[a-z])$/i.test(String(v||'').trim());
  const name=entries.find(e=>e!==code&&!answerLike(e.value))||entries.find(e=>e!==code)||null;
  return {nameEntry:name?.key||'',codeEntry:code?.key||''};
}
function analyzeGoogleFormLink(){
  try{
    const raw=$('formPrefillUrl').value.trim();if(!raw)throw new Error('事前入力したリンクを貼り付けてください。');
    const ep=googleFormEndpoints(raw),u=new URL(cleanGoogleFormUrlInput(raw));
    const entries=[];
    for(const [key,value] of u.searchParams.entries())if(/^entry\.\d+$/.test(key))entries.push({key,value});
    if(entries.length<3)throw new Error('entry番号を十分に取得できませんでした。氏名・4桁番号・解答欄をすべて事前入力してからリンクを取得してください。');
    googleFormSetup={entries,viewUrl:ep.viewUrl,actionUrl:ep.actionUrl,formKey:ep.formKey,testAttempted:false};
    $('formUrl').value=ep.viewUrl;
    const ids=detectGoogleIdentityEntries(entries);
    $('formNameEntrySelect').innerHTML=googleEntryOptions(ids.nameEntry);
    $('formCodeEntrySelect').innerHTML=googleEntryOptions(ids.codeEntry);
    $('formMappingPanel').classList.remove('hidden');
    $('autoMapFormBtn').disabled=false;
    $('formTestConfirmed').checked=false;
    renderGoogleFormAnswerTable();
    autoMapGoogleFormAnswers(true);
    $('formLinkMsg').className='success small';
    $('formLinkMsg').textContent=`entry番号を ${entries.length}件 取得しました。GoogleフォームURLもこのフォームに設定しました。氏名・4桁番号・解答欄の対応を確認してください。`;
  }catch(e){console.error(e);$('formLinkMsg').className='error small';$('formLinkMsg').textContent=e.message}
}
function renderGoogleFormAnswerTable(){
  const body=$('formAnswerMappingBody');if(!body)return;
  body.innerHTML=editorRows.map((r,i)=>`<tr data-form-map-row="${i+1}"><td><strong>${esc(r.label||`解答${i+1}`)}</strong><small>${esc(r.section||'')}</small></td><td><select class="form-answer-entry" data-q-index="${i+1}">${googleEntryOptions()}</select></td><td class="form-map-value">—</td></tr>`).join('');
  $('formMappingPanel').dataset.signature=currentEditorSignature();
  body.querySelectorAll('.form-answer-entry').forEach(sel=>sel.onchange=()=>{updateGoogleMapValue(sel);renderGoogleFormStatus()});
}
function updateGoogleMapValue(sel){
  const tr=sel.closest('tr'),e=entryByKey(sel.value);if(tr?.querySelector('.form-map-value'))tr.querySelector('.form-map-value').textContent=e?String(e.value||'(空欄)'):'—';
}
function autoMapGoogleFormAnswers(force=true){
  if(!googleFormSetup.entries.length||$('formMappingPanel').classList.contains('hidden'))return;
  if($('formMappingPanel').dataset.signature!==currentEditorSignature())renderGoogleFormAnswerTable();
  const name=$('formNameEntrySelect').value,code=$('formCodeEntrySelect').value;
  const candidates=googleFormSetup.entries.filter(e=>e.key!==name&&e.key!==code);
  const sels=[...document.querySelectorAll('.form-answer-entry')];
  sels.forEach((sel,i)=>{if(force||!sel.value)sel.value=candidates[i]?.key||'';updateGoogleMapValue(sel)});
  renderGoogleFormStatus();
}
function googleFormMappingState(){
  const nameEntry=$('formNameEntrySelect')?.value||'',codeEntry=$('formCodeEntrySelect')?.value||'';
  const sels=[...document.querySelectorAll('.form-answer-entry')];
  const answerEntries=sels.map((sel,i)=>({questionId:i+1,entry:sel.value||''}));
  const used=[nameEntry,codeEntry,...answerEntries.map(x=>x.entry)].filter(Boolean),dups=used.filter((x,i)=>used.indexOf(x)!==i);
  const signatureOk=$('formMappingPanel')?.dataset.signature===currentEditorSignature();
  const mapped=answerEntries.filter(x=>x.entry).length;
  const unused=googleFormSetup.entries.filter(e=>!used.includes(e.key));
  const ok=!!googleFormSetup.actionUrl&&!!nameEntry&&!!codeEntry&&nameEntry!==codeEntry&&mapped===editorRows.length&&!dups.length&&signatureOk;
  return {ok,nameEntry,codeEntry,answerEntries,mapped,dups:[...new Set(dups)],unused,signatureOk};
}
function renderGoogleFormStatus(){
  const root=$('formMappingKpis');if(!root||$('formMappingPanel').classList.contains('hidden'))return;
  const st=googleFormMappingState(),entryCount=googleFormSetup.entries.length,tested=$('formTestConfirmed')?.checked;
  root.innerHTML=`<div class="kpi"><div class="muted small">取得entry</div><div class="value">${entryCount}</div></div><div class="kpi ${st.nameEntry?'':'kpi-warn'}"><div class="muted small">氏名</div><div class="value">${st.nameEntry?'✓':'—'}</div></div><div class="kpi ${st.codeEntry?'':'kpi-warn'}"><div class="muted small">4桁番号</div><div class="value">${st.codeEntry?'✓':'—'}</div></div><div class="kpi ${st.mapped===editorRows.length?'':'kpi-warn'}"><div class="muted small">解答対応</div><div class="value">${st.mapped}/${editorRows.length}</div></div>`;
  let msg=[];
  if(!st.signatureOk)msg.push('設問構成が変更されています。自動対応をやり直してください。');
  if(st.dups.length)msg.push('同じentryが複数項目に使われています。');
  if(st.mapped<editorRows.length){
    const shortage=editorRows.length-st.mapped;
    msg.push(`Googleフォームの解答欄が ${shortage}件不足しています。事前入力リンクを作るときに、すべての解答欄へ値を入れたか確認してリンクを取り直してください。`);
  }
  if(st.unused?.length)msg.push(`未使用のGoogleフォーム項目が ${st.unused.length}件あります。必須項目の場合は送信できないため、テスト送信で必ず確認してください。`);
  if(st.ok)msg.push(`連携設定OK：氏名・4桁番号・解答 ${st.mapped}件を送信できます。${tested?' テスト受信確認済みです。':' テスト送信後にGoogleフォーム側で受信を確認してください。'}`);
  $('formLinkMsg').className=(st.ok?'success':'error')+' small';
  $('formLinkMsg').textContent=msg.join(' ')||(st.ok?'連携設定OKです。':'連携項目を確認してください。');
  const next=$('formNextStepMsg');if(next)next.classList.toggle('hidden',!(st.ok&&tested));
}
function resetGoogleFormLink(){
  googleFormSetup={entries:[],viewUrl:'',actionUrl:'',testAttempted:false};
  $('formPrefillUrl').value='';$('formMappingPanel').classList.add('hidden');$('formAnswerMappingBody').innerHTML='';$('formNameEntrySelect').innerHTML='';$('formCodeEntrySelect').innerHTML='';$('formTestConfirmed').checked=false;$('autoMapFormBtn').disabled=true;
  if($('formNextStepMsg'))$('formNextStepMsg').classList.add('hidden');
  $('formLinkMsg').className='small muted';$('formLinkMsg').textContent='Googleフォーム連携設定をリセットしました。通常のGoogleフォームURL欄はそのまま残しています。';
}

function buildGoogleFormSubmissionConfig(questions){
  if(!googleFormSetup.actionUrl)return null;
  const st=googleFormMappingState();
  if(!st.ok)throw new Error('Googleフォーム連携の対応に未設定または重複があります。連携情報を確認してください。');
  if(questions.length!==st.answerEntries.length)throw new Error('Googleフォームの解答対応数と現在の設問数が一致しません。自動対応をやり直してください。');
  return {provider:'google_forms',version:1,actionUrl:googleFormSetup.actionUrl,nameEntry:st.nameEntry,studentCodeEntry:st.codeEntry,questionEntries:st.answerEntries.map((x,i)=>({questionId:questions[i].id,entry:x.entry})),nameRequired:true,testConfirmed:!!$('formTestConfirmed').checked,configuredAt:new Date().toISOString()};
}
function postGoogleForm(actionUrl,fields){
  return new Promise((resolve,reject)=>{
    try{
      if(!navigator.onLine)throw new Error('ネットワークに接続されていません。');
      const frame=document.createElement('iframe');frame.name=`tdx_form_${Date.now()}_${Math.random().toString(36).slice(2)}`;frame.style.display='none';frame.setAttribute('aria-hidden','true');document.body.appendChild(frame);
      const form=document.createElement('form');form.method='POST';form.action=actionUrl;form.target=frame.name;form.style.display='none';form.acceptCharset='UTF-8';
      Object.entries(fields).forEach(([k,v])=>{const input=document.createElement('input');input.type='hidden';input.name=k;input.value=String(v??'');form.appendChild(input)});
      [['fvv','1'],['pageHistory','0']].forEach(([k,v])=>{const input=document.createElement('input');input.type='hidden';input.name=k;input.value=v;form.appendChild(input)});
      document.body.appendChild(form);
      let done=false;const finish=()=>{if(done)return;done=true;setTimeout(()=>frame.remove(),150);resolve()};
      frame.onload=()=>finish();
      HTMLFormElement.prototype.submit.call(form);form.remove();setTimeout(finish,2500);
    }catch(e){reject(e)}
  });
}
async function testGoogleFormSubmission(){
  try{
    const st=googleFormMappingState();if(!st.ok)throw new Error('先に氏名・4桁番号・解答欄の対応を完成させてください。');
    const fields={};
    const nameSample=entryByKey(st.nameEntry)?.value||'T-DXテスト';
    const codeSample=entryByKey(st.codeEntry)?.value||'3301';
    fields[st.nameEntry]=nameSample;fields[st.codeEntry]=/^\d{4}$/.test(codeSample)?codeSample:'3301';
    st.answerEntries.forEach((m,i)=>{const sample=entryByKey(m.entry)?.value||configuredChoices()[0]||'0';fields[m.entry]=sample});
    $('testGoogleFormBtn').disabled=true;$('formTestMsg').className='small muted';$('formTestMsg').textContent='Googleフォームへテスト送信しています…';
    await postGoogleForm(googleFormSetup.actionUrl,fields);googleFormSetup.testAttempted=true;
    $('formTestMsg').className='success small';$('formTestMsg').textContent='テスト送信処理を実行しました。Googleフォームの「回答」タブを開き、1件追加されていることを確認したら「受信を確認した」にチェックしてください。';
  }catch(e){console.error(e);$('formTestMsg').className='error small';$('formTestMsg').textContent=e.message}finally{$('testGoogleFormBtn').disabled=false}
}

function makeExamId(){let id;do{id=`exam_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${TDX.randomCode(6).toLowerCase()}`}while(exams.some(e=>e.id===id));return id}
function buildExamFromEditor(){
  const title=$('examName').value.trim(),subject=$('examSubjectInput').value.trim(),googleFormUrl=$('formUrl').value.trim(),target=Number($('examTotalPoints').value)||100;
  if(!title||!subject)throw new Error('試験名と教科を入力してください。');if(!editorRows.length)throw new Error('設問がありません。');
  const rows=editorRows.map(r=>({...r,section:r.section.trim(),label:r.label.trim(),answer:String(r.answer).trim(),points:Number(r.points||0),group:r.group.trim(),groupPoints:Number(r.groupPoints||0),options:String(r.options||configuredOptionsCsv()).split(/[,、\s]+/).map(x=>x.trim()).filter(Boolean)}));
  if(rows.some(r=>!r.section||!r.label||r.answer===''))throw new Error('大問・設問名・正答の空欄を確認してください。');
  const sectionNames=[...new Set(rows.map(r=>r.section))],sectionMap=new Map(sectionNames.map((n,i)=>[n,`s${i+1}`]));
  const questions=rows.map((r,i)=>({id:i+1,section:sectionMap.get(r.section),label:r.label,answer:r.answer,points:r.type==='complete_item'||r.type==='unordered_complete_item'?0:r.points,options:r.options.length?r.options:['0','1','2','3'],type:r.type,...(r.group?{group:r.group}:{}),...(['complete_item','unordered_complete_item'].includes(r.type)?{groupPoints:r.groupPoints}:{})}));
  const groups={};questions.forEach(q=>{if(q.group)(groups[q.group]??=[]).push(q)});Object.values(groups).forEach(gs=>{if(gs[0]?.type==='unordered_complete_item'){const answers=gs.map(q=>String(q.answer));gs.forEach(q=>q.groupAnswers=answers)}});
  const sections=sectionNames.map(name=>{const id=sectionMap.get(name),qs=questions.filter(q=>q.section===id);let points=0,seen=new Set();qs.forEach(q=>{if(['complete_item','unordered_complete_item'].includes(q.type)){if(!seen.has(q.group)){seen.add(q.group);points+=Number(q.groupPoints||0)}}else points+=Number(q.points||0)});return {id,name,points}});
  let formSubmission=null;
  if(googleFormUrl){
    if(!googleFormSetup.actionUrl)throw new Error('GoogleフォームURLが設定されています。事前入力リンクを貼り付けて「連携情報を解析」を完了してください。');
    const currentKey=googleFormEndpoints(googleFormUrl).formKey;if(currentKey!==googleFormSetup.formKey)throw new Error('GoogleフォームURLと事前入力リンクが別のフォームです。連携情報を解析し直してください。');
    formSubmission=buildGoogleFormSubmissionConfig(questions);
  }
  return {id:makeExamId(),title,subject,schoolYear:String(new Date().getFullYear()),status:'unpublished',published:false,totalPoints:target,googleFormUrl,formSubmission,choiceConfig:{options:configuredChoices(),label:choiceRangeLabel()},access:{mode:'restricted',classes:[],students:[]},sections,questions,createdAt:new Date().toISOString()};
}
function saveDraft(){
  try{const draft={title:$('examName').value.trim(),subject:$('examSubjectInput').value.trim(),totalPoints:$('examTotalPoints').value,googleFormUrl:$('formUrl').value.trim(),googleFormPrefillUrl:$('formPrefillUrl').value.trim(),pdfText:$('pdfText').value,pastedAnswerText:$('answerTextInput').value,choiceConfig:{numbers:$('useNumberChoices').checked,numberStart:$('numberChoiceStart').value,numberEnd:$('numberChoiceEnd').value,letters:$('useLetterChoices').checked,letterStart:$('letterChoiceStart').value,letterEnd:$('letterChoiceEnd').value,kana:$('useKanaChoices').checked,kanaStart:$('kanaChoiceStart').value,kanaEnd:$('kanaChoiceEnd').value},sectionTargets:editorSectionTargets,editorRows,createdAt:new Date().toISOString()};localStorage.setItem('tdxDraftExam',JSON.stringify(draft));$('draftExamMsg').className='success small';$('draftExamMsg').textContent='編集内容をこのブラウザに保存しました。'}catch(e){$('draftExamMsg').className='error small';$('draftExamMsg').textContent=e.message}
}
function registerExam(){
  try{
    const exam=buildExamFromEditor(),total=rowPointTotal();
    const sectionErrors=Object.entries(editorSectionTargets).filter(([sec,expected])=>Math.abs(sectionActualPoints(sec)-Number(expected))>.0001);
    const warnings=[];
    if(Math.abs(total-exam.totalPoints)>0.0001)warnings.push(`合計配点：${total}点 / 満点設定：${exam.totalPoints}点`);
    if(sectionErrors.length)warnings.push(`大問別配点の不一致：${sectionErrors.map(([sec,expected])=>`${sec} ${sectionActualPoints(sec)}/${expected}点`).join('、')}`);
    if(editorRows.some(r=>r.confidence==='要確認'))warnings.push(`要確認の解答欄：${editorRows.filter(r=>r.confidence==='要確認').length}件`);
    if(exam.formSubmission&&!exam.formSubmission.testConfirmed)warnings.push('Googleフォームのテスト送信は設定済みですが、受信確認のチェックがまだありません');
    if(warnings.length&&!confirm(`公開前に確認したい項目があります。\n\n${warnings.join('\n')}\n\nこのまま非公開の試験データとして登録しますか？`))return;
    exams.push(exam);allExamData.exams=exams;refreshExamSelects(exam.id);
    const formStatus=exam.formSubmission?' / Googleフォーム連携済み':' / Googleフォーム連携なし';
    $('draftExamMsg').className='success small';$('draftExamMsg').innerHTML=`<strong>✓ 模範解答・採点設定の登録が完了しました。</strong><br>試験：${esc(exam.title)} / 試験ID：<code>${esc(exam.id)}</code>${formStatus}<br><span class="publish-next-warning">⚠ まだ生徒には公開されていません。</span><div class="actions compact-actions"><button type="button" id="goPublishFromRegister" class="orange">受験者・公開設定へ進む</button></div>`;
    $('publishSubjectSelect').value=exam.subject;refreshPublishSelectors(exam.id);loadPublishExam();renderExamExportSummary();
    requestAnimationFrame(()=>{const b=$('goPublishFromRegister');if(b)b.onclick=()=>{showSection('publishManager');$('publishSubjectSelect').value=exam.subject;refreshPublishSelectors(exam.id);loadPublishExam()}});
  }catch(e){$('draftExamMsg').className='error small';$('draftExamMsg').textContent=e.message}
}

async function readRows(file){
  if(/\.csv$/i.test(file.name))return TDX.csvParse(await file.text());
  if(!window.XLSX)throw new Error('Excel読込ライブラリを準備できませんでした。CSVで読み込むか、通信状態を確認して再読み込みしてください。');
  const buf=await file.arrayBuffer(),wb=XLSX.read(buf,{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:''});
}
async function analyzeFile(){const f=$('responseFile').files[0];if(!f){alert('CSVまたはXLSXを選択してください。');return}analysisExam=exams.find(e=>e.id===$('analysisExam').value);const rows=await readRows(f);if(rows.length<2){alert('回答データが見つかりません。');return}const qCount=analysisExam.questions.length;analysisRows=[];for(const r of rows.slice(1)){const code=String(r[2]||'').trim();if(!/^\d{4}$/.test(code))continue;const ansVals=r.slice(r.length-qCount),answers={};analysisExam.questions.forEach((q,i)=>answers[q.id]=String(ansVals[i]??'').trim());const score=TDX.scoreExam(analysisExam,answers);analysisRows.push({code,classKey:code.slice(0,Number($('classDigits').value)||2),answers,score})}if(!analysisRows.length){alert('4桁番号を含む回答行を認識できませんでした。');return}const classes=[...new Set(analysisRows.map(r=>r.classKey))].sort();$('classFilter').innerHTML='<option value="ALL">全クラス</option>'+classes.map(c=>`<option value="${c}">${c}</option>`).join('');$('analysisOutput').classList.remove('hidden');renderAnalysis()}
function renderAnalysis(){if(!analysisRows.length)return;const key=$('classFilter').value,rows=key==='ALL'?analysisRows:analysisRows.filter(r=>r.classKey===key),scores=rows.map(r=>r.score.total),avg=scores.reduce((a,b)=>a+b,0)/scores.length,max=Math.max(...scores),min=Math.min(...scores);$('analysisKpis').innerHTML=`<div class="kpi"><div class="muted small">回答者</div><div class="value">${rows.length}</div></div><div class="kpi"><div class="muted small">平均点</div><div class="value">${avg.toFixed(1)}</div></div><div class="kpi"><div class="muted small">最高点</div><div class="value">${max}</div></div><div class="kpi"><div class="muted small">最低点</div><div class="value">${min}</div></div>`;renderHistogram(scores);renderSections(rows);renderQuestionRates(rows)}
function renderHistogram(scores){const bins=Array(10).fill(0);scores.forEach(s=>bins[Math.min(9,Math.floor(s/10))]++);const m=Math.max(...bins,1);$('histogram').innerHTML=bins.map((n,i)=>`<div class="col"><div class="stick" style="height:${Math.max(2,n/m*180)}px" title="${n}人"></div><div class="lab">${i*10}-${i===9?100:i*10+9}<br>${n}人</div></div>`).join('')}
function renderSections(rows){$('sectionAnalysis').innerHTML=analysisExam.sections.map(s=>{const sum=rows.reduce((a,r)=>a+(r.score.sectionScores[s.id]||0),0),pct=sum/(rows.length*s.points)*100;return `<div class="bar-row"><strong>${s.name}</strong><div class="bar"><div style="width:${pct.toFixed(1)}%"></div></div><div>${pct.toFixed(1)}%</div></div>`}).join('')}
function renderQuestionRates(rows){const body=$('questionRates');body.innerHTML='';analysisExam.questions.forEach(q=>{let ok=0;rows.forEach(r=>{const d=r.score.detail.find(x=>x.q.id===q.id);if(d&&d.correct)ok++});const pct=ok/rows.length*100;body.insertAdjacentHTML('beforeend',`<tr><td>${q.label}</td><td>${pct.toFixed(1)}%</td><td>${ok}/${rows.length}</td></tr>`)})}
function loadPublishExam(){
  const exam=exams.find(e=>e.id===$('publishExamSelect')?.value);
  if(!exam){
    if($('audienceBuilder'))$('audienceBuilder').innerHTML='<div class="notice">先にSTEP 1で試験を登録してください。</div>';
    if($('publishSchedulePanel'))$('publishSchedulePanel').classList.add('hidden');
    if($('currentPublishState'))$('currentPublishState').innerHTML='';
    if($('examReadiness'))$('examReadiness').innerHTML='';
    if($('studentExamPreview'))$('studentExamPreview').innerHTML='<div class="notice small">試験を選択してください。</div>';
    return;
  }
  $('publishExamSelect').value=exam.id;
  if($('publishStatusSelect'))$('publishStatusSelect').value=examStoredStatus(exam);
  if($('publishStartAt'))$('publishStartAt').value=toDatetimeLocal(exam?.publishWindow?.startAt);
  if($('publishEndAt'))$('publishEndAt').value=toDatetimeLocal(exam?.publishWindow?.endAt);
  updatePublishScheduleVisibility();
  renderCurrentPublishState(exam);
  renderExamReadiness(exam);
  buildAudience();renderRegisteredRosterSummary();
  requestAnimationFrame(()=>{applyExistingAudience(exam);if(!$('examPreviewPanel')?.classList.contains('hidden'))renderExamPreview(previewMode)});
}
function updatePublishScheduleVisibility(){
  const published=$('publishStatusSelect')?.value==='published';
  $('publishSchedulePanel')?.classList.toggle('hidden',!published);
}
function renderCurrentPublishState(exam){
  const root=$('currentPublishState');if(!root)return;
  const state=examEffectiveStatus(exam),label=examStatusLabel(exam),schedule=scheduleSummary(exam);
  const detail=state==='scheduled'?'開始日時になると自動で生徒画面に表示されます。':state==='published'?'現在、生徒画面に表示される状態です。':state==='ended_auto'?'終了日時を過ぎたため自動で非表示になっています。':state==='ended'?'手動で終了したため生徒画面には表示されません。':'生徒画面には表示されません。';
  root.innerHTML=`<div class="publish-live-state ${examStatusClass(exam)}"><span>${label}</span><strong>${esc(schedule||'期間設定なし')}</strong><small>${detail}</small></div>`;
}

function examAudienceCodes(exam){
  const a=exam?.access||{};
  if(a.mode==='all')return usersData.users.map(u=>u.studentCode).filter(Boolean);
  const classes=new Set(a.classes||[]),students=new Set(a.students||[]);
  usersData.users.forEach(u=>{const code=String(u.studentCode||'');const cls=String(u.classKey||code.slice(0,2));if(classes.has(cls))students.add(code)});
  return [...students].filter(Boolean);
}
function renderExamReadiness(exam){
  const root=$('examReadiness');if(!root)return;
  if(!exam){root.innerHTML='';return}
  const qCount=(exam.questions||[]).length;
  const scoreReady=qCount>0&&(exam.sections||[]).length>0;
  const hasForm=!!String(exam.googleFormUrl||'').trim();
  const formReady=!hasForm||!!exam.formSubmission;
  const formConfirmed=!hasForm||!!exam.formSubmission?.testConfirmed;
  const audience=examAudienceCodes(exam).length;
  const stored=examStoredStatus(exam);
  const scheduleReady=stored!=='published'||(!!parseExamDate(exam?.publishWindow?.startAt)&&!!parseExamDate(exam?.publishWindow?.endAt));
  const chips=[
    `<span class="ready-chip ${scoreReady?'ok':'warn'}">採点設定 ${scoreReady?'✓':'未設定'}</span>`,
    `<span class="ready-chip ${formReady&&formConfirmed?'ok':formReady?'mid':'warn'}">Googleフォーム ${!hasForm?'なし':formConfirmed?'✓':formReady?'受信未確認':'未設定'}</span>`,
    `<span class="ready-chip ${audience?'ok':'warn'}">受験対象 ${audience?`${audience}人`:'未設定'}</span>`,
    `<span class="ready-chip ${scheduleReady?'ok':'warn'}">公開期間 ${stored==='published'?(scheduleReady?'✓':'未設定'):'—'}</span>`
  ];
  root.innerHTML=`<div class="readiness-main"><strong>${esc(exam.subject||'教科未設定')}</strong><span>${esc(exam.title||'(無題)')}</span><small>${qCount}解答欄 / ${Number(exam.totalPoints||0)}点</small></div><div class="readiness-chips">${chips.join('')}</div>`;
}
function uniqueCloneTitle(base){
  let title=`${base}【複製】`,n=2;
  while(exams.some(e=>e.title===title)){title=`${base}【複製${n}】`;n++}
  return title;
}
function cloneCurrentExam(){
  const exam=exams.find(e=>e.id===$('publishExamSelect')?.value);if(!exam)return;
  const defaultTitle=uniqueCloneTitle(exam.title||'試験');
  const entered=prompt('複製後の試験名を入力してください。',defaultTitle);if(entered===null)return;
  const newTitle=entered.trim()||defaultTitle;
  if(exams.some(e=>e.title===newTitle)&&!confirm(`同じ試験名「${newTitle}」がすでにあります。この名前で複製しますか？`))return;
  const clone=JSON.parse(JSON.stringify(exam));
  clone.id=makeExamId();
  clone.title=newTitle;
  clone.status='unpublished';clone.published=false;clone.publishWindow=null;clone.endedAt=null;
  clone.access={mode:'restricted',classes:[],students:[]};
  clone.createdAt=new Date().toISOString();clone.updatedAt=clone.createdAt;clone.clonedFrom=exam.id;
  exams.push(clone);allExamData.exams=exams;
  refreshExamSelects(clone.id);
  if($('publishSubjectSelect'))$('publishSubjectSelect').value=clone.subject||'';
  refreshPublishSelectors(clone.id);if($('publishExamSelect'))$('publishExamSelect').value=clone.id;
  loadPublishExam();renderExamExportSummary();
  $('publishMsg').className='success small';
  $('publishMsg').innerHTML=`<strong>✓ 「${esc(exam.title)}」を複製しました。</strong> 正答・配点・設問ごとの選択肢${exam.formSubmission?'・Googleフォーム連携':''}を引き継ぎ、<strong>非公開・受験対象未設定</strong>で作成しています。試験名と公開設定を確認してください。`;
}
function toggleExamPreview(){
  const panel=$('examPreviewPanel');if(!panel)return;
  const willOpen=panel.classList.contains('hidden');panel.classList.toggle('hidden',!willOpen);
  if(willOpen)renderExamPreview(previewMode);
}
function renderExamPreview(mode='before'){
  previewMode=mode;
  document.querySelectorAll('.previewModeBtn').forEach(b=>b.classList.toggle('active',b.dataset.previewMode===mode));
  const root=$('studentExamPreview');if(!root)return;
  const exam=exams.find(e=>e.id===$('publishExamSelect')?.value);
  if(!exam){root.innerHTML='<div class="notice small">試験を選択してください。</div>';return}
  if(mode!=='live'){
    const before=mode==='before';
    root.innerHTML=`<div class="preview-hidden-state ${before?'before':'after'}"><div class="preview-eye">${before?'◷':'✓'}</div><div><strong>${before?'公開開始前：生徒の試験一覧には表示されません':'公開終了後：生徒の試験一覧から自動で消えます'}</strong><span>${before?'開始日時になると自動で表示されます。':'試験データは教員画面に残るため、分析や再利用ができます。'}</span></div></div>`;
    return;
  }
  const deadline=formatLocalDateTime(exam?.publishWindow?.endAt)||'終了日時未設定';
  root.innerHTML=`<article class="student-preview-card"><div class="student-preview-top"><span class="exam-subject-chip"><small>教科</small><strong>${esc(exam.subject||'未設定')}</strong></span><span class="exam-public-chip">公開中</span></div><h3>${esc(exam.title||'(無題)')}</h3><div class="student-preview-meta"><span>${(exam.questions||[]).length}解答欄</span><span>${Number(exam.totalPoints||0)}点満点</span><span>受験期限 ${esc(deadline)}</span></div><button type="button" disabled>受験する</button></article><p class="preview-caption">※ 動作確認用プレビューです。実際の公開状態やデータは変更していません。</p>`;
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
  const status=$('publishStatusSelect')?.value||'unpublished';
  const selected=selectedAudienceCodes();
  if(status==='published'&&!selected.length){alert('公開する場合は受験対象生徒を選択してください。');return}
  let publishWindow=exam.publishWindow||null;
  if(status==='published'){
    const startValue=$('publishStartAt')?.value||'',endValue=$('publishEndAt')?.value||'';
    if(!startValue||!endValue){alert('自動公開では、公開開始日時と公開終了日時の両方を設定してください。');return}
    const start=new Date(startValue),end=new Date(endValue);
    if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())){alert('公開日時を確認してください。');return}
    if(start.getTime()>=end.getTime()){alert('公開終了日時は、公開開始日時より後に設定してください。');return}
    publishWindow={startAt:start.toISOString(),endAt:end.toISOString(),mode:'auto'};
  }
  const a=collectAudience();
  exam.status=status;exam.published=status==='published';
  exam.publishWindow=publishWindow;
  exam.endedAt=status==='ended'?new Date().toISOString():null;
  exam.access={mode:'restricted',classes:a.classes,students:a.students};
  exam.updatedAt=new Date().toISOString();
  allExamData.exams=exams;
  const effective=examStatusLabel(exam),windowText=scheduleSummary(exam);
  $('publishMsg').className='success small';
  $('publishMsg').innerHTML=`<strong>✓ 公開設定を反映しました。</strong> ${esc(effective)} / 対象 ${selected.length}人${windowText?` / ${esc(windowText)}`:''}<br><span>この変更をGitHubへ反映するには、最後に <code>exams.json</code> を書き出して担当者へ送付してください。自動終了後は再送付不要です。</span>`;
  refreshPublishSelectors(exam.id);$('publishExamSelect').value=exam.id;
  renderCurrentPublishState(exam);renderExamReadiness(exam);renderExamExportSummary();if(!$('examPreviewPanel')?.classList.contains('hidden'))renderExamPreview(previewMode);
}

function deleteCurrentExam(){
  const exam=exams.find(e=>e.id===$('publishExamSelect')?.value);if(!exam)return;
  const first=confirm(`「${exam.title}」をT-DX Labから完全に削除しますか？

終了とは違い、試験設定・模範解答・配点・Googleフォーム連携・公開設定が exams.json から削除されます。
Googleフォーム側に保存済みの回答は削除されません。`);
  if(!first)return;
  const typed=prompt('誤操作防止のため「削除」と入力してください。');
  if(typed!=='削除'){if(typed!==null)alert('入力が一致しないため削除しませんでした。');return}
  const id=exam.id,subject=exam.subject;
  exams=exams.filter(e=>e.id!==id);allExamData.exams=exams;
  if(analysisExam?.id===id)analysisExam=null;
  refreshExamSelects();
  if($('publishSubjectSelect')&&[...$('publishSubjectSelect').options].some(o=>o.value===subject))$('publishSubjectSelect').value=subject;
  refreshPublishSelectors();loadPublishExam();renderExamExportSummary();
  $('publishMsg').className='notice small';
  $('publishMsg').innerHTML=`<strong>「${esc(exam.title)}」をこの試験データから削除しました。</strong><br>GitHub上にも存在する試験の場合は、削除後の <code>exams.json</code> を書き出して担当者へ送付すると完全削除が反映されます。`;
}

function selectedAudienceCodes(){return [...document.querySelectorAll('.student-check:checked')].map(x=>x.value)}
function renderExamExportSummary(){
  const root=$('examExportSummary');if(!root)return;
  const list=(allExamData?.exams||exams||[]);
  const rows=list.map((e,i)=>{
    const a=e.access||{};
    const classText=(a.classes||[]).length?`${(a.classes||[]).join('・')}組`:'';
    const studentText=(a.students||[]).length?`${(a.students||[]).length}人個別`:'';
    const target=[classText,studentText].filter(Boolean).join('＋')||((!a||a.mode==='all')?'全員':'対象未設定');
    const formText=e.formSubmission?'Googleフォーム連携✓':(e.googleFormUrl?'Googleフォーム未連携':'フォームなし');
    const windowText=scheduleSummary(e);
    return `<div class="exam-export-row"><span class="exam-export-index">${i+1}</span><div><strong>${esc(e.title||'(無題)')}</strong><small>${esc(e.subject||'')} / ${examStatusLabel(e)}${windowText?` / ${esc(windowText)}`:''} / ${esc(target)} / ${formText}</small></div><span class="exam-export-state ${examStatusClass(e)}">${examStatusLabel(e)}</span></div>`;
  }).join('');
  root.innerHTML=`<div class="exam-export-head"><div><span class="section-eyebrow">EXPORT CONTENTS</span><h3>書き出す試験：${list.length}件</h3></div><small>exams.json は差分ではなく、登録済み試験をすべて含む累積ファイルです。</small></div>${rows||'<div class="notice small">登録済み試験はありません。</div>'}<div class="github-upload-note"><strong>GitHub反映先：<code>data/exams.json</code></strong><span>ダウンロード名が <code>exams(1).json</code> などになった場合は、GitHubへ上げる前に <code>exams.json</code> に戻して上書きしてください。</span></div>`;
}
function exportExamData(){
  allExamData.version=Math.max(Number(allExamData.version||0),9);
  allExamData.exams=exams;
  allExamData.updatedAt=new Date().toISOString();
  renderExamExportSummary();
  TDX.download('exams.json',JSON.stringify(allExamData,null,2));
  $('publishMsg').className='success small';$('publishMsg').textContent=`最新版 exams.json を書き出しました（収録試験 ${exams.length}件）。GitHub の data/exams.json をこのファイルで置き換えてください。`;
}

async function exportUserData(){
  const st=annualMasterState();
  if(st.unissued&&!confirm(`未発行の生徒が ${st.unissued}人います。この状態でusers.jsonを書き出しますか？`))return;
  if(st.missing){
    alert(`発行済みですがQR再印刷用の元キーを復元できない生徒が ${st.missing}人います。\n\n旧年間マスターCSVを読み込んでv1.24形式へ移行するか、その生徒だけアクセスキーを再発行してください。`);return
  }
  const migrated=await migrateLegacyVaultToEncryptedSecrets();
  const payload={
    version:6,
    note:'年度共通の生徒認証情報。credentialはsalt+hash、qrSecretは教員パスワードから生成した鍵で暗号化したQR再印刷用データです。平文アクセスキーは含みません。',
    updatedAt:new Date().toISOString(),
    issuedCodeIds:usersData.issuedCodeIds,
    users:usersData.users.map(u=>({studentCode:u.studentCode,classKey:u.classKey,credential:u.credential||null,qrSecret:u.qrSecret||null}))
  };
  usersData.version=6;
  TDX.download('users.json',JSON.stringify(payload,null,2));
  const msg=$('usersExportMsg');if(msg){msg.className='success small';msg.textContent=`users.jsonを書き出しました（${usersData.users.length}人）。GitHubのdata/users.jsonをこのファイルで上書きしてください。${migrated?` 旧形式${migrated}人もv1.24形式へ移行済みです。`:''}`}
  renderAccessVaultManager();renderAdminStudentList();renderAnnualMasterStatus();
}

window.__TDX_TEACHER_APP_READY__=true;
init().catch(e=>{console.error(e);const n=$('startupScriptNotice');if(n){n.classList.remove('hidden');n.textContent='教員画面の初期化中にエラーが発生しました。ページを再読み込みしてください。';}});
