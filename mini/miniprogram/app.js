App({
  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({
        title: '提示',
        content: '当前微信版本过低，无法使用云开发能力，请升级微信后重试。',
        showCancel: false
      });
      return;
    }
    const config = require('./utils/config');
    wx.cloud.init({
      env: config.ENV_ID || undefined,
      traceUser: true
    });
    require('./utils/store').init();
  }
});