// 患者修改密码管理器
// 患者数据修改需要验证密码，只有知道密码才能修改患者资料

const crypto = require('crypto-js');

class PatientPasswordManager {
  constructor() {
    // 密码相关配置
    this.config = {
      minLength: 6,
      maxLength: 20,
      requireNumber: true,
      requireLetter: false
    };
  }

  // ==================== 密码哈希 ====================

  // 生成密码哈希
  hashPassword(password, salt = null) {
    const useSalt = salt || this.generateSalt();
    const hash = crypto.SHA256(password + useSalt).toString();
    return {
      hash: hash,
      salt: useSalt
    };
  }

  // 验证密码
  verifyPassword(password, storedHash, storedSalt) {
    const { hash } = this.hashPassword(password, storedSalt);
    return hash === storedHash;
  }

  // 生成盐值
  generateSalt() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }

  // ==================== 密码验证 ====================

  // 验证密码强度
  validatePasswordStrength(password) {
    const errors = [];

    if (!password || password.length === 0) {
      errors.push('密码不能为空');
      return { valid: false, errors };
    }

    if (password.length < this.config.minLength) {
      errors.push(`密码长度至少${this.config.minLength}位`);
    }

    if (password.length > this.config.maxLength) {
      errors.push(`密码长度最多${this.config.maxLength}位`);
    }

    if (this.config.requireNumber && !/\d/.test(password)) {
      errors.push('密码必须包含数字');
    }

    if (this.config.requireLetter && !/[a-zA-Z]/.test(password)) {
      errors.push('密码必须包含字母');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // ==================== 患者修改密码操作 ====================

  // 设置患者修改密码
  async setPatientPassword(patientId, password, userId) {
    // 验证密码强度
    const validation = this.validatePasswordStrength(password);
    if (!validation.valid) {
      throw new Error(validation.errors.join('; '));
    }

    // 获取云数据库
    const cloudDatabase = require('./cloudDatabase.js');
    await cloudDatabase.init();

    // 生成密码哈希
    const { hash, salt } = this.hashPassword(password);

    // 更新患者密码
    try {
      await cloudDatabase.updatePatient(patientId, {
        modifyPasswordHash: hash,
        modifyPasswordSalt: salt
      }, userId);

      return { success: true };
    } catch (e) {
      console.error('设置患者密码失败:', e);
      throw new Error('设置密码失败');
    }
  }

  // 验证患者修改密码
  async verifyPatientPassword(patientId, password, userId) {
    const cloudDatabase = require('./cloudDatabase.js');
    await cloudDatabase.init();

    // 获取患者数据
    const patient = await cloudDatabase.getPatient(patientId, userId);
    
    if (!patient) {
      throw new Error('患者不存在');
    }

    if (!patient.modifyPasswordHash || !patient.modifyPasswordSalt) {
      // 未设置密码，不验证
      return { verified: true, hasPassword: false };
    }

    // 验证密码
    const verified = this.verifyPassword(
      password, 
      patient.modifyPasswordHash, 
      patient.modifyPasswordSalt
    );

    return {
      verified,
      hasPassword: true
    };
  }

  // 修改患者数据 (带密码验证)
  async updatePatientWithPassword(patientId, updateData, password, userId) {
    // 验证密码
    const verification = await this.verifyPatientPassword(patientId, password, userId);
    
    if (!verification.verified) {
      throw new Error('密码错误，无法修改患者数据');
    }

    // 获取云数据库
    const cloudDatabase = require('./cloudDatabase.js');
    await cloudDatabase.init();

    // 执行更新
    try {
      const result = await cloudDatabase.updatePatient(patientId, updateData, userId);
      return result;
    } catch (e) {
      console.error('更新患者数据失败:', e);
      throw new Error('更新失败');
    }
  }

  // 重置患者修改密码 (管理员)
  async resetPatientPassword(patientId, newPassword, adminUserId) {
    // 验证新密码强度
    const validation = this.validatePasswordStrength(newPassword);
    if (!validation.valid) {
      throw new Error(validation.errors.join('; '));
    }

    const cloudDatabase = require('./cloudDatabase.js');
    await cloudDatabase.init();

    // 生成新密码哈希
    const { hash, salt } = this.hashPassword(newPassword);

    try {
      await cloudDatabase.updatePatient(patientId, {
        modifyPasswordHash: hash,
        modifyPasswordSalt: salt
      }, adminUserId);

      // 记录审计日志
      cloudDatabase.logAuditAsync(adminUserId, patientId, 'PASSWORD_RESET', null, {
        resetAt: new Date().toISOString()
      });

      return { success: true };
    } catch (e) {
      console.error('重置密码失败:', e);
      throw new Error('重置密码失败');
    }
  }

  // 检查患者是否有修改密码
  async hasPatientPassword(patientId, userId) {
    const cloudDatabase = require('./cloudDatabase.js');
    await cloudDatabase.init();

    const patient = await cloudDatabase.getPatient(patientId, userId);
    
    if (!patient) {
      return false;
    }

    return !!(patient.modifyPasswordHash && patient.modifyPasswordSalt);
  }

  // 移除患者修改密码
  async removePatientPassword(patientId, userId) {
    const cloudDatabase = require('./cloudDatabase.js');
    await cloudDatabase.init();

    try {
      await cloudDatabase.updatePatient(patientId, {
        modifyPasswordHash: null,
        modifyPasswordSalt: null
      }, userId);

      return { success: true };
    } catch (e) {
      console.error('移除密码失败:', e);
      throw new Error('移除密码失败');
    }
  }
}

module.exports = new PatientPasswordManager();
