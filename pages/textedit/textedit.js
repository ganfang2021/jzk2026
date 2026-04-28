// pages/textedit/textedit.js

Page({
  data: {
    content: '',
    originalContent: '',
    isBold: false,
    isItalic: false,
    isUnderline: false,
    textAlign: 'left',
    fontSizeOptions: ['12', '14', '16', '18', '20', '22', '24', '28', '32', '36', '48', '60'],
    fontSizeIndex: 2,
    currentFontSize: 16,
    lineHeightOptions: ['1.0', '1.2', '1.5', '1.8', '2.0', '2.5'],
    lineHeightIndex: 2,
    currentLineHeight: '1.5',
    canUndo: false,
    canRedo: false,
    history: [],
    historyIndex: -1,
    editIdx: -1,
    patientId: '',
    showFindPanel: false,
    findText: '',
    findResult: '',
    cursorPosition: 0
  },

  onLoad: function(options) {
    var editIdx = parseInt(options.editIdx || '-1', 10);
    var patientId = options.patientId || '';

    var app = getApp();
    var editData = app.globalData._textEditData || {};

    this.setData({
      content: editData.content || '',
      originalContent: editData.content || '',
      editIdx: editIdx,
      patientId: decodeURIComponent(patientId)
    });

    app.globalData._textEditData = null;
    this.initHistory();
  },

  initHistory: function() {
    this.setData({
      history: [this.data.content],
      historyIndex: 0,
      canUndo: false,
      canRedo: false
    });
  },

  onContentInput: function(e) {
    var newContent = e.detail.value;
    this.setData({ content: newContent });

    if (newContent !== this.data.history[this.data.historyIndex]) {
      this.addToHistory(newContent);
    }
  },

  onContentBlur: function(e) {
    this.setData({
      cursorPosition: e.detail.cursor
    });
  },

  addToHistory: function(text) {
    var history = this.data.history.slice(0, this.data.historyIndex + 1);
    history.push(text);

    if (history.length > 100) {
      history.shift();
    }

    this.setData({
      history: history,
      historyIndex: history.length - 1,
      canUndo: this.data.historyIndex > 0,
      canRedo: false
    });
  },

  undo: function() {
    if (this.data.historyIndex > 0) {
      var newIndex = this.data.historyIndex - 1;
      this.setData({
        content: this.data.history[newIndex],
        historyIndex: newIndex,
        canUndo: newIndex > 0,
        canRedo: true
      });
    }
  },

  redo: function() {
    if (this.data.historyIndex < this.data.history.length - 1) {
      var newIndex = this.data.historyIndex + 1;
      this.setData({
        content: this.data.history[newIndex],
        historyIndex: newIndex,
        canUndo: true,
        canRedo: newIndex < this.data.history.length - 1
      });
    }
  },

  // 格式化功能
  toggleBold: function() {
    var content = this.data.content;
    var pos = this.data.cursorPosition;
    var before = content.substring(0, pos);
    var after = content.substring(pos);
    var newContent = before + '**' + after;
    this.applyFormat(newContent);
    this.setData({ isBold: !this.data.isBold });
  },

  toggleItalic: function() {
    var content = this.data.content;
    var pos = this.data.cursorPosition;
    var before = content.substring(0, pos);
    var after = content.substring(pos);
    var newContent = before + '_' + after;
    this.applyFormat(newContent);
    this.setData({ isItalic: !this.data.isItalic });
  },

  toggleUnderline: function() {
    var content = this.data.content;
    var pos = this.data.cursorPosition;
    var before = content.substring(0, pos);
    var after = content.substring(pos);
    var newContent = before + '__' + after;
    this.applyFormat(newContent);
    this.setData({ isUnderline: !this.data.isUnderline });
  },

  alignLeft: function() {
    this.setData({ textAlign: 'left' });
    wx.showToast({ title: '左对齐', icon: 'none' });
  },

  alignCenter: function() {
    this.setData({ textAlign: 'center' });
    wx.showToast({ title: '居中对齐', icon: 'none' });
  },

  alignRight: function() {
    this.setData({ textAlign: 'right' });
    wx.showToast({ title: '右对齐', icon: 'none' });
  },

  indentIncrease: function() {
    var content = this.data.content;
    var pos = this.data.cursorPosition;
    var lines = content.substring(0, pos).split('\n');
    var currentLineStart = content.lastIndexOf('\n', pos - 1) + 1;
    var before = content.substring(0, currentLineStart);
    var after = content.substring(currentLineStart);
    var newContent = before + '    ' + after;
    this.applyFormat(newContent);
    wx.showToast({ title: '增加缩进', icon: 'none' });
  },

  indentDecrease: function() {
    var content = this.data.content;
    var pos = this.data.cursorPosition;
    var lines = content.substring(0, pos).split('\n');
    var currentLineStart = content.lastIndexOf('\n', pos - 1) + 1;
    var lineContent = content.substring(currentLineStart);

    if (lineContent.startsWith('    ')) {
      var newContent = content.substring(0, currentLineStart) + lineContent.substring(4);
      this.applyFormat(newContent);
    }
    wx.showToast({ title: '减少缩进', icon: 'none' });
  },

  formatBullet: function() {
    var content = this.data.content;
    var pos = this.data.cursorPosition;
    var lines = content.substring(0, pos).split('\n');
    var currentLineStart = content.lastIndexOf('\n', pos - 1) + 1;
    var before = content.substring(0, currentLineStart);
    var after = content.substring(currentLineStart);

    if (after.match(/^[\•\-\*\+] /)) {
      var newContent = before + after.replace(/^[\•\-\*\+] /, '');
    } else {
      var newContent = before + '• ' + after;
    }
    this.applyFormat(newContent);
    wx.showToast({ title: '项目符号', icon: 'none' });
  },

  formatNumber: function() {
    var content = this.data.content;
    var pos = this.data.cursorPosition;
    var lines = content.substring(0, pos).split('\n');
    var currentLineStart = content.lastIndexOf('\n', pos - 1) + 1;
    var before = content.substring(0, currentLineStart);
    var after = content.substring(currentLineStart);

    var num = lines.length;
    if (after.match(/^\d+\. /)) {
      var newContent = before + after.replace(/^\d+\. /, '');
    } else {
      var newContent = before + num + '. ' + after;
    }
    this.applyFormat(newContent);
    wx.showToast({ title: '编号列表', icon: 'none' });
  },

  formatHeader: function() {
    var content = this.data.content;
    var pos = this.data.cursorPosition;
    var lines = content.split('\n');
    var lineIndex = content.substring(0, pos).split('\n').length - 1;

    if (lines[lineIndex].startsWith('【') && lines[lineIndex].endsWith('】')) {
      lines[lineIndex] = lines[lineIndex].replace(/^【|】$/g, '');
    } else {
      lines[lineIndex] = '【' + lines[lineIndex] + '】';
    }

    var newContent = lines.join('\n');
    this.applyFormat(newContent);
    wx.showToast({ title: '标题格式', icon: 'none' });
  },

  insertDivider: function() {
    var content = this.data.content;
    var pos = this.data.cursorPosition;
    var before = content.substring(0, pos);
    var after = content.substring(pos);
    var newContent = before + '\n═══════════════════════════════\n' + after;
    this.applyFormat(newContent);
    wx.showToast({ title: '分隔线已插入', icon: 'none' });
  },

  applyFormat: function(newContent) {
    this.setData({ content: newContent });
    this.addToHistory(newContent);
  },

  // 字号选择
  onFontSizeChange: function(e) {
    var index = parseInt(e.detail.value, 10);
    var size = parseInt(this.data.fontSizeOptions[index], 10);
    this.setData({
      fontSizeIndex: index,
      currentFontSize: size
    });
  },

  // 行距选择
  onLineHeightChange: function(e) {
    var index = parseInt(e.detail.value, 10);
    this.setData({
      lineHeightIndex: index,
      currentLineHeight: this.data.lineHeightOptions[index]
    });
  },

  // 查找功能
  findText: function() {
    this.setData({ showFindPanel: true, findText: '', findResult: '' });
  },

  onFindInput: function(e) {
    this.setData({ findText: e.detail.value });
  },

  doFind: function() {
    var text = this.data.findText;
    var content = this.data.content;

    if (!text) {
      this.setData({ findResult: '请输入查找内容' });
      return;
    }

    var index = content.indexOf(text);
    if (index >= 0) {
      this.setData({ findResult: '找到第 ' + (index + 1) + ' 个匹配' });
    } else {
      this.setData({ findResult: '未找到匹配' });
    }
  },

  closeFindPanel: function() {
    this.setData({ showFindPanel: false });
  },

  // AI智能医疗文书排版（调用云函数）
  aiFormat: function() {
    var content = this.data.content;
    if (!content || content.trim().length === 0) {
      wx.showToast({ title: '内容为空', icon: 'none' });
      return;
    }

    var self = this;
    wx.showLoading({ title: 'AI排版中...' });

    // 调用云函数进行AI排版
    wx.cloud.callFunction({
      name: 'aiFormat',
      data: {
        text: content
      },
      timeout: 25000,  // 25秒超时
      success: function(res) {
        wx.hideLoading();
        console.log('AI排版结果:', res);

        if (res.result && res.result.success) {
          var formatted = res.result.text;
          self.setData({ content: formatted });
          self.addToHistory(formatted);
          wx.showToast({ title: 'AI排版完成', icon: 'success' });
        } else {
          var errMsg = res.result ? res.result.error : 'AI排版失败';
          wx.showToast({ title: errMsg, icon: 'none' });
        }
      },
      fail: function(err) {
        wx.hideLoading();
        console.error('AI排版云函数调用失败:', err);
        wx.showToast({ title: 'AI排版失败', icon: 'none' });
      }
    });
  },

  // AI医疗文书格式化逻辑
  aiMedicalFormat: function(text) {
    var lines = text.split('\n');
    var result = [];
    var prevSection = '';
    var inTable = false;
    var tableLines = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmedLine = line.trim();

      // 空行直接保留
      if (!trimmedLine) {
        if (inTable && tableLines.length > 0) {
          result.push.apply(result, this._formatLabTable(tableLines));
          tableLines = [];
          inTable = false;
        }
        result.push('');
        continue;
      }

      // ========== 检测章节标题 ==========
      var sectionInfo = this._detectSection(trimmedLine);
      if (sectionInfo.detected) {
        // 关闭表格
        if (inTable && tableLines.length > 0) {
          result.push.apply(result, this._formatLabTable(tableLines));
          tableLines = [];
          inTable = false;
        }
        // 只有新章节才加分隔线
        if (prevSection) {
          result.push('');
        }
        result.push('━━━ ' + sectionInfo.title + ' ━━━');
        prevSection = sectionInfo.title;
        continue;
      }

      // ========== 检测检验表格 ==========
      if (this._isLabHeader(trimmedLine)) {
        if (inTable && tableLines.length > 0) {
          result.push.apply(result, this._formatLabTable(tableLines));
          tableLines = [];
        }
        tableLines = [trimmedLine];
        inTable = true;
        continue;
      }

      if (inTable) {
        if (this._isLabRow(trimmedLine)) {
          tableLines.push(trimmedLine);
          continue;
        } else {
          result.push.apply(result, this._formatLabTable(tableLines));
          tableLines = [];
          inTable = false;
        }
      }

      // ========== 其他内容原样保留（不做任何修改） ==========
      result.push(trimmedLine);
    }

    // 处理剩余表格
    if (inTable && tableLines.length > 0) {
      result.push.apply(result, this._formatLabTable(tableLines));
    }

    // 清理连续空行（最多保留1个）
    var final = [];
    var emptyCount = 0;
    for (var n = 0; n < result.length; n++) {
      if (result[n].trim() === '') {
        emptyCount++;
        if (emptyCount <= 1) {
          final.push(result[n]);
        }
      } else {
        emptyCount = 0;
        final.push(result[n]);
      }
    }

    return final.join('\n');
  },

  // 检测章节标题
  _detectSection: function(line) {
    var headers = [
      '主诉', '现病史', '既往史', '个人史', '家族史', '药物过敏史',
      '体格检查', '专科检查', '辅助检查', '实验室检查', '影像学检查', '心电图', '超声',
      '诊断', '诊断依据', '鉴别诊断',
      '治疗', '治疗方案', '药物治疗', '手术治疗', '处置', '手术', '操作',
      '医嘱', '长期医嘱', '临时医嘱',
      '病程记录', '病程', '日常病程',
      '手术记录', '手术经过', '术中情况',
      '知情同意', '知情同意书', '沟通记录',
      '出院小结', '出院记录', '出院医嘱',
      '入院记录', '入院病史',
      '会诊记录', '转科记录', '入ICU', '出ICU',
      '抢救记录', '死亡记录', '死亡讨论',
      '护理记录', '护理措施', '护理查房',
      '查房记录', '上级医师查房', '主治医师查房',
      '检验报告', '检查报告', '报告单',
      '血常规', '尿常规', '大便常规', '生化', '凝血', '免疫', '肿瘤标志物',
      '出入量', '入量', '出量', '24小时出入量'
    ];

    // 中文数字编号模式：一、二、三... 或 第一、第二...
    var numPattern = line.match(/^([一二三四五六七八九十]+)[、.。]\s*(.+)/);
if (numPattern) {
      var title = numPattern[1] + '、' + numPattern[2].trim();
      return { detected: true, title: title };
    }

    var numPattern2 = line.match(/^(第[一二三四五六七八九十\d]+[章节款条])\s*(.+)/);
    if (numPattern2) {
      return { detected: true, title: numPattern2[2].trim() };
    }

    // 普通标题模式 - 检查行首或明显标题位置是否包含header关键词
    for (var i = 0; i < headers.length; i++) {
      var headerPos = line.indexOf(headers[i]);
      if (headerPos >= 0) {
        // 如果关键词在行首（位置0-3），返回完整行作为标题
        if (headerPos <= 3) {
          return { detected: true, title: line };
        }
        // 如果是 "xxx：" + 标题 的格式，返回完整行
        if (line.charAt(headerPos - 1) === '：' || line.charAt(headerPos - 1) === ':') {
          return { detected: true, title: line };
        }
        // 如果是【】包裹的标题
        if (line.charAt(0) === '【' && line.indexOf('】') > headerPos) {
          return { detected: true, title: line };
        }
      }
    }

    return { detected: false, title: '' };
  },

  // 检测是否为检验表头
  _isLabHeader: function(line) {
    var patterns = [
      /^[项目检验指标]+$/, /^[结果数值]+$/,
      /项目|检验.*项目|指标.*名称/, /结果|数值|报告值/,
      /血常规/, /尿常规/, /生化/, /凝血/, /电解质/, /肝功能/, /肾功能/,
      /血糖/, /血脂/, /心肌酶/, /甲状腺/, /肿瘤标志物/,
      /^[─═\s]+$/, /^\s*[│├└─┬┼┤╋]+/  // 表格线
    ];
    for (var i = 0; i < patterns.length; i++) {
      if (patterns[i].test(line)) return true;
    }
    // 检查是否有 "项目" 和 "结果" 同时出现（表格特征）
    if (line.includes('项目') && (line.includes('结果') || line.includes('数值'))) {
      return true;
    }
    return false;
  },

  // 检测是否为检验数据行
  _isLabRow: function(line) {
    // 匹配 "名称    值    单位    参考值" 格式
    if (line.match(/^[一-龥a-zA-Z]+\s+[\d\.\-\+\>\<\/]+\s*\/?\s*[\d\.\-\+\>\<]*/)) return true;
    // 匹配箭头值如 "↑↑" "↓↓" "→"
    if (line.match(/[↑↓↔→←]/) && line.match(/\d/)) return true;
    // 匹配 "项目:值" 或 "项目  值" 格式
    if (line.match(/^[一-龥]{2,10}[\s:：]+[\d\.\-\+\~\/]+/)) return true;
    return false;
  },

  // 格式化检验表格
  _formatLabTable: function(lines) {
    if (lines.length === 0) return [];
    var formatted = [];
    formatted.push('');
    formatted.push('┌' + '─'.repeat(50) + '┐');

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      // 尝试提取项目名和值
      var parts = line.split(/[\s\t]+/);
      if (parts.length >= 2) {
        var name = parts[0];
        var value = parts[1];
        var flag = '';
        if (value && value.match(/[↑↓]/)) {
          flag = value.match(/[↑↓]/)[0];
          value = value.replace(/[↑↓]/g, '');
        }
        var display = '│ ' + this._padRight(name, 18) + ' │ ' + this._padRight(value, 12) + ' │';
        formatted.push(display);
      } else {
        formatted.push('│ ' + this._padRight(line, 46) + ' │');
      }
    }

    formatted.push('└' + '─'.repeat(50) + '┘');
    return formatted;
  },

  // 字符串右填充
  _padRight: function(str, len) {
    var s = String(str);
    while (s.length < len) s += ' ';
    return s.substring(0, len);
  },

  // 解析时间+事件格式（如"2024-01-15 10:30 病程记录：患者情况..."）
  _parseTimeEvent: function(line) {
    // 完整日期时间：2024-01-15 10:30 或 2024/01/15 10:30
    var match = line.match(/^(\d{4}[\-\/]\d{1,2}[\-\/]\d{1,2}[\s\‑\~]\d{1,2}[\:：]\d{1,2})\s*[\：\:\-\|]?\s*(.+)/);
    if (match) {
      return { time: match[1], event: match[2] };
    }
    // 简写日期时间：01-15 10:30 或 1-15 10:30
    var match2 = line.match(/^(\d{1,2}[\-\/]\d{1,2}[\s\‑\~]\d{1,2}[\:：]\d{1,2})\s*[\：\:\-\|]?\s*(.+)/);
    if (match2) {
      return { time: match2[1], event: match2[2] };
    }
    // 时间 + 事件：10:30 患者情况...
    var match3 = line.match(/^(\d{1,2}[\:：]\d{1,2})\s*[\：\:\-\|]?\s*(.+)/);
    if (match3) {
      return { time: match3[1], event: match3[2] };
    }
    // 中文日期：2024年1月15日 10:30
    var match4 = line.match(/^(\d{4}年\d{1,2}月\d{1,2}日[\s]\d{1,2}[\:：]\d{1,2})\s*(.+)/);
    if (match4) {
      return { time: match4[1], event: match4[2] };
    }
    // 中文短日期：1月15日 10:30
    var match5 = line.match(/^(\d{1,2}月\d{1,2}日[\s]\d{1,2}[\:：]\d{1,2})\s*(.+)/);
    if (match5) {
      return { time: match5[1], event: match5[2] };
    }
    return null;
  },

  // 解析医嘱
  _parseMedicalOrder: function(line) {
    // 匹配药名+剂量+频次+途径格式
    var patterns = [
      /^([一-龥a-zA-Z0-9]+)\s+(\d+[\.\d]*\s*(?:mg|ml|g|ug|万U|iu|IU|片|粒|支|袋))+([^,]*(?:每日|qd|bid|tid|qid|q8h|q12h|qn|prn|st|po|iv|im|ih|雾化|口服|静脉|肌肉|皮下|外用)[^,]*)/i,
      /^([一-龥]+)\s+(\d+[\.\d]*[一-龥]*(?:mg|ml|g|ug|万U|片|粒|支|袋))+[\s,]+(.+)/,
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = line.match(patterns[i]);
      if (m) {
        return { drug: m[1], dose: m[2], frequency: m[3] || '', route: '' };
      }
    }
    return null;
  },

  // 解析生命体征
  _parseVitals: function(line) {
    var vitals = {};

    // 血压：匹配 "BP 120/80" 或 "120/80mmHg"
    var bpMatch = line.match(/(?:BP|血压)[\s\:：]?(\d+)\/(\d+)/i);
    if (bpMatch) {
      vitals.bp = bpMatch[1] + '/' + bpMatch[2];
    } else {
      var bpMatch2 = line.match(/(\d{2,3})\/(\d{2,3})\s*mmHg/);
      if (bpMatch2) vitals.bp = bpMatch2[1] + '/' + bpMatch2[2];
    }

    // 心率：先匹配 "HR 75" 或 "心率75" 格式（用\b确保完整单词），再考虑 "75次/分"
    var hrMatch = line.match(/(?:\bHR|心率)[\s\:：]?(\d+)/i);
    if (hrMatch) {
      vitals.hr = hrMatch[1];
    } else {
      var hrMatch2 = line.match(/(?:^|[^\d])(\d+)\s*次\/分/);
      if (hrMatch2) vitals.hr = hrMatch2[1];
    }

    // 体温：先匹配 "T 36.5" 或 "体温36.5" 格式，再考虑 "36.5°C"
    var tempMatch = line.match(/(?:\bT|体温)[\s\:：]?(\d+[\.]\d+)/i);
    if (tempMatch) {
      vitals.temp = tempMatch[1] + '°C';
    } else {
      var tempMatch2 = line.match(/(?:^|[^\d])(\d+[\.]\d+)\s*(?:°C|度)/);
      if (tempMatch2) vitals.temp = tempMatch2[1] + '°C';
    }

    // 呼吸：先匹配 "RR 18" 或 "呼吸18" 格式，再考虑 "18次/分"
    var rrMatch = line.match(/(?:\bRR|呼吸)[\s\:：]?(\d+)/i);
    if (rrMatch) {
      vitals.rr = rrMatch[1];
    } else {
      var rrMatch2 = line.match(/(?:^|[^\d])(\d+)\s*次\/分/);
      if (rrMatch2) vitals.rr = rrMatch2[1];
    }

    // 血氧：优先匹配 "SpO2 98" 格式，再考虑 "98%"
    var spo2Match = line.match(/(?:SpO₂|SpO2|血氧)[\s\:：]?(\d+)/i);
    if (spo2Match) {
      vitals.spo2 = spo2Match[1] + '%';
    } else {
      // 只在没有其他生命体征数字时才匹配独立的%
      if (!vitals.bp && !vitals.hr && !vitals.temp && !vitals.rr) {
        var spo2Match2 = line.match(/(\d+)\s*%/);
        if (spo2Match2) vitals.spo2 = spo2Match2[1] + '%';
      }
    }

    var hasVitals = Object.keys(vitals).length > 0;
    return hasVitals ? vitals : null;
  },

  cancelEdit: function() {
    if (this.data.content !== this.data.originalContent) {
      wx.showModal({
        title: '放弃修改',
        content: '确定要放弃所有修改吗？',
        success: (res) => {
          if (res.confirm) {
            wx.navigateBack();
          }
        }
      });
    } else {
      wx.navigateBack();
    }
  },

  saveContent: function() {
    var resultContent = this.data.content;
    var app = getApp();

    app.globalData._ocrEditResult = {
      content: resultContent,
      editIdx: this.data.editIdx,
      patientId: this.data.patientId
    };

    wx.showToast({ title: '已保存', icon: 'success' });

    setTimeout(() => {
      wx.navigateBack();
    }, 1000);
  }
});
