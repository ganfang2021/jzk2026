// 登录页面
const userManager = require('../../utils/userManager.js');
const captchaManager = require('../../utils/captchaManager.js');

Page({
  data: {
    username: '',
    password: '',
    captcha: '',
    captchaId: '',
    captchaText: '???',
    loading: false
  },

  onLoad: function(options) {
    // 检查是否已登录
    if (userManager.isLoggedIn()) {
      wx.switchTab({
        url: '/pages/index/index'
      });
    }
    // 生成初始验证码
    this.generateCaptcha();
  },

  // 生成验证码
  generateCaptcha: function() {
    var captchaData = captchaManager.generateCaptchaData();
    if (captchaData) {
      this.setData({
        captchaId: captchaData.id,
        captchaText: captchaData.question
      });
    }
  },

  // 刷新验证码
  onRefreshCaptcha: function() {
    this.generateCaptcha();
    this.setData({ captcha: '' });
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

  // 验证码输入
  onCaptchaInput: function(e) {
    this.setData({
      captcha: e.detail.value
    });
  },

  // 登录
  onLogin: async function() {
    const username = this.data.username.trim();
    const password = this.data.password;
    const captcha = this.data.captcha.trim();

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

    if (!captcha) {
      wx.showToast({
        title: '请输入验证码',
        icon: 'none'
      });
      return;
    }

    // 验证验证码
    var captchaResult = captchaManager.verify(captcha);
    if (!captchaResult.success) {
      wx.showToast({
        title: captchaResult.message,
        icon: 'none'
      });
      this.onRefreshCaptcha();
      return;
    }

    this.setData({
      loading: true
    });

    const result = userManager.login(username, password);

    if (result.success) {
      wx.showToast({
        title: '登录成功',
        icon: 'success',
        duration: 1500
      });

      // 更新全局用户状态
      var app = getApp();
      app.globalData.currentUser = result.user;

      // 清除全局患者数据缓存，确保切换用户后加载正确数据
      app.globalData.patients = [];

      // 清理存储中的重复数据（登录时执行去重）
      app.deduplicateStorage();

      // 先加载一次本地数据（当前用户的数据）
      app.loadPatients();

      // 再异步从云端同步
      try {
        var syncResult = await app.syncFromCloud();
        if (syncResult.success && syncResult.synced > 0) {
          console.log('登录后云同步完成:', syncResult.synced, '条');
        }
        // 同步完成后重新加载患者数据
        app.loadPatients();
      } catch (e) {
        console.warn('登录后云同步失败:', e);
      }

      setTimeout(() => {
        wx.switchTab({
          url: '/pages/index/index'
        });
      }, 1500);
    } else {
      this.setData({
        loading: false
      });
      wx.showToast({
        title: result.message,
        icon: 'none',
        duration: 2000
      });
      // 登录失败后刷新验证码
      this.onRefreshCaptcha();
    }
  },

  // 跳转注册页面
  onRegister: function() {
    wx.navigateTo({
      url: '/pages/register/register'
    });
  }
});
