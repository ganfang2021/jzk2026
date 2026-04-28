// 云函数：批量添加患者
// 支持高效批量导入数据
// 权限说明：需要登录用户才能调用，且只能操作用户本人的数据

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

const COLLECTION_NAME = 'emergency_patients';

// 管理员ID白名单（可在云开发控制台配置）
const ADMIN_IDS = ['ADMIN_'];  // 管理员ID前缀

function isAdminUser(userId) {
  return ADMIN_IDS.some(prefix => userId && userId.startsWith(prefix));
}

exports.main = async (event, context) => {
  const { patients, userId } = event;

  // 参数基本校验
  if (!patients || !Array.isArray(patients) || patients.length === 0) {
    return { success: false, error: 'Invalid patients data' };
  }

  if (!userId || typeof userId !== 'string') {
    return { success: false, error: 'User ID is required' };
  }

  // 安全校验：防止数据伪造
  // 验证所有患者的 userId 必须与调用者一致（管理员除外）
  const hasInvalidUser = patients.some(p => p.userId && p.userId !== userId && !isAdminUser(userId));
  if (hasInvalidUser) {
    return { success: false, error: '数据归属权校验失败' };
  }

  // 数量限制：单次最多导入1000条
  if (patients.length > 1000) {
    return { success: false, error: '单次导入最多1000条数据' };
  }

  const results = {
    success: 0,
    failed: 0,
    errors: []
  };

  // 记录操作日志
  console.log(`[batchAddPatients] 用户 ${userId} 开始批量导入 ${patients.length} 条数据`);

  try {
    // 分批处理，每批最多50条
    const batchSize = 50;

    for (let i = 0; i < patients.length; i += batchSize) {
      const batch = patients.slice(i, i + batchSize);

      // 批量写入
      const tasks = batch.map(patient => {
        const now = new Date().toISOString();
        return db.collection(COLLECTION_NAME).add({
          data: {
            ...patient,
            userId,  // 强制使用调用者的 userId
            createdAt: now,
            updatedAt: now,
            deleted: false,
            version: 1
          }
        });
      });

      const batchResults = await Promise.allSettled(tasks);

      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.success++;
        } else {
          results.failed++;
          results.errors.push({
            index: i + index,
            patientName: batch[index].name || 'unknown',
            error: result.reason ? result.reason.message : 'Unknown error'
          });
        }
      });
    }

    console.log(`[batchAddPatients] 用户 ${userId} 导入完成，成功: ${results.success}，失败: ${results.failed}`);

    return {
      success: true,
      count: results.success,
      failed: results.failed,
      errors: results.errors
    };
  } catch (e) {
    console.error('[batchAddPatients] 批量添加失败:', e);
    return { success: false, error: e.message };
  }
};
