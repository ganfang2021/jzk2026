// 急诊科预检分诊信息系统 - 主应用文件
const userManager = require('./utils/userManager.js');
const cloudStorage = require('./utils/cloudStorageManager.js');
const localStorage = require('./utils/localStorage.js');
const eventBus = require('./utils/eventBus.js');

const config = require('./config.js');

App({
  globalData: {
    patients: [],
    lastSyncTime: null,
    diagnoses: [],
    currentUser: null,
    cloudEnabled: false     // 云存储是否可用
  },

  onLaunch: function() {
    console.log('急诊科预检分诊信息系统启动');

    // 检测版本升级，保护本地数据
    this.checkVersionUpgrade();

    // 初始化云开发环境
    if (wx.cloud) {
      wx.cloud.init({
        env: config.cloud.env || wx.cloud.DYNAMIC_CURRENT_ENV,
        traceUser: true
      });
      console.log('云开发环境初始化成功');

      // 初始化云存储管理器
      this.globalData.cloudEnabled = cloudStorage.init();
    } else {
      console.warn('当前环境不支持云开发');
    }

    // 初始化用户管理器
    userManager.init();
    // 检查登录状态
    this.globalData.currentUser = userManager.getCurrentUser();
    // 清理存储中的重复数据（必须先于加载）
    this.deduplicateStorage();
    // 加载患者数据
    this.loadPatients();
    // 加载诊断数据
    this.loadDiagnoses();
    // 自动从云端同步患者数据（异步，不阻塞启动）
    if (this.globalData.cloudEnabled && this.globalData.currentUser) {
      this.syncFromCloud().catch(function(e) {
        console.warn('自动云同步失败:', e);
      });
    }
  },

  // 应用切入前台时，同步离线队列并检查云端更新
  onShow: function() {
    if (this.globalData.cloudEnabled) {
      this.syncOfflineQueue();
      // 自动从云端拉取更新（限频：每5分钟最多一次）
      var now = Date.now();
      var lastSync = this.globalData._lastAutoSyncTime || 0;
      if (now - lastSync > 300000 && this.globalData.currentUser) {
        this.globalData._lastAutoSyncTime = now;
        this.syncFromCloud().catch(function(e) {
          console.warn('前台云同步失败:', e);
        });
      }
    }
  },

  // 检测版本升级，保护本地数据
  checkVersionUpgrade: function() {
    // 获取小程序当前版本号
    try {
      var appInfo = wx.getAccountInfoSync();
      var currentVersion = (appInfo.miniprogram && appInfo.miniprogram.version) || '1.0.0';

      // 获取上次保存的版本号
      var savedVersion = wx.getStorageSync('app_version');

      console.log('当前版本:', currentVersion, '，上次版本:', savedVersion);

      // 版本升级或首次使用
      if (!savedVersion || savedVersion !== currentVersion) {
        console.log('检测到版本升级或首次使用，执行数据保护措施');

        // 第一步：立即备份所有本地数据（防止升级过程中数据丢失）
        this.backupAllLocalData();

        // 第二步：将本地所有数据标记为待云同步
        this.markAllLocalDataForSync();

        // 第三步：保存当前版本号
        wx.setStorageSync('app_version', currentVersion);

        // 第四步：提示用户
        wx.showModal({
          title: '版本更新提示',
          content: '检测到新版本发布，本地数据已自动备份并开始云同步，请确保网络连接正常。',
          showCancel: false
        });
      }
    } catch (e) {
      console.error('版本检测失败:', e);
    }
  },

  // 备份所有本地数据（版本升级前保护）
  backupAllLocalData: function() {
    try {
      var backupKey = 'emergency_data_backup_' + Date.now();
      var backup = {};

      // 备份用户数据
      var users = wx.getStorageSync('emergency_users');
      if (users) {
        backup.users = users;
      }

      // 备份每个用户的患者数据
      if (users && Array.isArray(users)) {
        for (var i = 0; i < users.length; i++) {
          var userKey = 'emergency_patients_' + users[i].id;
          var patientData = wx.getStorageSync(userKey);
          if (patientData && Array.isArray(patientData)) {
            backup[userKey] = patientData;
          }
        }
      }

      // 保存备份
      wx.setStorageSync(backupKey, backup);

      // 保存备份索引（最多保留3个旧备份）
      var backupIndex = wx.getStorageSync('emergency_backup_index') || [];
      backupIndex.push({ key: backupKey, time: new Date().toISOString() });
      // 只保留最近3个备份
      if (backupIndex.length > 3) {
        var oldBackup = backupIndex.shift();
        try { wx.removeStorageSync(oldBackup.key); } catch(e) {}
      }
      wx.setStorageSync('emergency_backup_index', backupIndex);

      console.log('本地数据备份完成:', backupKey);
    } catch (e) {
      console.error('备份本地数据失败:', e);
    }
  },

  // 标记所有本地数据待云同步
  markAllLocalDataForSync: function() {
    try {
      var users = userManager.getAllUsers();

      // 为每个用户的数据添加待同步标记
      for (var i = 0; i < users.length; i++) {
        var user = users[i];
        var userKey = 'emergency_patients_' + user.id;
        var patients = wx.getStorageSync(userKey);

        if (patients && Array.isArray(patients)) {
          var markedPatients = patients.map(function(p) {
            return Object.assign({}, p, {
              _needsCloudSync: true,
              _localUpdatedAt: p.updatedAt || new Date().toISOString()
            });
          });
          wx.setStorageSync(userKey, markedPatients);
          console.log('标记用户', user.username, '的', markedPatients.length, '条数据待云同步');
        }
      }

      // 设置版本升级标志，触发立即云同步
      wx.setStorageSync('version_upgrade_pending_sync', true);

      // 尝试立即云同步
      this.triggerUrgentSync();
    } catch (e) {
      console.error('标记本地数据失败:', e);
    }
  },

  // 触发紧急云同步（版本升级后）
  triggerUrgentSync: function() {
    if (!this.globalData.cloudEnabled) {
      console.log('云存储未启用，跳过紧急同步');
      return;
    }

    var currentUser = this.getCurrentUser();
    if (!currentUser) {
      console.log('用户未登录，紧急同步等待登录');
      return;
    }

    console.log('开始紧急云同步...');

    if (currentUser.role === 'admin') {
      // 管理员：分组同步
      this.syncAdminDataToCloud();
    } else {
      cloudStorage.batchSyncToCloud(
        this.globalData.patients,
        currentUser.userId
      ).then(result => {
        console.log('紧急云同步完成:', result);
        if (result.success > 0) {
          this.clearPendingSyncFlag();
        }
      }).catch(err => {
        console.error('紧急云同步失败:', err);
      });
    }
  },

  // 清除待同步标记
  clearPendingSyncFlag: function() {
    try {
      var users = userManager.getAllUsers();

      for (var i = 0; i < users.length; i++) {
        var user = users[i];
        var userKey = 'emergency_patients_' + user.id;
        var patients = wx.getStorageSync(userKey);

        if (patients && Array.isArray(patients)) {
          var clearedPatients = patients.map(function(p) {
            var newP = Object.assign({}, p);
            delete newP._needsCloudSync;
            delete newP._localUpdatedAt;
            return newP;
          });
          wx.setStorageSync(userKey, clearedPatients);
        }
      }

      wx.removeStorageSync('version_upgrade_pending_sync');
      console.log('待同步标记已清除');
    } catch (e) {
      console.error('清除待同步标记失败:', e);
    }
  },

  // 检查登录状态
  checkLogin: function() {
    var currentUser = userManager.getCurrentUser();
    if (!currentUser) {
      wx.navigateTo({
        url: '/pages/login/login'
      });
      return false;
    }
    this.globalData.currentUser = currentUser;
    return true;
  },

  // 获取当前用户
  getCurrentUser: function() {
    // 确保获取最新登录状态
    if (!this.globalData.currentUser) {
      this.globalData.currentUser = userManager.getCurrentUser();
    }
    return this.globalData.currentUser || userManager.getCurrentUser();
  },

  // 用户登出
  logout: function() {
    userManager.logout();
    this.globalData.currentUser = null;
    this.globalData.patients = [];
    // 清理全局患者数据缓存
    wx.removeStorageSync('emergency_patients_cache');
    wx.navigateTo({
      url: '/pages/login/login'
    });
  },

  // 加载诊断数据
  loadDiagnoses: function() {
    try {
      var diagnoses = require('./diagnoses.js');
      this.globalData.diagnoses = diagnoses;
      console.log('加载诊断数据:', diagnoses.length, '条');
    } catch (e) {
      console.error('加载诊断数据失败:', e);
      this.globalData.diagnoses = [];
    }
  },

  // 加载患者数据（按当前用户隔离，非管理员只能看到自己创建的数据）
  loadPatients: function() {
    try {
      var currentUser = this.getCurrentUser();
      if (!currentUser) {
        this.globalData.patients = [];
        return;
      }

      // 强制从本地存储重新读取
      var allPatients = localStorage.getAllPatients();

      // 按当前用户过滤数据：管理员可见所有，普通用户只能看到自己创建的
      if (currentUser.role === 'admin') {
        this.globalData.patients = allPatients;
      } else {
        var filtered = [];
        for (var i = 0; i < allPatients.length; i++) {
          if (allPatients[i].createdBy === currentUser.userId) {
            filtered.push(allPatients[i]);
          }
        }
        this.globalData.patients = filtered;
      }
      console.log('[loadPatients] 重新加载患者数据，当前用户:', currentUser.username, '| 总数:', this.globalData.patients.length);
    } catch (e) {
      console.error('加载数据失败:', e);
      this.globalData.patients = [];
    }
  },

  // 检查用户是否有权编辑指定患者
  canEditPatient: function(patient) {
    var currentUser = this.getCurrentUser();
    if (!currentUser) return false;

    // 管理员可以编辑所有患者
    if (currentUser.role === 'admin') return true;

    // 普通用户只能编辑自己创建的患者
    return patient.createdBy === currentUser.userId;
  },

  // 获取所有用户的患者数据
  getAllUsersPatients: function() {
    return localStorage.getAllPatients();
  },

  // 清理存储中跨键重复的患者数据
  deduplicateStorage: function() {
    try {
      var users = userManager.getAllUsers();
      var totalRemoved = 0;

      // 第一步：逐用户键内去重（每个用户存储中同一ID只保留最新版本）
      for (var i = 0; i < users.length; i++) {
        var uid = users[i].id;
        var patients = localStorage.getUserPatients(uid);
        if (!patients || patients.length === 0) continue;

        // 同键内去重：以 id 为主键，_id 作为辅助键（同一 id 只保留一条）
        var seen = {};
        var deduped = [];
        for (var j = 0; j < patients.length; j++) {
          var p = patients[j];
          var pid = p.id || p._id;
          if (!pid) continue;
          var pTime = new Date(p.updatedAt || p.createdAt || 0).getTime();
          if (!seen[pid] || pTime > seen[pid].time) {
            seen[pid] = { patient: p, time: pTime };
          }
        }
        for (var sid in seen) {
          var p2 = Object.assign({}, seen[sid].patient);
          // 清理 _id 残留，统一以 id 为主
          if (p2._id && p2._id !== p2.id) delete p2._id;
          deduped.push(p2);
        }
        if (deduped.length < patients.length) {
          console.log('用户', uid, '去重:', patients.length, '->', deduped.length);
          localStorage.setUserPatients(uid, deduped);
          totalRemoved += (patients.length - deduped.length);
        }
      }

      // 第二步：全局跨键去重（同一患者 ID 只保留在创建者名下）
      var allPatients = [];
      for (var k = 0; k < users.length; k++) {
        var pts = localStorage.getUserPatients(users[k].id);
        for (var m = 0; m < pts.length; m++) {
          allPatients.push({
            patient: pts[m],
            uid: users[k].id,
            key: localStorage.getUserKey(users[k].id)
          });
        }
      }

      var globalMap = {};
      for (var n = 0; n < allPatients.length; n++) {
        var item = allPatients[n];
        var pid = item.patient.id || item.patient._id;
        if (!pid) continue;
        var pTime = new Date(item.patient.updatedAt || item.patient.createdAt || 0).getTime();
        if (!globalMap[pid] || pTime > globalMap[pid].time) {
          globalMap[pid] = {
            uid: item.uid,
            key: item.key,
            time: pTime,
            patient: item.patient
          };
        }
      }

      // 移除不应该在其他用户键中的患者（同名但创建者不同的情况）
      for (var gpid in globalMap) {
        var owner = globalMap[gpid];
        for (var x = 0; x < users.length; x++) {
          var uidX = users[x].id;
          if (uidX === owner.uid) continue;
          var ptsX = localStorage.getUserPatients(uidX);
          var changed = false;
          var newPts = ptsX.filter(function(p) {
            var ppid = p.id || p._id;
            if (ppid === gpid) {
              changed = true;
              return false; // 删除（应归属到 owner 用户）
            }
            return true;
          });
          if (changed) {
            totalRemoved++;
            localStorage.setUserPatients(uidX, newPts);
          }
        }
      }

      if (totalRemoved > 0) {
        console.log('存储去重完成，共移除', totalRemoved, '条冗余记录');
      } else {
        console.log('存储去重检查完成，无重复数据');
      }
    } catch (e) {
      console.error('存储去重失败:', e);
    }
  },

  // 保存患者数据（支持用户数据隔离 + 自动云同步 + 离线队列）
  savePatients: function() {
    try {
      var currentUser = this.getCurrentUser();
      if (!currentUser) {
        console.error('未登录，无法保存数据');
        return;
      }

      // 按创建者分组保存到各自的用户键下，避免admin用户数据混乱
      var groups = {};
      for (var i = 0; i < this.globalData.patients.length; i++) {
        var p = this.globalData.patients[i];
        var uid = p.createdBy || currentUser.userId;
        if (!groups[uid]) groups[uid] = [];
        groups[uid].push(p);
      }
      for (var uid in groups) {
        localStorage.setUserPatients(uid, groups[uid]);
      }

      this.globalData.lastSyncTime = new Date().toISOString();

      // 异步同步到云端
      this.syncToCloud();
    } catch (e) {
      console.error('保存数据失败:', e);
    }
  },

  // 同步数据到云端（集成离线队列，支持按用户分组同步）
  syncToCloud: function() {
    if (!this.globalData.cloudEnabled) {
      console.log('云存储未启用，跳过同步');
      return;
    }

    var currentUser = this.getCurrentUser();
    if (!currentUser) {
      return;
    }

    // 异步同步，不阻塞主流程
    setTimeout(() => {
      console.log('开始同步数据到云端...');

      if (currentUser.role === 'admin') {
        // 管理员模式：按 createdBy 分组同步，确保每个患者的 userId 正确
        this.syncAdminDataToCloud();
      } else {
        // 普通用户：只同步自己创建的数据
        var self = this;
        var myPatients = this.globalData.patients.filter(function(p) {
          return p.createdBy === currentUser.userId;
        });
        if (myPatients.length === 0) return;
        cloudStorage.batchSyncToCloud(
          myPatients,
          currentUser.userId
        ).then(function(result) {
          if (result.success > 0) {
            console.log('云同步成功:', result.success, '条');
          }
          if (result.failed > 0) {
            console.warn('云同步失败:', result.failed, '条');
            self.addToOfflineQueue('SYNC', {
              patients: myPatients,
              userId: currentUser.userId
            });
          }
        }).catch(function(err) {
          console.error('云同步出错:', err);
          self.addToOfflineQueue('SYNC', {
            patients: myPatients,
            userId: currentUser.userId
          });
        });
      }
    }, 100);
  },

  // 管理员模式：按 createdBy 分组同步到云端
  syncAdminDataToCloud: function() {
    var patients = this.globalData.patients;
    var groups = {};

    // 按 createdBy 分组
    for (var i = 0; i < patients.length; i++) {
      var p = patients[i];
      var uid = p.createdBy || 'unknown';
      if (!groups[uid]) {
        groups[uid] = [];
      }
      groups[uid].push(p);
    }

    var self = this;
    // 逐组同步
    for (var uid in groups) {
      (function(userId, userPatients) {
        cloudStorage.batchSyncToCloud(userPatients, userId)
          .then(function(result) {
            if (result.success > 0) {
              console.log('用户', userId, '云同步成功:', result.success, '条');
            }
            if (result.failed > 0) {
              self.addToOfflineQueue('SYNC', {
                patients: userPatients,
                userId: userId
              });
            }
          })
          .catch(function(err) {
            console.error('用户', userId, '云同步出错:', err);
            self.addToOfflineQueue('SYNC', {
              patients: userPatients,
              userId: userId
            });
          });
      })(uid, groups[uid]);
    }
  },

  // 添加操作到离线队列
  addToOfflineQueue: function(type, data) {
    try {
      var queue = wx.getStorageSync('offline_queue') || [];
      queue.push({
        type: type,
        data: data,
        timestamp: Date.now(),
        id: 'op_' + Date.now() + Math.random().toString(36).slice(2, 8)
      });
      wx.setStorageSync('offline_queue', queue);
      console.log('操作已添加到离线队列，当前队列长度:', queue.length);
    } catch (e) {
      console.error('添加离线队列失败:', e);
    }
  },

  // 同步离线队列
  syncOfflineQueue: function() {
    var self = this;
    var queue = wx.getStorageSync('offline_queue') || [];
    if (queue.length === 0) {
      console.log('离线队列为空，无需同步');
      return Promise.resolve({ success: 0, failed: 0 });
    }

    console.log('开始同步离线队列，队列长度:', queue.length);
    var results = { success: 0, failed: 0 };
    var newQueue = [];

    return new Promise(function(resolve) {
      var processNext = function(index) {
        if (index >= queue.length) {
          wx.setStorageSync('offline_queue', newQueue);
          console.log('离线队列同步完成，成功:', results.success, '失败:', results.failed);
          resolve(results);
          return;
        }

        var op = queue[index];
        if (op.type === 'SYNC') {
          cloudStorage.batchSyncToCloud(op.data.patients, op.data.userId)
            .then(function(result) {
              if (result.failed === 0) {
                results.success++;
              } else {
                newQueue.push(op);
                results.failed++;
              }
              processNext(index + 1);
            })
            .catch(function(err) {
              newQueue.push(op);
              results.failed++;
              processNext(index + 1);
            });
        } else {
          processNext(index + 1);
        }
      };

      processNext(0);
    });
  },

  // 获取所有患者（从本地存储）
  getAllPatients: function() {
    return this.globalData.patients || [];
  },

  // 添加患者（立即云同步）
  addPatient: function(patient) {
    var currentUser = this.getCurrentUser();
    if (!currentUser) {
      throw new Error('请先登录');
    }

    patient.id = 'WX' + Date.now() + Math.random().toString(36).slice(2, 11);
    patient.createdAt = new Date().toISOString();
    patient.updatedAt = new Date().toISOString();
    patient.createdBy = currentUser.userId;
    patient.createdByName = currentUser.nickname || currentUser.username;

    this.globalData.patients.unshift(patient);
    this.savePatients();

    // 立即同步到云端（不等待savePatients中的异步同步）
    this.syncPatientToCloudImmediate(patient, currentUser.userId);

    return patient;
  },

  // 立即同步单个患者到云端
  syncPatientToCloudImmediate: function(patient, userId) {
    if (!this.globalData.cloudEnabled) {
      console.log('云存储未启用，跳过立即同步');
      return;
    }

    cloudStorage.syncPatientToCloud(patient, userId).then(result => {
      if (result.success) {
        console.log('立即云同步成功:', patient.id);
        // 更新本地数据的同步哈希
        if (result.hash) {
          patient._syncHash = result.hash;
          this.syncHashToLocal(patient);
        }
      } else {
        console.warn('立即云同步失败，添加到离线队列:', patient.id);
        this.addToOfflineQueue('SYNC', {
          patients: [patient],
          userId: userId
        });
      }
    }).catch(err => {
      console.error('立即云同步异常:', err);
      this.addToOfflineQueue('SYNC', {
        patients: [patient],
        userId: userId
      });
    });
  },

  // 从云端拉取患者数据并合并到本地（所有用户）
  syncFromCloud: async function() {
    if (!this.globalData.cloudEnabled) {
      console.log('[syncFromCloud] 云存储未启用');
      return { success: false, message: '云存储未启用' };
    }
    var currentUser = this.getCurrentUser();
    if (!currentUser) {
      return { success: false, message: '请先登录' };
    }

    try {
      console.log('[syncFromCloud] 开始同步，云端加载中...');
      // 加载所有用户的云端数据（用于统计和去重）
      var cloudPatients = await cloudStorage.loadPatientsFromCloud(null, true);
      console.log('[syncFromCloud] 云端返回患者数:', cloudPatients ? cloudPatients.length : 0);
      if (!cloudPatients || cloudPatients.length === 0) {
        console.log('[syncFromCloud] 云端暂无患者数据');
        return { success: true, synced: 0, added: 0, updated: 0, message: '云端暂无患者数据' };
      }

      console.log('[syncFromCloud] 开始合并到本地...');
      var result = this.mergeCloudToLocal(cloudPatients);
      console.log('[syncFromCloud] 合并结果: added=', result.added, 'updated=', result.updated);
      // 云同步合并后执行去重，确保数据一致
      this.deduplicateStorage();
      this.loadPatients();
      return { success: true, synced: result.added + result.updated, added: result.added, updated: result.updated, message: '' };
    } catch (e) {
      console.error('[syncFromCloud] 从云端同步失败:', e);
      return { success: false, message: '同步失败: ' + (e.message || '网络错误') };
    }
  },

  // 将云端数据合并到本地存储（全局去重 + 跨用户去重）
  mergeCloudToLocal: function(cloudPatients) {
    var result = { added: 0, updated: 0 };

    // 第一步：全局云端数据去重（按 id 保留最新版本）
    var globalCloudMap = {};
    for (var i = 0; i < cloudPatients.length; i++) {
      var cp = cloudPatients[i];
      var pid = cp.id || cp._id;
      if (!pid) continue;
      var cpTime = new Date(cp.updatedAt || cp.createdAt || 0).getTime();
      if (!globalCloudMap[pid] || cpTime > globalCloudMap[pid].time) {
        globalCloudMap[pid] = { patient: cp, time: cpTime };
      }
    }
    console.log('[mergeCloudToLocal] 全局去重后患者数:', Object.keys(globalCloudMap).length);

    // 获取所有本地用户用于匹配
    var localUsers = userManager.getAllUsers();
    var localUserIds = {};
    var localUsernames = {};
    for (var ui = 0; ui < localUsers.length; ui++) {
      localUserIds[localUsers[ui].id] = localUsers[ui].id;
      localUsernames[localUsers[ui].username] = localUsers[ui].id;
    }

    // 获取当前登录用户
    var currentUser = this.getCurrentUser();
    var isAdmin = currentUser && currentUser.role === 'admin';
    console.log('[mergeCloudToLocal] 当前登录用户:', currentUser ? currentUser.userId : 'null', '| isAdmin:', isAdmin);

    // 第二步：按 userId 分组（每个患者只归属其 createdBy 对应的用户）
    var groups = {};
    for (var gid in globalCloudMap) {
      var patient = globalCloudMap[gid].patient;
      var uid = patient.createdBy || patient.userId;
      if (!uid) {
        console.log('[mergeCloudToLocal] 跳过无归属信息的数据:', gid);
        continue;
      }

      // 如果 uid 不是本地有效用户，尝试匹配
      if (!localUserIds[uid]) {
        var matched = false;
        for (var mi = 0; mi < localUsers.length; mi++) {
          if (localUsers[mi].username === uid ||
              localUsers[mi].nickname === uid ||
              patient.userId === localUsers[mi].id) {
            uid = localUsers[mi].id;
            patient.createdBy = uid;
            matched = true;
            break;
          }
        }
        if (!matched) {
          // 无法匹配，admin用户跳过该数据，普通用户使用当前用户ID
          if (!isAdmin) {
            uid = currentUser.userId;
            patient.createdBy = currentUser.userId;
            console.log('[mergeCloudToLocal] 非admin用户，使用当前用户ID作为归属:', currentUser.userId);
          } else {
            console.log('[mergeCloudToLocal] admin跳过无法匹配的数据:', gid, '| uid:', uid);
            continue;
          }
        }
      }

      if (!groups[uid]) groups[uid] = [];
      groups[uid].push(patient);
    }
    console.log('[mergeCloudToLocal] 分组数:', Object.keys(groups).length, '| 组:', Object.keys(groups));

    // 第三步：逐用户合并到本地
    for (var uid in groups) {
      var localPatients = localStorage.getUserPatients(uid);
      var localMap = {};
      for (var j = 0; j < localPatients.length; j++) {
        var lp = localPatients[j];
        var lpid = lp.id || lp._id;
        if (!lpid) continue;
        // 深拷贝，避免修改原始对象
        localMap[lpid] = Object.assign({}, lp);
      }

      for (var k = 0; k < groups[uid].length; k++) {
        var cloudP = groups[uid][k];
        var pid = cloudP.id || cloudP._id;
        if (!pid) continue;

        var localP = localMap[pid];
        if (localP) {
          var cloudTime = new Date(cloudP.updatedAt || 0).getTime();
          var localTime = new Date(localP.updatedAt || 0).getTime();
          if (cloudTime > localTime) {
            var merged = Object.assign({}, localP, cloudP);
            merged.id = pid;
            merged.createdBy = uid;
            delete merged._id;
            // 清理云端系统字段
            delete merged._openid;
            delete merged._unionid;
            localMap[pid] = merged;
            result.updated++;
          }
        } else {
          var newP = Object.assign({}, cloudP);
          newP.id = pid;
          delete newP._id;
          delete newP._openid;
          delete newP._unionid;
          if (!newP.createdBy) newP.createdBy = uid;
          localMap[pid] = newP;
          result.added++;
        }
      }

      var mergedArray = [];
      for (var mid in localMap) {
        mergedArray.push(localMap[mid]);
      }
      localStorage.setUserPatients(uid, mergedArray);
    }

    return result;
  },

  // 将同步哈希写回本地存储
  syncHashToLocal: function(patient) {
    try {
      var userId = patient.createdBy || (this.getCurrentUser() && this.getCurrentUser().userId);
      if (!userId) return;
      var patients = localStorage.getUserPatients(userId);
      for (var i = 0; i < patients.length; i++) {
        if (patients[i].id === patient.id) {
          patients[i]._syncHash = patient._syncHash;
          localStorage.setUserPatients(userId, patients);
          break;
        }
      }
    } catch (e) {
      console.error('保存同步哈希失败:', e);
    }
  },

  // 更新患者（立即云同步）
  updatePatient: function(id, data) {
    return new Promise((resolve, reject) => {
      try {
        var index = this.globalData.patients.findIndex(function(p) {
          return p.id === id;
        });
        if (index !== -1) {
          var updatedPatient = Object.assign({}, this.globalData.patients[index], data, {
            updatedAt: new Date().toISOString()
          });
          this.globalData.patients[index] = updatedPatient;
          this.savePatients();

          // 立即同步到云端
          var currentUser = this.getCurrentUser();
          this.syncPatientToCloudImmediate(updatedPatient, currentUser.userId);

          resolve(updatedPatient);
        } else {
          reject(new Error('患者不存在'));
        }
      } catch (e) {
        reject(e);
      }
    });
  },

  // 删除患者
  deletePatient: function(id) {
    var index = this.globalData.patients.findIndex(function(p) {
      return p.id === id;
    });
    if (index !== -1) {
      this.globalData.patients.splice(index, 1);
      this.savePatients();

      // 异步从云端删除
      if (this.globalData.cloudEnabled) {
        cloudStorage.deletePatientFromCloud(id).then(result => {
          if (result.success) {
            console.log('云端删除成功:', id);
          }
        }).catch(err => {
          console.error('云端删除失败:', err);
        });
      }

      return true;
    }
    return false;
  },

  // 根据时间筛选
  getTimeFilter: function(period) {
    var now = new Date();
    var startDate;
    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case 'all':
        return null;
      default:
        return null;
    }
    return startDate;
  },

  // 按时间段筛选患者
  filterPatientsByPeriod: function(patients, period) {
    var startDate = this.getTimeFilter(period);
    if (!startDate) return patients;
    return patients.filter(function(p) {
      if (!p.createdAt) return false;
      return new Date(p.createdAt) >= startDate;
    });
  },

  // 安全解析日期字符串（兼容 yyyy-MM-dd HH:mm 和 ISO 格式）
  _parseDateTime: function(dateStr) {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? null : dateStr;
    var d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
    // 回退：手动解析（T分隔或空格分隔）
    var str = String(dateStr);
    var sep = str.indexOf('T') !== -1 ? 'T' : ' ';
    var parts = str.split(sep);
    if (parts.length !== 2) return null;
    var dateParts = parts[0].split('-');
    var timeParts = parts[1].split(':');
    if (dateParts.length !== 3 || timeParts.length < 2) return null;
    var result = new Date(
      parseInt(dateParts[0], 10),
      parseInt(dateParts[1], 10) - 1,
      parseInt(dateParts[2], 10),
      parseInt(timeParts[0], 10),
      parseInt(timeParts[1], 10),
      timeParts[2] ? parseInt(timeParts[2], 10) : 0
    );
    return result;
  },

  // 计算中位数（符合用户提供的公式）
  calculateMedian: function(values) {
    if (!values || values.length === 0) return null;
    var sorted = values.slice().sort(function(a, b) {
      return a - b;
    });
    var n = sorted.length;
    if (n % 2 === 1) {
      // n为奇数：中位数 = X((n+1)/2)
      return sorted[Math.floor((n + 1) / 2) - 1];
    } else {
      // n为偶数：中位数 = (X(n/2) + X(n/2+1)) / 2
      var mid1 = sorted[n / 2 - 1];
      var mid2 = sorted[n / 2];
      return (mid1 + mid2) / 2;
    }
  },

  // 计算统计数据
  calculateStats: function(patients) {
    var stats = {
      total: patients.length,
      level1: 0,
      level2: 0,
      level3: 0,
      level4: 0,
      hospitalized: 0,
      rescued: 0,
      surgery: 0,
      severeTrauma: 0,
      severeTraumaSurgery: 0,
      cpr: 0,
      cprSuccess: 0,
      intubated: 0,
      centralLine: 0,
      death: 0,
      cpr48h: 0,
      ivAccess: 0,
      male: 0,
      female: 0,
      cprRate: '0',
      medianStayTime: null,
      medianSurgeryTime: null,
      stayTimes: [],
      surgeryDelayTimes: []
    };

    for (var i = 0; i < patients.length; i++) {
      var p = patients[i];
      if (p.triageLevel === 'Ⅰ') stats.level1++;
      if (p.triageLevel === 'Ⅱ') stats.level2++;
      if (p.triageLevel === 'Ⅲ') stats.level3++;
      if (p.triageLevel === 'Ⅳ') stats.level4++;
      if (p.hospitalized) stats.hospitalized++;
      if (p.rescued) stats.rescued++;
      if (p.surgery) stats.surgery++;
      if (p.severeTrauma) stats.severeTrauma++;
      if (p.cpr) stats.cpr++;
      if (p.cprSuccess) stats.cprSuccess++;
      if (p.intubated) stats.intubated++;
      if (p.centralLine) stats.centralLine++;
      if (p.death) stats.death++;
      if (p.cpr48hCount) stats.cpr48h += p.cpr48hCount;
      if (p.ivAccess) stats.ivAccess++;
      if (p.gender === '男') stats.male++;
      if (p.gender === '女') stats.female++;
      if (p.severeTrauma && p.surgery) stats.severeTraumaSurgery++;

      // 计算抢救室滞留时间（Ⅰ/Ⅱ/Ⅲ级）
      var isTriageLevel123 = ['Ⅰ', 'Ⅱ', 'Ⅲ'].indexOf(p.triageLevel) !== -1;
      if (isTriageLevel123) {
        if (!p.inTime) {
          // 无入科时间，跳过
        } else if (!p.outTime) {
          // 无出科时间，跳过（滞留时间无法计算）
        } else {
          try {
            var inTime = this._parseDateTime(p.inTime);
            var outTime = this._parseDateTime(p.outTime);
            if (inTime && outTime) {
              var stayMinutes = (outTime.getTime() - inTime.getTime()) / (1000 * 60);
              if (stayMinutes > 0 && stayMinutes < 43200) { // 上限30天，过滤异常值
                stats.stayTimes.push(stayMinutes);
              } else {
                console.log('[Stats] 滞留时间异常:', p.name, '入:', p.inTime, '出:', p.outTime, '差值:', stayMinutes, '分钟');
              }
            } else {
              console.log('[Stats] 时间解析失败:', p.name, '入:', p.inTime, '出:', p.outTime);
            }
          } catch (e) {
            console.warn('解析滞留时间失败:', p.id, e);
          }
        }
      }

      // 计算严重创伤手术时间
      if (p.severeTrauma && p.surgery && p.inTime && p.surgeryTime) {
        try {
          var inTime2 = this._parseDateTime(p.inTime);
          var surgeryTime = this._parseDateTime(p.surgeryTime);
          if (inTime2 && surgeryTime) {
            var delayMinutes = (surgeryTime.getTime() - inTime2.getTime()) / (1000 * 60);
            if (delayMinutes > 0 && delayMinutes < 43200) {
              stats.surgeryDelayTimes.push(delayMinutes);
            }
          }
        } catch (e) {
          console.warn('解析手术时间失败:', p.id, e);
        }
      }
    }

    console.log('[Stats] 总患者数:', patients.length, '| Ⅰ级:', stats.level1, 'Ⅱ级:', stats.level2, 'Ⅲ级:', stats.level3, 'Ⅳ级:', stats.level4, '| 有效滞留时间患者:', stats.stayTimes.length, '| 有效手术时间患者:', stats.surgeryDelayTimes.length);

    // 计算复苏成功率
    if (stats.cpr > 0) {
      stats.cprRate = ((stats.cprSuccess / stats.cpr) * 100).toFixed(1);
    }

    // 计算中位数
    stats.medianStayTime = this.calculateMedian(stats.stayTimes);
    stats.medianSurgeryTime = this.calculateMedian(stats.surgeryDelayTimes);
    stats.stayCount = stats.stayTimes.length;
    stats.surgeryDelayCount = stats.surgeryDelayTimes.length;
    // 预计算字符串，避免 WXML 中调用 .toFixed()
    stats.medianStayTimeFmt = stats.medianStayTime !== null ? stats.medianStayTime.toFixed(0) : '--';
    stats.medianSurgeryTimeFmt = stats.medianSurgeryTime !== null ? stats.medianSurgeryTime.toFixed(0) : '--';

    console.log('[Stats] 中位数结果:', '滞留时间中位数=', stats.medianStayTime, '分钟', '| 手术时间中位数=', stats.medianSurgeryTime, '分钟', '| 有效滞留=', stats.stayCount, '人', '| 有效手术=', stats.surgeryDelayCount, '人');

    return stats;
  }
});
