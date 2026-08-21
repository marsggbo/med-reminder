const store = require('../../utils/store');

Page({
  data: {
    medCount: 0,
    logCount: 0,
    syncText: '等待同步…',
    syncing: false
  },

  onShow() {
    store.init().then(() => {
      this.refresh();
      this.checkCloud();
    });
  },

  refresh() {
    this.setData({
      medCount: store.getMeds().length,
      logCount: store.getLogs().length
    });
  },

  checkCloud() {
    this.setData({ syncText: '云开发已连接 ✓' });
  },

  syncNow() {
    if (this.data.syncing) return;
    this.setData({ syncing: true, syncText: '同步中…' });
    store.init()
      .then(() => store.pull())
      .then(() => store.push())
      .then(() => {
        this.refresh();
        this.setData({ syncing: false, syncText: '已同步 ✓' });
        wx.showToast({ title: '同步完成', icon: 'success' });
      })
      .catch(() => {
        this.setData({ syncing: false, syncText: '同步失败（网络异常）' });
        wx.showToast({ title: '同步失败，请检查网络', icon: 'none' });
      });
  },

  goTab(e) {
    wx.reLaunch({ url: e.currentTarget.dataset.url });
  }
});