const app = getApp();
const eventBus = require('../../utils/eventBus.js');
const formatTime = require('../../utils/formatTime.js');

Page({
  data: {
    patient: null,
    patientId: '',
    ocrItems: [],
    levelNum: 4
  },

  onLoad: function(options) {
    if (!app.checkLogin()) return;

    var patientId = options.id;
    if (!patientId) {
      wx.showToast({ title: '缺少患者ID', icon: 'none' });
      wx.navigateBack();
      return;
    }

    this.setData({ patientId: patientId });
    this.loadPatient(patientId);

    // 监听文本编辑完成事件
    var self = this;
    eventBus.on('ocrTextEdited', function(data) {
      if (data.patientId === self.data.patientId) {
        self.handleOcrTextEdited(data);
      }
    });
  },

  onUnload: function() {
    eventBus.off('ocrTextEdited');
  },

  handleOcrTextEdited: function(data) {
    var idx = data.editIdx;
    var newText = data.content;

    if (idx < 0 || !this.data.patient) return;

    var patient = this.data.patient;
    var updated = false;

    if (patient.ocrResults && Array.isArray(patient.ocrResults) && idx < patient.ocrResults.length) {
      patient.ocrResults[idx] = Object.assign({}, patient.ocrResults[idx], {
        formattedText: newText,
        editedAt: new Date().toISOString()
      });
      if (idx === patient.ocrResults.length - 1) {
        patient.ocrResult = patient.ocrResults[idx];
      }
      updated = true;
    } else if (idx === 0 && patient.ocrResult) {
      patient.ocrResult = Object.assign({}, patient.ocrResult, {
        formattedText: newText,
        editedAt: new Date().toISOString()
      });
      updated = true;
    }

    if (updated) {
      // 使用app.updatePatient保存
      app.updatePatient(this.data.patientId, {
        ocrResults: patient.ocrResults,
        ocrResult: patient.ocrResult
      }).then(() => {
        wx.showToast({ title: 'OCR已更新', icon: 'success' });
        this.loadPatient(this.data.patientId);
      }).catch((err) => {
        console.error('保存OCR编辑失败:', err);
        wx.showToast({ title: '保存失败', icon: 'none' });
      });
    }
  },

  onShow: function() {
    // 检查是否有OCR编辑结果
    var app = getApp();
    if (app.globalData._ocrEditResult) {
      this.handleOcrTextEdited(app.globalData._ocrEditResult);
      app.globalData._ocrEditResult = null;
    }

    // 如果从编辑页面返回，重新加载数据
    if (this.data.patientId) {
      this.loadPatient(this.data.patientId);
    }
  },

  loadPatient: function(patientId) {
    app.loadPatients();
    var patients = app.globalData.patients || [];
    var patient = null;
    for (var i = 0; i < patients.length; i++) {
      if (patients[i].id === patientId) {
        patient = patients[i];
        break;
      }
    }

    if (!patient) {
      wx.showToast({ title: '患者不存在', icon: 'none' });
      return;
    }

    // 计算分诊等级数字
    var levelMap = { 'Ⅰ': 1, 'Ⅱ': 2, 'Ⅲ': 3, 'Ⅳ': 4 };
    var levelNum = levelMap[patient.triageLevel] || 4;

    // 处理OCR结果
    var ocrItems = this.buildOcrDisplayItems(patient);

    this.setData({
      patient: patient,
      levelNum: levelNum,
      ocrItems: ocrItems
    });
  },

  // 构建OCR显示条目（支持新版多结果和旧版单结果）
  buildOcrDisplayItems: function(patient) {
    var items = [];

    // 新版：ocrResults 数组
    if (patient.ocrResults && Array.isArray(patient.ocrResults) && patient.ocrResults.length > 0) {
      for (var i = 0; i < patient.ocrResults.length; i++) {
        var item = this.formatSingleOcr(patient.ocrResults[i]);
        if (item) items.push(item);
      }
    }

    // 旧版：单条 ocrResult
    if (items.length === 0 && patient.ocrResult) {
      var item = this.formatSingleOcr(patient.ocrResult);
      if (item) items.push(item);
    }

    return items;
  },

  // 格式化单条OCR结果为显示文本
  formatSingleOcr: function(ocr) {
    if (!ocr) return null;

    // 优先使用格式化文本
    var displayText = ocr.formattedText || ocr.rawText || '';

    // 如果只有原始文本，尝试用格式化函数处理
    if (!ocr.formattedText && ocr.rawText) {
      try {
        var ocrManager = require('../../utils/ocrMedicalManager.js');
        var docType = ocr.docType || ocrManager.detectDocumentType(ocr.rawText);
        switch (docType) {
          case 'medicalOrder':
            displayText = ocrManager.formatMedicalOrders(ocr.rawText);
            break;
          case 'inspection':
            displayText = ocrManager.formatInspectionResults(ocr.rawText);
            break;
          case 'outpatientRecord':
            displayText = ocrManager.formatOutpatientRecord(ocr.rawText);
            break;
          default:
            displayText = ocrManager.formatMixedDocument(ocr.rawText, ocrManager.parseMedicalOrders(ocr.rawText), ocrManager.parseOutpatientRecord(ocr.rawText));
        }
      } catch (e) {
        console.error('OCR格式化失败:', e);
        displayText = ocr.rawText;
      }
    }

    var docType = ocr.docType || 'unknown';
    return {
      rawText: ocr.rawText || '',
      formattedText: ocr.formattedText || '',
      displayText: displayText,
      docType: docType,
      scanTime: ocr.scanTime || ocr.createdAt || ''
    };
  },

  // 编辑OCR内容（跳转到文本编辑页面）
  editOcrItem: function(e) {
    var idx = e.currentTarget.dataset.idx;
    var item = this.data.ocrItems[idx];
    if (!item) return;
    var originalText = item.displayText || item.formattedText || item.rawText || '';

    var app = getApp();
    app.globalData._textEditData = {
      content: originalText,
      editIdx: idx,
      patientId: this.data.patientId
    };

    wx.navigateTo({
      url: '/pages/textedit/textedit?editIdx=' + idx + '&patientId=' + encodeURIComponent(this.data.patientId)
    });
  },

  // 跳转到编辑
  goEdit: function() {
    if (!this.data.patient) return;

    // 使用事件总线传递编辑数据
    eventBus.emit('editPatient', {
      mode: 'edit',
      patientId: this.data.patientId,
      patient: this.data.patient
    });

    wx.switchTab({
      url: '/pages/index/index'
    });
  },

  goBack: function() {
    wx.switchTab({
      url: '/pages/list/list'
    });
  },

  formatTime: function(date) {
    return formatTime.formatDateTime(date);
  }
});
