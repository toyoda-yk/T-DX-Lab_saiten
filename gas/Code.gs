const TDX_CONFIG = {
  PROP_SS_ID: 'TDX_SPREADSHEET_ID',
  PROP_GH_OWNER: 'TDX_GITHUB_OWNER',
  PROP_GH_REPO: 'TDX_GITHUB_REPO',
  PROP_GH_BRANCH: 'TDX_GITHUB_BRANCH',
  PROP_GH_TOKEN: 'TDX_GITHUB_TOKEN',
  PROP_SCHOOL_YEAR: 'TDX_SCHOOL_YEAR',
  PROP_RESET_EPOCH: 'TDX_RESET_EPOCH',
  PROP_SYS_ADMINS: 'TDX_SYSTEM_ADMINS',
  QR_PROP_PREFIX: 'TDX_QR_',
  TEST_SHEET: '接続テスト',
  INDEX_SHEET: '分析一覧',
  DATA_SHEET: '分析データ',
  SYNC_SHEET: '公開同期ログ',
  CHUNK_SIZE: 40000,
  ANALYSIS_PATH: 'data/analysis.json',
  EXAMS_PATH: 'data/exams.json',
  USERS_PATH: 'data/users.json'
};

/**
 * 初回セットアップ。スプレッドシートに紐づくApps Scriptから1回実行します。
 */
function setupTDXLab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('スプレッドシートからApps Scriptを開いて実行してください。');

  const props = PropertiesService.getScriptProperties();
  props.setProperty(TDX_CONFIG.PROP_SS_ID, ss.getId());
  if (!props.getProperty(TDX_CONFIG.PROP_SCHOOL_YEAR)) props.setProperty(TDX_CONFIG.PROP_SCHOOL_YEAR, String(new Date().getFullYear()));
  if (!props.getProperty(TDX_CONFIG.PROP_RESET_EPOCH)) props.setProperty(TDX_CONFIG.PROP_RESET_EPOCH, Utilities.getUuid());

  ensureSheet_(ss, TDX_CONFIG.TEST_SHEET, ['日時', '実行ユーザー', '内容']);
  ensureSheet_(ss, TDX_CONFIG.INDEX_SHEET, [
    '試験ID', '試験名', '教科', '満点', '更新日時', '公開者', '全体人数', 'クラス', '公開トークン'
  ]);
  ensureSheet_(ss, TDX_CONFIG.DATA_SHEET, [
    '試験ID', 'チャンク番号', 'JSONデータ', '更新日時', '公開者'
  ]);
  ensureSheet_(ss, TDX_CONFIG.SYNC_SHEET, [
    '日時', '種類', '対象', '実行ユーザー', '結果', 'メッセージ'
  ]);

  SpreadsheetApp.flush();
  console.log('T-DX Lab 初期設定完了');
}

/**
 * GitHub連携の初回設定。システム管理者が1回だけ実行します。
 */
function setupGitHubConnection() {
  const ui = SpreadsheetApp.getUi();

  const repoPrompt = ui.prompt(
    'T-DX Lab GitHub連携',
    'T-DX Labを公開しているGitHubリポジトリURLを入力してください。\n例：https://github.com/OWNER/REPOSITORY',
    ui.ButtonSet.OK_CANCEL
  );
  if (repoPrompt.getSelectedButton() !== ui.Button.OK) return;

  const repoInfo = parseGitHubRepo_(repoPrompt.getResponseText());
  if (!repoInfo) {
    ui.alert('リポジトリURLを確認してください。');
    return;
  }

  const tokenPrompt = ui.prompt(
    'GitHubトークン',
    'Fine-grained personal access token を入力してください。\n対象リポジトリだけを選び、Repository permissions → Contents を Read and write にしてください。\n※トークンはScript Propertiesに保存し、スプレッドシートには保存しません。',
    ui.ButtonSet.OK_CANCEL
  );
  if (tokenPrompt.getSelectedButton() !== ui.Button.OK) return;

  const token = String(tokenPrompt.getResponseText() || '').trim();
  if (!token) {
    ui.alert('トークンが空です。');
    return;
  }

  const meta = githubApi_(
    'get',
    'https://api.github.com/repos/' + encodeURIComponent(repoInfo.owner) + '/' + encodeURIComponent(repoInfo.repo),
    null,
    token
  );
  const branch = String(meta.default_branch || 'main');

  PropertiesService.getScriptProperties().setProperties({
    [TDX_CONFIG.PROP_GH_OWNER]: repoInfo.owner,
    [TDX_CONFIG.PROP_GH_REPO]: repoInfo.repo,
    [TDX_CONFIG.PROP_GH_BRANCH]: branch,
    [TDX_CONFIG.PROP_GH_TOKEN]: token
  }, false);

  githubGetFile_(TDX_CONFIG.EXAMS_PATH, true);

  ui.alert(
    'GitHub連携を設定しました。\n\n' +
    repoInfo.owner + '/' + repoInfo.repo + '\n' +
    'ブランチ：' + branch + '\n\n' +
    '今後、一般の先生はGitHubを触る必要はありません。'
  );
}

function checkGitHubConnection() {
  const c = githubConfig_();
  const meta = githubApi_(
    'get',
    'https://api.github.com/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo),
    null,
    c.token
  );
  SpreadsheetApp.getUi().alert(
    'GitHub接続OK\n' +
    c.owner + '/' + c.repo + '\n' +
    'ブランチ：' + c.branch + '\n' +
    'リポジトリ：' + String(meta.full_name || '')
  );
}

/**
 * GET:
 * 生徒画面はこのGASを使用しません。
 * 生徒はGitHub Pages上の data/exams.json / data/analysis.json のみ読み取ります。
 */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const action = p.action || 'ping';
    let result;

    if (action === 'ping') {
      result = {
        ok: true,
        system: 'T-DX Lab',
        message: 'GAS接続OK',
        user: activeEmail_(),
        time: new Date().toISOString()
      };
    } else if (action === 'whoami') {
      const email = activeEmail_();
      result = {
        ok: true,
        user: email,
        teacher: isAuthorizedTeacher_(email),
        admin: isSystemAdmin_(email),
        githubConfigured: githubConfigured_(),
        schoolYear: currentSchoolYear_(),
        resetEpoch: currentResetEpoch_(),
        message: isAuthorizedTeacher_(email) ? '公開権限あり' : '閲覧のみ'
      };
    } else if (action === 'writeTest') {
      const email = activeEmail_();
      if (!isAuthorizedTeacher_(email)) throw new Error('書き込み権限がありません。');
      const ss = getTDXSpreadsheet_();
      const sheet = ensureSheet_(ss, TDX_CONFIG.TEST_SHEET, ['日時', '実行ユーザー', '内容']);
      sheet.appendRow([new Date(), email, 'T-DX Lab 接続テスト成功']);
      result = { ok: true, message: 'スプレッドシートへの書き込み成功', user: email };
    } else if (action === 'readTest') {
      const ss = getTDXSpreadsheet_();
      const sheet = ss.getSheetByName(TDX_CONFIG.TEST_SHEET);
      if (!sheet || sheet.getLastRow() < 2) {
        result = { ok: true, message: 'まだテストデータはありません' };
      } else {
        const row = sheet.getRange(sheet.getLastRow(), 1, 1, 3).getDisplayValues()[0];
        result = {
          ok: true,
          message: '読み取り成功',
          latest: { time: row[0], user: row[1], content: row[2] }
        };
      }
    } else if (action === 'listAnalysis') {
      result = { ok: true, analyses: listAnalysisMeta_() };
    } else if (action === 'getAnalysisMeta') {
      const examId = String(p.examId || '').trim();
      if (!examId) throw new Error('examId がありません。');
      const meta = getAnalysisMeta_(examId);
      result = meta ? { ok: true, analysis: meta } : { ok: false, message: '分析結果がありません。' };
    } else if (action === 'getAnalysis') {
      const examId = String(p.examId || '').trim();
      if (!examId) throw new Error('examId がありません。');
      const analysis = loadAnalysis_(examId);
      result = analysis ? { ok: true, analysis: analysis } : { ok: false, message: '分析結果がありません。' };
    } else if (action === 'getQrAccess') {
      const email = activeEmail_();
      if (!isAuthorizedTeacher_(email)) throw new Error('QR再印刷の権限がありません。');
      const studentCode = String(p.studentCode || '').trim();
      if (!/^\d{4}$/.test(studentCode)) throw new Error('4桁番号を確認してください。');
      const rec = getQrVaultEntry_(studentCode);
      if (rec) logSync_('QR再印刷', studentCode, email, '取得', 'QR再印刷用キーを教員画面へ一時返却');
      result = rec ? { ok: true, entry: rec } : { ok: false, message: 'QR再印刷用のアクセスキーが保管されていません。' };
    } else if (action === 'getQrVault') {
      const email = activeEmail_();
      if (!isSystemAdmin_(email)) throw new Error('QR保管庫全体の取得はシステム管理者だけが実行できます。');
      const entries = listQrVault_();
      result = {
        ok: true,
        entries: entries,
        count: entries.length
      };
    } else if (action === 'securityStatus') {
      const email = activeEmail_();
      if (!isAuthorizedTeacher_(email)) throw new Error('確認権限がありません。');
      result = {
        ok: true,
        user: email,
        admin: isSystemAdmin_(email),
        githubConfigured: githubConfigured_(),
        schoolYear: currentSchoolYear_(),
        resetEpoch: currentResetEpoch_(),
        qrVaultCount: listQrVault_().length
      };
    } else if (action === 'getSyncStatus') {
      result = readSyncStatus_(String(p.token || '').trim());
    } else if (action === 'githubStatus') {
      const email = activeEmail_();
      if (!isAuthorizedTeacher_(email)) throw new Error('確認権限がありません。');
      result = {
        ok: true,
        configured: githubConfigured_(),
        repository: githubConfigured_() ? githubPublicInfo_() : null
      };
    } else {
      result = { ok: false, message: '不明なactionです。' };
    }

    return output_(result, p.callback);
  } catch (error) {
    return output_(
      { ok: false, message: String(error && error.message ? error.message : error) },
      e && e.parameter && e.parameter.callback
    );
  }
}

/**
 * POST:
 * - publishAnalysis : 集計結果を保存し、GitHub data/analysis.json へ自動反映
 * - publishExams    : 最新の試験データを GitHub data/exams.json へ自動反映
 * - publishUsers    : 生徒認証用の公開データを data/users.json へ反映し、QR用の平文キーはGAS側だけに保管
 * - annualReset     : 年度更新。公開データ・分析保管・QR保管庫を初期化
 */
function doPost(e) {
  const p = (e && e.parameter) || {};
  const action = String(p.action || '');
  const token = String(p.syncToken || p.publishToken || '').trim();

  try {
    const email = activeEmail_();
    if (!email) throw new Error('OENアカウントを確認できません。');
    if (!isAuthorizedTeacher_(email)) {
      throw new Error('公開権限がありません。共有スプレッドシートを編集者として共有してください。');
    }
    if (!githubConfigured_()) {
      throw new Error('GitHub自動連携が未設定です。システム管理者が setupGitHubConnection を1回実行してください。');
    }

    if (token) writeSyncStatus_(token, {
      ok: true, done: false, action: action, message: '公開処理中です。'
    });

    if (action === 'publishAnalysis') {
      const raw = String(p.payload || '');
      if (!raw) throw new Error('分析データがありません。');

      const clean = sanitizeAnalysis_(JSON.parse(raw));
      saveAnalysis_(clean, email);
      const gh = syncAnalysisToGitHub_(clean, email);
      logSync_('分析', clean.examId, email, '成功', gh.message);

      const result = {
        ok: true,
        done: true,
        action: action,
        message: '分析結果を生徒用公開データへ反映しました。',
        examId: clean.examId,
        generatedAt: clean.generatedAt,
        publishToken: clean.publishToken,
        publishedBy: email,
        github: gh
      };
      if (token) writeSyncStatus_(token, result);
      return output_(result);

    } else if (action === 'publishExams') {
      const raw = String(p.payload || '');
      if (!raw) throw new Error('試験データがありません。');

      const clean = sanitizeExamsBundle_(JSON.parse(raw));
      const gh = githubPutJson_(
        TDX_CONFIG.EXAMS_PATH,
        clean,
        'T-DX Lab: update exams (' + email + ')'
      );
      logSync_('試験', String(clean.exams.length) + '件', email, '成功', gh.message);

      const result = {
        ok: true,
        done: true,
        action: action,
        message: '試験データを生徒画面へ反映しました。',
        publishedBy: email,
        updatedAt: clean.updatedAt,
        github: gh
      };
      if (token) writeSyncStatus_(token, result);
      return output_(result);

    } else if (action === 'publishUsers') {
      if (!isSystemAdmin_(email)) throw new Error('生徒情報の更新はシステム管理者だけが実行できます。');
      const raw = String(p.payload || '');
      if (!raw) throw new Error('生徒データがありません。');

      const input = JSON.parse(raw);
      const bundle = sanitizeUsersBundle_(input.bundle || input);
      const vaultEntries = Array.isArray(input.vaultEntries) ? input.vaultEntries : [];
      saveQrVaultEntries_(bundle, vaultEntries, email);
      pruneQrVault_(bundle.users.map(function(u) { return u.studentCode; }));

      const stored = qrVaultCodeSet_();
      bundle.users.forEach(function(u) { u.qrStored = stored.has(u.studentCode); });
      bundle.updatedAt = new Date().toISOString();
      bundle.schoolYear = text_(bundle.schoolYear || currentSchoolYear_(), 20);
      bundle.resetEpoch = text_(bundle.resetEpoch || currentResetEpoch_(), 120);

      const gh = githubPutJson_(
        TDX_CONFIG.USERS_PATH,
        bundle,
        'T-DX Lab: update users (' + email + ')'
      );
      logSync_('生徒', String(bundle.users.length) + '人', email, '成功', gh.message);

      const result = {
        ok: true,
        done: true,
        action: action,
        message: '生徒認証データを反映しました。QRの平文アクセスキーはGitHubへ公開していません。',
        publishedBy: email,
        users: bundle.users.length,
        qrStored: stored.size,
        updatedAt: bundle.updatedAt,
        github: gh
      };
      if (token) writeSyncStatus_(token, result);
      return output_(result);

    } else if (action === 'annualReset') {
      if (!isSystemAdmin_(email)) throw new Error('年度更新はシステム管理者だけが実行できます。');
      const raw = String(p.payload || '');
      if (!raw) throw new Error('年度更新データがありません。');
      const input = JSON.parse(raw);
      const targetYear = text_(input.targetYear, 20);
      if (!/^20\d{2}$/.test(targetYear)) throw new Error('更新先年度を4桁で指定してください。');
      const required = 'RESET-' + targetYear;
      if (String(input.confirm || '') !== required) throw new Error('年度更新の確認文字列が一致しません。');

      const resetEpoch = Utilities.getUuid();
      const now = new Date().toISOString();

      const usersPayload = {
        version: 7,
        systemName: 'T-DX Lab☆問題演習システム',
        note: '生徒認証用の公開データ。平文アクセスキー・氏名・個人回答は含みません。',
        schoolYear: targetYear,
        resetEpoch: resetEpoch,
        updatedAt: now,
        issuedCodeIds: [],
        users: []
      };
      const examsPayload = {
        version: 10,
        systemName: 'T-DX Lab☆問題演習システム',
        schoolYear: targetYear,
        resetEpoch: resetEpoch,
        updatedAt: now,
        exams: []
      };
      const analysisPayload = {
        version: 3,
        systemName: 'T-DX Lab☆問題演習システム',
        schoolYear: targetYear,
        resetEpoch: resetEpoch,
        updatedAt: now,
        analyses: []
      };

      const ghUsers = githubPutJson_(TDX_CONFIG.USERS_PATH, usersPayload, 'T-DX Lab: annual reset users ' + targetYear + ' (' + email + ')');
      const ghExams = githubPutJson_(TDX_CONFIG.EXAMS_PATH, examsPayload, 'T-DX Lab: annual reset exams ' + targetYear + ' (' + email + ')');
      const ghAnalysis = githubPutJson_(TDX_CONFIG.ANALYSIS_PATH, analysisPayload, 'T-DX Lab: annual reset analysis ' + targetYear + ' (' + email + ')');

      clearAnalysisStorage_();
      clearQrVault_();

      const props = PropertiesService.getScriptProperties();
      props.setProperty(TDX_CONFIG.PROP_SCHOOL_YEAR, targetYear);
      props.setProperty(TDX_CONFIG.PROP_RESET_EPOCH, resetEpoch);

      logSync_('年度更新', targetYear, email, '成功', '公開データ・分析・QR保管庫を初期化');

      const result = {
        ok: true,
        done: true,
        action: action,
        message: targetYear + '年度用に初期化しました。Googleフォーム回答と端末に保存済みのExcel/PDFは削除していません。',
        publishedBy: email,
        schoolYear: targetYear,
        resetEpoch: resetEpoch,
        github: { users: ghUsers, exams: ghExams, analysis: ghAnalysis }
      };
      if (token) writeSyncStatus_(token, result);
      return output_(result);

    } else {
      throw new Error('不明なPOST actionです。');
    }

  } catch (error) {
    const msg = String(error && error.message ? error.message : error);
    if (token) writeSyncStatus_(token, {
      ok: false, done: true, action: action, message: msg
    });
    try {
      const kind = action === 'publishExams' ? '試験' : action === 'publishUsers' ? '生徒' : action === 'annualReset' ? '年度更新' : '分析';
      logSync_(kind, '', activeEmail_(), '失敗', msg);
    } catch (ignore) {}
    return output_({ ok: false, done: true, message: msg });
  }
}

function getTDXSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(TDX_CONFIG.PROP_SS_ID);
  if (!id) throw new Error('初期設定がまだです。setupTDXLab を一度実行してください。');
  return SpreadsheetApp.openById(id);
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  return sheet;
}

function activeEmail_() {
  return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
}

function isAuthorizedTeacher_(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return false;
  const ss = getTDXSpreadsheet_();
  try {
    const owner = ss.getOwner && ss.getOwner();
    if (owner && String(owner.getEmail() || '').toLowerCase() === email) return true;
  } catch (err) {}
  try {
    return (ss.getEditors() || []).some(function(user) {
      return String(user.getEmail() || '').toLowerCase() === email;
    });
  } catch (err) {
    return false;
  }
}


function isSystemAdmin_(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return false;
  const ss = getTDXSpreadsheet_();
  try {
    const owner = ss.getOwner && ss.getOwner();
    if (owner && String(owner.getEmail() || '').trim().toLowerCase() === email) return true;
  } catch (err) {}
  const extra = String(PropertiesService.getScriptProperties().getProperty(TDX_CONFIG.PROP_SYS_ADMINS) || '')
    .split(',')
    .map(function(x) { return x.trim().toLowerCase(); })
    .filter(Boolean);
  return extra.indexOf(email) >= 0;
}

function currentSchoolYear_() {
  return String(PropertiesService.getScriptProperties().getProperty(TDX_CONFIG.PROP_SCHOOL_YEAR) || new Date().getFullYear());
}

function currentResetEpoch_() {
  const props = PropertiesService.getScriptProperties();
  let epoch = props.getProperty(TDX_CONFIG.PROP_RESET_EPOCH);
  if (!epoch) {
    epoch = Utilities.getUuid();
    props.setProperty(TDX_CONFIG.PROP_RESET_EPOCH, epoch);
  }
  return epoch;
}

function qrPropKey_(studentCode) {
  return TDX_CONFIG.QR_PROP_PREFIX + String(studentCode || '').trim();
}

function getQrVaultEntry_(studentCode) {
  const raw = PropertiesService.getScriptProperties().getProperty(qrPropKey_(studentCode));
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw);
    const accessCode = String(rec.accessCode || '').trim().toUpperCase();
    if (!accessCode) return null;
    return {
      studentCode: String(studentCode),
      classKey: String(rec.classKey || String(studentCode).slice(0, 2)),
      accessCode: accessCode,
      updatedAt: String(rec.updatedAt || '')
    };
  } catch (err) {
    return null;
  }
}

function listQrVault_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const out = [];
  Object.keys(props).forEach(function(key) {
    if (key.indexOf(TDX_CONFIG.QR_PROP_PREFIX) !== 0) return;
    const code = key.slice(TDX_CONFIG.QR_PROP_PREFIX.length);
    if (!/^\d{4}$/.test(code)) return;
    try {
      const rec = JSON.parse(props[key]);
      const accessCode = String(rec.accessCode || '').trim().toUpperCase();
      if (!accessCode) return;
      out.push({
        studentCode: code,
        classKey: String(rec.classKey || code.slice(0, 2)),
        accessCode: accessCode,
        updatedAt: String(rec.updatedAt || '')
      });
    } catch (err) {}
  });
  return out.sort(function(a, b) { return a.studentCode.localeCompare(b.studentCode); });
}

function qrVaultCodeSet_() {
  return new Set(listQrVault_().map(function(x) { return x.studentCode; }));
}

function saveQrVaultEntries_(bundle, entries, email) {
  if (!entries.length) return;
  const userMap = {};
  bundle.users.forEach(function(u) { userMap[u.studentCode] = u; });
  const props = PropertiesService.getScriptProperties();

  entries.slice(0, 5000).forEach(function(x) {
    const code = String(x && x.studentCode || '').trim();
    const accessCode = String(x && x.accessCode || '').trim().toUpperCase();
    if (!/^\d{4}$/.test(code) || !accessCode) return;
    const user = userMap[code];
    if (!user || !user.credential) throw new Error(code + ' の認証情報がありません。');
    if (!verifyCredential_(accessCode, user.credential)) throw new Error(code + ' のアクセスキーと認証情報が一致しません。');
    props.setProperty(qrPropKey_(code), JSON.stringify({
      accessCode: accessCode,
      classKey: String(user.classKey || code.slice(0, 2)),
      updatedAt: new Date().toISOString(),
      updatedBy: email
    }));
  });
}

function pruneQrVault_(validCodes) {
  const keep = new Set((validCodes || []).map(String));
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(function(key) {
    if (key.indexOf(TDX_CONFIG.QR_PROP_PREFIX) !== 0) return;
    const code = key.slice(TDX_CONFIG.QR_PROP_PREFIX.length);
    if (!keep.has(code)) props.deleteProperty(key);
  });
}

function clearQrVault_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(function(key) {
    if (key.indexOf(TDX_CONFIG.QR_PROP_PREFIX) === 0) props.deleteProperty(key);
  });
}

function verifyCredential_(accessCode, credential) {
  if (!credential || !credential.salt || !credential.hash) return false;
  const source = String(credential.salt) + '|' + String(accessCode);
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, source, Utilities.Charset.UTF_8);
  const hex = digest.map(function(b) {
    const n = b < 0 ? b + 256 : b;
    return ('0' + n.toString(16)).slice(-2);
  }).join('');
  return hex === String(credential.hash || '').toLowerCase();
}

function sanitizeUsersBundle_(x) {
  if (!x || typeof x !== 'object' || !Array.isArray(x.users)) {
    throw new Error('users.json の形式が不正です。');
  }
  if (x.users.length > 5000) throw new Error('生徒件数が多すぎます。');

  const seen = {};
  const users = [];
  x.users.forEach(function(u) {
    const code = text_(u && u.studentCode, 4);
    if (!/^\d{4}$/.test(code) || seen[code]) return;
    seen[code] = true;
    const credential = sanitizeCredential_(u && u.credential);
    users.push({
      studentCode: code,
      classKey: text_(u && u.classKey || code.slice(0, 2), 20),
      credential: credential,
      qrStored: !!(u && u.qrStored)
    });
  });

  users.sort(function(a, b) { return a.studentCode.localeCompare(b.studentCode); });

  return {
    version: Math.max(7, Math.round(number_(x.version))),
    systemName: text_(x.systemName || 'T-DX Lab☆問題演習システム', 200),
    note: '生徒認証用の公開データ。credential はsalt+hashのみ。平文アクセスキー・氏名・個人回答・QR復号情報は含みません。',
    schoolYear: text_(x.schoolYear || currentSchoolYear_(), 20),
    resetEpoch: text_(x.resetEpoch || currentResetEpoch_(), 120),
    updatedAt: new Date().toISOString(),
    issuedCodeIds: Array.isArray(x.issuedCodeIds) ? x.issuedCodeIds.slice(0, 10000).map(function(v) { return text_(v, 128); }) : [],
    users: users
  };
}

function sanitizeCredential_(c) {
  if (!c || typeof c !== 'object') return null;
  const salt = text_(c.salt, 256);
  const hash = text_(c.hash, 256);
  if (!salt || !hash) return null;
  return {
    salt: salt,
    hash: hash,
    codeId: text_(c.codeId, 256),
    issuedAt: validDate_(c.issuedAt) || ''
  };
}

function clearAnalysisStorage_() {
  const ss = getTDXSpreadsheet_();
  [TDX_CONFIG.INDEX_SHEET, TDX_CONFIG.DATA_SHEET].forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() >= 2) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getMaxColumns()).clearContent();
    }
  });
  SpreadsheetApp.flush();
}

function sanitizeAnalysis_(x) {
  if (!x || typeof x !== 'object') throw new Error('分析データの形式が不正です。');
  const examId = text_(x.examId, 120);
  if (!examId) throw new Error('試験IDがありません。');

  const clean = {
    examId: examId,
    title: text_(x.title, 200),
    subject: text_(x.subject, 100),
    totalPoints: number_(x.totalPoints),
    generatedAt: validDate_(x.generatedAt) || new Date().toISOString(),
    publishToken: text_(x.publishToken, 160),
    overall: sanitizeSnapshot_(x.overall),
    classes: {}
  };

  const classes = x.classes && typeof x.classes === 'object' ? x.classes : {};
  Object.keys(classes).slice(0, 100).forEach(function(classKey) {
    const key = text_(classKey, 40);
    if (key) clean.classes[key] = sanitizeSnapshot_(classes[classKey]);
  });
  return clean;
}

function sanitizeSnapshot_(s) {
  s = s && typeof s === 'object' ? s : {};
  return {
    participants: Math.max(0, Math.round(number_(s.participants))),
    averageScore: number_(s.averageScore),
    maxScore: number_(s.maxScore),
    minScore: number_(s.minScore),
    sectionRates: Array.isArray(s.sectionRates) ? s.sectionRates.slice(0, 50).map(function(r) {
      return { id: text_(r.id, 80), name: text_(r.name, 120), rate: clampPct_(r.rate) };
    }) : [],
    questions: Array.isArray(s.questions) ? s.questions.slice(0, 500).map(function(q) {
      return {
        key: text_(q.key, 120),
        order: Math.max(0, Math.round(number_(q.order))),
        label: text_(q.label, 200),
        section: text_(q.section, 120),
        type: text_(q.type, 80),
        typeLabel: text_(q.typeLabel, 120),
        metricLabel: text_(q.metricLabel, 120),
        pct: clampPct_(q.pct)
      };
    }) : []
  };
}

function saveAnalysis_(analysis, email) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = getTDXSpreadsheet_();
    const index = ensureSheet_(ss, TDX_CONFIG.INDEX_SHEET, ['試験ID', '試験名', '教科', '満点', '更新日時', '公開者', '全体人数', 'クラス', '公開トークン']);
    const dataSheet = ensureSheet_(ss, TDX_CONFIG.DATA_SHEET, ['試験ID', 'チャンク番号', 'JSONデータ', '更新日時', '公開者']);
    const now = new Date();

    deleteRowsForExam_(dataSheet, analysis.examId);
    const json = JSON.stringify(analysis);
    const chunks = [];
    for (let i = 0; i < json.length; i += TDX_CONFIG.CHUNK_SIZE) {
      chunks.push([analysis.examId, chunks.length + 1, json.slice(i, i + TDX_CONFIG.CHUNK_SIZE), now, email]);
    }
    if (chunks.length) dataSheet.getRange(dataSheet.getLastRow() + 1, 1, chunks.length, 5).setValues(chunks);

    upsertIndex_(index, [
      analysis.examId,
      analysis.title,
      analysis.subject,
      analysis.totalPoints,
      now,
      email,
      analysis.overall.participants,
      Object.keys(analysis.classes).sort().join(','),
      analysis.publishToken
    ]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function deleteRowsForExam_(sheet, examId) {
  const last = sheet.getLastRow();
  if (last < 2) return;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues().map(function(r) { return String(r[0]); });
  for (let i = ids.length - 1; i >= 0; i--) {
    if (ids[i] === examId) sheet.deleteRow(i + 2);
  }
}

function upsertIndex_(sheet, row) {
  const last = sheet.getLastRow();
  if (last >= 2) {
    const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(row[0])) {
        sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
        return;
      }
    }
  }
  sheet.appendRow(row);
}

function loadAnalysis_(examId) {
  const ss = getTDXSpreadsheet_();
  const sheet = ss.getSheetByName(TDX_CONFIG.DATA_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues()
    .filter(function(r) { return String(r[0]) === String(examId); })
    .sort(function(a, b) { return Number(a[1]) - Number(b[1]); });
  if (!values.length) return null;
  return JSON.parse(values.map(function(r) { return String(r[2] || ''); }).join(''));
}

function getAnalysisMeta_(examId) {
  const ss = getTDXSpreadsheet_();
  const sheet = ss.getSheetByName(TDX_CONFIG.INDEX_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues();
  for (let i = 0; i < values.length; i++) {
    const r = values[i];
    if (String(r[0]) === String(examId)) return indexRowToMeta_(r);
  }
  return null;
}

function listAnalysisMeta_() {
  const ss = getTDXSpreadsheet_();
  const sheet = ss.getSheetByName(TDX_CONFIG.INDEX_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues()
    .filter(function(r) { return String(r[0] || '').trim(); })
    .map(indexRowToMeta_)
    .sort(function(a, b) { return String(b.generatedAt || '').localeCompare(String(a.generatedAt || '')); });
}

function indexRowToMeta_(r) {
  const dt = r[4] instanceof Date ? r[4].toISOString() : String(r[4] || '');
  const classKeys = String(r[7] || '').split(',').map(function(x) { return x.trim(); }).filter(Boolean);
  const classes = {};
  classKeys.forEach(function(k) { classes[k] = { available: true }; });
  return {
    examId: String(r[0] || ''),
    title: String(r[1] || ''),
    subject: String(r[2] || ''),
    totalPoints: number_(r[3]),
    generatedAt: dt,
    publishedBy: String(r[5] || ''),
    overall: { participants: Math.max(0, Math.round(number_(r[6]))) },
    classes: classes,
    publishToken: String(r[8] || '')
  };
}


function sanitizeExamsBundle_(x) {
  if (!x || typeof x !== 'object' || !Array.isArray(x.exams)) {
    throw new Error('exams.json の形式が不正です。');
  }
  const clean = JSON.parse(JSON.stringify(x));
  clean.version = Math.max(10, Math.round(number_(clean.version)));
  clean.systemName = text_(clean.systemName || 'T-DX Lab☆問題演習システム', 200);
  clean.schoolYear = text_(clean.schoolYear || currentSchoolYear_(), 20);
  clean.resetEpoch = text_(clean.resetEpoch || currentResetEpoch_(), 120);
  clean.updatedAt = new Date().toISOString();
  if (clean.exams.length > 1000) throw new Error('試験件数が多すぎます。');
  return clean;
}

function syncAnalysisToGitHub_(analysis, email) {
  const current = githubReadJson_(TDX_CONFIG.ANALYSIS_PATH, {
    version: 2,
    systemName: 'T-DX Lab☆問題演習システム',
    updatedAt: null,
    analyses: []
  });

  const list = Array.isArray(current.analyses) ? current.analyses : [];
  const next = list.filter(function(x) {
    return String(x && x.examId || '') !== String(analysis.examId);
  });
  next.push(analysis);
  next.sort(function(a, b) {
    return String(a.title || '').localeCompare(String(b.title || ''), 'ja');
  });

  // publishToken は公開JSONでは不要なので除外する。同期確認用の一時値はGAS内部だけで扱う。
  const publicNext = next.map(function(item) {
    const copy = JSON.parse(JSON.stringify(item || {}));
    delete copy.publishToken;
    delete copy.publishedBy;
    return copy;
  });

  const payload = {
    version: 3,
    systemName: 'T-DX Lab☆問題演習システム',
    schoolYear: currentSchoolYear_(),
    resetEpoch: currentResetEpoch_(),
    updatedAt: new Date().toISOString(),
    analyses: publicNext
  };

  return githubPutJson_(
    TDX_CONFIG.ANALYSIS_PATH,
    payload,
    'T-DX Lab: publish analysis ' + analysis.examId + ' (' + email + ')'
  );
}

function githubConfigured_() {
  const p = PropertiesService.getScriptProperties();
  return !!(
    p.getProperty(TDX_CONFIG.PROP_GH_OWNER) &&
    p.getProperty(TDX_CONFIG.PROP_GH_REPO) &&
    p.getProperty(TDX_CONFIG.PROP_GH_BRANCH) &&
    p.getProperty(TDX_CONFIG.PROP_GH_TOKEN)
  );
}

function githubPublicInfo_() {
  const p = PropertiesService.getScriptProperties();
  return {
    owner: p.getProperty(TDX_CONFIG.PROP_GH_OWNER) || '',
    repo: p.getProperty(TDX_CONFIG.PROP_GH_REPO) || '',
    branch: p.getProperty(TDX_CONFIG.PROP_GH_BRANCH) || ''
  };
}

function githubConfig_() {
  if (!githubConfigured_()) {
    throw new Error('GitHub連携が未設定です。setupGitHubConnection を実行してください。');
  }
  const p = PropertiesService.getScriptProperties();
  return {
    owner: p.getProperty(TDX_CONFIG.PROP_GH_OWNER),
    repo: p.getProperty(TDX_CONFIG.PROP_GH_REPO),
    branch: p.getProperty(TDX_CONFIG.PROP_GH_BRANCH),
    token: p.getProperty(TDX_CONFIG.PROP_GH_TOKEN)
  };
}

function parseGitHubRepo_(value) {
  let s = String(value || '').trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  if (!s) return null;

  const urlMatch = s.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)$/i);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2] };

  const pairMatch = s.match(/^([^\/\s]+)\/([^\/\s]+)$/);
  if (pairMatch) return { owner: pairMatch[1], repo: pairMatch[2] };

  return null;
}

function githubApi_(method, url, body, token) {
  const options = {
    method: String(method || 'get').toLowerCase(),
    muteHttpExceptions: true,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'T-DX-Lab-GAS'
    }
  };
  if (body != null) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }

  const res = UrlFetchApp.fetch(url, options);
  const code = res.getResponseCode();
  const text = res.getContentText('UTF-8');
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch (err) { data = { raw: text }; }
  }
  if (code < 200 || code >= 300) {
    const detail = data && data.message ? data.message : text;
    throw new Error('GitHub API エラー (' + code + '): ' + detail);
  }
  return data;
}

function githubGetFile_(path, allowMissing) {
  const c = githubConfig_();
  const url =
    'https://api.github.com/repos/' +
    encodeURIComponent(c.owner) + '/' +
    encodeURIComponent(c.repo) +
    '/contents/' + path.split('/').map(encodeURIComponent).join('/') +
    '?ref=' + encodeURIComponent(c.branch);

  const options = {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      'Authorization': 'Bearer ' + c.token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'T-DX-Lab-GAS'
    }
  };
  const res = UrlFetchApp.fetch(url, options);
  const code = res.getResponseCode();
  const text = res.getContentText('UTF-8');

  if (code === 404 && allowMissing) return null;
  if (code < 200 || code >= 300) {
    let detail = text;
    try { detail = JSON.parse(text).message || text; } catch (err) {}
    throw new Error('GitHubファイル取得エラー (' + code + '): ' + detail);
  }
  return JSON.parse(text);
}

function githubReadJson_(path, fallback) {
  const file = githubGetFile_(path, true);
  if (!file) return JSON.parse(JSON.stringify(fallback));
  const encoded = String(file.content || '').replace(/\s/g, '');
  const bytes = Utilities.base64Decode(encoded);
  const text = Utilities.newBlob(bytes).getDataAsString('UTF-8');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(path + ' のJSONを読み取れません。');
  }
}

function githubPutJson_(path, obj, message) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const c = githubConfig_();
    const existing = githubGetFile_(path, true);
    const json = JSON.stringify(obj, null, 2) + '\n';
    const url =
      'https://api.github.com/repos/' +
      encodeURIComponent(c.owner) + '/' +
      encodeURIComponent(c.repo) +
      '/contents/' + path.split('/').map(encodeURIComponent).join('/');

    const body = {
      message: message || ('T-DX Lab: update ' + path),
      content: Utilities.base64Encode(json, Utilities.Charset.UTF_8),
      branch: c.branch
    };
    if (existing && existing.sha) body.sha = existing.sha;

    const result = githubApi_('put', url, body, c.token);
    return {
      ok: true,
      path: path,
      sha: result && result.content ? String(result.content.sha || '') : '',
      message: path + ' をGitHubへ反映しました。'
    };
  } finally {
    lock.releaseLock();
  }
}

function writeSyncStatus_(token, value) {
  token = String(token || '').trim();
  if (!token) return;
  CacheService.getScriptCache().put(
    'tdx-sync:' + token,
    JSON.stringify(value || {}),
    600
  );
}

function readSyncStatus_(token) {
  token = String(token || '').trim();
  if (!token) return { ok: false, done: true, message: '同期トークンがありません。' };
  const raw = CacheService.getScriptCache().get('tdx-sync:' + token);
  if (!raw) return { ok: true, done: false, pending: true, message: '処理待ちです。' };
  try { return JSON.parse(raw); }
  catch (err) { return { ok: false, done: true, message: '同期状態を読み取れません。' }; }
}

function logSync_(kind, target, email, result, message) {
  const ss = getTDXSpreadsheet_();
  const sheet = ensureSheet_(
    ss,
    TDX_CONFIG.SYNC_SHEET,
    ['日時', '種類', '対象', '実行ユーザー', '結果', 'メッセージ']
  );
  sheet.appendRow([new Date(), kind, target, email, result, message]);
}

function output_(obj, callback) {
  const json = JSON.stringify(obj);
  const cb = String(callback || '').trim();
  if (cb && /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function text_(v, maxLen) {
  return String(v == null ? '' : v).slice(0, maxLen || 500);
}
function number_(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function clampPct_(v) {
  return Math.max(0, Math.min(100, number_(v)));
}
function validDate_(v) {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}
