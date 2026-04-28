// 系统配置文件
module.exports = {
  // 数据库配置
  database: {
    // 单个存储块的最大患者数量
    chunkSize: 1000,
    // 最大存储块数量
    maxChunks: 100,
    // 索引刷新间隔（毫秒）
    indexRefreshInterval: 60000
  },

  // 云开发配置
  cloud: {
    env: 'cloud1-2gsdkndd66be0552', // 留空表示不使用云开发,如需使用请填写实际的云环境ID
    collection: 'emergency_patients',
    syncInterval: 30000, // 同步间隔（毫秒）
    retryTimes: 3,
    retryDelay: 1000
  },

  // 安全配置
  security: {
    // 密码最小长度
    minPasswordLength: 6,
    // 会话超时时间（毫秒）
    sessionTimeout: 1800000, // 30分钟
    // 最大登录尝试次数
    maxLoginAttempts: 5
  },

  // 医生列表
  doctors: ['刘永昌', '郑传勇', '张飞龙', '龚涛', '季军', '淦方豹', '华政宇', '夏林', '孙奎', '徐亨寿', '万犇', '熊超超', '吴志强'],

  // 科室列表
  departments: ['呼吸内科', '消化内科', '泌尿外科', '神经外科', '神经内科', '普外一科', '骨科', '疼痛科', '心血管内科', '普外二科', '内分泌科', '中西结合科', '肾内科', 'ICU', '五官科', '肛肠科', '急诊科', '儿科', '妇产科'],

  // 导入导出配置
  importExport: {
    // 单次导入最大行数
    maxImportRows: 10000,
    // 导出批次大小
    exportBatchSize: 5000,
    // 支持的文件类型
    supportedFormats: ['.xlsx', '.xls', '.csv'],
    // 图片识别配置
    ocr: {
      maxWidth: 2000,
      maxHeight: 2000,
      quality: 0.8
    }
  },
  
  // 性能配置
  performance: {
    // 列表每页显示数量
    pageSize: 20,
    // 搜索防抖延迟（毫秒）
    searchDebounce: 300,
    // 数据缓存过期时间（毫秒）
    cacheExpire: 300000
  },

  // 时间选择器配置
  timePicker: {
    // 年份范围：当前年份前后几年
    yearRangeBefore: 2,
    yearRangeAfter: 1
  },
  
  // UI配置
  ui: {
    theme: {
      primaryColor: '#1976D2',
      secondaryColor: '#42A5F5',
      successColor: '#4CAF50',
      warningColor: '#FF9800',
      dangerColor: '#D32F2F',
      infoColor: '#2196F3',
      backgroundColor: '#F5F7FA',
      cardBackground: '#FFFFFF',
      textColor: '#333333',
      textSecondary: '#666666'
    },
    triageColors: {
      'Ⅰ': '#D32F2F', // 红色 - 危重
      'Ⅱ': '#FF9800', // 橙色 - 急症
      'Ⅲ': '#FFC107', // 黄色 - 紧急
      'Ⅳ': '#4CAF50'  // 绿色 - 非紧急
    }
  }
};
