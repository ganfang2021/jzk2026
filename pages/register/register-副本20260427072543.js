// 注册页面
const userManager = require('../../utils/userManager.js');

Page({
  data: {
    username: '',
    password: '',
    confirmPassword: '',
    nickname: '',
    role: 'doctor',
    roleRange: ['医生', '护士', '管理员'],
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

  // 确认密码输入
  onConfirmPasswordInput: function(e) {
    this.setData({
      confirmPassword: e.detail.value
    });
  },

  // 昵称输入
  onNicknameInput: function(e) {
    this.setData({
      nickname: e.detail.value
    });
  },

  // 角色选择
  onRoleChange: function(e) {
    var roles = ['doctor', 'nurse', 'admin'];
    this.setData({
      role: roles[e.detail.value] || 'doctor'
    });
  },

  // 注册
  onRegister: function() {
    const username = this.data.username.trim();
    const password = this.data.password;
    const confirmPassword = this.data.confirmPassword;
    const nickname = this.data.nickname.trim();

    // 参数验证
    if (!username) {
      wx.showToast({
        title: '请输入用户名',
        icon: 'none'
      });
      return;
    }

    if (username.length < 3 || username.length > 20) {
      wx.showToast({
        title: '用户名长度为3-20个字符',
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

    if (password.length < 6) {
      wx.showToast({
        title: '密码长度不能少于6位',
        icon: 'none'
      });
      return;
    }

    if (password !== confirmPassword) {
      wx.showToast({
        title: '两次密码输入不一致',
        icon: 'none'
      });
      return;
    }

    if (!nickname) {
      wx.showToast({
        title: '请输入昵称',
        icon: 'none'
      });
      return;
    }

    this.setData({
      loading: true
    });

    const result = userManager.register(username, password, nickname, this.data.role);

    setTimeout(() => {
      this.setData({
        loading: false
      });

      if (result.success) {
        wx.showModal({
          title: '注册成功',
          content: '账号已创建，请登录使用',
          showCancel: false,
          success: function() {
            wx.navigateBack();
          }
        });
      } else {
        wx.showToast({
          title: result.message,
          icon: 'none',
          duration: 2000
        });
      }
    }, 500);
  },

  // 返回登录
  onBack: function() {
    wx.navigateBack();
  }
});
