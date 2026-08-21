const store = require('../../utils/store');
const date = require('../../utils/date');

const TIMES_RANGE = ['1', '2', '3', '4', '5', '6'];
// 按次数给出默认服药时间（与 Web 版一致：9:00 / 13:00 / 18:00）
const DEFAULT_TIMES = {
  '1': ['09:00'],
  '2': ['09:00', '18:00'],
  '3': ['09:00', '13:00', '18:00'],
  '4': ['08:00', '12:00', '16:00', '20:00'],
  '5': ['08:00', '11:00', '14:00', '17:00', '20:00'],
  '6': ['08:00', '10:30', '13:00', '15:30', '18:00', '20:30']
};

function emptyForm() {
  const t = date.today();
  return {
    id: '',
    name: '',
    dosePerTime: '1',
    doseUnit: '粒',
    timesPerDay: 3,
    scheduleTimes: DEFAULT_TIMES['3'].slice(),
    startDate: t,
    durationDays: 7,
    instructions: '',
    status: 'active'
  };
}

Page({
  data: {
    meds: [],
    editing: false,
    editingId: '',
    f: emptyForm(),
    timesRange: TIMES_RANGE,
    timesIdx: 2,
    canSave: false
  },

  onShow() {
    store.init().then(() => this.renderList());
  },

  renderList() {
    const meds = store.getMeds()
      .slice()
      .sort(function (a, b) {
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
        return (a.createdAt || 0) - (b.createdAt || 0);
      })
      .map(function (m) {
        m.scheduleTimesText = (m.scheduleTimes || []).join('、');
        return m;
      });
    this.setData({ meds: meds });
  },

  newMed() {
    this.setData({ editing: true, editingId: '', f: emptyForm(), timesIdx: 2 });
  },

  editMed(e) {
    const med = store.getMed(e.currentTarget.dataset.id);
    if (!med) return;
    const timesIdx = TIMES_RANGE.indexOf(String(med.timesPerDay));
    this.setData({
      editing: true,
      editingId: med.id,
      f: {
        id: med.id,
        name: med.name,
        dosePerTime: String(med.dosePerTime || ''),
        doseUnit: med.doseUnit || '',
        timesPerDay: med.timesPerDay,
        scheduleTimes: (med.scheduleTimes || []).slice(),
        startDate: med.startDate || date.today(),
        durationDays: med.durationDays || 7,
        instructions: med.instructions || '',
        status: med.status || 'active'
      },
      timesIdx: timesIdx === -1 ? 2 : timesIdx
    });
  },

  cancelEdit() {
    this.setData({ editing: false, editingId: '' });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const f = this.data.f;
    f[field] = e.detail.value;
    this.setData({ f: f }, () => this.updateCanSave());
  },

  onTimesChange(e) {
    const idx = +e.detail.value;
    const f = this.data.f;
    f.timesPerDay = +TIMES_RANGE[idx];
    // 只补缺的，不覆盖已手动改过的时间
    const defs = DEFAULT_TIMES[TIMES_RANGE[idx]] || [];
    defs.forEach(function (t) {
      if (f.scheduleTimes.indexOf(t) === -1) f.scheduleTimes.push(t);
    });
    this.setData({ f: f, timesIdx: idx });
  },

  onTimeChange(e) {
    const idx = +e.currentTarget.dataset.idx;
    const f = this.data.f;
    f.scheduleTimes[idx] = e.detail.value;
    // 改了次数后排序保持整洁
    f.scheduleTimes = f.scheduleTimes.slice().sort();
    this.setData({ f: f });
  },

  addTime() {
    const f = this.data.f;
    f.scheduleTimes.push('20:00');
    f.scheduleTimes = f.scheduleTimes.slice().sort();
    this.setData({ f: f });
  },

  removeTime(e) {
    const idx = +e.currentTarget.dataset.idx;
    const f = this.data.f;
    if (f.scheduleTimes.length <= 1) {
      wx.showToast({ title: '至少保留一个时间', icon: 'none' });
      return;
    }
    f.scheduleTimes.splice(idx, 1);
    this.setData({ f: f });
  },

  onStartDate(e) {
    const f = this.data.f;
    f.startDate = e.detail.value;
    this.setData({ f: f });
  },

  updateCanSave() {
    const f = this.data.f;
    this.setData({
      canSave: !!(f.name && f.name.trim() && f.scheduleTimes.length > 0)
    });
  },

  saveMed() {
    const f = this.data.f;
    if (!f.name || !f.name.trim()) {
      wx.showToast({ title: '请填写药品名称', icon: 'none' });
      return;
    }
    if (!f.scheduleTimes.length) {
      wx.showToast({ title: '请至少设置一个服药时间', icon: 'none' });
      return;
    }
    f.timesPerDay = f.scheduleTimes.length;
    if (this.data.editingId) {
      store.updateMed(f);
      wx.showToast({ title: '已保存', icon: 'success' });
    } else {
      f.id = date.uid('med_');
      f.createdAt = Date.now();
      store.addMed(f);
      wx.showToast({ title: '已添加', icon: 'success' });
    }
    this.setData({ editing: false, editingId: '' });
    this.renderList();
  },

  toggleStatus() {
    const f = this.data.f;
    f.status = f.status === 'active' ? 'stopped' : 'active';
    store.updateMed(f);
    this.setData({ f: f });
    wx.showToast({
      title: f.status === 'active' ? '已重新启用' : '已停用',
      icon: 'none'
    });
  },

  goTab(e) {
    wx.reLaunch({ url: e.currentTarget.dataset.url });
  }
});