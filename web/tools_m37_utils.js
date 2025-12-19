/* 工具箱（M37）图片 Base64 转换
 *
 * 设计目标：
 * - 图片文件 ↔ Base64 Data URI 互转
 * - 支持常见图片格式：PNG/JPG/GIF/WebP/SVG
 * - 提供图片信息：尺寸、大小、MIME 类型
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM37Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // 支持的图片 MIME 类型
    const SUPPORTED_TYPES = new Set([
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp',
        'image/svg+xml',
        'image/bmp',
        'image/x-icon',
        'image/vnd.microsoft.icon'
    ]);

    // 根据文件扩展名推断 MIME 类型
    const EXT_TO_MIME = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        'bmp': 'image/bmp',
        'ico': 'image/x-icon'
    };

    /**
     * 检查是否为支持的图片类型
     * @param {string} mimeType - MIME 类型
     * @returns {boolean}
     */
    function isSupportedType(mimeType) {
        return SUPPORTED_TYPES.has(mimeType);
    }

    /**
     * 从文件名获取 MIME 类型
     * @param {string} filename - 文件名
     * @returns {string|null}
     */
    function getMimeFromFilename(filename) {
        const ext = (filename || '').split('.').pop().toLowerCase();
        return EXT_TO_MIME[ext] || null;
    }

    /**
     * 从 Data URI 提取信息（支持 ;charset=xxx;base64 等参数）
     * @param {string} dataUri - Data URI 字符串
     * @returns {{mimeType: string, base64: string, isValid: boolean}}
     */
    function parseDataUri(dataUri) {
        const s = String(dataUri || '');
        // 支持 data:mime/type;param=value;base64,xxx 格式
        const match = s.match(/^data:([^;,]+)?([^,]*),(.*)$/);
        if (!match) {
            return { mimeType: '', base64: '', isValid: false };
        }
        const mimeType = match[1] || 'application/octet-stream';
        const params = match[2] || '';
        const data = match[3] || '';
        // 检查是否包含 ;base64 标记
        const isBase64 = /;base64/i.test(params);
        // 如果声明了 base64，需验证数据有效性
        if (isBase64 && data && !isValidBase64(data)) {
            return { mimeType: '', base64: '', isValid: false };
        }
        return {
            mimeType,
            base64: data,
            isValid: true,
            isBase64Encoded: isBase64
        };
    }

    /**
     * 验证 Base64 字符串
     * @param {string} str - Base64 字符串
     * @returns {boolean}
     */
    function isValidBase64(str) {
        if (!str || typeof str !== 'string') return false;
        // 去除空白字符
        const cleaned = str.replace(/\s/g, '');
        // Base64 字符集检查
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) return false;
        // 长度检查（必须是 4 的倍数，或补齐后是）
        return cleaned.length % 4 === 0;
    }

    /**
     * 格式化文件大小
     * @param {number} bytes - 字节数
     * @returns {string}
     */
    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    /**
     * 计算 Base64 编码后的大小（不含 Data URI 头）
     * @param {number} originalBytes - 原始字节数
     * @returns {number}
     */
    function estimateBase64Size(originalBytes) {
        // Base64 编码会增加约 33% 的大小
        return Math.ceil(originalBytes * 4 / 3);
    }

    /**
     * 从 Base64 字符串计算原始大小
     * @param {string} base64 - Base64 字符串
     * @returns {number}
     */
    function getOriginalSizeFromBase64(base64) {
        const cleaned = (base64 || '').replace(/\s/g, '');
        const padding = (cleaned.match(/=+$/) || [''])[0].length;
        return Math.floor(cleaned.length * 3 / 4) - padding;
    }

    /**
     * Base64 转 Blob
     * @param {string} base64 - 纯 Base64 字符串（不含 Data URI 前缀）
     * @param {string} mimeType - MIME 类型
     * @returns {Blob}
     */
    function base64ToBlob(base64, mimeType) {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
    }

    /**
     * Data URI 转 Blob
     * @param {string} dataUri - 完整的 Data URI
     * @returns {{blob: Blob, mimeType: string}|{error: string}}
     */
    function dataUriToBlob(dataUri) {
        const parsed = parseDataUri(dataUri);
        if (!parsed.isValid) {
            return { error: '无效的 Data URI 格式' };
        }
        try {
            const blob = base64ToBlob(parsed.base64, parsed.mimeType);
            return { blob, mimeType: parsed.mimeType };
        } catch (e) {
            return { error: 'Base64 解码失败：' + (e.message || String(e)) };
        }
    }

    /**
     * 创建下载链接
     * @param {string} dataUri - Data URI
     * @param {string} filename - 文件名
     */
    function downloadDataUri(dataUri, filename) {
        const link = document.createElement('a');
        link.href = dataUri;
        link.download = filename || 'image';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /**
     * 从 MIME 类型获取默认文件扩展名
     * @param {string} mimeType - MIME 类型
     * @returns {string}
     */
    function getExtensionFromMime(mimeType) {
        const map = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/svg+xml': 'svg',
            'image/bmp': 'bmp',
            'image/x-icon': 'ico',
            'image/vnd.microsoft.icon': 'ico'
        };
        return map[mimeType] || 'bin';
    }

    return {
        isSupportedType,
        getMimeFromFilename,
        parseDataUri,
        isValidBase64,
        formatFileSize,
        estimateBase64Size,
        getOriginalSizeFromBase64,
        base64ToBlob,
        dataUriToBlob,
        downloadDataUri,
        getExtensionFromMime,
        SUPPORTED_TYPES: Array.from(SUPPORTED_TYPES)
    };
});
