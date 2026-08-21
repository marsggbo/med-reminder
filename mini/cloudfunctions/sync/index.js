// 云函数 sync：读取/保存当前微信用户的数据文档。
// 集合 meduser，每用户一条记录，_id = openid（数据天然隔离）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COLL = 'meduser';

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, err: 'no openid' };

  if (event.action === 'get') {
    try {
      const res = await db.collection(COLL).doc(OPENID).get();
      return { ok: true, data: res.data && res.data.payload ? res.data.payload : null, syncedAt: res.data.updatedAt };
    } catch (e) {
      // 文档不存在 → 返回空数据
      if (e.errCode === -1 || (e.errMsg && e.errMsg.indexOf('does not exist') !== -1)) {
        return { ok: true, data: null, syncedAt: null };
      }
      return { ok: false, err: e.errMsg || String(e) };
    }
  }

  if (event.action === 'save') {
    const payload = event.payload;
    if (!payload || !Array.isArray(payload.meds) || !Array.isArray(payload.logs)) {
      return { ok: false, err: 'bad payload' };
    }
    const now = Date.now();
    try {
      await db.collection(COLL).doc(OPENID).set({
        data: { payload: payload, updatedAt: now }
      });
      return { ok: true, updatedAt: now };
    } catch (e) {
      return { ok: false, err: e.errMsg || String(e) };
    }
  }

  return { ok: false, err: 'unknown action' };
};