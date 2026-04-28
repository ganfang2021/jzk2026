// 登录页面
const userManager = require('../../utils/userManager.js');

Page({
  data: {
    username: '',
    password: '',
    loading: false
  },

  onLoad: function(options) {
    // 检查是否已登录
    if (userManager.isLoggedIn()) {
      wx.switchTab({
        url: '/pages/index/index'
      });
    }
  },

  // 用户名输入
  onUsernameInput: function(e) {
    this.setData({
      username: e.detail.value
    });
  },

  // 密码输入
  onPasswordInput: function(e) {
    this.setData({
      password: e.detail.value
    });
  },

  // 登录
  onLogin: function() {
    const username = this.data.username.trim();
    const password = this.data.password;

    if (!username) {
      wx.showToast({
        title: '请输入用户名',
        icon: 'none'
      });
      return;
    }

    if (!password) {
      wx.showToast({
        title: '请输入密码',
        icon: 'none'
      });
      return;
    }

    this.setData({
      loading: true
    });

    const result = userManager.login(username, password);

    setTimeout(() => {
      this.setData({
        loading: false
      });

      if (result.success) {
        wx.showToast({
          title: '登录成功',
          icon: 'success',
          duration: 1500
        });

        // 更新全局用户状态并自动从云端同步数据
        var app = getApp();
        app.globalData.currentUser = result.user;
        app.syncFromCloud().then(function(syncResult) {
          if (syncResult.success && syncResult.synced > 0) {
            console.log('登录后云同步完成:', syncResult.synced, '条');
          }
          // 同步完成后重新加载患者数据到全局
          app.loadPatients();
        }).catch(function(e) {
          console.warn('登录后云同步失败:', e);
          // 同步失败也要重新加载（使用本地数据）
          app.loadPatients();
        });

        setTimeout(() => {
          wx.switchTab({
            url: '/pages/index/index'
          });
        }, 1500);
      } else {
        wx.showToast({
          title: result.message,
          icon: 'none',
          duration: 2000
        });
      }
    }, 500);
  },

  // 跳转注册页面
  onRegister: function() {
    wx.navigateTo({
      url: '/pages/register/register'
    });
  }
});
