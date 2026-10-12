const $=id=>document.getElementById(id);
let exams=[],usersData={version:7,systemName:'T-DX Lab☆問題演習システム',schoolYear:String(new Date().getFullYear()),resetEpoch:'',users:[],issuedCodeIds:[]},analysisRows=[],analysisExam=null,analysisMeta={raw:0,valid:0,participants:0,duplicates:0,tests:0,ignored:0,fileName:'',duplicateCodes:[]},allExamData=null,allAnalysisData={version:3,systemName:'T-DX Lab☆問題演習システム',updatedAt:null,analyses:[]};
let publishRoster=[],annualSecrets=[],accessVault=[];
let editorRows=[];
let editorSectionTargets={};
let rosterRanges=[];
let googleFormSetup={entries:[],viewUrl:'',actionUrl:'',testAttempted:false};
let previewMode='before';
let systemAdminUnlocked=false;
let teacherSessionEmail='',dataLoaded=false;
const APP_VERSION='1.25.1';
let dataVersionMeta={exams:'',users:'',examError:false,userError:false};

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

function persistAccessVault(){/* 平文アクセスキーはブラウザの永続領域へ保存しない */}
function accessSecretMap(){return new Map(accessVault.map(x=>[x.studentCode,x]))}
function mergeIntoAccessVault(rows){
  const validCodes=new Set((usersData.users||[]).map(u=>u.studentCode));
  const m=new Map(accessVault.filter(x=>validCodes.has(x.studentCode)).map(x=>[x.studentCode,x]));
  (rows||[]).forEach(x=>{
    if(x&&/^\d{4}$/.test(String(x.studentCode))&&x.accessCode&&validCodes.has(String(x.studentCode))){
      m.set(String(x.studentCode),{studentCode:String(x.studentCode),accessCode:String(x.accessCode).toUpperCase(),classKey:String(x.classKey||x.studentCode.slice(0,2))});
    }
  });
  accessVault=[...m.values()].sort((a,b)=>a.studentCode.localeCompare(b.studentCode));
  (usersData.users||[]).forEach(u=>{u.qrStored=m.has(u.studentCode)||!!u.qrStored});
  refreshAccessVaultClassFilter?.();updateAnnualMasterButtons?.();
}
async function loadPrivateAccessVault(){
  const result=await TDX.gasJson({action:'getQrVault'},15000);
  if(!result?.ok)throw new Error(result?.message||'QR保管庫を読み込めませんでした。');
  accessVault=(result.entries||[]).map(x=>({
    studentCode:String(x.studentCode||''),
    accessCode:String(x.accessCode||'').toUpperCase(),
    classKey:String(x.classKey||String(x.studentCode||'').slice(0,2))
  })).filter(x=>/^\d{4}$/.test(x.studentCode)&&x.accessCode).sort((a,b)=>a.studentCode.localeCompare(b.studentCode));
  const stored=new Set(accessVault.map(x=>x.studentCode));
  (usersData.users||[]).forEach(u=>{u.qrStored=stored.has(u.studentCode)});
  renderAccessVaultManager?.();renderIndividualStudents?.();updateAnnualMasterButtons?.();
  return accessVault;
}
function legacyQrPendingCount(){
  const stored=new Set(accessVault.map(x=>x.studentCode));
  return (usersData.users||[]).filter(u=>u?.qrSecret&&!stored.has(u.studentCode)).length;
}
function setAccessMessage(text,type='muted'){
  const el=$('qrMsg')||$('rosterMsg');if(!el)return;
  el.className=(type==='success'?'success':type==='error'?'error':type==='notice'?'notice':'muted')+' small';
  el.textContent=text;
}
function updateSystemAdminUi(){
  const btn=$('systemAdminBtn');if(btn)btn.textContent=systemAdminUnlocked?'管理者メニューを開く':'システム管理者';
}
function formatDataVersionTime(value){
  if(!value)return '日時情報なし';
  const t=Date.parse(value);if(!Number.isFinite(t))return '日時情報なし';
  return new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t));
}
function updateVersionStatus(){
  const e=$('tdxExamsVersion'),u=$('tdxUsersVersion');
  if(e){e.textContent=dataVersionMeta.examError?'exams：読込失敗':`exams：${formatDataVersionTime(dataVersionMeta.exams)}`;e.classList.toggle('is-error',dataVersionMeta.examError)}
  if(u){u.textContent=dataVersionMeta.userError?'users：読込失敗':`users：${formatDataVersionTime(dataVersionMeta.users)}`;u.classList.toggle('is-error',dataVersionMeta.userError)}
}
function bindVersionStatus(){
  const btn=$('tdxReloadBtn');if(!btn)return;
  btn.onclick=()=>{const url=new URL(location.href);url.searchParams.set('_reload',Date.now());location.replace(url.toString())};
  updateVersionStatus();
}
async function fetchJsonWithMeta(path){
  const r=await fetch(`${path}?v=${Date.now()}`,{cache:'no-store'});
  if(!r.ok)throw new Error(`${path} HTTP ${r.status}`);
  const data=await r.json();
  return {data,lastModified:r.headers.get('last-modified')||''};
}
async function init(){
  // Bind the interface before any network/data loading.
  // Even if GitHub data or an optional library is slow, login/menu navigation stays responsive.
  initChoiceRangeControls();
  bind();
  updateSystemAdminUi();

  bindVersionStatus();
  const examPromise=fetchJsonWithMeta('data/exams.json');
  const userPromise=fetchJsonWithMeta('data/users.json');
  const analysisPromise=fetchJsonWithMeta('data/analysis.json');
  const [examResult,userResult,analysisResult]=await Promise.allSettled([examPromise,userPromise,analysisPromise]);

  allExamData=examResult.status==='fulfilled'?examResult.value.data:{version:10,systemName:'T-DX Lab☆問題演習システム',schoolYear:String(new Date().getFullYear()),resetEpoch:'',exams:[]};
  usersData=userResult.status==='fulfilled'?userResult.value.data:{version:7,systemName:'T-DX Lab☆問題演習システム',schoolYear:String(new Date().getFullYear()),resetEpoch:'',users:[],issuedCodeIds:[]};
  allAnalysisData=analysisResult.status==='fulfilled'?analysisResult.value.data:{version:3,systemName:'T-DX Lab☆問題演習システム',schoolYear:String(new Date().getFullYear()),resetEpoch:'',updatedAt:null,analyses:[]};
  allAnalysisData.analyses=Array.isArray(allAnalysisData.analyses)?allAnalysisData.analyses:[];
  dataVersionMeta.examError=examResult.status==='rejected';
  dataVersionMeta.userError=userResult.status==='rejected';
  dataVersionMeta.exams=examResult.status==='fulfilled'?(allExamData.updatedAt||examResult.value.lastModified||''):'';
  dataVersionMeta.users=userResult.status==='fulfilled'?(usersData.updatedAt||userResult.value.lastModified||''):'';
  updateVersionStatus();
  if(examResult.status==='rejected')console.error('exams.json load failed:',examResult.reason);
  if(userResult.status==='rejected')console.error('users.json load failed:',userResult.reason);
  if(analysisResult.status==='rejected')console.info('analysis.json is optional and was not loaded:',analysisResult.reason);

  exams=allExamData.exams||[];
  exams.forEach(e=>{
    e.status=examStoredStatus(e);e.published=e.status==='published';
    // v1.23.8: old clones inherited the source exam's testConfirmed flag even though the clone itself was never verified.
    if(e.clonedFrom&&e.formSubmission&&!e.formSubmission.verificationSource){
      e.formSubmission.testConfirmed=false;
      e.formSubmission.verifiedAt=null;
      e.formSubmission.lastTestAttemptedAt=null;
      e.formSubmission.verificationSource='clone_inherited';
      e.formSubmission.inheritedFrom=e.clonedFrom;
    }
  });
  usersData.users=(usersData.users||[]).filter(u=>u?.credential?.codeId!=='demo-annual-3101');
  usersData.issuedCodeIds=usersData.issuedCodeIds||[];
  usersData.qrVault=usersData.qrVault||null; // v1.24.xからの一度限りの移行用。新規データでは使用しない。
  usersData.users.forEach(u=>{u.classKey=u.classKey||String(u.studentCode||'').slice(0,2);u.examCredentials=u.examCredentials||{};u.credential=u.credential||null});
  dataLoaded=true;
  rosterRanges=compressRosterRanges(usersData.users.map(u=>u.studentCode));
  if(!rosterRanges.length) rosterRanges=[{start:'3101',end:'3130'}];
  const yearBase=Number(usersData.schoolYear||allExamData.schoolYear||new Date().getFullYear());
  if($('currentSchoolYearLabel'))$('currentSchoolYearLabel').textContent=`${Number.isFinite(yearBase)?yearBase:new Date().getFullYear()}年度`;
  if($('nextSchoolYear'))$('nextSchoolYear').value=String(Number.isFinite(yearBase)?yearBase+1:new Date().getFullYear()+1);
  refreshExamSelects();
  renderRosterRanges();
  renderRosterSummary();
  renderIndividualStudents();
  renderAccessVaultManager();
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
  $('adminLoginBtn').onclick=adminLogin;
  $('adminLogoutBtn').onclick=()=>{systemAdminUnlocked=false;teacherSessionEmail='';accessVault=[];updateSystemAdminUi();$('systemAdminGate')?.classList.add('hidden');$('adminApp').classList.add('hidden');$('adminGate').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'})};
  document.querySelectorAll('.menuBtn').forEach(b=>b.onclick=()=>showSection(b.dataset.target));
  $('systemAdminBtn').onclick=()=>{if(systemAdminUnlocked){showSection('studentManager');return}$('systemAdminGate').classList.toggle('hidden');};
  $('systemAdminCancelBtn').onclick=()=>{$('systemAdminGate').classList.add('hidden');$('systemAdminMsg').textContent=''};
  $('systemAdminLoginBtn').onclick=systemAdminLogin;

  $('addRosterRangeBtn').onclick=()=>{rosterRanges.push({start:'',end:''});renderRosterRanges()};
  $('saveRosterBtn').onclick=saveRoster;
  $('addIndividualStudentBtn').onclick=addIndividualStudent;
  $('individualStudentCode').addEventListener('keydown',e=>{if(e.key==='Enter')addIndividualStudent()});
  $('individualStudentClassFilter').onchange=renderIndividualStudents;
  $('individualStudentSearch').addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,4);renderIndividualStudents()});
  $('generateAnnualCodesBtn').onclick=()=>generateAnnualCodes(false);
  $('regenerateAnnualCodesBtn').onclick=()=>generateAnnualCodes(true);
  $('exportAnnualSecretsBtn').onclick=exportAnnualSecrets;
  $('printAnnualCardsBtn').onclick=printAnnualCards;
  $('printAllAnnualCardsBtn').onclick=printAllAnnualCards;
  $('exportRosterUsersBtn').onclick=exportUserData;
  if($('syncRosterUsersBtn'))$('syncRosterUsersBtn').onclick=manualSyncUsers;
  if($('annualBackupBtn'))$('annualBackupBtn').onclick=downloadAnnualBackup;
  if($('currentYearResetBtn'))$('currentYearResetBtn').onclick=currentYearReset;
  if($('annualResetBtn'))$('annualResetBtn').onclick=annualReset;
  $('accessVaultClassFilter').onchange=renderAccessVaultManager;
  $('qrStudentSearch').addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,4);renderAccessVaultManager()});

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
  $('publishStudentAnalysisBtn').onclick=publishStudentAnalysisToGas;
  $('exportStudentAnalysisBtn').onclick=exportStudentAnalysisData;
  $('classFilter').onchange=()=>{closeStudentAnalysisDetail();renderAnalysis()};
  $('questionSort').onchange=renderAnalysis;
  $('questionFilter').onchange=renderAnalysis;
  $('studentSort').onchange=()=>{closeStudentAnalysisDetail();renderAnalysis()};
  $('studentAnalysisBody').onclick=e=>{const b=e.target.closest('[data-student-detail]');if(b)renderStudentDetail(b.dataset.studentDetail)};
  $('studentDetailClose').onclick=closeStudentAnalysisDetail;

  $('publishSubjectSelect').onchange=()=>{refreshPublishSelectors();loadPublishExam()};
  $('publishExamSelect').onchange=loadPublishExam;
  $('publishStatusSelect').onchange=()=>{updatePublishScheduleVisibility();renderExamReadiness(exams.find(e=>e.id===$('publishExamSelect')?.value))};
  $('cloneExamBtn').onclick=cloneCurrentExam;
  $('togglePreviewBtn').onclick=toggleExamPreview;
  $('testPublishedGoogleFormBtn').onclick=testSelectedExamGoogleForm;
  $('openPublishedGoogleFormBtn').onclick=openSelectedExamGoogleForm;
  $('editPublishedGoogleFormBtn').onclick=openSelectedExamGoogleFormEditor;
  $('replacePublishedGoogleFormBtn').onclick=replaceSelectedExamGoogleForm;
  $('publishFormConfirmed').onchange=confirmSelectedExamGoogleFormReceipt;
  $('closePreviewBtn').onclick=()=>{$('examPreviewPanel')?.classList.add('hidden')};
  document.querySelectorAll('.previewModeBtn').forEach(b=>b.onclick=()=>{previewMode=b.dataset.previewMode||'before';renderExamPreview(previewMode)});
  $('deleteExamBtn').onclick=deleteCurrentExam;
  $('selectAllAudienceBtn').onclick=()=>setAllAudience(true);
  $('clearAudienceBtn').onclick=()=>setAllAudience(false);
  $('applyPublishBtn').onclick=applyPublish;
  document.querySelectorAll('.publishExtendBtn').forEach(b=>b.onclick=()=>extendPublishEnd(Number(b.dataset.minutes||0)));
  $('exportExamDataBtn').onclick=exportExamData;
}
async function adminLogin(){
  const btn=$('adminLoginBtn'),old=btn?.textContent||'OEN認証で管理コンソールを開く';
  if(btn){btn.disabled=true;btn.textContent='OENアカウントを確認中…'}
  $('adminMsg').className='small portal-admin-message';$('adminMsg').textContent='学校OENアカウントの権限を確認しています…';
  try{
    const who=await TDX.gasJson({action:'whoami'},15000);
    if(!who?.ok)throw new Error(who?.message||'OEN認証を確認できません。');
    if(!who.teacher)throw new Error(`このOENアカウント（${who.user||'不明'}）には教員管理権限がありません。`);
    teacherSessionEmail=who.user||'';
    accessVault=[];
    $('adminGate').classList.add('hidden');
    $('adminApp').classList.remove('hidden');
    $('adminMsg').textContent='';
    showSection('examManager');
    requestAnimationFrame(()=>$('adminApp').scrollIntoView({behavior:'smooth',block:'start'}));
  }catch(e){
    $('adminMsg').className='error small portal-admin-message';
    $('adminMsg').textContent=`教員管理画面を開けません：${e.message||e}`;
  }finally{if(btn){btn.disabled=false;btn.textContent=old}}
}
async function ensureSystemAdminAccess(){
  const who=await TDX.gasJson({action:'whoami'},15000);
  if(!who?.ok)throw new Error(who?.message||'OENアカウントを確認できません。');
  if(!who.teacher)throw new Error('教員管理権限がありません。');
  if(!who.admin)throw new Error(`このOENアカウント（${who.user||'不明'}）はシステム管理者ではありません。`);
  return who;
}
async function systemAdminLogin(){
  const btn=$('systemAdminLoginBtn'),old=btn?.textContent||'OEN権限を確認して開く';
  if(btn){btn.disabled=true;btn.textContent='確認中…'}
  try{
    await ensureSystemAdminAccess();
    systemAdminUnlocked=true;
    try{await loadPrivateAccessVault()}catch(qrErr){console.warn(qrErr);accessVault=[]}
    $('systemAdminMsg').className='success small';$('systemAdminMsg').textContent='OENのシステム管理者権限を確認しました。';
    $('systemAdminGate').classList.add('hidden');
    updateSystemAdminUi();showSection('studentManager');
  }catch(e){
    $('systemAdminMsg').className='error small';$('systemAdminMsg').textContent=e.message||String(e);
  }finally{if(btn){btn.disabled=false;btn.textContent=old}}
}
function showSection(id){
  if(id==='studentManager'&&!systemAdminUnlocked){$('systemAdminGate')?.classList.remove('hidden');return}
  document.querySelectorAll('.adminSection').forEach(x=>x.classList.toggle('hidden',x.id!==id));
  document.querySelectorAll('.menuBtn').forEach(x=>x.classList.toggle('active-look',x.dataset.target===id));
  if(id==='studentManager'){renderRosterSummary();renderIndividualStudents()}
  if(id==='qrManager')renderAccessVaultManager();
  if(id==='publishManager')loadPublishExam();
  requestAnimationFrame(()=>document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'}));
}
function getOrCreateUser(studentCode,digits=2){
  let u=usersData.users.find(x=>x.studentCode===studentCode);
  if(!u){u={studentCode,classKey:studentCode.slice(0,digits),credential:null,examCredentials:{}};usersData.users.push(u)}
  u.classKey=studentCode.slice(0,digits);u.examCredentials=u.examCredentials||{};u.credential=u.credential||null;return u
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
async function saveRoster(){
  try{
    await ensureSystemAdminAccess();
    if(legacyQrPendingCount()>0)throw new Error('旧QR暗号の移行が未完了です。先に「旧QR暗号をGASへ移行」または年間マスターCSVの移行を行ってください。');
    const codes=codesFromRosterRanges(),old=new Map(usersData.users.map(u=>[u.studentCode,u]));
    usersData.users=codes.map(code=>{const u=old.get(code)||{studentCode:code,classKey:code.slice(0,2),credential:null,examCredentials:{},qrStored:false};u.classKey=code.slice(0,2);u.examCredentials=u.examCredentials||{};u.credential=u.credential||null;return u});
    localStorage.setItem('tdxRosterRanges',JSON.stringify(rosterRanges));
    accessVault=accessVault.filter(x=>codes.includes(x.studentCode));
    renderRosterSummary();renderIndividualStudents();renderAccessVaultManager();loadPublishExam();
    $('rosterMsg').className='notice small';$('rosterMsg').textContent=`${codes.length}人を名簿に登録しました。生徒画面へ反映しています…`;
    await syncUsersToPublicData([]);
    $('rosterMsg').className='success small';$('rosterMsg').textContent=`✓ ${codes.length}人の名簿を登録し、生徒認証データへ自動反映しました。未発行者は次に年間アクセスキーを発行してください。`;
  }catch(e){$('rosterMsg').className='error small';$('rosterMsg').textContent=e.message||String(e)}
}
function renderRosterSummary(){
  if(!$('rosterSummary'))return;
  const groups={};usersData.users.forEach(u=>{const c=u.classKey||u.studentCode.slice(0,2);(groups[c]??=[]).push(u.studentCode)});
  const entries=Object.entries(groups).sort(([a],[b])=>a.localeCompare(b));
  const issued=usersData.users.filter(u=>u.credential).length;
  $('rosterSummary').innerHTML=`<div class="kpi"><div class="muted small">登録生徒</div><div class="value">${usersData.users.length}</div></div><div class="kpi"><div class="muted small">クラス</div><div class="value">${entries.length}</div></div><div class="kpi"><div class="muted small">アクセスキー発行済</div><div class="value">${issued}</div></div>`;
  $('rosterPreview').innerHTML=entries.length?entries.map(([c,list])=>`<div class="roster-class-preview"><strong>${c}組</strong><span>${list.length}人</span><small>${list[0]} ～ ${list[list.length-1]}</small></div>`).join(''):'<div class="notice small">まだ生徒名簿が登録されていません。</div>';
}
async function refreshIndividualStudentClassFilter(){
  const sel=$('individualStudentClassFilter');if(!sel)return;
  const current=sel.value;
  const classes=[...new Set(usersData.users.map(u=>u.classKey||String(u.studentCode||'').slice(0,2)).filter(Boolean))].sort();
  sel.innerHTML='<option value="">全クラス</option>'+classes.map(c=>`<option value="${esc(c)}">${esc(c)}組</option>`).join('');
  if(classes.includes(current))sel.value=current;
}
function individualStudentRows(){
  const c=$('individualStudentClassFilter')?.value||'';
  const q=($('individualStudentSearch')?.value||'').trim();
  return usersData.users.slice().sort((a,b)=>a.studentCode.localeCompare(b.studentCode)).filter(u=>(!c||(u.classKey||u.studentCode.slice(0,2))===c)&&(!q||u.studentCode.includes(q)));
}
function individualAccessState(u){
  if(!u.credential)return '<span class="master-status unissued">○ 未発行</span>';
  return accessSecretMap().has(u.studentCode)||u.qrStored?'<span class="master-status ready">✓ 発行済・GAS保管</span>':'<span class="master-status missing">△ QR保管庫への移行必要</span>';
}
function renderIndividualStudents(){
  const root=$('individualStudentTable');if(!root)return;
  refreshIndividualStudentClassFilter();
  const rows=individualStudentRows();
  if($('individualStudentCount'))$('individualStudentCount').textContent=`${rows.length}人表示`;
  if(!usersData.users.length){root.innerHTML='<div class="notice small">登録生徒はいません。上の年度名簿から登録してください。</div>';return}
  root.innerHTML=`<div class="table-shell student-individual-table-shell"><table class="student-individual-table"><thead><tr><th>4桁番号</th><th>クラス</th><th>アクセスキー</th><th>操作</th></tr></thead><tbody>${rows.map(u=>`<tr><td><strong>${esc(u.studentCode)}</strong></td><td>${esc(u.classKey||u.studentCode.slice(0,2))}組</td><td>${individualAccessState(u)}</td><td class="student-row-actions"><button type="button" class="secondary glass-btn student-edit-btn" data-student-edit="${esc(u.studentCode)}">編集</button>${u.credential?`<button type="button" class="danger-outline student-reissue-btn" data-student-reissue="${esc(u.studentCode)}">キー再発行</button>`:''}<button type="button" class="danger-soft student-delete-btn" data-student-delete="${esc(u.studentCode)}">削除</button></td></tr>`).join('')}</tbody></table></div>`;
  root.querySelectorAll('[data-student-edit]').forEach(b=>b.onclick=()=>editIndividualStudent(b.dataset.studentEdit));
  root.querySelectorAll('[data-student-delete]').forEach(b=>b.onclick=()=>deleteIndividualStudent(b.dataset.studentDelete));
  root.querySelectorAll('[data-student-reissue]').forEach(b=>b.onclick=()=>reissueOneStudent(b.dataset.studentReissue));
}
function setIndividualStudentMessage(text,type='muted'){
  const el=$('individualStudentMsg');if(!el)return;
  el.className=(type==='success'?'success':type==='error'?'error':type==='notice'?'notice':'muted')+' small';
  el.textContent=text;
}
function syncRosterAfterIndividualChange(){
  rosterRanges=compressRosterRanges(usersData.users.map(u=>u.studentCode));
  if(!rosterRanges.length)rosterRanges=[{start:'',end:''}];
  renderRosterRanges();renderRosterSummary();renderIndividualStudents();renderAccessVaultManager();loadPublishExam();
  try{localStorage.setItem('tdxRosterRanges',JSON.stringify(rosterRanges))}catch(_){}
}
async function addIndividualStudent(){
  const input=$('individualStudentCode');
  const code=String(input?.value||'').replace(/\D/g,'').slice(0,4);
  if(!/^\d{4}$/.test(code)){setIndividualStudentMessage('4桁番号を4桁の数字で入力してください。','error');input?.focus();return}
  if(usersData.users.some(u=>u.studentCode===code)){setIndividualStudentMessage(`${code} はすでに登録されています。`,'error');return}
  try{
    await ensureSystemAdminAccess();
    if(legacyQrPendingCount()>0)throw new Error('旧QR暗号の移行が未完了です。先にQR保管庫への移行を完了してください。');
    usersData.users.push({studentCode:code,classKey:code.slice(0,2),credential:null,examCredentials:{},qrStored:false});
    usersData.users.sort((a,b)=>a.studentCode.localeCompare(b.studentCode));
    if(input)input.value='';
    syncRosterAfterIndividualChange();
    setIndividualStudentMessage(`${code} を追加しました。生徒認証データへ反映しています…`,'notice');
    await syncUsersToPublicData([]);
    setIndividualStudentMessage(`✓ ${code} を追加し、生徒認証データへ自動反映しました。アクセスキーはまだ未発行です。`,'success');
  }catch(e){setIndividualStudentMessage(`追加できませんでした：${e.message||e}`,'error')}
}
function replaceExamStudentTarget(oldCode,newCode=''){
  let touched=0;
  exams.forEach(exam=>{
    const list=exam?.access?.students;
    if(!Array.isArray(list)||!list.includes(oldCode))return;
    touched++;
    exam.access.students=[...new Set(list.flatMap(x=>x===oldCode?(newCode?[newCode]:[]):[x]))].sort();
  });
  return touched;
}
function moveSecretCode(oldCode,newCode){
  accessVault=accessVault.map(x=>x.studentCode===oldCode?{...x,studentCode:newCode,classKey:newCode.slice(0,2)}:x);
  annualSecrets=annualSecrets.map(x=>x.studentCode===oldCode?{...x,studentCode:newCode,classKey:newCode.slice(0,2)}:x);
  persistAccessVault();
}
async function editIndividualStudent(oldCode){
  const u=usersData.users.find(x=>x.studentCode===oldCode);if(!u)return;
  const entered=prompt(`4桁番号を修正します。\n現在：${oldCode}\n\n新しい4桁番号を入力してください。`,oldCode);
  if(entered===null)return;
  const newCode=String(entered).replace(/\D/g,'').slice(0,4);
  if(!/^\d{4}$/.test(newCode)){setIndividualStudentMessage('4桁番号は4桁の数字で入力してください。','error');return}
  if(newCode===oldCode)return;
  if(usersData.users.some(x=>x.studentCode===newCode)){setIndividualStudentMessage(`${newCode} はすでに登録されています。`,'error');return}
  const issued=!!u.credential;
  const secret=accessSecretMap().get(oldCode);
  if(issued&&!secret){setIndividualStudentMessage('この生徒のQR再印刷用キーをGAS保管庫から取得できていません。画面を再読み込みしてから再度お試しください。','error');return}
  const msg=`${oldCode} → ${newCode} に変更します。`+(issued?'\n\n現在のQRカードには旧4桁番号が入っているため、変更後は旧QRを使用できません。新しい4桁番号でQRを再印刷してください。':'');
  if(!confirm(msg+'\n\nよろしいですか？'))return;
  try{
    await ensureSystemAdminAccess();
    u.studentCode=newCode;u.classKey=newCode.slice(0,2);u.examCredentials=u.examCredentials||{};
    moveSecretCode(oldCode,newCode);
    const touched=replaceExamStudentTarget(oldCode,newCode);
    usersData.users.sort((a,b)=>a.studentCode.localeCompare(b.studentCode));
    syncRosterAfterIndividualChange();
    setIndividualStudentMessage(`${oldCode} → ${newCode} を反映しています…`,'notice');
    await syncUsersToPublicData(secret?[{...secret,studentCode:newCode,classKey:newCode.slice(0,2)}]:[]);
    if(touched)await syncExamsToPublicData();
    setIndividualStudentMessage(`✓ ${oldCode} を ${newCode} に変更し、自動反映しました。${issued?' 新しい4桁番号でQRカードを再印刷してください。':''}`,'success');
  }catch(e){setIndividualStudentMessage(`変更の反映に失敗しました：${e.message||e}`,'error')}
}
async function deleteIndividualStudent(code){
  const u=usersData.users.find(x=>x.studentCode===code);if(!u)return;
  const issued=!!u.credential;
  const warning=`${code} を年度名簿から削除します。`+(issued?'\nこの生徒の年間アクセス認証とGAS側のQR保管データも削除されます。':'')+'\nGoogleフォームに既に届いている回答は削除されません。\n\n本当に削除しますか？';
  if(!confirm(warning))return;
  try{
    await ensureSystemAdminAccess();
    usersData.users=usersData.users.filter(x=>x.studentCode!==code);
    accessVault=accessVault.filter(x=>x.studentCode!==code);annualSecrets=annualSecrets.filter(x=>x.studentCode!==code);persistAccessVault();
    const touched=replaceExamStudentTarget(code,'');
    syncRosterAfterIndividualChange();
    setIndividualStudentMessage(`${code} を削除し、生徒画面へ反映しています…`,'notice');
    await syncUsersToPublicData([]);
    if(touched)await syncExamsToPublicData();
    setIndividualStudentMessage(`✓ ${code} を削除し、自動反映しました。Googleフォームに既に届いている回答はそのまま残ります。`,'success');
  }catch(e){setIndividualStudentMessage(`削除の反映に失敗しました：${e.message||e}`,'error')}
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
  if(regenerateAll&&!confirm('全生徒の年間アクセスキーを再発行します。以前のQRカードはすべて無効になります。\n\n旧バージョンの公開履歴にQR暗号が残っている場合のセキュリティ更新にも使えます。\n\nよろしいですか？'))return;
  try{
    await ensureSystemAdminAccess();
    if(!regenerateAll&&legacyQrPendingCount()>0)throw new Error('旧バージョンのQR情報が残っています。本番前にやり直す場合は「完全初期化（年度維持）」を実行してください。引き継ぐ場合は「全員のアクセスキーを再発行」で旧キーを無効化してください。');
    annualSecrets=[];
    if(regenerateAll){
      accessVault=[];
      usersData.qrVault=null;
      (usersData.users||[]).forEach(u=>{delete u.qrSecret;u.qrStored=false});
    }
    for(const u of usersData.users){
      if(u.credential&&!regenerateAll)continue;
      const {pretty,codeId}=await createUniqueAccessCode(),v=await TDX.makeVerifier(pretty);
      u.credential={salt:v.salt,hash:v.hash,codeId,issuedAt:new Date().toISOString()};
      u.qrStored=true;
      annualSecrets.push({studentCode:u.studentCode,accessCode:pretty,classKey:u.classKey});
    }
    mergeIntoAccessVault(annualSecrets);
    if(annualSecrets.length)await syncUsersToPublicData(annualSecrets);
    renderAnnualSecrets();renderAccessVaultManager();renderRosterSummary();
    if(annualSecrets.length){
      $('printAnnualCardsBtn').disabled=false;updateAnnualMasterButtons();
      $('rosterMsg').className='success small';
      $('rosterMsg').textContent=`✓ ${annualSecrets.length}人分の年間アクセスキーを発行し、生徒認証データへ自動反映しました。平文キーはGAS側だけに保管しています。QRカードを印刷してください。`;
    }else{
      $('rosterMsg').className='notice small';$('rosterMsg').textContent='全員すでに年間アクセスキー発行済みです。QR再印刷欄に管理者設定待ちがある場合は、完全初期化またはアクセスキー再発行で整合を取り直してください。';
    }
  }catch(e){
    $('rosterMsg').className='error small';$('rosterMsg').textContent=`アクセスキーを発行できませんでした：${e.message||e}`;
  }
}
function renderAnnualSecrets(){
  const root=$('annualCodePreview');if(!root)return;
  if(!annualSecrets.length){root.innerHTML='<div class="notice small">アクセスキーを新規発行すると、ここに今回発行分だけ表示されます。平文アクセスキーはGAS側のQR保管庫だけに保存され、GitHubの users.json には保存されません。</div>';return}
  root.innerHTML=`<h3>今回発行したアクセスキー（${annualSecrets.length}人）</h3><div class="table-shell"><table><thead><tr><th>4桁番号</th><th>年間アクセスキー</th><th>クラス</th></tr></thead><tbody>${annualSecrets.slice(0,20).map(x=>`<tr><td>${x.studentCode}</td><td><code>${x.accessCode}</code></td><td>${x.classKey}</td></tr>`).join('')}</tbody></table></div>${annualSecrets.length>20?`<p class="small muted">ほか ${annualSecrets.length-20}人</p>`:''}`;
}
function annualMasterState(){
  const m=accessSecretMap();
  const total=usersData.users.length;
  const issued=usersData.users.filter(u=>!!u.credential).length;
  const available=usersData.users.filter(u=>u.credential&&(m.has(u.studentCode)||u.qrStored)).length;
  const loaded=usersData.users.filter(u=>u.credential&&m.has(u.studentCode)).length;
  const missing=usersData.users.filter(u=>u.credential&&!m.has(u.studentCode)&&!u.qrStored).length;
  const unissued=usersData.users.filter(u=>!u.credential).length;
  return {total,issued,known:available,loaded,missing,unissued,complete:total>0&&loaded===total&&missing===0&&unissued===0};
}
function updateAnnualMasterButtons(){
  const st=annualMasterState();
  if($('exportAnnualSecretsBtn'))$('exportAnnualSecretsBtn').disabled=st.total===0;
  if($('printAllAnnualCardsBtn'))$('printAllAnnualCardsBtn').disabled=!st.complete;
  renderAnnualMasterStatus(st);
}
function renderAnnualMasterStatus(st=annualMasterState()){
  const el=$('annualMasterStatus');if(!el)return;
  if(!st.total){el.className='info-strip teacher-strip';el.innerHTML='<span>MASTER</span> 生徒名簿を登録すると、年間マスターCSVの準備状況がここに表示されます。';return}
  if(st.complete){el.className='info-strip teacher-strip success-strip';el.innerHTML=`<span>READY</span> 年間マスターCSV・QR再印刷：<strong>${st.known}/${st.total}人</strong> 準備済み。一般教員もファイル読込なしで再印刷できます。`;return}
  const parts=[];
  if(st.known)parts.push(`確認済み ${st.known}人`);
  if(st.missing)parts.push(`発行済・移行必要 ${st.missing}人`);
  if(st.unissued)parts.push(`未発行 ${st.unissued}人`);
  el.className='info-strip teacher-strip warning-strip';
  el.innerHTML=`<span>CHECK</span> 年間アクセス設定はまだ完了していません（${parts.join(' / ')}）。本番前に完全初期化する場合は、その後あらためてアクセスキーを発行してください。`;
}
function exportAnnualSecrets(){
  const st=annualMasterState();
  if(!usersData.users.length){alert('生徒名簿が登録されていません。');return}
  if(st.unissued){
    alert(`年間マスターCSVは「登録生徒全員分」がそろった時だけ書き出します。\n\n未発行：${st.unissued}人\n\n先に「未発行者にアクセスキーを発行」を押してください。`);
    $('generateAnnualCodesBtn')?.focus();return
  }
  if(st.missing){
    alert(`年間マスターCSVは全員分がそろった時だけ書き出します。\n\nQR保管庫との整合が取れていない生徒：${st.missing}人\n\n本番前のやり直しであれば「完全初期化（年度維持）」後にアクセスキーを新規発行してください。`);
    return
  }
  const m=accessSecretMap();
  const rows=usersData.users.slice().sort((a,b)=>a.studentCode.localeCompare(b.studentCode)).map(u=>m.get(u.studentCode));
  const csv='4桁番号,年間アクセスキー,クラス\n'+rows.map(x=>`${x.studentCode},${x.accessCode},${x.classKey}`).join('\n');
  TDX.download('T-DX_Lab_年間アクセスキー_年間マスター.csv','\ufeff'+csv,'text/csv;charset=utf-8');
}

function currentManagedUsers(){
  const c=$('accessVaultClassFilter')?.value||'',q=String($('qrStudentSearch')?.value||'').trim();
  return usersData.users.slice().sort((a,b)=>a.studentCode.localeCompare(b.studentCode)).filter(x=>(!c||(x.classKey||x.studentCode.slice(0,2))===c)&&(!q||x.studentCode.includes(q)));
}
function renderAccessVaultSummary(){
  const root=$('accessVaultSummary');if(!root)return;
  const st=annualMasterState();
  root.innerHTML=`<div class="kpi"><div class="muted small">登録生徒</div><div class="value">${st.total}</div></div><div class="kpi"><div class="muted small">QR再印刷可能</div><div class="value">${st.known}</div></div><div class="kpi ${st.missing?'kpi-warn':''}"><div class="muted small">管理者設定待ち</div><div class="value">${st.missing+st.unissued}</div></div>`;
  const cache=$('qrCacheStatus');if(cache){cache.className='qr-cache-status '+(st.known?'ready':'');cache.innerHTML=st.known?`<span>READY</span> ${st.known}人をそのまま再印刷できます`:'<span>CHECK</span> システム管理者の初期設定が必要です';}
}
function renderAccessVaultManager(){
  const root=$('accessVaultManager');if(!root)return;
  refreshAccessVaultClassFilter();renderAccessVaultSummary();updateAnnualMasterButtons();
  const rows=currentManagedUsers(),m=accessSecretMap();
  if(!usersData.users.length){root.innerHTML='<div class="notice small">生徒名簿がまだ登録されていません。システム管理者へ確認してください。</div>';return}
  root.innerHTML=`<div class="table-shell"><table><thead><tr><th>4桁番号</th><th>クラス</th><th>状態</th><th>操作</th></tr></thead><tbody>${rows.map(u=>{
    const secret=m.get(u.studentCode),issued=!!u.credential;
    const available=!!secret||!!u.qrStored;
    const state=!issued?'<span class="master-status unissued">○ 未発行</span>':available?'<span class="master-status ready">✓ 再印刷可能</span>':'<span class="master-status missing">△ 管理者設定待ち</span>';
    return `<tr><td><strong>${esc(u.studentCode)}</strong></td><td>${esc(u.classKey||u.studentCode.slice(0,2))}組</td><td>${state}</td><td><button type="button" class="teacher-action qr-one-reprint" data-qr-reprint="${esc(u.studentCode)}" ${available?'':'disabled'}>QRを再印刷</button></td></tr>`
  }).join('')}</tbody></table></div><p class="small muted">${rows.length}人表示中。一般教員が行うのは「同じQRの再印刷」だけです。アクセスキーを変更する必要がある場合はシステム管理者へ連絡してください。</p>`;
  root.querySelectorAll('[data-qr-reprint]').forEach(b=>b.onclick=()=>reprintOneCard(b.dataset.qrReprint));
}
async function reprintOneCard(code){
  let secret=accessSecretMap().get(code);
  try{
    if(!secret){
      const result=await TDX.gasJson({action:'getQrAccess',studentCode:code},15000);
      if(!result?.ok||!result.entry)throw new Error(result?.message||'QR再印刷用キーを取得できませんでした。');
      secret={studentCode:String(result.entry.studentCode||code),accessCode:String(result.entry.accessCode||'').toUpperCase(),classKey:String(result.entry.classKey||code.slice(0,2))};
    }
    await generateAccessCardsPdf([secret],`T-DX_Lab_QRカード_${code}_再印刷.pdf`);
    setAccessMessage(`${code} のQRカードを再印刷しました。アクセスキーは変更していません。`,'success');
  }catch(e){
    setAccessMessage(`${code} のQRカードを再印刷できませんでした：${e.message||e}`,'error');
  }
}
async function reissueOneStudent(code){
  const u=usersData.users.find(x=>x.studentCode===code);if(!u)return;
  if(!confirm(`${code} のアクセスキーを再発行します。\n\n古いQRカードは、新しい認証情報を生徒画面へ反映した時点で使えなくなります。\n通常の紛失・汚損なら再発行せず「QRカード再印刷」を使ってください。\n\n本当に再発行しますか？`))return;
  try{
    await ensureSystemAdminAccess();
    const {pretty,codeId}=await createUniqueAccessCode(),v=await TDX.makeVerifier(pretty);
    u.credential={salt:v.salt,hash:v.hash,codeId,issuedAt:new Date().toISOString()};
    u.qrStored=true;
    annualSecrets=[{studentCode:u.studentCode,accessCode:pretty,classKey:u.classKey}];
    mergeIntoAccessVault(annualSecrets);
    await syncUsersToPublicData(annualSecrets);
    renderAnnualSecrets();renderIndividualStudents();renderAccessVaultManager();renderRosterSummary();
    $('printAnnualCardsBtn').disabled=false;
    setIndividualStudentMessage(`✓ ${code} のアクセスキーを再発行し、生徒認証データへ自動反映しました。今回発行分QRカードを印刷してください。`,'success');
  }catch(e){
    setIndividualStudentMessage(`再発行できませんでした：${e.message||e}`,'error');
  }
}
async function printAllAnnualCards(){
  const st=annualMasterState();if(!st.complete){alert('全員分のQR再印刷情報が揃っていません。既存データの場合は管理者画面で年間マスターCSVを1回読み込んで移行してください。');return}
  const m=accessSecretMap(),rows=usersData.users.slice().sort((a,b)=>a.studentCode.localeCompare(b.studentCode)).map(u=>m.get(u.studentCode));
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
  }catch(e){console.error(e);alert('年間アクセスカードPDFの生成に失敗しました。教員保管CSVを確認し、ページを再読み込みしてもう一度お試しください。')}
  finally{if(btn){btn.disabled=false;btn.textContent=oldText}}
}
async function printAnnualCards(){
  if(!annualSecrets.length){alert('今回新しく発行したアクセスキーがありません。既存カードの再印刷は「教員保管CSVを読み込む」から行ってください。');return}
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
  return `添付した「問題用紙PDF」と「模範解答PDF」の両方を読み取り、T-DX Lab☆問題演習システムに貼り付けられるテキストへ変換してください。\n\n【役割】\n・問題用紙PDFから「大問構成」「解答記号」「解答欄の個数」「解答順」を確認する。\n・模範解答PDFから「正答」「配点」「完答・順不同などの採点条件」を確認する。\n・必ず両方を照合し、問題用紙に存在するすべての解答欄を、問題用紙と同じ順番で出力する。\n・模範解答だけを見て解答欄数を推測しない。出力前に、問題用紙で確認した解答欄数と出力する解答欄数が一致していることを確認する。\n\n【厳守】\n・説明や前置き、確認結果の文章は書かず、最後に示すフォーマットだけを出力する。\n・「大問」「解答記号」は問題用紙を基準にし、「正答」「配点」「採点条件」は模範解答を基準に忠実に転記する。\n・問題用紙に解答欄があるのに、模範解答から正答または配点を確認できない場合は、その項目を「要確認」とする。解答欄そのものは省略しない。\n・推測で解答記号、正答、配点を補わない。\n・この試験のマーク選択肢は ${choices}。選択肢そのものの一覧は出力しない。\n・複数の解答記号が1行にまとまり、その行全体で配点されている場合は「完答」。\n・「解答の順序は問わない」「順不同」等の注記があり、グループ全体で配点される場合は「順不同+完答」。\n・「解答の順序は問わない」かつ「各2点」のように各欄に配点される場合は「順不同」とし、配点欄には各欄1つ分の点数を書く。\n・単独の解答欄は「通常」。\n・大問ごとの配点も必ず出力する。\n・問題用紙と模範解答で大問名や解答記号が食い違う場合は、問題用紙側の構造を残し、確認できない正答または配点を「要確認」とする。\n\n【出力形式】\n試験名|問題用紙または模範解答に記載された試験名\n教科|問題用紙または模範解答に記載された教科\n満点|100\n\n第1問|20\nア,イ|0,3|2|完答\nウ|3|2|通常\nエ,オ|e,4|2|完答\n\n第2問|30\nア,イ|2,4|3|順不同+完答\n...\n\n各設問行は必ず「解答記号|正答|配点|採点方式」の4項目にしてください。問題用紙にある解答欄を省略しないでください。`;
}
async function copyAiPrompt(){
  try{await navigator.clipboard.writeText(aiPromptText());$('examSourceMsg').className='success small';$('examSourceMsg').textContent='AI読取用プロンプトをコピーしました。問題用紙PDFと模範解答PDFの両方をChatGPTやClaude等へ渡してください。'}catch(e){alert(aiPromptText())}
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
  const confirmed=!!$('formTestConfirmed').checked,now=new Date().toISOString();
  return {provider:'google_forms',version:1,actionUrl:googleFormSetup.actionUrl,viewUrl:googleFormSetup.viewUrl||'',nameEntry:st.nameEntry,studentCodeEntry:st.codeEntry,questionEntries:st.answerEntries.map((x,i)=>({questionId:questions[i].id,entry:x.entry})),nameRequired:true,testConfirmed:confirmed,lastTestAttemptedAt:googleFormSetup.testAttempted?now:null,verifiedAt:confirmed?now:null,verificationSource:confirmed?'builder_confirmation':'builder',configuredAt:now};
}
function postGoogleForm(actionUrl,fields){
  return new Promise((resolve,reject)=>{
    try{
      if(!navigator.onLine)throw new Error('ネットワークに接続されていません。');
      const frame=document.createElement('iframe');frame.name=`tdx_form_${Date.now()}_${Math.random().toString(36).slice(2)}`;frame.style.display='none';frame.setAttribute('aria-hidden','true');document.body.appendChild(frame);
      const form=document.createElement('form');form.method='POST';form.action=actionUrl;form.target=frame.name;form.style.display='none';form.acceptCharset='UTF-8';
      Object.entries(fields).forEach(([k,v])=>{const input=document.createElement('input');input.type='hidden';input.name=k;input.value=String(v??'');form.appendChild(input)});
      [['fvv','1'],['pageHistory','0'],['submit','Submit']].forEach(([k,v])=>{const input=document.createElement('input');input.type='hidden';input.name=k;input.value=v;form.appendChild(input)});
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
    fields[st.nameEntry]='T-DXテスト';fields[st.codeEntry]='9999';
    st.answerEntries.forEach((m,i)=>{const sample=entryByKey(m.entry)?.value||configuredChoices()[0]||'0';fields[m.entry]=sample});
    $('testGoogleFormBtn').disabled=true;$('formTestMsg').className='small muted';$('formTestMsg').textContent='Googleフォームへテスト送信しています…';
    await postGoogleForm(googleFormSetup.actionUrl,fields);googleFormSetup.testAttempted=true;
    $('formTestMsg').className='success small';$('formTestMsg').textContent='テスト送信処理を実行しました。Googleフォームの「回答」タブを開き、1件追加されていることを確認したら「受信を確認した」にチェックしてください。';
  }catch(e){console.error(e);$('formTestMsg').className='error small';$('formTestMsg').textContent=e.message}finally{$('testGoogleFormBtn').disabled=false}
}

function storedGoogleFormConfigValid(exam){
  const f=exam?.formSubmission;
  return !!(f&&f.provider==='google_forms'&&f.actionUrl&&f.nameEntry&&f.studentCodeEntry&&Array.isArray(f.questionEntries)&&f.questionEntries.length===(exam.questions||[]).length&&f.questionEntries.every(x=>x?.entry));
}
function storedGoogleFormViewUrl(exam){
  const direct=String(exam?.googleFormUrl||'').trim();
  if(direct){try{return googleFormEndpoints(direct).viewUrl}catch(_){}}
  const action=String(exam?.formSubmission?.actionUrl||'').trim();
  if(action){try{return googleFormEndpoints(action).viewUrl}catch(_){}}
  return '';
}
function googleFormVerificationLabel(exam){
  const hasForm=!!(storedGoogleFormViewUrl(exam)||exam?.formSubmission);
  if(!hasForm)return {text:'フォームなし',tone:'none'};
  if(!storedGoogleFormConfigValid(exam))return {text:'要設定',tone:'warn'};
  if(exam.formSubmission?.testConfirmed)return {text:'受信確認済み',tone:'ok'};
  if(exam.formSubmission?.verificationSource==='clone_inherited'||exam.formSubmission?.inheritedFrom)return {text:'引継ぎ・未確認',tone:'mid'};
  return {text:'設定済み・未確認',tone:'mid'};
}
function renderPublishGoogleFormPanel(exam){
  const panel=$('publishGoogleFormPanel');if(!panel)return;
  const url=exam?storedGoogleFormViewUrl(exam):'';
  const valid=!!exam&&storedGoogleFormConfigValid(exam);
  const status=exam?googleFormVerificationLabel(exam):{text:'試験未選択',tone:'none'};
  const badge=$('publishFormStatusBadge');
  if(badge){badge.textContent=status.text;badge.className=`publish-form-status ${status.tone||'none'}`}
  const input=$('publishCurrentFormUrl');if(input)input.value=url;
  const openBtn=$('openPublishedGoogleFormBtn');if(openBtn){openBtn.disabled=!url;openBtn.title=url?'現在設定されているGoogleフォームを別タブで開きます。':'Googleフォームが設定されていません。'}
  const testBtn=$('testPublishedGoogleFormBtn');if(testBtn){testBtn.disabled=!valid;testBtn.title=valid?'現在保存されているentry対応でダミー回答を1件送信します。':'Googleフォームのentry対応が未設定または不完全です。'}
  const confirmBox=$('publishFormConfirmed');
  if(confirmBox){
    confirmBox.checked=!!exam?.formSubmission?.testConfirmed;
    confirmBox.disabled=!valid||(!exam?.formSubmission?.lastTestAttemptedAt&&!exam?.formSubmission?.testConfirmed);
    confirmBox.title=confirmBox.disabled&&valid?'先に「現在の設定でテスト送信」を実行してください。':'';
  }
  const summary=$('publishFormMappingSummary');
  if(summary){
    if(!exam||(!url&&!exam.formSubmission)){summary.innerHTML='<span>Googleフォームを使わない試験です。</span>'}
    else if(valid){
      const f=exam.formSubmission,q=(exam.questions||[]).length;
      const inherited=f.verificationSource==='clone_inherited'||f.inheritedFrom;
      const source=inherited?' / 複製元から引継ぎ':'';
      summary.innerHTML=`<span><strong>entry対応：</strong>氏名 1 / 4桁番号 1 / 解答 ${q}件${source}</span>`;
    }else summary.innerHTML='<span class="warn-text"><strong>entry対応が不完全です。</strong> 下の「Googleフォームを変更・再設定する」から事前入力URLを読み込んでください。</span>';
  }
  const msg=$('publishFormTestMsg');
  if(msg&&!msg.dataset.keep){
    msg.className='small muted';
    msg.textContent=valid?(exam.formSubmission?.testConfirmed?'Googleフォームの受信確認済みです。':'テスト送信後、Googleフォームの「回答」タブで受信を確認してください。'):(url?'送信先URLはありますが、entry対応を再設定してください。':'Googleフォームは設定されていません。');
  }
}
function updatePublishGoogleFormTestButton(exam){renderPublishGoogleFormPanel(exam)}
function openSelectedExamGoogleForm(){
  const exam=exams.find(e=>e.id===$('publishExamSelect')?.value);
  const url=storedGoogleFormViewUrl(exam);
  if(!url){alert('この試験にはGoogleフォームURLが設定されていません。');return}
  window.open(url,'_blank','noopener,noreferrer');
}

function openSelectedExamGoogleFormEditor(){
  const exam=exams.find(e=>e.id===$('publishExamSelect')?.value);
  if(!exam){alert('試験を選択してください。');return}
  const details=$('publishFormChangeDetails');
  if(details)details.open=true;
  const input=$('publishFormPrefillUrl');
  if(input){input.focus();input.scrollIntoView({behavior:'smooth',block:'center'})}
  const msg=$('publishFormReplaceMsg');
  if(msg){
    msg.className='notice small';
    msg.innerHTML=exam.clonedFrom
      ? '<strong>複製試験です。</strong> 元試験と同じGoogleフォームを使うなら変更不要です。別フォームを使う場合だけ、新しいフォームの<strong>事前入力URL</strong>を貼り付けてください。'
      : '別のGoogleフォームへ変更する場合は、新しいフォームの<strong>事前入力URL</strong>を貼り付けてください。';
  }
}

function parsePrefilledGoogleFormForExam(raw,exam){
  const ep=googleFormEndpoints(raw),u=new URL(cleanGoogleFormUrlInput(raw)),entries=[];
  for(const [key,value] of u.searchParams.entries())if(/^entry\.\d+$/.test(key))entries.push({key,value});
  const expected=(exam?.questions||[]).length+2;
  if(entries.length!==expected)throw new Error(`事前入力リンクから entry を ${entries.length}件 取得しました。現在の試験では「氏名・4桁番号・解答 ${(exam?.questions||[]).length}件」の合計 ${expected}件 が必要です。全項目を事前入力してリンクを取り直してください。`);
  const ids=detectGoogleIdentityEntries(entries);
  if(!ids.nameEntry||!ids.codeEntry||ids.nameEntry===ids.codeEntry)throw new Error('氏名と4桁番号のentryを判別できませんでした。氏名には文字列、4桁番号には4桁の数字を事前入力してリンクを取得してください。');
  const answers=entries.filter(e=>e.key!==ids.nameEntry&&e.key!==ids.codeEntry);
  if(answers.length!==(exam.questions||[]).length)throw new Error('Googleフォームの解答欄数と試験の解答欄数が一致しません。');
  return {ep,entries,ids,answers};
}
function replaceSelectedExamGoogleForm(){
  const exam=exams.find(e=>e.id===$('publishExamSelect')?.value),msg=$('publishFormReplaceMsg');
  try{
    if(!exam)throw new Error('試験を選択してください。');
    const raw=$('publishFormPrefillUrl')?.value.trim();if(!raw)throw new Error('事前入力したGoogleフォームのリンクを貼り付けてください。');
    const parsed=parsePrefilledGoogleFormForExam(raw,exam),now=new Date().toISOString();
    exam.googleFormUrl=parsed.ep.viewUrl;
    exam.formSubmission={provider:'google_forms',version:1,actionUrl:parsed.ep.actionUrl,viewUrl:parsed.ep.viewUrl,nameEntry:parsed.ids.nameEntry,studentCodeEntry:parsed.ids.codeEntry,questionEntries:(exam.questions||[]).map((q,i)=>({questionId:q.id,entry:parsed.answers[i].key})),nameRequired:true,testConfirmed:false,lastTestAttemptedAt:null,verifiedAt:null,verificationSource:'reconfigured',configuredAt:now};
    exam.updatedAt=now;allExamData.exams=exams;
    $('publishFormPrefillUrl').value='';
    if(msg){msg.className='success small';msg.textContent=`Googleフォームを差し替えました。entry ${parsed.entries.length}件（氏名・4桁番号・解答 ${(exam.questions||[]).length}件）を対応しました。次にテスト送信してください。`}
    const t=$('publishFormTestMsg');if(t){delete t.dataset.keep;t.textContent=''}
    renderPublishGoogleFormPanel(exam);renderExamReadiness(exam);renderExamExportSummary();
  }catch(e){console.error(e);if(msg){msg.className='error small';msg.textContent=e.message}}
}
function confirmSelectedExamGoogleFormReceipt(){
  const exam=exams.find(e=>e.id===$('publishExamSelect')?.value),box=$('publishFormConfirmed');
  if(!exam||!box)return;
  const f=exam.formSubmission;
  if(!storedGoogleFormConfigValid(exam)){box.checked=false;alert('Googleフォームのentry対応が不完全です。先に連携設定を確認してください。');return}
  if(box.checked&&!f.lastTestAttemptedAt&&!f.testConfirmed){box.checked=false;alert('先に「現在の設定でテスト送信」を実行し、Googleフォームの回答タブで受信を確認してください。');return}
  f.testConfirmed=box.checked;f.verifiedAt=box.checked?new Date().toISOString():null;
  if(box.checked)f.verificationSource='manual_confirmation';
  exam.updatedAt=new Date().toISOString();allExamData.exams=exams;
  const msg=$('publishFormTestMsg');if(msg){msg.dataset.keep='1';msg.className=(box.checked?'success':'notice')+' small';msg.textContent=box.checked?'✓ Googleフォームの実受信を確認済みにしました。公開設定へ進めます。':'受信確認を未確認に戻しました。公開前に再確認してください。'}
  renderPublishGoogleFormPanel(exam);renderExamReadiness(exam);renderExamExportSummary();
}
async function testSelectedExamGoogleForm(){
  const exam=exams.find(e=>e.id===$('publishExamSelect')?.value);
  const msg=$('publishFormTestMsg'),btn=$('testPublishedGoogleFormBtn');
  try{
    if(!exam)throw new Error('試験を選択してください。');
    if(!storedGoogleFormConfigValid(exam))throw new Error('この試験のGoogleフォーム連携設定が不完全です。試験作成画面で連携設定を確認してください。');
    const f=exam.formSubmission,fields={};
    const code='9999';
    fields[f.nameEntry]='T-DXテスト';
    fields[f.studentCodeEntry]=code;
    const qMap=new Map((exam.questions||[]).map(q=>[String(q.id),q]));
    for(const m of f.questionEntries){
      const q=qMap.get(String(m.questionId));
      if(!q)throw new Error(`Googleフォーム連携に対応する設問 ${m.questionId} が見つかりません。`);
      const sample=String(q.answer??q.options?.[0]??'').trim();
      if(sample==='')throw new Error(`${q.label||`設問${q.id}`} のテスト送信用回答を作れません。正答または選択肢を確認してください。`);
      fields[m.entry]=sample;
    }
    btn.disabled=true;
    msg.className='small muted';
    msg.textContent=`「${exam.title}」のGoogleフォームへテスト送信しています…`;
    await postGoogleForm(f.actionUrl,fields);
    f.lastTestAttemptedAt=new Date().toISOString();exam.updatedAt=f.lastTestAttemptedAt;allExamData.exams=exams;
    msg.dataset.keep='1';msg.className='success small';
    msg.innerHTML=`<strong>テスト送信処理を実行しました。</strong> 氏名「T-DXテスト」・4桁番号「${esc(code)}」で送っています。Googleフォームの「回答」タブを開き、1件追加されたら右の「受信を確認した」にチェックしてください。<br><span>※ ブラウザからGoogleフォーム側の受理結果までは確認できません。</span>`;
    renderPublishGoogleFormPanel(exam);
  }catch(e){
    console.error(e);
    if(msg){msg.className='error small';msg.textContent=e.message||'Googleフォームのテスト送信に失敗しました。'}
  }finally{
    if(btn)btn.disabled=!storedGoogleFormConfigValid(exam);
  }
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
  if(typeof XLSX==='undefined')throw new Error('Excel読込ライブラリの準備ができていません。数秒待ってからもう一度実行するか、画面を再読み込みしてください。');
  const buf=await file.arrayBuffer(),wb=XLSX.read(buf,{type:'array',cellDates:true}),ws=wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:''});
}
function normalizeHeader(v){return String(v??'').replace(/[\s　]+/g,'').replace(/[，,]/g,',').trim()}
function findHeaderIndex(headers,words,fallback){
  const idx=headers.findIndex(h=>words.some(w=>normalizeHeader(h).includes(w)));
  return idx>=0?idx:fallback;
}
function normalizeStudentCode(v){
  const s=String(v??'').trim().replace(/\.0+$/,'');
  return /^\d{4}$/.test(s)?s:'';
}
function parseResponseTimestamp(value,rowIndex){
  if(value instanceof Date&&Number.isFinite(value.getTime()))return value.getTime();
  const s=String(value??'').trim();
  const m=s.match(/(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if(m){const t=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]),Number(m[6]||0)).getTime();if(Number.isFinite(t))return t}
  const t=Date.parse(s);return Number.isFinite(t)?t:rowIndex;
}
function formatResponseTimestamp(value){
  if(value instanceof Date&&Number.isFinite(value.getTime()))return new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(value);
  return String(value??'').trim()||'時刻不明';
}
function isSystemTestResponse(name){return normalizeHeader(name).toUpperCase()==='T-DXテスト'.toUpperCase()}
function isLaterResponse(a,b){
  if(Number.isFinite(a.timestampMs)&&Number.isFinite(b.timestampMs)&&a.timestampMs!==b.timestampMs)return a.timestampMs>b.timestampMs;
  return a.rowIndex>b.rowIndex;
}
function currentAnalysisRows(){
  const key=$('classFilter')?.value||'ALL';
  return key==='ALL'?analysisRows:analysisRows.filter(r=>r.classKey===key);
}
async function analyzeFile(){
  try{
    const f=$('responseFile').files[0];if(!f){alert('回答ExcelまたはCSVを選択してください。');return}
    analysisExam=exams.find(e=>e.id===$('analysisExam').value);if(!analysisExam){alert('分析する試験を選択してください。');return}
    const rows=await readRows(f);if(rows.length<2){alert('回答データが見つかりません。');return}
    const headers=rows[0]||[],qCount=(analysisExam.questions||[]).length;if(!qCount){alert('選択した試験に設問データがありません。');return}
    const timestampIndex=findHeaderIndex(headers,['タイムスタンプ','timestamp'],0);
    const nameIndex=findHeaderIndex(headers,['名前','氏名','name'],1);
    const codeIndex=findHeaderIndex(headers,['クラス・出席番号','出席番号','4桁番号','４桁番号'],2);
    const valid=[],duplicateCountByCode=new Map();let ignored=0,tests=0;
    for(let i=1;i<rows.length;i++){
      const r=rows[i]||[],code=normalizeStudentCode(r[codeIndex]),name=String(r[nameIndex]??'').trim();
      if(isSystemTestResponse(name)){tests++;continue}
      if(!code){ignored++;continue}
      const ansVals=r.slice(Math.max(0,r.length-qCount)),answers={};
      analysisExam.questions.forEach((q,j)=>answers[q.id]=String(ansVals[j]??'').trim());
      const score=TDX.scoreExam(analysisExam,answers),timestampValue=r[timestampIndex],timestampMs=parseResponseTimestamp(timestampValue,i);
      valid.push({code,name:name||'（氏名なし）',classKey:code.slice(0,Number($('classDigits').value)||2),answers,score,timestampValue,timestampMs,rowIndex:i});
      duplicateCountByCode.set(code,(duplicateCountByCode.get(code)||0)+1);
    }
    if(!valid.length){alert('分析できる回答行を認識できませんでした。4桁番号と回答データを確認してください。');return}
    const latest=new Map();
    valid.forEach(row=>{const prev=latest.get(row.code);if(!prev||isLaterResponse(row,prev))latest.set(row.code,row)});
    analysisRows=[...latest.values()].sort((a,b)=>a.code.localeCompare(b.code));
    const duplicateCodes=[...duplicateCountByCode.entries()].filter(([,n])=>n>1).map(([code,n])=>({code,count:n,removed:n-1}));
    analysisMeta={raw:Math.max(0,rows.length-1),valid:valid.length,participants:analysisRows.length,duplicates:valid.length-analysisRows.length,tests,ignored,fileName:f.name,duplicateCodes};
    const classes=[...new Set(analysisRows.map(r=>r.classKey))].sort();
    $('classFilter').innerHTML='<option value="ALL">全クラス</option>'+classes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
    $('questionSort').value='rate-asc';$('questionFilter').value='all';$('studentSort').value='score-desc';
    $('analysisOutput').classList.remove('hidden');closeStudentAnalysisDetail();renderAnalysis();
  }catch(e){console.error(e);alert(e.message||'回答ファイルの分析中にエラーが発生しました。')}
}
function renderAnalysis(){
  if(!analysisRows.length||!analysisExam)return;
  const rows=currentAnalysisRows();
  if(!rows.length){$('analysisKpis').innerHTML='<div class="notice">このクラスには採用された回答がありません。</div>';return}
  const scores=rows.map(r=>Number(r.score.total||0)),avg=scores.reduce((a,b)=>a+b,0)/scores.length,max=Math.max(...scores),min=Math.min(...scores);
  $('analysisKpis').innerHTML=`<div class="kpi"><div class="muted small">受験者数</div><div class="value">${rows.length}</div></div><div class="kpi"><div class="muted small">平均点</div><div class="value">${avg.toFixed(1)}</div></div><div class="kpi"><div class="muted small">最高点</div><div class="value">${max}</div></div><div class="kpi"><div class="muted small">最低点</div><div class="value">${min}</div></div>`;
  renderAnalysisImportSummary(rows);renderHistogram(scores);renderSections(rows);renderAnalysisInsights(rows);renderQuestionRates(rows);renderStudentAnalysis(rows);
}
function renderAnalysisImportSummary(rows){
  const root=$('analysisImportSummary');if(!root)return;
  const dup=analysisMeta.duplicates?`<span class="analysis-import-chip warn">重複 ${analysisMeta.duplicates}件を最新回答に置換</span>`:'';
  const tests=analysisMeta.tests?`<span class="analysis-import-chip test">テスト送信 ${analysisMeta.tests}件を除外</span>`:'';
  const ignored=analysisMeta.ignored?`<span class="analysis-import-chip warn">4桁番号不正 ${analysisMeta.ignored}件を除外</span>`:'';
  const duplicateText=analysisMeta.duplicateCodes.length?`<small>重複：${analysisMeta.duplicateCodes.map(x=>`${esc(x.code)}（${x.count}件→1件）`).join('、')}</small>`:'';
  root.innerHTML=`<div class="analysis-import-main"><strong>${esc(analysisMeta.fileName||'回答ファイル')}</strong><span>読み込み ${analysisMeta.raw}件 → 採用 ${analysisMeta.participants}人</span><span class="analysis-import-chip ok">同一4桁番号は最新回答のみ採用</span>${dup}${tests}${ignored}</div>${duplicateText}${rows.length<10?'<small class="sample-note">※ 現在の表示対象は10人未満です。1人の正誤で正答率が大きく動くため、テストデータでは数値の変化を確認する用途として見てください。</small>':''}`;
}
function renderHistogram(scores){
  const bins=Array(10).fill(0);scores.forEach(s=>bins[Math.min(9,Math.max(0,Math.floor(Number(s||0)/10)))]++);const m=Math.max(...bins,1);
  $('histogram').innerHTML=bins.map((n,i)=>`<div class="col"><div class="stick" style="height:${Math.max(2,n/m*180)}px" title="${n}人"></div><div class="lab">${i*10}-${i===9?100:i*10+9}<br>${n}人</div></div>`).join('')
}
function renderSections(rows){
  $('sectionAnalysis').innerHTML=(analysisExam.sections||[]).map(s=>{const points=Number(s.points||0),sum=rows.reduce((a,r)=>a+Number(r.score.sectionScores[s.id]||0),0),pct=points>0?sum/(rows.length*points)*100:0;return `<div class="bar-row"><strong>${esc(s.name)}</strong><div class="bar"><div style="width:${Math.min(100,pct).toFixed(1)}%"></div></div><div>${pct.toFixed(1)}%</div></div>`}).join('')
}
function analysisQuestionUnits(){
  const questions=analysisExam?.questions||[],seen=new Set(),units=[];
  questions.forEach((q,index)=>{
    const grouped=!!q.group&&['unordered_item','complete_item','unordered_complete_item'].includes(q.type);
    const key=grouped?`g:${q.group}`:`q:${q.id}`;
    if(seen.has(key))return;seen.add(key);
    const members=grouped?questions.filter(x=>x.group===q.group):[q];
    units.push({key,type:q.type,members,index,section:q.section,group:q.group||''});
  });
  return units;
}
function combineQuestionLabels(members){
  const labels=members.map(q=>String(q.label||'').trim()).filter(Boolean);if(labels.length<=1)return labels[0]||'';
  const parts=labels.map(x=>x.split(/\s+/)),prefixes=parts.map(p=>p.slice(0,-1).join(' '));
  if(prefixes[0]&&prefixes.every(p=>p===prefixes[0]))return `${prefixes[0]} ${parts.map(p=>p[p.length-1]).join('・')}`;
  return labels.join('・');
}
function shortQuestionToken(q){const p=String(q?.label||'').trim().split(/\s+/);return p[p.length-1]||String(q?.label||'')}
function multisetIntersectionCount(values,targets){
  const counts=new Map();targets.map(String).forEach(v=>counts.set(v,(counts.get(v)||0)+1));let hit=0;
  values.map(v=>String(v??'')).forEach(v=>{const n=counts.get(v)||0;if(v&&n>0){hit++;counts.set(v,n-1)}});return hit;
}
function sameMultiset(values,targets){const a=values.map(v=>String(v??'')).sort(),b=targets.map(String).sort();return a.length===b.length&&a.every((v,i)=>v===b[i])}
function unitAnswerLabel(unit){
  const vals=unit.members.map(q=>String(q.answer??''));
  if(unit.type==='unordered_item')return `${vals.join('・')}（順不同）`;
  if(unit.type==='unordered_complete_item')return `${vals.join('・')}（順不同・完答）`;
  if(unit.type==='complete_item')return `${vals.join('・')}（完答）`;
  return vals[0]||'';
}
function unitTypeLabel(unit){return ({normal:'',unordered_item:'順不同（各欄採点）',complete_item:'完答',unordered_complete_item:'順不同＋完答'})[unit.type]||unit.type||''}
function unitPointLabel(unit){
  if(unit.type==='complete_item')return `${Number(unit.members[0]?.groupPoints||0)}点（完答）`;
  if(unit.type==='unordered_complete_item')return `${Number(unit.members[0]?.groupPoints||0)}点（順不同・完答）`;
  if(unit.type==='unordered_item'){
    const ps=unit.members.map(q=>Number(q.points||0)),total=ps.reduce((a,b)=>a+b,0),same=ps.every(p=>p===ps[0]);
    return same?`各${ps[0]}点 / 計${total}点`:`計${total}点（各欄採点）`;
  }
  return `${Number(unit.members[0]?.points||0)}点`;
}
function rowDetailFor(row,q){return row.score.detail.find(x=>String(x.q.id)===String(q.id))}
function questionStats(rows){
  const sectionNames=new Map((analysisExam.sections||[]).map(s=>[s.id,s.name]));
  return analysisQuestionUnits().map(unit=>{
    let pct=0,ok=0,statusMain='',statusSub='',metricLabel='正答率',subMetric='';
    if(unit.type==='unordered_item'){
      let correctMarks=0,full=0;rows.forEach(r=>{const ds=unit.members.map(q=>rowDetailFor(r,q));const hits=ds.filter(d=>d?.correct).length;correctMarks+=hits;if(hits===unit.members.length)full++});
      pct=rows.length&&unit.members.length?correctMarks/(rows.length*unit.members.length)*100:0;ok=full;metricLabel='平均正答マーク率';statusMain=`全正解 ${full}/${rows.length}`;statusSub=`正答マーク ${correctMarks}/${rows.length*unit.members.length}`;
    }else if(unit.type==='complete_item'||unit.type==='unordered_complete_item'){
      let full=0;rows.forEach(r=>{const d=rowDetailFor(r,unit.members[0]);if(d?.correct)full++});pct=rows.length?full/rows.length*100:0;ok=full;metricLabel='完答率';statusMain=`完答 ${full}/${rows.length}`;
      if(unit.type==='complete_item'){
        const parts=unit.members.map(q=>{const n=rows.filter(r=>String(r.answers[q.id]??'')===String(q.answer??'')).length;return `${shortQuestionToken(q)} ${rows.length?(n/rows.length*100).toFixed(1):'0.0'}%`});
        subMetric=`欄別正答率：${parts.join(' / ')}`;
      }else statusSub='順番を問わず全欄一致で得点';
    }else{
      let correct=0;rows.forEach(r=>{const d=rowDetailFor(r,unit.members[0]);if(d?.correct)correct++});pct=rows.length?correct/rows.length*100:0;ok=correct;statusMain=`正答 ${correct}/${rows.length}`;
    }
    let level='middle',levelLabel='要確認';if(pct<50){level='review';levelLabel='重点復習'}else if(pct>=80){level='must';levelLabel='できてほしい'}
    return {unit,index:unit.index,label:combineQuestionLabels(unit.members),answerLabel:unitAnswerLabel(unit),pointLabel:unitPointLabel(unit),typeLabel:unitTypeLabel(unit),pct,ok,total:rows.length,section:sectionNames.get(unit.section)||unit.section||'',level,levelLabel,metricLabel,statusMain,statusSub,subMetric};
  });
}
function publicAnalysisSnapshot(rows){
  const scores=rows.map(r=>Number(r.score.total||0)),participants=rows.length;
  const sectionRates=(analysisExam.sections||[]).map(sec=>{
    const points=Number(sec.points||0),sum=rows.reduce((a,r)=>a+Number(r.score.sectionScores[sec.id]||0),0);
    return {id:sec.id,name:sec.name,rate:participants&&points?Number((sum/(participants*points)*100).toFixed(1)):0};
  });
  const questions=questionStats(rows).map(x=>({
    key:x.unit.key,order:x.index,label:x.label,section:x.section,type:x.unit.type,typeLabel:x.typeLabel||'',metricLabel:x.metricLabel,pct:Number(x.pct.toFixed(1))
  }));
  return {
    participants,
    averageScore:participants?Number((scores.reduce((a,b)=>a+b,0)/participants).toFixed(1)):0,
    maxScore:participants?Math.max(...scores):0,
    minScore:participants?Math.min(...scores):0,
    sectionRates,
    questions
  };
}
function buildStudentAnalysisEntry(publishToken=''){
  if(!analysisExam||!analysisRows.length)return null;
  const byClass={};
  [...new Set(analysisRows.map(r=>r.classKey).filter(Boolean))].sort().forEach(classKey=>{
    const rows=analysisRows.filter(r=>r.classKey===classKey);byClass[classKey]=publicAnalysisSnapshot(rows);
  });
  return {
    examId:analysisExam.id,
    title:analysisExam.title,
    subject:analysisExam.subject||'',
    totalPoints:Number(analysisExam.totalPoints||100),
    generatedAt:new Date().toISOString(),
    publishToken,
    overall:publicAnalysisSnapshot(analysisRows),
    classes:byClass
  };
}
function exportStudentAnalysisData(){
  const entry=buildStudentAnalysisEntry();
  if(!entry){alert('先に回答Excel / CSVを読み込んで分析してください。');return}
  const analyses=(allAnalysisData.analyses||[]).filter(x=>x.examId!==analysisExam.id);analyses.push(entry);
  analyses.sort((a,b)=>String(a.title||'').localeCompare(String(b.title||''),'ja'));
  allAnalysisData={version:3,systemName:'T-DX Lab☆問題演習システム',schoolYear:String(usersData.schoolYear||new Date().getFullYear()),resetEpoch:String(usersData.resetEpoch||''),updatedAt:new Date().toISOString(),analyses};
  TDX.download('analysis.json',JSON.stringify(allAnalysisData,null,2));
}
function postAnalysisGasForm(fields){
  return new Promise(resolve=>{
    const frame=document.createElement('iframe');frame.name=`tdx_analysis_post_${Date.now()}_${Math.random().toString(36).slice(2)}`;frame.style.display='none';frame.setAttribute('aria-hidden','true');document.body.appendChild(frame);
    const form=document.createElement('form');form.method='POST';form.action=TDX.ANALYSIS_GAS_URL;form.target=frame.name;form.style.display='none';
    Object.entries(fields).forEach(([k,v])=>{const input=document.createElement('input');input.type='hidden';input.name=k;input.value=String(v??'');form.appendChild(input)});
    document.body.appendChild(form);let finished=false;
    const done=()=>{if(finished)return;finished=true;form.remove();setTimeout(()=>frame.remove(),500);resolve()};
    frame.onload=()=>setTimeout(done,150);HTMLFormElement.prototype.submit.call(form);setTimeout(done,2500);
  });
}

function newGasSyncToken(){
  return crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
async function waitForGasSync(token,tries=18){
  let last=null;
  for(let i=0;i<tries;i++){
    await new Promise(r=>setTimeout(r,i?650:300));
    try{
      const x=await TDX.gasJson({action:'getSyncStatus',token},12000);
      last=x;
      if(x?.done){
        if(!x.ok)throw new Error(x.message||'公開同期に失敗しました。');
        return x;
      }
    }catch(e){
      if(i===tries-1)throw e;
    }
  }
  throw new Error(last?.message||'公開完了を確認できませんでした。少し待ってからもう一度お試しください。');
}
async function ensureTeacherPublishAccess(){
  const who=await TDX.gasJson({action:'whoami'},12000);
  if(!who?.ok)throw new Error(who?.message||'公開サーバーの確認に失敗しました。');
  if(!who.teacher)throw new Error(`このOENアカウント（${who.user||'不明'}）は公開権限がありません。共有スプレッドシートを「編集者」で共有してください。`);
  if(!who.githubConfigured)throw new Error('GitHub自動連携が未設定です。システム管理者がApps Scriptで setupGitHubConnection を1回実行してください。');
  return who;
}
async function postGasSync(action,payload,token=newGasSyncToken()){
  await postAnalysisGasForm({action,payload:JSON.stringify(payload),syncToken:token});
  return await waitForGasSync(token);
}
function currentExamBundleForSync(){
  allExamData.version=Math.max(Number(allExamData.version||0),10);
  allExamData.systemName=allExamData.systemName||'T-DX Lab☆問題演習システム';
  allExamData.schoolYear=String(allExamData.schoolYear||usersData.schoolYear||new Date().getFullYear());
  allExamData.resetEpoch=String(allExamData.resetEpoch||usersData.resetEpoch||'');
  allExamData.exams=exams;
  allExamData.updatedAt=new Date().toISOString();
  return allExamData;
}
async function syncExamsToPublicData(){
  await ensureTeacherPublishAccess();
  return await postGasSync('publishExams',currentExamBundleForSync());
}

async function syncUsersToPublicData(vaultEntries=[]){
  const who=await ensureSystemAdminAccess();
  if(!who.githubConfigured)throw new Error('GitHub自動連携が未設定です。システム管理者がApps Scriptで setupGitHubConnection を実行してください。');
  const missingLegacy=legacyQrPendingCount();
  if(missingLegacy>0){
    throw new Error(`旧バージョンのQR情報が ${missingLegacy}人分残っています。本番前にやり直す場合は「完全初期化（年度維持）」を実行してください。`);
  }
  const payload={bundle:currentUsersBundleForSync(),vaultEntries:vaultEntries||[]};
  const result=await postGasSync('publishUsers',payload);
  usersData.version=7;
  usersData.updatedAt=new Date().toISOString();
  const stored=new Set(accessVault.map(x=>x.studentCode));
  usersData.users.forEach(u=>{u.qrStored=stored.has(u.studentCode);delete u.qrSecret});
  usersData.qrVault=null;
  dataVersionMeta.users=usersData.updatedAt;
  updateVersionStatus();
  return result;
}
async function manualSyncUsers(){
  const btn=$('syncRosterUsersBtn'),old=btn?.textContent||'生徒データを反映';
  if(btn){btn.disabled=true;btn.textContent='反映中…'}
  try{
    const result=await syncUsersToPublicData([]);
    setIndividualStudentMessage(`✓ 生徒認証データを自動反映しました（${result.users??usersData.users.length}人）。平文アクセスキーはGitHubへ送っていません。`,'success');
  }catch(e){
    setIndividualStudentMessage(`反映できませんでした：${e.message||e}`,'error');
    alert(`生徒データの反映に失敗しました。\n\n${e.message||e}`);
  }finally{if(btn){btn.disabled=false;btn.textContent=old}}
}
function annualBackupPayload(){
  return {
    exportedAt:new Date().toISOString(),
    note:'T-DX Lab初期化／年度更新前バックアップ。Googleフォーム回答・ダウンロード済みExcel/PDF・GAS内の平文アクセスキーは含みません。',
    schoolYear:String(usersData.schoolYear||allExamData?.schoolYear||new Date().getFullYear()),
    users:currentUsersBundleForSync(),
    exams:JSON.parse(JSON.stringify(currentExamBundleForSync())),
    analysis:JSON.parse(JSON.stringify(allAnalysisData))
  };
}
function downloadAnnualBackup(){
  const year=String(usersData.schoolYear||allExamData?.schoolYear||new Date().getFullYear());
  TDX.download(`T-DX_Lab_${year}年度_初期化前バックアップ.json`,JSON.stringify(annualBackupPayload(),null,2));
  const el=$('annualResetMsg');if(el){el.className='success small';el.textContent='初期化前バックアップを書き出しました。Googleフォーム回答やExcel/PDFは別管理です。'}
}
function clearTeacherLocalOperationalData(schoolYear,resetEpoch){
  try{
    localStorage.removeItem('tdxRosterRanges');
    localStorage.removeItem('tdxDraftExam');
  }catch(_){}
  const year=String(schoolYear||new Date().getFullYear());
  const epoch=String(resetEpoch||'');
  exams=[];
  usersData={version:7,systemName:'T-DX Lab☆問題演習システム',schoolYear:year,resetEpoch:epoch,users:[],issuedCodeIds:[]};
  allExamData={version:10,systemName:'T-DX Lab☆問題演習システム',schoolYear:year,resetEpoch:epoch,updatedAt:new Date().toISOString(),exams:[]};
  allAnalysisData={version:3,systemName:'T-DX Lab☆問題演習システム',schoolYear:year,resetEpoch:epoch,updatedAt:new Date().toISOString(),analyses:[]};
  analysisRows=[];analysisExam=null;analysisMeta={raw:0,valid:0,participants:0,duplicates:0,tests:0,ignored:0,fileName:'',duplicateCodes:[]};annualSecrets=[];accessVault=[];
  publishRoster=[];editorRows=[];editorSectionTargets={};
  rosterRanges=[{start:'',end:''}];
  googleFormSetup={entries:[],viewUrl:'',actionUrl:'',testAttempted:false};previewMode='before';
}
async function currentYearReset(){
  const currentYear=String(usersData.schoolYear||allExamData?.schoolYear||new Date().getFullYear());
  const msgEl=$('annualResetMsg');
  try{
    await ensureSystemAdminAccess();
    const ok=confirm(
      `${currentYear}年度のまま、T-DX Labの運用データを完全初期化します。\n\n`+
      '消えるもの：\n'+
      '・生徒認証情報\n・試験情報／模範解答\n・公開済み分析\n・GASのQR再印刷用アクセスキー\n・GASに保存した分析データ\n・このブラウザの名簿範囲／試験下書き\n\n'+
      '残るもの：\n'+
      '・年度\n・GAS本体／OEN権限\n・GitHub連携設定とトークン\n・Googleフォームの回答\n・先生PCのExcel/PDF\n・GitHubの過去コミット履歴\n\n'+
      '実行前に公開データのバックアップを自動ダウンロードします。続けますか？'
    );
    if(!ok)return;
    downloadAnnualBackup();
    const required=`RESET-${currentYear}`;
    const typed=prompt(`最終確認です。\n\n${required}\n\nと正確に入力してください。`);
    if(typed!==required){if(msgEl){msgEl.className='notice small';msgEl.textContent='確認文字列が一致しなかったため、完全初期化を中止しました。'}return}
    const btn=$('currentYearResetBtn'),old=btn?.textContent||'完全初期化（年度維持）';
    if(btn){btn.disabled=true;btn.textContent='完全初期化中…'}
    if(msgEl){msgEl.className='notice small';msgEl.textContent='GitHub公開データ・GAS分析・QR保管庫を初期化しています…'}
    try{
      const result=await postGasSync('currentYearReset',{schoolYear:currentYear,confirm:required});
      clearTeacherLocalOperationalData(currentYear,result.resetEpoch||'');
      if($('currentSchoolYearLabel'))$('currentSchoolYearLabel').textContent=`${currentYear}年度`;
      if($('nextSchoolYear'))$('nextSchoolYear').value=String(Number(currentYear)+1);
      renderRosterRanges();renderRosterSummary();renderIndividualStudents();renderAccessVaultManager();refreshExamSelects();renderExamExportSummary();renderAnnualSecrets();updateAnnualMasterButtons();
      if(msgEl){
        msgEl.className='success small';
        msgEl.innerHTML=`<strong>✓ ${esc(currentYear)}年度のまま完全初期化しました。</strong><br>GitHub連携設定とトークンは維持されています。次は生徒名簿を登録し、年間アクセスキーを新規発行してください。`;
      }
    }finally{if(btn){btn.disabled=false;btn.textContent=old}}
  }catch(e){
    if(msgEl){msgEl.className='error small';msgEl.textContent=`完全初期化に失敗しました：${e.message||e}`}
    alert(`完全初期化に失敗しました。\n\n${e.message||e}`);
  }
}
async function annualReset(){
  const input=$('nextSchoolYear');
  const targetYear=String(input?.value||'').trim();
  const msgEl=$('annualResetMsg');
  if(!/^20\d{2}$/.test(targetYear)){if(msgEl){msgEl.className='error small';msgEl.textContent='更新先年度を4桁で入力してください。'}return}
  try{
    await ensureSystemAdminAccess();
    const ok=confirm(
      `${targetYear}年度へ更新します。\n\n`+
      '現在の公開データから次を初期化します。\n'+
      '・生徒認証情報\n・試験情報／模範解答\n・公開済み分析\n・GASのQR再印刷用アクセスキー\n・GASに保存した分析データ\n\n'+
      'Googleフォームの回答、先生が保存したExcel/PDF、GitHubの過去コミット履歴は自動削除されません。\n\n'+
      '実行前に年度バックアップを自動ダウンロードします。続けますか？'
    );
    if(!ok)return;
    downloadAnnualBackup();
    const required=`RESET-${targetYear}`;
    const typed=prompt(`最終確認です。\n\n${required}\n\nと正確に入力してください。`);
    if(typed!==required){if(msgEl){msgEl.className='notice small';msgEl.textContent='確認文字列が一致しなかったため、年度更新を中止しました。'}return}
    const btn=$('annualResetBtn'),old=btn?.textContent||'年度更新を実行';
    if(btn){btn.disabled=true;btn.textContent='年度データを初期化中…'}
    if(msgEl){msgEl.className='notice small';msgEl.textContent='GitHub公開データ・GAS分析・QR保管庫を初期化しています…'}
    try{
      const result=await postGasSync('annualReset',{targetYear,confirm:required});
      clearTeacherLocalOperationalData(targetYear,result.resetEpoch||'');
      renderRosterRanges();renderRosterSummary();renderIndividualStudents();renderAccessVaultManager();refreshExamSelects();renderExamExportSummary();renderAnnualSecrets();updateAnnualMasterButtons();
      if($('currentSchoolYearLabel'))$('currentSchoolYearLabel').textContent=`${targetYear}年度`;
      if(input)input.value=String(Number(targetYear)+1);
      if(msgEl){
        msgEl.className='success small';
        msgEl.innerHTML=`<strong>✓ ${esc(targetYear)}年度用に初期化しました。</strong><br>次は新年度名簿を登録してください。GitHubトークンを年度ごとに交換する場合は、GitHubで旧トークンを削除してから Apps Script の <code>setupGitHubConnection</code> で新トークンへ置き換えてください。`;
      }
    }finally{if(btn){btn.disabled=false;btn.textContent=old}}
  }catch(e){
    if(msgEl){msgEl.className='error small';msgEl.textContent=`年度更新に失敗しました：${e.message||e}`}
    alert(`年度更新に失敗しました。\n\n${e.message||e}`);
  }
}

function setAnalysisPublishMessage(text,type='muted'){
  const el=$('analysisPublishMsg');if(!el)return;el.className=`small ${type}`;el.textContent=text;
}
async function publishStudentAnalysisToGas(){
  if(!analysisExam||!analysisRows.length){alert('先に回答Excel / CSVを読み込んで分析してください。');return}
  const btn=$('publishStudentAnalysisBtn'),old=btn.textContent;btn.disabled=true;btn.textContent='公開処理中…';
  setAnalysisPublishMessage('生徒用の公開データへ反映しています…');
  try{
    const who=await ensureTeacherPublishAccess();
    const token=newGasSyncToken(),entry=buildStudentAnalysisEntry(token);
    setAnalysisPublishMessage(`公開中：${entry.title}（集計 ${entry.overall.participants}人）`);
    const result=await postGasSync('publishAnalysis',entry,token);

    const analyses=(allAnalysisData.analyses||[]).filter(x=>x.examId!==entry.examId);
    analyses.push(entry);
    allAnalysisData={version:3,systemName:'T-DX Lab☆問題演習システム',schoolYear:String(usersData.schoolYear||new Date().getFullYear()),resetEpoch:String(usersData.resetEpoch||''),updatedAt:new Date().toISOString(),analyses};

    const stamp=new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(entry.generatedAt||Date.now()));
    setAnalysisPublishMessage(`✓ 生徒へ公開しました　${result.publishedBy||who.user||''} ／ ${stamp}　※生徒はGoogleログイン不要`,'success');
  }catch(e){
    console.error(e);
    setAnalysisPublishMessage(`公開できませんでした：${e.message||e}`,'error');
    alert(`分析の公開に失敗しました。\n\n${e.message||e}\n\n非常時は「analysis.jsonを書き出す」を利用できます。`);
  }finally{btn.disabled=false;btn.textContent=old}
}
function renderAnalysisInsights(rows){
  const root=$('analysisInsights');if(!root)return;const stats=questionStats(rows),review=stats.filter(x=>x.pct<50).sort((a,b)=>a.pct-b.pct),must=stats.filter(x=>x.pct>=80).sort((a,b)=>b.pct-a.pct),lowest=[...stats].sort((a,b)=>a.pct-b.pct)[0];
  const chips=list=>list.slice(0,6).map(x=>`<span>${esc(x.label)} <strong>${x.pct.toFixed(1)}%</strong></span>`).join('');
  root.innerHTML=`<div class="analysis-insight-card review"><div><span class="section-eyebrow">PRIORITY REVIEW</span><h4>重点復習問題 <b>${review.length}</b></h4><p>正答率・完答率が50%未満。授業・解説で優先して扱いたい設問です。</p></div><div class="analysis-insight-chips">${chips(review)||'<em>該当なし</em>'}</div></div><div class="analysis-insight-card must"><div><span class="section-eyebrow">MUST GET</span><h4>できてほしい問題 <b>${must.length}</b></h4><p>正答率・完答率が80%以上。個人で落としていた場合は振り返り対象にしやすい設問です。</p></div><div class="analysis-insight-chips">${chips(must)||'<em>該当なし</em>'}</div></div><div class="analysis-insight-card focus"><div><span class="section-eyebrow">LOWEST RATE</span><h4>最も苦戦した設問</h4><p>${lowest?`${esc(lowest.label)} ／ ${lowest.pct.toFixed(1)}% <small>(${esc(lowest.metricLabel)})</small>`:'—'}</p></div></div>`;
}
function renderQuestionRates(rows){
  const body=$('questionRates'),summary=$('questionRateSummary');if(!body)return;let stats=questionStats(rows),filter=$('questionFilter')?.value||'all',sort=$('questionSort')?.value||'rate-asc';
  if(filter==='review')stats=stats.filter(x=>x.pct<50);else if(filter==='must')stats=stats.filter(x=>x.pct>=80);else if(filter==='middle')stats=stats.filter(x=>x.pct>=50&&x.pct<80);
  if(sort==='rate-asc')stats.sort((a,b)=>a.pct-b.pct||a.index-b.index);else if(sort==='rate-desc')stats.sort((a,b)=>b.pct-a.pct||a.index-b.index);else stats.sort((a,b)=>a.index-b.index);
  const totalUnits=analysisQuestionUnits().length;if(summary)summary.textContent=`表示 ${stats.length}項目 / 全${totalUnits}項目（${analysisExam.questions.length}解答欄）`;
  body.innerHTML=stats.length?stats.map(x=>`<tr class="question-rate-row ${x.level}"><td><span class="question-section-mini">${esc(x.section)}</span></td><td><strong>${esc(x.label)}</strong>${x.typeLabel?`<small>${esc(x.typeLabel)}</small>`:''}${x.subMetric?`<small class="analysis-submetric">${esc(x.subMetric)}</small>`:''}</td><td><code>${esc(x.answerLabel)}</code></td><td>${esc(x.pointLabel)}</td><td><div class="rate-cell"><strong>${x.pct.toFixed(1)}%</strong><small class="analysis-metric-label">${esc(x.metricLabel)}</small><div class="mini-rate"><span style="width:${x.pct.toFixed(1)}%"></span></div></div></td><td><div class="analysis-status-cell"><strong>${esc(x.statusMain)}</strong>${x.statusSub?`<small>${esc(x.statusSub)}</small>`:''}</div></td><td><span class="analysis-level ${x.level}">${x.levelLabel}</span></td></tr>`).join(''):'<tr><td colspan="7" class="muted">条件に該当する設問はありません。</td></tr>';
}
function studentCorrectMarkCount(row){
  let count=0;analysisQuestionUnits().forEach(unit=>{
    if(unit.type==='normal')count+=String(row.answers[unit.members[0].id]??'')===String(unit.members[0].answer??'')?1:0;
    else if(unit.type==='unordered_item')count+=unit.members.map(q=>rowDetailFor(row,q)).filter(d=>d?.correct).length;
    else if(unit.type==='complete_item')count+=unit.members.filter(q=>String(row.answers[q.id]??'')===String(q.answer??'')).length;
    else if(unit.type==='unordered_complete_item')count+=multisetIntersectionCount(unit.members.map(q=>row.answers[q.id]??''),unit.members.map(q=>q.answer??''));
  });return count;
}
function renderStudentAnalysis(rows){
  const body=$('studentAnalysisBody'),summary=$('studentAnalysisSummary');if(!body)return;let sorted=[...rows],sort=$('studentSort')?.value||'score-desc';
  if(sort==='score-desc')sorted.sort((a,b)=>b.score.total-a.score.total||a.code.localeCompare(b.code));else if(sort==='score-asc')sorted.sort((a,b)=>a.score.total-b.score.total||a.code.localeCompare(b.code));else sorted.sort((a,b)=>a.code.localeCompare(b.code));
  if(summary)summary.textContent=`${sorted.length}人を表示`;
  body.innerHTML=sorted.map(r=>{const sectionChips=(analysisExam.sections||[]).map(s=>`<span>${esc(s.name)} <strong>${Number(r.score.sectionScores[s.id]||0)}/${Number(s.points||0)}</strong></span>`).join('');return `<tr><td><strong>${esc(r.code)}</strong></td><td><strong>${esc(r.name)}</strong><small>${esc(formatResponseTimestamp(r.timestampValue))}</small></td><td>${esc(r.classKey)}</td><td class="student-score-cell"><strong>${Number(r.score.total||0)}</strong><small>/${Number(analysisExam.totalPoints||100)}</small></td><td>${studentCorrectMarkCount(r)}/${analysisExam.questions.length}</td><td><div class="section-score-chips">${sectionChips}</div></td><td><button type="button" class="secondary glass-btn student-detail-btn" data-student-detail="${esc(r.code)}">詳細</button></td></tr>`}).join('');
}
function studentUnitResult(row,unit){
  const answers=unit.members.map(q=>String(row.answers[q.id]??'').trim()),targets=unit.members.map(q=>String(q.answer??''));
  if(unit.type==='normal'){
    const d=rowDetailFor(row,unit.members[0]),ok=!!d?.correct;return {answer:answers[0]||'未回答',correct:targets[0]||'',mark:ok?'○':'×',markClass:ok?'ok':'ng',note:'',earned:`${Number(d?.earned||0)}点`};
  }
  if(unit.type==='unordered_item'){
    const ds=unit.members.map(q=>rowDetailFor(row,q)),hits=ds.filter(d=>d?.correct).length,full=hits===unit.members.length,earned=ds.reduce((a,d)=>a+Number(d?.earned||0),0),max=unit.members.reduce((a,q)=>a+Number(q.points||0),0);
    return {answer:answers.map(v=>v||'未回答').join('・'),correct:`${targets.join('・')}（順不同）`,mark:full?'○':hits?'△':'×',markClass:full?'ok':hits?'partial':'ng',note:`${hits}/${unit.members.length}マーク`,earned:`${earned}/${max}点（各欄採点）`};
  }
  if(unit.type==='complete_item'){
    const full=unit.members.every((q,i)=>answers[i]===String(q.answer??'')),gp=Number(unit.members[0]?.groupPoints||0);return {answer:answers.map(v=>v||'未回答').join('・'),correct:`${targets.join('・')}（完答）`,mark:full?'○':'×',markClass:full?'ok':'ng',note:full?'完答':'未完答',earned:`${full?gp:0}/${gp}点（完答）`};
  }
  const full=sameMultiset(answers,targets),gp=Number(unit.members[0]?.groupPoints||0);return {answer:answers.map(v=>v||'未回答').join('・'),correct:`${targets.join('・')}（順不同・完答）`,mark:full?'○':'×',markClass:full?'ok':'ng',note:full?'完答':'未完答',earned:`${full?gp:0}/${gp}点（完答）`};
}
function renderStudentDetail(code){
  const row=currentAnalysisRows().find(r=>r.code===code);if(!row)return;const panel=$('studentDetailPanel'),body=$('studentDetailBody'),title=$('studentDetailTitle'),meta=$('studentDetailMeta');if(!panel||!body)return;
  title.textContent=`${row.code} ${row.name}`;meta.textContent=`${row.score.total}/${Number(analysisExam.totalPoints||100)}点 ／ 正答マーク ${studentCorrectMarkCount(row)}/${analysisExam.questions.length} ／ ${formatResponseTimestamp(row.timestampValue)} の回答を採用`;
  body.innerHTML=analysisQuestionUnits().map(unit=>{const r=studentUnitResult(row,unit);return `<tr><td><span class="question-section-mini">${esc((analysisExam.sections||[]).find(s=>s.id===unit.section)?.name||'')}</span><strong>${esc(combineQuestionLabels(unit.members))}</strong>${unitTypeLabel(unit)?`<small class="analysis-unit-type">${esc(unitTypeLabel(unit))}</small>`:''}</td><td>${esc(r.answer)}</td><td>${esc(r.correct)}</td><td><span class="answer-mark ${r.markClass}">${r.mark}</span>${r.note?`<small class="analysis-answer-note">${esc(r.note)}</small>`:''}</td><td>${esc(r.earned)}</td></tr>`}).join('');panel.classList.remove('hidden');panel.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function closeStudentAnalysisDetail(){$('studentDetailPanel')?.classList.add('hidden')}

function loadPublishExam(){
  const exam=exams.find(e=>e.id===$('publishExamSelect')?.value);
  if(!exam){
    if($('audienceBuilder'))$('audienceBuilder').innerHTML='<div class="notice">先にSTEP 1で試験を登録してください。</div>';
    if($('publishSchedulePanel'))$('publishSchedulePanel').classList.add('hidden');
    if($('currentPublishState'))$('currentPublishState').innerHTML='';
    if($('examReadiness'))$('examReadiness').innerHTML='';
    if($('studentExamPreview'))$('studentExamPreview').innerHTML='<div class="notice small">試験を選択してください。</div>';
    updatePublishGoogleFormTestButton(null);
    return;
  }
  $('publishExamSelect').value=exam.id;
  if($('publishStatusSelect'))$('publishStatusSelect').value=examStoredStatus(exam);
  if($('publishStartAt'))$('publishStartAt').value=toDatetimeLocal(exam?.publishWindow?.startAt);
  if($('publishEndAt'))$('publishEndAt').value=toDatetimeLocal(exam?.publishWindow?.endAt);
  updatePublishScheduleVisibility();
  renderCurrentPublishState(exam);
  renderExamReadiness(exam);
  const pfm=$('publishFormTestMsg');if(pfm){delete pfm.dataset.keep;pfm.textContent=''}
  const prm=$('publishFormReplaceMsg');if(prm){prm.className='small muted';prm.textContent=''}
  if($('publishFormPrefillUrl'))$('publishFormPrefillUrl').value='';
  updatePublishGoogleFormTestButton(exam);
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
  const hasForm=!!(storedGoogleFormViewUrl(exam)||exam.formSubmission);
  const formReady=!hasForm||storedGoogleFormConfigValid(exam);
  const formConfirmed=!hasForm||!!exam.formSubmission?.testConfirmed;
  const formInherited=hasForm&&formReady&&!formConfirmed&&(exam.formSubmission?.verificationSource==='clone_inherited'||exam.formSubmission?.inheritedFrom);
  const audience=examAudienceCodes(exam).length;
  const stored=examStoredStatus(exam);
  const scheduleReady=stored!=='published'||(!!parseExamDate(exam?.publishWindow?.startAt)&&!!parseExamDate(exam?.publishWindow?.endAt));
  const chips=[
    `<span class="ready-chip ${scoreReady?'ok':'warn'}">採点設定 ${scoreReady?'✓':'未設定'}</span>`,
    `<span class="ready-chip ${formReady&&formConfirmed?'ok':formReady?'mid':'warn'}">Googleフォーム ${!hasForm?'なし':formConfirmed?'✓ 受信確認済み':formInherited?'引継ぎ・未確認':formReady?'設定済み・未確認':'要設定'}</span>`,
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
  if(clone.formSubmission){
    clone.formSubmission.testConfirmed=false;
    clone.formSubmission.verifiedAt=null;
    clone.formSubmission.lastTestAttemptedAt=null;
    clone.formSubmission.verificationSource='clone_inherited';
    clone.formSubmission.inheritedFrom=exam.id;
  }
  exams.push(clone);allExamData.exams=exams;
  refreshExamSelects(clone.id);
  if($('publishSubjectSelect'))$('publishSubjectSelect').value=clone.subject||'';
  refreshPublishSelectors(clone.id);if($('publishExamSelect'))$('publishExamSelect').value=clone.id;
  loadPublishExam();renderExamExportSummary();
  $('publishMsg').className='success small';
  $('publishMsg').innerHTML=`<strong>✓ 「${esc(exam.title)}」を複製しました。</strong> 正答・配点・設問ごとの選択肢${exam.formSubmission?'・Googleフォーム設定':''}を引き継ぎました。<strong>Googleフォームは「引継ぎ・未確認」へ戻し、非公開・受験対象未設定</strong>で作成しています。元試験と同じフォームを使う場合はそのままテスト送信、別フォームを使う場合は <strong>［Googleフォームを変更］</strong> から差し替えてください。`;
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
function extendPublishEnd(minutes){
  if(!minutes||minutes<1)return;
  const exam=exams.find(e=>e.id===$('publishExamSelect')?.value);if(!exam)return;
  if($('publishStatusSelect'))$('publishStatusSelect').value='published';
  updatePublishScheduleVisibility();
  const now=Date.now(),input=$('publishEndAt'),current=input?.value?new Date(input.value).getTime():parseExamDate(exam?.publishWindow?.endAt);
  const base=Number.isFinite(current)&&current>now?current:now;
  const next=new Date(base+minutes*60000);
  if(input)input.value=toDatetimeLocal(next.toISOString());
  if($('publishStartAt')&&!$('publishStartAt').value){$('publishStartAt').value=toDatetimeLocal(new Date(now-60000).toISOString())}
  const msg=$('publishMsg');if(msg){msg.className='notice small';msg.innerHTML=`終了時刻を <strong>${minutes}分</strong> 延長しました。まだ保存されていません。［公開設定を反映］を押すと、生徒画面へ自動反映します。`;}
}

async function applyPublish(){
  const exam=exams.find(e=>e.id===$('publishExamSelect').value);if(!exam)return;
  const status=$('publishStatusSelect')?.value||'unpublished';
  const selected=selectedAudienceCodes();
  if(status==='published'&&!selected.length){alert('公開する場合は受験対象生徒を選択してください。');return}
  if(status==='published'){
    const hasForm=!!(storedGoogleFormViewUrl(exam)||exam.formSubmission);
    if(hasForm&&!storedGoogleFormConfigValid(exam)){alert('Googleフォーム連携設定が不完全です。先に「Googleフォーム連携確認」で事前入力URLを再設定してください。');return}
    if(hasForm&&!exam.formSubmission?.testConfirmed){alert('Googleフォームの実受信がまだ確認されていません。テスト送信 → Googleフォームの「回答」で受信確認 → チェック、の順に完了してから公開してください。');return}
  }
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

  const effective=examStatusLabel(exam),windowText=scheduleSummary(exam),btn=$('applyPublishBtn'),old=btn?.textContent||'公開設定を反映';
  if(btn){btn.disabled=true;btn.textContent='生徒画面へ反映中…'}
  $('publishMsg').className='notice small';
  $('publishMsg').innerHTML=`<strong>公開設定を保存しました。</strong> ${esc(effective)} / 対象 ${selected.length}人${windowText?` / ${esc(windowText)}`:''}<br><span>生徒用の公開データを更新しています…</span>`;

  try{
    const result=await syncExamsToPublicData();
    $('publishMsg').className='success small';
    $('publishMsg').innerHTML=`<strong>✓ 生徒画面へ反映しました。</strong> ${esc(effective)} / 対象 ${selected.length}人${windowText?` / ${esc(windowText)}`:''}<br><span>公開期間の延長・短縮も、このボタンだけで反映されます。GitHub担当者への依頼は不要です。</span>`;
  }catch(e){
    console.error(e);
    $('publishMsg').className='error small';
    $('publishMsg').innerHTML=`<strong>設定はこの画面内では保存しましたが、生徒画面への自動反映に失敗しました。</strong><br><span>${esc(e.message||e)}　もう一度［公開設定を反映］を押してください。非常時のみ exams.json の書き出しを使用してください。</span>`;
    alert(`生徒画面への反映に失敗しました。\n\n${e.message||e}`);
  }finally{
    if(btn){btn.disabled=false;btn.textContent=old}
  }

  refreshPublishSelectors(exam.id);$('publishExamSelect').value=exam.id;
  renderCurrentPublishState(exam);renderExamReadiness(exam);renderExamExportSummary();if(!$('examPreviewPanel')?.classList.contains('hidden'))renderExamPreview(previewMode);
}

async function deleteCurrentExam(){
  const exam=exams.find(e=>e.id===$('publishExamSelect')?.value);if(!exam)return;
  const first=confirm(`「${exam.title}」をT-DX Labから完全に削除しますか？

終了とは違い、試験設定・模範解答・配点・Googleフォーム連携・公開設定が生徒用試験データから削除されます。
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
  $('publishMsg').innerHTML=`<strong>「${esc(exam.title)}」を削除しました。</strong><br>生徒用試験データへ反映しています…`;
  try{
    await syncExamsToPublicData();
    $('publishMsg').className='success small';
    $('publishMsg').innerHTML=`<strong>✓ 「${esc(exam.title)}」を生徒用試験データから削除しました。</strong><br>※すでに公開済みの集計分析は別データのため残ります。必要な場合は分析公開管理から扱います。`;
  }catch(e){
    console.error(e);
    $('publishMsg').className='error small';
    $('publishMsg').innerHTML=`<strong>削除はこの画面内で行いましたが、生徒画面への反映に失敗しました。</strong><br>${esc(e.message||e)}`;
  }
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
    const fs=googleFormVerificationLabel(e);
    const formText=fs.text==='受信確認済み'?'Googleフォーム受信確認済み✓':fs.text==='フォームなし'?'フォームなし':`Googleフォーム${fs.text}`;
    const windowText=scheduleSummary(e);
    return `<div class="exam-export-row"><span class="exam-export-index">${i+1}</span><div><strong>${esc(e.title||'(無題)')}</strong><small>${esc(e.subject||'')} / ${examStatusLabel(e)}${windowText?` / ${esc(windowText)}`:''} / ${esc(target)} / ${formText}</small></div><span class="exam-export-state ${examStatusClass(e)}">${examStatusLabel(e)}</span></div>`;
  }).join('');
  root.innerHTML=`<div class="exam-export-head"><div><span class="section-eyebrow">EMERGENCY BACKUP</span><h3>非常時用バックアップ：${list.length}件</h3></div><small>通常運用では自動反映されるため書き出し不要です。</small></div>${rows||'<div class="notice small">登録済み試験はありません。</div>'}<div class="github-upload-note"><strong>非常時のみ：<code>data/exams.json</code></strong><span>自動反映が利用できない場合だけ、この累積JSONをシステム管理者が手動で上書きします。</span></div>`;
}
function exportExamData(){
  allExamData.version=Math.max(Number(allExamData.version||0),10);
  allExamData.exams=exams;
  allExamData.updatedAt=new Date().toISOString();
  renderExamExportSummary();
  TDX.download('exams.json',JSON.stringify(allExamData,null,2));
  $('publishMsg').className='success small';$('publishMsg').textContent=`最新版 exams.json を書き出しました（収録試験 ${exams.length}件）。GitHub の data/exams.json をこのファイルで置き換えてください。`;
}

function currentUsersBundleForSync(){
  const secretMap=accessSecretMap();
  return {
    version:7,
    systemName:'T-DX Lab☆問題演習システム',
    note:'生徒認証用の公開データ。credential はsalt+hashのみ。平文アクセスキー・氏名・個人回答・QR復号情報は含みません。',
    schoolYear:String(usersData.schoolYear||allExamData?.schoolYear||new Date().getFullYear()),
    resetEpoch:String(usersData.resetEpoch||allExamData?.resetEpoch||''),
    updatedAt:new Date().toISOString(),
    issuedCodeIds:[...(usersData.issuedCodeIds||[])],
    users:(usersData.users||[]).map(u=>({
      studentCode:u.studentCode,
      classKey:u.classKey||String(u.studentCode||'').slice(0,2),
      credential:u.credential||null,
      qrStored:secretMap.has(u.studentCode)||!!u.qrStored
    }))
  };
}
function exportUserData(){
  const st=annualMasterState();
  if(st.unissued&&!confirm(`未発行の生徒が ${st.unissued}人います。この状態で非常時用 users.json を書き出しますか？`))return;
  const payload=currentUsersBundleForSync();
  TDX.download('users.json',JSON.stringify(payload,null,2));
}
init().catch(console.error);
