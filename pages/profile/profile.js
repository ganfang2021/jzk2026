// 个人中心页面
const app = getApp();
const userManager = require('../../utils/userManager.js');

Page({
  data: {
    currentUser: null,
    appVersion: '1.0.0',
    allUsers: [], // 管理员：所有用户列表
    cloudStats: null // 管理员：云端统计
  },

  onLoad: function() {
    if (!app.checkLogin()) {
      return;
    }
    this.loadData();
  },

  onShow: function() {
    this.loadData();
  },

  loadData: function() {
    this.loadUserData();
    this.loadAllUsers();
    this.loadCloudStats();
  },

  loadUserData: function() {
    var currentUser = userManager.getCurrentUser();
    if (!currentUser) {
      currentUser = {
        nickname: '未登录',
        username: '--',
        role: 'unknown',
        loginTime: '--'
      };
    }
    app.globalData.currentUser = currentUser;
    this.setData({ currentUser: currentUser });
  },

  // 管理员：加载所有用户
  loadAllUsers: function() {
    var currentUser = userManager.getCurrentUser();
    if (!currentUser || currentUser.role !== 'admin') {
      return;
    }
    var users = userManager.getAllUsers();
    // 按创建时间排序，最新的在前
    users.sort(function(a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    this.setData({ allUsers: users });
  },

  // 管理员：加载云端统计数据
  loadCloudStats: function() {
    var currentUser = userManager.getCurrentUser();
    if (!currentUser || currentUser.role !== 'admin') {
      return;
    }
    var self = this;
    var cloudStorage = require('../../utils/cloudStorageManager.js');
    cloudStorage.getCloudStats().then(function(stats) {
      self.setData({ cloudStats: stats });
    }).catch(function(e) {
      console.error('加载云端统计失败:', e);
    });
  },

  // 管理员：添加用户
  onAddUser: function() {
    var self = this;
    wx.showModal({
      title: '添加用户',
      content: ' ',
      showCancel: false,
      editable: true,
      placeholderText: '输入用户名（3-20个字符）',
      success: function(res) {
        if (res.confirm && res.content) {
          self.showAddPasswordModal(res.content);
        }
      }
    });
  },

  showAddPasswordModal: function(username) {
    var self = this;
    wx.showModal({
      title: '设置密码',
      content: ' ',
      showCancel: true,
      cancelText: '取消',
      confirmText: '下一步',
      editable: true,
      placeholderText: '密码（至少6位）',
      success: function(res) {
        if (res.confirm && res.content) {
          if (res.content.length < 6) {
            wx.showToast({ title: '密码至少6位', icon: 'none' });
            return;
          }
          self.showAddNicknameModal(username, res.content);
        }
      }
    });
  },

  showAddNicknameModal: function(username, password) {
    var self = this;
    wx.showModal({
      title: '设置昵称',
      content: ' ',
      showCancel: true,
      cancelText: '取消',
      confirmText: '下一步',
      editable: true,
      placeholderText: '输入昵称',
      success: function(res) {
        if (res.confirm && res.content) {
          self.showAddRolePicker(username, password, res.content);
        }
      }
    });
  },

  showAddRolePicker: function(username, password, nickname) {
    var self = this;
    wx.showActionSheet({
      itemList: ['医生', '护士'],
      success: function(res) {
        var role = res.tapIndex === 0 ? 'doctor' : 'nurse';
        self.doAddUser(username, password, nickname, role);
      }
    });
  },

  doAddUser: function(username, password, nickname, role) {
    var result = userManager.addUser(username, password, nickname, role);
    if (result.success) {
      wx.showToast({ title: '添加成功', icon: 'success' });
      this.loadAllUsers();
    } else {
      wx.showToast({ title: result.message, icon: 'none' });
    }
  },

  // 管理员：删除用户
  onDeleteUser: function(e) {
    var userId = e.currentTarget.dataset.id;
    var userName = e.currentTarget.dataset.name;
    var self = this;

    wx.showModal({
      title: '确认删除',
      content: '确定要删除用户「' + userName + '」吗？\n该用户的所有患者数据将被删除！',
      cancelText: '取消',
      confirmText: '删除',
      confirmColor: '#C62828',
      success: function(res) {
        if (res.confirm) {
          var result = userManager.deleteUser(userId);
          if (result.success) {
            wx.showToast({ title: '已删除', icon: 'success' });
            self.loadAllUsers();
            // 刷新患者数据
            app.loadPatients();
          } else {
            wx.showToast({ title: result.message, icon: 'none' });
          }
        }
      }
    });
  },

  // 从云端同步数据到本地（所有用户可用）
  onSyncFromCloud: function() {
    var self = this;
    wx.showModal({
      title: '从云端同步',
      content: '将从云端拉取所有患者数据并合并到本地。\n继续吗？',
      success: function(res) {
        if (res.confirm) {
          self.doSyncFromCloud();
        }
      }
    });
  },

  doSyncFromCloud: async function() {
    try {
      wx.showLoading({ title: '正在从云端同步...', mask: true });
      var result = await app.syncFromCloud();
      wx.hideLoading();

      if (result.success) {
        var message = '同步完成';
        if (result.synced > 0) {
          message = '新增 ' + result.added + ' 条，更新 ' + result.updated + ' 条';
        } else {
          message = result.message || '云端暂无新数据';
        }
        wx.showModal({
          title: '同步完成',
          content: message,
          showCancel: false
        });
      } else {
        wx.showToast({ title: result.message || '同步失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '同步失败: ' + e.message, icon: 'none' });
    }
  },

  // 管理员：手动同步到云端
  onSyncToCloud: function() {
    var self = this;
    wx.showModal({
      title: '同步到云端',
      content: '将强制上传所有患者数据到云端。\n继续吗？',
      success: function(res) {
        if (res.confirm) {
          self.doSyncToCloud();
        }
      }
    });
  },

  doSyncToCloud: async function() {
    try {
      wx.showLoading({ title: '正在同步到云端...', mask: true });
      app.syncAdminDataToCloud();
      // 给云同步一点时间
      await new Promise(function(resolve) { setTimeout(resolve, 2000); });
      wx.hideLoading();
      wx.showToast({ title: '已触发云端同步', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '同步失败', icon: 'none' });
    }
  },

  // 退出登录
  onLogout: function() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: function(res) {
        if (res.confirm) {
          app.logout();
        }
      }
    });
  },

  // 修改密码
  onChangePassword: function() {
    var self = this;
    wx.showModal({
      title: '修改密码',
      content: '',
      showCancel: false,
      editable: true,
      placeholderText: '请输入旧密码',
      success: function(res) {
        if (res.confirm && res.content) {
          self.verifyOldPassword(res.content.trim());
        } else if (res.confirm && !res.content) {
          wx.showToast({ title: '请输入旧密码', icon: 'none' });
        }
      }
    });
  },

  verifyOldPassword: function(oldPassword) {
    var self = this;
    wx.showModal({
      title: '新密码',
      content: '',
      showCancel: true,
      cancelText: '取消',
      confirmText: '确认修改',
      editable: true,
      placeholderText: '请输入新密码（至少6位）',
      success: function(res) {
        if (res.confirm && res.content) {
          var newPassword = res.content.trim();
          if (newPassword.length < 6) {
            wx.showToast({ title: '密码至少6位', icon: 'none' });
            return;
          }
          var result = userManager.changePassword(oldPassword, newPassword);
          if (result.success) {
            wx.showToast({ title: '密码修改成功', icon: 'success' });
          } else {
            wx.showToast({ title: result.message, icon: 'none' });
          }
        }
      }
    });
  }
});
