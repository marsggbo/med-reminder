// 数据层：本地缓存(Storage) + 微信云开发同步。
// 换手机后登录同一微信账号，数据自动从云端拉回。
//
// 数据模型（与 Web 版语义一致）：
//   meds  [{ id, name, dosePerTime, doseUnit, timesPerDay,
//            scheduleTimes:[HH:MM], durationDays, startDate:YYYY-MM-DD,
//            status:'active'|'stopped', updatedAt:ms, createdAt:ms }]
//   logs  [{ id, medicationId, scheduledDate:YYYY-MM-DD, scheduledTime:HH:MM,
//            takenAt:ISO|null, updatedAt:ms }]
// 云数据库 collection "meduser"，每用户一文档 _id = openid。

const date = require('./date');

const KEY = 'med_local_v1';
const CLOUD_FN = 'sync';

let cache = null;       // { meds, logs }
let initPromise = null;
let syncTimer = null;

function nowIso() { return new Date().toISOString(); }
function nowMs() { return Date.now(); }

function loadLocal() {
  try {
    const raw = wx.getStorageSync(KEY);
    if (raw && Array.isArray(raw.meds) && Array.isArray(raw.logs)) return raw;
  } catch (e) { /* ignore */ }
  return { meds: [], logs: [] };
}

function saveLocal() {
  try { wx.setStorageSync(KEY, cache); } catch (e) { /* storage full etc. */ }
}

// ── 与云端合并：单人使用，同 id 取 updatedAt 较新者（幂等，可反复执行）
function mergeRemote(remote) {
  if (!remote || (!Array.isArray(remote.meds) && !Array.isArray(remote.logs))) return false;

  let changed = false;

  const medMap = {};
  cache.meds.forEach(function (m) { medMap[m.id] = m; });
  remote.meds.forEach(function (m) {
    const cur = medMap[m.id];
    if (!cur) { medMap[m.id] = m; changed = true; }
    else if (m.updatedAt > cur.updatedAt) { medMap[m.id] = m; changed = true; }
  });
  const meds = Object.keys(medMap).map(function (k) { return medMap[k]; });

  const logMap = {};
  cache.logs.forEach(function (l) { logMap[l.id] = l; });
  remote.logs.forEach(function (l) {
    const cur = logMap[l.id];
    if (!cur) { logMap[l.id] = l; changed = true; }
    else if (l.updatedAt > cur.updatedAt) { logMap[l.id] = l; changed = true; }
  });
  const logs = Object.keys(logMap).map(function (k) { return logMap[k]; });

  cache = { meds: meds, logs: logs };
  saveLocal();
  return changed;
}

function push() {
  if (!wx.cloud) return Promise.resolve(false);
  return wx.cloud.callFunction({
    name: CLOUD_FN,
    data: { action: 'save', payload: { meds: cache.meds, logs: cache.logs } }
  }).then(function () { return true; })
    .catch(function () { return false; });
}

function schedulePush() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(function () {
    syncTimer = null;
    push();
  }, 1200);
}

function pull() {
  return wx.cloud.callFunction({
    name: CLOUD_FN,
    data: { action: 'get' }
  }).then(function (res) {
    const remote = res && res.result && res.result.data;
    if (mergeRemote(remote)) push();
    return true;
  }).catch(function () { return false; });
}

// 冷启动：加载本地 → 拉云端合并（只执行一次）
function init() {
  if (!cache) {
    cache = loadLocal();
  }
  if (initPromise) return initPromise;
  if (!wx.cloud) { initPromise = Promise.resolve(false); return initPromise; }
  initPromise = pull();
  return initPromise;
}

// 只读查询
function getMeds() { return cache ? cache.meds : []; }
function getLogs() { return cache ? cache.logs : []; }
function getMed(id) { return cache.meds.find(function (m) { return m.id === id; }); }

// 某天应服任务（active 且 startDate ≤ d < startDate+durationDays）
function tasksFor(dateStr) {
  const out = [];
  cache.meds.forEach(function (m) {
    if (!m || m.status !== 'active') return;
    if (!m.startDate || dateStr < m.startDate) return;
    if (m.durationDays && dateStr >= date.addDays(m.startDate, m.durationDays)) return;
    (m.scheduleTimes || []).forEach(function (t) {
      out.push({ medId: m.id, time: t });
    });
  });
  out.sort(function (a, b) { return a.time > b.time ? 1 : -1; });
  return out;
}

function logId(d, medId, t) { return d + '_' + medId + '_' + t; }

function getLog(dateStr, medId, time) {
  return cache.logs.find(function (l) {
    return l.scheduledDate === dateStr && l.medicationId === medId && l.scheduledTime === time;
  });
}

// 打卡/取消打卡。返回 {takenAt, takenClock|null} 给 UI；null 表示任务不存在
function takeDose(dateStr, medId, time) {
  let log = getLog(dateStr, medId, time);
  if (!log) {
    log = {
      id: logId(dateStr, medId, time),
      medicationId: medId,
      scheduledDate: dateStr,
      scheduledTime: time,
      takenAt: null,
      updatedAt: nowMs()
    };
    cache.logs.push(log);
  }
  if (log.takenAt) {
    log.takenAt = null;
    log.updatedAt = nowMs();
  } else {
    log.takenAt = nowIso();
    log.updatedAt = nowMs();
  }
  saveLocal();
  schedulePush();
  return log;
}

// 药品增删改 ──────────────────────────────────────────
function addMed(med) {
  med.updatedAt = nowMs();
  med.createdAt = med.createdAt || nowMs();
  cache.meds.push(med);
  saveLocal();
  schedulePush();
  return med;
}

function updateMed(med) {
  med.updatedAt = nowMs();
  cache.meds = cache.meds.map(function (m) { return m.id === med.id ? med : m; });
  saveLocal();
  schedulePush();
}

function deleteMed(id) {
  cache.meds = cache.meds.filter(function (m) { return m.id !== id; });
  saveLocal();
  schedulePush();
}

module.exports = {
  init: init, push: push, pull: pull,
  getMeds: getMeds, getLogs: getLogs, getMed: getMed, getLog: getLog,
  tasksFor: tasksFor, takeDose: takeDose,
  addMed: addMed, updateMed: updateMed, deleteMed: deleteMed
};