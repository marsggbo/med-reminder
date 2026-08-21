const store = require('../../utils/store');
const date = require('../../utils/date');

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const SEGMENTS = [['上午', '☀️'], ['下午', '🌤️'], ['晚上', '🌙']];

Page({
  data: {
    week: WEEK,
    title: '',
    cells: [],
    selectedDate: '',
    selectedLabel: '',
    segments: []
  },

  onShow() {
    store.init().then(() => {
      const d = this.data.selectedDate || date.today();
      this.renderMonth(d);
    });
  },

  renderMonth(anyDate) {
    const p = anyDate.split('-');
    const year = +p[0], month = +p[1];
    const todayStr = date.today();
    const first = new Date(year, month - 1, 1);
    const startDow = first.getDay(); // 0=周日
    const daysInMonth = new Date(year, month, 0).getDate();
    const meds = store.getMeds();

    const cells = [];
    for (let i = 0; i < 42; i++) {
      const dayNum = i - startDow + 1;
      const d = new Date(year, month - 1, dayNum);
      const dateStr = d.getFullYear() + '-' + date.pad(d.getMonth() + 1) + '-' + date.pad(d.getDate());
      // 该日应服任务数与完成数
      const tasks = store.tasksFor(dateStr).filter(function (t) {
        return meds.some(function (m) { return m.id === t.medId; });
      });
      let done = 0;
      tasks.forEach(function (t) {
        const log = store.getLog(dateStr, t.medId, t.time);
        if (log && log.takenAt) done++;
      });
      const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
      cells.push({
        key: 'c' + i,
        date: dateStr,
        day: inMonth ? dayNum : '',
        done: done,
        total: tasks.length,
        inMonth: inMonth,
        isToday: dateStr === todayStr,
        isSel: dateStr === this.data.selectedDate
      });
    }

    this.setData({
      title: year + '年' + month + '月',
      cells: cells,
      selectedDate: this.data.selectedDate || todayStr
    });
    this.renderDay();
  },

  shiftMonth(e) {
    const off = +e.currentTarget.dataset.off;
    const p = this.data.selectedDate.split('-');
    const d = new Date(+p[0], +p[1] - 1 + off, 1);
    this.setData({ selectedDate: d.getFullYear() + '-' + date.pad(d.getMonth() + 1) + '-' + date.pad(d.getDate()) });
    this.renderMonth(this.data.selectedDate);
  },

  selectDate(e) {
    this.setData({ selectedDate: e.currentTarget.dataset.date });
    this.renderMonth(this.data.selectedDate);
  },

  renderDay() {
    const d = this.data.selectedDate;
    const todayStr = date.today();
    const meds = store.getMeds();
    const medById = {};
    meds.forEach(function (m) { medById[m.id] = m; });

    const segments = [];
    for (let i = 0; i < SEGMENTS.length; i++) {
      const seg = SEGMENTS[i][0];
      const tasks = store.tasksFor(d)
        .filter(function (t) { return date.segmentOfTime(t.time) === seg; })
        .map(function (t) {
          const med = medById[t.medId] || {};
          const log = store.getLog(d, t.medId, t.time);
          return {
            key: t.medId + '_' + t.time,
            medId: t.medId,
            time: t.time,
            medName: med.name || '(?',
            doseText: (med.dosePerTime || '') + (med.doseUnit || '') +
              (med.instructions ? ' · ' + med.instructions : ''),
            taken: !!(log && log.takenAt),
            takenClock: log && log.takenAt ? date.fmtClock(log.takenAt) : '',
            isPast: d < todayStr
          };
        });
      if (tasks.length) segments.push({ seg: SEGMENTS[i][1] + ' ' + seg, tasks: tasks });
    }
    this.setData({
      selectedLabel: date.formatDate(d) + (d === todayStr ? '（今天）' : ''),
      segments: segments
    });
  },

  toggleTask(e) {
    const medId = e.currentTarget.dataset.medid;
    const time = e.currentTarget.dataset.time;
    store.takeDose(this.data.selectedDate, medId, time);
    this.renderMonth(this.data.selectedDate);
  },

  goTab(e) {
    wx.reLaunch({ url: e.currentTarget.dataset.url });
  }
});