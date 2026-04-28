// 云函数：AI医疗文书智能排版 v6.0
// 使用 DeepSeek API 进行医疗文书格式化
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

console.log('AI排版云函数加载，版本: 6.0');

// DeepSeek API配置
var _apiKey = process.env.DEEPSEEK_API_KEY || '';

if (!_apiKey) {
  console.warn('⚠ 未配置 DEEPSEEK_API_KEY 环境变量');
}

// DeepSeek API 配置
const API_CONFIG = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',  // DeepSeek V3 模型
  maxTokens: 3000,  // 增加token限制
  temperature: 0.1  // 低温度确保格式稳定
};

// 超时设置（毫秒）- 云函数默认超时3秒，需要优化
const TIMEOUT = 25000;  // 25秒，避免触发云函数超时限制

/**
 * HTTP请求封装（支持超时）
 */
function httpsRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('响应解析失败: ' + e.message));
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT, () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * 调用 DeepSeek API
 */
async function callDeepSeek(messages) {
  if (!_apiKey) {
    throw new Error('未配置 API Key，请设置 DEEPSEEK_API_KEY 环境变量');
  }

  const requestBody = {
    model: API_CONFIG.model,
    messages: messages,
    max_tokens: API_CONFIG.maxTokens,
    temperature: API_CONFIG.temperature
  };

  const postData = JSON.stringify(requestBody);
  const options = {
    hostname: 'api.deepseek.com',
    path: '/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'Authorization': 'Bearer ' + _apiKey
    }
  };

  console.log('调用DeepSeek API，模型:', API_CONFIG.model);
  const response = await httpsRequest(options, postData);

  if (response.choices && response.choices[0] && response.choices[0].message) {
    return response.choices[0].message.content;
  }

  if (response.error) {
    throw new Error('DeepSeek错误: ' + (response.error.message || JSON.stringify(response.error)));
  }

  throw new Error('DeepSeek返回格式异常: ' + JSON.stringify(response));
}

/**
 * 构建医疗文书格式化提示词
 */
function buildMedicalFormatPrompt(text) {
  const systemPrompt = `你是专业的中文医疗病历排版助手。你需要将OCR识别的医疗文书整理成美观、整洁、专业的门诊病历格式。

【一、章节标题识别与格式化】
识别以下章节标题并用【】包裹：
- 主诉、现病史、既往史、个人史、家族史、药物过敏史
- 体格检查、专科检查、辅助检查、实验室检查、影像学检查、心电图、超声
- 诊断、诊断依据、鉴别诊断
- 治疗、治疗方案、药物治疗、手术治疗、处置、手术、医嘱
- 病程记录、手术记录、出院小结、入院记录、会诊记录、入ICU/出ICU
- 知情同意、护理记录、查房记录
- 血常规、尿常规、大便常规、生化、凝血、电解质、肝功能、肾功能、血糖、血脂、心肌酶、甲状腺、肿瘤标志物
支持中文数字编号：一、现病史，二、既往史，第一章节 等
支持格式：【一、现病史】【二、既往史】

【二、检验报告表格格式化】
- 自动识别检验表头（血常规、尿常规、生化、凝血等）
- 表格格式：
┌────────────────────────────┐
│ 项目          │ 结果   │ 参考值 │
│ 白细胞        │ 12.5↑ │ 4-10   │
│ 中性粒细胞    │ 75    │ 50-70  │
└────────────────────────────┘
- 数值异常时在数值后加【↑】或【↓】标注

【三、病程记录时间轴格式化】
- 时间格式：2024-01-15 10:30
- 格式化为：◆ 2024-01-15 10:30  病程内容

【四、医嘱药物格式】
- 格式：► 药名  剂量  频次  途径
- 例如：► 头孢呋辛  0.5g  bid  口服
- 或用•列表：• 头孢呋辛 0.5g tid 口服

【五、生命体征一行化】
- 识别并合并为一行：T: 36.5°C  P: 80次/分  R: 18次/分  BP: 120/80mmHg  SpO₂: 98%
- 识别关键词：BP、血压、心率、P、体温、T、呼吸、RR、血氧、SpO₂

【六、输出要求】
1. 保留原文所有内容，只重新组织格式，不删改任何文字
2. 直接输出排版结果，不要任何解释性文字
3. 章节之间空一行隔开
4. 排版后内容应层次分明、整洁易读
5. 如果原文缺少某个章节，在排版时留出位置但标注【无】
6. 使用Unicode符号：━ ◆ ► • ┌─┐│└┘`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '请将以下医疗病历进行专业排版：\n\n' + text }
  ];
}

/**
 * 云函数入口
 */
exports.main = async (event, context) => {
  const { text } = event;

  console.log('=== AI排版云函数 v6.0 ===');
  console.log('输入文本长度:', text ? text.length : 0);

  try {
    if (!text || text.trim().length === 0) {
      throw new Error('请提供需要排版的文本');
    }

    if (text.length > 5000) {
      throw new Error('文本过长（超过5000字符），请分段处理');
    }

    if (!_apiKey) {
      throw new Error('AI排版服务未配置API Key，请联系管理员');
    }

    console.log('开始AI排版...');
    const messages = buildMedicalFormatPrompt(text);
    const formattedText = await callDeepSeek(messages);

    console.log('AI排版完成，输出长度:', formattedText.length);

    return {
      success: true,
      text: formattedText,
      originalLength: text.length,
      formattedLength: formattedText.length,
      version: '8.0',
      model: API_CONFIG.model
    };

  } catch (err) {
    console.error('=== AI排版失败 ===');
    console.error('错误:', err.message);
    console.error('堆栈:', err.stack);

    return {
      success: false,
      error: err.message || 'AI排版失败',
      code: err.code || 'UNKNOWN_ERROR',
      version: '8.0'
    };
  }
};
