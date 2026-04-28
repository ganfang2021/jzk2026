// 事件总线 - 用于跨页面通信
// 替代全局变量进行数据传输

class EventBus {
  constructor() {
    this.listeners = {};
  }

  // 订阅事件
  on(eventName, callback) {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }
    this.listeners[eventName].push(callback);

    // 返回取消订阅的函数
    return () => {
      this.off(eventName, callback);
    };
  }

  // 取消订阅
  off(eventName, callback) {
    if (!this.listeners[eventName]) return;

    const index = this.listeners[eventName].indexOf(callback);
    if (index > -1) {
      this.listeners[eventName].splice(index, 1);
    }
  }

  // 触发事件
  emit(eventName, data) {
    if (!this.listeners[eventName]) return;

    this.listeners[eventName].forEach(callback => {
      try {
        callback(data);
      } catch (e) {
        console.error('事件处理出错:', eventName, e);
      }
    });
  }

  // 仅触发一次
  once(eventName, callback) {
    const onceCallback = (data) => {
      callback(data);
      this.off(eventName, onceCallback);
    };
    this.on(eventName, onceCallback);
  }
}

// 导出单例
module.exports = new EventBus();
