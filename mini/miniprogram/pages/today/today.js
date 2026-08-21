const store = require('../../utils/store');
const date = require('../../utils/date');

const SEGMENTS = [['上午', '☀️'], ['下午', '🌤️'], ['晚上', '🌙']];

Page({
  data: { segments: [], loading: true, dateLabel: '' },

  onShow() {
    this.load();
  },

  load() {
    store.init().then(() => this.render());
  },

  render() {
    const d = date.today();
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
            medName: med.name || '(已删除药品)',
            doseText: (med.dosePerTime || '') + (med.doseUnit || '') +
              (med.instructions ? ' · ' + med.instructions : ''),
            taken: !!(log && log.takenAt),
            takenClock: log && log.takenAt ? date.fmtClock(log.takenAt) : ''
          };
        });
      if (tasks.length) segments.push({ seg: SEGMENTS[i][1] + ' ' + seg, tasks: tasks });
    }
    this.setData({ segments: segments, loading: false, dateLabel: date.formatDate(d) });
  },

  toggleTask(e) {
    const medId = e.currentTarget.dataset.medid;
    const time = e.currentTarget.dataset.time;
    store.takeDose(date.today(), medId, time);
    this.render();
  },

  goTab(e) {
    wx.reLaunch({ url: e.currentTarget.dataset.url });
  }
});