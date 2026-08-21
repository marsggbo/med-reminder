window.Store = (function () {
  var KEYS = {
    meds: 'med_medications',
    batches: 'med_stock_batches',
    logs: 'med_dose_logs',
    settings: 'med_settings'
  };

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; }
  }
  function loadObj(key, def) {
    try { return JSON.parse(localStorage.getItem(key)) || def; } catch (e) { return def; }
  }
  function save(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

  // ── Settings ──────────────────────────────────────────────────────────────
  var defaultSettings = {
    stockWarnDays: 3, expiryWarnDays: 7,
    notifyEnabled: false,
    llmEnabled: false, llmBaseUrl: '', llmModel: '', llmApiKey: ''
  };
  function getSettings() { return Object.assign({}, defaultSettings, loadObj(KEYS.settings, {})); }
  // Partial saves merge onto current settings so no field is ever wiped
  function saveSettings(s) { save(KEYS.settings, Object.assign({}, getSettings(), s)); }

  // ── Medications ───────────────────────────────────────────────────────────
  function getMeds() { return load(KEYS.meds); }
  function saveMeds(arr) { save(KEYS.meds, arr); }
  function getMed(id) { return getMeds().find(function (m) { return m.id === id; }); }

  function addMed(med) {
    var meds = getMeds();
    meds.push(med);
    saveMeds(meds);
  }

  function updateMed(id, patch) {
    var meds = getMeds().map(function (m) {
      return m.id === id ? Object.assign({}, m, patch) : m;
    });
    saveMeds(meds);
  }

  function deleteMed(id) {
    saveMeds(getMeds().filter(function (m) { return m.id !== id; }));
    // cascade: delete batches and logs
    saveBatches(getBatches().filter(function (b) { return b.medicationId !== id; }));
    saveLogs(getLogs().filter(function (l) { return l.medicationId !== id; }));
  }

  // ── Stock Batches ─────────────────────────────────────────────────────────
  function getBatches() { return load(KEYS.batches); }
  function saveBatches(arr) { save(KEYS.batches, arr); }
  function getBatchesFor(medId) {
    return getBatches()
      .filter(function (b) { return b.medicationId === medId; })
      .sort(function (a, b) { return a.expiryDate < b.expiryDate ? -1 : 1; });
  }

  function addBatch(batch) {
    var bs = getBatches();
    bs.push(batch);
    saveBatches(bs);
  }

  function updateBatch(id, patch) {
    saveBatches(getBatches().map(function (b) {
      return b.id === id ? Object.assign({}, b, patch) : b;
    }));
  }

  function deleteBatch(id) {
    saveBatches(getBatches().filter(function (b) { return b.id !== id; }));
  }

  // Deduct stock (FEFO – earliest expiry first). Returns remaining deduction (0 = success)
  function deductStock(medId, amount) {
    var batches = getBatchesFor(medId);
    var remaining = amount;
    var updated = getBatches().slice();
    for (var i = 0; i < batches.length && remaining > 0; i++) {
      var batch = batches[i];
      var idx = updated.findIndex(function (b) { return b.id === batch.id; });
      var take = Math.min(updated[idx].quantity, remaining);
      updated[idx] = Object.assign({}, updated[idx], { quantity: updated[idx].quantity - take });
      remaining -= take;
    }
    saveBatches(updated);
    return remaining; // 0 means fully deducted
  }

  // Total remaining stock (all batches for medId)
  function totalStock(medId) {
    return getBatchesFor(medId).reduce(function (s, b) { return s + b.quantity; }, 0);
  }

  // Days of stock remaining
  function stockDaysLeft(medId) {
    var med = getMed(medId);
    if (!med) return 0;
    var perDay = med.timesPerDay * med.dosePerTime;
    if (!perDay) return Infinity;
    return totalStock(medId) / perDay;
  }

  // ── Dose Logs ─────────────────────────────────────────────────────────────
  function getLogs() { return load(KEYS.logs); }
  function saveLogs(arr) { save(KEYS.logs, arr); }

  function getLogsFor(medId) {
    return getLogs().filter(function (l) { return l.medicationId === medId; });
  }

  function getLogsOnDate(dateStr) {
    return getLogs().filter(function (l) { return l.scheduledDate === dateStr; });
  }

  function addLog(log) {
    var logs = getLogs();
    logs.push(log);
    saveLogs(logs);
  }

  function updateLog(id, patch) {
    saveLogs(getLogs().map(function (l) {
      return l.id === id ? Object.assign({}, l, patch) : l;
    }));
  }

  function getLog(id) { return getLogs().find(function (l) { return l.id === id; }); }

  // Generate future dose logs for a medication from startDate for durationDays days.
  // Only generates logs that don't already exist for that date+time.
  function generateLogs(med) {
    var existing = getLogsFor(med.id);
    var existingKeys = {};
    existing.forEach(function (l) { existingKeys[l.scheduledDate + '|' + l.scheduledTime] = true; });

    var newLogs = [];
    for (var d = 0; d < med.durationDays; d++) {
      var date = Utils.addDays(med.startDate, d);
      med.scheduleTimes.forEach(function (t) {
        var key = date + '|' + t;
        if (!existingKeys[key]) {
          newLogs.push({
            id: Utils.uid(),
            medicationId: med.id,
            scheduledDate: date,
            scheduledTime: t,
            status: 'pending',
            takenAt: null
          });
        }
      });
    }
    if (newLogs.length) {
      saveLogs(getLogs().concat(newLogs));
    }
  }

  // Rebuild a medication's dose plan: keep taken logs, drop pending/missed logs,
  // regenerate from the med's current startDate/duration/scheduleTimes.
  // Called after editing start date, times or duration so calendar reflects new plan.
  function reschedule(medId, newTimes, startDate) {
    var med = getMed(medId);
    if (!med) return;
    var times = Array.isArray(newTimes) && newTimes.length ? newTimes.slice() : med.scheduleTimes;
    if (typeof startDate === 'string' && startDate) med = Object.assign({}, med, { startDate: startDate });
    if (!Array.isArray(times) || !times.length) times = Utils.computeScheduleTimes(med.timesPerDay);
    var kept = getLogs().filter(function (l) {
      return l.medicationId !== medId || l.status === 'taken';
    });
    saveLogs(kept);
    generateLogs(Object.assign({}, med, { scheduleTimes: times }));
  }

  // Mark a log as taken and deduct stock
  function takeDose(logId) {
    var log = getLog(logId);
    if (!log || log.status === 'taken') return false;
    var med = getMed(log.medicationId);
    if (!med) return false;
    updateLog(logId, { status: 'taken', takenAt: new Date().toISOString() });
    deductStock(med.id, med.dosePerTime);
    return true;
  }

  // ── Backup / restore ──────────────────────────────────────────────────────
  function exportData() {
    return {
      app: 'med-reminder', version: 1, exportedAt: new Date().toISOString(),
      meds: getMeds(), batches: getBatches(), logs: getLogs(), settings: getSettings()
    };
  }

  // Returns {ok:true} or {ok:false, message}
  function importData(obj) {
    if (!obj || obj.app !== 'med-reminder') {
      return { ok: false, message: '不是有效的备份文件' };
    }
    var meds = Array.isArray(obj.meds) ? obj.meds : [];
    var batches = Array.isArray(obj.batches) ? obj.batches : [];
    var logs = Array.isArray(obj.logs) ? obj.logs : [];
    var settings = obj.settings && typeof obj.settings === 'object' ? obj.settings : {};
    save(KEYS.meds, meds);
    save(KEYS.batches, batches);
    save(KEYS.logs, logs);
    save(KEYS.settings, settings);
    return { ok: true, counts: { meds: meds.length, batches: batches.length, logs: logs.length } };
  }

  return {
    getSettings: getSettings,
    saveSettings: saveSettings,
    getMeds: getMeds,
    getMed: getMed,
    addMed: addMed,
    updateMed: updateMed,
    deleteMed: deleteMed,
    getBatches: getBatches,
    getBatchesFor: getBatchesFor,
    addBatch: addBatch,
    updateBatch: updateBatch,
    deleteBatch: deleteBatch,
    totalStock: totalStock,
    stockDaysLeft: stockDaysLeft,
    getLogs: getLogs,
    getLogsFor: getLogsFor,
    getLogsOnDate: getLogsOnDate,
    addLog: addLog,
    updateLog: updateLog,
    getLog: getLog,
    generateLogs: generateLogs,
    reschedule: reschedule,
    takeDose: takeDose,
    exportData: exportData,
    importData: importData
  };
})();
