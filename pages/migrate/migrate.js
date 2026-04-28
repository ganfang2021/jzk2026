const app = getApp();
const ChunkStorage = require('../../utils/chunkStorage.js');

Page({
  data: {
    cloudEnabled: false,
    localCount: 0,
    cloudCount: 0,
    migrating: false,
    progress: 0,
    progressText: '准备中...',
    migrateResult: null
  },

  onLoad: function() {
    this.checkStatus();
  },

  onShow: function() {
    this.checkStatus();
  },

  // 检查状态
  async checkStatus() {
    // 检查云开发
    try {
      if (wx.cloud) {
        wx.cloud.init({
          env: wx.cloud.DYNAMIC_CURRENT_ENV,
          traceUser: true
        });
        this.setData({ cloudEnabled: true });
      } else {
        this.setData({ cloudEnabled: false });
      }
    } catch (e) {
      console.error('云开发初始化失败:', e);
      this.setData({ cloudEnabled: false });
    }

    // 获取本地数据数量
    const currentUser = app.getCurrentUser();
    if (currentUser) {
      const oldStorage = new ChunkStorage(currentUser.userId);
      const localCount = await oldStorage.getTotalCount();
      this.setData({ localCount });
    }
  },

  // 开始迁移
  async onMigrate() {
    const currentUser = app.getCurrentUser();
    if (!currentUser) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认迁移',
      content: `即将迁移 ${this.data.localCount} 条数据到云端，是否继续？`,
      success: async (res) => {
        if (res.confirm) {
          await this.doMigrate();
        }
      }
    });
  },

  // 执行迁移
  async doMigrate() {
    this.setData({ migrating: true, progress: 0, progressText: '正在初始化...', migrateResult: null });

    const currentUser = app.getCurrentUser();
    const oldStorage = new ChunkStorage(currentUser.userId);

    try {
      // 获取所有本地数据
      this.setData({ progress: 10, progressText: '正在读取本地数据...' });
      const allPatients = await oldStorage.getAllPatients();
      
      if (allPatients.length === 0) {
        this.setData({ 
          migrating: false, 
          progress: 100, 
          progressText: '无需迁移',
          localCount: 0
        });
        wx.showToast({ title: '无需迁移', icon: 'success' });
        return;
      }

      this.setData({ progress: 30, progressText: `正在迁移 ${allPatients.length} 条数据...` });

      // 初始化云数据库
      const cloudDatabase = require('../../utils/cloudDatabase.js');
      await cloudDatabase.init();

      // 批量添加
      const results = await cloudDatabase.batchAddPatients(allPatients, currentUser.userId);

      this.setData({ 
        migrating: false, 
        progress: 100, 
        progressText: '迁移完成',
        migrateResult: results,
        localCount: 0
      });

      wx.showModal({
        title: '迁移完成',
        content: `成功迁移 ${results.success} 条${results.failed > 0 ? '，失败 ' + results.failed + ' 条' : ''}`,
        showCancel: false
      });

    } catch (e) {
      console.error('迁移失败:', e);
      this.setData({ 
        migrating: false, 
        progressText: '迁移失败: ' + e.message 
      });
      wx.showToast({
        title: '迁移失败: ' + e.message,
        icon: 'none'
      });
    }
  },

  // 重新检查
  onCheckCloud() {
    this.checkStatus();
  },

  // 返回列表
  onGoBack() {
    wx.navigateBack();
  }
});
