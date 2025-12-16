/* 工具箱（M24）HTTP 请求测试工具
 *
 * 设计目标：
 * - 纯算法、无 DOM 依赖
 * - 支持多种 HTTP 方法
 * - 支持请求头、Query 参数、请求体编辑
 * - 支持 cURL 导入/导出
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM24Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /**
     * 解析 cURL 命令
     * @param {string} curl - cURL 命令字符串
     * @returns {object} 解析后的请求配置
     */
    function parseCurl(curl) {
        const config = {
            method: 'GET',
            url: '',
            headers: {},
            body: '',
            error: null
        };

        try {
            const text = String(curl ?? '').trim();
            if (!text) {
                config.error = 'cURL 命令不能为空';
                return config;
            }

            // 移除 curl 命令前缀
            let cmd = text.replace(/^curl\s+/i, '');

            // 提取 URL（可能被引号包裹）
            const urlMatch = cmd.match(/(?:^|\s)(['"]?)([^\s'"]+)\1/);
            if (urlMatch) {
                config.url = urlMatch[2];
                cmd = cmd.replace(urlMatch[0], '');
            }

            // 提取方法
            const methodMatch = cmd.match(/-X\s+([A-Z]+)/i);
            if (methodMatch) {
                config.method = methodMatch[1].toUpperCase();
            }

            // 提取请求头
            const headerRegex = /-H\s+(['"])([^'"]+)\1/g;
            let headerMatch;
            while ((headerMatch = headerRegex.exec(cmd)) !== null) {
                const header = headerMatch[2];
                const colonIndex = header.indexOf(':');
                if (colonIndex > 0) {
                    const key = header.substring(0, colonIndex).trim();
                    const value = header.substring(colonIndex + 1).trim();
                    config.headers[key] = value;
                }
            }

            // 提取请求体
            const dataMatch = cmd.match(/(?:-d|--data|--data-raw)\s+(['"])([^'"]*)\1/);
            if (dataMatch) {
                config.body = dataMatch[2];
            }

            return config;
        } catch (e) {
            config.error = `解析错误: ${e.message}`;
            return config;
        }
    }

    /**
     * 生成 cURL 命令
     * @param {object} config - 请求配置
     * @returns {string} cURL 命令字符串
     */
    function generateCurl(config) {
        const parts = ['curl'];

        // 添加方法
        if (config.method && config.method !== 'GET') {
            parts.push(`-X ${config.method}`);
        }

        // 添加请求头
        if (config.headers && typeof config.headers === 'object') {
            Object.keys(config.headers).forEach(key => {
                const value = config.headers[key];
                if (value) {
                    parts.push(`-H "${key}: ${value}"`);
                }
            });
        }

        // 添加请求体
        if (config.body) {
            const escaped = String(config.body).replace(/"/g, '\\"');
            parts.push(`-d "${escaped}"`);
        }

        // 添加 URL
        if (config.url) {
            parts.push(`"${config.url}"`);
        }

        return parts.join(' ');
    }

    /**
     * 解析 URL 参数
     * @param {string} url - URL 字符串
     * @returns {object} { baseUrl, params }
     */
    function parseUrlParams(url) {
        try {
            const urlObj = new URL(url);
            const params = {};
            urlObj.searchParams.forEach((value, key) => {
                params[key] = value;
            });
            return {
                baseUrl: `${urlObj.origin}${urlObj.pathname}`,
                params
            };
        } catch (e) {
            return {
                baseUrl: url,
                params: {}
            };
        }
    }

    /**
     * 构建带参数的 URL
     * @param {string} baseUrl - 基础 URL
     * @param {object} params - 参数对象
     * @returns {string} 完整 URL
     */
    function buildUrl(baseUrl, params) {
        if (!params || Object.keys(params).length === 0) {
            return baseUrl;
        }

        const queryString = Object.keys(params)
            .filter(key => params[key] !== '')
            .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
            .join('&');

        return queryString ? `${baseUrl}?${queryString}` : baseUrl;
    }

    /**
     * 格式化响应时间
     * @param {number} ms - 毫秒数
     * @returns {string} 格式化后的时间字符串
     */
    function formatResponseTime(ms) {
        if (ms < 1000) {
            return `${ms.toFixed(0)} ms`;
        }
        return `${(ms / 1000).toFixed(2)} s`;
    }

    /**
     * 格式化响应大小
     * @param {number} bytes - 字节数
     * @returns {string} 格式化后的大小字符串
     */
    function formatResponseSize(bytes) {
        if (bytes < 1024) {
            return `${bytes} B`;
        } else if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(2)} KB`;
        }
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    return {
        parseCurl,
        generateCurl,
        parseUrlParams,
        buildUrl,
        formatResponseTime,
        formatResponseSize
    };
});
