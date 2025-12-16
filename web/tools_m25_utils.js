/* 工具箱（M25）WebSocket 测试工具
 *
 * 设计目标：
 * - 纯算法、无 DOM 依赖
 * - 支持 WebSocket 连接管理
 * - 支持消息格式化
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM25Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /**
     * 格式化时间戳
     * @param {Date} date - 日期对象
     * @returns {string} 格式化后的时间字符串
     */
    function formatTimestamp(date) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}`;
    }

    /**
     * 格式化消息
     * @param {string} type - 消息类型（sent/received/system）
     * @param {string} content - 消息内容
     * @param {Date} timestamp - 时间戳
     * @returns {object} 格式化后的消息对象
     */
    function formatMessage(type, content, timestamp = new Date()) {
        return {
            type,
            content,
            timestamp: formatTimestamp(timestamp),
            fullTimestamp: timestamp
        };
    }

    /**
     * 尝试格式化 JSON
     * @param {string} text - 文本内容
     * @returns {string} 格式化后的文本
     */
    function tryFormatJson(text) {
        try {
            const obj = JSON.parse(text);
            return JSON.stringify(obj, null, 2);
        } catch (e) {
            return text;
        }
    }

    /**
     * 验证 WebSocket URL
     * @param {string} url - WebSocket URL
     * @returns {boolean} 是否有效
     */
    function isValidWsUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.protocol === 'ws:' || urlObj.protocol === 'wss:';
        } catch (e) {
            return false;
        }
    }

    return {
        formatTimestamp,
        formatMessage,
        tryFormatJson,
        isValidWsUrl
    };
});
