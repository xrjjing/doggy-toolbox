/*
 * 文件总览：全局悬浮 AI 助手按钮。
 *
 * 这个文件不绑定单个页面，而是根据当前 pageId 在界面上悬浮一个可拖动入口，帮助用户快速跳到相关工具或触发 AI 辅助。
 * 主要职责：
 * - 维护页面与工具的元数据映射；
 * - 判断当前页面上下文；
 * - 创建/销毁悬浮按钮与面板；
 * - 处理拖动、展开、推荐按钮渲染。
 *
 * 排查建议：
 * - 悬浮按钮不出现：优先看页面上下文识别和初始化逻辑；
 * - 推荐内容和当前页面不匹配：先看 TOOL_METADATA 与当前 pageId 的映射。
 */

// 全局 AI 帮助按钮
// 这是跨页面存在的浮动入口，会根据当前页面上下文给出相关工具或 AI 辅助推荐。

(function() {
    'use strict';

    // 工具元数据：用于“当前页面适合推荐什么工具/相关页面”的上下文判断，是推荐准确度的基础。
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

    // 交互状态：
    // - isExpanded：右侧推荐面板当前是否处于展开状态；
    // - isDragging：当前是否正在拖动悬浮按钮，用来避免“拖动一下却误点开面板”；
    // - isHalfHidden：按钮是否处于贴边半隐藏状态，减少对页面主体区域的遮挡；
    // - currentY / dragStartY / dragStartTop：分别记录当前位置、拖拽起点和拖拽前位置。
    let isExpanded = false;
    let isDragging = false;
    let isHalfHidden = true;
    let currentY = 200;
    let dragStartY = 0;
    let dragStartTop = 0;

    /**
     * 获取当前页面 ID。
     *
     * 这是悬浮 AI 助手判断“我现在服务的是哪一个页面块”的入口。
     * 后面的“当前页面”展示、推荐工具列表、AI 对话快捷跳转，都会先依赖这里的识别结果。
     *
     * 识别规则：
     * - 找当前页面上带 `.page.active` 的主内容容器；
     * - 它的 DOM id 一般形如 `page-credentials` / `page-ai-chat`；
     * - 这里会把前缀 `page-` 去掉，得到真正的 pageId。
     *
     * 排查建议：
     * - 面板里“当前页面”名称不对时，先看页面切换后是否正确维护了 `.page.active`；
     * - 如果当前没有任何活动页，这里会回退到 `credentials`，避免悬浮入口完全失效。
     */
    function getCurrentPageId() {
        const activePage = document.querySelector('.page.active');
        if (activePage) {
            return activePage.id.replace('page-', '');
        }
        return 'credentials';
    }

    /**
     * 根据当前页面上下文生成“推荐工具”列表。
     *
     * 面板中间那块“推荐工具”区域，就是由这个函数决定内容的。
     * 它会优先推荐：
     * 1) 与当前页面强相关的工具；
     * 2) 同一类别下的其它工具；
     * 3) 一个固定保底入口：AI 对话。
     *
     * 这样做的目的，是让用户在不同页面里点开悬浮助手时，
     * 能看到更贴近当前工作场景的按钮，而不是一份完全固定的菜单。
     *
     * 排查建议：
     * - 推荐列表不准、总跳错方向：先看 TOOL_METADATA 里的 related / category 是否配置正确；
     * - 当前页面查不到映射时，会走默认热门工具兜底分支。
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
     * 创建悬浮入口的整套 DOM 结构。
     *
     * 这里一次性生成两个视觉块：
     * - 左侧/贴边的小圆角主按钮：用户平时主要看到并拖动它；
     * - 右侧展开后的面板：展示“当前页面”“推荐工具”“打开 AI 对话”按钮。
     *
     * 面板内部又分为 4 个区域：
     * 1) panel-header：标题 + 关闭按钮；
     * 2) panel-context：当前页面名称；
     * 3) panel-recommendations：推荐工具列表；
     * 4) panel-actions：底部快捷动作按钮。
     *
     * 如果页面上完全没有看到悬浮按钮，除了 init() 没跑到，也要检查这里创建的 DOM 是否被成功 append 到 body。
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

        // 面板主体：
        // - panel-header：标题栏与关闭按钮
        // - panel-context：当前页面识别结果
        // - panel-recommendations：推荐工具点击列表
        // - panel-actions：底部快捷动作（当前是“打开 AI 对话”）
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
     * 刷新展开面板里的动态内容。
     *
     * 这个函数只负责“把数据灌进面板”，不负责创建面板。
     * 它会同步更新两块可见内容：
     * - “当前页面”这一行；
     * - “推荐工具”这一整块可点击列表。
     *
     * 推荐列表里的每一行都是一个可点击按钮块：
     * - 左侧图标来自分类；
     * - 中间显示工具名称和推荐原因；
     * - 点击后会切到对应页面，并自动收起面板。
     *
     * 排查建议：
     * - 面板展开了但内容是空的：先看 currentPageId 是否识别成功、recommendations 是否有数据；
     * - 推荐项点了没跳页：再看 window.switchPage 是否已由 app_core.js 暴露。
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
            // 推荐区的每一项都渲染成一整行可点击块，方便外行用户直接把它理解成“快捷跳转按钮”。
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
     * 展开右侧面板。
     *
     * 用户能看到的变化是：
     * - 悬浮按钮从半隐藏状态完整露出；
     * - 右侧推荐面板显示；
     * - 面板内容在展开瞬间刷新，保证“当前页面”和推荐项是最新的。
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
     * 收起右侧面板，并在短暂延迟后恢复贴边半隐藏效果。
     *
     * 这里有一个 300ms 的延迟，
     * 是为了给 CSS 过渡留时间，避免面板刚收起时视觉上太突兀。
     * 如果当前又马上被重新展开，延迟逻辑会通过 `isExpanded` 判断避免误恢复半隐藏。
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
     * 在“展开”和“收起”之间切换。
     *
     * 主按钮点击、展开指示器点击，本质上都会走到这里，
     * 所以它相当于悬浮助手最核心的开关入口。
     */
    function toggle() {
        if (isExpanded) {
            collapse();
        } else {
            expand();
        }
    }

    /**
     * 给悬浮按钮绑定拖动逻辑。
     *
     * 用户平时看到的行为是：
     * - 按住主按钮主体可以上下拖动；
     * - 点击小箭头只负责展开/收起，不参与拖动；
     * - 释放鼠标后，会把新的纵向位置写入 localStorage，刷新后还能记住。
     *
     * 位置限制：
     * - 顶部至少保留 50px；
     * - 底部至少保留约 100px；
     * 这样做是为了避免按钮被拖出可视区域。
     *
     * 排查建议：
     * - 按钮拖不动：先看 mousedown / mousemove / mouseup 是否被正常绑定；
     * - 拖完刷新又回到原位：看 localStorage 的 `ai_helper_y` 是否写入成功。
     */
    function initDrag(container) {
        const button = container.querySelector('.ai-helper-btn');

        button.addEventListener('mousedown', (e) => {
            // 点击展开箭头时不进入拖动模式，避免“想展开结果变成拖动”。
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

            // 只允许在可视区内上下移动，避免把按钮拖到屏幕外找不到。
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
     * 绑定悬浮助手涉及的全部交互事件。
     *
     * 这里集中处理 6 类交互：
     * 1) 展开指示器点击；
     * 2) 主按钮点击；
     * 3) 面板右上角关闭按钮；
     * 4) “打开 AI 对话”快捷按钮；
     * 5) 鼠标移入/移出时的半隐藏切换；
     * 6) 页面切换后的面板内容刷新。
     *
     * 如果用户反馈“某个按钮点了没反应”，通常第一站就该从这里开始看。
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
     * 初始化全局悬浮 AI 助手。
     *
     * 这是整个文件的启动入口，负责把前面定义好的 DOM、拖拽、点击行为真正挂到页面上。
     * 启动顺序是：
     * 1) 避免重复创建同一个悬浮助手；
     * 2) 创建 DOM 并挂到 body；
     * 3) 恢复上一次保存的位置；
     * 4) 绑定拖动逻辑；
     * 5) 绑定各种点击/悬浮/切页事件。
     *
     * 排查建议：
     * - 页面完全没有悬浮助手：先确认 init() 是否执行，以及 body 是否可用；
     * - 按钮位置异常：再看 localStorage 里的 `ai_helper_y` 是否是异常值。
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
