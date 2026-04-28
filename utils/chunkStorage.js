// 分片存储管理器 - 支持大数据量存储(10万+患者)
const config = require('../config.js');

class ChunkStorage {
  constructor(userId) {
    this.userId = userId;
    this.chunkSize = config.database.chunkSize; // 每片1000条
    this.maxChunks = config.database.maxChunks; // 最大100片
    this.indexCache = null;
    this.lastIndexUpdate = 0;
  }

  // 获取数据键
  getChunkKey(chunkIndex) {
    return `patients_${this.userId}_chunk_${chunkIndex}`;
  }

  getIndexKey() {
    return `patients_${this.userId}_index`;
  }

  // 获取总患者数
  async getTotalCount() {
    if (!this.indexCache || Date.now() - this.lastIndexUpdate > config.database.indexRefreshInterval) {
      await this.buildIndex();
    }
    return this.indexCache ? this.indexCache.length : 0;
  }

  // 构建索引
  async buildIndex() {
    let index = [];
    for (let i = 0; i < this.maxChunks; i++) {
      const chunk = await this.getChunk(i);
      if (chunk && chunk.patients) {
        chunk.patients.forEach((patient, idx) => {
          if (!patient.deleted) {
            index.push({
              id: patient.id,
              name: patient.name,
              triageLevel: patient.triageLevel,
              createdAt: patient.createdAt,
              chunkIndex: i,
              patientIndex: idx
            });
          }
        });
      } else {
        break; // 没有更多数据
      }
    }
    this.indexCache = index;
    this.lastIndexUpdate = Date.now();
    wx.setStorageSync(this.getIndexKey(), index);
    return index;
  }

  // 获取分片
  getChunk(chunkIndex) {
    try {
      return wx.getStorageSync(this.getChunkKey(chunkIndex));
    } catch (e) {
      console.error('获取分片失败:', e);
      return null;
    }
  }

  // 保存分片
  saveChunk(chunkIndex, chunk) {
    try {
      wx.setStorageSync(this.getChunkKey(chunkIndex), chunk);
      return true;
    } catch (e) {
      console.error('保存分片失败:', e);
      return false;
    }
  }

  // 添加患者
  async addPatient(patient) {
    const totalCount = await this.getTotalCount();
    const chunkIndex = Math.floor(totalCount / this.chunkSize);
    const patientIndex = totalCount % this.chunkSize;

    let chunk = await this.getChunk(chunkIndex);
    if (!chunk) {
      chunk = { patients: [] };
    }

    // 确保数组长度足够
    while (chunk.patients.length <= patientIndex) {
      chunk.patients.push(null);
    }

    chunk.patients[patientIndex] = patient;
    chunk.count = (chunk.count || 0) + 1;

    if (!this.saveChunk(chunkIndex, chunk)) {
      throw new Error('保存患者数据失败');
    }

    // 更新索引
    await this.buildIndex();
    return patient;
  }

  // 获取患者
  async getPatient(id) {
    if (!this.indexCache) {
      await this.buildIndex();
    }

    const indexItem = this.indexCache.find(item => item.id === id);
    if (!indexItem) return null;

    const chunk = await this.getChunk(indexItem.chunkIndex);
    if (!chunk) return null;

    const patient = chunk.patients[indexItem.patientIndex];
    return patient && !patient.deleted ? patient : null;
  }

  // 更新患者
  async updatePatient(id, data) {
    if (!this.indexCache) {
      await this.buildIndex();
    }

    const indexItem = this.indexCache.find(item => item.id === id);
    if (!indexItem) return false;

    const chunk = await this.getChunk(indexItem.chunkIndex);
    if (!chunk) return false;

    chunk.patients[indexItem.patientIndex] = Object.assign({}, chunk.patients[indexItem.patientIndex], data, {
      updatedAt: new Date().toISOString()
    });

    return this.saveChunk(indexItem.chunkIndex, chunk);
  }

  // 删除患者(软删除)
  async deletePatient(id) {
    if (!this.indexCache) {
      await this.buildIndex();
    }

    const indexItem = this.indexCache.find(item => item.id === id);
    if (!indexItem) return false;

    const chunk = await this.getChunk(indexItem.chunkIndex);
    if (!chunk) return false;

    // 标记为删除(软删除)
    chunk.patients[indexItem.patientIndex].deleted = true;
    chunk.patients[indexItem.patientIndex].deletedAt = new Date().toISOString();

    const result = this.saveChunk(indexItem.chunkIndex, chunk);
    if (result) {
      // 重建索引
      await this.buildIndex();
    }
    return result;
  }

  // 分页查询
  async queryPatients(page = 1, pageSize = 20, filters = {}) {
    if (!this.indexCache) {
      await this.buildIndex();
    }

    let filtered = [...this.indexCache];

    // 应用筛选条件
    if (filters.startDate) {
      const startDate = new Date(filters.startDate);
      filtered = filtered.filter(item => new Date(item.createdAt) >= startDate);
    }

    if (filters.searchTerm) {
      const term = filters.searchTerm.toLowerCase();
      filtered = filtered.filter(item =>
        item.name && item.name.toLowerCase().includes(term)
      );
    }

    if (filters.triageLevel) {
      filtered = filtered.filter(item => item.triageLevel === filters.triageLevel);
    }

    // 排序
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // 分页
    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize);
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const pageIndexes = filtered.slice(startIndex, endIndex);

    // 加载实际患者数据
    const patients = [];
    for (const indexItem of pageIndexes) {
      const patient = await this.getPatient(indexItem.id);
      if (patient) {
        patients.push(patient);
      }
    }

    return {
      patients,
      page,
      pageSize,
      total,
      totalPages
    };
  }

  // 获取所有患者(用于导出等操作,注意性能)
  async getAllPatients() {
    if (!this.indexCache) {
      await this.buildIndex();
    }

    const patients = [];
    for (const indexItem of this.indexCache) {
      const patient = await this.getPatient(indexItem.id);
      if (patient) {
        patients.push(patient);
      }
    }
    return patients;
  }
}

module.exports = ChunkStorage;
