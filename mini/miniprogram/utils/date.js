// 日期工具（与 Web 版 assets/utils.js 语义保持一致）

function pad(n) { return n < 10 ? '0' + n : '' + n; }

// 今天 "YYYY-MM-DD"（本地时区）
function today() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// YYYY-MM-DD + n 天
function addDays(dateStr, n) {
  var p = dateStr.split('-');
  var d = new Date(+p[0], +p[1] - 1, +p[2]);
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// "2026-08-21" → "8月21日 周五"
function formatDate(dateStr) {
  var p = dateStr.split('-');
  var d = new Date(+p[0], +p[1] - 1, +p[2]);
  return (+p[1]) + '月' + (+p[2]) + '日 周' + ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
}

// "09:00" → 上午/下午/晚上
function segmentOfTime(t) {
  var h = parseInt(t.split(':')[0], 10);
  if (h < 12) return '上午';
  if (h < 18) return '下午';
  return '晚上';
}

// ISO → "HH:MM"（本地时区），无效返回 ''
function fmtClock(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

module.exports = { pad: pad, today: today, addDays: addDays, formatDate: formatDate, segmentOfTime: segmentOfTime, fmtClock: fmtClock, uid: uid };