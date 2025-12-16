/**
 * M30: 数据脱敏工具
 * 支持手机号、身份证、邮箱、银行卡、姓名等常见敏感数据的脱敏处理
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM30Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // ==================== 手机号脱敏 ====================

    /**
     * 手机号脱敏：保留前3后4，中间用*替代
     * @param {string} phone - 手机号
     * @param {string} maskChar - 脱敏字符，默认 '*'
     * @returns {string} 脱敏后的手机号
     */
    function maskPhone(phone, maskChar = '*') {
        if (!phone || typeof phone !== 'string') return '';

        const cleaned = phone.trim().replace(/\s+/g, '');

        // 中国手机号：11位
        if (/^1[3-9]\d{9}$/.test(cleaned)) {
            return cleaned.substring(0, 3) + maskChar.repeat(4) + cleaned.substring(7);
        }

        // 国际格式：+86 或 0086 开头
        if (/^(\+86|0086)1[3-9]\d{9}$/.test(cleaned)) {
            const prefix = cleaned.match(/^(\+86|0086)/)[0];
            const number = cleaned.substring(prefix.length);
            return prefix + number.substring(0, 3) + maskChar.repeat(4) + number.substring(7);
        }

        // 通用处理：保留前3后4（如果长度>=7）
        if (cleaned.length >= 7) {
            const maskLen = Math.max(1, cleaned.length - 7);
            return cleaned.substring(0, 3) + maskChar.repeat(maskLen) + cleaned.substring(cleaned.length - 4);
        }

        // 长度不足，返回原值或部分脱敏
        if (cleaned.length >= 4) {
            return cleaned.substring(0, 1) + maskChar.repeat(cleaned.length - 2) + cleaned.substring(cleaned.length - 1);
        }

        return cleaned;
    }

    // ==================== 身份证脱敏 ====================

    /**
     * 身份证脱敏：保留前3后4，中间用*替代
     * @param {string} idCard - 身份证号
     * @param {string} maskChar - 脱敏字符，默认 '*'
     * @returns {string} 脱敏后的身份证号
     */
    function maskIdCard(idCard, maskChar = '*') {
        if (!idCard || typeof idCard !== 'string') return '';

        const cleaned = idCard.trim().replace(/\s+/g, '').toUpperCase();

        // 18位身份证
        if (/^\d{17}[\dXx]$/.test(cleaned) || cleaned.length === 18) {
            return cleaned.substring(0, 3) + maskChar.repeat(11) + cleaned.substring(14);
        }

        // 15位身份证（老版）
        if (/^\d{15}$/.test(cleaned)) {
            return cleaned.substring(0, 3) + maskChar.repeat(8) + cleaned.substring(11);
        }

        // 通用处理：保留前3后4
        if (cleaned.length >= 7) {
            const maskLen = cleaned.length - 7;
            return cleaned.substring(0, 3) + maskChar.repeat(maskLen) + cleaned.substring(cleaned.length - 4);
        }

        return cleaned;
    }

    // ==================== 邮箱脱敏 ====================

    /**
     * 邮箱脱敏：用户名保留前3位，其余用*替代
     * @param {string} email - 邮箱地址
     * @param {string} maskChar - 脱敏字符，默认 '*'
     * @returns {string} 脱敏后的邮箱
     */
    function maskEmail(email, maskChar = '*') {
        if (!email || typeof email !== 'string') return '';

        const cleaned = email.trim();
        const atIndex = cleaned.indexOf('@');

        if (atIndex <= 0) return cleaned;

        const username = cleaned.substring(0, atIndex);
        const domain = cleaned.substring(atIndex);

        // 用户名长度 <= 3，不脱敏（保持原样）
        if (username.length <= 3) {
            return cleaned;
        }

        // 用户名保留前3位，其余脱敏
        const maskLen = username.length - 3;
        return username.substring(0, 3) + maskChar.repeat(maskLen) + domain;
    }

    // ==================== 银行卡脱敏 ====================

    /**
     * 银行卡脱敏：保留前4后4，中间用*替代（每4位分组）
     * @param {string} bankCard - 银行卡号
     * @param {string} maskChar - 脱敏字符，默认 '*'
     * @param {boolean} grouped - 是否分组显示，默认 true
     * @returns {string} 脱敏后的银行卡号
     */
    function maskBankCard(bankCard, maskChar = '*', grouped = true) {
        if (!bankCard || typeof bankCard !== 'string') return '';

        const cleaned = bankCard.trim().replace(/\s+/g, '');

        // 银行卡号通常为 16-19 位
        if (cleaned.length < 8) return cleaned;

        const first4 = cleaned.substring(0, 4);
        const last4 = cleaned.substring(cleaned.length - 4);
        const maskLen = cleaned.length - 8;
        const masked = maskChar.repeat(maskLen);

        if (!grouped) {
            return first4 + masked + last4;
        }

        // 分组显示：每4位一组
        const result = first4 + ' ' + masked + ' ' + last4;
        // 调整中间的 * 数量，使其能够按4位分组
        const middleLen = maskLen;
        const groups = Math.ceil(middleLen / 4);
        const middleMasked = Array(groups).fill(maskChar.repeat(4)).join(' ').substring(0, middleLen + groups - 1);

        return first4 + ' ' + middleMasked + ' ' + last4;
    }

    // ==================== 姓名脱敏 ====================

    /**
     * 姓名脱敏：
     * - 中文：两字保留姓，三字及以上保留首尾
     * - 英文：保留首字母和姓氏首字母，其余用*替代
     * @param {string} name - 姓名
     * @param {string} maskChar - 脱敏字符，默认 '*'
     * @returns {string} 脱敏后的姓名
     */
    function maskName(name, maskChar = '*') {
        if (!name || typeof name !== 'string') return '';

        const cleaned = name.trim();

        // 判断是否为中文姓名（包含中文字符）
        const hasChinese = /[\u4e00-\u9fa5]/.test(cleaned);

        if (hasChinese) {
            // 中文姓名处理
            const chars = Array.from(cleaned.replace(/\s+/g, ''));

            if (chars.length === 1) {
                return cleaned;
            } else if (chars.length === 2) {
                // 两字：保留姓，名字脱敏
                return chars[0] + maskChar;
            } else if (chars.length === 3) {
                // 三字：保留首尾，中间脱敏（如：张*明）
                return chars[0] + maskChar + chars[2];
            } else {
                // 四字及以上（复姓）：保留首尾，中间全部脱敏（如：欧阳**）
                return chars[0] + chars[1] + maskChar.repeat(chars.length - 2);
            }
        } else {
            // 英文姓名处理
            const parts = cleaned.split(/\s+/);

            if (parts.length === 1) {
                // 单个词：保留首字母
                if (parts[0].length <= 1) return parts[0];
                return parts[0].substring(0, 1) + maskChar.repeat(Math.max(1, parts[0].length - 1));
            }

            // 多个词：保留每个词的首字母，最后一个词（姓氏）保留首字母和长度
            const masked = parts.map((part, index) => {
                if (index === parts.length - 1) {
                    // 姓氏：保留首字母
                    if (part.length <= 2) return part.substring(0, 1) + maskChar;
                    return part.substring(0, 1) + maskChar.repeat(2);
                } else {
                    // 名字：只保留首字母
                    return part.substring(0, 1) + maskChar.repeat(Math.max(1, part.length - 1));
                }
            });

            return masked.join(' ');
        }
    }

    // ==================== 自定义脱敏 ====================

    /**
     * 自定义脱敏：根据指定的保留位置进行脱敏
     * @param {string} text - 原文本
     * @param {number} keepStart - 保留开头字符数，默认 3
     * @param {number} keepEnd - 保留末尾字符数，默认 4
     * @param {string} maskChar - 脱敏字符，默认 '*'
     * @returns {string} 脱敏后的文本
     */
    function maskCustom(text, keepStart = 3, keepEnd = 4, maskChar = '*') {
        if (!text || typeof text !== 'string') return '';

        const cleaned = text.trim();
        const totalKeep = keepStart + keepEnd;

        if (cleaned.length <= totalKeep) {
            // 长度不足，至少保留首尾各1位
            if (cleaned.length <= 2) return cleaned;
            const midLen = cleaned.length - 2;
            return cleaned.substring(0, 1) + maskChar.repeat(Math.max(1, midLen)) + cleaned.substring(cleaned.length - 1);
        }

        const maskLen = cleaned.length - totalKeep;
        return cleaned.substring(0, keepStart) + maskChar.repeat(maskLen) + cleaned.substring(cleaned.length - keepEnd);
    }

    // ==================== 批量处理 ====================

    /**
     * 批量脱敏处理（按行）
     * @param {string} text - 多行文本
     * @param {string} type - 脱敏类型：phone/idcard/email/bankcard/name/custom
     * @param {object} options - 选项：maskChar, keepStart, keepEnd, grouped
     * @returns {string} 处理后的多行文本
     */
    function batchMask(text, type, options = {}) {
        if (!text || typeof text !== 'string') return '';

        const lines = text.split(/\r?\n/);
        const maskChar = options.maskChar || '*';

        const maskFn = {
            'phone': (line) => maskPhone(line, maskChar),
            'idcard': (line) => maskIdCard(line, maskChar),
            'email': (line) => maskEmail(line, maskChar),
            'bankcard': (line) => maskBankCard(line, maskChar, options.grouped !== false),
            'name': (line) => maskName(line, maskChar),
            'custom': (line) => maskCustom(line, options.keepStart || 3, options.keepEnd || 4, maskChar)
        }[type];

        if (!maskFn) {
            throw new Error(`未知的脱敏类型: ${type}`);
        }

        return lines.map(line => {
            if (line.trim() === '') return line;
            return maskFn(line);
        }).join('\n');
    }

    // ==================== 自动识别类型 ====================

    /**
     * 自动识别数据类型
     * @param {string} text - 待识别的文本
     * @returns {string} 识别的类型：phone/idcard/email/bankcard/name/unknown
     */
    function detectType(text) {
        if (!text || typeof text !== 'string') return 'unknown';

        const trimmed = text.trim();
        const cleaned = trimmed.replace(/\s+/g, '');

        // 邮箱检测
        if (/@/.test(cleaned) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
            return 'email';
        }

        // 手机号检测（11位数字，1开头）
        if (/^1[3-9]\d{9}$/.test(cleaned)) {
            return 'phone';
        }

        // 国际手机号
        if (/^(\+86|0086)1[3-9]\d{9}$/.test(cleaned)) {
            return 'phone';
        }

        // 身份证检测（18位或15位）
        if (/^\d{17}[\dXx]$/.test(cleaned) || /^\d{15}$/.test(cleaned)) {
            return 'idcard';
        }

        // 银行卡检测（纯数字，13-19位）
        if (/^\d{13,19}$/.test(cleaned)) {
            return 'bankcard';
        }

        // 中文姓名检测（2-4个中文字符）
        if (/^[\u4e00-\u9fa5]{2,4}$/.test(cleaned)) {
            return 'name';
        }

        // 英文姓名检测（字母+空格，至少2个单词）- 使用trimmed而不是cleaned
        const words = trimmed.split(/\s+/).filter(w => /^[a-zA-Z]+$/.test(w));
        if (words.length >= 2) {
            return 'name';
        }

        return 'unknown';
    }

    /**
     * 智能脱敏：自动识别类型并脱敏
     * @param {string} text - 原文本
     * @param {string} maskChar - 脱敏字符，默认 '*'
     * @returns {object} { result: string, type: string }
     */
    function smartMask(text, maskChar = '*') {
        const type = detectType(text);

        if (type === 'unknown') {
            // 未识别类型，使用自定义脱敏
            return {
                result: maskCustom(text, 3, 4, maskChar),
                type: 'custom'
            };
        }

        const maskFn = {
            'phone': maskPhone,
            'idcard': maskIdCard,
            'email': maskEmail,
            'bankcard': (t) => maskBankCard(t, maskChar, true),
            'name': maskName
        }[type];

        return {
            result: maskFn(text, maskChar),
            type: type
        };
    }

    // ==================== 地址脱敏 ====================
    /**
     * 地址脱敏：保留前后各 3-4 字符，中间替换为 *
     * @param {string} address - 地址字符串
     * @param {string} maskChar - 脱敏字符，默认 '*'
     * @returns {string} 脱敏后的地址
     */
    function maskAddress(address, maskChar = '*') {
        if (!address || typeof address !== 'string') return '';

        const cleaned = address.trim();
        if (cleaned.length <= 8) return maskChar.repeat(3);

        return `${cleaned.slice(0, 4)}${maskChar.repeat(3)}${cleaned.slice(-3)}`;
    }

    // ==================== JSON 递归脱敏 ====================
    const DEFAULT_SENSITIVE_FIELDS = ['email', 'phone', 'mobile', 'tel', 'id', 'idcard', 'idCard', 'ssn', 'address', 'card', 'creditcard', 'creditCard', 'bankcard', 'bankCard'];
    const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    const PHONE_RE = /^\+?\d[\d\-\s]{6,}$/;
    const IDCARD_RE = /^[0-9A-Za-z]{8,20}$/;

    /**
     * 根据值的类型自动脱敏
     * @param {any} val - 待脱敏的值
     * @param {string} maskChar - 脱敏字符
     * @returns {any} 脱敏后的值
     */
    function maskValueByType(val, maskChar = '*') {
        if (val === null || val === undefined) return val;

        const s = String(val);

        // 邮箱
        if (EMAIL_RE.test(s)) {
            return s.replace(/(^.).*(@.*$)/, `$1${maskChar.repeat(3)}$2`);
        }

        // 手机号
        if (PHONE_RE.test(s)) {
            const cleaned = s.replace(/[\s\-]/g, '');
            if (cleaned.length >= 7) {
                return cleaned.slice(0, 3) + maskChar.repeat(4) + cleaned.slice(-4);
            }
        }

        // 身份证
        if (IDCARD_RE.test(s) && s.length >= 8) {
            return s.slice(0, 3) + maskChar.repeat(4) + s.slice(-3);
        }

        return s;
    }

    /**
     * JSON 递归脱敏：深度遍历对象，对敏感字段进行脱敏
     * @param {any} node - JSON 对象或数组
     * @param {Array<string>} fieldKeys - 额外的敏感字段名列表
     * @param {string} maskChar - 脱敏字符，默认 '*'
     * @returns {any} 脱敏后的新对象
     */
    function maskJsonRecursive(node, fieldKeys = [], maskChar = '*') {
        const customKeys = (fieldKeys || []).map(k => String(k).toLowerCase());

        const isTargetKey = (key) => {
            const lowerKey = String(key).toLowerCase();
            // 精确匹配，避免误判 orderId、grid 等字段
            return DEFAULT_SENSITIVE_FIELDS.includes(lowerKey) ||
                   customKeys.includes(lowerKey);
        };

        const walk = (value) => {
            // 数组：递归处理每个元素
            if (Array.isArray(value)) {
                return value.map(walk);
            }

            // 对象：递归处理每个属性
            if (value && typeof value === 'object') {
                const result = {};
                Object.keys(value).forEach(key => {
                    const val = value[key];
                    if (isTargetKey(key)) {
                        // 敏感字段：如果值是对象/数组，递归处理；否则脱敏
                        if (val && typeof val === 'object') {
                            result[key] = walk(val);
                        } else {
                            result[key] = maskValueByType(val, maskChar);
                        }
                    } else {
                        // 非敏感字段：递归处理
                        result[key] = walk(val);
                    }
                });
                return result;
            }

            // 基本类型：直接返回
            return value;
        };

        return walk(node);
    }

    // 导出 API
    return {
        maskPhone,
        maskIdCard,
        maskEmail,
        maskBankCard,
        maskName,
        maskCustom,
        batchMask,
        detectType,
        smartMask,
        maskAddress,
        maskJsonRecursive
    };
});
