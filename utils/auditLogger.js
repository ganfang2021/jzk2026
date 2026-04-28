// 审计日志管理器 - 记录所有操作日志
class AuditLogger {
  constructor(userId) {
    this.userId = userId;
    this.logKey = `audit_logs_${userId}`;
  }

  // 记录操作日志
  log(action, details) {
    const logs = wx.getStorageSync(this.logKey) || [];

    logs.unshift({
      action,
      details,
      timestamp: new Date().toISOString(),
      userId: this.userId,
      userAgent: this.getUserAgent()
    });

    // 只保留最近1000条日志
    if (logs.length > 1000) {
      logs.splice(1000);
    }

    wx.setStorageSync(this.logKey, logs);
  }

  // 获取日志列表
  getLogs(limit = 100, offset = 0) {
    const logs = wx.getStorageSync(this.logKey) || [];
    return {
      logs: logs.slice(offset, offset + limit),
      total: logs.length,
      offset,
      limit
    };
  }

  // 按时间范围获取日志
  getLogsByTimeRange(startDate, endDate, limit = 100) {
    const logs = wx.getStorageSync(this.logKey) || [];

    const filtered = logs.filter(log => {
      const logTime = new Date(log.timestamp);
      return logTime >= new Date(startDate) && logTime <= new Date(endDate);
    });

    return {
      logs: filtered.slice(0, limit),
      total: filtered.length
    };
  }

  // 按操作类型获取日志
  getLogsByAction(action, limit = 100) {
    const logs = wx.getStorageSync(this.logKey) || [];

    const filtered = logs.filter(log => log.action === action);

    return {
      logs: filtered.slice(0, limit),
      total: filtered.length
    };
  }

  // 清空日志
  clearLogs() {
    wx.removeStorageSync(this.logKey);
  }

  // 导出日志
  exportLogs() {
    const logs = wx.getStorageSync(this.logKey) || [];

    const header = ['时间', '操作', '详情', '用户ID'];
    const rows = logs.map(log => [
      log.timestamp,
      log.action,
      JSON.stringify(log.details),
      log.userId
    ]);

    let csv = header.join(',') + '\n';
    rows.forEach(row => {
      csv += row.map(cell => `"${cell || ''}"`).join(',') + '\n';
    });

    const filePath = `${wx.env.USER_DATA_PATH}/audit_logs_${Date.now()}.csv`;
    const fs = wx.getFileSystemManager();

    try {
      fs.writeFileSync(filePath, csv, 'utf-8');
      return filePath;
    } catch (e) {
      console.error('导出日志失败:', e);
      throw e;
    }
  }

  // 获取统计信息
  getStatistics() {
    const logs = wx.getStorageSync(this.logKey) || [];

    const stats = {
      total: logs.length,
      byAction: {},
      byDate: {}
    };

    logs.forEach(log => {
      // 按操作类型统计
      stats.byAction[log.action] = (stats.byAction[log.action] || 0) + 1;

      // 按日期统计
      const date = log.timestamp.split('T')[0];
      stats.byDate[date] = (stats.byDate[date] || 0) + 1;
    });

    return stats;
  }

  // 获取用户代理信息
  getUserAgent() {
    try {
      const systemInfo = wx.getSystemInfoSync();
      return `${systemInfo.platform} ${systemInfo.system}`;
    } catch (e) {
      return 'unknown';
    }
  }

  // 记录患者操作
  logPatientAction(action, patient, details = {}) {
    this.log(`PATIENT_${action}`, {
      patientId: patient.id,
      patientName: patient.name,
      triageLevel: patient.triageLevel,
      ...details
    });
  }

  // 记录登录操作
  logLogin(userId, username, success = true) {
    this.log('LOGIN', {
      userId,
      username,
      success,
      timestamp: new Date().toISOString()
    });
  }

  // 记录登出操作
  logLogout(userId, username) {
    this.log('LOGOUT', {
      userId,
      username,
      timestamp: new Date().toISOString()
    });
  }

  // 记录数据同步操作
  logSync(type, details) {
    this.log('SYNC', {
      type,
      ...details
    });
  }

  // 记录导入导出操作
  logImportExport(type, details) {
    this.log(type, {
      ...details
    });
  }

  // 记录配置变更
  logConfigChange(key, oldValue, newValue) {
    this.log('CONFIG_CHANGE', {
      key,
      oldValue,
      newValue
    });
  }
}

module.exports = AuditLogger;
