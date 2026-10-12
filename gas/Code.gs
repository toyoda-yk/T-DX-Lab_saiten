const TDX_CONFIG = {
  PROP_SS_ID: 'TDX_SPREADSHEET_ID',
  TEST_SHEET: '接続テスト',
  INDEX_SHEET: '分析一覧',
  DATA_SHEET: '分析データ',
  CHUNK_SIZE: 40000
};

/**
 * 初回セットアップ。スプレッドシートに紐づくApps Scriptから1回実行します。
 */
function setupTDXLab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('スプレッドシートからApps Scriptを開いて実行してください。');

  PropertiesService.getScriptProperties().setProperty(TDX_CONFIG.PROP_SS_ID, ss.getId());

  ensureSheet_(ss, TDX_CONFIG.TEST_SHEET, ['日時', '実行ユーザー', '内容']);
  ensureSheet_(ss, TDX_CONFIG.INDEX_SHEET, [
    '試験ID', '試験名', '教科', '満点', '更新日時', '公開者', '全体人数', 'クラス', '公開トークン'
  ]);
  ensureSheet_(ss, TDX_CONFIG.DATA_SHEET, [
    '試験ID', 'チャンク番号', 'JSONデータ', '更新日時', '公開者'
  ]);

  SpreadsheetApp.flush();
  console.log('T-DX Lab 分析共有 初期設定完了');
}

/**
 * GET: ping / whoami / writeTest / readTest / listAnalysis / getAnalysis / getAnalysisMeta
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
    } else {
      result = { ok: false, message: '不明なactionです。' };
    }

    return output_(result, p.callback);
  } catch (error) {
    return output_({ ok: false, message: String(error && error.message ? error.message : error) }, e && e.parameter && e.parameter.callback);
  }
}

/**
 * POST: publishAnalysis
 * 共有スプレッドシートの「編集者」だけ公開できます。
 */
function doPost(e) {
  try {
    const p = (e && e.parameter) || {};
    const action = p.action || '';
    if (action !== 'publishAnalysis') throw new Error('不明なPOST actionです。');

    const email = activeEmail_();
    if (!email) throw new Error('OENアカウントを確認できません。');
    if (!isAuthorizedTeacher_(email)) {
      throw new Error('公開権限がありません。分析共有スプレッドシートを編集者として共有してください。');
    }

    const raw = String(p.payload || '');
    if (!raw) throw new Error('分析データがありません。');
    const parsed = JSON.parse(raw);
    const clean = sanitizeAnalysis_(parsed);
    saveAnalysis_(clean, email);

    return output_({
      ok: true,
      message: '分析結果を公開しました。',
      examId: clean.examId,
      generatedAt: clean.generatedAt,
      publishToken: clean.publishToken,
      publishedBy: email
    });
  } catch (error) {
    return output_({ ok: false, message: String(error && error.message ? error.message : error) });
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
