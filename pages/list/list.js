const app = getApp();
const eventBus = require('../../utils/eventBus.js');
const formatTime = require('../../utils/formatTime.js');

Page({
  data: {
    patients: [],
    filteredPatients: [],
    displayPatients: [],   // 当前渲染的可见子集
    searchTerm: '',
    currentPeriod: 'today',
    showDeleteModal: false,
    deletePatientId: '',
    deletePatientName: '',
    currentUser: null,
    visibleHeight: 800,
    totalCount: 0,
    displayCount: 30,      // 当前已渲染数量
    pageSize: 30,           // 每次加载数量
    hasMore: false           // 是否还有更多
  },

  onLoad: function() {
    if (!app.checkLogin()) return;

    var currentUser = app.getCurrentUser();
    this.setData({ currentUser: currentUser });

    var systemInfo = wx.getSystemInfoSync();
    var windowHeight = systemInfo.windowHeight;
    this.setData({ visibleHeight: Math.floor(windowHeight * 2 - 400) });

    this.loadPatients();
  },

  onShow: function() {
    this.loadPatients();
  },

  loadPatients: function() {
    app.loadPatients();
    var patients = app.globalData.patients || [];

    // 每次都从 app 获取最新用户，避免切换用户后显示旧用户数据
    var currentUser = app.getCurrentUser();
    this.setData({ currentUser: currentUser });

    if (currentUser && currentUser.role !== 'admin') {
      patients = patients.filter(function(p) {
        return p.createdBy === currentUser.userId;
      });
    }

    this.setData({ patients: patients });
    this.applyFilters();
  },

  onSearch: function(e) {
    var value = e.detail.value || '';
    this.setData({ searchTerm: value });
    this.applyFilters();
  },

  setTimePeriod: function(e) {
    var period = e.currentTarget.dataset.period;
    this.setData({ currentPeriod: period });
    this.applyFilters();
  },

  applyFilters: function() {
    var filtered = this.data.patients.slice();

    var startDate = app.getTimeFilter(this.data.currentPeriod);
    if (startDate) {
      filtered = filtered.filter(function(p) {
        if (!p.createdAt) return false;
        return new Date(p.createdAt) >= startDate;
      });
    }

    if (this.data.searchTerm) {
      var term = this.data.searchTerm.toLowerCase();
      filtered = filtered.filter(function(p) {
        return (p.name && p.name.toLowerCase().indexOf(term) !== -1) ||
               (p.diagnosis && p.diagnosis.toLowerCase().indexOf(term) !== -1);
      });
    }

    filtered.sort(function(a, b) {
      var timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      var timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    });

    var currentUser = this.data.currentUser;
    filtered = filtered.map(function(p) {
      var canEdit = app.canEditPatient(p);
      return Object.assign({}, p, { _canEdit: canEdit });
    });

    var pageSize = this.data.pageSize;
    var displayPatients = filtered.slice(0, pageSize);

    this.setData({
      filteredPatients: filtered,
      displayPatients: displayPatients,
      totalCount: filtered.length,
      displayCount: pageSize,
      hasMore: filtered.length > pageSize
    });
  },

  canEditPatient: function(patient) {
    return app.canEditPatient(patient);
  },

  // 滚动触底加载更多
  onLoadMore: function() {
    if (!this.data.hasMore) return;

    var filtered = this.data.filteredPatients;
    var currentCount = this.data.displayCount;
    var pageSize = this.data.pageSize;
    var nextCount = currentCount + pageSize;
    var moreItems = filtered.slice(currentCount, nextCount);

    if (moreItems.length > 0) {
      var displayPatients = this.data.displayPatients.concat(moreItems);
      this.setData({
        displayPatients: displayPatients,
        displayCount: nextCount,
        hasMore: nextCount < filtered.length
      });
    } else {
      this.setData({ hasMore: false });
    }
  },

  // 编辑患者
  onEditPatient: function(e) {
    console.log('点击编辑按钮', e);
    var patientId = e.currentTarget.dataset.id;
    console.log('患者ID:', patientId);

    if (!patientId) {
      console.error('患者ID为空');
      wx.showToast({ title: '患者ID错误', icon: 'none' });
      return;
    }

    var currentUser = app.getCurrentUser();
    console.log('当前用户:', currentUser);

    // 查找患者
    var patients = app.globalData.patients || [];
    console.log('患者列表:', patients.length, '条');

    var patient = patients.find(function(p) {
      return p.id === patientId;
    });

    console.log('找到的患者:', patient);

    if (!patient) {
      wx.showToast({ title: '患者不存在', icon: 'none' });
      return;
    }

    // 检查编辑权限
    if (!app.canEditPatient(patient)) {
      wx.showToast({ title: '只能修改自己录入的患者', icon: 'none' });
      return;
    }

    // 先设置全局数据备份（防止事件监听器未注册时丢失数据）
    app.globalData.editPatientData = {
      mode: 'edit',
      patientId: patientId,
      patient: patient
    };

    // 再通过事件总线通知编辑（如果监听器已注册，会立即处理并清除 globalData）
    eventBus.emit('editPatient', {
      mode: 'edit',
      patientId: patientId,
      patient: patient
    });

    // 使用 switchTab 跳转到 tabBar 页面
    console.log('跳转到编辑页面，患者ID:', patientId);
    wx.switchTab({
      url: '/pages/index/index',
      success: function() {
        console.log('跳转成功');
      },
      fail: function(err) {
        console.error('跳转失败:', err);
        wx.showToast({ title: '跳转失败: ' + (err.errMsg || '未知错误'), icon: 'none' });
      }
    });
  },

  confirmDelete: function(e) {
    var id = e.currentTarget.dataset.id;
    var name = e.currentTarget.dataset.name;

    // 查找患者
    var patients = app.globalData.patients || [];
    var patient = patients.find(function(p) {
      return p.id === id;
    });

    if (!patient) {
      wx.showToast({ title: '患者不存在', icon: 'none' });
      return;
    }

    // 检查删除权限
    if (!app.canEditPatient(patient)) {
      wx.showToast({ title: '只能删除自己录入的患者', icon: 'none' });
      return;
    }

    this.setData({
      showDeleteModal: true,
      deletePatientId: id,
      deletePatientName: name
    });
  },

  cancelDelete: function() {
    this.setData({
      showDeleteModal: false,
      deletePatientId: '',
      deletePatientName: ''
    });
  },

  doDelete: async function() {
    var id = this.data.deletePatientId;
    try {
      await app.deletePatient(id);
      this.setData({ showDeleteModal: false });
      wx.showToast({ title: '已删除', icon: 'success' });
      this.loadPatients();
    } catch (e) {
      console.error('删除失败:', e);
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  formatDateTime: function(date) {
    return formatTime.formatDateTime(date);
  },

  // 查看患者详情（格式化展示+编辑）
  viewPatientDetail: function(e) {
    var patientId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: '/pages/detail/detail?id=' + patientId
    });
  },

  // 查看OCR结果（跳转到详情页查看完整格式化内容）
  viewOcrResult: function(e) {
    var patientId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: '/pages/detail/detail?id=' + patientId
    });
  },

  getLevelNumber: function(level) {
    var map = { 'Ⅰ': 1, 'Ⅱ': 2, 'Ⅲ': 3, 'Ⅳ': 4 };
    return map[level] || 4;
  }
});
