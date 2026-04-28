/**
 * 统一提示工具 - 规范所有页面的 Toast 提示和错误处理
 */

// 显示错误提示
function showError(msg, icon) {
  wx.showToast({
    title: String(msg || '操作失败').substring(0, 20),
    icon: icon || 'none',
    duration: 2000
  });
}

// 显示成功提示
function showSuccess(msg) {
  wx.showToast({
    title: String(msg || '操作成功').substring(0, 20),
    icon: 'success',
    duration: 1500
  });
}

// 显示加载中
function showLoading(msg) {
  wx.showLoading({
    title: String(msg || '加载中...'),
    mask: true
  });
}

// 隐藏加载
function hideLoading() {
  wx.hideLoading();
}

// 安全执行异步操作，自动处理异常和 loading
function safeAsync(fn, options) {
  var opts = options || {};
  return async function() {
    if (opts.loading) showLoading(opts.loading);
    try {
      var result = await fn.apply(this, arguments);
      if (opts.success) showSuccess(opts.success);
      return result;
    } catch (e) {
      console.error(opts.errorPrefix || '操作失败', e);
      showError((opts.errorPrefix || '') + ': ' + (e.message || '未知错误'));
      throw e;
    } finally {
      if (opts.loading) hideLoading();
    }
  };
}

module.exports = {
  showError: showError,
  showSuccess: showSuccess,
  showLoading: showLoading,
  hideLoading: hideLoading,
  safeAsync: safeAsync
};
