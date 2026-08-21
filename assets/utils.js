// Date helpers — no Date.now() in workflow scripts but this runs in browser
window.Utils = (function () {
  function toDateStr(date) {
    var d = date || new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function today() { return toDateStr(new Date()); }

  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  }

  function diffDays(a, b) {
    // b - a in days (positive if b is later)
    var da = new Date(a + 'T00:00:00');
    var db = new Date(b + 'T00:00:00');
    return Math.round((db - da) / 86400000);
  }

  function formatDate(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    var days = ['日','一','二','三','四','五','六'];
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + days[d.getDay()];
  }

  function formatDateShort(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function nowTime() {
    var d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // 默认服药时间：1~5 次/天按常见作息（早9 / 中13 / 晚18），更多次数在 08:00–22:00 均匀分布
  var DEFAULT_SCHEDULE = {
    1: ['09:00'],
    2: ['09:00', '18:00'],
    3: ['09:00', '13:00', '18:00'],
    4: ['09:00', '12:00', '15:00', '18:00'],
    5: ['08:00', '09:00', '13:00', '15:00', '18:00']
  };
  function computeScheduleTimes(timesPerDay) {
    var n = parseInt(timesPerDay, 10) || 1;
    if (n <= 0) n = 1;
    if (n > 8) n = 8;
    if (DEFAULT_SCHEDULE[n]) return DEFAULT_SCHEDULE[n].slice();
    var times = [];
    for (var i = 0; i < n; i++) {
      var mins = 8 * 60 + Math.round((14 * 60 / (n - 1)) * i); // 08:00–22:00 均分
      var h = Math.floor(mins / 60), m = mins % 60;
      times.push(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
    }
    return times;
  }

  // 时间段：上午 <12:00，下午 12:00–17:59，晚上 ≥18:00
  function segmentOfTime(time) {
    var h = parseInt(time, 10);
    if (isNaN(h)) return '其他';
    if (h < 12) return '上午';
    if (h < 18) return '下午';
    return '晚上';
  }

  // Returns 'pending'|'taken'|'missed' for a log considering current time
  function resolveLogStatus(log) {
    if (log.status === 'taken') return 'taken';
    var t = today();
    if (log.scheduledDate < t) return 'missed';
    if (log.scheduledDate === t && nowTime() > log.scheduledTime) return 'missed';
    return 'pending';
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function daysUntil(dateStr) {
    return diffDays(today(), dateStr);
  }

  return {
    toDateStr: toDateStr,
    today: today,
    addDays: addDays,
    diffDays: diffDays,
    formatDate: formatDate,
    formatDateShort: formatDateShort,
    nowTime: nowTime,
    computeScheduleTimes: computeScheduleTimes,
    segmentOfTime: segmentOfTime,
    resolveLogStatus: resolveLogStatus,
    uid: uid,
    daysUntil: daysUntil
  };
})();
