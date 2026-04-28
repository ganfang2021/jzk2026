// 图形验证码模块 - 数字运算验证码

class CaptchaManager {
  constructor() {
    this.currentCaptcha = null;
    this.captchaExpireTime = 5 * 60 * 1000; // 5分钟有效期
  }

  // 生成新验证码
  generate() {
    // 生成两个1-9的数字
    var num1 = Math.floor(Math.random() * 9) + 1;
    var num2 = Math.floor(Math.random() * 9) + 1;
    var operator = Math.random() > 0.5 ? '+' : '-';

    // 计算答案并确保显示正确
    var displayNum1, displayNum2, answer;
    if (operator === '+') {
      displayNum1 = num1;
      displayNum2 = num2;
      answer = num1 + num2;
    } else {
      // 减法时确保大数减小数，显示正确
      if (num1 > num2) {
        displayNum1 = num1;
        displayNum2 = num2;
      } else {
        displayNum1 = num2;
        displayNum2 = num1;
      }
      answer = displayNum1 - displayNum2;
    }

    // 生成验证码ID和过期时间
    var captchaId = 'CAP_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    var expireAt = Date.now() + this.captchaExpireTime;

    this.currentCaptcha = {
      id: captchaId,
      question: displayNum1 + operator + displayNum2 + '=?',
      answer: answer,
      expireAt: expireAt,
      createdAt: Date.now()
    };

    // 保存到本地存储（用于验证）
    try {
      wx.setStorageSync('emergency_captcha', this.currentCaptcha);
    } catch (e) {
      console.error('保存验证码失败:', e);
    }

    return this.currentCaptcha;
  }

  // 获取当前验证码
  getCurrentCaptcha() {
    // 检查是否过期
    if (this.currentCaptcha && Date.now() > this.currentCaptcha.expireAt) {
      this.currentCaptcha = null;
    }
    return this.currentCaptcha;
  }

  // 验证答案
  verify(answer) {
    if (!this.currentCaptcha) {
      // 尝试从存储读取
      try {
        var stored = wx.getStorageSync('emergency_captcha');
        if (stored) {
          this.currentCaptcha = stored;
        }
      } catch (e) {
        console.error('读取验证码失败:', e);
      }
    }

    if (!this.currentCaptcha) {
      return { success: false, message: '请先获取验证码' };
    }

    // 检查是否过期
    if (Date.now() > this.currentCaptcha.expireAt) {
      this.clear();
      return { success: false, message: '验证码已过期，请重新获取' };
    }

    // 验证答案
    var userAnswer = parseInt(answer, 10);
    if (isNaN(userAnswer)) {
      return { success: false, message: '请输入数字答案' };
    }

    if (userAnswer !== this.currentCaptcha.answer) {
      return { success: false, message: '验证码错误' };
    }

    // 验证成功后清除
    this.clear();
    return { success: true, message: '验证通过' };
  }

  // 清除验证码
  clear() {
    this.currentCaptcha = null;
    try {
      wx.removeStorageSync('emergency_captcha');
    } catch (e) {
      console.error('清除验证码失败:', e);
    }
  }

  // 生成验证码数据（用于显示）
  generateCaptchaData() {
    // 每次都生成新的
    var captcha = this.generate();
    if (!captcha) return null;

    return {
      id: captcha.id,
      question: captcha.question
    };
  }
}

// 导出单例
module.exports = new CaptchaManager();
