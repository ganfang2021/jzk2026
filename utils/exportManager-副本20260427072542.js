// 导出管理器 - 支持CSV格式导出
const config = require('../config.js');

class ExportManager {
  constructor() {
    this.exportBatchSize = config.importExport.exportBatchSize;
  }

  // 导出患者数据为CSV
  async exportToCSV(patients, filename = '患者数据') {
    if (!patients || patients.length === 0) {
      throw new Error('没有数据可导出');
    }

    const header = this.buildHeader();
    const rows = this.buildRows(patients);

    // 生成CSV格式
    let csv = header.join(',') + '\n';
    rows.forEach(row => {
      csv += row.map(cell => {
        // 确保cell是字符串
        const cellStr = String(cell || '');
        // 处理包含逗号、引号的内容
        if (cellStr && (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n'))) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(',') + '\n';
    });

    // 保存文件
    const filePath = `${wx.env.USER_DATA_PATH}/${filename}_${Date.now()}.csv`;
    const fs = wx.getFileSystemManager();

    try {
      fs.writeFileSync(filePath, csv, 'utf-8');
      console.log('导出成功:', filePath);
      return filePath;
    } catch (e) {
      console.error('导出失败:', e);
      throw e;
    }
  }

  // 构建表头
  buildHeader() {
    return [
      '患者ID', '姓名', '年龄', '性别',
      '预检分诊级别', '入科时间', '出科时间',
      '脉搏', '呼吸', '心率', '血氧饱和度', '收缩压', '舒张压',
      '主诉', '诊断', '接诊医生', '科室',
      '是否住院', '是否抢救', '是否手术', '是否严重创伤',
      '是否静脉通道', '是否气管插管', '是否中心静脉',
      '是否心肺复苏', '复苏是否成功', '是否死亡',
      '手术时间', '创建时间', '更新时间'
    ];
  }

  // 构建数据行
  buildRows(patients) {
    return patients.map(p => {
      // 处理vitalSigns对象
      const vs = p.vitalSigns || {};
      return [
        p.id || '',
        p.name || '',
        p.age || '',
        p.gender || '',
        p.triageLevel || '',
        p.inTime || '',
        p.outTime || '',
        vs.pulse || '',
        vs.respRate || '',
        vs.heartRate || '',
        vs.spo2 || '',
        vs.bpSystolic || '',
        vs.bpDiastolic || '',
        p.chiefComplaint || '',
        p.diagnosis || '',
        p.doctor || '',
        p.dept || '',
        p.hospitalized ? '是' : '否',
        p.rescued ? '是' : '否',
        p.surgery ? '是' : '否',
        p.severeTrauma ? '是' : '否',
        p.ivAccess ? '是' : '否',
        p.intubated ? '是' : '否',
        p.centralLine ? '是' : '否',
        p.cpr ? '是' : '否',
        p.cprSuccess ? '是' : '否',
        p.death ? '是' : '否',
        p.surgeryTime || '',
        p.createdAt || '',
        p.updatedAt || ''
      ];
    });
  }

  // 批量导出(大数据量)
  async batchExport(patients, filename = '患者数据') {
    const total = patients.length;
    const batches = Math.ceil(total / this.exportBatchSize);

    wx.showLoading({
      title: `正在导出 0/${batches} 批`,
      mask: true
    });

    const results = [];

    try {
      for (let i = 0; i < batches; i++) {
        const start = i * this.exportBatchSize;
        const end = Math.min(start + this.exportBatchSize, total);
        const batch = patients.slice(start, end);

        const batchFilename = `${filename}_part${i + 1}`;
        const filePath = await this.exportToCSV(batch, batchFilename);
        results.push(filePath);

        wx.showLoading({
          title: `正在导出 ${i + 1}/${batches} 批`,
          mask: true
        });
      }

      wx.hideLoading();
      return results;
    } catch (e) {
      wx.hideLoading();
      throw e;
    }
  }

  // 分享导出的文件
  shareFile(filePath) {
    return new Promise((resolve, reject) => {
      wx.shareFile({
        filePath: filePath,
        success: () => {
          console.log('分享成功');
          wx.showToast({
            title: '导出成功',
            icon: 'success'
          });
          resolve(true);
        },
        fail: (err) => {
          console.error('分享失败:', err);
          wx.showToast({
            title: '分享失败',
            icon: 'none'
          });
          reject(err);
        }
      });
    });
  }

  // 导出统计数据
  async exportStats(stats, filename = '统计数据') {
    const lines = [
      ['项目', '数值'],
      ['总患者数', stats.total],
      ['Ⅰ级 危重', stats.level1],
      ['Ⅱ级 急症', stats.level2],
      ['Ⅲ级 紧急', stats.level3],
      ['Ⅳ级 非紧急', stats.level4],
      ['住院患者', stats.hospitalized],
      ['抢救患者', stats.rescued],
      ['手术患者', stats.surgery],
      ['严重创伤', stats.severeTrauma],
      ['严重创伤手术', stats.severeTraumaSurgery],
      ['心肺复苏', stats.cpr],
      ['复苏成功', stats.cprSuccess],
      ['复苏成功率', stats.cprRate + '%'],
      ['复苏成功48h', stats.cpr48h],
      ['气管插管', stats.intubated],
      ['中心静脉', stats.centralLine],
      ['静脉通道', stats.ivAccess],
      ['死亡人数', stats.death],
      ['男性患者', stats.male],
      ['女性患者', stats.female]
    ];

    // 添加中位数统计
    if (stats.medianStayTime !== null) {
      lines.push(['抢救室滞留时间中位数(分钟)', stats.medianStayTime.toFixed(0)]);
    }
    if (stats.medianSurgeryTime !== null) {
      lines.push(['严重创伤手术时间中位数(分钟)', stats.medianSurgeryTime.toFixed(0)]);
    }

    // 生成CSV
    let csv = lines.map(line => line.join(',')).join('\n');

    const filePath = `${wx.env.USER_DATA_PATH}/${filename}_${Date.now()}.csv`;
    const fs = wx.getFileSystemManager();

    try {
      fs.writeFileSync(filePath, csv, 'utf-8');
      return filePath;
    } catch (e) {
      console.error('导出统计失败:', e);
      throw e;
    }
  }
}

module.exports = ExportManager;
