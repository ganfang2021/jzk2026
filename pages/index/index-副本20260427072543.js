const app = getApp();
const ocrManager = require('../../utils/ocrMedicalManager.js');
const config = require('../../config.js');
const eventBus = require('../../utils/eventBus.js');
const formatTime = require('../../utils/formatTime.js');
const toast = require('../../utils/toast.js');

Page({
  data: {
    // 基本信息
    name: '',
    age: '',
    gender: '',
    genderIndex: -1,
    genderOptions: ['男', '女'],
    triageLevel: '',

    // OCR相关
    showOcrMenu: false,
    ocrResult: '',
    ocrRawText: '',
    ocrFileID: '',
    ocrFillData: null,
    ocrData: null,
    ocrDataList: [],
    ocrType: '',

    // 编辑模式
    editMode: false,
    editPatientId: '',

    // 生命体征
    pulse: '',
    respRate: '',
    heartRate: '',
    spo2: '',
    bpSystolic: '',
    bpDiastolic: '',

    // 就诊信息 - 入科时间
    inTime: '',
    inTimeStr: '',
    inTimeMultiIndex: [0, 0, 0, 0, 0],
    inTimeMultiArray: [[], [], [], [], []],

    // 就诊信息 - 出科时间
    outTime: '',
    outTimeStr: '',
    outTimeMultiIndex: [0, 0, 0, 0, 0],
    outTimeMultiArray: [[], [], [], [], []],

    diagnosis: '',
    doctor: '',

    // 医生选择器
    showDoctorPicker: false,
    filteredDoctors: [],
    searchDoctor: '',
    doctorOptions: config.doctors,

    // 住院信息
    hospitalized: false,
    dept: '',
    deptIndex: -1,
    deptOptions: config.departments,
    
    // 抢救信息
    rescued: false,
    ivAccess: false,
    intubated: false,
    centralLine: false,
    cpr: false,
    cprSuccess: false,
    death: false,
    outcome: '',
    outcomeIndex: -1,
    outcomeOptions: ['治愈', '好转', '未愈', '死亡', '自动出院', '转院', '其他'],
    
    // 手术信息
    surgery: false,
    surgeryTime: '',
    surgeryTimeStr: '',
    surgeryTimeMultiIndex: [0, 0, 0, 0, 0],
    surgeryTimeMultiArray: [[], [], [], [], []],
    severeTrauma: false,
    
    // 诊断选择器
    showDiagnosisPicker: false,
    filteredDiagnoses: [],
    searchDiagnosis: '',

    // OCR编辑
    showOcrEditModal: false,
    editOcrIdx: -1,
    editOcrText: ''
  },

  onLoad: function(options) {
    console.log('index页面加载，参数:', options);

    // 检查登录状态
    if (!app.checkLogin()) {
      return;
    }

    this.initTimePickers();
  },

  onShow: function() {
    console.log('index页面显示');

    // 移除旧的事件监听，避免重复绑定
    if (this._editUnsubscribe) {
      this._editUnsubscribe();
    }

    // 监听编辑患者事件
    this._editUnsubscribe = eventBus.on('editPatient', (editData) => {
      if (editData && editData.mode === 'edit') {
        console.log('收到编辑患者事件:', editData);
        // 清除全局数据备份，避免 onShow 中二次加载
        app.globalData.editPatientData = null;
        this.setData({
          editMode: true,
          editPatientId: editData.patientId
        });
        // 从患者数据恢复OCR列表
        if (editData.patient) {
          var ocrList = editData.patient.ocrResults || (editData.patient.ocrResult ? [editData.patient.ocrResult] : []);
          app.globalData._ocrTempBuffer = ocrList.slice();
        }
        this.loadPatientDataFromObject(editData.patient);
      }
    });

    // 检查是否有编辑数据（兼容旧模式 - 事件监听器未注册时的备选路径）
    if (app.globalData.editPatientData && app.globalData.editPatientData.mode === 'edit') {
      console.log('检测到编辑数据（备选路径）:', app.globalData.editPatientData);
      var editData = app.globalData.editPatientData;

      // 同步OCR缓存
      if (editData.patient) {
        var ocrList = editData.patient.ocrResults || (editData.patient.ocrResult ? [editData.patient.ocrResult] : []);
        app.globalData._ocrTempBuffer = ocrList.slice();
      }

      this.setData({
        editMode: true,
        editPatientId: editData.patientId
      });

      // 直接使用传递过来的患者数据
      this.loadPatientDataFromObject(editData.patient);

      // 清除编辑数据
      app.globalData.editPatientData = null;
    } else {
      // 新增模式或者编辑模式（如果事件监听器已设置editMode，说明数据已加载）
      if (this.data.editMode) {
        console.log('编辑模式（事件监听器已加载数据），跳过重置');
        // 仅恢复OCR列表显示
        var ocrBuffer = app.globalData._ocrTempBuffer || [];
        if (ocrBuffer.length > 0 && this.data.ocrDataList.length === 0) {
          this.setData({ ocrDataList: ocrBuffer });
        }
      } else {
        console.log('新增模式 - 保留已输入的表单数据');
        // 不调用 resetForm()，否则会清空用户已输入的患者信息
        // 仅确保 OCR 列表与全局缓存同步
        var ocrBuffer = app.globalData._ocrTempBuffer || [];
        if (ocrBuffer.length > 0 && this.data.ocrDataList.length === 0) {
          this.setData({ ocrDataList: ocrBuffer });
        } else if (ocrBuffer.length === 0 && this.data.ocrDataList.length > 0) {
          // 界面有 OCR 数据但缓存丢失时，重新同步缓存
          app.globalData._ocrTempBuffer = this.data.ocrDataList.slice();
        }
      }
    }
  },

  // 页面卸载时清理事件监听
  onUnload: function() {
    if (this._editUnsubscribe) {
      this._editUnsubscribe();
      this._editUnsubscribe = null;
    }
  },

  // 重置表单
  resetForm: function() {
    this.setData({
      editMode: false,
      editPatientId: '',
      name: '',
      age: '',
      gender: '',
      genderIndex: -1,
      triageLevel: '',
      pulse: '',
      respRate: '',
      heartRate: '',
      spo2: '',
      bpSystolic: '',
      bpDiastolic: '',
      inTime: '',
      inTimeStr: '',
      outTime: '',
      outTimeStr: '',
      diagnosis: '',
      doctor: '',
      hospitalized: false,
      dept: '',
      deptIndex: -1,
      rescued: false,
      ivAccess: false,
      intubated: false,
      centralLine: false,
      cpr: false,
      cprSuccess: false,
      death: false,
      outcome: '',
      outcomeIndex: -1,
      surgery: false,
      surgeryTime: '',
      surgeryTimeStr: '',
      severeTrauma: false
    });
  },

  // 从对象加载患者数据
  loadPatientDataFromObject: function(patient) {
    console.log('加载患者数据:', patient);

    if (!patient) {
      wx.showToast({ title: '患者数据错误', icon: 'none' });
      return;
    }

    // 设置表单数据
    console.log('设置表单数据...');
    this.setData({
      name: patient.name || '',
      age: patient.age || '',
      gender: patient.gender || '',
      genderIndex: patient.gender ? (patient.gender === '男' ? 0 : 1) : -1,
      triageLevel: patient.triageLevel || '',
      pulse: patient.vitalSigns ? (patient.vitalSigns.pulse || '') : (patient.pulse || ''),
      respRate: patient.vitalSigns ? (patient.vitalSigns.respRate || '') : (patient.respRate || ''),
      heartRate: patient.vitalSigns ? (patient.vitalSigns.heartRate || '') : (patient.heartRate || ''),
      spo2: patient.vitalSigns ? (patient.vitalSigns.spo2 || '') : (patient.spo2 || ''),
      bpSystolic: patient.vitalSigns ? (patient.vitalSigns.bpSystolic || '') : (patient.bpSystolic || ''),
      bpDiastolic: patient.vitalSigns ? (patient.vitalSigns.bpDiastolic || '') : (patient.bpDiastolic || ''),
      inTime: patient.inTime || '',
      inTimeStr: patient.inTime ? this.formatTimeDisplay(patient.inTime) : '',
      outTime: patient.outTime || '',
      outTimeStr: patient.outTime ? this.formatTimeDisplay(patient.outTime) : '',
      diagnosis: patient.diagnosis || '',
      doctor: patient.doctor || '',
      hospitalized: patient.hospitalized || false,
      dept: patient.dept || '',
      rescued: patient.rescued || false,
      ivAccess: patient.ivAccess || false,
      intubated: patient.intubated || false,
      centralLine: patient.centralLine || false,
      cpr: patient.cpr || false,
      cprSuccess: patient.cprSuccess || false,
      death: patient.death || false,
      outcome: patient.outcome || '',
      surgery: patient.surgery || false,
      surgeryTime: patient.surgeryTime || '',
      surgeryTimeStr: patient.surgeryTime ? this.formatTimeDisplay(patient.surgeryTime) : '',
      severeTrauma: patient.severeTrauma || false,
      // 加载OCR结果（支持新版列表和旧版单条）
      ocrDataList: patient.ocrResults || (patient.ocrResult ? [patient.ocrResult] : []),
      ocrResult: patient.ocrResult ? (patient.ocrResult.formattedText || '') : '',
      ocrRawText: patient.ocrResult ? (patient.ocrResult.rawText || '') : '',
      ocrFileID: patient.ocrResult ? (patient.ocrResult.fileID || '') : '',
      ocrData: patient.ocrResult || null
    });

    console.log('表单数据设置完成');
    wx.showToast({ title: '已加载患者数据', icon: 'none' });
  },

  // 加载患者数据用于编辑（保留用于其他场景）
  loadPatientData: function(patientId) {
    console.log('加载患者数据，ID:', patientId);
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

    this.loadPatientDataFromObject(patient);
  },

  // ==================== OCR扫描功能 ====================

  // 显示OCR菜单
  showOcrMenu: function() {
    this.setData({ showOcrMenu: true });
  },

  // 隐藏OCR菜单
  hideOcrMenu: function() {
    this.setData({ showOcrMenu: false });
  },

  // OCR扫描入口
  onOcrScan: function(e) {
    const type = e.currentTarget.dataset.type;
    const titles = {
      'order': '扫描医嘱',
      'lab': '扫描检查/检验结果',
      'record': '扫描门诊病历'
    };
    
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      title: titles[type],
      success: (res) => {
        const sourceType = res.tapIndex === 0 ? ['camera'] : ['album'];
        ocrManager.chooseImage({ sourceType: sourceType }).then(imagePath => {
          this.processOcrImage(imagePath, type);
        }).catch(err => {
          if (err && err.errMsg && err.errMsg.indexOf('cancel') === -1) {
            wx.showToast({ title: '选择图片失败', icon: 'none' });
          }
        });
      }
    });
  },

  // 处理OCR图片（统一使用scanDocument，自动检测文档类型并提取回填数据）
  async processOcrImage(imagePath, type) {
    try {
      toast.showLoading('正在识别...');

      const result = await ocrManager.scanDocument(imagePath);

      toast.hideLoading();

      if (result && result.success) {
        // 构建完整的OCR数据对象（供保存到患者记录）
        const ocrData = {
          rawText: result.rawText,
          formattedText: result.formattedText,
          fileID: result.fileID,
          docType: result.parsed.type,
          scanTime: new Date().toISOString()
        };

        // 追加到全局缓存（防止页面切换丢失）
        if (!app.globalData._ocrTempBuffer || app.globalData._ocrTempBuffer.length === 0) {
          // 安全恢复：如果 buffer 被意外清空但界面仍有数据，从当前列表恢复
          app.globalData._ocrTempBuffer = (this.data.ocrDataList || []).slice();
        }
        app.globalData._ocrTempBuffer.push(ocrData);

        this.setData({
          ocrResult: result.formattedText,
          ocrRawText: result.rawText,
          ocrFileID: result.fileID,
          ocrFillData: result.fillData,
          ocrData: ocrData,
          ocrDataList: app.globalData._ocrTempBuffer.slice(),
          showOcrMenu: false
        });

        // 如果有可回填字段，显示确认对话框
        const fillData = result.fillData;
        if (fillData && Object.keys(fillData).length > 0) {
          this.showFillDataConfirm(fillData);
        } else {
          // 无回填数据，仅显示识别结果
          this.showOcrResultModal(result.formattedText);
        }
      } else {
        toast.showError('未识别到文字');
      }
    } catch (e) {
      toast.hideLoading();
      console.error('OCR识别失败:', e);
      toast.showError('识别失败: ' + (e.message || '未知错误'));
    }
  },

  // 显示回填确认对话框
  showFillDataConfirm: function(fillData) {
    var content = '识别到以下信息，是否自动填入表单？\n\n';
    var fieldNames = {
      name: '姓名', age: '年龄', gender: '性别',
      diagnosis: '诊断', doctor: '医生', inTimeStr: '就诊时间',
      heartRate: '心率', pulse: '脉搏', respRate: '呼吸',
      spo2: '血氧', bpSystolic: '收缩压', bpDiastolic: '舒张压'
    };

    var keys = Object.keys(fillData);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (fieldNames[key] && fillData[key]) {
        content += fieldNames[key] + ': ' + fillData[key] + '\n';
      }
    }

    wx.showModal({
      title: 'OCR自动填入',
      content: content,
      confirmText: '自动填入',
      cancelText: '查看原文',
      success: (res) => {
        if (res.confirm) {
          this.applyFillData(fillData);
        } else {
          this.showOcrResultModal(this.data.ocrResult);
        }
      }
    });
  },

  // 自动填入表单
  applyFillData: function(fillData) {
    var updateData = {};
    if (fillData.name) updateData.name = fillData.name;
    if (fillData.age) updateData.age = fillData.age;
    if (fillData.gender) {
      updateData.gender = fillData.gender;
      updateData.genderIndex = fillData.gender === '男' ? 0 : 1;
    }
    if (fillData.diagnosis) updateData.diagnosis = fillData.diagnosis;
    if (fillData.doctor) updateData.doctor = fillData.doctor;
    if (fillData.heartRate) updateData.heartRate = fillData.heartRate;
    if (fillData.pulse) updateData.pulse = fillData.pulse;
    if (fillData.respRate) updateData.respRate = fillData.respRate;
    if (fillData.spo2) updateData.spo2 = fillData.spo2;
    if (fillData.bpSystolic) updateData.bpSystolic = fillData.bpSystolic;
    if (fillData.bpDiastolic) updateData.bpDiastolic = fillData.bpDiastolic;

    this.setData(updateData);
    wx.showToast({ title: '已自动填入表单', icon: 'success' });

    // 仍显示格式化结果供查看
    this.showOcrResultModal(this.data.ocrResult);
  },

  // 显示OCR结果
  showOcrResultModal: function(text) {
    // 如果没有传参数，从data读取
    if (typeof text !== 'string') {
      text = this.data.ocrResult;
    }
    if (!text) {
      wx.showToast({ title: '无识别结果', icon: 'none' });
      return;
    }
    wx.showModal({
      title: 'OCR识别结果',
      content: text.substring(0, 800),
      confirmText: '复制全文',
      cancelText: '关闭',
      success: (res) => {
        if (res.confirm) {
          wx.setClipboardData({
            data: this.data.ocrResult,
            success: () => {
              wx.showToast({ title: '已复制到剪贴板', icon: 'success' });
            }
          });
        }
      }
    });
  },

  // 查看指定索引的OCR结果
  viewOcrItem: function(e) {
    var idx = e.currentTarget.dataset.idx;
    var item = this.data.ocrDataList[idx];
    if (!item) return;
    this.showOcrResultModal(item.formattedText || item.rawText);
  },

  // 清除指定索引的OCR数据
  removeOcrItem: function(e) {
    var idx = e.currentTarget.dataset.idx;
    var self = this;
    wx.showModal({
      title: '清除OCR结果',
      content: '确定要清除该条OCR扫描结果吗？',
      success: function(res) {
        if (res.confirm) {
          var list = (app.globalData._ocrTempBuffer || []).slice();
          list.splice(idx, 1);
          app.globalData._ocrTempBuffer = list;
          var update = { ocrDataList: list };
          if (list.length === 0) {
            app.globalData._ocrTempBuffer = [];
            update.ocrData = null;
            update.ocrResult = '';
            update.ocrRawText = '';
            update.ocrFileID = '';
            update.ocrFillData = null;
          } else {
            var last = list[list.length - 1];
            update.ocrData = last;
            update.ocrResult = last.formattedText || last.rawText || '';
            update.ocrRawText = last.rawText || '';
            update.ocrFileID = last.fileID || '';
            update.ocrFillData = last.fillData || null;
          }
          self.setData(update);
          wx.showToast({ title: '已清除', icon: 'success' });
        }
      }
    });
  },

  // 编辑指定索引的OCR内容
  editOcrItem: function(e) {
    var idx = e.currentTarget.dataset.idx;
    var item = this.data.ocrDataList[idx];
    if (!item) return;
    this.setData({
      showOcrEditModal: true,
      editOcrIdx: idx,
      editOcrText: item.formattedText || item.rawText || ''
    });
  },

  // OCR编辑输入
  onEditOcrInput: function(e) {
    this.setData({ editOcrText: e.detail.value });
  },

  // 保存OCR编辑
  saveOcrEdit: function() {
    var idx = this.data.editOcrIdx;
    var newText = this.data.editOcrText;
    if (idx < 0 || idx >= this.data.ocrDataList.length) {
      this.cancelOcrEdit();
      return;
    }

    // 更新本地数据
    var list = this.data.ocrDataList.slice();
    var item = Object.assign({}, list[idx]);
    item.formattedText = newText;
    item.rawText = item.rawText || newText;
    item.editedAt = new Date().toISOString();
    list[idx] = item;

    // 同步到全局缓存
    app.globalData._ocrTempBuffer = list.slice();

    this.setData({
      ocrDataList: list,
      showOcrEditModal: false,
      editOcrIdx: -1,
      editOcrText: '',
      ocrData: item,
      ocrResult: newText
    });

    wx.showToast({ title: '已更新', icon: 'success' });
  },

  // 取消OCR编辑
  cancelOcrEdit: function() {
    this.setData({
      showOcrEditModal: false,
      editOcrIdx: -1,
      editOcrText: ''
    });
  },

  // 空操作（阻止事件冒泡）
  noop: function() {},

  // 格式化时间为短格式
  formatTime: function(dateStr) {
    return formatTime.formatDateTime(dateStr);
  },

  // 清除OCR数据（旧版，保留兼容）
  removeOcrData: function() {
    var self = this;
    wx.showModal({
      title: '清除OCR结果',
      content: '确定要清除已附加的OCR扫描结果吗？',
      success: function(res) {
        if (res.confirm) {
          self.setData({
            ocrResult: '',
            ocrRawText: '',
            ocrFileID: '',
            ocrFillData: null,
            ocrData: null
          });
          wx.showToast({ title: '已清除', icon: 'success' });
        }
      }
    });
  },

  // 扫描医嘱
  onScanOrder: function() {
    this.onOcrScan({ currentTarget: { dataset: { type: 'order' } } });
  },

  // 扫描检查/检验结果
  onScanLab: function() {
    this.onOcrScan({ currentTarget: { dataset: { type: 'lab' } } });
  },

  // 扫描门诊病历
  onScanRecord: function() {
    this.onOcrScan({ currentTarget: { dataset: { type: 'record' } } });
  },

  // 初始化时间选择器数据
  initTimePickers: function() {
    const now = new Date();
    const yearRangeBefore = config.timePicker.yearRangeBefore;
    const yearRangeAfter = config.timePicker.yearRangeAfter;
    const years = [];
    const months = [];
    const days = [];
    const hours = [];
    const minutes = [];

    // 年份范围：从当前年份-2 到 当前年份+1
    for (let i = now.getFullYear() - yearRangeBefore; i <= now.getFullYear() + yearRangeAfter; i++) {
      years.push(i + '年');
    }

    // 月份 1-12
    for (let i = 1; i <= 12; i++) {
      months.push(i + '月');
    }

    // 天数 1-31
    for (let i = 1; i <= 31; i++) {
      days.push(i + '日');
    }

    // 小时 0-23
    for (let i = 0; i <= 23; i++) {
      hours.push(i + '时');
    }

    // 分钟 0-59
    for (let i = 0; i <= 59; i++) {
      minutes.push(i + '分');
    }

    const multiArray = [years, months, days, hours, minutes];
    const currentIndex = [
      now.getFullYear() - (now.getFullYear() - yearRangeBefore),
      now.getMonth(),
      now.getDate() - 1,
      now.getHours(),
      now.getMinutes()
    ];
    
    const timeStr = this.formatTimeDisplay(now);
    const timeValue = this.formatTimeValue(now);
    
    this.setData({
      inTimeMultiArray: multiArray,
      inTimeMultiIndex: currentIndex,
      outTimeMultiArray: multiArray,
      outTimeMultiIndex: currentIndex,
      surgeryTimeMultiArray: multiArray,
      surgeryTimeMultiIndex: currentIndex,
      inTimeStr: timeStr,
      inTime: timeValue
    });
  },

  // 入科时间列变化
  onInTimeColumnChange: function(e) {
    const columnIndex = e.detail.column;
    const rowIndex = e.detail.value;
    const inTimeMultiIndex = this.data.inTimeMultiIndex;
    inTimeMultiIndex[columnIndex] = rowIndex;
    this.setData({ inTimeMultiIndex: inTimeMultiIndex });
  },

  // 出科时间列变化
  onOutTimeColumnChange: function(e) {
    const columnIndex = e.detail.column;
    const rowIndex = e.detail.value;
    const outTimeMultiIndex = this.data.outTimeMultiIndex;
    outTimeMultiIndex[columnIndex] = rowIndex;
    this.setData({ outTimeMultiIndex: outTimeMultiIndex });
  },

  // 手术时间列变化
  onSurgeryTimeColumnChange: function(e) {
    const columnIndex = e.detail.column;
    const rowIndex = e.detail.value;
    const surgeryTimeMultiIndex = this.data.surgeryTimeMultiIndex;
    surgeryTimeMultiIndex[columnIndex] = rowIndex;
    this.setData({ surgeryTimeMultiIndex: surgeryTimeMultiIndex });
  },

  // 从multiIndex获取日期对象
  getDateFromMultiIndex: function(multiIndex, multiArray) {
    const year = parseInt(multiArray[0][multiIndex[0]]);
    const month = parseInt(multiArray[1][multiIndex[1]]) - 1;
    const day = parseInt(multiArray[2][multiIndex[2]]);
    const hour = parseInt(multiArray[3][multiIndex[3]]);
    const minute = parseInt(multiArray[4][multiIndex[4]]);
    return new Date(year, month, day, hour, minute);
  },

  // 格式化时间显示
  formatTimeDisplay: function(date) {
    return formatTime.formatTimeDisplay(date);
  },

  // 格式化时间值
  formatTimeValue: function(date) {
    return formatTime.formatTimeValue(date);
  },

  // 输入框事件
  onInput: function(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  // 性别选择
  onGenderChange: function(e) {
    const index = e.detail.value;
    this.setData({
      genderIndex: index,
      gender: this.data.genderOptions[index]
    });
  },

  // 科室选择
  onDeptChange: function(e) {
    const index = e.detail.value;
    this.setData({
      deptIndex: index,
      dept: this.data.deptOptions[index]
    });
  },

  // 转归选择
  onOutcomeChange: function(e) {
    const index = e.detail.value;
    this.setData({
      outcomeIndex: index,
      outcome: this.data.outcomeOptions[index]
    });
  },

  // 入科时间选择
  onInTimeChange: function(e) {
    const date = this.getDateFromMultiIndex(e.detail.value, this.data.inTimeMultiArray);
    this.setData({
      inTimeStr: this.formatTimeDisplay(date),
      inTime: this.formatTimeValue(date),
      inTimeMultiIndex: e.detail.value
    });
  },

  // 出科时间选择
  onOutTimeChange: function(e) {
    const date = this.getDateFromMultiIndex(e.detail.value, this.data.outTimeMultiArray);
    this.setData({
      outTimeStr: this.formatTimeDisplay(date),
      outTime: this.formatTimeValue(date),
      outTimeMultiIndex: e.detail.value
    });
  },

  // 手术时间选择
  onSurgeryTimeChange: function(e) {
    const date = this.getDateFromMultiIndex(e.detail.value, this.data.surgeryTimeMultiArray);
    this.setData({
      surgeryTimeStr: this.formatTimeDisplay(date),
      surgeryTime: this.formatTimeValue(date),
      surgeryTimeMultiIndex: e.detail.value
    });
  },

  // 开关切换
  onSwitchChange: function(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  // 分诊级别选择
  onTriageSelect: function(e) {
    const level = e.currentTarget.dataset.level;
    this.setData({ triageLevel: level });
  },

  // 诊断选择器 - 获得焦点时显示
  onDiagnosisFocus: function() {
    this.setData({ showDiagnosisPicker: true, searchDiagnosis: '' });
    this.filterDiagnoses('');
  },

  // 诊断输入搜索
  onDiagnosisInput: function(e) {
    const value = e.detail.value;
    this.setData({ searchDiagnosis: value });
    this.filterDiagnoses(value);
  },

  // 过滤诊断列表
  filterDiagnoses: function(keyword) {
    const diagnoses = app.globalData.diagnoses || [];
    let filtered = [];
    
    if (keyword && keyword.length > 0) {
      const upperKeyword = keyword.toUpperCase();
      for (let i = 0; i < diagnoses.length; i++) {
        const item = diagnoses[i];
        if (item.name.indexOf(keyword) !== -1 || item.pinyin.indexOf(upperKeyword) !== -1) {
          filtered.push(item);
          if (filtered.length >= 30) break;
        }
      }
    } else {
      filtered = diagnoses.slice(0, 30);
    }
    
    this.setData({ filteredDiagnoses: filtered });
  },

  // 选择诊断
  onDiagnosisSelect: function(e) {
    const name = e.currentTarget.dataset.name;
    this.setData({
      diagnosis: name,
      showDiagnosisPicker: false,
      searchDiagnosis: ''
    });
  },

  // ==================== 医生选择器 ====================

  // 医生输入
  onDoctorInput: function(e) {
    const value = e.detail.value;
    this.setData({ doctor: value, searchDoctor: value });
    this.filterDoctors(value);
  },

  // 医生获得焦点
  onDoctorFocus: function() {
    this.setData({ showDoctorPicker: true, searchDoctor: '' });
    this.filterDoctors('');
  },

  // 过滤医生列表
  filterDoctors: function(keyword) {
    const doctors = this.data.doctorOptions;
    let filtered = [];
    
    if (keyword && keyword.length > 0) {
      for (let i = 0; i < doctors.length; i++) {
        if (doctors[i].indexOf(keyword) !== -1) {
          filtered.push(doctors[i]);
        }
      }
    } else {
      filtered = doctors.slice();
    }
    
    this.setData({ filteredDoctors: filtered.slice(0, 20) });
  },

  // 医生搜索输入
  onDoctorSearchInput: function(e) {
    const value = e.detail.value;
    this.setData({ searchDoctor: value, doctor: value });
    this.filterDoctors(value);
  },

  // 选择医生
  onDoctorSelect: function(e) {
    const name = e.currentTarget.dataset.name;
    this.setData({
      doctor: name,
      showDoctorPicker: false,
      searchDoctor: ''
    });
  },

  // 关闭医生选择器
  closeDoctorPicker: function() {
    this.setData({ showDoctorPicker: false });
  },

  // 关闭诊断选择器
  closeDiagnosisPicker: function() {
    this.setData({ showDiagnosisPicker: false });
  },

  // 提交表单
  onSubmit: async function() {
    if (!this.data.name || !this.data.name.trim()) {
      wx.showToast({ title: '请输入患者姓名', icon: 'none' });
      return;
    }
    if (!this.data.age) {
      wx.showToast({ title: '请输入年龄', icon: 'none' });
      return;
    }
    var age = parseInt(this.data.age);
    if (isNaN(age) || age < 0 || age > 150) {
      wx.showToast({ title: '年龄范围0-150岁', icon: 'none' });
      return;
    }
    if (!this.data.gender) {
      wx.showToast({ title: '请选择性别', icon: 'none' });
      return;
    }
    if (!this.data.triageLevel) {
      wx.showToast({ title: '请选择分诊级别', icon: 'none' });
      return;
    }
    if (!this.data.inTime) {
      wx.showToast({ title: '请选择入科时间', icon: 'none' });
      return;
    }

    // 生命体征范围验证
    if (this.data.pulse) {
      var pulse = parseInt(this.data.pulse);
      if (isNaN(pulse) || pulse < 0 || pulse > 300) {
        wx.showToast({ title: '脉搏范围0-300次/分', icon: 'none' });
        return;
      }
    }
    if (this.data.heartRate) {
      var hr = parseInt(this.data.heartRate);
      if (isNaN(hr) || hr < 0 || hr > 300) {
        wx.showToast({ title: '心率范围0-300次/分', icon: 'none' });
        return;
      }
    }
    if (this.data.respRate) {
      var rr = parseInt(this.data.respRate);
      if (isNaN(rr) || rr < 0 || rr > 100) {
        wx.showToast({ title: '呼吸范围0-100次/分', icon: 'none' });
        return;
      }
    }
    if (this.data.spo2) {
      var spo2 = parseInt(this.data.spo2);
      if (isNaN(spo2) || spo2 < 0 || spo2 > 100) {
        wx.showToast({ title: '血氧饱和度范围0-100%', icon: 'none' });
        return;
      }
    }
    if (this.data.bpSystolic) {
      var sys = parseInt(this.data.bpSystolic);
      if (isNaN(sys) || sys < 0 || sys > 300) {
        wx.showToast({ title: '收缩压范围0-300mmHg', icon: 'none' });
        return;
      }
    }
    if (this.data.bpDiastolic) {
      var dia = parseInt(this.data.bpDiastolic);
      if (isNaN(dia) || dia < 0 || dia > 300) {
        wx.showToast({ title: '舒张压范围0-300mmHg', icon: 'none' });
        return;
      }
    }

    const patient = {
      name: this.data.name.trim(),
      age: parseInt(this.data.age),
      gender: this.data.gender,
      triageLevel: this.data.triageLevel,
      vitalSigns: {
        pulse: parseInt(this.data.pulse) || 0,
        respRate: parseInt(this.data.respRate) || 0,
        heartRate: parseInt(this.data.heartRate) || 0,
        spo2: parseInt(this.data.spo2) || 0,
        bpSystolic: parseInt(this.data.bpSystolic) || 0,
        bpDiastolic: parseInt(this.data.bpDiastolic) || 0
      },
      inTime: this.data.inTime,
      outTime: this.data.outTime || null,
      diagnosis: this.data.diagnosis.trim(),
      doctor: this.data.doctor.trim(),
      hospitalized: this.data.hospitalized,
      dept: this.data.dept,
      ivAccess: this.data.ivAccess,
      rescued: this.data.rescued,
      intubated: this.data.intubated,
      centralLine: this.data.centralLine,
      cpr: this.data.cpr,
      cprSuccess: this.data.cprSuccess,
      death: this.data.death,
      outcome: this.data.outcome,
      surgery: this.data.surgery,
      surgeryTime: this.data.surgeryTime || null,
      severeTrauma: this.data.severeTrauma
    };

    // 保存所有OCR扫描结果（从全局缓存读取）
    var ocrBuffer = app.globalData._ocrTempBuffer || [];
    if (ocrBuffer.length > 0) {
      patient.ocrResults = ocrBuffer.slice();
      patient.ocrResult = ocrBuffer[ocrBuffer.length - 1];
    } else if (this.data.ocrDataList.length > 0) {
      patient.ocrResults = this.data.ocrDataList;
      patient.ocrResult = this.data.ocrDataList[this.data.ocrDataList.length - 1];
    }

    try {
      if (this.data.editMode) {
        // 编辑模式：更新患者
        await app.updatePatient(this.data.editPatientId, patient);
        toast.showSuccess('更新成功');
      } else {
        patient.createdBy = app.getCurrentUser().userId;
        await app.addPatient(patient);
        toast.showSuccess('保存成功');
      }
      this.resetForm();
      
      // 如果是编辑模式，返回列表页
      if (this.data.editMode) {
        setTimeout(function() {
          wx.navigateBack();
        }, 1500);
      }
    } catch (e) {
      console.error('保存失败:', e);
      toast.showError('保存失败: ' + e.message);
    }
  },

  // 重置表单
  resetForm: function() {
    const now = new Date();
    const yearRangeBefore = config.timePicker.yearRangeBefore;
    const currentIndex = [
      now.getFullYear() - (now.getFullYear() - yearRangeBefore),
      now.getMonth(),
      now.getDate() - 1,
      now.getHours(),
      now.getMinutes()
    ];
    
    this.setData({
      name: '',
      age: '',
      gender: '',
      genderIndex: -1,
      triageLevel: '',
      pulse: '',
      respRate: '',
      heartRate: '',
      spo2: '',
      bpSystolic: '',
      bpDiastolic: '',
      outTime: '',
      outTimeStr: '',
      outTimeMultiIndex: currentIndex,
      diagnosis: '',
      doctor: '',
      hospitalized: false,
      dept: '',
      deptIndex: -1,
      ivAccess: false,
      rescued: false,
      intubated: false,
      centralLine: false,
      cpr: false,
      cprSuccess: false,
      death: false,
      outcome: '',
      outcomeIndex: -1,
      surgery: false,
      surgeryTime: '',
      surgeryTimeStr: '',
      surgeryTimeMultiIndex: currentIndex,
      severeTrauma: false,
      editMode: false,
      editPatientId: '',
      ocrResult: '',
      ocrRawText: '',
      ocrFileID: '',
      ocrFillData: null,
      ocrData: null,
      ocrDataList: []
    });

    // 清除全局OCR缓存
    app.globalData._ocrTempBuffer = [];

    // 重置入科时间为当前时间
    const timeStr = this.formatTimeDisplay(now);
    const timeValue = this.formatTimeValue(now);
    this.setData({
      inTimeStr: timeStr,
      inTime: timeValue,
      inTimeMultiIndex: currentIndex
    });
  }
});
