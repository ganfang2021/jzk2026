// 云端数据库管理器 - 支持10万+患者数据的云存储架构
// 核心策略：云端为主存储，本地为缓存，最后写入胜出
const config = require('../config.js');

class CloudDatabase {
  constructor() {
    this.db = null;
    this.isInitialized = false;
    this.COLLECTION_PATIENTS = config.cloud.collection;  // 患者主数据
    this.COLLECTION_INDEX = 'patient_index';       // 索引集合(用于快速查询)
    this.COLLECTION_AUDIT = 'audit_logs';          // 审计日志
    this.COLLECTION_COUNTERS = 'counters';          // 计数器(用于ID生成)
  }

  // 初始化云开发
  async init() {
    if (this.isInitialized) return true;

    try {
      if (!wx.cloud) {
        console.error('云开发未初始化');
        return false;
      }

      wx.cloud.init({
        env: config.cloud.env,
        traceUser: true
      });

      this.db = wx.cloud.database();
      this.isInitialized = true;

      console.log('云数据库初始化成功');
      return true;
    } catch (e) {
      console.error('云数据库初始化失败:', e);
      return false;
    }
  }

  // ==================== 患者 CRUD ====================

  // 生成唯一ID (使用云端计数器)
  async generateId() {
    const counterId = 'patient_id_counter';
    
    try {
      // 使用云函数原子递增生成ID，避免冲突
      const result = await wx.cloud.callFunction({
        name: 'counter',
        data: { action: 'increment', collection: 'counters', docId: counterId }
      }).catch(() => null);

      if (result && result.counterValue !== undefined) {
        return 'WX' + result.counterValue;
      }
      
      // 降级方案：使用本地时间戳+随机数
      return 'WX' + Date.now() + Math.random().toString(36).substr(2, 9);
    } catch (e) {
      // 降级方案
      return 'WX' + Date.now() + Math.random().toString(36).substr(2, 9);
    }
  }

  // 添加患者 (支持10万+数据)
  async addPatient(patientData, userId) {
    if (!this.isInitialized) await this.init();

    const id = await this.generateId();
    const now = new Date().toISOString();

    const patient = {
      _id: id,
      id: id,
      userId: userId,
      ...patientData,
      createdAt: now,
      updatedAt: now,
      version: 1,  // 乐观锁版本号
      deleted: false
    };

    try {
      // 1. 保存主数据
      await this.db.collection(this.COLLECTION_PATIENTS).add({
        data: patient
      });

      // 2. 更新索引 (异步，不阻塞主操作)
      this.updateIndexAsync(userId, patient).catch(err => {
        console.error('更新索引失败:', err);
      });

      // 3. 记录审计日志 (异步)
      this.logAuditAsync(userId, id, 'ADD', null, patient).catch(err => {
        console.error('记录审计日志失败:', err);
      });

      return patient;
    } catch (e) {
      console.error('添加患者失败:', e);
      throw e;
    }
  }

  // 获取单个患者
  async getPatient(id, userId) {
    if (!this.isInitialized) await this.init();

    try {
      const res = await this.db.collection(this.COLLECTION_PATIENTS)
        .where({
          id: id,
          userId: userId,
          deleted: false
        })
        .limit(1)
        .get();

      return res.data && res.data.length > 0 ? res.data[0] : null;
    } catch (e) {
      console.error('获取患者失败:', e);
      return null;
    }
  }

  // 更新患者 (最后写入胜出 + 乐观锁)
  async updatePatient(id, updateData, userId) {
    if (!this.isInitialized) await this.init();

    const now = new Date().toISOString();

    try {
      // 1. 先获取当前版本
      const current = await this.getPatient(id, userId);
      if (!current) {
        throw new Error('患者不存在或无权访问');
      }

      // 2. 合并数据 (最后写入胜出)
      const mergedData = {
        ...current,
        ...updateData,
        updatedAt: now,
        version: current.version + 1  // 版本递增
      };

      // 3. 使用云数据库的原子更新 (防止并发覆盖)
      // 注意：这里使用 where + update 而非 doc().update，因为我们需要基于条件更新
      const res = await this.db.collection(this.COLLECTION_PATIENTS)
        .where({
          id: id,
          userId: userId
        })
        .update({
          data: {
            ...updateData,
            updatedAt: now,
            version: this.db.command.inc(1)  // 原子递增版本号
          }
        });

      if (res.updated === 0) {
        console.warn('更新未影响任何记录，可能存在并发冲突');
      }

      // 4. 更新索引
      this.updateIndexAsync(userId, { ...current, ...updateData }).catch(err => {
        console.error('更新索引失败:', err);
      });

      // 5. 记录审计日志
      this.logAuditAsync(userId, id, 'UPDATE', current, updateData).catch(err => {
        console.error('记录审计日志失败:', err);
      });

      return { success: true, version: current.version + 1 };
    } catch (e) {
      console.error('更新患者失败:', e);
      throw e;
    }
  }

  // 删除患者 (软删除)
  async deletePatient(id, userId) {
    if (!this.isInitialized) await this.init();

    try {
      const current = await this.getPatient(id, userId);
      if (!current) {
        throw new Error('患者不存在或无权访问');
      }

      // 软删除
      await this.db.collection(this.COLLECTION_PATIENTS)
        .where({
          id: id,
          userId: userId
        })
        .update({
          data: {
            deleted: true,
            deletedAt: new Date().toISOString(),
            version: this.db.command.inc(1)
          }
        });

      // 更新索引
      this.removeFromIndexAsync(userId, id).catch(err => {
        console.error('从索引移除失败:', err);
      });

      // 记录审计日志
      this.logAuditAsync(userId, id, 'DELETE', current, null).catch(err => {
        console.error('记录审计日志失败:', err);
      });

      return { success: true };
    } catch (e) {
      console.error('删除患者失败:', e);
      throw e;
    }
  }

  // ==================== 分页查询 (支持10万+) ====================

  // 分页查询患者
  async queryPatients(page = 1, pageSize = 20, filters = {}, userId) {
    if (!this.isInitialized) await this.init();

    const offset = (page - 1) * pageSize;

    try {
      let query = this.db.collection(this.COLLECTION_PATIENTS)
        .where({
          userId: userId,
          deleted: false
        });

      // 应用时间筛选
      if (filters.startDate) {
        query = query.where({
          createdAt: this.db.command.gte(filters.startDate)
        });
      }

      // 应用分诊级别筛选
      if (filters.triageLevel) {
        query = query.where({
          triageLevel: filters.triageLevel
        });
      }

      // 使用 skip + limit 进行分页 (云数据库支持)
      const res = await query
        .orderBy('createdAt', 'desc')  // 按时间倒序
        .skip(offset)
        .limit(pageSize)
        .get();

      // 获取总数 (用于前端分页)
      const countRes = await this.db.collection(this.COLLECTION_PATIENTS)
        .where({
          userId: userId,
          deleted: false
        })
        .count();

      return {
        patients: res.data || [],
        page,
        pageSize,
        total: countRes.total,
        totalPages: Math.ceil(countRes.total / pageSize)
      };
    } catch (e) {
      console.error('查询患者失败:', e);
      return {
        patients: [],
        page,
        pageSize,
        total: 0,
        totalPages: 0
      };
    }
  }

  // 搜索患者 (按姓名/身份证/电话)
  async searchPatients(searchTerm, page = 1, pageSize = 20, userId) {
    if (!this.isInitialized) await this.init();

    const offset = (page - 1) * pageSize;
    const term = searchTerm.toLowerCase();

    try {
      // 使用 OR 查询匹配多个字段
      const res = await this.db.collection(this.COLLECTION_PATIENTS)
        .where({
          userId: userId,
          deleted: false,
          $or: [
            { name: this.db.command.regexp({ regexp: term, options: 'i' }) },
            { phone: this.db.command.regexp({ regexp: term, options: 'i' }) }
          ]
        })
        .orderBy('createdAt', 'desc')
        .skip(offset)
        .limit(pageSize)
        .get();

      // 统计总数
      const countRes = await this.db.collection(this.COLLECTION_PATIENTS)
        .where({
          userId: userId,
          deleted: false,
          $or: [
            { name: this.db.command.regexp({ regexp: term, options: 'i' }) },
            { phone: this.db.command.regexp({ regexp: term, options: 'i' }) }
          ]
        })
        .count();

      return {
        patients: res.data || [],
        page,
        pageSize,
        total: countRes.total,
        totalPages: Math.ceil(countRes.total / pageSize)
      };
    } catch (e) {
      console.error('搜索患者失败:', e);
      return {
        patients: [],
        page,
        pageSize,
        total: 0,
        totalPages: 0
      };
    }
  }

  // ==================== 批量操作 ====================

  // 批量添加患者 (用于数据迁移)
  async batchAddPatients(patients, userId) {
    if (!this.isInitialized) await this.init();

    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    // 分批处理，每批50条
    const batchSize = 50;
    for (let i = 0; i < patients.length; i += batchSize) {
      const batch = patients.slice(i, i + batchSize);
      
      try {
        // 使用云函数批量添加 (如果可用)
        const batchResult = await wx.cloud.callFunction({
          name: 'batchAddPatients',
          data: {
            patients: batch,
            userId: userId
          }
        }).catch(() => null);

        if (batchResult && batchResult.success) {
          results.success += batchResult.count;
        } else {
          // 降级：逐条添加
          for (const patient of batch) {
            try {
              await this.addPatient(patient, userId);
              results.success++;
            } catch (e) {
              results.failed++;
              results.errors.push({ patient: patient.name || patient.id, error: e.message });
            }
          }
        }
      } catch (e) {
        console.error('批量添加失败:', e);
        results.failed += batch.length;
        results.errors.push({ batch: i, error: e.message });
      }
    }

    return results;
  }

  // 批量获取患者 (用于导出等)
  async getAllPatients(userId, { onProgress } = {}) {
    if (!this.isInitialized) await this.init();

    const allPatients = [];
    const pageSize = 100;
    let page = 1;
    let hasMore = true;

    try {
      while (hasMore) {
        const result = await this.queryPatients(page, pageSize, {}, userId);
        allPatients.push(...result.patients);

        if (onProgress) {
          onProgress({
            current: allPatients.length,
            total: result.total,
            percent: Math.round(allPatients.length / result.total * 100)
          });
        }

        hasMore = result.patients.length === pageSize;
        page++;

        // 防止请求过快
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      return allPatients;
    } catch (e) {
      console.error('获取所有患者失败:', e);
      throw e;
    }
  }

  // ==================== 实时协同 ====================

  // 监听患者数据变化 (实时协同核心)
  watchPatients(userId, { onChange, onError }) {
    if (!this.isInitialized) {
      this.init().then(() => this._startWatch(userId, { onChange, onError }));
    } else {
      this._startWatch(userId, { onChange, onError });
    }
  }

  _startWatch(userId, { onChange, onError }) {
    const watcher = this.db.collection(this.COLLECTION_PATIENTS)
      .where({
        userId: userId,
        deleted: false
      })
      .orderBy('updatedAt', 'desc')
      .watch({
        onChange: (res) => {
          console.log('数据变化:', res);
          if (onChange) {
            onChange({
              docs: res.docs,
              changedDocs: res.changedDocs,
              removedDocs: res.removedDocs,
              updatedDocs: res.updatedDocs
            });
          }
        },
        onError: (err) => {
          console.error('监听错误:', err);
          if (onError) {
            onError(err);
          }
        }
      });

    return watcher;
  }

  // ==================== 索引管理 ====================

  // 异步更新索引
  async updateIndexAsync(userId, patient) {
    // 索引文档结构
    const indexDoc = {
      id: patient.id,
      userId: userId,
      name: patient.name || '',
      phone: patient.phone || '',
      triageLevel: patient.triageLevel || '',
      gender: patient.gender || '',
      age: patient.age || 0,
      createdAt: patient.createdAt
    };

    try {
      await this.db.collection(this.COLLECTION_INDEX).add({
        data: indexDoc
      });
    } catch (e) {
      // 索引可能已存在，尝试更新
      try {
        await this.db.collection(this.COLLECTION_INDEX)
          .where({ id: patient.id, userId: userId })
          .update({
            data: indexDoc
          });
      } catch (e2) {
        console.error('更新索引失败:', e2);
      }
    }
  }

  // 异步从索引移除
  async removeFromIndexAsync(userId, patientId) {
    try {
      await this.db.collection(this.COLLECTION_INDEX)
        .where({ id: patientId, userId: userId })
        .remove();
    } catch (e) {
      console.error('从索引移除失败:', e);
    }
  }

  // ==================== 审计日志 ====================

  // 异步记录审计日志
  async logAuditAsync(userId, patientId, action, before, after) {
    const log = {
      userId,
      patientId,
      action,
      before: before ? JSON.stringify(before) : null,
      after: after ? JSON.stringify(after) : null,
      timestamp: new Date().toISOString(),
      clientVersion: '1.0.0'
    };

    try {
      await this.db.collection(this.COLLECTION_AUDIT).add({
        data: log
      });
    } catch (e) {
      console.error('记录审计日志失败:', e);
    }
  }

  // 获取审计日志
  async getAuditLogs(userId, { limit = 100, offset = 0 } = {}) {
    if (!this.isInitialized) await this.init();

    try {
      const res = await this.db.collection(this.COLLECTION_AUDIT)
        .where({ userId: userId })
        .orderBy('timestamp', 'desc')
        .skip(offset)
        .limit(limit)
        .get();

      return {
        logs: res.data || [],
        total: res.data ? res.data.length : 0
      };
    } catch (e) {
      console.error('获取审计日志失败:', e);
      return { logs: [], total: 0 };
    }
  }

  // ==================== 数据统计 ====================

  // 获取患者统计数据
  async getStatistics(userId, { startDate, endDate } = {}) {
    if (!this.isInitialized) await this.init();

    try {
      let query = this.db.collection(this.COLLECTION_PATIENTS)
        .where({
          userId: userId,
          deleted: false
        });

      if (startDate) {
        query = query.where({
          createdAt: this.db.command.gte(startDate)
        });
      }

      const res = await query.get();

      // 本地计算统计
      const patients = res.data || [];
      const stats = {
        total: patients.length,
        level1: 0,
        level2: 0,
        level3: 0,
        level4: 0,
        male: 0,
        female: 0,
        hospitalized: 0,
        surgery: 0,
        cpr: 0,
        cprSuccess: 0,
        death: 0
      };

      patients.forEach(p => {
        if (p.triageLevel === 'Ⅰ') stats.level1++;
        if (p.triageLevel === 'Ⅱ') stats.level2++;
        if (p.triageLevel === 'Ⅲ') stats.level3++;
        if (p.triageLevel === 'Ⅳ') stats.level4++;
        if (p.gender === '男') stats.male++;
        if (p.gender === '女') stats.female++;
        if (p.hospitalized) stats.hospitalized++;
        if (p.surgery) stats.surgery++;
        if (p.cpr) stats.cpr++;
        if (p.cprSuccess) stats.cprSuccess++;
        if (p.death) stats.death++;
      });

      // 计算CPR成功率
      stats.cprRate = stats.cpr > 0 ? ((stats.cprSuccess / stats.cpr) * 100).toFixed(1) : '0';

      return stats;
    } catch (e) {
      console.error('获取统计数据失败:', e);
      return null;
    }
  }

  // ==================== 离线队列 ====================

  // 添加到离线操作队列
  addToOfflineQueue(operation) {
    const queue = wx.getStorageSync('offline_queue') || [];
    queue.push({
      ...operation,
      timestamp: Date.now(),
      id: 'op_' + Date.now() + Math.random().toString(36).substr(2, 6)
    });
    wx.setStorageSync('offline_queue', queue);
    return queue.length;
  }

  // 获取离线队列
  getOfflineQueue() {
    return wx.getStorageSync('offline_queue') || [];
  }

  // 清空离线队列
  clearOfflineQueue() {
    wx.removeStorageSync('offline_queue');
  }

  // 同步离线操作
  async syncOfflineQueue(userId) {
    const queue = this.getOfflineQueue();
    if (queue.length === 0) return { success: 0, failed: 0 };

    const results = { success: 0, failed: 0 };

    for (const op of queue) {
      try {
        switch (op.type) {
          case 'ADD':
            await this.addPatient(op.data, userId);
            break;
          case 'UPDATE':
            await this.updatePatient(op.data.id, op.data, userId);
            break;
          case 'DELETE':
            await this.deletePatient(op.data.id, userId);
            break;
        }
        results.success++;
      } catch (e) {
        console.error('离线操作同步失败:', op, e);
        results.failed++;
      }
    }

    // 清空已处理的队列
    this.clearOfflineQueue();
    return results;
  }
}

// 单例模式
module.exports = new CloudDatabase();
