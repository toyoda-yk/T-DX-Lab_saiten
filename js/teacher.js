const $=id=>document.getElementById(id);
const ADMIN_HASH='e2ea9a3d893fb0d7a17736517404642f30fbca2154f95a1cda68839b4fb5b1a7'; // T-DXLab9999 のSHA-256
let exams=[],usersData={version:5,users:[],issuedCodeIds:[]},analysisRows=[],analysisExam=null,allExamData=null;
let publishRoster=[],annualSecrets=[];
let editorRows=[];
let rosterRanges=[];

async function init(){
  [allExamData,usersData]=await Promise.all([
    fetch('data/exams.json').then(r=>r.json()),
    fetch('data/users.json').then(r=>r.json()).catch(()=>({version:5,users:[],issuedCodeIds:[]}))
  ]);
  exams=allExamData.exams||[];
  usersData.users=usersData.users||[];
  usersData.issuedCodeIds=usersData.issuedCodeIds||[];
  usersData.users.forEach(u=>{u.classKey=u.classKey||String(u.studentCode||'').slice(0,2);u.examCredentials=u.examCredentials||{};u.credential=u.credential||null});
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
  $('generateAnnualCodesBtn').onclick=()=>generateAnnualCodes(false);
  $('regenerateAnnualCodesBtn').onclick=()=>generateAnnualCodes(true);
  $('exportAnnualSecretsBtn').onclick=exportAnnualSecrets;
  $('printAnnualCardsBtn').onclick=printAnnualCards;
  $('exportRosterUsersBtn').onclick=exportUserData;

  $('readPdfBtn').onclick=readPdf;
  $('parsePastedTextBtn').onclick=()=>analyzeAnswerSource('pasted');
  $('reparseTextBtn').onclick=()=>analyzeAnswerSource($('answerTextInput').value.trim()?'pasted':'pdf');
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
  $('exportExamDataBtn').onclick=exportExamData;
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
function saveRoster(){
  try{
    const codes=codesFromRosterRanges(),old=new Map(usersData.users.map(u=>[u.studentCode,u]));
    usersData.users=codes.map(code=>{const u=old.get(code)||{studentCode:code,classKey:code.slice(0,2),credential:null,examCredentials:{}};u.classKey=code.slice(0,2);u.examCredentials=u.examCredentials||{};u.credential=u.credential||null;return u});
    localStorage.setItem('tdxRosterRanges',JSON.stringify(rosterRanges));
    $('rosterMsg').className='success small';$('rosterMsg').textContent=`${codes.length}人を名簿に登録しました。次に「年間アクセスキーを発行」を実行し、QRカードと users.json を保存してください。`;
    renderRosterSummary();loadPublishExam();
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
    annualSecrets.push({studentCode:u.studentCode,accessCode:pretty,classKey:u.classKey});
  }
  renderAnnualSecrets();renderRosterSummary();
  if(annualSecrets.length){
    $('exportAnnualSecretsBtn').disabled=false;$('printAnnualCardsBtn').disabled=false;
    $('rosterMsg').className='success small';
    $('rosterMsg').textContent=`${annualSecrets.length}人分の年間アクセスキーを発行しました。必ずQRカードPDFまたは教員保管CSVを保存してから users.json を書き出してください。`;
  }else{
    $('rosterMsg').className='notice small';$('rosterMsg').textContent='全員すでに年間アクセスキー発行済みです。必要な場合のみ「全員再発行」を使ってください。';
  }
}
function renderAnnualSecrets(){
  const root=$('annualCodePreview');if(!root)return;
  if(!annualSecrets.length){root.innerHTML='<div class="notice small">アクセスキーを新規発行すると、ここに今回発行分だけ表示されます。平文キーは users.json には保存されません。</div>';return}
  root.innerHTML=`<h3>今回発行したアクセスキー（${annualSecrets.length}人）</h3><div class="table-shell"><table><thead><tr><th>4桁番号</th><th>年間アクセスキー</th><th>クラス</th></tr></thead><tbody>${annualSecrets.slice(0,20).map(x=>`<tr><td>${x.studentCode}</td><td><code>${x.accessCode}</code></td><td>${x.classKey}</td></tr>`).join('')}</tbody></table></div>${annualSecrets.length>20?`<p class="small muted">ほか ${annualSecrets.length-20}人</p>`:''}`;
}
function exportAnnualSecrets(){
  if(!annualSecrets.length){alert('この画面で新しく発行したアクセスキーがありません。');return}
  const csv='4桁番号,年間アクセスキー,クラス\n'+annualSecrets.map(x=>`${x.studentCode},${x.accessCode},${x.classKey}`).join('\n');
  TDX.download('T-DX_Lab_年間アクセスキー_教員保管.csv','\ufeff'+csv,'text/csv;charset=utf-8');
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
async function printAnnualCards(){
  if(!annualSecrets.length){
    alert('先に年間アクセスキーを発行してください。年間アクセスキーの平文は users.json には保存されないため、発行直後にPDFまたは教員保管CSVを保存してください。');
    return;
  }
  if(!window.PDFLib || typeof QRCode==='undefined'){
    alert('PDFまたはQRコード生成ライブラリを読み込めませんでした。インターネット接続を確認してページを再読み込みしてください。');
    return;
  }

  const oldText=$('printAnnualCardsBtn').textContent;
  $('printAnnualCardsBtn').disabled=true;$('printAnnualCardsBtn').textContent='PDF作成中…';
  try{
    const {PDFDocument,rgb}=window.PDFLib;
    const pdfDoc=await PDFDocument.create();
    let logo=null;try{logo=await imageFromUrl('assets/images/tdx-lab-logo.png')}catch(e){console.warn('logo load skipped',e)}
    const pageW=595.28,pageH=841.89,marginX=20,marginY=18,gap=12;
    const halfH=(pageH-marginY*2-gap)/2;
    for(let i=0;i<annualSecrets.length;i+=2){
      const page=pdfDoc.addPage([pageW,pageH]);
      const topCanvas=await makeAccessCardCanvas(annualSecrets[i],logo);
      const topPng=await pdfDoc.embedPng(await canvasToPngBytes(topCanvas));
      page.drawImage(topPng,{x:marginX,y:pageH-marginY-halfH,width:pageW-marginX*2,height:halfH});
      if(annualSecrets[i+1]){
        const bottomCanvas=await makeAccessCardCanvas(annualSecrets[i+1],logo);
        const bottomPng=await pdfDoc.embedPng(await canvasToPngBytes(bottomCanvas));
        page.drawImage(bottomPng,{x:marginX,y:marginY,width:pageW-marginX*2,height:halfH});
      }
      const cutY=marginY+halfH+gap/2;
      page.drawLine({start:{x:marginX,y:cutY},end:{x:pageW-marginX,y:cutY},thickness:0.7,color:rgb(0.55,0.6,0.68),dashArray:[5,4]});
    }
    const bytes=await pdfDoc.save({useObjectStreams:false});
    const blob=new Blob([bytes],{type:'application/pdf'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='T-DX_Lab_年間アクセスカード.pdf';document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }catch(e){
    console.error(e);
    alert('年間アクセスカードPDFの生成に失敗しました。教員保管CSVを先に保存し、ページを再読み込みしてもう一度お試しください。');
  }finally{
    $('printAnnualCardsBtn').disabled=false;$('printAnnualCardsBtn').textContent=oldText;
  }
}

// ===== PDF / pasted text → editable exam draft =====
function toHalfWidth(s){return String(s||'').replace(/[０-９]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0xFEE0)).replace(/：/g,':').replace(/，/g,',').replace(/＝/g,'=')}
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
  // 2段組の解答表では、左右を別々に読む方が視覚上の順序に近くなる。
  const enoughColumns=left.length>=8&&right.length>=8;
  if(enoughColumns){
    const l=clusterLines(left),r=clusterLines(right);
    return [...l,...r];
  }
  return clusterLines(pts);
}
async function readPdf(){
  const f=$('answerPdf').files[0];if(!f){alert('PDFを選択してください。');return}
  try{
    const buf=await f.arrayBuffer(),pdfjs=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs';
    const pdf=await pdfjs.getDocument({data:buf}).promise;let pages=[];
    await renderPdfPages(pdf);
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p),tc=await page.getTextContent(),w=page.getViewport({scale:1}).width;
      pages.push(`--- page ${p} ---\n${extractPageLines(tc.items,w).join('\n')}`)
    }
    const text=pages.join('\n');$('pdfText').value=text;
    if($('answerTextInput').value.trim()) analyzeAnswerSource('pasted'); else analyzeAnswerSource('pdf');
  }catch(e){console.error(e);alert('PDF読み取りに失敗しました。文字として保存されたPDFか、ネットワーク環境を確認してください。')}
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
function deriveSection(label,current='第1問'){
  const m=label.match(/第\s*(\d+)\s*問\s*([A-DＡ-Ｄ]?)/);if(!m)return current;
  return `第${m[1]}問${m[2]?m[2].replace('Ａ','A').replace('Ｂ','B').replace('Ｃ','C').replace('Ｄ','D'):''}`;
}
function lastKana(label){const m=label.match(/([ア-ン])(?:\s*[（(]|\s*$)/);return m?m[1]:''}
function normalizeLettersToken(s){return (String(s||'').match(/[ア-ン]/g)||[])}
function normalizeNumberList(s){return (String(s||'').match(/\d+(?:\.\d+)?/g)||[]).map(String)}
function tableStyleRows(lines){
  const rows=[];let currentSection='第1問',groupSeq=0;
  let sectionMeta={unordered:false,complete:false,points:''};
  for(const src of lines){
    const line=toHalfWidth(src).replace(/[，、]/g,',').replace(/\s+/g,' ').trim();
    const sm=line.match(/第\s*(\d+)\s*問\s*([A-D]?)/);
    if(sm){
      currentSection=`第${sm[1]}問${sm[2]||''}`;
      sectionMeta={unordered:/順序は問わない|順不同/.test(line),complete:/完答/.test(line),points:''};
      const pm=line.match(/各\s*(\d+(?:\.\d+)?)/);if(pm)sectionMeta.points=pm[1];
    }
    const toks=line.split(' ').filter(Boolean);
    for(let i=0;i<toks.length-1;i++){
      const key=toks[i],ans=toks[i+1];
      const letters=normalizeLettersToken(key),nums=normalizeNumberList(ans);
      if(!letters.length||!nums.length)continue;
      if(key.length>24||ans.length>40)continue;
      // 直後にある数値を「この行の配点」候補として拾う。
      const pointTok=toks[i+2]&&/^\d+(?:\.\d+)?$/.test(toks[i+2])?toks[i+2]:'';
      const unordered=sectionMeta.unordered||/順序は問わない|順不同/.test(line);
      if(letters.length>1 && nums.length>=letters.length){
        const answers=nums.slice(0,letters.length),group=`g_${currentSection.replace(/\W/g,'')}_${++groupSeq}`;
        letters.forEach((letter,j)=>rows.push({
          section:currentSection,label:`${currentSection} ${letter}`,answer:answers[j]||'',points:'',
          type:unordered?'unordered_complete_item':'complete_item',group,groupPoints:pointTok||sectionMeta.points||'',
          options:'',confidence:pointTok?'高':'要確認',sourceLine:src
        }));
        i+=pointTok?2:1;continue;
      }
      // 単独欄
      const letter=letters[0],answer=nums[0];
      rows.push({section:currentSection,label:`${currentSection} ${letter}`,answer,points:pointTok||sectionMeta.points||'',type:'normal',group:'',groupPoints:'',options:'',confidence:pointTok?'高':'要確認',sourceLine:src});
      i+=pointTok?2:1;
    }
  }
  return rows;
}
function parseExamText(raw){
  const text=toHalfWidth(raw),lines=text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!/^--- page/.test(x));
  const rows=[];let currentSection='第1問';const seen=new Set();
  for(let i=0;i<lines.length;i++){
    const line=lines[i].replace(/\s+/g,' ');
    const sec=line.match(/第\s*(\d+)\s*問\s*([A-D]?)/);if(sec)currentSection=`第${sec[1]}問${sec[2]||''}`;
    let label='',answer='',confidence='要確認';
    const explicit=line.match(/^(.{1,80}?(?:第\s*\d+\s*問[A-D]?\s*)?(?:問\s*\d+\s*)?[ア-ンA-Za-z])\s*(?:正答|答|解答)\s*[:=]?\s*([0-9]+(?:\s*[,、]\s*[0-9]+)*)\b/);
    const colon=line.match(/^(.{1,80}?(?:第\s*\d+\s*問[A-D]?\s*)?(?:問\s*\d+\s*)?[ア-ンA-Za-z])\s*[:=]\s*([0-9]+(?:\s*[,、]\s*[0-9]+)*)\b/);
    const sameLine=line.match(/^((?:第\s*\d+\s*問[A-D]?\s*)+(?:問\s*\d+\s*)?[ア-ン])(?:\s*[（(][^）)]*[）)])?\s+([0-9]+(?:\s*[,、]\s*[0-9]+)*)\s*$/);
    const m=explicit||colon||sameLine;
    if(m){label=m[1].replace(/\s+/g,' ').trim();answer=m[2].replace(/[、\s]+/g,',');confidence=explicit?'高':'要確認'}
    if(!label)continue;
    const section=deriveSection(label,currentSection),key=`${section}|${label}|${answer}`;if(seen.has(key))continue;seen.add(key);
    const low=/順不同|順序は問わない/.test(line),complete=/完答/.test(line);
    rows.push({section,label,answer,points:'',type:complete?(low?'unordered_complete_item':'complete_item'):low?'unordered_item':'normal',group:'',groupPoints:'',options:'',confidence,sourceLine:line});
  }
  // 「Xと順不同」の組を自動グループ化
  rows.forEach((r)=>{const m=r.sourceLine.match(/([ア-ン])\s*と\s*順不同/);if(!m)return;const a=lastKana(r.label),b=m[1];if(!a)return;const g=`u_${r.section.replace(/\W/g,'')}_${[a,b].sort().join('')}`;r.type='unordered_item';r.group=g;rows.forEach(x=>{if(x.section===r.section&&[a,b].includes(lastKana(x.label))){x.type='unordered_item';x.group=g}})});
  // 「ア、イ、ウは完答」のような記述を探して同一大問内へ適用
  for(const line of lines){const m=line.match(/([ア-ン](?:\s*[,、]\s*[ア-ン])+).*?完答/);if(!m)continue;const letters=m[1].match(/[ア-ン]/g)||[];if(letters.length<2)continue;const sm=line.match(/第\s*(\d+)\s*問\s*([A-D]?)/),section=sm?`第${sm[1]}問${sm[2]||''}`:null;const g=`c_${(section||'sec').replace(/\W/g,'')}_${letters.join('')}`;rows.forEach(x=>{if((!section||x.section===section)&&letters.includes(lastKana(x.label))){x.type='complete_item';x.group=g}})}
  const tableRows=tableStyleRows(lines);
  // 表形式データが取れた場合はそちらを優先。貼付テキストにも同じロジックを使う。
  if(tableRows.length>=rows.length && tableRows.length){
    const dedup=[],keys=new Set();
    for(const r of tableRows){const key=`${r.section}|${r.label}|${r.answer}|${r.group}`;if(keys.has(key))continue;keys.add(key);dedup.push(r)}
    return dedup;
  }
  return rows;
}
function analyzeAnswerSource(source='pdf'){
  const text=source==='pasted'?$('answerTextInput').value:$('pdfText').value;
  if(!text.trim()){alert(source==='pasted'?'模範解答テキストを貼り付けてください。':'先にPDFを読み取ってください。');return}
  editorRows=parseExamText(text);
  if(!editorRows.length) editorRows=[blankEditorRow()];
  $('examReviewPanel').classList.remove('hidden');renderEditor();
  $('examReviewPanel').scrollIntoView({behavior:'smooth',block:'start'});
}
function analyzePdfText(text){$('pdfText').value=text;analyzeAnswerSource('pdf')}
function blankEditorRow(){return {section:'第1問',label:'',answer:'',points:'',type:'normal',group:'',groupPoints:'',options:'',confidence:'要確認',sourceLine:''}}
function addEditorRow(row=blankEditorRow()){editorRows.push({...row});renderEditor();setTimeout(()=>$('examEditorCards')?.lastElementChild?.scrollIntoView({behavior:'smooth',block:'center'}),0)}
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
  const explicit=String(r.options||'').split(/[,、\s]+/).map(x=>x.trim()).filter(Boolean);
  if(explicit.length)return {options:explicit,inferred:false};
  const nums=String(r.answer||'').split(/[,、\s]+/).map(x=>Number(x)).filter(Number.isFinite);
  const n=nums.length?Math.max(...nums):-1;
  if(Number.isInteger(n)&&n>=0&&n<=12)return {options:Array.from({length:Math.max(4,n+1)},(_,i)=>String(i)),inferred:true};
  return {options:[],inferred:true};
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
  root.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>moveEditorBlock(Number(b.dataset.move),Number(b.dataset.dir)));
  root.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{editorRows.splice(Number(b.dataset.del),1);renderEditor()});
  root.querySelectorAll('[data-del-group]').forEach(b=>b.onclick=()=>{const g=b.dataset.delGroup;editorRows=editorRows.filter(r=>r.group!==g);renderEditor()});
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
  try{const draft={title:$('examName').value.trim(),subject:$('examSubjectInput').value.trim(),totalPoints:$('examTotalPoints').value,googleFormUrl:$('formUrl').value.trim(),pdfText:$('pdfText').value,pastedAnswerText:$('answerTextInput').value,editorRows,createdAt:new Date().toISOString()};localStorage.setItem('tdxDraftExam',JSON.stringify(draft));$('draftExamMsg').className='success small';$('draftExamMsg').textContent='編集内容をこのブラウザに保存しました。'}catch(e){$('draftExamMsg').className='error small';$('draftExamMsg').textContent=e.message}
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
  $('publishMsg').className='success small';$('publishMsg').textContent=`設定を反映しました：${exam.published?'公開':'非公開'} / 対象 ${selected.length}人。次に「exams.jsonを書き出す」を押し、システム管理者へ送付してください。`;
}
function selectedAudienceCodes(){return [...document.querySelectorAll('.student-check:checked')].map(x=>x.value)}
function exportExamData(){
  allExamData.version=Math.max(Number(allExamData.version||0),5);
  allExamData.updatedAt=new Date().toISOString();
  TDX.download('exams.json',JSON.stringify(allExamData,null,2));
}
function exportUserData(){
  const payload={version:5,note:'年度共通の生徒認証情報。平文アクセスキーは含みません。credential は年間アクセスキーの salt+hash です。',issuedCodeIds:usersData.issuedCodeIds,users:usersData.users.map(u=>({studentCode:u.studentCode,classKey:u.classKey,credential:u.credential||null}))};
  TDX.download('users.json',JSON.stringify(payload,null,2));
}
init().catch(console.error);
