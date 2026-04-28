// 云函数：计数器服务
// 用于生成全局唯一ID，支持高并发

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const { action, collection, docId } = event;

  try {
    switch (action) {
      case 'increment':
        // 原子递增
        const counterDoc = await db.collection(collection || 'counters').doc(docId || 'global_counter').get();
        
        if (!counterDoc.data) {
          // 文档不存在，创建并初始化为1
          await db.collection(collection || 'counters').add({
            data: {
              _id: docId || 'global_counter',
              value: 1,
              updatedAt: new Date().toISOString()
            }
          });
          return { success: true, counterValue: 1 };
        } else {
          // 原子递增
          const updateResult = await db.collection(collection || 'counters').doc(docId || 'global_counter').update({
            data: {
              value: db.command.inc(1),
              updatedAt: new Date().toISOString()
            }
          });
          
          // 获取更新后的值
          const updatedDoc = await db.collection(collection || 'counters').doc(docId || 'global_counter').get();
          return { success: true, counterValue: updatedDoc.data.value };
        }

      case 'get':
        // 获取当前值
        const doc = await db.collection(collection || 'counters').doc(docId || 'global_counter').get();
        return { success: true, counterValue: doc.data ? doc.data.value : 0 };

      case 'reset':
        // 重置计数器
        await db.collection(collection || 'counters').doc(docId || 'global_counter').set({
          data: {
            _id: docId || 'global_counter',
            value: 0,
            updatedAt: new Date().toISOString()
          }
        });
        return { success: true, counterValue: 0 };

      default:
        return { success: false, error: 'Unknown action' };
    }
  } catch (e) {
    console.error('Counter error:', e);
    return { success: false, error: e.message };
  }
};
