// Excel导入导出管理器 - 支持WPS/Excel格式
// 使用wx.openDocument和wx.chooseMessageFile实现文件选择和打开

class ImportExportManager {
  constructor() {
    this.EXPORT_FIELDS = [
      { key: 'id', label: '患者ID', width: 20 },
      { key: 'name', label: '姓名', width: 10 },
      { key: 'gender', label: '性别', width: 6 },
      { key: 'age', label: '年龄', width: 6 },
      { key: 'phone', label: '电话', width: 15 },
      { key: 'idCard', label: '身份证', width: 20 },
      { key: 'triageLevel', label: '分诊级别', width: 8 },
      { key: 'diagnosis', label: '诊断', width: 30 },
      { key: 'chiefComplaint', label: '主诉', width: 40 },
      { key: 'vitalSigns', label: '生命体征', width: 20 },
      { key: 'medicalOrders', label: '医嘱', width: 50 },
      { key: 'inspectionResults', label: '检查检验结果', width: 60 },
      { key: 'hospitalized', label: '住院', width: 8 },
      { key: 'surgery', label: '手术', width: 8 },
      { key: 'rescued', label: '抢救', width: 8 },
      { key: 'cpr', label: '心肺复苏', width: 8 },
      { key: 'death', label: '死亡', width: 8 },
      { key: 'inTime', label: '入室时间', width: 20 },
      { key: 'outTime', label: '离室时间', width: 20 },
      { key: 'createdAt', label: '创建时间', width: 20 },
      { key: 'updatedAt', label: '更新时间', width: 20 }
    ];
  }

  // ==================== 导出功能 ====================

  // 导出患者数据为CSV格式 (可被WPS/Excel打开)
  exportToCSV(patients, filename = 'patients_export') {
    if (!patients || patients.length === 0) {
      throw new Error('没有可导出的数据');
    }

    // 构建CSV内容
    const headers = this.EXPORT_FIELDS.map(f => f.label);
    const rows = patients.map(patient => {
      return this.EXPORT_FIELDS.map(field => {
        let value = patient[field.key];
        
        // 处理特殊值
        if (value === undefined || value === null) {
          value = '';
        } else if (typeof value === 'object') {
          value = JSON.stringify(value);
        } else if (typeof value === 'boolean') {
          value = value ? '是' : '否';
        }
        
        // 转义引号和换行
        value = String(value).replace(/"/g, '""').replace(/\n/g, '\\n');
        
        // 如果包含逗号或引号，用引号包裹
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          value = '"' + value + '"';
        }
        
        return value;
      });
    });

    // 添加BOM (防止Excel打开UTF-8编码的CSV文件乱码)
    const BOM = '\uFEFF';
    const csvContent = BOM + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');

    // 保存到文件
    const filePath = `${wx.env.USER_DATA_PATH}/${filename}_${Date.now()}.csv`;
    const fs = wx.getFileSystemManager();

    try {
      fs.writeFileSync(filePath, csvContent, 'utf8');
      console.log('CSV文件已保存:', filePath);
      return filePath;
    } catch (e) {
      console.error('保存CSV文件失败:', e);
      throw new Error('保存文件失败: ' + e.message);
    }
  }

  // 导出为JSON格式 (备份用)
  exportToJSON(patients, filename = 'patients_backup') {
    if (!patients || patients.length === 0) {
      throw new Error('没有可导出的数据');
    }

    const jsonContent = JSON.stringify(patients, null, 2);
    const filePath = `${wx.env.USER_DATA_PATH}/${filename}_${Date.now()}.json`;
    const fs = wx.getFileSystemManager();

    try {
      fs.writeFileSync(filePath, jsonContent, 'utf8');
      return filePath;
    } catch (e) {
      console.error('保存JSON文件失败:', e);
      throw new Error('保存文件失败: ' + e.message);
    }
  }

  // 使用wx.openDocument打开导出的文件
  openExportedFile(filePath) {
    const extension = filePath.split('.').pop().toLowerCase();
    
    // 获取MIME类型
    const mimeTypes = {
      'csv': 'text/csv',
      'json': 'application/json',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xls': 'application/vnd.ms-excel'
    };

    wx.openDocument({
      filePath: filePath,
      mimeType: mimeTypes[extension] || 'text/plain',
      success: (res) => {
        console.log('打开文档成功');
        wx.showToast({
          title: '文件已生成',
          icon: 'success'
        });
      },
      fail: (err) => {
        console.error('打开文档失败:', err);
        wx.showToast({
          title: '打开失败',
          icon: 'none'
        });
      }
    });
  }

  // 一键导出并打开
  async exportAndOpen(patients, format = 'csv', filename = '患者数据导出') {
    try {
      wx.showLoading({ title: '正在导出...' });

      let filePath;
      if (format === 'csv') {
        filePath = this.exportToCSV(patients, filename);
      } else if (format === 'json') {
        filePath = this.exportToJSON(patients, filename);
      } else {
        throw new Error('不支持的格式');
      }

      wx.hideLoading();

      // 打开文件
      this.openExportedFile(filePath);

      return filePath;
    } catch (e) {
      wx.hideLoading();
      wx.showToast({
        title: e.message || '导出失败',
        icon: 'none'
      });
      throw e;
    }
  }

  // ==================== 导入功能 ====================

  // 选择并导入Excel文件
  async chooseAndImportFile({ count = 1, type = 'file' } = {}) {
    return new Promise((resolve, reject) => {
      wx.chooseMessageFile({
        count: count,
        type: type,
        // 支持的格式
        extension: ['xlsx', 'xls', 'csv'],
        success: (res) => {
          console.log('选择文件成功:', res);
          
          if (!res.tempFiles || res.tempFiles.length === 0) {
            reject(new Error('未选择文件'));
            return;
          }

          resolve(res.tempFiles);
        },
        fail: (err) => {
          console.error('选择文件失败:', err);
          reject(err);
        }
      });
    });
  }

  // 读取CSV文件内容
  async readCSVFile(tempFilePath) {
    const fs = wx.getFileSystemManager();

    return new Promise((resolve, reject) => {
      fs.readFile({
        filePath: tempFilePath,
        encoding: 'utf-8',
        success: (res) => {
          try {
            const data = this.parseCSV(res.data);
            resolve(data);
          } catch (e) {
            reject(new Error('解析CSV文件失败: ' + e.message));
          }
        },
        fail: (err) => {
          console.error('读取文件失败:', err);
          reject(new Error('读取文件失败: ' + err.errMsg));
        }
      });
    });
  }

  // 解析CSV数据
  parseCSV(csvContent) {
    const lines = csvContent.split(/\r?\n/).filter(line => line.trim());
    
    if (lines.length < 2) {
      throw new Error('CSV文件内容为空或格式不正确');
    }

    // 解析表头
    const headers = this.parseCSVLine(lines[0]);
    
    // 解析数据行
    const data = [];
    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length > 0) {
        const row = {};
        headers.forEach((header, index) => {
          if (values[index] !== undefined) {
            row[header] = values[index].trim();
          }
        });
        data.push(row);
      }
    }

    return { headers, data };
  }

  // 解析单行CSV
  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (inQuotes) {
        if (char === '"') {
          if (nextChar === '"') {
            // 转义的引号
            current += '"';
            i++;
          } else {
            // 结束引号
            inQuotes = false;
          }
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          result.push(current);
          current = '';
        } else {
          current += char;
        }
      }
    }
    result.push(current);

    return result;
  }

  // 将导入的CSV数据转换为患者对象
  convertToPatientData(csvRow, headersMap) {
    const patient = {
      // 基本信息
      name: csvRow[headersMap['姓名']] || csvRow['姓名'] || '',
      gender: csvRow[headersMap['性别']] || csvRow['性别'] || '',
      age: parseInt(csvRow[headersMap['年龄']] || csvRow['年龄']) || 0,
      phone: csvRow[headersMap['电话']] || csvRow['电话'] || '',
      idCard: csvRow[headersMap['身份证']] || csvRow['身份证'] || '',
      
      // 医疗信息
      triageLevel: csvRow[headersMap['分诊级别']] || csvRow['分诊级别'] || 'Ⅳ',
      diagnosis: csvRow[headersMap['诊断']] || csvRow['诊断'] || '',
      chiefComplaint: csvRow[headersMap['主诉']] || csvRow['主诉'] || '',
      vitalSigns: csvRow[headersMap['生命体征']] || csvRow['生命体征'] || '',
      
      // 布尔字段转换
      hospitalized: this.parseBool(csvRow[headersMap['住院']] || csvRow['住院']),
      surgery: this.parseBool(csvRow[headersMap['手术']] || csvRow['手术']),
      rescued: this.parseBool(csvRow[headersMap['抢救']] || csvRow['抢救']),
      cpr: this.parseBool(csvRow[headersMap['心肺复苏']] || csvRow['心肺复苏']),
      death: this.parseBool(csvRow[headersMap['死亡']] || csvRow['死亡']),
      
      // 时间字段
      inTime: csvRow[headersMap['入室时间']] || csvRow['入室时间'] || '',
      outTime: csvRow[headersMap['离室时间']] || csvRow['离室时间'] || '',
      
      // 元数据
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    return patient;
  }

  // 解析布尔值
  parseBool(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lower = value.toLowerCase().trim();
      return lower === '是' || lower === 'true' || lower === '1' || lower === 'yes';
    }
    return false;
  }

  // 导入文件主流程
  async importPatients({ onProgress } = {}) {
    try {
      // 1. 选择文件
      wx.showLoading({ title: '请选择文件...' });
      const tempFiles = await this.chooseAndImportFile({ count: 1 });
      wx.hideLoading();

      const tempFile = tempFiles[0];
      console.log('选择的文件:', tempFile);

      // 2. 检查文件大小 (微信限制10MB)
      if (tempFile.size > 10 * 1024 * 1024) {
        throw new Error('文件过大，请分批导入');
      }

      // 3. 读取文件
      wx.showLoading({ title: '正在读取...' });
      const { headers, data } = await this.readCSVFile(tempFile.path);
      wx.hideLoading();

      if (!data || data.length === 0) {
        throw new Error('文件中没有数据');
      }

      // 4. 映射表头
      const headersMap = {};
      headers.forEach((h, i) => {
        headersMap[h] = i;
      });

      // 5. 转换数据
      wx.showLoading({ title: '正在解析...' });
      const patients = [];
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        try {
          const patient = this.convertToPatientData(row, headersMap);
          patients.push(patient);
        } catch (e) {
          console.warn(`跳过第${i + 2}行数据:`, e);
        }

        if (onProgress && i % 100 === 0) {
          onProgress({
            current: i + 1,
            total: data.length,
            percent: Math.round((i + 1) / data.length * 100)
          });
        }
      }

      wx.hideLoading();

      return {
        success: true,
        total: data.length,
        patients,
        filename: tempFile.name
      };
    } catch (e) {
      wx.hideLoading();
      wx.showToast({
        title: e.message || '导入失败',
        icon: 'none'
      });
      throw e;
    }
  }

  // ==================== 数据预览 ====================

  // 预览导入数据 (只返回前10条)
  previewImportData(csvData, count = 10) {
    return {
      total: csvData.data.length,
      preview: csvData.data.slice(0, count)
    };
  }

  // 验证导入数据
  validateImportData(patients) {
    const errors = [];
    const validPatients = [];

    patients.forEach((patient, index) => {
      const rowErrors = [];

      // 必填字段验证
      if (!patient.name || patient.name.trim() === '') {
        rowErrors.push('姓名为必填项');
      }

      // 分诊级别验证
      if (patient.triageLevel && !['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ'].includes(patient.triageLevel)) {
        rowErrors.push('分诊级别必须是 Ⅰ、Ⅱ、Ⅲ 或 Ⅳ');
      }

      // 年龄验证
      if (patient.age && (isNaN(patient.age) || patient.age < 0 || patient.age > 150)) {
        rowErrors.push('年龄必须在0-150之间');
      }

      if (rowErrors.length > 0) {
        errors.push({ row: index + 2, errors: rowErrors });
      } else {
        validPatients.push(patient);
      }
    });

    return {
      valid: validPatients,
      errors,
      validCount: validPatients.length,
      errorCount: errors.length
    };
  }
}

module.exports = new ImportExportManager();
