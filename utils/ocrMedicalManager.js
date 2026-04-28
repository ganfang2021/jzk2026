// OCR医疗文档识别管理器 v3.0
// 增强版：高精度识别 + 自动回填表单 + 结构化医学排版

class OCRMedicalManager {
  constructor() {
    this.config = {
      preprocess: {
        maxWidth: 2000,
        maxHeight: 2000,
        quality: 0.9
      }
    };
  }

  // ==================== 图像选择 ====================

  chooseImage({ sourceType = ['album', 'camera'] } = {}) {
    return new Promise((resolve, reject) => {
      wx.chooseImage({
        count: 1,
        sourceType: sourceType,
        sizeType: ['compressed'],
        success: (res) => {
          if (res.tempFilePaths && res.tempFilePaths.length > 0) {
            resolve(res.tempFilePaths[0]);
          } else {
            reject(new Error('未选择图片'));
          }
        },
        fail: (err) => {
          if (err.errMsg && err.errMsg.indexOf('cancel') !== -1) return;
          reject(err);
        }
      });
    });
  }

  // ==================== OCR识别（高精度模式） ====================

  async recognizeText(imagePath, type = 'accurate') {
    try {
      if (!wx.cloud) throw new Error('云开发未初始化');

      wx.showLoading({ title: '正在上传图片...' });
      const uploadResult = await wx.cloud.uploadFile({
        cloudPath: `ocr/${Date.now()}-${Math.random().toString(36).slice(2, 11)}.jpg`,
        filePath: imagePath
      });
      const fileID = uploadResult.fileID;

      wx.showLoading({ title: '正在识别...' });
      const cloudResult = await wx.cloud.callFunction({
        name: 'ocr',
        data: { img: fileID, type: type }
      });

      wx.hideLoading();
      const result = cloudResult.result;
      if (!result || result.success === false) {
        throw new Error(result ? result.error : 'OCR识别失败');
      }

      return {
        text: result.text || '',
        wordsCount: result.wordsCount || 0,
        fileID: result.fileID
      };
    } catch (e) {
      wx.hideLoading();
      throw new Error('文字识别失败: ' + (e.message || e.errMsg || '未知错误'));
    }
  }

  // ==================== 一键扫描（自动识别文档类型并完成所有操作） ====================

  // 统一扫描入口：识别、解析、格式化、提取回填数据、返回完整结果
  async scanDocument(imagePath) {
    const ocrResult = await this.recognizeText(imagePath, 'accurate');

    // 自动检测文档类型
    const docType = this.detectDocumentType(ocrResult.text);

    // 根据类型解析
    let parsed = { type: docType, rawText: ocrResult.text };
    let fillData = {}; // 用于回填表单的结构化数据

    switch (docType) {
      case 'medicalOrder':
        parsed = {
          ...parsed,
          items: this.parseMedicalOrders(ocrResult.text),
          formattedText: this.formatMedicalOrders(ocrResult.text)
        };
        fillData = this.extractFillDataFromOrders(parsed.items, ocrResult.text);
        break;

      case 'inspection':
        parsed = {
          ...parsed,
          items: this.parseInspectionResults(ocrResult.text),
          formattedText: this.formatInspectionResults(ocrResult.text)
        };
        break;

      case 'outpatientRecord':
        parsed = {
          ...parsed,
          record: this.parseOutpatientRecord(ocrResult.text),
          formattedText: this.formatOutpatientRecord(ocrResult.text)
        };
        fillData = this.extractFillDataFromRecord(parsed.record, ocrResult.text);
        break;

      default:
        // 混合类型：尝试提取所有可能的信息
        var orders = this.parseMedicalOrders(ocrResult.text);
        var record = this.parseOutpatientRecord(ocrResult.text);
        parsed = {
          ...parsed,
          items: orders,
          record: record,
          formattedText: this.formatMixedDocument(ocrResult.text, orders, record)
        };
        fillData = this.extractFillDataFromRecord(record, ocrResult.text);
        var orderFill = this.extractFillDataFromOrders(orders, ocrResult.text);
        // 合并回填数据
        for (var key in orderFill) {
          if (orderFill[key] && !fillData[key]) {
            fillData[key] = orderFill[key];
          }
        }
        break;
    }

    // 从所有文档类型中提取生命体征（用于回填表单）
    var vitals = this.extractVitalSigns(ocrResult.text);
    for (var vkey in vitals) {
      if (vitals[vkey] && !fillData[vkey]) {
        fillData[vkey] = vitals[vkey];
      }
    }

    return {
      success: true,
      rawText: ocrResult.text,
      parsed: parsed,
      fillData: fillData, // 结构化回填数据
      formattedText: parsed.formattedText,
      fileID: ocrResult.fileID
    };
  }

  // ==================== 文档类型检测 ====================

  detectDocumentType(text) {
    var score = { medicalOrder: 0, inspection: 0, outpatientRecord: 0 };

    // 医嘱关键词（带权重）
    var orderKW = [
      { w: 3, k: ['医嘱', '长期医嘱', '临时医嘱'] },
      { w: 2, k: ['口服', '静注', '静滴', '肌注', '皮下', '雾化', '泵入'] },
      { w: 2, k: ['qd', 'bid', 'tid', 'qid', 'qn', 'q8h', 'q12h', 'st'] },
      { w: 1, k: ['mg', 'ml', '胶囊', '片剂', '注射', '输液'] }
    ];

    // 检验检查关键词
    var labKW = [
      { w: 3, k: ['检验结果', '检查结果', '检验报告', '检查报告'] },
      { w: 2, k: ['血常规', '尿常规', '生化', '凝血', '参考范围', '参考值'] },
      { w: 2, k: ['WBC', 'RBC', 'HGB', 'PLT', 'ALT', 'AST', 'CRP', 'BNP'] },
      { w: 1, k: ['↓', '↑', '结果', '检验', '检查'] }
    ];

    // 门诊病历关键词
    var recordKW = [
      { w: 3, k: ['主诉', '现病史', '既往史', '门诊病历'] },
      { w: 2, k: ['查体', '体格检查', '诊断', '处理', '治疗意见'] },
      { w: 1, k: ['姓名', '性别', '年龄', '科别', '就诊时间', '体温'] }
    ];

    function calcScore(keywords) {
      var s = 0;
      for (var i = 0; i < keywords.length; i++) {
        for (var j = 0; j < keywords[i].k.length; j++) {
          if (text.indexOf(keywords[i].k[j]) !== -1) {
            s += keywords[i].w;
          }
        }
      }
      return s;
    }

    score.medicalOrder = calcScore(orderKW);
    score.inspection = calcScore(labKW);
    score.outpatientRecord = calcScore(recordKW);

    var maxScore = Math.max(score.medicalOrder, score.inspection, score.outpatientRecord);
    var minScore = 2; // 最低阈值

    if (maxScore < minScore) return 'unknown';
    if (score.medicalOrder >= score.inspection && score.medicalOrder >= score.outpatientRecord) return 'medicalOrder';
    if (score.inspection >= score.outpatientRecord) return 'inspection';
    return 'outpatientRecord';
  }

  // ==================== 从识别结果提取回填表单数据 ====================

  extractFillDataFromOrders(items, rawText) {
    var data = {};
    // 提取诊断（医嘱中常包含诊断）
    var diagMatch = rawText.match(/诊断[：:]\s*([^\n]+)/);
    if (diagMatch) data.diagnosis = diagMatch[1].trim();

    // 提取医生
    var docMatch = rawText.match(/医生[：:]\s*([^\n]+)/);
    if (!docMatch) docMatch = rawText.match(/医师[：:]\s*([^\n]+)/);
    if (docMatch) data.doctor = docMatch[1].trim();

    return data;
  }

  extractFillDataFromRecord(record, rawText) {
    var data = {};

    // 患者姓名
    if (record.patientInfo && record.patientInfo.name) {
      data.name = record.patientInfo.name;
    } else {
      var nameMatch = rawText.match(/姓名[：:]\s*([^\s,，]+)/);
      if (nameMatch) data.name = nameMatch[1].trim();
    }

    // 年龄
    if (record.patientInfo && record.patientInfo.age) {
      data.age = record.patientInfo.age;
    } else {
      var ageMatch = rawText.match(/年龄[：:]\s*(\d+)/);
      if (ageMatch) data.age = ageMatch[1];
    }

    // 性别
    if (record.patientInfo && record.patientInfo.gender) {
      data.gender = record.patientInfo.gender;
    } else {
      var genderMatch = rawText.match(/性别[：:]\s*([男女])/);
      if (genderMatch) data.gender = genderMatch[1];
    }

    // 诊断
    if (record.diagnosis && record.diagnosis.length > 0) {
      data.diagnosis = record.diagnosis.join('、');
    } else {
      var diagMatch = rawText.match(/诊断[：:]\s*([^\n]+)/);
      if (diagMatch) data.diagnosis = diagMatch[1].trim();
    }

    // 医生
    var docMatch = rawText.match(/医生[：:]\s*([^\n]+)/);
    if (!docMatch) docMatch = rawText.match(/医师[：:]\s*([^\n]+)/);
    if (docMatch) data.doctor = docMatch[1].trim();

    // 提取就诊时间
    var timeMatch = rawText.match(/(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})[日]?\s*(\d{1,2})[：:时](\d{1,2})/);
    if (timeMatch) {
      // 格式化为 yyyy-MM-dd HH:mm
      data.inTimeStr = timeMatch[1] + '-' + timeMatch[2].padStart(2, '0') + '-' + timeMatch[3].padStart(2, '0') + ' ' + timeMatch[4].padStart(2, '0') + ':' + timeMatch[5].padStart(2, '0');
    }

    return data;
  }

  // ==================== 医嘱解析（增强版） ====================

  parseMedicalOrders(text) {
    var lines = text.split('\n').filter(function(l) { return l.trim(); });
    var items = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      var category = this.categorizeOrderLine(line);
      var details = this.extractOrderDetails(line);

      items.push({
        original: line,
        category: category,
        name: details.name || line,
        dosage: details.dosage,
        route: details.route,
        frequency: details.frequency,
        duration: details.duration
      });
    }

    return items;
  }

  categorizeOrderLine(text) {
    if (/口服|静注|静滴|肌注|皮下|外用|雾化|含服|泵入|mg|ml|胶囊|片|针|注射液|口服液/i.test(text)) return '药品';
    if (/心电图|胸片|B超|CT|MRI|血常规|尿常规|生化|凝血|培养|超声|X线|造影|镜检/i.test(text)) return '检查';
    if (/护理|监护|监测|吸氧|雾化|降温|翻身|拍背|吸痰|导尿|置管|引流/i.test(text)) return '护理';
    if (/手术|麻醉|局麻|全麻|硬膜外|神经阻滞/i.test(text)) return '手术';
    if (/饮食|普食|流质|半流质|禁食|糖尿病饮食|低盐|低脂/i.test(text)) return '饮食';
    return '其他';
  }

  extractOrderDetails(text) {
    var details = { name: text, dosage: '', route: '', frequency: '', duration: '' };

    var dosageMatch = text.match(/(\d+(?:\.\d+)?)\s*(mg|g|ml|mL|ug|μg|IU|U|单位|万单位)/i);
    if (dosageMatch) details.dosage = dosageMatch[0];

    var routes = ['静脉滴注', '静脉推注', '口服', '静注', '静滴', '肌注', '皮下注射', '皮下', '外用', '雾化吸入', '雾化', '含服', '滴眼', '滴耳', '涂抹', '灌肠', '吸入', '泵入', '皮内'];
    for (var r = 0; r < routes.length; r++) {
      if (text.indexOf(routes[r]) !== -1) { details.route = routes[r]; break; }
    }

    var freqs = [
      { k: '每日一次', v: 'qd' }, { k: '每日两次', v: 'bid' }, { k: '每日三次', v: 'tid' }, { k: '每日四次', v: 'qid' },
      { k: '每晚一次', v: 'qn' }, { k: '必要时', v: 'prn' }, { k: '每8小时', v: 'q8h' }, { k: '每12小时', v: 'q12h' },
      { k: '每6小时', v: 'q6h' }, { k: '每4小时', v: 'q4h' }, { k: 'qd', v: 'qd' }, { k: 'bid', v: 'bid' },
      { k: 'tid', v: 'tid' }, { k: 'qid', v: 'qid' }, { k: 'qn', v: 'qn' }, { k: 'prn', v: 'prn' },
      { k: 'q8h', v: 'q8h' }, { k: 'q12h', v: 'q12h' }, { k: 'st', v: 'st' }, { k: 'biw', v: 'biw' }
    ];
    for (var f = 0; f < freqs.length; f++) {
      if (text.indexOf(freqs[f].k) !== -1) { details.frequency = freqs[f].v; break; }
    }

    var durationMatch = text.match(/(?:共|用|疗程)\s*(\d+)\s*(天|日|周|月)/i);
    if (durationMatch) details.duration = durationMatch[0];

    return details;
  }

  // ==================== 检验检查结果解析（增强版） ====================

  parseInspectionResults(text) {
    var lines = text.split('\n').filter(function(l) { return l.trim(); });
    var items = [];
    var headerFound = false;

    var knownItems = [
      { name: '白细胞(WBC)', patterns: [/白细胞/i, /WBC/i] },
      { name: '红细胞(RBC)', patterns: [/红细胞/i, /RBC/i] },
      { name: '血红蛋白(HGB)', patterns: [/血红蛋白/i, /HGB/i, /Hb/i] },
      { name: '血小板(PLT)', patterns: [/血小板/i, /PLT/i] },
      { name: '中性粒细胞(NEUT)', patterns: [/中性粒/i, /NEUT/i] },
      { name: '淋巴细胞(LYMPH)', patterns: [/淋巴/i, /LYMPH/i] },
      { name: '单核细胞(MONO)', patterns: [/单核/i, /MONO/i] },
      { name: '嗜酸性粒细胞(EO)', patterns: [/嗜酸性/i, /EO/i] },
      { name: '嗜碱性粒细胞(BASO)', patterns: [/嗜碱性/i, /BASO/i] },
      { name: '丙氨酸氨基转移酶(ALT)', patterns: [/ALT/i, /谷丙/i] },
      { name: '天冬氨酸氨基转移酶(AST)', patterns: [/AST/i, /谷草/i] },
      { name: '肌酐(Cr)', patterns: [/肌酐/i, /Cr\b/i] },
      { name: '尿素氮(BUN)', patterns: [/尿素氮/i, /BUN/i] },
      { name: '血糖(GLU)', patterns: [/血糖/i, /GLU/i] },
      { name: '钾(K+)', patterns: [/钾/i, /K\+/] },
      { name: '钠(Na+)', patterns: [/钠/i, /Na\+/] },
      { name: '氯(Cl-)', patterns: [/氯/i, /Cl-/] },
      { name: '钙(Ca)', patterns: [/钙/i, /Ca\b/i] },
      { name: '二氧化碳结合力(CO2CP)', patterns: [/二氧化碳/i, /CO2CP/i] },
      { name: '肌酸激酶(CK)', patterns: [/肌酸激酶/i, /CK\b/i] },
      { name: '肌酸激酶同工酶(CK-MB)', patterns: [/CK-MB/i, /肌酸激酶同工酶/i] },
      { name: '乳酸脱氢酶(LDH)', patterns: [/乳酸脱氢酶/i, /LDH/i] },
      { name: '肌钙蛋白(cTnI)', patterns: [/肌钙蛋白/i, /cTnI/i, /hs-cTnI/i] },
      { name: 'BNP', patterns: [/BNP/i, /NT-proBNP/i] },
      { name: 'D-二聚体(D-Dimer)', patterns: [/D.?二聚体/i, /D-Dimer/i] },
      { name: '凝血酶原时间(PT)', patterns: [/凝血酶原/i, /PT\b/i] },
      { name: '活化部分凝血活酶时间(APTT)', patterns: [/APTT/i] },
      { name: '纤维蛋白原(FIB)', patterns: [/纤维蛋白原/i, /FIB/i] },
      { name: 'INR', patterns: [/INR/i] },
      { name: 'C反应蛋白(CRP)', patterns: [/C反应蛋白/i, /CRP/i] },
      { name: '降钙素原(PCT)', patterns: [/降钙素原/i, /PCT/i] },
      { name: '淀粉酶(AMY)', patterns: [/淀粉酶/i, /AMY/i] },
      { name: '脂肪酶(LIP)', patterns: [/脂肪酶/i, /LIP/i] },
      { name: '总胆红素(TBIL)', patterns: [/总胆红素/i, /TBIL/i] },
      { name: '直接胆红素(DBIL)', patterns: [/直接胆红素/i, /DBIL/i] },
      { name: '总蛋白(TP)', patterns: [/总蛋白/i, /TP\b/i] },
      { name: '白蛋白(ALB)', patterns: [/白蛋白/i, /ALB/i] },
      { name: '前白蛋白(PAB)', patterns: [/前白蛋白/i, /PAB/i] },
      { name: '糖化血红蛋白(HbA1c)', patterns: [/糖化血红蛋白/i, /HbA1c/i] },
      { name: '总胆固醇(TC)', patterns: [/总胆固醇/i, /TC\b/i] },
      { name: '甘油三酯(TG)', patterns: [/甘油三酯/i, /TG\b/i] },
      { name: '高密度脂蛋白(HDL-C)', patterns: [/高密度/i, /HDL/i] },
      { name: '低密度脂蛋白(LDL-C)', patterns: [/低密度/i, /LDL/i] }
    ];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      // 跳过表头行
      if (/项目|检验|检查|结果|单位|参考/i.test(line) && !/[\d.]+/.test(line)) {
        headerFound = true;
        continue;
      }

      // 尝试匹配已知项目
      var matched = false;
      for (var k = 0; k < knownItems.length; k++) {
        var nameMatched = false;
        for (var p = 0; p < knownItems[k].patterns.length; p++) {
          if (knownItems[k].patterns[p].test(line)) { nameMatched = true; break; }
        }
        if (nameMatched) {
          var valueMatch = line.match(/([\d]+[.,]?[\d]*)/);
          if (valueMatch) {
            items.push({
              name: knownItems[k].name,
              value: valueMatch[1],
              unit: this.extractUnit(line),
              reference: this.extractReference(line),
              abnormal: this.checkAbnormal(line)
            });
            matched = true;
            break;
          }
        }
      }

      // 通用解析
      if (!matched) {
        var parsed = this.parseGenericResult(line);
        if (parsed) items.push(parsed);
      }
    }

    return items;
  }

  extractUnit(line) {
    var units = ['g/L', 'mg/L', 'mg/dL', 'mmol/L', 'μmol/L', 'µmol/L', 'U/L', 'IU/L', 'ng/mL', 'pg/mL', 'μg/L', '10^9/L', '10^12/L', '10^3/μL', '%', 's', 'sec', 'fL', 'pg', 'g/dL'];
    for (var i = 0; i < units.length; i++) {
      if (line.indexOf(units[i]) !== -1) return units[i];
    }
    return '';
  }

  extractReference(line) {
    var refMatch = line.match(/[\(（\[]([^)）\]]+)[\)）\]](?!\s*[↓↑])/);
    if (refMatch) return refMatch[1];
    return '';
  }

  checkAbnormal(line) {
    if (line.indexOf('↑') !== -1 || line.indexOf('H') === line.length - 1 || /\d+\s*↑/.test(line)) return '偏高';
    if (line.indexOf('↓') !== -1 || line.indexOf('L') === line.length - 1 || /\d+\s*↓/.test(line)) return '偏低';
    if (/升高|偏高|↑/.test(line)) return '偏高';
    if (/降低|偏低|↓/.test(line)) return '偏低';
    return '正常';
  }

  parseGenericResult(line) {
    var match = line.match(/^([^\d:：]+)\s*[:：]?\s*([\d]+[.,]?[\d]*)/);
    if (match) {
      return {
        name: match[1].trim(),
        value: match[2],
        unit: this.extractUnit(line),
        reference: this.extractReference(line),
        abnormal: this.checkAbnormal(line)
      };
    }
    return null;
  }

  // ==================== 门诊病历解析 ====================

  parseOutpatientRecord(text) {
    var lines = text.split('\n').filter(function(l) { return l.trim(); });
    var record = {
      patientInfo: {},
      chiefComplaint: '',
      history: '',
      examination: '',
      diagnosis: [],
      treatment: [],
      advice: []
    };

    var currentSection = '';

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      // 患者信息行
      if (/姓名/.test(line) || /性别/.test(line) || /年龄/.test(line) || /科别/.test(line)) {
        var nameM = line.match(/姓名[：:]\s*([^\s,，]+)/);
        var genderM = line.match(/性别[：:]\s*([男女])/);
        var ageM = line.match(/年龄[：:]\s*(\d+)/);
        if (nameM) record.patientInfo.name = nameM[1];
        if (genderM) record.patientInfo.gender = genderM[1];
        if (ageM) record.patientInfo.age = ageM[1];
        continue;
      }

      // 主诉
      if (/^主诉[：:]\s*/.test(line)) {
        currentSection = 'chiefComplaint';
        record.chiefComplaint = line.replace(/主诉[：:]\s*/, '');
        continue;
      }

      // 现病史
      if (/^现病史[：:]\s*/.test(line)) {
        currentSection = 'history';
        record.history = line.replace(/现病史[：:]\s*/, '');
        continue;
      }

      // 既往史
      if (/^既往史[：:]\s*/.test(line)) {
        currentSection = 'history';
        record.history += (record.history ? '\n' : '') + line.replace(/既往史[：:]\s*/, '');
        continue;
      }

      // 体格检查
      if (/^(体格检查|查体|体检)[：:]\s*/.test(line)) {
        currentSection = 'examination';
        record.examination = line.replace(/^(体格检查|查体|体检)[：:]\s*/, '');
        continue;
      }

      // 诊断
      if (/^(诊断|印象|初步诊断)[：:]\s*/.test(line)) {
        currentSection = 'diagnosis';
        record.diagnosis.push(line.replace(/^(诊断|印象|初步诊断)[：:]\s*/, ''));
        continue;
      }

      // 治疗/处理
      if (/^(处理|治疗|治疗意见)[：:]\s*/.test(line)) {
        currentSection = 'treatment';
        record.treatment.push(line.replace(/^(处理|治疗|治疗意见)[：:]\s*/, ''));
        continue;
      }

      // 建议
      if (/^(建议|医嘱|注意事项)[：:]\s*/.test(line)) {
        currentSection = 'advice';
        record.advice.push(line.replace(/^(建议|医嘱|注意事项)[：:]\s*/, ''));
        continue;
      }

      // 继续当前段落
      if (currentSection && line) {
        if (currentSection === 'chiefComplaint') record.chiefComplaint += ' ' + line;
        else if (currentSection === 'history') record.history += ' ' + line;
        else if (currentSection === 'examination') record.examination += ' ' + line;
        else if (currentSection === 'diagnosis') record.diagnosis.push(line);
        else if (currentSection === 'treatment') record.treatment.push(line);
        else if (currentSection === 'advice') record.advice.push(line);
      }
    }

    return record;
  }

  // ==================== 格式化输出（增强医学排版 v3.1） ====================

  // 高风险药品关键词
  _highRiskDrugs() {
    return [
      '吗啡', '哌替啶', '芬太尼', '舒芬太尼', '瑞芬太尼',
      '肝素', '华法林', '利伐沙班', '达比加群', '低分子肝素',
      '胰岛素', '格列', '二甲双胍',
      '胺碘酮', '地高辛', '西地兰',
      '氨茶碱', '茶碱',
      '丙泊酚', '咪达唑仑', '地西泮',
      '多巴胺', '去甲肾上腺素', '肾上腺素', '硝普钠', '硝酸甘油',
      '氯化钾', '硫酸镁', '葡萄糖酸钙'
    ];
  }

  // 按生理系统对检验项目分类
  _categorizeLabSystem(name) {
    var cardiac = ['CK-MB', 'cTnI', '肌钙蛋白', 'BNP', 'NT-proBNP', 'CK', '肌酸激酶', 'LDH', '乳酸脱氢酶', 'AST', 'HBDH'];
    for (var i = 0; i < cardiac.length; i++) {
      if (name.indexOf(cardiac[i]) !== -1) return 'cardiac';
    }
    var liver = ['ALT', 'AST', 'GGT', 'ALP', 'TBIL', 'DBIL', 'IBIL', 'TP', 'ALB', 'PAB', '谷丙', '谷草', '总胆红素', '直接胆红素', '总蛋白', '白蛋白', '前白蛋白'];
    for (var j = 0; j < liver.length; j++) {
      if (name.indexOf(liver[j]) !== -1) return 'liver';
    }
    var renal = ['Cr', '肌酐', 'BUN', '尿素氮', 'UA', '尿酸', 'CysC', '胱抑素'];
    for (var k = 0; k < renal.length; k++) {
      if (name.indexOf(renal[k]) !== -1) return 'renal';
    }
    var blood = ['WBC', '白细胞', 'RBC', '红细胞', 'HGB', '血红蛋白', 'Hb', 'PLT', '血小板', 'NEUT', '中性粒', 'LYMPH', '淋巴', 'MONO', '单核', 'EO', '嗜酸性', 'BASO', '嗜碱性', 'HCT', 'MCV', 'MCH', 'MCHC'];
    for (var l = 0; l < blood.length; l++) {
      if (name.indexOf(blood[l]) !== -1) return 'blood';
    }
    var coagulation = ['PT', 'APTT', 'FIB', '纤维蛋白原', 'INR', 'D-二聚体', 'D二聚体', 'D-Dimer'];
    for (var m = 0; m < coagulation.length; m++) {
      if (name.indexOf(coagulation[m]) !== -1) return 'coagulation';
    }
    var inflammation = ['CRP', 'PCT', '降钙素原', 'ESR', '血沉', 'IL-6', '白介素'];
    for (var n = 0; n < inflammation.length; n++) {
      if (name.indexOf(inflammation[n]) !== -1) return 'inflammation';
    }
    var electrolyte = ['K+', '钾', 'Na+', '钠', 'Cl-', '氯', 'Ca', '钙', 'Mg', '镁', 'P', '磷'];
    for (var o = 0; o < electrolyte.length; o++) {
      if (name.indexOf(electrolyte[o]) !== -1) return 'electrolyte';
    }
    var lipid = ['TC', 'TG', 'HDL', 'LDL', '胆固醇', '甘油三酯', '脂蛋白'];
    for (var p = 0; p < lipid.length; p++) {
      if (name.indexOf(lipid[p]) !== -1) return 'lipid';
    }
    var pancreas = ['AMY', '淀粉酶', 'LIP', '脂肪酶'];
    for (var q = 0; q < pancreas.length; q++) {
      if (name.indexOf(pancreas[q]) !== -1) return 'pancreas';
    }
    var glucose = ['GLU', '血糖', 'HbA1c', '糖化血红蛋白'];
    for (var r = 0; r < glucose.length; r++) {
      if (name.indexOf(glucose[r]) !== -1) return 'glucose';
    }
    return 'other';
  }

  // 从文本中提取生命体征
  extractVitalSigns(text) {
    var vitals = {};

    var bpMatch = text.match(/(?:BP|血压)[：:]\s*(\d{2,3})\s*[\/／]\s*(\d{2,3})/i);
    if (!bpMatch) bpMatch = text.match(/(\d{2,3})\s*[\/／]\s*(\d{2,3})\s*mmHg/i);
    if (!bpMatch) bpMatch = text.match(/血压\D*(\d{2,3})\D+(\d{2,3})/);
    if (bpMatch) {
      vitals.bpSystolic = bpMatch[1];
      vitals.bpDiastolic = bpMatch[2];
    }

    var hrMatch = text.match(/(?:HR|heart rate|心率)[：:]\s*(\d{2,3})/i);
    if (!hrMatch) hrMatch = text.match(/(\d{2,3})\s*(?:次\/分|bpm|次每分)\s*(?!.*血压)/i);
    if (hrMatch) vitals.heartRate = hrMatch[1];

    var rrMatch = text.match(/(?:R|RR|resp|呼吸)[：:]\s*(\d{2,3})/i);
    if (!rrMatch) rrMatch = text.match(/呼吸\D*(\d{2,3})\s*(?:次\/分)/i);
    if (rrMatch) vitals.respRate = rrMatch[1];

    var spo2Match = text.match(/(?:SpO2|spo2|血氧)[：:]\s*(\d{2,3})/i);
    if (!spo2Match) spo2Match = text.match(/(\d{2,3})\s*%\s*(?:SpO2|spo2)/i);
    if (!spo2Match) spo2Match = text.match(/血氧\D*(\d{2,3})/);
    if (spo2Match) vitals.spo2 = spo2Match[1];

    var tempMatch = text.match(/(?:T|temp|体温)[：:]\s*(\d{2}\.\d)/i);
    if (!tempMatch) tempMatch = text.match(/体温\D*(\d{2}\.\d)/);
    if (tempMatch) vitals.temperature = tempMatch[1];

    var pulseMatch = text.match(/(?:P|pulse|脉搏)[：:]\s*(\d{2,3})/i);
    if (!pulseMatch) pulseMatch = text.match(/脉搏\D*(\d{2,3})\s*(?:次\/分)/i);
    if (pulseMatch) vitals.pulse = pulseMatch[1];

    return vitals;
  }

  formatMedicalOrders(text) {
    var items = this.parseMedicalOrders(text);
    if (items.length === 0) return text;

    var grouped = { '药品': [], '检查': [], '护理': [], '手术': [], '饮食': [], '其他': [] };
    for (var i = 0; i < items.length; i++) {
      var g = items[i].category;
      if (grouped[g]) grouped[g].push(items[i]);
      else grouped['其他'].push(items[i]);
    }

    var output = '═══════════════════════════════\n';
    output += '        📋 医 嘱 单\n';
    output += '═══════════════════════════════\n\n';

    var catNames = ['药品', '检查', '护理', '手术', '饮食', '其他'];
    for (var c = 0; c < catNames.length; c++) {
      var cat = catNames[c];
      if (grouped[cat].length === 0) continue;
      output += '◤ ' + cat + ' ◢\n';
      for (var j = 0; j < grouped[cat].length; j++) {
        var item = grouped[cat][j];
        // 高风险药品标记
        var isHighRisk = false;
        if (cat === '药品') {
          var drugs = this._highRiskDrugs();
          for (var h = 0; h < drugs.length; h++) {
            if (item.name.indexOf(drugs[h]) !== -1) {
              isHighRisk = true;
              break;
            }
          }
        }
        var prefix = isHighRisk ? '  ⚠ ' : '  ';
        var parts = [item.name];
        if (item.dosage) parts.push('【' + item.dosage + '】');
        if (item.route) parts.push('[' + item.route + ']');
        if (item.frequency) parts.push('(' + item.frequency + ')');
        if (item.duration) parts.push('→' + item.duration);
        output += prefix + (j + 1) + '. ' + parts.join(' ') + '\n';
        if (isHighRisk) {
          output += '     ⚠ 高风险药品，注意用药安全\n';
        }
      }
      output += '\n';
    }

    output += '───────────────────────────\n';
    output += '给药途径: po口服 | iv静注 | ivgtt静滴 | im肌注 | ih皮下\n';
    output += '用药频率: qd每日1次 | bid每日2次 | tid每日3次 | qid每日4次\n';
    output += '          qn每晚 | q8h每8h | q12h每12h | prn必要时 | st立即\n';
    output += '───────────────────────────\n';
    output += '扫描时间: ' + new Date().toLocaleString() + '\n';

    return output;
  }

  formatInspectionResults(text) {
    var items = this.parseInspectionResults(text);
    if (items.length === 0) return text;

    var output = '═══════════════════════════════\n';
    output += '       🔬 检验检查结果\n';
    output += '═══════════════════════════════\n\n';

    // 按生理系统分组
    var systemGroups = {
      blood: [], cardiac: [], liver: [], renal: [],
      electrolyte: [], coagulation: [], inflammation: [],
      lipid: [], pancreas: [], glucose: [], other: []
    };
    var systemNames = {
      blood: '🩸 血液系统', cardiac: '❤️ 心肌标志物', liver: '🧡 肝功能',
      renal: '💛 肾功能', electrolyte: '⚡ 电解质', coagulation: '🩹 凝血功能',
      inflammation: '🔥 炎症标志物', lipid: '💚 血脂', pancreas: '💛 胰腺',
      glucose: '🍬 血糖', other: '📋 其他'
    };

    for (var i = 0; i < items.length; i++) {
      var sys = this._categorizeLabSystem(items[i].name);
      if (systemGroups[sys]) systemGroups[sys].push(items[i]);
      else systemGroups.other.push(items[i]);
    }

    var sysKeys = ['blood', 'cardiac', 'liver', 'renal', 'electrolyte', 'coagulation', 'inflammation', 'lipid', 'pancreas', 'glucose', 'other'];
    var hasOutput = false;

    for (var s = 0; s < sysKeys.length; s++) {
      var key = sysKeys[s];
      var group = systemGroups[key];
      if (group.length === 0) continue;

      // 分组内异常项目排前面
      var abnormals = group.filter(function(it) { return it.abnormal !== '正常'; });
      var normals = group.filter(function(it) { return it.abnormal === '正常'; });
      var sortedGroup = abnormals.concat(normals);

      output += '◤ ' + systemNames[key] + ' ◢\n';
      for (var j = 0; j < sortedGroup.length; j++) {
        var r = sortedGroup[j];
        var mark = '';
        if (r.abnormal === '偏高') mark = ' ↑↑';
        else if (r.abnormal === '偏低') mark = ' ↓↓';
        else mark = '  ✓';

        output += '  ' + r.name + ': ' + r.value + ' ' + r.unit + mark;
        if (r.reference) output += ' (参考: ' + r.reference + ')';
        output += '\n';
      }
      output += '\n';
      hasOutput = true;
    }

    // 如果没有被系统分类但解析出了项目，显示所有项目
    if (!hasOutput) {
      for (var k = 0; k < items.length; k++) {
        var re = items[k];
        var m = re.abnormal === '偏高' ? ' ↑' : (re.abnormal === '偏低' ? ' ↓' : '');
        output += '  ' + re.name + ': ' + re.value + ' ' + re.unit + m + '\n';
      }
      output += '\n';
    }

    output += '───────────────────────────\n';
    output += '↑↑/↓↓ 表示异常，✓ 表示正常\n';
    output += '扫描时间: ' + new Date().toLocaleString() + '\n';

    return output;
  }

  formatOutpatientRecord(text) {
    var record = this.parseOutpatientRecord(text);
    var r = record;
    var vitals = this.extractVitalSigns(text);

    var output = '═══════════════════════════════\n';
    output += '       📄 门 诊 病 历\n';
    output += '═══════════════════════════════\n\n';

    // 患者信息
    if (r.patientInfo.name || r.patientInfo.gender || r.patientInfo.age) {
      output += '◤ 患者信息 ◢\n';
      if (r.patientInfo.name) output += '  姓名: ' + r.patientInfo.name + '\n';
      if (r.patientInfo.gender) output += '  性别: ' + r.patientInfo.gender + '\n';
      if (r.patientInfo.age) output += '  年龄: ' + r.patientInfo.age + '岁\n';
      output += '\n';
    }

    // 生命体征
    var hasVitals = vitals.bpSystolic || vitals.heartRate || vitals.temperature || vitals.spo2 || vitals.respRate;
    if (hasVitals) {
      output += '◤ 生命体征 ◢\n';
      if (vitals.temperature) output += '  体温: ' + vitals.temperature + '℃\n';
      if (vitals.heartRate) output += '  心率: ' + vitals.heartRate + '次/分\n';
      if (vitals.bpSystolic) output += '  血压: ' + vitals.bpSystolic + '/' + vitals.bpDiastolic + ' mmHg\n';
      if (vitals.respRate) output += '  呼吸: ' + vitals.respRate + '次/分\n';
      if (vitals.spo2) output += '  血氧: ' + vitals.spo2 + '%\n';
      if (vitals.pulse) output += '  脉搏: ' + vitals.pulse + '次/分\n';
      output += '\n';
    }

    // 主诉
    if (r.chiefComplaint) {
      output += '◤ 主诉 ◢\n  ' + r.chiefComplaint + '\n\n';
    }

    // 现病史
    if (r.history) {
      output += '◤ 现病史 ◢\n  ' + r.history + '\n\n';
    }

    // 体格检查
    if (r.examination) {
      output += '◤ 体格检查 ◢\n  ' + r.examination + '\n\n';
    }

    // 诊断
    if (r.diagnosis.length > 0) {
      output += '◤ 诊断 ◢\n';
      for (var i = 0; i < r.diagnosis.length; i++) {
        output += '  ' + (i + 1) + '. ' + r.diagnosis[i] + '\n';
      }
      output += '\n';
    }

    // 处理（含用药提取）
    if (r.treatment.length > 0) {
      output += '◤ 处理 ◢\n';
      for (var j = 0; j < r.treatment.length; j++) {
        output += '  ' + (j + 1) + '. ' + r.treatment[j] + '\n';
      }
      output += '\n';
    }

    // 建议
    if (r.advice.length > 0) {
      output += '◤ 建议 ◢\n';
      for (var k = 0; k < r.advice.length; k++) {
        output += '  ' + (k + 1) + '. ' + r.advice[k] + '\n';
      }
      output += '\n';
    }

    output += '───────────────────────────\n';
    output += '扫描时间: ' + new Date().toLocaleString() + '\n';

    return output;
  }

  formatMixedDocument(text, orders, record) {
    var vitals = this.extractVitalSigns(text);

    var output = '═══════════════════════════════\n';
    output += '       📋 识 别 结 果\n';
    output += '═══════════════════════════════\n\n';

    // 患者信息
    if (record.patientInfo.name || record.patientInfo.gender || record.patientInfo.age) {
      output += '◤ 患者信息 ◢\n';
      if (record.patientInfo.name) output += '  姓名: ' + record.patientInfo.name + '\n';
      if (record.patientInfo.gender) output += '  性别: ' + record.patientInfo.gender + '\n';
      if (record.patientInfo.age) output += '  年龄: ' + record.patientInfo.age + '岁\n';
      output += '\n';
    }

    // 生命体征
    var hasVitals = vitals.bpSystolic || vitals.heartRate || vitals.temperature || vitals.spo2 || vitals.respRate;
    if (hasVitals) {
      output += '◤ 生命体征 ◢\n';
      if (vitals.temperature) output += '  体温: ' + vitals.temperature + '℃\n';
      if (vitals.heartRate) output += '  心率: ' + vitals.heartRate + '次/分\n';
      if (vitals.bpSystolic) output += '  血压: ' + vitals.bpSystolic + '/' + vitals.bpDiastolic + ' mmHg\n';
      if (vitals.respRate) output += '  呼吸: ' + vitals.respRate + '次/分\n';
      if (vitals.spo2) output += '  血氧: ' + vitals.spo2 + '%\n';
      output += '\n';
    }

    // 诊断
    if (record.diagnosis && record.diagnosis.length > 0) {
      output += '◤ 诊断 ◢\n';
      for (var i = 0; i < record.diagnosis.length; i++) {
        output += '  ' + (i + 1) + '. ' + record.diagnosis[i] + '\n';
      }
      output += '\n';
    }

    // 主诉
    if (record.chiefComplaint) {
      output += '◤ 主诉 ◢\n  ' + record.chiefComplaint + '\n\n';
    }

    // 药品
    var drugItems = orders.filter(function(o) { return o.category === '药品'; });
    if (drugItems.length > 0) {
      output += '◤ 药品 ◢\n';
      for (var j = 0; j < drugItems.length; j++) {
        var d = drugItems[j];
        var parts = [d.name];
        if (d.dosage) parts.push('【' + d.dosage + '】');
        if (d.route) parts.push('[' + d.route + ']');
        if (d.frequency) parts.push('(' + d.frequency + ')');
        output += '  ' + (j + 1) + '. ' + parts.join(' ') + '\n';
      }
      output += '\n';
    }

    // 其他医嘱类别
    var otherCats = ['检查', '护理', '手术', '饮食'];
    for (var c = 0; c < otherCats.length; c++) {
      var catItems = orders.filter(function(o) { return o.category === otherCats[c]; });
      if (catItems.length > 0) {
        output += '◤ ' + otherCats[c] + ' ◢\n';
        for (var l = 0; l < catItems.length; l++) {
          output += '  ' + (l + 1) + '. ' + catItems[l].name + '\n';
        }
        output += '\n';
      }
    }

    // 原始文本（精简显示，过长时截断）
    output += '◤ 原文 ◢\n';
    if (text.length > 300) {
      output += text.substring(0, 300) + '\n...（原文过长已截断）\n';
    } else {
      output += text + '\n';
    }

    output += '───────────────────────────\n';
    output += '扫描时间: ' + new Date().toLocaleString() + '\n';

    return output;
  }
}

module.exports = new OCRMedicalManager();
