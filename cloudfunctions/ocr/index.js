// 云函数：OCR医疗文档识别 v3.1
// 增强版：高精度识别 + 自动重试 + 图片预处理 + 错误诊断 + 环境变量密钥
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

console.log('OCR云函数加载，版本: 3.1');

// 百度OCR配置 - 优先从环境变量读取，未设置时使用默认值（仅开发环境）
var _apiKey = process.env.BAIDU_API_KEY || 'ki6aqThwsgI3c0doKUiTOnsF';
var _secretKey = process.env.BAIDU_SECRET_KEY || 'BY6rvusM4MB6RBkN92GUsnLQdMWGEMZO';
var _appId = process.env.BAIDU_APP_ID || '7629332';

if (!process.env.BAIDU_API_KEY) {
  console.warn('⚠ 百度OCR密钥未配置环境变量，使用默认值。生产环境请在云函数配置中设置 BAIDU_API_KEY / BAIDU_SECRET_KEY / BAIDU_APP_ID');
}

const BAIDU_CONFIG = {
  appId: _appId,
  apiKey: _apiKey,
  secretKey: _secretKey,
  accessToken: null,
  tokenExpireTime: null,
  maxRetries: 2
};

// 超时设置（毫秒）
const TIMEOUT = 30000;

// HTTP请求封装（支持超时）
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
 * 获取百度OCR Access Token（带缓存）
 */
async function getAccessToken() {
  if (BAIDU_CONFIG.accessToken && BAIDU_CONFIG.tokenExpireTime > Date.now()) {
    return BAIDU_CONFIG.accessToken;
  }

  const tokenPath = '/oauth/2.0/token?grant_type=client_credentials&client_id=' + BAIDU_CONFIG.apiKey + '&client_secret=' + BAIDU_CONFIG.secretKey;
  const result = await httpsRequest({ hostname: 'aip.baidubce.com', path: tokenPath, method: 'GET' });

  if (result.access_token) {
    BAIDU_CONFIG.accessToken = result.access_token;
    BAIDU_CONFIG.tokenExpireTime = Date.now() + (result.expires_in - 60) * 1000;
    return result.access_token;
  }
  throw new Error('获取access_token失败: ' + (result.error_description || JSON.stringify(result)));
}

/**
 * 获取云存储文件临时链接
 */
async function getTempFileURL(fileID) {
  const urlResult = await cloud.getTempFileURL({
    fileList: [fileID]
  });
  if (urlResult.fileList && urlResult.fileList[0] && urlResult.fileList[0].tempFileURL) {
    return urlResult.fileList[0].tempFileURL;
  }
  throw new Error('无法获取文件临时链接，fileID: ' + fileID);
}

/**
 * 下载图片并转为base64（带大小限制）
 */
async function downloadImageAsBase64(imageUrl) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(imageUrl);
    const httpMod = urlObj.protocol === 'https:' ? https : require('http');

    const req = httpMod.get(imageUrl, (res) => {
      const chunks = [];
      let totalSize = 0;
      const maxSize = 10 * 1024 * 1024; // 10MB限制

      res.on('data', (chunk) => {
        totalSize += chunk.length;
        if (totalSize > maxSize) {
          req.destroy();
          reject(new Error('图片过大（超过10MB），请压缩后重试'));
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log('图片下载完成, 大小:', buffer.length, 'bytes');
        // 图片过大时告警（百度限制4MB base64）
        if (buffer.length > 3 * 1024 * 1024) {
          console.warn('图片较大:', buffer.length, 'bytes，可能超出百度限制');
        }
        resolve(buffer.toString('base64'));
      });

      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(TIMEOUT, () => {
      req.destroy();
      reject(new Error('下载图片超时'));
    });
  });
}

/**
 * 调用百度OCR（带重试和错误处理）
 */
async function callBaiduOCR(imageBase64, type) {
  const accessToken = await getAccessToken();

  // 根据类型选择接口
  const apiPath = type === 'basic'
    ? '/rest/2.0/ocr/v1/general_basic'
    : '/rest/2.0/ocr/v1/accurate';

  // Baidu OCR API 使用 x-www-form-urlencoded 格式，不支持 JSON
  const postData = 'image=' + encodeURIComponent(imageBase64);

  console.log('调用百度OCR, base64长度:', imageBase64.length, '模式:', type);

  const options = {
    hostname: 'aip.baidubce.com',
    path: apiPath + '?access_token=' + accessToken,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  console.log('请求路径:', options.path.substring(0, 60) + '...');
  return await httpsRequest(options, postData);
}

/**
 * 带重试机制的OCR识别
 */
async function recognizeWithRetry(imageBase64, type) {
  let lastError;

  for (let attempt = 0; attempt <= BAIDU_CONFIG.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log('重试第', attempt, '次...');
        // 指数退避
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }

      const result = await callBaiduOCR(imageBase64, type);

      if (result.words_result) {
        return result;
      }

      if (result.error_code) {
        console.error('百度OCR返回错误:', result.error_code, result.error_msg);

        // Token过期，刷新后重试
        if (result.error_code === 110 || result.error_code === 111) {
          BAIDU_CONFIG.accessToken = null;
          BAIDU_CONFIG.tokenExpireTime = null;
          continue;
        }

        // 图片格式问题，立即失败
        if (result.error_code === 222201 || result.error_code === 222202) {
          throw new Error('图片格式错误: ' + (result.error_msg || ''));
        }

        // 图片大小超限
        if (result.error_code === 222203) {
          throw new Error('图片大小超限（需小于4MB base64）');
        }

        // 请求频率限制
        if (result.error_code === 282004 || result.error_code === 283301) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        // 其他错误，如果还有重试次数就继续
        lastError = new Error(`百度OCR错误: ${result.error_msg || result.error_code}`);
        continue;
      }

      throw new Error('OCR返回数据格式异常');
    } catch (e) {
      lastError = e;
      if (attempt < BAIDU_CONFIG.maxRetries) {
        console.log('第', attempt + 1, '次失败，准备重试:', e.message);
      }
    }
  }

  throw lastError || new Error('OCR识别失败');
}

/**
 * 智能图片预处理建议
 * 检测图片是否可能因质量问题导致识别率低
 */
function analyzeImageQuality(base64) {
  const sizeKB = Math.round(base64.length * 3 / 4 / 1024);
  const warnings = [];

  if (sizeKB > 3000) {
    warnings.push('图片过大(' + sizeKB + 'KB)，建议压缩后识别');
  }
  if (sizeKB < 10) {
    warnings.push('图片过小(' + sizeKB + 'KB)，可能影响识别效果');
  }

  return { sizeKB, warnings };
}

/**
 * 云函数入口
 */
exports.main = async (event, context) => {
  const { img, type = 'accurate' } = event;

  console.log('=== OCR云函数 v3.0 ===');
  console.log('参数:', JSON.stringify({ img: img ? img.substring(0, 50) + '...' : null, type }));

  try {
    // 1. 获取图片数据（支持fileID和直接URL）
    let imageBase64;
    let imageSource;

    if (!img) {
      throw new Error('请提供图片参数(img)');
    }

    if (img.startsWith('cloud://')) {
      // 云存储fileID: 获取临时链接 → 下载
      console.log('从云存储获取图片...');
      imageSource = 'cloud';
      const tempUrl = await getTempFileURL(img);
      console.log('临时链接:', tempUrl);
      imageBase64 = await downloadImageAsBase64(tempUrl);
    } else if (img.startsWith('http://') || img.startsWith('https://')) {
      // 直接URL
      console.log('从URL下载图片...');
      imageSource = 'url';
      imageBase64 = await downloadImageAsBase64(img);
    } else if (img.length > 1000) {
      // 长字符串视为base64（从客户端直传）
      console.log('直接使用base64数据...');
      imageSource = 'base64';
      imageBase64 = img;
    } else {
      throw new Error('不支持的图片格式，请使用云存储fileID或图片URL');
    }

    // 2. 图片质量分析
    const quality = analyzeImageQuality(imageBase64);
    console.log('图片大小:', quality.sizeKB, 'KB');

    // 3. 执行OCR识别（带重试）
    console.log('开始OCR识别，模式:', type === 'basic' ? '通用' : '高精度');
    const ocrResult = await recognizeWithRetry(imageBase64, type);

    // 4. 提取结果
    const words = ocrResult.words_result || [];
    const text = words.map(item => item.words).join('\n');

    console.log('识别成功，文字条数:', words.length);

    return {
      success: true,
      text: text,
      wordsCount: words.length,
      fileID: img,
      imageSource: imageSource,
      imageSizeKB: quality.sizeKB,
      warnings: quality.warnings,
      version: '3.0'
    };

  } catch (err) {
    console.error('=== OCR失败 ===');
    console.error('错误:', err.message);
    console.error('堆栈:', err.stack);

    return {
      success: false,
      error: err.message || 'OCR识别失败',
      code: err.code || 'UNKNOWN_ERROR',
      version: '3.0'
    };
  }
};
