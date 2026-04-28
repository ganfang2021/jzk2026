// 导入管理器 - 支持CSV格式导入
const config = require('../config.js');

class ImportManager {
  constructor() {
    this.maxImportRows = config.importExport.maxImportRows;
  }

  // 从CSV导入患者数据
  async importFromCSV(filePath) {
    wx.showLoading({
      title: '正在解析文件...',
      mask: true
    });

    try {
      const fileContent = await this.readFile(filePath);
      const rows = this.parseCSV(fileContent);

      if (rows.length > this.maxImportRows) {
        throw new Error(`导入数据超过最大限制${this.maxImportRows}条`);
      }

      // 过滤空行和表头
      const dataRows = rows.filter(row =>
        row.length > 1 && row[0] !== '患者ID'
      );

      if (dataRows.length === 0) {
        throw new Error('没有有效数据可导入');
      }

      const patients = this.parsePatients(dataRows);

      wx.hideLoading();

      return {
        patients,
        total: patients.length
      };

    } catch (e) {
      wx.hideLoading();
      console.error('导入失败:', e);
      throw e;
    }
  }

  // 读取文件
  async readFile(filePath) {
    return new Promise((resolve, reject) => {
      const fs = wx.getFileSystemManager();
      fs.readFile({
        filePath: filePath,
        encoding: 'utf-8',
        success: (res) => {
          // 移除UTF-8 BOM（如果存在）
          let content = res.data;
          if (content.charCodeAt(0) === 0xFEFF) {
            content = content.substring(1);
          }
          resolve(content);
        },
        fail: reject
      });
    });
  }

  // 解析CSV
  parseCSV(content) {
    const lines = content.split('\n');
    return lines.map(line => {
      // 处理CSV中的引号
      const cells = [];
      let currentCell = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            // 双引号转义
            currentCell += '"';
            i++;
          } else {
            // 切换引号状态
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          // 逗号分隔
          cells.push(currentCell.trim());
          currentCell = '';
        } else {
          currentCell += char;
        }
      }

      cells.push(currentCell.trim());
      return cells;
    }).filter(row => row.length > 0 && row.some(cell => cell.trim() !== ''));
  }

  // 解析患者数据
  parsePatients(rows) {
    return rows.map((row, index) => {
      try {
        return {
          id: row[0] || 'IMP' + Date.now() + Math.random().toString(36).slice(2, 11),
          name: row[1] || '',
          age: row[2] || '',
          gender: row[3] || '',
          triageLevel: row[5] || '',
          inTime: row[6] || '',
          outTime: row[7] || '',
          pulse: row[8] || '',
          respRate: row[9] || '',
          heartRate: row[10] || '',
          spo2: row[11] || '',
          bpSystolic: row[12] || '',
          bpDiastolic: row[13] || '',
          chiefComplaint: row[14] || '',
          diagnosis: row[15] || '',
          doctor: row[16] || '',
          dept: row[17] || '',
          hospitalized: row[18] === '是',
          rescued: row[19] === '是',
          surgery: row[20] === '是',
          severeTrauma: row[21] === '是',
          ivAccess: row[22] === '是',
          intubated: row[23] === '是',
          centralLine: row[24] === '是',
          cpr: row[25] === '是',
          cprSuccess: row[26] === '是',
          death: row[27] === '是',
          surgeryTime: row[28] || '',
          createdAt: row[29] || new Date().toISOString(),
          updatedAt: row[30] || new Date().toISOString(),
          needsCompletion: true // 标记需要完善信息
        };
      } catch (e) {
        console.error(`解析第${index + 1}行数据失败:`, e);
        return null;
      }
    }).filter(patient => patient !== null);
  }

  // 选择文件
  async selectFile() {
    return new Promise((resolve, reject) => {
      wx.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: config.importExport.supportedFormats,
        success: (res) => {
          const file = res.tempFiles[0];
          resolve(file.path);
        },
        fail: reject
      });
    });
  }

  // 验证导入数据
  validatePatients(patients) {
    const errors = [];
    const validPatients = [];

    patients.forEach((patient, index) => {
      const patientErrors = [];

      // 验证必填字段
      if (!patient.name || patient.name.trim() === '') {
        patientErrors.push('姓名不能为空');
      }

      if (!patient.age || patient.age.trim() === '') {
        patientErrors.push('年龄不能为空');
      }

      if (!patient.gender || patient.gender.trim() === '') {
        patientErrors.push('性别不能为空');
      }

      // 验证分诊级别
      const validLevels = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ'];
      if (patient.triageLevel && !validLevels.includes(patient.triageLevel)) {
        patientErrors.push('分诊级别无效');
      }

      if (patientErrors.length > 0) {
        errors.push({
          index: index + 1,
          name: patient.name || '未知',
          errors: patientErrors
        });
      } else {
        validPatients.push(patient);
      }
    });

    return {
      validPatients,
      errors,
      total: patients.length,
      validCount: validPatients.length,
      errorCount: errors.length
    };
  }

  // 批量导入患者
  async batchImport(patients, chunkStorage) {
    wx.showLoading({
      title: `正在导入 0/${patients.length} 条`,
      mask: true
    });

    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    try {
      for (let i = 0; i < patients.length; i++) {
        try {
          await chunkStorage.addPatient(patients[i]);
          results.success++;

          // 更新进度
          if ((i + 1) % 10 === 0) {
            wx.showLoading({
              title: `正在导入 ${i + 1}/${patients.length} 条`,
              mask: true
            });
          }
        } catch (e) {
          results.failed++;
          results.errors.push({
            patientId: patients[i].id,
            name: patients[i].name,
            error: e.message
          });
        }
      }

      wx.hideLoading();
      return results;
    } catch (e) {
      wx.hideLoading();
      throw e;
    }
  }
}

module.exports = ImportManager;
