// 用户管理器 - 处理注册、登录、数据隔离
class UserManager {
  constructor() {
    this.USER_DATA_KEY = 'emergency_users';
    this.CURRENT_USER_KEY = 'emergency_current_user';
    this.LEGACY_DATA_KEY = 'emergencyPatients';
  }

  // 初始化用户管理器
  init() {
    this.migrateLegacyData();
    this.presetDoctors();
    this.ensureAdminAccount();
    this.ensureTestAccount();
  }

  // 迁移旧数据（保护现有患者数据）
  migrateLegacyData() {
    try {
      var legacyData = wx.getStorageSync(this.LEGACY_DATA_KEY);
      var migrationFlag = wx.getStorageSync('data_migrated');

      if (legacyData && Array.isArray(legacyData) && !migrationFlag) {
        var users = this.getAllUsers();

        if (users.length === 0) {
          var randomPassword = this._generateRandomPassword();

          var defaultAdmin = {
            id: 'ADMIN_' + Date.now(),
            username: 'admin',
            password: this.encryptPassword(randomPassword, 'admin'),
            nickname: '系统管理员',
            role: 'admin',
            createdAt: new Date().toISOString(),
            patientCount: legacyData.length,
            defaultPasswordSet: true
          };

          wx.setStorageSync(this.USER_DATA_KEY, [defaultAdmin]);
          wx.setStorageSync(this.getUserDataKey(defaultAdmin.id), legacyData);
          wx.setStorageSync('initial_password', randomPassword);
          wx.setStorageSync('data_migrated', true);

          console.log('数据迁移完成，创建默认管理员账号');
          console.log('迁移患者数据:', legacyData.length, '条');
        }
      }
    } catch (e) {
      console.error('数据迁移失败:', e);
    }
  }

  // 生成随机密码（8位字母数字混合）
  _generateRandomPassword() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    var password = '';
    for (var i = 0; i < 8; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  // 获取初始密码（用于首次登录提示）
  getInitialPassword() {
    return wx.getStorageSync('initial_password') || null;
  }

  // 获取所有用户
  getAllUsers() {
    try {
      var users = wx.getStorageSync(this.USER_DATA_KEY);
      return Array.isArray(users) ? users : [];
    } catch (e) {
      console.error('获取用户列表失败:', e);
      return [];
    }
  }

  // 用户注册
  register(username, password, nickname, role) {
    if (!role) role = 'doctor';
    if (!username || !password || !nickname) {
      return { success: false, message: '请填写完整信息' };
    }

    if (username.length < 3 || username.length > 20) {
      return { success: false, message: '用户名长度为3-20个字符' };
    }

    if (password.length < 6) {
      return { success: false, message: '密码长度不能少于6位' };
    }

    var users = this.getAllUsers();
    var exists = users.some(function(u) { return u.username === username; });
    if (exists) {
      return { success: false, message: '用户名已存在' };
    }

    var newUser = {
      id: 'USER_' + Date.now() + Math.random().toString(36).slice(2, 11),
      username: username,
      password: this.encryptPassword(password, username),
      nickname: nickname,
      role: role,
      createdAt: new Date().toISOString(),
      patientCount: 0
    };

    users.push(newUser);
    wx.setStorageSync(this.USER_DATA_KEY, users);
    wx.setStorageSync(this.getUserDataKey(newUser.id), []);

    return {
      success: true,
      message: '注册成功',
      user: {
        id: newUser.id,
        username: newUser.username,
        nickname: newUser.nickname,
        role: newUser.role
      }
    };
  }

  // 用户登录（带暴力破解防护和首次密码修改检查）
  login(username, password) {
    if (!username || !password) {
      return { success: false, message: '请输入用户名和密码' };
    }

    // 检查是否被锁定
    var lockInfo = this._getLoginLock(username);
    if (lockInfo && lockInfo.locked) {
      var remainMin = Math.ceil((lockInfo.lockUntil - Date.now()) / 60000);
      if (remainMin > 0) {
        return { success: false, message: '账号已锁定，请' + remainMin + '分钟后重试' };
      }
      this._clearLoginAttempts(username);
    }

    var users = this.getAllUsers();
    var user = users.find(function(u) { return u.username === username; });

    if (!user) {
      this._recordLoginAttempt(username);
      return { success: false, message: '用户名或密码错误' };
    }

    var encryptedPassword = this.encryptPassword(password, user.username);
    if (user.password !== encryptedPassword) {
      this._recordLoginAttempt(username);
      return { success: false, message: '用户名或密码错误' };
    }

    this._clearLoginAttempts(username);

    var session = {
      userId: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
      loginTime: new Date().toISOString(),
      needPasswordChange: user.isPreset && !user.passwordChanged
    };
    wx.setStorageSync(this.CURRENT_USER_KEY, session);

    return {
      success: true,
      message: '登录成功',
      user: session
    };
  }
  // 记录登录失败尝试（5次后锁定30分钟）
  _recordLoginAttempt(username) {
    var attempts = wx.getStorageSync('login_attempts') || {};
    var now = Date.now();
    if (!attempts[username]) {
      attempts[username] = { count: 1, firstAttempt: now };
    } else {
      attempts[username].count++;
      attempts[username].lastAttempt = now;
    }
    if (attempts[username].count >= 5) {
      attempts[username].locked = true;
      attempts[username].lockUntil = now + 30 * 60 * 1000;
    }
    wx.setStorageSync('login_attempts', attempts);
  }
  _getLoginLock(username) {
    var attempts = wx.getStorageSync('login_attempts') || {};
    return attempts[username] || null;
  }
  _clearLoginAttempts(username) {
    var attempts = wx.getStorageSync('login_attempts') || {};
    delete attempts[username];
    wx.setStorageSync('login_attempts', attempts);
  }
  // 用户登出
  logout() {
    wx.removeStorageSync(this.CURRENT_USER_KEY);
    return { success: true, message: '已退出登录' };
  }
  // 获取当前登录用户
  getCurrentUser() {
    try {
      var session = wx.getStorageSync(this.CURRENT_USER_KEY);
      return session || null;
    } catch (e) {
      console.error('获取当前用户失败:', e);
      return null;
    }
  }
  // 检查是否已登录
  isLoggedIn() {
    return this.getCurrentUser() !== null;
  }
  // 修改密码
  changePassword(oldPassword, newPassword) {
    var currentUser = this.getCurrentUser();
    if (!currentUser) {
      return { success: false, message: '请先登录' };
    }

    if (!oldPassword || !newPassword) {
      return { success: false, message: '请输入旧密码和新密码' };
    }

    if (newPassword.length < 6) {
      return { success: false, message: '新密码长度不能少于6位' };
    }

    var users = this.getAllUsers();
    var userIndex = users.findIndex(function(u) { return u.id === currentUser.userId; });

    if (userIndex === -1) {
      return { success: false, message: '用户不存在' };
    }

    var encryptedOldPassword = this.encryptPassword(oldPassword, users[userIndex].username);
    if (users[userIndex].password !== encryptedOldPassword) {
      return { success: false, message: '旧密码错误' };
    }

    users[userIndex].password = this.encryptPassword(newPassword, users[userIndex].username);
    users[userIndex].passwordChanged = true;
    wx.setStorageSync(this.USER_DATA_KEY, users);

    // 更新会话标记
    if (currentUser.needPasswordChange) {
      currentUser.needPasswordChange = false;
      wx.setStorageSync(this.CURRENT_USER_KEY, currentUser);
    }

    return { success: true, message: '密码修改成功' };
  }
  // 重置用户密码（管理员/忘记密码场景）
  resetUserPassword(username) {
    var users = this.getAllUsers();
    var userIndex = users.findIndex(function(u) {
      return u.username === username;
    });

    if (userIndex === -1) {
      return { success: false, message: '用户不存在' };
    }

    var defaultPassword = '123456';
    users[userIndex].password = this.encryptPassword(defaultPassword, users[userIndex].username);
    users[userIndex].passwordChanged = false;
    wx.setStorageSync(this.USER_DATA_KEY, users);

    return {
      success: true,
      message: '密码已重置为 123456',
      username: users[userIndex].username
    };
  }
  // 获取用户数据存储键
  getUserDataKey(userId) {
    return 'emergency_patients_' + userId;
  }
  // 预置医生账户（每次启动时确保存在且密码正确）
  presetDoctors() {
    try {
      var config = require('../config.js');
      var doctors = config.doctors;
      if (!doctors || !Array.isArray(doctors) || doctors.length === 0) {
        console.warn('[presetDoctors] config.doctors 为空或无效');
        return;
      }

      console.log('[presetDoctors] config.doctors 加载成功，数量:', doctors.length);

      var users = this.getAllUsers();
      console.log('[presetDoctors] 当前已有用户:', users.length, '个');
      for (var ui = 0; ui < users.length; ui++) {
        console.log('[presetDoctors] 用户', ui, ':', users[ui].username, '/ role:', users[ui].role);
      }

      var modified = false;

      for (var i = 0; i < doctors.length; i++) {
        var docName = doctors[i];
        if (!docName || typeof docName !== 'string') {
          console.warn('[presetDoctors] 跳过无效医生名:', docName, typeof docName);
          continue;
        }

        console.log('[presetDoctors] 检查医生:', docName);

        // 查找是否已存在（精确匹配 username）
        var existingUser = null;
        var existingIndex = -1;
        for (var j = 0; j < users.length; j++) {
          if (users[j].username === docName) {
            existingUser = users[j];
            existingIndex = j;
            break;
          }
        }

        var correctPassword = this.encryptPassword('123456', docName);

        if (existingUser) {
          // 账户存在，校验密码是否正确
          if (existingUser.password !== correctPassword) {
            console.log('[presetDoctors] 密码不一致，正在修正:', docName);
            users[existingIndex].password = correctPassword;
            modified = true;
          } else {
            console.log('[presetDoctors] 密码正确，无需修改:', docName);
          }
        } else {
          // 账户缺失，创建新账户
          console.log('[presetDoctors] 账户不存在，创建:', docName);
          var newUser = {
            id: 'DOC_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 6),
            username: docName,
            password: correctPassword,
            nickname: docName,
            role: 'doctor',
            createdAt: new Date().toISOString(),
            patientCount: 0,
            isPreset: true
          };
          users.push(newUser);
          wx.setStorageSync(this.getUserDataKey(newUser.id), []);
          modified = true;
        }
      }

      if (modified) {
        wx.setStorageSync(this.USER_DATA_KEY, users);
        console.log('[presetDoctors] 用户列表已更新保存，当前总数:', users.length);
      } else {
        console.log('[presetDoctors] 无需修改，所有账户密码正确');
      }

      // 清理旧的预置标记（兼容旧版本）
      wx.removeStorageSync('doctors_presetted');
    } catch (e) {
      console.error('预置医生账户处理失败:', e);
    }
  }
  // 确保管理员账号存在（每次启动时校验密码正确）
  ensureAdminAccount() {
    try {
      var users = this.getAllUsers();
      var admin = users.find(function(u) { return u.username === 'admin'; });
      var correctPassword = this.encryptPassword('123456', 'admin');

      if (admin) {
        if (admin.password !== correctPassword) {
          console.log('[ensureAdmin] 管理员密码不一致，正在修正');
          admin.password = correctPassword;
          admin.isPreset = true;
          delete admin.defaultPasswordSet;
          wx.setStorageSync(this.USER_DATA_KEY, users);
        } else {
          console.log('[ensureAdmin] 管理员密码正确');
        }
        return;
      }

      console.log('[ensureAdmin] 管理员账户不存在，正在创建');
      var newAdmin = {
        id: 'ADMIN_' + Date.now(),
        username: 'admin',
        password: correctPassword,
        nickname: '系统管理员',
        role: 'admin',
        createdAt: new Date().toISOString(),
        patientCount: 0,
        isPreset: true
      };
      users.push(newAdmin);
      wx.setStorageSync(this.USER_DATA_KEY, users);
      wx.setStorageSync(this.getUserDataKey(newAdmin.id), []);
      console.log('管理员账号已创建');
    } catch (e) {
      console.error('确保管理员账号失败:', e);
    }
  }
  // 确保测试账号存在（每次启动时校验密码正确）
  ensureTestAccount() {
    try {
      var users = this.getAllUsers();
      var testUser = users.find(function(u) { return u.username === 'test'; });
      var correctPassword = this.encryptPassword('123456', 'test');

      if (testUser) {
        if (testUser.password !== correctPassword) {
          console.log('[ensureTestAccount] 测试账号密码不一致，正在修正');
          testUser.password = correctPassword;
          testUser.isPreset = true;
          wx.setStorageSync(this.USER_DATA_KEY, users);
        } else {
          console.log('[ensureTestAccount] 测试账号密码正确');
        }
        return;
      }

      console.log('[ensureTestAccount] 测试账号不存在，正在创建');
      var newTest = {
        id: 'TEST_' + Date.now(),
        username: 'test',
        password: correctPassword,
        nickname: '测试医生',
        role: 'doctor',
        createdAt: new Date().toISOString(),
        patientCount: 0,
        isPreset: true
      };
      users.push(newTest);
      wx.setStorageSync(this.USER_DATA_KEY, users);
      wx.setStorageSync(this.getUserDataKey(newTest.id), []);
      console.log('测试账号已创建');
    } catch (e) {
      console.error('创建测试账号失败:', e);
    }
  }
  // 管理员删除用户（同时删除用户数据）
  deleteUser(userId) {
    try {
      var currentUser = this.getCurrentUser();
      if (!currentUser || currentUser.role !== 'admin') {
        return { success: false, message: '无权限' };
      }

      var users = this.getAllUsers();
      var userIndex = users.findIndex(function(u) { return u.id === userId; });
      if (userIndex === -1) {
        return { success: false, message: '用户不存在' };
      }

      if (users[userIndex].id === currentUser.userId) {
        return { success: false, message: '不能删除当前登录账号' };
      }

      if (users[userIndex].role === 'admin') {
        return { success: false, message: '不能删除管理员账号' };
      }

      var userDataKey = this.getUserDataKey(userId);
      wx.removeStorageSync(userDataKey);

      users.splice(userIndex, 1);
      wx.setStorageSync(this.USER_DATA_KEY, users);

      return { success: true, message: '用户已删除' };
    } catch (e) {
      console.error('删除用户失败:', e);
      return { success: false, message: '删除失败: ' + e.message };
    }
  }
  // 管理员添加用户
  addUser(username, password, nickname, role) {
    try {
      var currentUser = this.getCurrentUser();
      if (!currentUser || currentUser.role !== 'admin') {
        return { success: false, message: '无权限' };
      }

      return this.register(username, password, nickname, role);
    } catch (e) {
      console.error('添加用户失败:', e);
      return { success: false, message: '添加失败: ' + e.message };
    }
  }
  // 获取用户的患者数据
  getUserPatientData(userId) {
    try {
      var data = wx.getStorageSync(this.getUserDataKey(userId));
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.error('获取用户患者数据失败:', e);
      return [];
    }
  }
  // 设置用户的患者数据
  setUserPatientData(userId, data) {
    try {
      wx.setStorageSync(this.getUserDataKey(userId), data);
      return true;
    } catch (e) {
      console.error('保存用户患者数据失败:', e);
      return false;
    }
  }
  // 密码加密（增强版 - 使用多轮哈希防止彩虹表攻击）
  encryptPassword(password, username) {
    var dynamicSalt = 'emergency_salt_key_2024';

    if (username) {
      dynamicSalt = username + '_' + dynamicSalt;
    }

    var hash = this._simpleHash(password + dynamicSalt);

    for (var i = 0; i < 1000; i++) {
      hash = this._simpleHash(hash + dynamicSalt + i.toString());
    }

    return hash;
  }
  // 简单哈希函数 (djb2)
  _simpleHash(str) {
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
  // 获取用户信息
  getUserInfo(userId) {
    var users = this.getAllUsers();
    return users.find(function(u) { return u.id === userId; });
  }
  // 更新用户患者数量
  updateUserPatientCount(userId, count) {
    var users = this.getAllUsers();
    var userIndex = users.findIndex(function(u) { return u.id === userId; });
    if (userIndex !== -1) {
      users[userIndex].patientCount = count;
      wx.setStorageSync(this.USER_DATA_KEY, users);
    }
  }
}

// 导出单例
module.exports = new UserManager();
