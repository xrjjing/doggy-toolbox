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
            baseUrl: '',
            params: {},
            headers: {},
            body: '',
            followRedirects: false,
            error: null
        };

        let methodExplicitlySet = false;

        try {
            const text = String(curl ?? '').trim();
            if (!text) {
                config.error = 'cURL 命令不能为空';
                return config;
            }

            // 规范化：移除换行续行符、合并多行
            let cmd = text
                .replace(/\\\r?\n/g, ' ')
                .replace(/\r?\n/g, ' ')
                .trim();

            // 移除 curl 命令前缀
            if (/^curl\s+/i.test(cmd)) {
                cmd = cmd.replace(/^curl\s+/i, '');
            }

            const tokens = tokenizeCurl(cmd);
            if (!tokens.length) {
                config.error = 'cURL 命令不能为空';
                return config;
            }

            const urlCandidates = [];

            const appendBody = (value) => {
                if (typeof value !== 'string') {
                    return;
                }
                if (config.body) {
                    config.body += `&${value}`;
                } else {
                    config.body = value;
                }
            };

            const applyHeader = (header) => {
                if (!header) return;
                const colonIndex = header.indexOf(':');
                if (colonIndex > 0) {
                    const key = header.slice(0, colonIndex).trim();
                    const value = header.slice(colonIndex + 1).trim();
                    if (key) {
                        config.headers[key] = value;
                    }
                }
            };

            const ensureMethodForBody = () => {
                if (config.method === 'GET' && !methodExplicitlySet) {
                    config.method = 'POST';
                }
            };

            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];

                // -- 表示选项结束，剩余的都当作非选项参数
                if (token === '--') {
                    for (let j = i + 1; j < tokens.length; j++) {
                        if (tokens[j]) {
                            urlCandidates.push(tokens[j]);
                        }
                    }
                    break;
                }

                // -L, --location: 跟随重定向
                if (token === '-L' || token === '--location') {
                    config.followRedirects = true;
                    continue;
                }

                // -X, --request: 方法
                if (token === '-X' || token === '--request') {
                    if (i + 1 < tokens.length) {
                        config.method = String(tokens[++i]).toUpperCase();
                        methodExplicitlySet = true;
                    }
                    continue;
                }
                if (token.startsWith('--request=')) {
                    const method = token.slice('--request='.length);
                    if (method) {
                        config.method = method.toUpperCase();
                        methodExplicitlySet = true;
                    }
                    continue;
                }
                if (token.startsWith('-X') && token.length > 2) {
                    const method = token.slice(2);
                    if (method) {
                        config.method = method.toUpperCase();
                        methodExplicitlySet = true;
                    }
                    continue;
                }

                // -H, --header: 请求头
                if (token === '-H' || token === '--header') {
                    if (i + 1 < tokens.length) {
                        applyHeader(tokens[++i]);
                    }
                    continue;
                }
                if (token.startsWith('--header=')) {
                    applyHeader(token.slice('--header='.length));
                    continue;
                }
                if (token.startsWith('-H') && token.length > 2) {
                    applyHeader(token.slice(2));
                    continue;
                }

                // -d, --data, --data-raw, --data-binary: 请求体
                if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary') {
                    if (i + 1 < tokens.length) {
                        appendBody(tokens[++i]);
                    }
                    ensureMethodForBody();
                    continue;
                }
                if (token.startsWith('--data=')) {
                    appendBody(token.slice('--data='.length));
                    ensureMethodForBody();
                    continue;
                }
                if (token.startsWith('--data-raw=')) {
                    appendBody(token.slice('--data-raw='.length));
                    ensureMethodForBody();
                    continue;
                }
                if (token.startsWith('--data-binary=')) {
                    appendBody(token.slice('--data-binary='.length));
                    ensureMethodForBody();
                    continue;
                }
                if (token.startsWith('-d') && token.length > 2) {
                    appendBody(token.slice(2));
                    ensureMethodForBody();
                    continue;
                }

                // 未识别的选项直接跳过
                if (token.startsWith('-')) {
                    continue;
                }

                // 非选项参数作为 URL 候选
                urlCandidates.push(token);
            }

            if (urlCandidates.length) {
                const url = urlCandidates[urlCandidates.length - 1];
                config.url = url;
                const parsed = parseUrlParams(url);
                config.baseUrl = parsed.baseUrl;
                config.params = parsed.params;
            }

            return config;
        } catch (e) {
            config.error = `解析错误: ${e.message}`;
            return config;
        }
    }

    /**
     * 分词（处理单引号、双引号、$'...' 形式）
     */
    function tokenizeCurl(str) {
        const tokens = [];
        let i = 0;
        const len = str.length;

        while (i < len) {
            // 跳过空白
            while (i < len && /\s/.test(str[i])) i++;
            if (i >= len) break;

            let token = '';

            // $'...' 形式（bash ANSI-C 引用）
            if (str[i] === '$' && i + 1 < len && str[i + 1] === "'") {
                i += 2;
                while (i < len && str[i] !== "'") {
                    if (str[i] === '\\' && i + 1 < len) {
                        const next = str[i + 1];
                        if (next === 'n') { token += '\n'; i += 2; }
                        else if (next === 'r') { token += '\r'; i += 2; }
                        else if (next === 't') { token += '\t'; i += 2; }
                        else if (next === '\\') { token += '\\'; i += 2; }
                        else if (next === "'") { token += "'"; i += 2; }
                        else { token += str[i]; i++; }
                    } else {
                        token += str[i++];
                    }
                }
                i++; // 跳过结束引号
            }
            // 单引号
            else if (str[i] === "'") {
                i++;
                while (i < len && str[i] !== "'") {
                    token += str[i++];
                }
                i++; // 跳过结束引号
            }
            // 双引号
            else if (str[i] === '"') {
                i++;
                while (i < len && str[i] !== '"') {
                    if (str[i] === '\\' && i + 1 < len) {
                        const next = str[i + 1];
                        if (next === '"' || next === '\\' || next === '$' || next === '`') {
                            token += next;
                            i += 2;
                        } else if (next === 'n') {
                            token += '\n';
                            i += 2;
                        } else {
                            token += str[i++];
                        }
                    } else {
                        token += str[i++];
                    }
                }
                i++; // 跳过结束引号
            }
            // 普通 token
            else {
                while (i < len && !/\s/.test(str[i])) {
                    if (str[i] === '\\' && i + 1 < len) {
                        token += str[i + 1];
                        i += 2;
                    } else {
                        token += str[i++];
                    }
                }
            }

            if (token) {
                tokens.push(token);
            }
        }

        return tokens;
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
            // 尝试解析为完整 URL
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
            // 如果不是完整 URL，尝试解析相对 URL 的查询参数
            const questionMarkIndex = url.indexOf('?');
            if (questionMarkIndex === -1) {
                return { baseUrl: url, params: {} };
            }

            const baseUrl = url.substring(0, questionMarkIndex);
            const queryString = url.substring(questionMarkIndex + 1);
            const params = {};

            if (queryString) {
                queryString.split('&').forEach(pair => {
                    const [key, value] = pair.split('=');
                    if (key) {
                        params[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
                    }
                });
            }

            return { baseUrl, params };
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

    /**
     * 获取 cURL 常用模板
     * @returns {Array<{name: string, command: string, description: string, category: string}>}
     */
    function getCurlTemplates() {
        return [
            // 基础请求
            {
                name: 'GET JSON',
                command: 'curl -X GET -H "Accept: application/json" "https://api.example.com/data"',
                description: '获取 JSON 数据',
                category: '基础请求'
            },
            {
                name: 'POST JSON',
                command: 'curl -X POST -H "Content-Type: application/json" -d \'{"key":"value"}\' "https://api.example.com/data"',
                description: '发送 JSON 数据',
                category: '基础请求'
            },
            {
                name: 'PUT 更新',
                command: 'curl -X PUT -H "Content-Type: application/json" -d \'{"id":1,"name":"updated"}\' "https://api.example.com/data/1"',
                description: '更新资源',
                category: '基础请求'
            },
            {
                name: 'DELETE 删除',
                command: 'curl -X DELETE "https://api.example.com/data/1"',
                description: '删除资源',
                category: '基础请求'
            },
            // 认证
            {
                name: 'Bearer Token',
                command: 'curl -H "Authorization: Bearer YOUR_TOKEN" "https://api.example.com/protected"',
                description: '带 Bearer Token 请求',
                category: '认证'
            },
            {
                name: 'Basic Auth',
                command: 'curl -u username:password "https://api.example.com/auth"',
                description: 'HTTP Basic 认证',
                category: '认证'
            },
            {
                name: 'API Key Header',
                command: 'curl -H "X-API-Key: YOUR_API_KEY" "https://api.example.com/data"',
                description: 'API Key 认证',
                category: '认证'
            },
            // 文件操作
            {
                name: '上传文件',
                command: 'curl -X POST -F "file=@/path/to/file.txt" "https://api.example.com/upload"',
                description: '上传单个文件',
                category: '文件操作'
            },
            {
                name: '上传多文件',
                command: 'curl -X POST -F "file1=@/path/to/file1.txt" -F "file2=@/path/to/file2.txt" "https://api.example.com/upload"',
                description: '上传多个文件',
                category: '文件操作'
            },
            {
                name: '下载文件',
                command: 'curl -o output.file "https://example.com/file.zip"',
                description: '下载文件到本地',
                category: '文件操作'
            },
            {
                name: '下载并重命名',
                command: 'curl -O -J -L "https://example.com/file.zip"',
                description: '下载并使用服务器文件名',
                category: '文件操作'
            },
            // 调试
            {
                name: '显示响应头',
                command: 'curl -I "https://api.example.com/data"',
                description: '仅获取响应头',
                category: '调试'
            },
            {
                name: '详细输出',
                command: 'curl -v "https://api.example.com/data"',
                description: '显示详细请求/响应信息',
                category: '调试'
            },
            {
                name: '静默模式',
                command: 'curl -s "https://api.example.com/data"',
                description: '静默模式，不显示进度',
                category: '调试'
            },
            // 高级
            {
                name: '设置超时',
                command: 'curl --connect-timeout 10 --max-time 30 "https://api.example.com/data"',
                description: '设置连接和最大超时',
                category: '高级'
            },
            {
                name: '跟随重定向',
                command: 'curl -L "https://example.com/redirect"',
                description: '自动跟随 HTTP 重定向',
                category: '高级'
            },
            {
                name: '使用代理',
                command: 'curl -x http://proxy:8080 "https://api.example.com/data"',
                description: '通过代理服务器请求',
                category: '高级'
            },
            {
                name: '自定义 User-Agent',
                command: 'curl -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" "https://api.example.com/data"',
                description: '设置自定义 User-Agent',
                category: '高级'
            }
        ];
    }

    /**
     * 获取模板分类
     * @returns {string[]}
     */
    function getCurlTemplateCategories() {
        const templates = getCurlTemplates();
        return [...new Set(templates.map(t => t.category))];
    }

    return {
        parseCurl,
        generateCurl,
        parseUrlParams,
        buildUrl,
        formatResponseTime,
        formatResponseSize,
        getCurlTemplates,
        getCurlTemplateCategories
    };
});
