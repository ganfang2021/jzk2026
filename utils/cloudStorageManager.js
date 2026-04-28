// 云存储管理器 - 处理患者数据的云端同步
const config = require('../config.js');

class CloudStorageManager {
  constructor() {
    this.isSyncing = false;
    this.syncQueue = [];
    this.db = null;
    this.collectionName = config.cloud.collection;
  }

  // 初始化云数据库
  init() {
    if (wx.cloud) {
      try {
        this.db = wx.cloud.database();
        console.log('云存储管理器初始化成功');
        return true;
      } catch (e) {
        console.error('云数据库初始化失败:', e);
        return false;
      }
    }
    console.warn('云开发未初始化');
    return false;
  }

  // 确保数据库已初始化
  _ensureDb() {
    if (!this.db) {
      this.init();
    }
    if (!this.db) {
      throw new Error('云数据库未初始化');
    }
  }

  // 生成患者数据的同步哈希（用于判断数据是否变更）
  _generateSyncHash(patient) {
    var fields = JSON.stringify({
      name: patient.name,
      age: patient.age,
      gender: patient.gender,
      triageLevel: patient.triageLevel,
      diagnosis: patient.diagnosis,
      pulse: patient.pulse,
      heartRate: patient.heartRate,
      respRate: patient.respRate,
      spo2: patient.spo2,
      bpSystolic: patient.bpSystolic,
      bpDiastolic: patient.bpDiastolic,
      doctor: patient.doctor,
      inTime: patient.inTime,
      outTime: patient.outTime,
      hospitalized: patient.hospitalized,
      dept: patient.dept,
      rescued: patient.rescued,
      intubated: patient.intubated,
      centralLine: patient.centralLine,
      cpr: patient.cpr,
      cprSuccess: patient.cprSuccess,
      death: patient.death,
      outcome: patient.outcome,
      surgery: patient.surgery,
      severeTrauma: patient.severeTrauma,
      surgeryTime: patient.surgeryTime,
      ivAccess: patient.ivAccess,
      outcome: patient.outcome,
      cpr48hCount: patient.cpr48hCount,
      ocrResults: patient.ocrResults ? JSON.stringify(patient.ocrResults) : null
    });
    // 简单哈希
    var hash = 0;
    for (var i = 0; i < fields.length; i++) {
      var ch = fields.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash = hash & hash;
    }
    return 'h' + Math.abs(hash).toString(36);
  }

  // 同步单个患者到云端（带哈希去重）
  async syncPatientToCloud(patient, userId) {
    if (!this.db) {
      console.warn('云数据库未初始化');
      return { success: false, error: '云数据库未初始化' };
    }

    try {
      // 计算当前数据的哈希值
      var currentHash = this._generateSyncHash(patient);

      // 如果本地记录已有相同哈希，说明数据未变更，跳过同步
      if (patient._syncHash === currentHash) {
        return { success: true, operation: 'skipped', reason: '数据未变更' };
      }

      // 检查是否已存在
      const existResult = await this.db.collection(this.collectionName)
        .where({
          _id: patient.id
        })
        .count();

      var syncData = {
        ...patient,
        _syncHash: currentHash,
        userId: userId,
        updatedAt: new Date(),
        syncedAt: new Date()
      };
      // 移除可能污染数据库的内部字段和云端不允许的字段
      delete syncData._needsCloudSync;
      delete syncData._localUpdatedAt;
      delete syncData._id;          // 避免 _id 与顶层 _id 冲突
      delete syncData._openid;      // 云端系统字段，不能写入
      delete syncData._unionid;     // 云端系统字段，不能写入
      delete syncData._createDate;   // 云端自动维护字段
      delete syncData._updateDate;  // 云端自动维护字段

      if (existResult.total > 0) {
        // 更新现有记录
        const result = await this.db.collection(this.collectionName)
          .doc(patient.id)
          .update({
            data: syncData
          });
        console.log('更新患者到云端成功:', patient.id);
        return { success: true, operation: 'update', data: result, hash: currentHash };
      } else {
        // 添加新记录
        var addData = Object.assign({ _id: patient.id }, syncData);
        const result = await this.db.collection(this.collectionName)
          .add({
            data: addData
          });
        console.log('添加患者到云端成功:', patient.id);
        return { success: true, operation: 'add', data: result, hash: currentHash };
      }
    } catch (e) {
      console.error('同步患者到云端失败:', e);
      return { success: false, error: e.message };
    }
  }

  // 从云端加载患者数据（支持分页获取所有数据）
  async loadPatientsFromCloud(userId, isAdmin = false) {
    this._ensureDb();

    try {
      let allData = [];
      const pageSize = 100; // 每次最多获取100条
      let skip = 0;
      let hasMore = true;

      console.log('[loadPatientsFromCloud] 开始分页获取云端数据...');

      while (hasMore) {
        let result;
        if (isAdmin) {
          // 管理员加载所有数据
          result = await this.db.collection(this.collectionName)
            .where({
              deleted: this.db.command.neq(true)
            })
            .orderBy('updatedAt', 'desc')
            .skip(skip)
            .limit(pageSize)
            .get();
        } else {
          // 普通用户加载自己的数据
          result = await this.db.collection(this.collectionName)
            .where({
              userId: userId,
              deleted: this.db.command.neq(true)
            })
            .orderBy('updatedAt', 'desc')
            .skip(skip)
            .limit(pageSize)
            .get();
        }

        if (result.data && result.data.length > 0) {
          allData = allData.concat(result.data);
          skip += result.data.length;
          console.log('[loadPatientsFromCloud] 已获取:', allData.length, '条');

          // 如果返回的数量少于pageSize，说明已经获取完毕
          if (result.data.length < pageSize) {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }

      console.log('[loadPatientsFromCloud] 云端加载完成，总计:', allData.length, '条');

      // 云端数据去重：按 _id 保留最新版本
      var seen = {};
      var deduped = [];
      for (var i = 0; i < allData.length; i++) {
        var p = allData[i];
        var pid = p._id;
        if (!pid) continue;
        var pTime = new Date(p.updatedAt || p.createdAt || 0).getTime();
        if (!seen[pid] || pTime > seen[pid].time) {
          seen[pid] = { patient: p, time: pTime };
        }
      }
      for (var id in seen) {
        // 清理云端系统字段
        var patient = seen[id].patient;
        delete patient._openid;
        delete patient._unionid;
        delete patient._createDate;
        delete patient._updateDate;
        deduped.push(patient);
      }
      if (deduped.length < allData.length) {
        console.log('云端去重完成:', allData.length, '->', deduped.length);
      }
      return deduped;
    } catch (e) {
      console.error('从云端加载患者数据失败:', e);
      return [];
    }
  }

  // 从云端删除患者
  async deletePatientFromCloud(patientId) {
    if (!this.db) {
      console.warn('云数据库未初始化');
      return { success: false };
    }

    try {
      // 软删除
      const result = await this.db.collection(this.collectionName)
        .doc(patientId)
        .update({
          data: {
            deleted: true,
            deletedAt: new Date()
          }
        });
      console.log('从云端删除患者成功:', patientId);
      return { success: true };
    } catch (e) {
      console.error('从云端删除患者失败:', e);
      return { success: false, error: e.message };
    }
  }

  // 批量同步患者数据到云端
  async batchSyncToCloud(patients, userId) {
    if (!this.db) {
      console.warn('云数据库未初始化');
      return { success: false };
    }

    console.log('开始批量同步，患者数量:', patients.length);
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    // 分批处理，每批10条
    const batchSize = 10;
    for (let i = 0; i < patients.length; i += batchSize) {
      const batch = patients.slice(i, i + batchSize);

      const batchResults = await Promise.all(batch.map(patient =>
        this.syncPatientToCloud(patient, userId).catch(err => ({
          success: false,
          error: err.message || 'Unknown error'
        }))
      ));

      batchResults.forEach((result, index) => {
        if (result && result.success) {
          results.success++;
          // 更新本地对象的哈希（用于后续去重）
          if (result.hash && batch[index]) {
            batch[index]._syncHash = result.hash;
          }
        } else {
          results.failed++;
          results.errors.push({
            index: i + index,
            patientId: batch[index].id,
            error: result.error || 'Unknown error'
          });
        }
      });

      // 避免请求过快
      if (i + batchSize < patients.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log('批量同步完成:', results);
    return results;
  }

  // 检查云数据库集合是否存在
  async checkCollection() {
    if (!this.db) {
      return false;
    }

    try {
      // 尝试查询一条数据
      await this.db.collection(this.collectionName).limit(1).get();
      return true;
    } catch (e) {
      console.error('云数据库集合不存在或无权限:', e);
      return false;
    }
  }

  // 获取云端患者统计数据（支持10万+数据）
  async getCloudStats() {
    if (!this.db) {
      return this._createEmptyStats();
    }

    var self = this;
    try {
      // 使用 count() 而非 get()，避免内存溢出
      var baseQuery = {
        deleted: this.db.command.neq(true)
      };

      // 获取总数
      var totalResult = await this.db.collection(this.collectionName)
        .where(baseQuery)
        .count();
      var total = totalResult.total || 0;

      // 各分流级别统计
      var triageLevels = [
        { key: 'level1', value: 'Ⅰ' },
        { key: 'level2', value: 'Ⅱ' },
        { key: 'level3', value: 'Ⅲ' },
        { key: 'level4', value: 'Ⅳ' }
      ];
      var stats = this._createEmptyStats();
      stats.total = total;

      // 并行查询各级别数量
      var countPromises = triageLevels.map(function(level) {
        return self.db.collection(self.collectionName)
          .where(Object.assign({}, baseQuery, { triageLevel: level.value }))
          .count()
          .then(function(res) {
            stats[level.key] = res.total || 0;
          });
      });

      // 还需要其他统计数据，并行查询
      var otherStatsPromises = [
        { key: 'hospitalized', field: 'hospitalized', value: true },
        { key: 'rescued', field: 'rescued', value: true },
        { key: 'surgery', field: 'surgery', value: true },
        { key: 'severeTrauma', field: 'severeTrauma', value: true },
        { key: 'cpr', field: 'cpr', value: true },
        { key: 'cprSuccess', field: 'cprSuccess', value: true },
        { key: 'intubated', field: 'intubated', value: true },
        { key: 'centralLine', field: 'centralLine', value: true },
        { key: 'death', field: 'death', value: true },
        { key: 'ivAccess', field: 'ivAccess', value: true },
        { key: 'male', field: 'gender', value: '男' },
        { key: 'female', field: 'gender', value: '女' }
      ].map(function(item) {
        return self.db.collection(self.collectionName)
          .where(Object.assign({}, baseQuery, { [item.field]: item.value }))
          .count()
          .then(function(res) {
            stats[item.key] = res.total || 0;
          });
      });

      await Promise.all(countPromises.concat(otherStatsPromises));

      // 计算CPR成功率
      if (stats.cpr > 0) {
        stats.cprRate = ((stats.cprSuccess / stats.cpr) * 100).toFixed(1);
      }

      console.log('[getCloudStats] 云端统计完成: 总数=', total);
      return stats;
    } catch (e) {
      console.error('获取云端统计失败:', e);
      return this._createEmptyStats();
    }
  }

  // 创建空统计对象
  _createEmptyStats() {
    return {
      total: 0,
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
      cprRate: '0'
    };
  }
}

// 导出单例
module.exports = new CloudStorageManager();
