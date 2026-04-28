const app = getApp();
const ExportManager = require('../../utils/exportManager.js');
const ImportManager = require('../../utils/importManager.js');
const userManager = require('../../utils/userManager.js');
const localStorage = require('../../utils/localStorage.js');
const toast = require('../../utils/toast.js');

Page({
  data: {
    currentPeriod: 'today',
    stats: {
      total: 0,
      level1: 0,
      level2: 0,
      level3: 0,
      level4: 0,
      hospitalized: 0,
      rescued: 0,
      surgery: 0,
      severeTrauma: 0,
      severeTraumaSurgery: 0,
      cpr: 0,
      cprSuccess: 0,
      intubated: 0,
      centralLine: 0,
      death: 0,
      cpr48h: 0,
      ivAccess: 0,
      male: 0,
      female: 0,
      cprRate: '0',
      medianStayTime: null,
      medianSurgeryTime: null,
      medianStayTimeFmt: '--',
      medianSurgeryTimeFmt: '--',
      stayCount: 0,
      surgeryDelayCount: 0
    },
    isAdmin: false,
    viewMode: 'self', // 'self' 或 'all'
    allUsersData: [],
    showUserList: false,
    trendDays: 7,
    trendData: []
  },

  onLoad: function() {
    // 检查登录状态
    if (!app.checkLogin()) {
      return;
    }

    // 检查是否是管理员
    var currentUser = app.getCurrentUser();
    var isAdmin = currentUser && currentUser.role === 'admin';
    // 所有用户默认查看全部数据统计
    var defaultMode = 'all';

    this.setData({ isAdmin: isAdmin, viewMode: defaultMode });
    // 默认加载全部数据统计
    this.loadAllUsersData();
  },

  onShow: function() {
    // 确保每次显示时刷新数据
    app.loadPatients();
    // 每次显示默认加载全部数据统计
    this.loadAllUsersData();
  },

  onReady: function() {
    // 页面渲染完成后加载全部数据统计
    this.loadAllUsersData();
  },

  onPeriodChange: function(e) {
    var period = e.currentTarget.dataset.period;
    this.setData({ currentPeriod: period });
    this.updateStats();
  },

  // 切换趋势图天数
  onTrendDaysChange: function(e) {
    var days = parseInt(e.currentTarget.dataset.days);
    this.setData({ trendDays: days });
    this.updateTrendChart();
  },

  // 切换查看模式
  onViewModeChange: function(e) {
    var mode = e.currentTarget.dataset.mode;

    this.setData({ viewMode: mode });

    if (mode === 'all') {
      this.loadAllUsersData();
    } else {
      this.updateStats();
    }
  },

  // 分批异步加载所有用户数据，避免阻塞 UI
  async loadAllUsersData() {
    try {
      toast.showLoading('加载中...');

      var users = userManager.getAllUsers();
      var currentUser = app.getCurrentUser();
      console.log('[loadAllUsersData] 开始加载，用户数:', users.length, '| 当前用户:', currentUser ? currentUser.username : 'null', '| role:', currentUser ? currentUser.role : 'null');
      var allUsersData = [];
      var totalStats = this._createEmptyStats();

      // 获取所有用户的合并数据
      var allPatients = localStorage.getAllPatients();
      console.log('[loadAllUsersData] 存储合并数据:', allPatients.length, '条');

      // 如果存储为空但 globalData 有数据（admin用户），使用 globalData
      if (allPatients.length === 0 && app.globalData.patients && app.globalData.patients.length > 0) {
        console.log('[loadAllUsersData] 存储为空，使用 globalData.patients:', app.globalData.patients.length, '条');
        allPatients = app.globalData.patients;
      }

      // 如果存储有数据，过滤出当前用户的数据用于显示
      var myPatients = allPatients;
      if (currentUser && currentUser.role !== 'admin') {
        // 非admin用户只显示自己的数据
        myPatients = allPatients.filter(function(p) {
          return p.createdBy === currentUser.userId;
        });
        console.log('[loadAllUsersData] 非admin用户，筛选后自己的数据:', myPatients.length, '条');
      }

      console.log('[loadAllUsersData] 最终使用的患者数据:', allPatients.length, '条 (统计用), ', myPatients.length, '条 (当前用户显示用)');

      // 构建 userId -> 患者列表 的映射
      var userPatientsMap = {};
      for (var i = 0; i < allPatients.length; i++) {
        var p = allPatients[i];
        var uid = p.createdBy || 'unknown';
        if (!userPatientsMap[uid]) userPatientsMap[uid] = [];
        userPatientsMap[uid].push(p);
      }
      console.log('[loadAllUsersData] 用户患者映射:', Object.keys(userPatientsMap).length, '个用户有数据');

      // 每批处理 5 个用户，批次间让出主线程
      var batchSize = 5;
      for (var i = 0; i < users.length; i += batchSize) {
        var batch = users.slice(i, i + batchSize);

        for (var j = 0; j < batch.length; j++) {
          var user = batch[j];
          // 优先从用户映射获取，没有则用存储键获取
          var stored = userPatientsMap[user.id] || localStorage.getUserPatients(user.id);
          console.log('[loadAllUsersData] 用户:', user.username, '| id:', user.id, '| 患者数:', stored ? stored.length : 0);

          if (stored && stored.length > 0) {
            var filteredPatients = app.filterPatientsByPeriod(stored, this.data.currentPeriod);
            var userStats = app.calculateStats(filteredPatients);

            allUsersData.push({
              userId: user.id,
              username: user.username,
              nickname: user.nickname,
              role: user.role,
              patientCount: stored.length,
              stats: userStats
            });

            this._mergeStats(totalStats, userStats);
          }
        }

        // 让出主线程，允许 UI 刷新
        if (i + batchSize < users.length) {
          await new Promise(function(resolve) { setTimeout(resolve, 0); });
        }
      }

      this._finalizeStats(totalStats);

      this.setData({
        allUsersData: allUsersData,
        stats: totalStats
      });
      // 注意：不再调用 updateTrendChart，因为它会用 self 模式覆盖刚设置好的 stats

      toast.hideLoading();
    } catch (e) {
      toast.hideLoading();
      console.error('加载所有用户数据失败:', e);
      toast.showError('加载失败');
    }
  },

  // 创建空统计对象
  _createEmptyStats: function() {
    return {
      total: 0, level1: 0, level2: 0, level3: 0, level4: 0,
      hospitalized: 0, rescued: 0, surgery: 0,
      severeTrauma: 0, severeTraumaSurgery: 0,
      cpr: 0, cprSuccess: 0, intubated: 0, centralLine: 0,
      death: 0, cpr48h: 0, ivAccess: 0, male: 0, female: 0,
      cprRate: '0', medianStayTime: null, medianSurgeryTime: null,
      medianStayTimeFmt: '--', medianSurgeryTimeFmt: '--',
      stayTimes: [], surgeryDelayTimes: [], stayCount: 0, surgeryDelayCount: 0
    };
  },

  // 累加统计数据
  _mergeStats: function(target, source) {
    target.total += source.total;
    target.level1 += source.level1;
    target.level2 += source.level2;
    target.level3 += source.level3;
    target.level4 += source.level4;
    target.hospitalized += source.hospitalized;
    target.rescued += source.rescued;
    target.surgery += source.surgery;
    target.severeTrauma += source.severeTrauma;
    target.severeTraumaSurgery += source.severeTraumaSurgery;
    target.cpr += source.cpr;
    target.cprSuccess += source.cprSuccess;
    target.intubated += source.intubated;
    target.centralLine += source.centralLine;
    target.death += source.death;
    target.cpr48h += source.cpr48h;
    target.ivAccess += source.ivAccess;
    target.male += source.male;
    target.female += source.female;
    if (source.stayTimes) {
      target.stayTimes = target.stayTimes.concat(source.stayTimes);
    }
    if (source.surgeryDelayTimes) {
      target.surgeryDelayTimes = target.surgeryDelayTimes.concat(source.surgeryDelayTimes);
    }
    target.stayCount += source.stayCount || 0;
    target.surgeryDelayCount += source.surgeryDelayCount || 0;
  },

  // 计算最终比率和中位数
  _finalizeStats: function(stats) {
    if (stats.cpr > 0) {
      stats.cprRate = ((stats.cprSuccess / stats.cpr) * 100).toFixed(1);
    }
    stats.medianStayTime = app.calculateMedian(stats.stayTimes);
    stats.medianSurgeryTime = app.calculateMedian(stats.surgeryDelayTimes);
    stats.stayCount = stats.stayTimes.length;
    stats.surgeryDelayCount = stats.surgeryDelayTimes.length;
    stats.medianStayTimeFmt = stats.medianStayTime !== null ? stats.medianStayTime.toFixed(0) : '--';
    stats.medianSurgeryTimeFmt = stats.medianSurgeryTime !== null ? stats.medianSurgeryTime.toFixed(0) : '--';
  },

  updateStats: function() {
    try {
      var patients = app.globalData.patients || [];
      console.log('[StatsPage] updateStats 被调用, 患者总数:', patients.length, '| viewMode:', this.data.viewMode, '| period:', this.data.currentPeriod);

      if (this.data.viewMode === 'self') {
        var currentUser = app.getCurrentUser();
        if (currentUser) {
          patients = patients.filter(function(p) {
            return p.createdBy === currentUser.userId;
          });
        }
      }

      var filteredPatients = app.filterPatientsByPeriod(patients, this.data.currentPeriod);
      console.log('[StatsPage] 过滤后患者数:', filteredPatients.length);

      // 数据量大时异步分批计算
      if (filteredPatients.length > 2000) {
        this._updateStatsAsync(filteredPatients);
      } else {
        var stats = app.calculateStats(filteredPatients);
        this.setData({ stats: stats });
        console.log('[StatsPage] setData stats:', JSON.stringify({
          medianStayTime: stats.medianStayTime,
          medianSurgeryTime: stats.medianSurgeryTime,
          stayCount: stats.stayCount,
          surgeryDelayCount: stats.surgeryDelayCount
        }));
        this.updateTrendChart();
      }
    } catch (err) {
      console.error('Update stats error:', err);
    }
  },

  // 大数据量时异步分批统计
  _updateStatsAsync: function(patients) {
    var self = this;
    toast.showLoading('计算中...');

    setTimeout(function() {
      try {
        var stats = app.calculateStats(patients);
        self.setData({ stats: stats });
        self.updateTrendChart();
        toast.hideLoading();
      } catch (e) {
        toast.hideLoading();
        console.error('异步统计失败:', e);
      }
    }, 50);
  },

  // 显示/隐藏用户列表
  toggleUserList: function() {
    this.setData({ showUserList: !this.data.showUserList });
  },

  // 导出患者数据
  async onExportPatients() {
    try {
      toast.showLoading('正在导出...');

      const patients = app.getAllPatients();

      if (!patients || patients.length === 0) {
        toast.hideLoading();
        toast.showError('没有数据可导出');
        return;
      }

      const exportManager = new ExportManager();
      const tempFilePath = await exportManager.exportToCSV(patients, '患者数据');

      toast.hideLoading();

      // 使用 openDocument 打开文件（微信会自动处理文件）
      wx.openDocument({
        filePath: tempFilePath,
        fileType: 'csv',
        success: function() {
          console.log('打开文档成功');
        },
        fail: function(err) {
          console.error('打开文档失败:', err);
          wx.showToast({ title: '打开失败: ' + (err.errMsg || ''), icon: 'none', duration: 2000 });
        }
      });
    } catch (e) {
      toast.hideLoading();
      console.error('导出失败:', e);
      toast.showError('导出失败: ' + e.message);
    }
  },

  // 导出统计数据
  async onExportStats() {
    try {
      toast.showLoading('正在导出...');

      const exportManager = new ExportManager();
      const tempFilePath = await exportManager.exportStats(this.data.stats, '统计数据');

      toast.hideLoading();

      // 使用 openDocument 打开文件
      wx.openDocument({
        filePath: tempFilePath,
        fileType: 'csv',
        success: function() {
          console.log('打开文档成功');
        },
        fail: function(err) {
          console.error('打开文档失败:', err);
          wx.showToast({ title: '打开失败: ' + (err.errMsg || ''), icon: 'none', duration: 2000 });
        }
      });
    } catch (e) {
      toast.hideLoading();
      console.error('导出失败:', e);
      toast.showError('导出失败: ' + e.message);
    }
  },

  // 导入患者数据
  async onImportPatients() {
    try {
      const importManager = new ImportManager();
      const filePath = await importManager.selectFile();

      toast.showLoading('正在解析...');
      const result = await importManager.importFromCSV(filePath);

      const validation = importManager.validatePatients(result.patients);

      if (validation.errorCount > 0) {
        toast.hideLoading();
        wx.showModal({
          title: '数据验证',
          content: '共' + validation.total + '条数据\n有效' + validation.validCount + '条\n无效' + validation.errorCount + '条\n\n是否继续导入有效数据?',
          success: async (res) => {
            if (res.confirm) {
              await this.doImport(validation.validPatients, importManager);
            }
          }
        });
      } else {
        await this.doImport(validation.validPatients, importManager);
      }
    } catch (e) {
      toast.hideLoading();
      console.error('导入失败:', e);
      toast.showError('导入失败: ' + e.message);
    }
  },

  // 执行导入
  async doImport(patients, importManager) {
    toast.showLoading('正在导入...');
    
    let successCount = 0;
    let failCount = 0;
    
    for (const patient of patients) {
      try {
        await app.addPatient(patient);
        successCount++;
      } catch (e) {
        failCount++;
        console.error('导入失败:', patient.name, e);
      }
    }
    
    toast.hideLoading();

    wx.showModal({
      title: '导入完成',
      content: '成功: ' + successCount + '条\n失败: ' + failCount + '条',
      showCancel: false,
      success: () => {
        this.updateStats();
      }
    });
  },

  // 更新趋势图数据并绘制
  updateTrendChart: function() {
    var patients = app.globalData.patients || [];
    if (this.data.viewMode === 'self') {
      var currentUser = app.getCurrentUser();
      if (currentUser) {
        patients = patients.filter(function(p) {
          return p.createdBy === currentUser.userId;
        });
      }
    }
    var trendData = this._calculateTrendData(patients, this.data.trendDays);
    this.setData({ trendData: trendData });
    this._drawChartAfterRender();
  },

  // 等待Canvas渲染后绘制
  _drawChartAfterRender: function() {
    var self = this;
    setTimeout(function() {
      self._drawTrendChart();
    }, 150);
  },

  // 计算每日分诊趋势数据
  _calculateTrendData: function(patients, days) {
    var now = new Date();
    var result = [];
    var startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1);
    startDate.setHours(0, 0, 0, 0);

    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      result.push({
        label: (d.getMonth() + 1) + '/' + d.getDate(),
        level1: 0, level2: 0, level3: 0, level4: 0
      });
    }

    for (var j = 0; j < patients.length; j++) {
      var p = patients[j];
      if (!p.createdAt || !p.triageLevel) continue;
      var pDate = new Date(p.createdAt);
      if (isNaN(pDate.getTime())) continue;
      if (pDate < startDate) continue;
      var dayIndex = Math.floor((pDate.getTime() - startDate.getTime()) / 86400000);
      if (dayIndex >= 0 && dayIndex < days) {
        var level = p.triageLevel;
        if (level === 'Ⅰ') result[dayIndex].level1++;
        else if (level === 'Ⅱ') result[dayIndex].level2++;
        else if (level === 'Ⅲ') result[dayIndex].level3++;
        else if (level === 'Ⅳ') result[dayIndex].level4++;
      }
    }
    return result;
  },

  // Canvas 2D 绘制柱状图
  _drawTrendChart: function() {
    var self = this;
    var query = wx.createSelectorQuery().in(this);
    query.select('#trendChart')
      .fields({ node: true, size: true })
      .exec(function(res) {
        if (!res || !res[0] || !res[0].node) {
          console.log('Canvas节点未就绪');
          return;
        }

        var canvas = res[0].node;
        var ctx = canvas.getContext('2d');
        var dpr = wx.getSystemInfoSync().pixelRatio || 2;
        var width = res[0].width;
        var height = res[0].height;

        if (width === 0 || height === 0) return;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        var trendData = self.data.trendData;
        if (!trendData || trendData.length === 0) {
          ctx.fillStyle = '#B0BEC5';
          ctx.font = '14px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('暂无趋势数据', width / 2, height / 2);
          return;
        }

        var margin = { top: 16, right: 12, bottom: 32, left: 36 };
        var plotW = width - margin.left - margin.right;
        var plotH = height - margin.top - margin.bottom;
        if (plotW <= 0 || plotH <= 0) return;

        // 计算Y轴最大值
        var maxVal = 0;
        for (var i = 0; i < trendData.length; i++) {
          var d = trendData[i];
          var sum = d.level1 + d.level2 + d.level3 + d.level4;
          if (sum > maxVal) maxVal = sum;
        }
        if (maxVal === 0) maxVal = 5;
        maxVal = Math.ceil(maxVal * 1.2);

        // Y轴网格线和标签
        var ySteps = 4;
        ctx.fillStyle = '#8E9BAA';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.strokeStyle = '#F0F2F5';
        ctx.lineWidth = 0.5;
        for (var s = 0; s <= ySteps; s++) {
          var yVal = (maxVal / ySteps) * s;
          var yPos = margin.top + plotH - (yVal / maxVal) * plotH;
          ctx.fillText(Math.round(yVal).toString(), margin.left - 4, yPos + 4);
          if (s > 0) {
            ctx.beginPath();
            ctx.moveTo(margin.left, yPos);
            ctx.lineTo(width - margin.right, yPos);
            ctx.stroke();
          }
        }

        // 柱状图
        var groupCount = trendData.length;
        var colors = ['#D50000', '#E65100', '#F9A825', '#2E7D32'];
        var groupGap = Math.max(2, plotW / (groupCount * 2.5));
        var groupW = Math.max(2, (plotW - groupGap * (groupCount + 1)) / groupCount);
        var barGap = Math.max(0.5, groupW * 0.08);
        var barW = Math.max(0.5, (groupW - barGap * 5) / 4);

        for (var g = 0; g < groupCount; g++) {
          var groupX = margin.left + groupGap * (g + 1) + groupW * g;
          var vals = [trendData[g].level1, trendData[g].level2, trendData[g].level3, trendData[g].level4];

          for (var b = 0; b < 4; b++) {
            if (vals[b] <= 0) continue;
            var barX = groupX + barGap + (barW + barGap) * b;
            var barH = (vals[b] / maxVal) * plotH;
            var barY = margin.top + plotH - barH;

            ctx.fillStyle = colors[b];
            if (barH > 3) {
              var r = Math.min(1.5, barW * 0.5);
              ctx.beginPath();
              ctx.moveTo(barX, barY + barH);
              ctx.lineTo(barX, barY + r);
              ctx.quadraticCurveTo(barX, barY, barX + r, barY);
              ctx.lineTo(barX + barW - r, barY);
              ctx.quadraticCurveTo(barX + barW, barY, barX + barW, barY + r);
              ctx.lineTo(barX + barW, barY + barH);
              ctx.closePath();
              ctx.fill();
            } else {
              ctx.fillRect(barX, barY, Math.max(barW, 0.5), Math.max(barH, 0.5));
            }
          }
        }

        // X轴标签
        ctx.fillStyle = '#8E9BAA';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        var labelStep = groupCount > 14 ? Math.ceil(groupCount / 12) : 1;
        for (var l = 0; l < groupCount; l += labelStep) {
          var labelX = margin.left + groupGap * (l + 1) + groupW * (l + 0.5);
          ctx.fillText(trendData[l].label, labelX, height - margin.bottom + 16);
        }
      });
  }
});
