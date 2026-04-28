/**
 * 本地存储管理器 - 统一管理本地数据的读写和键名生成
 * 所有 emergency_patients_* 键的读写都必须通过此模块
 */
var userManager = require('./userManager.js');

var KEY_PREFIX = 'emergency_patients_';

// 生成用户数据存储键
function getUserKey(userId) {
  return KEY_PREFIX + userId;
}

// 读取指定用户的患者数据
function getUserPatients(userId) {
  try {
    var data = wx.getStorageSync(getUserKey(userId));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('读取用户数据失败:', userId, e);
    return [];
  }
}

// 写入指定用户的患者数据
function setUserPatients(userId, patients) {
  try {
    wx.setStorageSync(getUserKey(userId), patients);
    return true;
  } catch (e) {
    console.error('写入用户数据失败:', userId, e);
    return false;
  }
}

// 读取所有用户的患者数据（合并并去重，保留最新版本）
function getAllPatients() {
  var users = userManager.getAllUsers();
  // 使用映射合并多源数据：key = id 或 _id，value = { patient, updatedAt }
  var merged = {};

  for (var i = 0; i < users.length; i++) {
    var patients = getUserPatients(users[i].id);
    for (var j = 0; j < patients.length; j++) {
      var orig = patients[j];
      // 用 id 或 _id 作为合并键（优先用 id）
      var pid = orig.id || orig._id;
      if (!pid) continue;

      // 深拷贝，防止修改原始对象，并补充缺失字段
      var p = Object.assign({}, orig);
      if (!p.createdBy) {
        p.createdBy = users[i].id;
        p.createdByName = users[i].nickname || users[i].username;
      }
      // 清理云端残留的 _id 字段（以 id 为主）
      if (p._id && p._id !== p.id) {
        delete p._id;
      }

      var pTime = new Date(p.updatedAt || p.createdAt || 0).getTime();
      if (!merged[pid] || pTime > merged[pid].time) {
        merged[pid] = { patient: p, time: pTime };
      }
    }
  }

  // 扫描可能的孤立数据键（同上的孤立键处理）
  try {
    var storageInfo = wx.getStorageInfoSync();
    if (storageInfo && storageInfo.keys) {
      for (var k = 0; k < storageInfo.keys.length; k++) {
        var key = storageInfo.keys[k];
        if (key.indexOf(KEY_PREFIX) === 0) {
          var isUserKey = users.some(function(u) { return getUserKey(u.id) === key; });
          if (!isUserKey) {
            var orphanPatients = wx.getStorageSync(key);
            if (orphanPatients && Array.isArray(orphanPatients)) {
              for (var o = 0; o < orphanPatients.length; o++) {
                var op = Object.assign({}, orphanPatients[o]);
                var opid = op.id || op._id;
                if (!opid) continue;
                // 清理 _id 残留
                if (op._id && op._id !== op.id) delete op._id;
                var opTime = new Date(op.updatedAt || op.createdAt || 0).getTime();
                if (!merged[opid] || opTime > merged[opid].time) {
                  merged[opid] = { patient: op, time: opTime };
                }
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('扫描孤立数据失败:', e);
  }

  // 转换回数组（此时 merged 的每个键都是唯一的 id）
  var result = [];
  for (var mid in merged) {
    result.push(merged[mid].patient);
  }

  // 按 createdAt 降序排列
  result.sort(function(a, b) {
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });

  return result;
}

// 将患者列表按 createdBy 分组保存到各用户键下
function saveByCreator(patients, fallbackUserId) {
  var groups = {};
  for (var i = 0; i < patients.length; i++) {
    var uid = patients[i].createdBy || fallbackUserId;
    if (!groups[uid]) groups[uid] = [];
    groups[uid].push(patients[i]);
  }
  for (var uid in groups) {
    setUserPatients(uid, groups[uid]);
  }
}

module.exports = {
  getUserKey: getUserKey,
  getUserPatients: getUserPatients,
  setUserPatients: setUserPatients,
  getAllPatients: getAllPatients,
  saveByCreator: saveByCreator,
  KEY_PREFIX: KEY_PREFIX
};
