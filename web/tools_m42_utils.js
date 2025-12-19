/* 工具箱（M42）nginx 配置生成器
 *
 * 设计目标：
 * - 生成常用 nginx 配置片段
 * - 支持反向代理、静态站点、SSL、限流等场景
 * - 可视化配置，降低学习成本
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM42Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // 输入校验：防止配置注入
    const VALIDATORS = {
        // 域名：允许字母、数字、点、横杠、下划线、通配符
        serverName: /^[a-zA-Z0-9._*-]+$/,
        // 端口：1-65535
        port: (v) => {
            const n = parseInt(v, 10);
            return Number.isFinite(n) && n >= 1 && n <= 65535;
        },
        // URL：简化校验，允许协议、域名/IP、端口、路径
        url: /^https?:\/\/[a-zA-Z0-9._:-]+[a-zA-Z0-9./_:-]*$/,
        // 路径：允许字母、数字、斜杠、点、横杠、下划线
        path: /^[a-zA-Z0-9./_-]+$/,
        // upstream 名称：字母数字下划线
        upstreamName: /^[a-zA-Z_][a-zA-Z0-9_]*$/,
        // zone 名称
        zoneName: /^[a-zA-Z_][a-zA-Z0-9_]*$/,
        // 数字：正整数
        positiveInt: (v) => {
            const n = parseInt(v, 10);
            return Number.isFinite(n) && n > 0;
        },
        // 服务器列表：host:port 格式
        serverList: /^[a-zA-Z0-9._:-]+(,[a-zA-Z0-9._:-]+)*$/,
        // 允许的 origin：URL 或 *
        origin: /^(\*|https?:\/\/[a-zA-Z0-9._:-]+)$/,
        // HTTP 方法
        methods: /^[A-Z, ]+$/
    };

    // 危险字符检测
    function containsDangerousChars(str) {
        if (typeof str !== 'string') return false;
        return /[\r\n;`${}]/.test(str);
    }

    // 通用校验函数
    function validateField(value, validatorKey, fieldName) {
        if (value === undefined || value === null || value === '') return null;
        const strVal = String(value);

        if (containsDangerousChars(strVal)) {
            return `${fieldName} 包含非法字符（换行、分号等）`;
        }

        const validator = VALIDATORS[validatorKey];
        if (typeof validator === 'function') {
            if (!validator(strVal)) {
                return `${fieldName} 格式无效`;
            }
        } else if (validator instanceof RegExp) {
            if (!validator.test(strVal)) {
                return `${fieldName} 格式无效`;
            }
        }
        return null;
    }

    // 校验选项
    function validateOptions(opts, rules) {
        const errors = [];
        for (const [field, [validatorKey, displayName]] of Object.entries(rules)) {
            if (opts[field]) {
                const err = validateField(opts[field], validatorKey, displayName);
                if (err) errors.push(err);
            }
        }
        return errors;
    }

    // 配置模板
    const TEMPLATES = {
        // 反向代理
        reverseProxy: {
            name: '反向代理',
            desc: '将请求转发到后端服务',
            generate: (opts) => {
                const { serverName, listenPort, proxyPass, proxyTimeout, websocket } = opts;
                let config = `server {
    listen ${listenPort || 80};
    server_name ${serverName || 'example.com'};

    location / {
        proxy_pass ${proxyPass || 'http://127.0.0.1:8080'};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;`;

                if (proxyTimeout) {
                    config += `
        proxy_connect_timeout ${proxyTimeout}s;
        proxy_send_timeout ${proxyTimeout}s;
        proxy_read_timeout ${proxyTimeout}s;`;
                }

                if (websocket) {
                    config += `
        # WebSocket 支持
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";`;
                }

                config += `
    }
}`;
                return config;
            }
        },

        // 静态站点
        staticSite: {
            name: '静态站点',
            desc: '托管静态文件（HTML/CSS/JS）',
            generate: (opts) => {
                const { serverName, listenPort, rootPath, indexFile, gzip, cacheControl } = opts;
                let config = `server {
    listen ${listenPort || 80};
    server_name ${serverName || 'example.com'};
    root ${rootPath || '/var/www/html'};
    index ${indexFile || 'index.html'};`;

                if (gzip) {
                    config += `

    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;`;
                }

                if (cacheControl) {
                    config += `

    # 静态资源缓存
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }`;
                }

                config += `

    location / {
        try_files $uri $uri/ =404;
    }
}`;
                return config;
            }
        },

        // SPA 单页应用
        spa: {
            name: 'SPA 单页应用',
            desc: 'React/Vue/Angular 等前端路由支持',
            generate: (opts) => {
                const { serverName, listenPort, rootPath } = opts;
                return `server {
    listen ${listenPort || 80};
    server_name ${serverName || 'example.com'};
    root ${rootPath || '/var/www/html'};
    index index.html;

    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    # 静态资源缓存
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # SPA 路由: 所有请求回退到 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}`;
            }
        },

        // SSL/HTTPS
        ssl: {
            name: 'SSL/HTTPS',
            desc: 'HTTPS 配置与 HTTP 重定向',
            generate: (opts) => {
                const { serverName, sslCert, sslKey, rootPath, hsts } = opts;
                let config = `# HTTP 重定向到 HTTPS
server {
    listen 80;
    server_name ${serverName || 'example.com'};
    return 301 https://$server_name$request_uri;
}

# HTTPS 配置
server {
    listen 443 ssl http2;
    server_name ${serverName || 'example.com'};

    ssl_certificate ${sslCert || '/etc/nginx/ssl/cert.pem'};
    ssl_certificate_key ${sslKey || '/etc/nginx/ssl/key.pem'};

    # SSL 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;`;

                if (hsts) {
                    config += `

    # HSTS
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;`;
                }

                config += `

    root ${rootPath || '/var/www/html'};
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}`;
                return config;
            }
        },

        // 负载均衡
        loadBalance: {
            name: '负载均衡',
            desc: '多后端服务器负载均衡',
            generate: (opts) => {
                const { upstreamName, servers, serverName, listenPort, algorithm } = opts;
                const serverList = (servers || '127.0.0.1:8001,127.0.0.1:8002')
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean);  // 过滤空值

                let upstreamConfig = `upstream ${upstreamName || 'backend'} {`;

                if (algorithm === 'ip_hash') {
                    upstreamConfig += `
    ip_hash;`;
                } else if (algorithm === 'least_conn') {
                    upstreamConfig += `
    least_conn;`;
                }

                serverList.forEach(server => {
                    upstreamConfig += `
    server ${server};`;
                });

                upstreamConfig += `
}

server {
    listen ${listenPort || 80};
    server_name ${serverName || 'example.com'};

    location / {
        proxy_pass http://${upstreamName || 'backend'};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}`;
                return upstreamConfig;
            }
        },

        // 限流
        rateLimit: {
            name: '限流配置',
            desc: 'IP 限流与请求频率控制',
            generate: (opts) => {
                const { serverName, listenPort, rateLimit, burstLimit, zoneName } = opts;
                return `# 在 http 块中定义限流区域（放在 server 块外）
limit_req_zone $binary_remote_addr zone=${zoneName || 'api_limit'}:10m rate=${rateLimit || '10'}r/s;

server {
    listen ${listenPort || 80};
    server_name ${serverName || 'example.com'};

    location /api/ {
        limit_req zone=${zoneName || 'api_limit'} burst=${burstLimit || '20'} nodelay;
        limit_req_status 429;

        # 超限返回信息
        error_page 429 = @too_many_requests;

        proxy_pass http://127.0.0.1:8080;
    }

    location @too_many_requests {
        default_type application/json;
        return 429 '{"error": "Too Many Requests"}';
    }
}`;
            }
        },

        // CORS
        cors: {
            name: 'CORS 跨域',
            desc: '跨域资源共享配置',
            generate: (opts) => {
                const { serverName, listenPort, allowOrigin, allowMethods } = opts;
                return `server {
    listen ${listenPort || 80};
    server_name ${serverName || 'example.com'};

    # CORS 配置
    add_header Access-Control-Allow-Origin "${allowOrigin || '*'}";
    add_header Access-Control-Allow-Methods "${allowMethods || 'GET, POST, PUT, DELETE, OPTIONS'}";
    add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With";
    add_header Access-Control-Max-Age 86400;

    # 预检请求处理
    if ($request_method = 'OPTIONS') {
        return 204;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
    }
}`;
            }
        },

        // 文件上传
        fileUpload: {
            name: '文件上传',
            desc: '大文件上传配置',
            generate: (opts) => {
                const { serverName, listenPort, maxBodySize, uploadPath } = opts;
                return `server {
    listen ${listenPort || 80};
    server_name ${serverName || 'example.com'};

    # 文件上传大小限制
    client_max_body_size ${maxBodySize || '100'}m;
    client_body_buffer_size 10m;
    client_body_timeout 300s;

    location ${uploadPath || '/upload'} {
        proxy_pass http://127.0.0.1:8080;
        proxy_request_buffering off;
        proxy_read_timeout 300s;
    }
}`;
            }
        }
    };

    /**
     * 获取所有模板
     */
    function getTemplates() {
        return Object.entries(TEMPLATES).map(([key, tpl]) => ({
            key,
            name: tpl.name,
            desc: tpl.desc
        }));
    }

    /**
     * 生成配置
     */
    function generate(templateKey, options = {}) {
        const template = TEMPLATES[templateKey];
        if (!template) {
            return { config: '', error: `未知模板: ${templateKey}` };
        }

        // 定义每个模板的校验规则
        const validationRules = {
            reverseProxy: {
                serverName: ['serverName', '服务器名称'],
                listenPort: ['port', '监听端口'],
                proxyPass: ['url', '代理地址'],
                proxyTimeout: ['positiveInt', '超时时间']
            },
            staticSite: {
                serverName: ['serverName', '服务器名称'],
                listenPort: ['port', '监听端口'],
                rootPath: ['path', '根目录'],
                indexFile: ['path', '索引文件']
            },
            spa: {
                serverName: ['serverName', '服务器名称'],
                listenPort: ['port', '监听端口'],
                rootPath: ['path', '根目录']
            },
            ssl: {
                serverName: ['serverName', '服务器名称'],
                sslCert: ['path', 'SSL 证书路径'],
                sslKey: ['path', 'SSL 密钥路径'],
                rootPath: ['path', '根目录']
            },
            loadBalance: {
                serverName: ['serverName', '服务器名称'],
                listenPort: ['port', '监听端口'],
                upstreamName: ['upstreamName', 'Upstream 名称'],
                servers: ['serverList', '服务器列表']
            },
            rateLimit: {
                serverName: ['serverName', '服务器名称'],
                listenPort: ['port', '监听端口'],
                zoneName: ['zoneName', 'Zone 名称'],
                rateLimit: ['positiveInt', '限流速率'],
                burstLimit: ['positiveInt', '突发限制']
            },
            cors: {
                serverName: ['serverName', '服务器名称'],
                listenPort: ['port', '监听端口'],
                allowOrigin: ['origin', '允许来源'],
                allowMethods: ['methods', '允许方法']
            },
            fileUpload: {
                serverName: ['serverName', '服务器名称'],
                listenPort: ['port', '监听端口'],
                maxBodySize: ['positiveInt', '最大上传大小'],
                uploadPath: ['path', '上传路径']
            }
        };

        // 执行校验
        const rules = validationRules[templateKey];
        if (rules) {
            const errors = validateOptions(options, rules);
            if (errors.length > 0) {
                return { config: '', error: errors.join('; ') };
            }
        }

        try {
            const config = template.generate(options);
            return { config, error: null };
        } catch (e) {
            return { config: '', error: e.message || String(e) };
        }
    }

    /**
     * 验证配置语法（简单检查）
     */
    function validate(config) {
        const errors = [];
        const lines = config.split('\n');
        let braceCount = 0;

        lines.forEach((line, i) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('#') || !trimmed) return;

            // 检查大括号匹配
            braceCount += (line.match(/{/g) || []).length;
            braceCount -= (line.match(/}/g) || []).length;

            // 检查指令是否以分号结尾
            if (trimmed && !trimmed.endsWith('{') && !trimmed.endsWith('}') &&
                !trimmed.startsWith('#') && !trimmed.endsWith(';')) {
                // 可能是多行指令的开始，简单跳过
            }
        });

        if (braceCount !== 0) {
            errors.push(`大括号不匹配 (差异: ${braceCount})`);
        }

        return { valid: errors.length === 0, errors };
    }

    return {
        getTemplates,
        generate,
        validate,
        TEMPLATES
    };
});
