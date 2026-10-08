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

  function bytesToB64(bytes){
    let bin='';const arr=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    for(let i=0;i<arr.length;i++)bin+=String.fromCharCode(arr[i]);
    return btoa(bin);
  }
  function b64ToBytes(text){
    const bin=atob(String(text||''));const out=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
    return out;
  }
  async function deriveAesKey(password,salt,iterations=120000){
    const base=await crypto.subtle.importKey('raw',enc.encode(String(password||'')),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function encryptSecret(plaintext,password){
    if(!password)throw new Error('教員ログイン情報を確認できません。いったん画面をロックして、もう一度ログインしてください。');
    const salt=new Uint8Array(16),iv=new Uint8Array(12);crypto.getRandomValues(salt);crypto.getRandomValues(iv);
    const iterations=120000,key=await deriveAesKey(password,salt,iterations);
    const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(String(plaintext||'')));
    return {v:1,alg:'AES-GCM',kdf:'PBKDF2-SHA256',iterations,salt:bytesToB64(salt),iv:bytesToB64(iv),data:bytesToB64(new Uint8Array(data))};
  }
  async function decryptSecret(record,password){
    if(!record||!record.salt||!record.iv||!record.data)throw new Error('再印刷用の暗号化データがありません。');
    if(!password)throw new Error('教員ログイン情報を確認できません。いったん画面をロックして、もう一度ログインしてください。');
    const salt=b64ToBytes(record.salt),iv=b64ToBytes(record.iv),iterations=Number(record.iterations||120000);
    const key=await deriveAesKey(password,salt,iterations);
    try{
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,b64ToBytes(record.data));
      return new TextDecoder().decode(plain);
    }catch(_){throw new Error('QR再印刷データを復号できません。教員パスワードまたはusers.jsonを確認してください。')}
  }

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
  return {sha256Hex,randomCode,makeVerifier,verify,encryptSecret,decryptSecret,download,csvParse,scoreExam};
})();
