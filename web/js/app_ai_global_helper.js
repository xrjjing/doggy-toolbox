// 全局 AI 帮助按钮
// 可拖动的浮动按钮，提供上下文感知的工具推荐

(function() {
    'use strict';

    // 工具元数据：用于上下文推荐
    const TOOL_METADATA = {
        // 数据管理
        'credentials': { name: '密码管理', category: 'data', keywords: ['密码', '凭证', '账号', 'password', 'credential'], related: ['commands', 'tool-password'] },
        'commands': { name: '命令管理', category: 'data', keywords: ['命令', '脚本', 'command', 'script', 'shell'], related: ['tool-git', 'tool-docker'] },
        'converter': { name: '转化器', category: 'data', keywords: ['转换', '转化', 'convert'], related: ['nodes'] },
        'nodes': { name: '节点管理', category: 'data', keywords: ['节点', 'node', '代理', 'proxy'], related: ['converter'] },

        // 编码转换
        'tool-base64': { name: 'Base64', category: 'encoding', keywords: ['base64', '编码', '解码', 'encode', 'decode'], related: ['tool-url', 'tool-b64hex'] },
        'tool-url': { name: 'URL 编码', category: 'encoding', keywords: ['url', '编码', 'encode', 'decode', 'uri'], related: ['tool-base64', 'tool-html-entity'] },
        'tool-b64hex': { name: 'Base64/Hex', category: 'encoding', keywords: ['base64', 'hex', '十六进制'], related: ['tool-base64', 'tool-radix'] },
        'tool-radix': { name: '进制转换', category: 'encoding', keywords: ['进制', '二进制', '十六进制', 'binary', 'hex', 'radix'], related: ['tool-b64hex'] },
        'tool-unicode': { name: 'Unicode', category: 'encoding', keywords: ['unicode', '编码', 'utf8', 'utf-8'], related: ['tool-html-entity'] },
        'tool-html-entity': { name: 'HTML 实体', category: 'encoding', keywords: ['html', 'entity', '实体', '转义'], related: ['tool-url', 'tool-unicode'] },

        // 加密安全
        'tool-hash': { name: 'Hash 计算', category: 'crypto', keywords: ['hash', 'md5', 'sha', '哈希', '摘要'], related: ['tool-hmac', 'tool-crypto'] },
        'tool-crypto': { name: '加密解密', category: 'crypto', keywords: ['加密', '解密', 'aes', 'des', 'encrypt', 'decrypt'], related: ['tool-hash', 'tool-rsa'] },
        'tool-jwt': { name: 'JWT 解析', category: 'crypto', keywords: ['jwt', 'token', '令牌', 'json web token'], related: ['tool-base64', 'tool-json'] },
        'tool-password': { name: '密码生成', category: 'crypto', keywords: ['密码', '生成', 'password', 'generate', '随机'], related: ['credentials', 'tool-hash'] },
        'tool-hmac': { name: 'HMAC', category: 'crypto', keywords: ['hmac', 'mac', '消息认证'], related: ['tool-hash'] },
        'tool-rsa': { name: 'RSA', category: 'crypto', keywords: ['rsa', '非对称', '公钥', '私钥', 'public key', 'private key'], related: ['tool-crypto'] },

        // 网络请求
        'http-collections': { name: 'HTTP 请求', category: 'network', keywords: ['http', 'api', '请求', 'request', 'postman'], related: ['tool-curl', 'tool-json'] },
        'tool-websocket': { name: 'WebSocket', category: 'network', keywords: ['websocket', 'ws', 'socket', '长连接'], related: ['http-collections'] },
        'tool-curl': { name: 'cURL 转换', category: 'network', keywords: ['curl', 'http', '请求', 'command'], related: ['http-collections'] },

        // 数据格式
        'tool-json': { name: 'JSON 格式化', category: 'format', keywords: ['json', '格式化', 'format', '美化'], related: ['tool-json-schema', 'tool-jsonpath'] },
        'tool-json-schema': { name: 'JSON Schema', category: 'format', keywords: ['json', 'schema', '验证', 'validate'], related: ['tool-json'] },
        'tool-data-convert': { name: '数据转换', category: 'format', keywords: ['转换', 'convert', 'yaml', 'xml', 'json'], related: ['tool-json', 'tool-toml'] },
        'tool-csv': { name: 'CSV 处理', category: 'format', keywords: ['csv', '表格', 'excel', 'table'], related: ['tool-json', 'tool-mock'] },
        'tool-mock': { name: 'Mock 数据', category: 'format', keywords: ['mock', '模拟', '测试数据', 'fake'], related: ['tool-json', 'tool-csv'] },
        'tool-toml': { name: 'TOML', category: 'format', keywords: ['toml', '配置', 'config'], related: ['tool-data-convert'] },
        'tool-jsonpath': { name: 'JSONPath', category: 'format', keywords: ['jsonpath', 'json', '查询', 'query'], related: ['tool-json'] },

        // 文本处理
        'tool-text': { name: '文本处理', category: 'text', keywords: ['文本', 'text', '处理', '转换'], related: ['tool-diff', 'tool-regex'] },
        'tool-diff': { name: '文本对比', category: 'text', keywords: ['diff', '对比', '比较', 'compare'], related: ['tool-text'] },
        'tool-regex': { name: '正则表达式', category: 'text', keywords: ['regex', '正则', 'regexp', '匹配', 'match'], related: ['tool-text'] },
        'tool-charcount': { name: '字符统计', category: 'text', keywords: ['字符', '统计', 'count', 'character'], related: ['tool-text'] },
        'tool-markdown': { name: 'Markdown', category: 'text', keywords: ['markdown', 'md', '预览', 'preview'], related: ['tool-text'] },
        'tool-text-sort': { name: '文本排序', category: 'text', keywords: ['排序', 'sort', '去重', 'unique'], related: ['tool-text'] },
        'tool-mask': { name: '数据脱敏', category: 'text', keywords: ['脱敏', 'mask', '隐私', 'privacy'], related: ['tool-text'] },
        'tool-sql': { name: 'SQL 格式化', category: 'text', keywords: ['sql', '格式化', 'format', '数据库'], related: ['tool-text'] },

        // 开发工具
        'tool-uuid': { name: 'UUID 生成', category: 'dev', keywords: ['uuid', 'guid', '唯一标识'], related: ['tool-time'] },
        'tool-time': { name: '时间戳转换', category: 'dev', keywords: ['时间', 'timestamp', '时间戳', 'date'], related: ['tool-datecalc'] },
        'tool-datecalc': { name: '日期计算', category: 'dev', keywords: ['日期', 'date', '计算', 'calculate'], related: ['tool-time'] },
        'tool-naming': { name: '命名转换', category: 'dev', keywords: ['命名', 'naming', 'camel', 'snake', '驼峰'], related: ['tool-text'] },
        'tool-color': { name: '颜色转换', category: 'dev', keywords: ['颜色', 'color', 'rgb', 'hex', 'hsl'], related: [] },
        'tool-ip': { name: 'IP 工具', category: 'dev', keywords: ['ip', '地址', 'address', '子网'], related: [] },
        'tool-cron': { name: 'Cron 表达式', category: 'dev', keywords: ['cron', '定时', '任务', 'schedule'], related: [] },
        'tool-qrcode': { name: '二维码', category: 'dev', keywords: ['qrcode', '二维码', 'qr'], related: [] },
        'tool-img-base64': { name: '图片 Base64', category: 'dev', keywords: ['图片', 'image', 'base64', 'img'], related: ['tool-base64'] },
        'tool-ua': { name: 'User-Agent', category: 'dev', keywords: ['ua', 'user-agent', '浏览器', 'browser'], related: [] },

        // 运维工具
        'tool-git': { name: 'Git 命令', category: 'devops', keywords: ['git', '版本控制', 'version control'], related: ['commands'] },
        'tool-docker': { name: 'Docker 命令', category: 'devops', keywords: ['docker', '容器', 'container'], related: ['tool-docker-service', 'tool-docker-swarm'] },
        'tool-docker-service': { name: 'Docker Service', category: 'devops', keywords: ['docker', 'service', '服务'], related: ['tool-docker'] },
        'tool-docker-swarm': { name: 'Docker Swarm', category: 'devops', keywords: ['docker', 'swarm', '集群'], related: ['tool-docker'] },
        'tool-nginx': { name: 'Nginx 配置', category: 'devops', keywords: ['nginx', '配置', 'config', '反向代理'], related: [] },

        // AI
        'ai-chat': { name: 'AI 对话', category: 'ai', keywords: ['ai', '对话', 'chat', '聊天', 'gpt'], related: ['ai-settings'] },
        'ai-settings': { name: 'AI 设置', category: 'ai', keywords: ['ai', '设置', 'settings', '配置'], related: ['ai-chat'] }
    };

    // 分类信息
    const CATEGORIES = {
        'data': { name: '数据管理', icon: '📁' },
        'encoding': { name: '编码转换', icon: '🔄' },
        'crypto': { name: '加密安全', icon: '🔐' },
        'network': { name: '网络请求', icon: '🌐' },
        'format': { name: '数据格式', icon: '📋' },
        'text': { name: '文本处理', icon: '📝' },
        'dev': { name: '开发工具', icon: '🛠️' },
        'devops': { name: '运维工具', icon: '⚙️' },
        'ai': { name: 'AI 功能', icon: '🤖' }
    };

    // 状态
    let isExpanded = false;
    let isDragging = false;
    let isHalfHidden = true;
    let currentY = 200;
    let dragStartY = 0;
    let dragStartTop = 0;

    /**
     * 获取当前页面 ID
     */
    function getCurrentPageId() {
        const activePage = document.querySelector('.page.active');
        if (activePage) {
            return activePage.id.replace('page-', '');
        }
        return 'credentials';
    }

    /**
     * 根据上下文获取推荐工具
     */
    function getRecommendations(currentPageId) {
        const recommendations = [];
        const currentTool = TOOL_METADATA[currentPageId];

        if (!currentTool) {
            // 默认推荐热门工具
            return [
                { id: 'tool-json', ...TOOL_METADATA['tool-json'], reason: '常用工具' },
                { id: 'tool-base64', ...TOOL_METADATA['tool-base64'], reason: '常用工具' },
                { id: 'http-collections', ...TOOL_METADATA['http-collections'], reason: '常用工具' },
                { id: 'ai-chat', ...TOOL_METADATA['ai-chat'], reason: 'AI 助手' }
            ];
        }

        // 添加相关工具
        if (currentTool.related) {
            currentTool.related.forEach(relatedId => {
                if (TOOL_METADATA[relatedId]) {
                    recommendations.push({
                        id: relatedId,
                        ...TOOL_METADATA[relatedId],
                        reason: '相关工具'
                    });
                }
            });
        }

        // 添加同类别工具
        const sameCategoryTools = Object.entries(TOOL_METADATA)
            .filter(([id, tool]) => tool.category === currentTool.category && id !== currentPageId)
            .slice(0, 3);

        sameCategoryTools.forEach(([id, tool]) => {
            if (!recommendations.find(r => r.id === id)) {
                recommendations.push({
                    id,
                    ...tool,
                    reason: '同类工具'
                });
            }
        });

        // 始终推荐 AI 对话
        if (currentPageId !== 'ai-chat' && !recommendations.find(r => r.id === 'ai-chat')) {
            recommendations.push({
                id: 'ai-chat',
                ...TOOL_METADATA['ai-chat'],
                reason: 'AI 助手'
            });
        }

        return recommendations.slice(0, 5);
    }

    /**
     * 创建浮动按钮 DOM
     */
    function createFloatingButton() {
        // 容器
        const container = document.createElement('div');
        container.id = 'ai-global-helper';
        container.className = 'ai-global-helper half-hidden';

        // 主按钮
        const button = document.createElement('div');
        button.className = 'ai-helper-btn';
        button.innerHTML = `
            <span class="ai-icon">🤖</span>
            <span class="expand-indicator">‹</span>
        `;

        // 面板
        const panel = document.createElement('div');
        panel.className = 'ai-helper-panel';
        panel.innerHTML = `
            <div class="panel-header">
                <span class="panel-title">AI 助手</span>
                <button class="panel-close">×</button>
            </div>
            <div class="panel-context">
                <span class="context-label">当前页面：</span>
                <span class="context-value">-</span>
            </div>
            <div class="panel-recommendations">
                <div class="recommendations-title">推荐工具</div>
                <div class="recommendations-list"></div>
            </div>
            <div class="panel-actions">
                <button class="action-btn action-ai-chat">
                    <span>💬</span> 打开 AI 对话
                </button>
            </div>
        `;

        container.appendChild(button);
        container.appendChild(panel);

        return container;
    }

    /**
     * 更新面板内容
     */
    function updatePanel() {
        const currentPageId = getCurrentPageId();
        const currentTool = TOOL_METADATA[currentPageId];
        const recommendations = getRecommendations(currentPageId);

        // 更新当前页面显示
        const contextValue = document.querySelector('.ai-helper-panel .context-value');
        if (contextValue) {
            contextValue.textContent = currentTool ? currentTool.name : '未知页面';
        }

        // 更新推荐列表
        const listContainer = document.querySelector('.ai-helper-panel .recommendations-list');
        if (listContainer) {
            listContainer.innerHTML = recommendations.map(rec => `
                <div class="recommendation-item" data-page="${rec.id}">
                    <span class="rec-icon">${CATEGORIES[rec.category]?.icon || '📄'}</span>
                    <div class="rec-info">
                        <span class="rec-name">${rec.name}</span>
                        <span class="rec-reason">${rec.reason}</span>
                    </div>
                    <span class="rec-arrow">→</span>
                </div>
            `).join('');

            // 绑定点击事件
            listContainer.querySelectorAll('.recommendation-item').forEach(item => {
                item.addEventListener('click', () => {
                    const pageId = item.dataset.page;
                    if (typeof window.switchPage === 'function') {
                        window.switchPage(pageId);
                    }
                    collapse();
                });
            });
        }
    }

    /**
     * 展开面板
     */
    function expand() {
        const container = document.getElementById('ai-global-helper');
        if (!container) return;

        isExpanded = true;
        isHalfHidden = false;
        container.classList.remove('half-hidden');
        container.classList.add('expanded');
        updatePanel();
    }

    /**
     * 收起面板
     */
    function collapse() {
        const container = document.getElementById('ai-global-helper');
        if (!container) return;

        isExpanded = false;
        container.classList.remove('expanded');

        // 延迟恢复半隐藏状态
        setTimeout(() => {
            if (!isExpanded && !isDragging) {
                isHalfHidden = true;
                container.classList.add('half-hidden');
            }
        }, 300);
    }

    /**
     * 切换展开/收起
     */
    function toggle() {
        if (isExpanded) {
            collapse();
        } else {
            expand();
        }
    }

    /**
     * 初始化拖动逻辑
     */
    function initDrag(container) {
        const button = container.querySelector('.ai-helper-btn');

        button.addEventListener('mousedown', (e) => {
            if (e.target.closest('.expand-indicator')) return;

            isDragging = true;
            dragStartY = e.clientY;
            dragStartTop = currentY;
            container.classList.add('dragging');
            container.classList.remove('half-hidden');
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const deltaY = e.clientY - dragStartY;
            const newY = Math.max(50, Math.min(window.innerHeight - 100, dragStartTop + deltaY));
            currentY = newY;
            container.style.top = `${newY}px`;
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) return;

            isDragging = false;
            container.classList.remove('dragging');

            // 如果没有展开，恢复半隐藏
            if (!isExpanded) {
                setTimeout(() => {
                    isHalfHidden = true;
                    container.classList.add('half-hidden');
                }, 200);
            }

            // 保存位置
            localStorage.setItem('ai_helper_y', currentY.toString());
        });
    }

    /**
     * 初始化事件绑定
     */
    function initEvents(container) {
        const button = container.querySelector('.ai-helper-btn');
        const closeBtn = container.querySelector('.panel-close');
        const aiChatBtn = container.querySelector('.action-ai-chat');
        const expandIndicator = container.querySelector('.expand-indicator');

        // 点击展开指示器展开
        expandIndicator.addEventListener('click', (e) => {
            e.stopPropagation();
            toggle();
        });

        // 点击按钮（非拖动时）展开
        button.addEventListener('click', (e) => {
            if (!isDragging) {
                toggle();
            }
        });

        // 关闭按钮
        closeBtn.addEventListener('click', collapse);

        // AI 对话按钮
        aiChatBtn.addEventListener('click', () => {
            if (typeof window.switchPage === 'function') {
                window.switchPage('ai-chat');
            }
            collapse();
        });

        // 鼠标进入时取消半隐藏
        container.addEventListener('mouseenter', () => {
            if (!isExpanded) {
                container.classList.remove('half-hidden');
            }
        });

        // 鼠标离开时恢复半隐藏
        container.addEventListener('mouseleave', () => {
            if (!isExpanded && !isDragging) {
                container.classList.add('half-hidden');
            }
        });

        // 页面切换时更新面板
        document.addEventListener('pageChanged', () => {
            if (isExpanded) {
                updatePanel();
            }
        });
    }

    /**
     * 初始化全局 AI 帮助按钮
     */
    function init() {
        // 检查是否已存在
        if (document.getElementById('ai-global-helper')) return;

        // 创建 DOM
        const container = createFloatingButton();
        document.body.appendChild(container);

        // 恢复保存的位置（限制在可见范围内）
        const savedY = localStorage.getItem('ai_helper_y');
        if (savedY) {
            currentY = parseInt(savedY, 10);
            // 确保位置在可见范围内
            currentY = Math.max(50, Math.min(window.innerHeight - 100, currentY));
        }
        container.style.top = `${currentY}px`;

        // 初始化拖动
        initDrag(container);

        // 初始化事件
        initEvents(container);
    }

    // 导出
    window.initGlobalAIHelper = init;
    window.expandGlobalAIHelper = expand;
    window.collapseGlobalAIHelper = collapse;

    // DOM 加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
