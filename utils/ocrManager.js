// OCR管理器 - 支持医疗文档智能识别
const config = require('../config.js');

class OCRManager {
  constructor() {
    this.config = config.importExport.ocr;
  }

  // 识别医嘱单
  async recognizeMedicalOrder(imagePath) {
    wx.showLoading({
      title: '正在识别医嘱...',
      mask: true
    });

    try {
      // 压缩图片
      const compressedPath = await this.compressImage(imagePath);

      // 调用OCR API
      const ocrResult = await this.callOCR(compressedPath);
      const medicalOrder = this.parseMedicalOrder(ocrResult);

      wx.hideLoading();
      return medicalOrder;
    } catch (e) {
      wx.hideLoading();
      console.error('识别失败:', e);
      wx.showToast({
        title: '识别失败: ' + e.message,
        icon: 'none'
      });
      throw e;
    }
  }

  // 识别检验结果
  async recognizeLabResult(imagePath) {
    wx.showLoading({
      title: '正在识别检验结果...',
      mask: true
    });

    try {
      const compressedPath = await this.compressImage(imagePath);
      const ocrResult = await this.callOCR(compressedPath);
      const labResult = this.parseLabResult(ocrResult);

      wx.hideLoading();
      return labResult;
    } catch (e) {
      wx.hideLoading();
      console.error('识别失败:', e);
      wx.showToast({
        title: '识别失败: ' + e.message,
        icon: 'none'
      });
      throw e;
    }
  }

  // 识别门诊病历
  async recognizeOutpatientRecord(imagePath) {
    wx.showLoading({
      title: '正在识别病历...',
      mask: true
    });

    try {
      const compressedPath = await this.compressImage(imagePath);
      const ocrResult = await this.callOCR(compressedPath);
      const record = this.parseOutpatientRecord(ocrResult);

      wx.hideLoading();
      return record;
    } catch (e) {
      wx.hideLoading();
      console.error('识别失败:', e);
      wx.showToast({
        title: '识别失败: ' + e.message,
        icon: 'none'
      });
      throw e;
    }
  }

  // 调用OCR API (使用微信云开发OCR服务)
  async callOCR(imagePath) {
    return new Promise((resolve, reject) => {
      if (!wx.cloud) {
        reject(new Error('云开发未初始化'));
        return;
      }

      // 使用微信云开发的OCR服务
      wx.cloud.getOpenData({
        list: [{
          type: 'img',
          url: imagePath
        }],
        success: (res) => {
          resolve(res);
        },
        fail: (err) => {
          reject(new Error('OCR服务调用失败'));
        }
      });
    });
  }

  // 解析医嘱
  parseMedicalOrder(ocrResult) {
    const text = this.extractText(ocrResult);

    return {
      orderType: this.extractOrderType(text),
      medications: this.extractMedications(text),
      dosage: this.extractDosage(text),
      frequency: this.extractFrequency(text),
      route: this.extractRoute(text),
      startDate: this.extractStartDate(text),
      doctor: this.extractDoctor(text),
      department: this.extractDepartment(text),
      rawText: text
    };
  }

  // 提取文本
  extractText(ocrResult) {
    if (ocrResult && ocrResult.data && ocrResult.data[0]) {
      return ocrResult.data[0].text || '';
    }
    return '';
  }

  // 提取医嘱类型
  extractOrderType(text) {
    const patterns = {
      '长期医嘱': /长期医嘱|long.*term/i,
      '临时医嘱': /临时医嘱|stat|prn/i,
      '口服药': /口服|po/i,
      '注射': /注射|im|iv/i,
      '外用': /外用|external/i
    };

    for (const [type, pattern] of Object.entries(patterns)) {
      if (pattern.test(text)) {
        return type;
      }
    }
    return '未知';
  }

  // 提取药物信息
  extractMedications(text) {
    const medications = [];
    const drugPatterns = [
      /([阿-龥]{2,10})\s*(\d+mg|\d+g|\d+ml)/g,
      /([A-Za-z]{2,20})\s*(\d+mg|\d+g|\d+ml)/g
    ];

    drugPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        medications.push({
          name: match[1],
          dosage: match[2]
        });
      }
    });

    return medications;
  }

  // 提取剂量
  extractDosage(text) {
    const match = text.match(/(\d+mg|\d+g|\d+ml|\d+片|\d+粒)/i);
    return match ? match[1] : '';
  }

  // 提取频次
  extractFrequency(text) {
    const patterns = {
      '每日一次': /qd|每日1次|一天1次/i,
      '每日两次': /bid|每日2次|一天2次/i,
      '每日三次': /tid|每日3次|一天3次/i,
      '每日四次': /qid|每日4次|一天4次/i,
      '必要时': /prn|必要时/i
    };

    for (const [freq, pattern] of Object.entries(patterns)) {
      if (pattern.test(text)) {
        return freq;
      }
    }
    return '';
  }

  // 提取给药途径
  extractRoute(text) {
    const patterns = {
      '口服': /口服|po/i,
      '静脉注射': /静脉注射|iv|静注/i,
      '肌肉注射': /肌肉注射|im|肌注/i,
      '皮下注射': /皮下注射|sc|皮下/i,
      '外用': /外用/i
    };

    for (const [route, pattern] of Object.entries(patterns)) {
      if (pattern.test(text)) {
        return route;
      }
    }
    return '';
  }

  // 提取开始日期
  extractStartDate(text) {
    const match = text.match(/(\d{4}-\d{2}-\d{2}|\d{4}年\d{2}月\d{2}日)/);
    return match ? match[1] : '';
  }

  // 提取医生
  extractDoctor(text) {
    const match = text.match(/医师[:：]\s*([^\s]+)/);
    return match ? match[1] : '';
  }

  // 提取科室
  extractDepartment(text) {
    const match = text.match(/科室[:：]\s*([^\s]+)/);
    return match ? match[1] : '';
  }

  // 解析检验结果
  parseLabResult(ocrResult) {
    const text = this.extractText(ocrResult);

    return {
      patientName: this.extractPatientName(text),
      patientId: this.extractPatientId(text),
      testDate: this.extractTestDate(text),
      testType: this.extractTestType(text),
      items: this.extractLabItems(text),
      normalRanges: this.extractNormalRanges(text),
      abnormalFlags: this.extractAbnormalFlags(text),
      rawText: text
    };
  }

  // 提取患者姓名
  extractPatientName(text) {
    const match = text.match(/姓名[:：]\s*([^\s]+)/);
    return match ? match[1] : '';
  }

  // 提取患者ID
  extractPatientId(text) {
    const match = text.match(/(ID|编号|病历号)[:：]\s*([^\s]+)/);
    return match ? match[2] : '';
  }

  // 提取检验日期
  extractTestDate(text) {
    const match = text.match(/(日期|时间)[:：]\s*(\d{4}-\d{2}-\d{2}|\d{4}年\d{2}月\d{2}日)/);
    return match ? match[2] : '';
  }

  // 提取检验类型
  extractTestType(text) {
    const match = text.match(/(检验|检查|化验|项目)[:：]\s*([^\s]+)/);
    return match ? match[2] : '';
  }

  // 提取检验项目
  extractLabItems(text) {
    const items = [];
    const pattern = /([^\s]+?)[:：]\s*(\d+\.?\d*)\s*([^\s]+)/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      items.push({
        name: match[1],
        value: match[2],
        unit: match[3]
      });
    }
    return items;
  }

  // 提取参考范围
  extractNormalRanges(text) {
    const ranges = [];
    const pattern = /([^\s]+?)[:：]\s*(\d+\.?\d*)\s*[-~]\s*(\d+\.?\d*)\s*([^\s]+)/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      ranges.push({
        item: match[1],
        min: match[2],
        max: match[3],
        unit: match[4]
      });
    }
    return ranges;
  }

  // 提取异常标记
  extractAbnormalFlags(text) {
    const flags = [];
    const pattern = /([^\s]+?)[:：]\s*.*?([↑↓])/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      flags.push({
        item: match[1],
        flag: match[2]
      });
    }
    return flags;
  }

  // 解析门诊病历
  parseOutpatientRecord(ocrResult) {
    const text = this.extractText(ocrResult);

    return {
      patientName: this.extractPatientName(text),
      patientId: this.extractPatientId(text),
      visitDate: this.extractTestDate(text),
      department: this.extractDepartment(text),
      chiefComplaint: this.extractField(text, /主诉[:：]\s*([^\n]+)/),
      diagnosis: this.extractField(text, /诊断[:：]\s*([^\n]+)/),
      treatment: this.extractField(text, /处理意见[:：]\s*([^\n]+)/),
      doctor: this.extractDoctor(text),
      rawText: text
    };
  }

  // 提取字段
  extractField(text, pattern) {
    const match = text.match(pattern);
    return match ? match[1].trim() : '';
  }

  // 拍照选择
  async takePhoto() {
    return new Promise((resolve, reject) => {
      wx.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          resolve(res.tempFilePaths[0]);
        },
        fail: reject
      });
    });
  }

  // 图片压缩
  async compressImage(imagePath) {
    return new Promise((resolve, reject) => {
      wx.compressImage({
        src: imagePath,
        quality: Math.floor(this.config.quality * 100),
        success: (res) => resolve(res.tempFilePath),
        fail: (err) => {
          // 压缩失败时返回原图
          console.warn('图片压缩失败,使用原图:', err);
          resolve(imagePath);
        }
      });
    });
  }
}

module.exports = OCRManager;
