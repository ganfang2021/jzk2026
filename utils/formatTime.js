/**
 * 格式化时间工具 - 统一所有页面的时间格式化逻辑
 */

// 安全解析日期字符串（兼容 yyyy-MM-dd HH:mm、yyyy-MM-ddTHH:mm:ss 和 ISO 格式）
function _parseDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
  var d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;
  // 回退：手动解析（支持 T 分隔或空格分隔）
  var str = String(dateStr);
  var sep = str.indexOf('T') !== -1 ? 'T' : ' ';
  var parts = str.split(sep);
  if (parts.length !== 2) return null;
  var dateParts = parts[0].split('-');
  var timeParts = parts[1].split(':');
  if (dateParts.length !== 3 || timeParts.length < 2) return null;
  return new Date(
    parseInt(dateParts[0], 10),
    parseInt(dateParts[1], 10) - 1,
    parseInt(dateParts[2], 10),
    parseInt(timeParts[0], 10),
    parseInt(timeParts[1], 10),
    timeParts[2] ? parseInt(timeParts[2], 10) : 0
  );
}

// 短格式: M/d HH:mm (列表和详情页使用)
function formatDateTime(dateStr) {
  var d = _parseDate(dateStr);
  if (!d) return '--';
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

// 长格式: yyyy年M月d日 HH:mm (登记页使用)
function formatTimeDisplay(date) {
  var d = _parseDate(date);
  if (!d) return '';
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

// ISO格式: yyyy-MM-ddTHH:mm:ss (标准ISO 8601，兼容所有JS引擎，含秒保证iOS兼容)
function formatTimeValue(date) {
  var d = _parseDate(date);
  if (!d) return '';
  return d.getFullYear() + '-' + (d.getMonth() + 1).toString().padStart(2, '0') + '-' + d.getDate().toString().padStart(2, '0') + 'T' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0') + ':' + d.getSeconds().toString().padStart(2, '0');
}

module.exports = {
  formatDateTime: formatDateTime,
  formatTimeDisplay: formatTimeDisplay,
  formatTimeValue: formatTimeValue
};
