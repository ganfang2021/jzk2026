// 云同步管理器 - 支持微信云开发数据同步
const config = require('../config.js');

class CloudSyncManager {
  constructor() {
    this.db = null;
    this.syncTimer = null;
    this.isSyncing = false;
    this.lastSyncTime = null;
    this.isEnabled = false;
  }

  // 初始化云开发
  async init() {
    try {
      if (!wx.cloud) {
        console.log('云开发未初始化,跳过云同步功能');
        this.isEnabled = false;
        return false;
      }

      wx.cloud.init({
        env: config.cloud.env,
        traceUser: true
      });

      this.db = wx.cloud.database();
      this.isEnabled = true;

      console.log('云开发初始化成功');
      return true;
    } catch (e) {
      console.error('云开发初始化失败:', e);
      this.isEnabled = false;
      return false;
    }
  }

  // 启动自动同步
  async startAutoSync(callback) {
    if (!this.isEnabled) {
      console.log('云同步未启用');
      return;
    }

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    this.syncTimer = setInterval(async () => {
      const result = await this.sync();
      if (callback && result) {
        callback(result);
      }
    }, config.cloud.syncInterval);

    console.log('自动同步已启动,间隔:', config.cloud.syncInterval, 'ms');
  }

  // 停止自动同步
  stopAutoSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      console.log('自动同步已停止');
    }
  }

  // 手动同步
  async sync(localPatients, userId) {
    if (!this.isEnabled) {
      console.log('云同步未启用');
      return null;
    }

    if (this.isSyncing) {
      console.log('正在同步中,跳过本次同步');
      return null;
    }

    this.isSyncing = true;
    try {
      console.log('开始同步...');

      // 上传本地修改
      let uploadCount = 0;
      for (const patient of localPatients || []) {
        if (!patient.syncedAt || new Date(patient.updatedAt) > new Date(patient.syncedAt)) {
          await this.uploadPatient(patient, userId);
          uploadCount++;
        }
      }

      console.log('上传完成,数量:', uploadCount);

      // 下载远程修改
      const remotePatients = await this.downloadPatients(userId, this.lastSyncTime);

      this.lastSyncTime = new Date().toISOString();
      console.log('同步完成,最后同步时间:', this.lastSyncTime);

      return {
        success: true,
        uploadCount,
        downloadCount: remotePatients ? remotePatients.length : 0,
        lastSyncTime: this.lastSyncTime,
        remotePatients
      };
    } catch (e) {
      console.error('同步失败:', e);
      return {
        success: false,
        error: e.message
      };
    } finally {
      this.isSyncing = false;
    }
  }

  // 上传单个患者
  async uploadPatient(patient, userId) {
    if (!this.isEnabled) return false;

    const retryTimes = config.cloud.retryTimes;

    for (let i = 0; i < retryTimes; i++) {
      try {
        await this.db.collection(config.cloud.collection).doc(patient.id).set({
          data: {
            ...patient,
            userId,
            syncedAt: new Date().toISOString()
          }
        });
        return true;
      } catch (e) {
        console.error(`上传患者失败(${i + 1}/${retryTimes}):`, e);
        if (i === retryTimes - 1) throw e;
        await new Promise(resolve => setTimeout(resolve, config.cloud.retryDelay));
      }
    }
  }

  // 下载远程患者数据
  async downloadPatients(userId, lastSyncTime) {
    if (!this.isEnabled) return [];

    try {
      let query = this.db.collection(config.cloud.collection).where({
        userId: userId
      });

      if (lastSyncTime) {
        query = query.where({
          updatedAt: this.db.command.gt(lastSyncTime)
        });
      }

      const res = await query.limit(100).get();
      return res.data || [];
    } catch (e) {
      console.error('下载患者数据失败:', e);
      return [];
    }
  }

  // 批量上传患者
  async batchUploadPatients(patients, userId) {
    if (!this.isEnabled) return { success: false, count: 0 };

    const results = {
      success: true,
      count: 0,
      failures: []
    };

    for (const patient of patients) {
      try {
        await this.uploadPatient(patient, userId);
        results.count++;
      } catch (e) {
        results.failures.push({
          patientId: patient.id,
          error: e.message
        });
        results.success = false;
      }
    }

    return results;
  }

  // 获取同步状态
  getSyncStatus() {
    return {
      isEnabled: this.isEnabled,
      isSyncing: this.isSyncing,
      lastSyncTime: this.lastSyncTime,
      autoSyncEnabled: !!this.syncTimer
    };
  }

  // 清除同步状态
  clearSyncStatus() {
    this.lastSyncTime = null;
    console.log('同步状态已清除');
  }
}

module.exports = CloudSyncManager;
