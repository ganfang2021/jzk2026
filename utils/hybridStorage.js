// 混合存储管理器 - 云端主存储 + 本地缓存
// 支持10万+数据，优先云端，本地仅做缓存
const config = require('../config.js');
const cloudDatabase = require('./cloudDatabase.js');

// 本地缓存配置
const LOCAL_CACHE_SIZE = 500;      // 本地缓存最新500条
const CACHE_EXPIRE_MS = 5 * 60 * 1000;  // 缓存5分钟过期

class HybridStorage {
  constructor(userId) {
    this.userId = userId;
    this.localCache = null;        // 本地缓存数据
    this.localCacheTime = 0;       // 缓存时间戳
    this.isWatching = false;       // 是否正在监听
    this.watcher = null;           // 监听器
    this.offlineQueue = [];         // 离线操作队列
    this.init();
  }

  async init() {
    // 初始化云端数据库
    await cloudDatabase.init();
    
    // 加载离线队列
    this.offlineQueue = cloudDatabase.getOfflineQueue();
    
    // 检查网络状态
    this.checkNetworkStatus();
  }

  // 检查网络状态
  checkNetworkStatus() {
    wx.getNetworkType({
      success: (res) => {
        this.isOffline = res.networkType === 'none';
        console.log('网络状态:', this.isOffline ? '离线' : '在线');
      }
    });

    // 监听网络变化
    wx.onNetworkStatusChange((res) => {
      this.isOffline = !res.isConnected;
      console.log('网络状态变化:', this.isOffline ? '离线' : '在线');
      
      // 网络恢复时同步离线数据
      if (res.isConnected && this.offlineQueue.length > 0) {
        this.syncOfflineQueue();
      }
    });
  }

  // ==================== CRUD 操作 ====================

  // 添加患者
  async addPatient(patientData) {
    const now = new Date().toISOString();
    const patient = {
      ...patientData,
      id: 'WX' + Date.now() + Math.random().toString(36).substr(2, 9),
      createdAt: now,
      updatedAt: now
    };

    if (this.isOffline) {
      // 离线模式：加入队列，更新本地缓存
      this.offlineQueue.push({ type: 'ADD', data: patient, timestamp: Date.now() });
      cloudDatabase.addToOfflineQueue({ type: 'ADD', data: patient });
      
      // 更新本地缓存
      if (this.localCache) {
        this.localCache.unshift(patient);
        if (this.localCache.length > LOCAL_CACHE_SIZE) {
          this.localCache.pop();
        }
      }
      
      return { ...patient, _synced: false };
    }

    try {
      // 在线模式：直接写入云端
      const result = await cloudDatabase.addPatient(patient, this.userId);
      this.invalidateCache();
      return { ...result, _synced: true };
    } catch (e) {
      console.error('添加患者失败，移至离线队列:', e);
      this.offlineQueue.push({ type: 'ADD', data: patient, timestamp: Date.now() });
      cloudDatabase.addToOfflineQueue({ type: 'ADD', data: patient });
      return { ...patient, _synced: false };
    }
  }

  // 获取患者
  async getPatient(id) {
    // 先检查本地缓存
    if (this.localCache) {
      const cached = this.localCache.find(p => p.id === id);
      if (cached && !this.isCacheExpired()) {
        return cached;
      }
    }

    // 从云端获取
    try {
      const patient = await cloudDatabase.getPatient(id, this.userId);
      return patient;
    } catch (e) {
      console.error('获取患者失败:', e);
      return null;
    }
  }

  // 更新患者 (最后写入胜出)
  async updatePatient(id, updateData) {
    if (this.isOffline) {
      // 离线模式
      this.offlineQueue.push({ type: 'UPDATE', data: { id, ...updateData }, timestamp: Date.now() });
      cloudDatabase.addToOfflineQueue({ type: 'UPDATE', data: { id, ...updateData } });
      
      // 更新本地缓存
      if (this.localCache) {
        const index = this.localCache.findIndex(p => p.id === id);
        if (index !== -1) {
          this.localCache[index] = { ...this.localCache[index], ...updateData };
        }
      }
      
      return { success: true, _synced: false };
    }

    try {
      const result = await cloudDatabase.updatePatient(id, updateData, this.userId);
      this.invalidateCache();
      return { ...result, _synced: true };
    } catch (e) {
      console.error('更新患者失败，移至离线队列:', e);
      this.offlineQueue.push({ type: 'UPDATE', data: { id, ...updateData }, timestamp: Date.now() });
      cloudDatabase.addToOfflineQueue({ type: 'UPDATE', data: { id, ...updateData } });
      return { success: false, _synced: false, error: e.message };
    }
  }

  // 删除患者
  async deletePatient(id) {
    if (this.isOffline) {
      this.offlineQueue.push({ type: 'DELETE', data: { id }, timestamp: Date.now() });
      cloudDatabase.addToOfflineQueue({ type: 'DELETE', data: { id } });
      
      // 从本地缓存移除
      if (this.localCache) {
        this.localCache = this.localCache.filter(p => p.id !== id);
      }
      
      return { success: true, _synced: false };
    }

    try {
      const result = await cloudDatabase.deletePatient(id, this.userId);
      this.invalidateCache();
      return { ...result, _synced: true };
    } catch (e) {
      console.error('删除患者失败，移至离线队列:', e);
      this.offlineQueue.push({ type: 'DELETE', data: { id }, timestamp: Date.now() });
      cloudDatabase.addToOfflineQueue({ type: 'DELETE', data: { id } });
      return { success: false, _synced: false, error: e.message };
    }
  }

  // ==================== 查询操作 ====================

  // 分页查询
  async queryPatients(page = 1, pageSize = 20, filters = {}) {
    // 优先使用云端分页查询
    try {
      const result = await cloudDatabase.queryPatients(page, pageSize, filters, this.userId);
      return result;
    } catch (e) {
      console.error('云端查询失败:', e);
      
      // 降级：使用本地缓存
      return this.queryFromCache(page, pageSize, filters);
    }
  }

  // 从本地缓存查询
  async queryFromCache(page = 1, pageSize = 20, filters = {}) {
    if (!this.localCache) {
      await this.refreshCache();
    }

    let filtered = [...(this.localCache || [])];

    // 应用筛选
    if (filters.startDate) {
      filtered = filtered.filter(p => new Date(p.createdAt) >= new Date(filters.startDate));
    }
    if (filters.triageLevel) {
      filtered = filtered.filter(p => p.triageLevel === filters.triageLevel);
    }
    if (filters.searchTerm) {
      const term = filters.searchTerm.toLowerCase();
      filtered = filtered.filter(p => 
        (p.name && p.name.toLowerCase().includes(term)) ||
        (p.idCard && p.idCard.includes(term)) ||
        (p.phone && p.phone.includes(term))
      );
    }

    // 排序
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const total = filtered.length;
    const startIndex = (page - 1) * pageSize;
    const patients = filtered.slice(startIndex, startIndex + pageSize);

    return {
      patients,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      _fromCache: true
    };
  }

  // 搜索患者
  async searchPatients(searchTerm, page = 1, pageSize = 20) {
    try {
      return await cloudDatabase.searchPatients(searchTerm, page, pageSize, this.userId);
    } catch (e) {
      console.error('云端搜索失败:', e);
      return this.queryFromCache(page, pageSize, { searchTerm });
    }
  }

  // 获取总数
  async getTotalCount() {
    try {
      const result = await cloudDatabase.queryPatients(1, 1, {}, this.userId);
      return result.total;
    } catch (e) {
      console.error('获取总数失败:', e);
      return this.localCache ? this.localCache.length : 0;
    }
  }

  // ==================== 缓存管理 ====================

  // 刷新本地缓存
  async refreshCache() {
    try {
      const result = await cloudDatabase.queryPatients(1, LOCAL_CACHE_SIZE, {}, this.userId);
      this.localCache = result.patients;
      this.localCacheTime = Date.now();
      return this.localCache;
    } catch (e) {
      console.error('刷新缓存失败:', e);
      return this.localCache || [];
    }
  }

  // 使缓存失效
  invalidateCache() {
    this.localCacheTime = 0;
  }

  // 检查缓存是否过期
  isCacheExpired() {
    return Date.now() - this.localCacheTime > CACHE_EXPIRE_MS;
  }

  // ==================== 实时协同 ====================

  // 启动实时监听
  startWatching({ onChange, onError, onConnected, onDisconnected }) {
    if (this.isWatching) {
      console.log('已经在监听中');
      return;
    }

    this.onChange = onChange;
    this.onError = onError;
    this.onConnected = onConnected;
    this.onDisconnected = onDisconnected;

    // 包装watch调用，避免权限问题导致崩溃
    try {
      if (typeof cloudDatabase.watchPatients !== 'function') {
        console.warn('cloudDatabase.watchPatients 不可用，跳过实时监听');
        return;
      }
      
      cloudDatabase.watchPatients(this.userId, {
        onChange: (changes) => {
          console.log('数据变化:', changes);
          
          // 更新本地缓存
          this.handleRemoteChanges(changes);
          
          if (this.onChange) {
            this.onChange(changes);
          }
        },
        onError: (err) => {
          console.error('监听错误:', err);
          if (this.onError) {
            this.onError(err);
          }
        }
      });

      this.isWatching = true;
      console.log('已启动实时监听');
    } catch (e) {
      console.error('启动实时监听失败（权限可能不足）:', e.message);
      this.isWatching = false;
      // 不抛出异常，避免影响正常功能
    }
  }

  // 停止监听
  stopWatching() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.isWatching = false;
    console.log('已停止实时监听');
  }

  // 处理远程数据变化 (最后写入胜出策略)
  handleRemoteChanges(changes) {
    if (!this.localCache) return;

    // 处理更新的文档
    if (changes.updatedDocs) {
      changes.updatedDocs.forEach(updated => {
        const index = this.localCache.findIndex(p => p.id === updated.id);
        if (index !== -1) {
          // 合并更新 (最后写入胜出)
          this.localCache[index] = { ...this.localCache[index], ...updated };
        } else {
          // 新增
          this.localCache.unshift(updated);
        }
      });
    }

    // 处理新增的文档
    if (changes.docs) {
      changes.docs.forEach(doc => {
        if (!this.localCache.find(p => p.id === doc.id)) {
          this.localCache.unshift(doc);
        }
      });
    }

    // 处理删除的文档
    if (changes.removedDocs) {
      changes.removedDocs.forEach(removed => {
        this.localCache = this.localCache.filter(p => p.id !== removed.id);
      });
    }

    // 保持缓存大小
    if (this.localCache.length > LOCAL_CACHE_SIZE) {
      this.localCache = this.localCache.slice(0, LOCAL_CACHE_SIZE);
    }
  }

  // ==================== 离线同步 ====================

  // 同步离线队列
  async syncOfflineQueue() {
    if (this.offlineQueue.length === 0) {
      return { success: 0, failed: 0 };
    }

    console.log('开始同步离线队列，数量:', this.offlineQueue.length);

    const results = await cloudDatabase.syncOfflineQueue(this.userId);
    
    if (results.success > 0) {
      this.invalidateCache();
    }

    this.offlineQueue = [];
    return results;
  }

  // 获取离线队列状态
  getOfflineQueueStatus() {
    return {
      pending: this.offlineQueue.length,
      isOffline: this.isOffline
    };
  }

  // ==================== 数据迁移 ====================

  // 迁移旧数据到云端
  async migrateFromLocalChunkStorage(chunkStorage) {
    console.log('开始迁移数据...');
    
    const allPatients = await chunkStorage.getAllPatients();
    console.log('需要迁移的患者数量:', allPatients.length);

    if (allPatients.length === 0) {
      return { success: 0, failed: 0 };
    }

    const results = await cloudDatabase.batchAddPatients(allPatients, this.userId);
    
    console.log('迁移完成:', results);
    return results;
  }

  // ==================== 导出 ====================

  // 导出所有数据
  async exportAllData({ onProgress } = {}) {
    try {
      return await cloudDatabase.getAllPatients(this.userId, { onProgress });
    } catch (e) {
      console.error('导出数据失败:', e);
      throw e;
    }
  }
}

module.exports = HybridStorage;
