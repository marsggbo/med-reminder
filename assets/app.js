// ── App controller ────────────────────────────────────────────────────────
window.App = (function () {
  var currentView = 'today';
  var calendarDate = Utils.today();
  var calendarGroupMode = 'time'; // 'time' | 'med'
  var editingMedId = null;
  var editingBatchId = null;
  var photoDataUrl = null;

  // ── Navigation ────────────────────────────────────────────────────────────
  function showView(name) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.remove('active'); });
    var view = document.getElementById('view-' + name);
    if (view) view.classList.add('active');
    var btn = document.getElementById('nav-' + name);
    if (btn) btn.classList.add('active');
    currentView = name;
    renderView(name);
  }

  function renderView(name) {
    if (name === 'today') renderToday();
    else if (name === 'calendar') renderCalendar();
    else if (name === 'meds') renderMedList();
    else if (name === 'settings') renderSettings();
  }

  // ── TODAY view ────────────────────────────────────────────────────────────
  function renderToday() {
    var container = document.getElementById('today-content');
    var d = Utils.today();
    var settings = Store.getSettings();
    var logs = Store.getLogsOnDate(d);
    var meds = Store.getMeds();

    var html = '<div class="today-label">今日打卡</div>';
    html += '<div class="today-sub">' + Utils.formatDate(d) + '</div>';

    // Warnings
    meds.filter(function (m) { return m.status === 'active'; }).forEach(function (m) {
      var days = Store.stockDaysLeft(m.id);
      if (days < settings.stockWarnDays) {
        html += '<div class="warn-banner' + (days <= 0 ? ' danger' : '') + '">'
          + '<span class="warn-icon">⚠️</span>'
          + '<span><strong>' + m.name + '</strong> 库存'
          + (days <= 0 ? '已告急（0天）' : '仅剩约 ' + Math.floor(days) + ' 天') + '，请及时补货。</span></div>';
      }
      Store.getBatchesFor(m.id).forEach(function (b) {
        var daysLeft = Utils.daysUntil(b.expiryDate);
        if (b.quantity > 0 && daysLeft <= settings.expiryWarnDays) {
          var expired = daysLeft < 0;
          html += '<div class="warn-banner' + (expired ? ' danger' : '') + '">'
            + '<span class="warn-icon">' + (expired ? '🚫' : '⏰') + '</span>'
            + '<span><strong>' + m.name + '</strong> 批次保质期'
            + (expired ? '已过期（' + Math.abs(daysLeft) + '天前）' : '还剩 ' + daysLeft + ' 天到期') + '。</span></div>';
        }
      });
    });

    // Active medication logs
    var activeMedIds = meds.filter(function (m) { return m.status === 'active'; })
                           .map(function (m) { return m.id; });
    var todayLogs = logs.filter(function (l) { return activeMedIds.indexOf(l.medicationId) !== -1; });

    if (todayLogs.length === 0) {
      html += '<div class="card"><div class="empty-state"><div class="empty-icon">💊</div>'
        + '<div class="empty-text">今日暂无服药任务</div>'
        + '<div class="empty-hint">去「我的药品」添加药品</div></div></div>';
    } else {
      html += renderLogsBySegment(todayLogs, meds, true);
    }

    container.innerHTML = html;
  }

  var SEGMENT_META = [['上午', '☀️'], ['下午', '🌤️'], ['晚上', '🌙']];
  function segLabel(seg) {
    for (var i = 0; i < SEGMENT_META.length; i++) {
      if (SEGMENT_META[i][0] === seg) return SEGMENT_META[i][1] + ' ' + seg;
    }
    return seg;
  }

  // 按 上午/下午/晚上 分段渲染打卡列表；段与段之间用分割线隔开
  function renderLogsBySegment(dayLogs, meds, isToday) {
    var html = '';
    for (var si = 0; si < SEGMENT_META.length; si++) {
      var seg = SEGMENT_META[si][0];
      var segLogs = dayLogs.filter(function (l) { return Utils.segmentOfTime(l.scheduledTime) === seg; });
      if (!segLogs.length) continue;
      html += '<div class="segment-bar">' + segLabel(seg) + '</div><div class="card" style="padding:4px 16px;margin-bottom:4px">';
      var byTime = {};
      segLogs.forEach(function (l) {
        if (!byTime[l.scheduledTime]) byTime[l.scheduledTime] = [];
        byTime[l.scheduledTime].push(l);
      });
      Object.keys(byTime).sort().forEach(function (t) {
        byTime[t].forEach(function (l) {
          var med = meds.find(function (m) { return m.id === l.medicationId; });
          if (!med) return;
          var status = Utils.resolveLogStatus(l);
          html += renderDoseItem(l, med, status, false);
        });
      });
      html += '</div>';
    }
    return html;
  }

  function fmtClock(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? '0' + h : '' + h) + ':' + (m < 10 ? '0' + m : '' + m);
  }

  function renderDoseItem(log, med, status, withSegment) {
    var icon = status === 'taken' ? '✓' : status === 'missed' ? '✗' : '';
    var segPrefix = withSegment ? Utils.segmentOfTime(log.scheduledTime) + ' ' : '';
    var timeHtml;
    if (status === 'taken') {
      // 已打卡:展示计划时间 + 实际打卡时刻,便于判断下一剂的间隔
      timeHtml = '<div class="dose-time">'
        + '<span class="dose-time-plan">' + segPrefix + log.scheduledTime + '</span>'
        + (log.takenAt ? '<span class="dose-taken-at">已服 ' + fmtClock(log.takenAt) + '</span>' : '')
        + '</div>';
    } else {
      // 未打卡:时间本身可直接编辑(系统时间选择器),改完自动重新分段/重排通知
      timeHtml = '<input type="time" class="dose-time-input" value="' + log.scheduledTime
        + '" data-log-id="' + log.id + '" aria-label="修改服药时间">';
    }
    return '<div class="dose-item">'
      + '<button class="dose-check ' + status + '" data-action="take-dose" data-log-id="' + log.id + '">' + icon + '</button>'
      + '<div class="dose-info">'
      + '<div class="dose-name">' + med.name + '</div>'
      + '<div class="dose-detail">' + med.dosePerTime + med.doseUnit
      + (med.instructions ? ' · ' + med.instructions : '') + '</div>'
      + '</div>'
      + timeHtml
      + '</div>';
  }

  // ── CALENDAR view ─────────────────────────────────────────────────────────
  function renderCalendar() {
    renderDateStrip();
    renderCalendarDay();
  }

  function renderDateStrip() {
    var strip = document.getElementById('date-strip');
    var html = '';
    var t = Utils.today();
    var meds = Store.getMeds();
    var activeIds = meds.filter(function (m) { return m.status === 'active'; }).map(function (m) { return m.id; });
    for (var i = -3; i <= 6; i++) {
      var d = Utils.addDays(t, i);
      var dow = ['日','一','二','三','四','五','六'][new Date(d + 'T00:00:00').getDay()];
      var dom = new Date(d + 'T00:00:00').getDate();
      var active = d === calendarDate ? ' active' : '';
      var logs = Store.getLogsOnDate(d).filter(function (l) { return activeIds.indexOf(l.medicationId) !== -1; });
      var hasDot = logs.length > 0;
      html += '<button class="date-cell' + active + '" data-action="set-date" data-date="' + d + '">'
        + '<span class="dow">周' + dow + '</span>'
        + '<span class="dom">' + dom + '</span>'
        + (hasDot ? '<span class="dot"></span>' : '<span style="height:5px"></span>')
        + '</button>';
    }
    strip.innerHTML = html;
  }

  function renderCalendarDay() {
    var container = document.getElementById('calendar-content');
    var logs = Store.getLogsOnDate(calendarDate);
    var meds = Store.getMeds();
    var activeIds = meds.filter(function (m) { return m.status === 'active'; }).map(function (m) { return m.id; });
    var dayLogs = logs.filter(function (l) { return activeIds.indexOf(l.medicationId) !== -1; });

    var html = '<div class="today-sub" style="margin-bottom:12px">' + Utils.formatDate(calendarDate) + '</div>';

    if (dayLogs.length === 0) {
      html += '<div class="card"><div class="empty-state"><div class="empty-icon">📅</div>'
        + '<div class="empty-text">该日无服药任务</div></div></div>';
    } else if (calendarGroupMode === 'time') {
      html += renderLogsBySegment(dayLogs, meds, false);
    } else {
      var byMed = {};
      dayLogs.forEach(function (l) {
        if (!byMed[l.medicationId]) byMed[l.medicationId] = [];
        byMed[l.medicationId].push(l);
      });
      Object.keys(byMed).forEach(function (medId) {
        var med = meds.find(function (m) { return m.id === medId; });
        if (!med) return;
        html += '<div class="group-header">💊 ' + med.name + '</div><div class="card" style="padding:4px 16px">';
        byMed[medId].sort(function (a, b) { return a.scheduledTime > b.scheduledTime ? 1 : -1; })
          .forEach(function (l) {
            var status = Utils.resolveLogStatus(l);
            html += renderDoseItem(l, med, status, true);
          });
        html += '</div>';
      });
    }
    container.innerHTML = html;
  }

  // ── MEDICATIONS list view ──────────────────────────────────────────────────
  function renderMedList() {
    var container = document.getElementById('meds-content');
    var meds = Store.getMeds();
    if (meds.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding-top:60px">'
        + '<div class="empty-icon">💊</div>'
        + '<div class="empty-text">还没有添加药品</div>'
        + '<div class="empty-hint">点击右上角 + 添加第一个</div></div>';
      return;
    }
    var html = '';
    meds.forEach(function (med) {
      var batches = Store.getBatchesFor(med.id);
      var totalQty = batches.reduce(function (s, b) { return s + b.quantity; }, 0);
      var daysLeft = Store.stockDaysLeft(med.id);
      var settings = Store.getSettings();
      var warnStock = med.status === 'active' && daysLeft < settings.stockWarnDays;
      html += '<div class="card" data-action="open-med" data-med-id="' + med.id + '">'
        + '<div class="med-card">'
        + '<div class="med-icon">💊</div>'
        + '<div class="med-card-info">'
        + '<div class="med-card-name">' + med.name + '</div>'
        + '<div class="med-card-meta">' + med.timesPerDay + '次/天 · ' + med.dosePerTime + med.doseUnit
        + ' · 疗程' + med.durationDays + '天</div>'
        + '<div class="med-card-meta">库存 ' + totalQty + med.doseUnit
        + (warnStock ? ' ⚠️' : '') + '</div>'
        + '</div>'
        + '<span class="status-badge ' + med.status + '">' + (med.status === 'active' ? '服药中' : '已停药') + '</span>'
        + '</div></div>';
    });
    container.innerHTML = html;
  }

  // ── SETTINGS view ──────────────────────────────────────────────────────────
  function renderSettings() {
    var s = Store.getSettings();
    document.getElementById('setting-stock-warn').value = s.stockWarnDays;
    document.getElementById('setting-expiry-warn').value = s.expiryWarnDays;
    var notify = document.getElementById('setting-notify');
    if (notify) notify.checked = !!s.notifyEnabled;
    var llm = document.getElementById('setting-llm');
    if (llm) llm.checked = !!s.llmEnabled;
    toggleLlmFields();
    var base = document.getElementById('setting-llm-baseurl');
    if (base) base.value = s.llmBaseUrl || '';
    var model = document.getElementById('setting-llm-model');
    if (model) model.value = s.llmModel || '';
    var key = document.getElementById('setting-llm-key');
    if (key) key.value = s.llmApiKey || '';
  }

  function toggleLlmFields() {
    var llm = document.getElementById('setting-llm');
    var fields = document.getElementById('llm-fields');
    if (llm && fields) fields.style.display = llm.checked ? 'block' : 'none';
  }

  // ── ADD/EDIT medication sheet ──────────────────────────────────────────────
  // 服药时间编辑器：随着"每日次数"增减，保留已有值，新增位用默认时间补齐
  function readTimesInputs() {
    var container = document.getElementById('f-times-list');
    if (!container) return [];
    var out = [];
    container.querySelectorAll('input[type=time]').forEach(function (inp) {
      if (inp.value) out.push(inp.value);
    });
    return out;
  }

  function rebuildTimesList() {
    var container = document.getElementById('f-times-list');
    if (!container) return;
    var n = parseInt(document.getElementById('f-times').value, 10) || 1;
    if (n < 1) n = 1; if (n > 8) n = 8;
    var cur = readTimesInputs();
    var defaults = Utils.computeScheduleTimes(n);
    var values = [];
    for (var i = 0; i < n; i++) {
      values.push(cur[i] || defaults[i] || defaults[defaults.length - 1]);
    }
    var html = '';
    values.forEach(function (v, idx) {
      html += '<div class="time-row"><span class="time-idx">' + (idx + 1) + '</span>'
        + '<input type="time" class="time-input" value="' + v + '" />'
        + '<span class="time-seg">' + Utils.segmentOfTime(v) + '</span></div>';
    });
    container.innerHTML = html;
  }

  function openAddMedSheet(medId) {
    editingMedId = medId || null;
    photoDataUrl = null;
    var sheet = document.getElementById('sheet-med');
    var title = document.getElementById('sheet-med-title');
    title.textContent = medId ? '编辑药品' : '添加药品';
    document.getElementById('f-times').value = '';
    document.getElementById('f-times-list').innerHTML = '';

    if (medId) {
      var med = Store.getMed(medId);
      document.getElementById('f-name').value = med.name;
      document.getElementById('f-instructions').value = med.instructions || '';
      document.getElementById('f-duration').value = med.durationDays;
      document.getElementById('f-times').value = med.timesPerDay;
      document.getElementById('f-dose').value = med.dosePerTime;
      document.getElementById('f-unit').value = med.doseUnit;
      document.getElementById('f-start').value = med.startDate;
      if (med.photo) {
        photoDataUrl = med.photo;
        document.getElementById('photo-preview-img').src = med.photo;
        document.getElementById('photo-preview-img').style.display = 'block';
        document.getElementById('photo-placeholder').style.display = 'none';
      }
    } else {
      document.getElementById('f-name').value = '';
      document.getElementById('f-instructions').value = '';
      document.getElementById('f-duration').value = '7';
      document.getElementById('f-times').value = '3';
      document.getElementById('f-dose').value = '1';
      document.getElementById('f-unit').value = '片';
      document.getElementById('f-start').value = Utils.today();
      document.getElementById('photo-preview-img').style.display = 'none';
      document.getElementById('photo-placeholder').style.display = 'flex';
    }
    if (medId && Array.isArray(med.scheduleTimes) && med.scheduleTimes.length) {
      var html = '';
      med.scheduleTimes.forEach(function (t, idx) {
        html += '<div class="time-row"><span class="time-idx">' + (idx + 1) + '</span>'
          + '<input type="time" class="time-input" value="' + t + '">'
          + '<span class="time-seg">' + Utils.segmentOfTime(t) + '</span></div>';
      });
      document.getElementById('f-times-list').innerHTML = html;
    } else {
      rebuildTimesList();
    }
    openOverlay('overlay-med');
  }

  function collectTimes() {
    var n = parseInt(document.getElementById('f-times').value, 10) || 1;
    if (n < 1) n = 1; if (n > 8) n = 8;
    var vals = readTimesInputs();
    var defaults = Utils.computeScheduleTimes(n);
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push(vals[i] || defaults[i] || '09:00');
    }
    return out;
  }

  function saveMedForm() {
    var name = document.getElementById('f-name').value.trim();
    if (!name) { alert('请填写药品名称'); return; }
    var timesPerDay = parseInt(document.getElementById('f-times').value, 10) || 1;
    var durationDays = parseInt(document.getElementById('f-duration').value, 10) || 1;
    var dosePerTime = parseFloat(document.getElementById('f-dose').value) || 1;
    var doseUnit = document.getElementById('f-unit').value.trim() || '片';
    var instructions = document.getElementById('f-instructions').value.trim();
    var startDate = document.getElementById('f-start').value || Utils.today();
    var scheduleTimes = collectTimes(timesPerDay);

    if (editingMedId) {
      var oldMed = Store.getMed(editingMedId);
      Store.updateMed(editingMedId, {
        name: name, instructions: instructions, durationDays: durationDays,
        timesPerDay: timesPerDay, dosePerTime: dosePerTime, doseUnit: doseUnit,
        startDate: startDate, scheduleTimes: scheduleTimes,
        photo: photoDataUrl || oldMed.photo || null
      });
      // 次数/时间/开始日期/疗程任一变化都要重建日志，日历立即反映新方案
      Store.reschedule(editingMedId, scheduleTimes, startDate);
    } else {
      var med = {
        id: Utils.uid(), name: name, instructions: instructions,
        durationDays: durationDays, timesPerDay: timesPerDay,
        dosePerTime: dosePerTime, doseUnit: doseUnit, startDate: startDate,
        scheduleTimes: scheduleTimes, status: 'active',
        photo: photoDataUrl || null
      };
      Store.addMed(med);
      Store.generateLogs(med);
    }
    closeOverlay('overlay-med');
    renderMedList();
    scheduleTodayNotifications();
  }

  // ── MED DETAIL sheet ───────────────────────────────────────────────────────
  function openMedDetail(medId) {
    var med = Store.getMed(medId);
    if (!med) return;
    var s = Store.getSettings();
    var batches = Store.getBatchesFor(medId);
    var totalQty = batches.reduce(function (q, b) { return q + b.quantity; }, 0);
    var daysLeft = Store.stockDaysLeft(medId);

    var html = '<div class="sheet-handle"></div>'
      + '<div class="sheet-title">' + med.name + '</div>';

    if (med.status === 'active' && daysLeft < s.stockWarnDays) {
      html += '<div class="warn-banner' + (daysLeft <= 0 ? ' danger' : '') + '">'
        + '<span class="warn-icon">⚠️</span>'
        + '<span>库存仅剩约 ' + Math.floor(daysLeft) + ' 天，建议补货。</span></div>';
    }

    html += '<div class="card-row" style="margin-bottom:12px">'
      + '<div><div class="section-title">服药方案</div>'
      + '<div style="font-size:14px;color:#636366">'
      + med.timesPerDay + '次/天，每次 ' + med.dosePerTime + med.doseUnit
      + '，疗程 ' + med.durationDays + '天</div>'
      + (med.instructions ? '<div style="font-size:13px;color:#8e8e93;margin-top:4px">医嘱：' + med.instructions + '</div>' : '')
      + '<div style="font-size:13px;color:#8e8e93;margin-top:4px">服药时间：' + med.scheduleTimes.join('、') + '</div>'
      + '</div></div>'

      + '<div class="section-title" style="margin-top:8px">库存批次</div>';

    if (batches.length === 0) {
      html += '<div style="color:#aeaeb2;font-size:13px;padding:8px 0">暂无库存，请添加</div>';
    } else {
      batches.forEach(function (b) {
        var daysToExpiry = Utils.daysUntil(b.expiryDate);
        var expClass = daysToExpiry < 0 ? 'expired' : daysToExpiry <= s.expiryWarnDays ? 'warn' : '';
        var expText = daysToExpiry < 0 ? '已过期' : daysToExpiry === 0 ? '今日到期' : '保质期至 ' + b.expiryDate;
        html += '<div class="batch-row">'
          + '<div>'
          + '<div class="batch-qty">' + b.quantity + med.doseUnit + '</div>'
          + '<div class="batch-expiry ' + expClass + '">' + expText + '</div>'
          + '</div>'
          + '<div class="batch-actions">'
          + '<button class="btn-secondary" style="padding:6px 10px;font-size:12px" data-action="edit-batch" data-batch-id="' + b.id + '" data-med-id="' + medId + '">编辑</button>'
          + '<button class="btn-danger" style="padding:6px 10px;font-size:12px" data-action="del-batch" data-batch-id="' + b.id + '" data-med-id="' + medId + '">删除</button>'
          + '</div></div>';
      });
    }

    html += '<button class="btn-ghost" style="margin-top:8px" data-action="add-batch" data-med-id="' + medId + '">＋ 添加库存批次</button>'
      + '<div class="divider" style="margin-top:16px"></div>'
      + '<div style="display:flex;gap:8px;margin-top:16px">'
      + '<button class="btn-secondary" style="flex:1" data-action="edit-med" data-med-id="' + medId + '">编辑药品</button>';

    if (med.status === 'active') {
      html += '<button class="btn-danger" style="flex:1" data-action="stop-med" data-med-id="' + medId + '">标记停药</button>';
    } else {
      html += '<button class="btn-secondary" style="flex:1" data-action="restart-med" data-med-id="' + medId + '">重新启用</button>';
    }

    html += '</div>'
      + '<button class="btn-danger" style="width:100%;margin-top:10px" data-action="del-med" data-med-id="' + medId + '">删除药品</button>';

    var content = document.getElementById('med-detail-content');
    content.innerHTML = html;
    openOverlay('overlay-med-detail');
  }

  // ── BATCH sheet ────────────────────────────────────────────────────────────
  function openBatchSheet(medId, batchId) {
    editingBatchId = batchId || null;
    var medIdField = document.getElementById('b-med-id');
    medIdField.value = medId;

    if (batchId) {
      var batch = Store.getBatches().find(function (b) { return b.id === batchId; });
      document.getElementById('b-qty').value = batch.quantity;
      document.getElementById('b-expiry').value = batch.expiryDate;
      document.getElementById('sheet-batch-title').textContent = '编辑库存批次';
    } else {
      document.getElementById('b-qty').value = '';
      document.getElementById('b-expiry').value = '';
      document.getElementById('sheet-batch-title').textContent = '添加库存批次';
    }
    openOverlay('overlay-batch');
  }

  function saveBatchForm() {
    var medId = document.getElementById('b-med-id').value;
    var qty = parseFloat(document.getElementById('b-qty').value);
    var expiry = document.getElementById('b-expiry').value;
    if (!qty || qty <= 0) { alert('请填写库存数量'); return; }
    if (!expiry) { alert('请填写保质期'); return; }
    if (editingBatchId) {
      Store.updateBatch(editingBatchId, { quantity: qty, expiryDate: expiry });
    } else {
      Store.addBatch({
        id: Utils.uid(), medicationId: medId,
        quantity: qty, expiryDate: expiry,
        addedDate: Utils.today()
      });
    }
    closeOverlay('overlay-batch');
    openMedDetail(medId);
  }

  // ── 设置自动保存 + LLM 预设 ────────────────────────────────────────────────
  function persistSettings(withNotify) {
    var s = Store.getSettings();
    var sw = parseInt(document.getElementById('setting-stock-warn').value, 10);
    var ew = parseInt(document.getElementById('setting-expiry-warn').value, 10);
    s.stockWarnDays = sw > 0 ? sw : 3;
    s.expiryWarnDays = ew > 0 ? ew : 7;
    s.notifyEnabled = !!document.getElementById('setting-notify').checked;
    s.llmEnabled = !!document.getElementById('setting-llm').checked;
    s.llmBaseUrl = document.getElementById('setting-llm-baseurl').value.trim();
    s.llmModel = document.getElementById('setting-llm-model').value.trim();
    s.llmApiKey = document.getElementById('setting-llm-key').value.trim();
    Store.saveSettings(s);
    if (withNotify) scheduleTodayNotifications();
  }

  var LLM_PRESETS = {
    glm: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' }
  };

  function applyLlmPreset(value) {
    var p = LLM_PRESETS[value];
    if (!p) return;
    document.getElementById('setting-llm-baseurl').value = p.baseUrl;
    document.getElementById('setting-llm-model').value = p.model;
  }

  // ── OCR 识别引擎预加载（启动即加载，拍照时直接可用）─────────────────────────
  function preloadOcr() {
    var el = document.getElementById('scan-engine');
    if (el) {
      el.style.display = 'block';
      el.className = 'scan-engine';
      el.textContent = '正在准备拍照识别引擎…';
    }
    OCR.init(function (p) {
      if (!el) return;
      if (p >= 1) el.textContent = '拍照识别引擎已就绪 ✓';
      else el.textContent = '正在准备识别引擎 ' + Math.round(p * 100) + '%…';
    }).catch(function (e) {
      if (el) {
        el.className = 'scan-engine error';
        el.textContent = '识别引擎加载失败：' + (e && e.message ? e.message : '未知错误');
      }
    });
  }

  // ── Overlay helpers ────────────────────────────────────────────────────────
  function openOverlay(id) {
    document.getElementById(id).classList.add('open');
  }
  function closeOverlay(id) {
    document.getElementById(id).classList.remove('open');
  }

  // ── Global event delegation ────────────────────────────────────────────────
  function handleClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;

    if (action === 'nav') { showView(btn.dataset.view); return; }
    if (action === 'take-dose') {
      var logId = btn.dataset.logId;
      if (Store.takeDose(logId)) {
        cancelLogNotification(logId);
        renderView(currentView);
      }
      return;
    }
    if (action === 'set-date') {
      calendarDate = btn.dataset.date;
      renderCalendar();
      return;
    }
    if (action === 'toggle-group') {
      calendarGroupMode = btn.dataset.mode;
      document.querySelectorAll('.toggle-btn').forEach(function (b) {
        b.classList.toggle('active', b.dataset.mode === calendarGroupMode);
      });
      renderCalendarDay();
      return;
    }
    if (action === 'open-add-med') { openAddMedSheet(null); return; }
    if (action === 'save-med') { saveMedForm(); return; }
    if (action === 'close-overlay') {
      var overlayId = btn.dataset.overlay;
      closeOverlay(overlayId);
      return;
    }
    if (action === 'open-med') { openMedDetail(btn.dataset.medId); return; }
    if (action === 'edit-med') {
      closeOverlay('overlay-med-detail');
      openAddMedSheet(btn.dataset.medId);
      return;
    }
    if (action === 'add-batch') {
      closeOverlay('overlay-med-detail');
      openBatchSheet(btn.dataset.medId, null);
      return;
    }
    if (action === 'edit-batch') {
      closeOverlay('overlay-med-detail');
      openBatchSheet(btn.dataset.medId, btn.dataset.batchId);
      return;
    }
    if (action === 'del-batch') {
      if (confirm('确认删除该库存批次？')) {
        Store.deleteBatch(btn.dataset.batchId);
        openMedDetail(btn.dataset.medId);
      }
      return;
    }
    if (action === 'save-batch') { saveBatchForm(); return; }
    if (action === 'stop-med') {
      var medId = btn.dataset.medId;
      if (confirm('确认停药？将停止生成新的打卡任务，库存记录保留。')) {
        Store.updateMed(medId, { status: 'completed' });
        closeOverlay('overlay-med-detail');
        renderMedList();
        showCompletionBanner(medId);
      }
      return;
    }
    if (action === 'restart-med') {
      var medId = btn.dataset.medId;
      closeOverlay('overlay-med-detail');
      openAddMedSheet(medId);
      return;
    }
    if (action === 'del-med') {
      if (confirm('确认删除该药品？所有打卡记录和库存将一并删除。')) {
        Store.deleteMed(btn.dataset.medId);
        closeOverlay('overlay-med-detail');
        renderMedList();
      }
      return;
    }
    if (action === 'take-photo') {
      document.getElementById('photo-input').click();
      return;
    }
    if (action === 'start-scan') {
      var scanInput = document.getElementById('scan-input');
      var resultBox = document.getElementById('scan-result');
      if (resultBox) resultBox.style.display = 'none';
      scanInput.click();
      return;
    }
    if (action === 'export-data') { doExport(); return; }
    if (action === 'import-data') {
      document.getElementById('import-input').click();
      return;
    }
    if (action === 'save-settings') {
      persistSettings(true);
      alert('设置已保存');
      return;
    }
  }

  function showCompletionBanner(medId) {
    var med = Store.getMed(medId);
    if (!med) return;
    var container = document.getElementById('today-content');
    var banner = '<div class="confetti-banner">'
      + '<div class="big">🎉</div>'
      + '<h3>恭喜痊愈！</h3>'
      + '<p>' + med.name + ' 疗程已完成，继续保持健康！</p>'
      + '</div>';
    showView('today');
    container.innerHTML = banner + container.innerHTML;
  }

  // ── 说明书拍照识别（OCR → 规则/AI 解析 → 回填草稿，绝不自动保存）─────────────
  var scanning = false;

  function bindScanInput() {
    var input = document.getElementById('scan-input');
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (file) runScan(file);
    });
  }

  function setScanStatus(html, isError) {
    var status = document.getElementById('scan-status');
    status.style.display = 'flex';
    status.className = 'scan-status' + (isError ? ' error' : '');
    status.innerHTML = html;
  }

  function runScan(file) {
    if (scanning) return;
    scanning = true;
    var result = document.getElementById('scan-result');
    result.style.display = 'none';
    setScanStatus('<span class="spin"></span><span>正在读取照片…</span>', false);

    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        // 缩小到长边 ≤1600，控制识别耗时；canvas 输出 RGBA 与其余代码一致
        var LONG = 1600;
        var scale = Math.min(1, LONG / Math.max(img.width, img.height));
        var w = Math.max(2, Math.round(img.width * scale));
        var h = Math.max(2, Math.round(img.height * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        var imageData = ctx.getImageData(0, 0, w, h);
        doOcr({ w: w, h: h, data: new Uint8ClampedArray(imageData.data) });
      };
      img.onerror = function () {
        scanning = false;
        setScanStatus('⚠️ 图片读取失败，请重新拍摄', true);
      };
      img.src = e.target.result;
    };
    reader.onerror = function () {
      scanning = false;
      setScanStatus('⚠️ 文件读取失败，请重试', true);
    };
    reader.readAsDataURL(file);
  }

  function updateScanProgress(p) {
    setScanStatus('<span class="spin"></span><span>正在加载识别模型 ' + Math.round(p * 100) + '%…</span>', false);
  }

  function doOcr(img) {
    setScanStatus('<span class="spin"></span><span>正在加载识别模型…</span>', false);
    OCR.init(updateScanProgress).then(function () {
      setScanStatus('<span class="spin"></span><span>正在识别文字…</span>', false);
      return OCR.recognize(img, function () {}, { debug: false });
    }).then(function (res) {
      finishScan(res.text || '', res);
    }).catch(function (err) {
      scanning = false;
      setScanStatus('⚠️ 识别失败：' + esc(err && err.message ? err.message : '未知错误'), true);
    });
  }

  function finishScan(text) {
    scanning = false;
    if (!text || !text.trim()) {
      setScanStatus('⚠️ 未识别到文字，请对准说明书、避免反光后重试', true);
      return;
    }
    var s = Store.getSettings();
    var p;
    if (s.llmEnabled && s.llmBaseUrl && s.llmApiKey) {
      setScanStatus('<span class="spin"></span><span>正在用 AI 整理用药信息…</span>', false);
      p = Parser.extractWithLLM(text, { baseUrl: s.llmBaseUrl, model: s.llmModel, apiKey: s.llmApiKey })
        .catch(function () {
          // AI 失败自动降级为本机规则解析
          return Object.assign(Parser.extract(text), { source: 'regex' });
        });
    } else {
      p = Promise.resolve(Parser.extract(text));
    }
    p.then(function (fields) {
      renderScanResult(text, fields);
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderScanResult(text, fields) {
    var result = document.getElementById('scan-result');
    var box = document.getElementById('scan-status');
    box.style.display = 'none';

    // 回填为草稿，仅当对应字段被解析出来；名称缺失时保留原输入并提示
    var fName = document.getElementById('f-name');
    if (fields.name && fName) fName.value = fields.name;
    if (fields.dosePerTime) document.getElementById('f-dose').value = fields.dosePerTime;
    if (fields.doseUnit) document.getElementById('f-unit').value = fields.doseUnit;
    if (fields.timesPerDay) document.getElementById('f-times').value = fields.timesPerDay;
    if (fields.durationDays) document.getElementById('f-duration').value = fields.durationDays;
    if (fields.instructions) document.getElementById('f-instructions').value = fields.instructions;

    var sourceLabel = fields.source === 'llm' ? 'AI 解析' : '本机规则解析';
    var html = '<div class="sr-title">✅ 已识别，请核对后再点下方「保存」</div>';
    if (!fields.name) {
      html += '<div class="sr-line" style="color:#c0392b">⚠️ 未能识别药品名称，请手动填写名称</div>';
    } else {
      html += '<div class="sr-line"><strong>药品：</strong>' + esc(fields.name) + '</div>';
    }
    html += '<div class="sr-line"><strong>用量：</strong>'
      + esc((fields.dosePerTime != null ? fields.dosePerTime : '？') + (fields.doseUnit || ''))
      + ' · <strong>每日</strong> ' + esc(fields.timesPerDay != null ? fields.timesPerDay : '？') + ' 次'
      + ' · <strong>疗程</strong> ' + esc(fields.durationDays != null ? fields.durationDays : '？') + ' 天</div>';
    if (fields.instructions) {
      html += '<div class="sr-line"><strong>备注：</strong>' + esc(fields.instructions) + '</div>';
    }
    html += '<div class="sr-line" style="color:#8e8e93">来源：' + sourceLabel
      + ' · 置信度：' + esc(fields.confidence) + '</div>'
      + '<div class="sr-raw">' + esc(text) + '</div>'
      + '<div class="sr-note">字段已自动填入上方表单（仅草稿）。请确认药品名称、用量与次数无误后点「保存」；识别有误可点「重新拍摄/选择」再试。</div>';
    result.innerHTML = html;
    result.style.display = 'block';
  }

  // ── 数据备份（导出 / 导入）────────────────────────────────────────────────
  function doExport() {
    var payload = Store.exportData();
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'med-reminder-备份-' + Utils.today() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function bindImportInput() {
    var input = document.getElementById('import-input');
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        var obj;
        try {
          obj = JSON.parse(e.target.result);
        } catch (err) {
          alert('导入失败：文件不是有效的 JSON');
          return;
        }
        var out = Store.importData(obj);
        if (!out.ok) {
          alert('导入失败：' + (out.message || '文件格式不正确'));
          return;
        }
        alert('导入完成：' + out.counts.meds + ' 个药品、' + out.counts.batches
          + ' 个库存批次、' + out.counts.logs + ' 条打卡记录');
        renderView(currentView);
        scheduleTodayNotifications();
      };
      reader.readAsText(file);
    });
  }

  // ── 本地服药通知（仅 Android/iOS 原生环境生效）──────────────────────────────
  function isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }

  // logId → 稳定数字通知 id（重新调度同一任务时覆盖旧通知，避免重复提醒）
  function notifId(logId) {
    var h = 0;
    for (var i = 0; i < logId.length; i++) h = (h * 31 + logId.charCodeAt(i)) % 1000000007;
    return Math.abs(h) % 2000000000 + 1;
  }

  function localNotifications() {
    if (!isNative()) return null;
    var LN = window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
    return LN || null;
  }

  // 某一次既已到点服药：只取消它的那条通知，不再全家重排
  function cancelLogNotification(logId) {
    var LN = localNotifications();
    if (!LN) return;
    LN.cancel({ notifications: [{ id: notifId(logId) }] }).catch(function () {});
  }

  function scheduleTodayNotifications() {
    var LN = localNotifications();
    if (!LN) return;
    var s = Store.getSettings();
    LN.requestPermissions().then(function (perm) {
      if (!perm || !perm.display) return;
      // 权限弹窗等待期间可能已过点：这里重新取当前时间，避免把已过时间排进去
      // （若排进去，Android 会立刻弹出"到点"通知，正是之前"打卡后还收到通知"的来源）
      var now = Date.now();
      var meds = Store.getMeds();
      var activeIds = {};
      meds.forEach(function (m) { if (m.status === 'active') activeIds[m.id] = m; });
      var list = [];
      Store.getLogs().forEach(function (l) {
        if (l.status === 'taken') return;
        var med = activeIds[l.medicationId];
        if (!med) return;
        var when = new Date(l.scheduledDate + 'T' + l.scheduledTime + ':00');
        if (when.getTime() <= now) return;
        if (list.length >= 30) return;
        list.push({
          id: notifId(l.id),
          title: '💊 该吃药了',
          body: med.name + ' · ' + med.dosePerTime + med.doseUnit + (med.instructions ? '（' + med.instructions + '）' : ''),
          schedule: { at: when },
          extra: { logId: l.id }
        });
      });
      // 先取消旧通知再按最新任务调度，避免重复/过期提醒残留
      LN.getPending().then(function (pending) {
        var old = (pending && pending.notifications || []).map(function (n) { return { id: n.id }; });
        var cancelPromise = old.length ? LN.cancel({ notifications: old }) : Promise.resolve();
        return cancelPromise.then(function () {
          if (!list.length) return;
          return LN.schedule({ notifications: list });
        });
      });
    }).catch(function () { /* 权限被拒或不可用：静默降级为应用内展示 */ });
  }

  // ── Photo input ────────────────────────────────────────────────────────────
  function bindPhotoInput() {
    var input = document.getElementById('photo-input');
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        photoDataUrl = e.target.result;
        document.getElementById('photo-preview-img').src = photoDataUrl;
        document.getElementById('photo-preview-img').style.display = 'block';
        document.getElementById('photo-placeholder').style.display = 'none';
      };
      reader.readAsDataURL(file);
    });
  }

  // ── Overlay tap-outside close ──────────────────────────────────────────────
  function bindOverlays() {
    document.querySelectorAll('.overlay').forEach(function (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) overlay.classList.remove('open');
      });
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  // 今日/日历中单个服药任务的时间修改（input[type=time] 变更即保存）。
  // 只改这一条日志，不影响药品的默认时间表；改完重新渲染并按新时间重排通知。
  function handleDoseTimeChange(e) {
    var input = e.target;
    if (!input || !input.classList.contains('dose-time-input')) return;
    var logId = input.getAttribute('data-log-id');
    var v = input.value;
    if (!logId || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return;
    var log = Store.getLog(logId);
    if (!log || log.scheduledTime === v) return;
    Store.updateLog(logId, { scheduledTime: v });
    renderView(currentView);
    if (Store.getSettings().notifyEnabled) scheduleTodayNotifications();
  }

  function init() {
    document.addEventListener('click', handleClick);
    document.addEventListener('change', handleDoseTimeChange);
    bindPhotoInput();
    bindOverlays();
    bindScanInput();
    bindImportInput();
    var llmToggle = document.getElementById('setting-llm');
    if (llmToggle) llmToggle.addEventListener('change', toggleLlmFields);
    var llmPreset = document.getElementById('setting-llm-preset');
    if (llmPreset) llmPreset.addEventListener('change', function () { applyLlmPreset(llmPreset.value); });

    // 设置改动即保存（不再需要先按保存按钮），通知开关变化则重新排通知
    ['setting-stock-warn', 'setting-expiry-warn', 'setting-notify', 'setting-llm',
     'setting-llm-baseurl', 'setting-llm-model', 'setting-llm-key'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', function () {
        persistSettings(id === 'setting-notify' || id === 'setting-stock-warn' || id === 'setting-expiry-warn');
      });
    });

    // 每日次数变化 → 重建服药时间列表（保留已有值，缺的用默认补）
    var timesCount = document.getElementById('f-times');
    if (timesCount) timesCount.addEventListener('change', rebuildTimesList);

    showView('today');
    preloadOcr(); // 启动即加载识别引擎，拍照时无需等待
    scheduleTodayNotifications();
  }

  return { init: init };
})();

document.addEventListener('DOMContentLoaded', function () {
  App.init();
});
