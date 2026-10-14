window.TDX = (() => {
  const enc = new TextEncoder();
  async function sha256Hex(text){
    const hash=await crypto.subtle.digest('SHA-256',enc.encode(text));
    return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  function randomCode(len=12){
    const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const a=new Uint32Array(len); crypto.getRandomValues(a);
    return [...a].map((n,i)=>chars[n%chars.length]).join('');
  }
  function randomSalt(){const a=new Uint8Array(16);crypto.getRandomValues(a);return [...a].map(b=>b.toString(16).padStart(2,'0')).join('')}
  async function makeVerifier(code){const salt=randomSalt();return {salt,hash:await sha256Hex(`${salt}|${code}`)}}
  async function verify(code,rec){return (await sha256Hex(`${rec.salt}|${code}`))===rec.hash}
  function download(name,content,type='application/json'){
    const blob=new Blob([content],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)
  }
  function csvParse(text){
    const rows=[];let row=[],cell='',q=false;
    for(let i=0;i<text.length;i++){
      const c=text[i],n=text[i+1];
      if(q){if(c==='"'&&n==='"'){cell+='"';i++}else if(c==='"'){q=false}else cell+=c}
      else if(c==='"')q=true;else if(c===','){row.push(cell);cell=''}else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell=''}else cell+=c;
    }
    if(cell.length||row.length){row.push(cell);rows.push(row)}return rows;
  }
  function scoreExam(exam,answers){
    const detail=[];const sectionScores={};exam.sections.forEach(s=>sectionScores[s.id]=0);let total=0;const handled=new Set();
    for(const q of exam.questions){
      let earned=0,correct=false;
      if(q.type==='normal') {correct=String(answers[q.id]??'')===String(q.answer);earned=correct?q.points:0;}
      else if(q.type==='unordered_item'){
        const peers=exam.questions.filter(x=>x.group===q.group);const vals=peers.map(x=>String(answers[x.id]??''));
        const unique=new Set(vals.filter(Boolean));correct=unique.has(String(q.answer)) && vals.filter(v=>v===String(q.answer)).length===1;earned=correct?q.points:0;
      } else if(q.type==='complete_item' && !handled.has(q.group)){
        const peers=exam.questions.filter(x=>x.group===q.group);const ok=peers.every(x=>String(answers[x.id]??'')===String(x.answer));
        if(ok){earned=q.groupPoints; total+=earned; sectionScores[q.section]+=earned;}
        peers.forEach(x=>detail.push({q:x,answer:answers[x.id]??'',correct:ok,earned:0,groupAward:ok?q.groupPoints:0}));handled.add(q.group);continue;
      } else if(q.type==='unordered_complete_item' && !handled.has(q.group)){
        const peers=exam.questions.filter(x=>x.group===q.group);const vals=peers.map(x=>String(answers[x.id]??''));const target=[...q.groupAnswers].map(String).sort();
        const ok=vals.length===target.length && [...vals].sort().every((v,i)=>v===target[i]);
        if(ok){earned=q.groupPoints; total+=earned; sectionScores[q.section]+=earned;}
        peers.forEach(x=>detail.push({q:x,answer:answers[x.id]??'',correct:ok,earned:0,groupAward:ok?q.groupPoints:0}));handled.add(q.group);continue;
      } else if((q.type==='complete_item'||q.type==='unordered_complete_item') && handled.has(q.group)) continue;
      total+=earned;sectionScores[q.section]+=earned;detail.push({q,answer:answers[q.id]??'',correct,earned});
    }
    return {total,sectionScores,detail};
  }

  const RAW_ANSWER_PREFIX='TDXRAW1|';
  function buildAnswerPayload(exam,answers){
    const qs=Array.isArray(exam?.questions)?exam.questions:[];
    const payload={examId:String(exam?.id||''),answers:qs.map(q=>String(answers?.[q.id]??answers?.[String(q.id)]??''))};
    return RAW_ANSWER_PREFIX+JSON.stringify(payload);
  }
  function isAnswerPayload(value){return String(value??'').trim().startsWith(RAW_ANSWER_PREFIX)}
  function parseAnswerPayload(value,exam=null){
    const text=String(value??'').trim();
    if(!text.startsWith(RAW_ANSWER_PREFIX))return null;
    try{
      const payload=JSON.parse(text.slice(RAW_ANSWER_PREFIX.length));
      if(!payload||!Array.isArray(payload.answers))return {ok:false,reason:'invalid'};
      const expectedId=String(exam?.id||'');
      const actualId=String(payload.examId||'');
      if(expectedId&&actualId&&expectedId!==actualId)return {ok:false,reason:'exam_mismatch',examId:actualId};
      const qs=Array.isArray(exam?.questions)?exam.questions:[];
      if(qs.length&&payload.answers.length!==qs.length)return {ok:false,reason:'count_mismatch',count:payload.answers.length};
      const answers={};
      if(qs.length)qs.forEach((q,i)=>answers[q.id]=String(payload.answers[i]??''));
      return {ok:true,examId:actualId,values:payload.answers.map(v=>String(v??'')),answers};
    }catch(_){return {ok:false,reason:'invalid'}}
  }

  const ANALYSIS_GAS_URL='https://script.google.com/a/macros/oen.ed.jp/s/AKfycbykmZ-YUHPDy4tSgYWaWRZoNc7BjIh0QmyBFftRd2ksN6MllX2lf2xLQNEHRS33CMey/exec';
  function gasUrl(params={}){
    const u=new URL(ANALYSIS_GAS_URL);
    Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(k,String(v))});
    u.searchParams.set('_t',Date.now());
    return u.toString();
  }
  function gasJsonp(params={},timeout=10000){
    return new Promise((resolve,reject)=>{
      const cb=`__tdxGas_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script=document.createElement('script');let done=false;
      const cleanup=()=>{if(done)return;done=true;clearTimeout(timer);script.remove();try{delete window[cb]}catch(e){window[cb]=undefined}};
      window[cb]=data=>{cleanup();resolve(data)};
      const timer=setTimeout(()=>{cleanup();reject(new Error('分析共有サーバーへの接続がタイムアウトしました。'))},timeout);
      script.onerror=()=>{cleanup();reject(new Error('分析共有サーバーへ接続できませんでした。OENアカウントでログインしているか確認してください。'))};
      script.src=gasUrl({...params,callback:cb});document.head.appendChild(script);
    });
  }
  async function gasJson(params={},timeout=10000){
    try{
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeout);
      const r=await fetch(gasUrl(params),{cache:'no-store',credentials:'include',redirect:'follow',signal:ctrl.signal});clearTimeout(timer);
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const text=await r.text();return JSON.parse(text);
    }catch(fetchError){
      try{return await gasJsonp(params,timeout)}catch(jsonpError){throw new Error(`${jsonpError.message}（通常接続: ${fetchError.message||fetchError}）`)}
    }
  }
  return {sha256Hex,randomCode,makeVerifier,verify,download,csvParse,scoreExam,RAW_ANSWER_PREFIX,buildAnswerPayload,isAnswerPayload,parseAnswerPayload,ANALYSIS_GAS_URL,gasUrl,gasJson};
})();
