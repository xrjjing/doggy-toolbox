/**
 * 文件总览：AI 聊天页核心前端逻辑。
 *
 * 服务页面：web/pages/ai-chat.html。
 * 主要职责：
 * - 初始化聊天页、历史侧栏、设置抽屉、模板与快捷命令相关交互；
 * - 调用 window.pywebview.api.ai_chat_stream() 发起流式会话；
 * - 通过 get_chat_chunk(session_id) 轮询增量内容，并把结果渲染回消息区；
 * - 维护 provider 选择、搜索开关、思考模式、历史会话与工具推荐卡片。
 *
 * 调用链：页面按钮/输入框 -> 本文件 -> pywebview API -> api.py -> AIManager / ChatHistoryService / WebSearch。
 *
 * 排查建议：
 * - 点击发送后完全无响应：先看 sendMessage()、getPywebviewApi()；
 * - 有 session_id 但消息不增长：看 startPolling() 和 get_chat_chunk() 轮询链；
 * - 历史会话/Provider 切换异常：看 loadSavedConversations()、selectChatProvider()。
 */

// 页面级状态：这组变量描述当前会话、轮询状态和开关选项，是排查聊天页行为的第一入口。
let chatHistory = []; // 当前对话的消息历史
let currentSessionId = null; // 当前流式会话 ID（临时，用于轮询）
let currentConversationId = null; // 当前持久化会话 ID
let pollingInterval = null; // 轮询定时器
let chatMode = 'chat'; // 对话模式：'chat' 普通对话, 'explain' 解释模式
let savedConversations = []; // 保存的会话列表
let webSearchEnabled = false; // 网络搜索开关
let thinkingEnabled = false; // 思考模式开关

/**
 * 获取 PyWebView API（带检查）
 */
function getPywebviewApi() {
    return (window.pywebview && window.pywebview.api) ? window.pywebview.api : null;
}

/**
 * 初始化 AI 聊天页面。
 *
 * 这是聊天页的总入口：会串起抽屉、Provider、历史会话、输入框事件和欢迎态渲染。
 * 如果页面第一次打开就异常，优先从这里往下追。
 */
async function initAIChatPage() {
    console.log('[AI Chat] 初始化 AI 聊天页面');

    // 等待两帧确保样式已解析（Double RAF 模式）
    // 单个 RAF 往往在 CSSOM 更新前执行，需要完整的渲染周期
    await new Promise(resolve => {
        requestAnimationFrame(() => {
            requestAnimationFrame(resolve);
        });
    });

    const sendBtn = document.getElementById('send-btn');
    const chatInput = document.getElementById('chat-input');
    const messagesContainer = document.getElementById('chat-messages');
    const settingsDrawer = document.getElementById('ai-settings-drawer-content');

    if (!sendBtn || !chatInput || !messagesContainer) {
        console.error('[AI Chat] 关键 DOM 元素未找到');
        return;
    }

    // 清空示例消息
    messagesContainer.innerHTML = '';

    // 加载 AI 设置页面到抽屉
    if (settingsDrawer) {
        loadSettingsDrawer(settingsDrawer);
    }

    // 移除旧的事件监听器（避免重复绑定）
    const newSendBtn = sendBtn.cloneNode(true);
    sendBtn.parentNode.replaceChild(newSendBtn, sendBtn);

    const newChatInput = chatInput.cloneNode(true);
    chatInput.parentNode.replaceChild(newChatInput, chatInput);

    // 重新获取元素引用
    const finalSendBtn = document.getElementById('send-btn');
    const finalChatInput = document.getElementById('chat-input');

    // 绑定事件
    finalSendBtn.addEventListener('click', sendMessage);
    finalChatInput.addEventListener('keydown', handleInputKeydown);
    finalChatInput.addEventListener('input', adjustTextareaHeight);

    // 初始化
    adjustTextareaHeight();

    // 显示欢迎消息
    addWelcomeMessage();

    // 初始化解释模式按钮
    initExplainModeButton();

    // 初始化快捷命令
    initSlashCommands();

    // 加载会话列表
    loadSavedConversations();

    console.log('[AI Chat] 初始化完成，事件已绑定');
}

/**
 * 渲染聊天页右侧 Provider 抽屉。
 *
 * 页面位置：聊天页右上角设置弹窗中的抽屉区域。
 * 负责内容：Provider 分类页签、Provider 列表、关闭按钮、跳转完整配置页按钮。
 * 这个抽屉不是完整的 AI 设置页，而是聊天页里的“快速切换 Provider”轻量入口。
 * 如果用户反馈“聊天页抽屉能打开但列表空白 / 切换不了 Provider”，优先继续看
 * loadDrawerProviders() 和 selectChatProvider()。
 */
function loadSettingsDrawer(drawerElement) {
    if (!drawerElement) return;

    drawerElement.innerHTML = `
        <div class="chat-settings-drawer">
            <div class="drawer-header">
                <h3>切换 AI Provider</h3>
                <button class="drawer-close-btn" onclick="closeAIChatSettings()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div class="drawer-body">
                <div class="provider-category-tabs">
                    <button class="provider-tab active" data-category="openai" onclick="switchDrawerCategory('openai')">OpenAI</button>
                    <button class="provider-tab" data-category="claude" onclick="switchDrawerCategory('claude')">Claude</button>
                </div>
                <div id="chat-provider-list" class="chat-provider-list">
                    <div class="provider-loading">加载中...</div>
                </div>
            </div>
            <div class="drawer-footer">
                <button class="ai-btn ai-btn-ghost btn-sm" onclick="goToAISettings()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    管理 Provider
                </button>
            </div>
        </div>
    `;

    // 加载 Provider 列表
    loadDrawerProviders();
}

// 抽屉当前分类
let drawerCategory = 'openai';

/**
 * 切换抽屉分类
 */
function switchDrawerCategory(category) {
    drawerCategory = category;
    document.querySelectorAll('.provider-category-tabs .provider-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.category === category);
    });
    loadDrawerProviders();
}

/**
 * 读取抽屉里的 Provider 列表。
 *
 * 页面位置：抽屉正文里的 Provider 列表区域。
 * 这里只取聊天页快速切换所需的数据，不处理复杂编辑逻辑；
 * 真正的编辑、测试连接、拉模型都在 app_ai_settings.js 中。
 */
async function loadDrawerProviders() {
    const container = document.getElementById('chat-provider-list');
    if (!container) return;

    const api = getPywebviewApi();
    if (!api || typeof api.get_ai_providers !== 'function') {
        container.innerHTML = '<div class="provider-empty">API 未就绪</div>';
        return;
    }

    try {
        const providers = await api.get_ai_providers();
        renderDrawerProviders(providers, container);
    } catch (error) {
        console.error('加载 Provider 列表失败:', error);
        container.innerHTML = '<div class="provider-empty">加载失败</div>';
    }
}

/**
 * 按当前分类渲染抽屉 Provider 列表。
 *
 * 页面位置：抽屉正文里的可点击 Provider 条目区。
 * 这里会先按 OpenAI / Claude 分类过滤，再输出成可点击列表项。
 * 如果某个 Provider 在 AI 设置页存在但这里没显示，通常先看分类过滤逻辑。
 */
function renderDrawerProviders(providers, container) {
    if (!providers || providers.length === 0) {
        container.innerHTML = '<div class="provider-empty">暂无 Provider 配置</div>';
        return;
    }

    const filtered = providers.filter(p => {
        if (drawerCategory === 'openai') {
            return p.type === 'openai' || p.type === 'openai-compatible';
        }
        return p.type === 'claude';
    });

    if (filtered.length === 0) {
        const name = drawerCategory === 'openai' ? 'OpenAI' : 'Claude';
        container.innerHTML = `<div class="provider-empty">暂无 ${name} Provider</div>`;
        return;
    }

    container.innerHTML = filtered.map(p => `
        <div class="chat-provider-item ${p.active ? 'active' : ''}" onclick="selectChatProvider('${p.id.replace(/'/g, "\\'")}', ${p.active})">
            <div class="provider-item-info">
                <span class="provider-item-name">${escapeHtmlChat(p.name)}</span>
                <span class="provider-item-type">${getProviderTypeLabelChat(p.type)}</span>
            </div>
        </div>
    `).join('');
}

/**
 * 在聊天页快速切换当前活跃 Provider。
 *
 * 触发按钮：抽屉列表中的 Provider 项。
 * 成功后这里只负责提示和刷新抽屉列表；
 * 真正的活跃 Provider 切换会落到 api.py -> AIManager。
 */
async function selectChatProvider(providerId, isActive) {
    if (isActive) return;

    const api = getPywebviewApi();
    if (!api || typeof api.switch_ai_provider !== 'function') {
        showToast('API 未就绪', 'error');
        return;
    }

    try {
        const result = await api.switch_ai_provider(providerId);
        if (result.success) {
            showToast('切换成功', 'success');
            loadDrawerProviders();
        } else {
            showToast(`切换失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('切换 Provider 失败:', error);
        showToast('切换失败', 'error');
    }
}

/**
 * 跳转到 AI 配置页面
 */
function goToAISettings() {
    closeAIChatSettings();
    if (typeof window.switchPage === 'function') {
        window.switchPage('ai-settings');
    }
}

/**
 * HTML 转义（聊天页面专用）
 */
function escapeHtmlChat(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
}

/**
 * Provider 类型标签（聊天页面专用）
 */
function getProviderTypeLabelChat(type) {
    const labels = {
        'openai': 'OpenAI 官方',
        'claude': 'Claude',
        'openai-compatible': '第三方兼容'
    };
    return labels[type] || type;
}

/**
 * 添加欢迎消息
 */
function addWelcomeMessage() {
    const welcomeText = "你好！我是 AI 助手，有什么可以帮你的吗？ ฅ'ω'ฅ";
    addMessage(welcomeText, 'ai', false);
}

/**
 * 清除对话
 */
function clearConversation() {
    const confirmed = window.confirm('确定要清除当前对话吗？此操作不可撤销。');
    if (!confirmed) return;

    // 停止轮询并重置会话
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
    currentSessionId = null;

    // 清空历史
    chatHistory = [];

    // 清空消息列表
    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) {
        messagesContainer.innerHTML = '';
    }

    // 恢复输入状态
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    if (chatInput) {
        chatInput.disabled = false;
        chatInput.value = '';
        adjustTextareaHeight();
    }
    if (sendBtn) {
        sendBtn.disabled = false;
    }

    // 重新添加欢迎消息
    addWelcomeMessage();
}

/**
 * 处理输入框键盘事件
 */
function handleInputKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

/**
 * 发送消息。
 *
 * 点击发送按钮或按下快捷键后，会先做输入校验，再准备历史消息、调用后端流式接口，最后进入轮询阶段。
 * 这是“用户动作真正进入后端”的关键起点。
 */
async function sendMessage() {
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const text = chatInput.value.trim();

    if (!text) return;

    // 禁用输入
    chatInput.disabled = true;
    sendBtn.disabled = true;

    // 添加用户消息到界面
    addMessage(text, 'user', false);

    // 添加到历史
    chatHistory.push({
        role: 'user',
        content: text
    });

    // 清空输入框
    chatInput.value = '';
    adjustTextareaHeight();

    try {
        const api = getPywebviewApi();
        if (!api || typeof api.ai_chat_stream !== 'function' || typeof api.get_chat_chunk !== 'function') {
            throw new Error('后端接口未就绪（pywebview.api.ai_chat_stream/get_chat_chunk 不可用）');
        }

        // 调用后端流式接口（传递模式、工具推荐开关、会话 ID、搜索和思考开关）
        const result = await api.ai_chat_stream(text, chatHistory.slice(0, -1), null, chatMode, true, currentConversationId, webSearchEnabled, thinkingEnabled);

        if (result.success) {
            currentSessionId = result.session_id;
            console.log('[AI Chat] 请求成功，session_id:', result.session_id);
            console.log('[AI Chat] search_results:', result.search_results);
            // 更新持久化会话 ID（首次发送消息时后端会创建新会话）
            if (result.conversation_id) {
                currentConversationId = result.conversation_id;
                // 刷新会话列表以显示新会话
                loadSavedConversations();
            }

            // 如果有工具推荐，先显示工具推荐卡片
            if (result.tool_recommendations && result.tool_recommendations.tools && result.tool_recommendations.tools.length > 0) {
                addToolRecommendationsCard(result.tool_recommendations.tools);
            }

            // 如果有搜索结果，显示搜索结果
            console.log('[AI Chat] 搜索结果:', result.search_results);
            if (result.search_results && result.search_results.length > 0) {
                addSearchResultsCard(result.search_results);
            }

            // 创建 AI 消息占位
            const aiMessageId = addMessage('', 'ai', true);
            startPolling(aiMessageId);
        } else {
            const aiMessageId = addMessage('', 'ai', false);
            updateMessage(aiMessageId, `❌ 错误：${result.error || '未知错误'}`, false);
            chatInput.disabled = false;
            sendBtn.disabled = false;
        }
    } catch (error) {
        console.error('[AI Chat] 发送消息失败:', error);
        const aiMessageId = addMessage('', 'ai', false);
        updateMessage(aiMessageId, `❌ 错误：${error.message}`, false);
        chatInput.disabled = false;
        sendBtn.disabled = false;
    }
}

/**
 * 在消息区插入“联网搜索结果”卡片。
 *
 * 页面位置：聊天消息流中，通常出现在 AI 回复之前。
 * 负责内容：搜索结果数量、可展开标题栏、每条结果的标题和摘要。
 * 这块是 sendMessage() 成功返回 search_results 后最先可见的辅助信息区。
 */
function addSearchResultsCard(searchResults) {
    console.log('[AI Chat] 添加搜索结果卡片:', searchResults.length, '条结果');
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) {
        console.error('[AI Chat] chat-messages 容器不存在');
        return;
    }
    const cardId = `search-${Date.now()}`;

    const card = document.createElement('div');
    card.className = 'search-results-card collapsed';
    card.id = cardId;

    const header = document.createElement('div');
    header.className = 'search-results-header';
    header.innerHTML = `
        <span class="search-icon">🔍</span>
        <span class="search-title">已搜索 ${searchResults.length} 条结果</span>
        <span class="search-toggle">▼</span>
    `;
    header.onclick = () => toggleSearchResults(cardId);

    const content = document.createElement('div');
    content.className = 'search-results-content';
    content.innerHTML = searchResults.map((r, i) => `
        <div class="search-result-item">
            <a href="${escapeHtml(r.url)}" target="_blank" class="search-result-title">${escapeHtml(r.title)}</a>
            <p class="search-result-snippet">${escapeHtml(r.snippet ? r.snippet.substring(0, 200) + '...' : '')}</p>
        </div>
    `).join('');

    card.appendChild(header);
    card.appendChild(content);
    messagesContainer.appendChild(card);

    scrollToBottom();
}

/**
 * 切换搜索结果展开/折叠
 */
function toggleSearchResults(cardId) {
    const card = document.getElementById(cardId);
    if (card) {
        card.classList.toggle('collapsed');
    }
}

/**
 * 在消息区插入“推荐工具”卡片。
 *
 * 页面位置：聊天消息流中，通常出现在 AI 正式回答之前。
 * 负责内容：推荐工具名称、推荐理由，以及点击后跳转工具页。
 * 如果用户说“AI 推荐了工具但点不进去”，优先看这里和 window.switchPage()。
 */
function addToolRecommendationsCard(tools) {
    if (!tools || tools.length === 0) return;

    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;

    const card = document.createElement('div');
    card.className = 'tool-recommend-card';

    const title = document.createElement('div');
    title.className = 'tool-recommend-title';
    title.innerHTML = '🛠️ 推荐工具';
    card.appendChild(title);

    const list = document.createElement('div');
    list.className = 'tool-recommend-list';

    tools.slice(0, 3).forEach(tool => {
        if (!tool || !tool.id) return;

        const item = document.createElement('div');
        item.className = 'tool-recommend-item';
        item.dataset.toolId = tool.id;

        const name = document.createElement('span');
        name.className = 'tool-recommend-name';
        name.textContent = tool.name || tool.id;
        item.appendChild(name);

        if (tool.reason) {
            const reason = document.createElement('span');
            reason.className = 'tool-recommend-reason';
            reason.textContent = tool.reason;
            item.appendChild(reason);
        }

        item.addEventListener('click', () => {
            if (typeof window.switchPage === 'function') {
                window.switchPage(tool.id);
            }
        });

        list.appendChild(item);
    });

    card.appendChild(list);
    messagesContainer.appendChild(card);
    scrollToBottom();
}

/**
 * 初始化解释模式按钮
 */
function initExplainModeButton() {
    const headerActions = document.querySelector('#page-ai-chat .chat-header-actions');
    if (!headerActions) return;

    // 检查是否已存在解释模式按钮
    if (document.getElementById('explain-mode-btn')) return;

    // 创建解释模式按钮
    const explainBtn = document.createElement('button');
    explainBtn.id = 'explain-mode-btn';
    explainBtn.className = 'ai-btn ai-btn-outline btn-sm';
    explainBtn.innerHTML = `
        <span class="btn-icon"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/><path d="M12 6a3.5 3.5 0 0 0-3.5 3.5 1 1 0 0 0 2 0A1.5 1.5 0 1 1 12 11a1 1 0 0 0-1 1v2a1 1 0 0 0 2 0v-1.16A3.49 3.49 0 0 0 12 6z"/><circle cx="12" cy="17" r="1"/></svg></span>
        <span class="btn-text">解释模式</span>
    `;
    explainBtn.title = '开启后，AI 将专注于解释代码和命令';
    explainBtn.addEventListener('click', toggleExplainMode);

    // 插入到清除对话按钮之前
    const clearBtn = headerActions.querySelector('button');
    if (clearBtn) {
        headerActions.insertBefore(explainBtn, clearBtn);
    } else {
        headerActions.appendChild(explainBtn);
    }

    // 更新按钮状态
    updateExplainModeUI();
}

/**
 * 切换解释模式
 */
function toggleExplainMode() {
    chatMode = chatMode === 'explain' ? 'chat' : 'explain';
    updateExplainModeUI();

    // 显示提示
    if (typeof showToast === 'function') {
        showToast(chatMode === 'explain' ? '已开启解释模式' : '已切换到普通对话', 'info');
    }
}

/**
 * 更新解释模式按钮 UI
 */
function updateExplainModeUI() {
    const explainBtn = document.getElementById('explain-mode-btn');
    if (!explainBtn) return;

    const btnText = explainBtn.querySelector('.btn-text');
    if (chatMode === 'explain') {
        explainBtn.classList.add('active');
        explainBtn.classList.remove('ai-btn-outline');
        explainBtn.classList.add('ai-btn-primary');
        if (btnText) btnText.textContent = '解释模式：开';
    } else {
        explainBtn.classList.remove('active');
        explainBtn.classList.remove('ai-btn-primary');
        explainBtn.classList.add('ai-btn-outline');
        if (btnText) btnText.textContent = '解释模式';
    }
}

/**
 * 轮询流式会话增量内容。
 *
 * 页面位置：用户发送后，对应 AI 消息气泡的持续更新链路。
 * 发送消息成功后，后端不会直接把流式内容推回前端，而是返回一个 session_id；
 * 前端随后每 100ms 调用 get_chat_chunk(session_id) 把新增文本拼回当前消息气泡。
 * 如果出现“有 session_id 但消息一直不刷新”，通常就是这一段链路要重点看。
 */
function startPolling(messageId) {
    let accumulatedText = '';

    pollingInterval = setInterval(async () => {
        try {
            const api = getPywebviewApi();
            if (!api || typeof api.get_chat_chunk !== 'function') {
                throw new Error('后端接口未就绪（pywebview.api.get_chat_chunk 不可用）');
            }
            const result = await api.get_chat_chunk(currentSessionId);

            if (result.success) {
                // 追加新的 chunks
                if (result.chunks && result.chunks.length > 0) {
                    for (const chunk of result.chunks) {
                        accumulatedText += chunk;
                    }
                    updateMessage(messageId, accumulatedText, true);
                }

                // 检查是否完成
                if (result.done) {
                    clearInterval(pollingInterval);
                    pollingInterval = null;
                    currentSessionId = null;

                    // 最终渲染 Markdown
                    updateMessage(messageId, accumulatedText, false);

                    // 添加到历史
                    chatHistory.push({
                        role: 'assistant',
                        content: accumulatedText
                    });

                    // 恢复输入
                    const chatInput = document.getElementById('chat-input');
                    const sendBtn = document.getElementById('send-btn');
                    chatInput.disabled = false;
                    sendBtn.disabled = false;
                    chatInput.focus();

                    // 处理错误
                    if (result.error) {
                        updateMessage(messageId, `${accumulatedText}\n\n❌ 错误：${result.error}`, false);
                    }
                }
            } else {
                // 轮询失败
                clearInterval(pollingInterval);
                pollingInterval = null;
                updateMessage(messageId, `❌ 错误：${result.error || '获取消息失败'}`, false);

                const chatInput = document.getElementById('chat-input');
                const sendBtn = document.getElementById('send-btn');
                chatInput.disabled = false;
                sendBtn.disabled = false;
            }
        } catch (error) {
            console.error('[AI Chat] 轮询失败:', error);
            clearInterval(pollingInterval);
            pollingInterval = null;
            updateMessage(messageId, `❌ 错误：${error.message}`, false);

            const chatInput = document.getElementById('chat-input');
            const sendBtn = document.getElementById('send-btn');
            chatInput.disabled = false;
            sendBtn.disabled = false;
        }
    }, 100); // 每 100ms 轮询一次
}

/**
 * 格式化消息时间戳（完整年月日时分秒）
 */
function formatMessageTime(date) {
    const pad = n => String(n).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 在消息区创建一条新的消息气泡。
 *
 * 页面位置：聊天主区域的消息流。
 * 这个函数只负责“建 DOM 和插入列表”，不会决定内容是否继续增长；
 * 流式场景下先创建占位气泡，后续由 updateMessage() 持续更新；
 * 时间戳也在这里一次性挂到气泡底部。
 */
function addMessage(content, sender, isStreaming, timestamp = null) {
    const messagesContainer = document.getElementById('chat-messages');
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${sender}-message`;
    bubble.id = messageId;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (isStreaming) {
        contentDiv.innerHTML = '<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span>';
    } else {
        contentDiv.innerHTML = renderMarkdown(content);
    }

    // 添加时间戳
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time';
    const msgTime = timestamp ? new Date(timestamp) : new Date();
    timeDiv.textContent = formatMessageTime(msgTime);

    bubble.appendChild(contentDiv);
    bubble.appendChild(timeDiv);
    messagesContainer.appendChild(bubble);

    scrollToBottom();

    return messageId;
}

/**
 * 更新一条已存在的消息气泡。
 *
 * 页面位置：聊天主区域里已经插入过的消息气泡。
 * - streaming=true：按纯文本方式持续追加，并显示光标；
 * - streaming=false：把最终文本按 Markdown 重渲染，并补代码高亮。
 */
function updateMessage(messageId, content, isStreaming) {
    const messageElement = document.getElementById(messageId);
    if (!messageElement) return;

    const contentDiv = messageElement.querySelector('.message-content');
    if (!contentDiv) return;

    if (isStreaming) {
        // 流式输出：显示原始文本 + 光标
        contentDiv.textContent = content;
        contentDiv.innerHTML += '<span class="cursor">▋</span>';
    } else {
        // 完成：渲染 Markdown
        contentDiv.innerHTML = renderMarkdown(content);
        highlightCode(contentDiv);
    }

    scrollToBottom();
}

/**
 * 渲染 Markdown（简化版）
 * TODO: 使用 marked.js 和 highlight.js
 */
function renderMarkdown(text) {
    if (!text) return '';

    let html = text;

    // 代码块 ```language\ncode\n```
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        const language = lang || 'plaintext';
        const escapedCode = escapeHtml(code.trim());
        return `<pre><code class="language-${language}">${escapedCode}</code></pre>`;
    });

    // 行内代码 `code`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 粗体 **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // 斜体 *text*
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // 链接 [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // 段落（换行符转 <br>）
    html = html.replace(/\n/g, '<br>');

    return html;
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 代码高亮（占位，未来可集成 highlight.js）
 */
function highlightCode(element) {
    // TODO: 集成 highlight.js
    // 目前不做处理
}

/**
 * 滚动到底部
 */
function scrollToBottom() {
    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

/**
 * 调整输入框高度
 */
function adjustTextareaHeight() {
    const chatInput = document.getElementById('chat-input');
    if (!chatInput) return;

    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
}

/**
 * 打开 AI 设置抽屉
 */
function openAIChatSettings() {
    const modal = document.getElementById('ai-chat-settings-modal');
    if (modal) {
        modal.style.display = 'flex';
        // 注意：这里不调用 initAiSettingsPage，因为抽屉内容是简化版
        // 简化版只显示跳转按钮，不需要加载 Provider 列表
    }
}

/**
 * 关闭 AI 设置抽屉
 */
function closeAIChatSettings() {
    const modal = document.getElementById('ai-chat-settings-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 添加加载动画样式
const style = document.createElement('style');
style.textContent = `
.loading-dots {
    display: inline-flex;
    gap: 4px;
}

.loading-dots span {
    animation: blink 1.4s infinite;
}

.loading-dots span:nth-child(2) {
    animation-delay: 0.2s;
}

.loading-dots span:nth-child(3) {
    animation-delay: 0.4s;
}

@keyframes blink {
    0%, 80%, 100% { opacity: 0; }
    40% { opacity: 1; }
}

.cursor {
    display: inline-block;
    width: 2px;
    height: 1em;
    background: currentColor;
    margin-left: 2px;
    animation: blink-cursor 1s infinite;
}

@keyframes blink-cursor {
    0%, 49% { opacity: 1; }
    50%, 100% { opacity: 0; }
}

.message-content code {
    background: rgba(0, 0, 0, 0.1);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: "SF Mono", Monaco, Consolas, monospace;
    font-size: 0.9em;
}

.message-content pre {
    margin: 12px 0;
    padding: 14px;
    border-radius: 8px;
    background: var(--bg-input);
    border: 1px solid var(--border-light);
    overflow-x: auto;
}

.message-content pre code {
    background: none;
    padding: 0;
    font-size: 13px;
    line-height: 1.5;
    white-space: pre;
}

.message-content a {
    color: var(--accent);
    text-decoration: none;
}

.message-content a:hover {
    text-decoration: underline;
}

/* 搜索结果卡片样式：由 addSearchResultsCard() 动态插入，对应聊天中的“联网搜索补充信息”卡片。 */
.search-results-card {
    max-width: 80%;
    align-self: flex-start;
    margin-bottom: 8px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg-card);
    overflow: hidden;
    transition: all 0.2s ease;
}

.search-results-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    cursor: pointer;
    user-select: none;
    background: var(--bg-secondary);
    transition: background 0.2s;
}

.search-results-header:hover {
    background: var(--bg-tertiary);
}

.search-icon {
    font-size: 14px;
}

.search-title {
    flex: 1;
    font-size: 13px;
    color: var(--text-secondary);
}

.search-toggle {
    font-size: 10px;
    color: var(--text-secondary);
    transition: transform 0.2s;
}

.search-results-card.collapsed .search-toggle {
    transform: rotate(-90deg);
}

.search-results-content {
    padding: 12px 14px;
    max-height: 400px;
    overflow-y: auto;
    overflow-x: hidden;
}

.search-results-card.collapsed .search-results-content {
    max-height: 0;
    padding: 0 14px;
    overflow: hidden;
}

.search-result-item {
    padding: 8px 0;
    border-bottom: 1px solid var(--border-light);
}

.search-result-item:last-child {
    border-bottom: none;
}

.search-result-title {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--accent);
    text-decoration: none;
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.search-result-title:hover {
    text-decoration: underline;
}

.search-result-snippet {
    font-size: 12px;
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

/* 工具推荐卡片样式：由 addToolRecommendationsCard() 动态插入，对应聊天模式下的工具推荐区。 */
.tool-recommend-card {
    max-width: 80%;
    align-self: flex-start;
    margin-bottom: 8px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg-card);
    padding: 12px 14px;
}

.tool-recommend-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 10px;
}

.tool-recommend-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.tool-recommend-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border: 1px solid var(--border-light);
    border-radius: 8px;
    background: var(--bg-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
}

.tool-recommend-item:hover {
    border-color: var(--accent);
    background: var(--bg-tertiary);
}

.tool-recommend-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--accent);
}

.tool-recommend-reason {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.4;
}
`;
document.head.appendChild(style);

/**
 * 从后端加载历史会话列表。
 *
 * 页面位置：聊天页左侧“历史会话”栏。
 * 这里只更新左侧会话目录，不会自动切换当前会话；
 * 如果聊天页左侧完全空白或新会话创建后不刷新，优先看这里和 renderConversationList()。
 */
async function loadSavedConversations() {
    const api = getPywebviewApi();
    if (!api || typeof api.list_chat_sessions !== 'function') {
        console.warn('[AI Chat] 会话历史功能不可用');
        return;
    }

    try {
        const result = await api.list_chat_sessions();
        if (result.success) {
            savedConversations = result.sessions || [];
            renderConversationList();
        } else {
            console.error('[AI Chat] 加载会话列表失败:', result.error);
        }
    } catch (error) {
        console.error('[AI Chat] 加载会话列表异常:', error);
    }
}

/**
 * 渲染左侧历史会话列表。
 *
 * 页面位置：聊天页左侧侧栏。
 * 这里会同时处理：
 * - 关键字过滤；
 * - 当前会话高亮；
 * - 重命名 / 导出 / 删除按钮渲染。
 */
function renderConversationList(filterText = '') {
    const listContainer = document.getElementById('chat-history-list');
    if (!listContainer) return;

    const filtered = filterText
        ? savedConversations.filter(c => (c.title || '').toLowerCase().includes(filterText.toLowerCase()))
        : savedConversations;

    if (filtered.length === 0) {
        listContainer.innerHTML = `
            <div class="chat-history-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <p>${filterText ? '未找到匹配的对话' : '暂无历史对话'}</p>
            </div>
        `;
        return;
    }

    listContainer.innerHTML = filtered.map(conv => {
        const isActive = conv.id === currentConversationId;
        const title = conv.title || '未命名对话';

        return `
            <div class="history-item ${isActive ? 'active' : ''}" data-id="${conv.id}" onclick="switchConversation('${conv.id}')">
                <div class="history-item-content">
                    <div class="history-title">${escapeHtml(title)}</div>
                </div>
                <div class="history-actions">
                    <button class="history-action-btn" onclick="event.stopPropagation(); renameConversation('${conv.id}')" title="重命名">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="history-action-btn" onclick="event.stopPropagation(); exportConversation('${conv.id}')" title="导出">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </button>
                    <button class="history-action-btn delete" onclick="event.stopPropagation(); deleteConversation('${conv.id}')" title="删除">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * 格式化时间
 */
function formatTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 7) return `${days} 天前`;
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

/**
 * 重置当前聊天页，进入“新会话”状态。
 *
 * 页面触发：左侧新建会话按钮、/new 快捷命令，或删除当前会话后的回退流程。
 * 负责内容：停止轮询、清空消息区、重置当前 conversation/session、恢复输入框可用状态。
 */
function startNewChat() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
    currentSessionId = null;
    currentConversationId = null;
    chatHistory = [];

    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) {
        messagesContainer.innerHTML = '';
    }

    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    if (chatInput) {
        chatInput.disabled = false;
        chatInput.value = '';
        adjustTextareaHeight();
        chatInput.focus();
    }
    if (sendBtn) {
        sendBtn.disabled = false;
    }

    addWelcomeMessage();
    renderConversationList();

    if (window.innerWidth <= 768) {
        toggleChatSidebar(false);
    }
}

/**
 * 切换到已有会话并重建消息区。
 *
 * 页面触发：左侧历史会话条目点击。
 * 这是历史侧栏最关键的动作：
 * - 先停止当前轮询；
 * - 再从后端拉指定 conversation 的历史消息；
 * - 然后重建 chatHistory 和消息 DOM。
 */
async function switchConversation(conversationId) {
    const api = getPywebviewApi();
    if (!api || typeof api.get_chat_messages !== 'function') return;

    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }

    currentConversationId = conversationId;
    currentSessionId = null;
    chatHistory = [];

    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) {
        messagesContainer.innerHTML = '';
    }

    try {
        const result = await api.get_chat_messages(conversationId);
        if (result.success) {
            const messages = result.messages || [];
            messages.forEach(msg => {
                const sender = msg.role === 'user' ? 'user' : 'ai';
                addMessage(msg.content, sender, false, msg.created_at);
                chatHistory.push({
                    role: msg.role,
                    content: msg.content
                });
            });
        }
    } catch (error) {
        console.error('[AI Chat] 加载会话消息失败:', error);
    }

    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    if (chatInput) {
        chatInput.disabled = false;
        chatInput.focus();
    }
    if (sendBtn) {
        sendBtn.disabled = false;
    }

    renderConversationList();

    if (window.innerWidth <= 768) {
        toggleChatSidebar(false);
    }
}

/**
 * 过滤会话历史
 */
function filterChatHistory(keyword) {
    renderConversationList(keyword);
}

/**
 * 切换侧边栏显示
 */
function toggleChatSidebar(show) {
    const sidebar = document.getElementById('ai-chat-sidebar');
    const overlay = document.getElementById('ai-chat-sidebar-overlay');

    if (!sidebar) return;

    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        if (show === undefined) {
            show = !sidebar.classList.contains('open');
        }
        if (show) {
            sidebar.classList.add('open');
            overlay.classList.add('open');
        } else {
            sidebar.classList.remove('open');
            overlay.classList.remove('open');
        }
    } else {
        if (show === undefined) {
            show = sidebar.classList.contains('collapsed');
        }
        if (show) {
            sidebar.classList.remove('collapsed');
        } else {
            sidebar.classList.add('collapsed');
        }
    }
}

/**
 * 重命名会话
 */
async function renameConversation(conversationId) {
    const conv = savedConversations.find(c => c.id === conversationId);
    if (!conv) return;

    const newTitle = window.prompt('请输入新的对话标题：', conv.title || '');
    if (!newTitle || newTitle === conv.title) return;

    const api = getPywebviewApi();
    if (!api || typeof api.rename_chat_session !== 'function') return;

    try {
        const result = await api.rename_chat_session(conversationId, newTitle);
        if (result.success) {
            conv.title = newTitle;
            renderConversationList();
            if (typeof showToast === 'function') {
                showToast('重命名成功', 'success');
            }
        } else {
            if (typeof showToast === 'function') {
                showToast('重命名失败', 'error');
            }
        }
    } catch (error) {
        console.error('[AI Chat] 重命名会话失败:', error);
        if (typeof showToast === 'function') {
            showToast('重命名失败', 'error');
        }
    }
}

/**
 * 删除会话
 */
async function deleteConversation(conversationId) {
    const conv = savedConversations.find(c => c.id === conversationId);
    if (!conv) return;

    const confirmed = window.confirm(`确定要删除对话"${conv.title || '未命名对话'}"吗？此操作不可撤销。`);
    if (!confirmed) return;

    const api = getPywebviewApi();
    if (!api || typeof api.delete_chat_session !== 'function') return;

    try {
        const result = await api.delete_chat_session(conversationId);
        if (result.success) {
            savedConversations = savedConversations.filter(c => c.id !== conversationId);
            renderConversationList();

            if (currentConversationId === conversationId) {
                startNewChat();
            }

            if (typeof showToast === 'function') {
                showToast('删除成功', 'success');
            }
        } else {
            if (typeof showToast === 'function') {
                showToast('删除失败', 'error');
            }
        }
    } catch (error) {
        console.error('[AI Chat] 删除会话失败:', error);
        if (typeof showToast === 'function') {
            showToast('删除失败', 'error');
        }
    }
}

/**
 * 导出会话为 Markdown
 */
async function exportConversation(conversationId) {
    const api = getPywebviewApi();
    if (!api || typeof api.export_chat_session_markdown !== 'function') return;

    try {
        const result = await api.export_chat_session_markdown(conversationId);
        if (result.success) {
            const conv = savedConversations.find(c => c.id === conversationId);
            const filename = `${conv?.title || '对话记录'}.md`;

            if (typeof api.save_file_dialog === 'function') {
                await api.save_file_dialog(result.content, filename, [['Markdown 文件', '*.md']]);
            }
        } else {
            if (typeof showToast === 'function') {
                showToast('导出失败', 'error');
            }
        }
    } catch (error) {
        console.error('[AI Chat] 导出会话失败:', error);
        if (typeof showToast === 'function') {
            showToast('导出失败', 'error');
        }
    }
}

// ========== Prompt 模板集成 ==========

let chatTemplatesCache = [];
let chatTemplatesFilterKeyword = '';

/**
 * 打开 Prompt 模板选择器。
 *
 * 页面位置：聊天输入框上方或 /tpl 快捷命令触发的模板弹窗。
 * 这里会先拉取模板列表，再弹出模板选择弹窗；
 * 模板变量的收集与真正应用分别在 selectChatTemplate() / applyChatTemplate() 里完成。
 */
async function showChatTemplateSelector() {
    const api = getPywebviewApi();
    if (!api) return;

    const modal = document.getElementById('chat-template-modal');
    if (!modal) return;

    // 加载模板列表
    const result = await api.list_prompt_templates(null, null, false);
    if (result.success) {
        chatTemplatesCache = result.templates || [];
    } else {
        chatTemplatesCache = [];
    }

    chatTemplatesFilterKeyword = '';
    document.getElementById('chat-template-search').value = '';
    renderChatTemplateList();
    modal.style.display = 'flex';
}

/**
 * 关闭模板选择器
 */
function closeChatTemplateSelector() {
    const modal = document.getElementById('chat-template-modal');
    if (modal) modal.style.display = 'none';
}

/**
 * 筛选模板
 */
function filterChatTemplates(keyword) {
    chatTemplatesFilterKeyword = keyword.toLowerCase();
    renderChatTemplateList();
}

/**
 * 渲染模板弹窗中的模板列表。
 *
 * 页面位置：模板选择弹窗主体。
 * 会同时处理关键字过滤、收藏优先排序和空状态展示，
 * 是模板弹窗“看起来对不对”的核心渲染函数。
 */
function renderChatTemplateList() {
    const listEl = document.getElementById('chat-template-list');
    if (!listEl) return;

    let templates = chatTemplatesCache;

    // 筛选
    if (chatTemplatesFilterKeyword) {
        templates = templates.filter(t =>
            t.title.toLowerCase().includes(chatTemplatesFilterKeyword) ||
            t.content.toLowerCase().includes(chatTemplatesFilterKeyword)
        );
    }

    // 收藏优先排序
    templates.sort((a, b) => {
        if (a.is_favorite && !b.is_favorite) return -1;
        if (!a.is_favorite && b.is_favorite) return 1;
        return 0;
    });

    if (templates.length === 0) {
        listEl.innerHTML = `
            <div class="chat-template-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
                <p>${chatTemplatesFilterKeyword ? '未找到匹配的模板' : '暂无模板，请先创建'}</p>
            </div>
        `;
        return;
    }

    let html = '';
    templates.forEach(t => {
        const preview = t.content.length > 100 ? t.content.substring(0, 100) + '...' : t.content;
        html += `
            <div class="chat-template-item ${t.is_favorite ? 'favorite' : ''}" onclick="selectChatTemplate('${t.id}')">
                <div class="chat-template-item-header">
                    <span class="chat-template-item-title">${escapeHtml(t.title)}</span>
                    ${t.is_favorite ? '<span class="chat-template-item-star">⭐</span>' : ''}
                </div>
                <div class="chat-template-item-preview">${escapeHtml(preview)}</div>
            </div>
        `;
    });

    listEl.innerHTML = html;
}

/**
 * 选择模板
 */
async function selectChatTemplate(templateId) {
    const api = getPywebviewApi();
    if (!api) return;

    const template = chatTemplatesCache.find(t => t.id === templateId);
    if (!template) return;

    // 解析变量
    const result = await api.parse_prompt_variables(template.content);
    const variables = result.success ? result.variables : [];

    closeChatTemplateSelector();

    if (variables.length > 0) {
        // 有变量，显示变量填充弹窗
        showChatTemplateVarsModal(templateId, variables);
    } else {
        // 无变量，直接应用
        applyChatTemplateContent(template.content, templateId);
    }
}

/**
 * 打开模板变量填写弹窗。
 *
 * 页面位置：模板弹窗之后的第二层变量输入对话框。
 * 负责内容：根据模板中解析出的变量列表动态生成输入框。
 * 如果模板明明有 {{变量}} 占位符但弹窗没有输入项，优先看 selectChatTemplate() 的变量解析结果和这里。
 */
function showChatTemplateVarsModal(templateId, variables) {
    document.getElementById('chat-use-template-id').value = templateId;

    const formEl = document.getElementById('chat-template-vars-form');
    let html = '';

    variables.forEach(v => {
        html += `
            <div class="form-group">
                <label>${escapeHtml(v.name)}</label>
                <input type="text" id="chat-var-${v.name}" placeholder="请输入 ${v.name}">
            </div>
        `;
    });

    formEl.innerHTML = html;
    document.getElementById('chat-template-vars-modal').style.display = 'flex';
}

/**
 * 关闭变量填充弹窗
 */
function closeChatTemplateVarsModal() {
    document.getElementById('chat-template-vars-modal').style.display = 'none';
}

/**
 * 提交模板变量并向后端换取最终文本。
 *
 * 页面触发：变量填写弹窗中的“应用/确定”按钮。
 * 这里会收集所有变量值，调用后端展开模板，再把最终内容交给 applyChatTemplateContent()。
 */
async function applyChatTemplate() {
    const api = getPywebviewApi();
    if (!api) return;

    const templateId = document.getElementById('chat-use-template-id').value;

    // 收集变量值
    const values = {};
    const inputs = document.querySelectorAll('#chat-template-vars-form input');
    inputs.forEach(input => {
        const varName = input.id.replace('chat-var-', '');
        values[varName] = input.value;
    });

    const result = await api.use_prompt_template(templateId, values);
    if (result.success) {
        closeChatTemplateVarsModal();
        applyChatTemplateContent(result.content, templateId);
    } else {
        if (typeof showToast === 'function') {
            showToast(result.error || '应用失败', 'error');
        }
    }
}

/**
 * 把模板最终内容回填到聊天输入框。
 *
 * 页面位置：聊天输入框区域。
 * 无论模板是否经过变量替换，最终都会落到这里；
 * 这里只负责“写回输入框并聚焦”，不会自动发送消息。
 */
function applyChatTemplateContent(content, templateId) {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.value = content;
        chatInput.focus();
        // 自动调整高度
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 180) + 'px';

        if (typeof showToast === 'function') {
            showToast('模板已应用', 'success');
        }
    }
}

// ========== 快捷命令功能 ==========

// 快捷命令定义
const SLASH_COMMANDS = [
    { cmd: '/tpl', icon: '📝', name: '选择模板', desc: '打开 Prompt 模板选择器', action: () => showChatTemplateSelector() },
    { cmd: '/new', icon: '➕', name: '新会话', desc: '创建新的对话会话', action: () => startNewChat() },
    { cmd: '/clear', icon: '🗑️', name: '清空消息', desc: '清空当前会话的所有消息', action: () => clearCurrentChat() },
    { cmd: '/export', icon: '📤', name: '导出会话', desc: '导出当前会话为 Markdown', action: () => exportCurrentChat() },
    { cmd: '/settings', icon: '⚙️', name: '打开设置', desc: '打开 AI 配置设置', action: () => openAIChatSettings() },
    { cmd: '/help', icon: '❓', name: '帮助', desc: '查看所有快捷命令', action: () => showSlashCommandHelp() },
];

let slashCommandActiveIndex = 0;
let slashCommandFiltered = [];

/**
 * 初始化聊天输入框的 / 命令能力。
 *
 * 页面位置：聊天输入框及其下方的命令建议弹窗。
 * 这是聊天页的增强交互层：
 * - 输入 / 时弹出命令菜单；
 * - 键盘上下切换；
 * - 回车/Tab 执行；
 * - 点击外部关闭。
 */
function initSlashCommands() {
    const chatInput = document.getElementById('chat-input');
    if (!chatInput) return;

    chatInput.addEventListener('input', handleSlashCommandInput);
    chatInput.addEventListener('keydown', handleSlashCommandKeydown);

    // 点击外部关闭
    document.addEventListener('click', (e) => {
        const popup = document.getElementById('slash-command-popup');
        if (popup && !popup.contains(e.target) && e.target.id !== 'chat-input') {
            hideSlashCommandPopup();
        }
    });
}

/**
 * 根据输入框当前内容决定是否展示 / 命令建议。
 *
 * 输入以 / 开头时，会实时过滤 SLASH_COMMANDS 并刷新下拉建议；
 * 输入不再是 / 命令时，会立即关闭弹窗并回到普通聊天输入状态。
 */
function handleSlashCommandInput(e) {
    const value = e.target.value;

    // 检测是否以 / 开头
    if (value.startsWith('/')) {
        const query = value.slice(1).toLowerCase();
        slashCommandFiltered = SLASH_COMMANDS.filter(cmd =>
            cmd.cmd.slice(1).toLowerCase().includes(query) ||
            cmd.name.toLowerCase().includes(query)
        );
        slashCommandActiveIndex = 0;
        if (slashCommandFiltered.length > 0) {
            showSlashCommandPopup();
            renderSlashCommandList();
        } else {
            hideSlashCommandPopup();
        }
    } else {
        hideSlashCommandPopup();
    }
}

/**
 * 处理快捷命令键盘事件
 */
function handleSlashCommandKeydown(e) {
    const popup = document.getElementById('slash-command-popup');
    if (!popup || popup.style.display === 'none') return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        slashCommandActiveIndex = (slashCommandActiveIndex + 1) % slashCommandFiltered.length;
        renderSlashCommandList();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        slashCommandActiveIndex = (slashCommandActiveIndex - 1 + slashCommandFiltered.length) % slashCommandFiltered.length;
        renderSlashCommandList();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (slashCommandFiltered.length > 0) {
            e.preventDefault();
            executeSlashCommand(slashCommandFiltered[slashCommandActiveIndex]);
        }
    } else if (e.key === 'Escape') {
        hideSlashCommandPopup();
    }
}

/**
 * 显示快捷命令弹窗
 */
function showSlashCommandPopup() {
    const popup = document.getElementById('slash-command-popup');
    if (popup) {
        popup.style.display = 'block';
    }
}

/**
 * 隐藏快捷命令弹窗
 */
function hideSlashCommandPopup() {
    const popup = document.getElementById('slash-command-popup');
    if (popup) {
        popup.style.display = 'none';
    }
}

/**
 * 渲染 / 命令建议列表。
 *
 * 页面位置：聊天输入框下方的快捷命令弹层。
 * 负责内容：高亮当前选中项、显示命令说明，并保证键盘切换时当前项滚动到可见区域。
 */
function renderSlashCommandList() {
    const listEl = document.getElementById('slash-command-list');
    if (!listEl) return;

    let html = '';
    slashCommandFiltered.forEach((cmd, index) => {
        html += `
            <div class="slash-cmd-item ${index === slashCommandActiveIndex ? 'active' : ''}"
                 data-index="${index}"
                 onclick="executeSlashCommand(SLASH_COMMANDS.find(c => c.cmd === '${cmd.cmd}'))">
                <div class="slash-cmd-icon">${cmd.icon}</div>
                <div class="slash-cmd-info">
                    <div class="slash-cmd-name"><code>${cmd.cmd}</code>${cmd.name}</div>
                    <div class="slash-cmd-desc">${cmd.desc}</div>
                </div>
            </div>
        `;
    });

    listEl.innerHTML = html;

    // 滚动到选中项
    const activeItem = listEl.querySelector('.slash-cmd-item.active');
    if (activeItem) {
        activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

/**
 * 执行一个 / 快捷命令。
 *
 * 页面触发：命令建议弹窗点击、回车、Tab。
 * 这里会先清空当前输入框和弹窗状态，再调用命令绑定的 action；
 * 也就是说，模板选择、新会话、导出等快捷入口都会统一汇总到这里执行。
 */
function executeSlashCommand(cmd) {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.value = '';
        chatInput.style.height = 'auto';
    }
    hideSlashCommandPopup();

    if (cmd && cmd.action) {
        cmd.action();
    }
}

/**
 * 显示快捷命令帮助
 */
function showSlashCommandHelp() {
    const modal = document.getElementById('slash-command-help-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

/**
 * 关闭快捷命令帮助
 */
function closeSlashCommandHelp() {
    const modal = document.getElementById('slash-command-help-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * 清空当前聊天
 */
function clearCurrentChat() {
    if (!confirm('确定要清空当前会话的所有消息吗？')) return;

    chatHistory = [];
    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) {
        messagesContainer.innerHTML = '';
    }
    addWelcomeMessage();

    if (typeof showToast === 'function') {
        showToast('会话已清空', 'success');
    }
}

/**
 * 导出当前聊天
 */
async function exportCurrentChat() {
    if (!currentConversationId) {
        if (typeof showToast === 'function') {
            showToast('请先保存会话后再导出', 'warning');
        }
        return;
    }

    const api = getPywebviewApi();
    if (!api) return;

    const result = await api.export_chat_session_markdown(currentConversationId);
    if (result.success) {
        // 下载 Markdown 文件
        const blob = new Blob([result.markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chat_${new Date().toISOString().slice(0, 10)}.md`;
        a.click();
        URL.revokeObjectURL(url);

        if (typeof showToast === 'function') {
            showToast('会话已导出', 'success');
        }
    } else {
        if (typeof showToast === 'function') {
            showToast(result.error || '导出失败', 'error');
        }
    }
}

/**
 * 切换聊天页的联网搜索开关。
 *
 * 页面位置：聊天输入框附近的“网络搜索”按钮。
 * 这个状态会直接传给 sendMessage()，从而影响后端是否补做网页搜索。
 */
function toggleWebSearch() {
    webSearchEnabled = !webSearchEnabled;
    const btn = document.getElementById('web-search-toggle');
    if (btn) {
        btn.classList.toggle('active', webSearchEnabled);
    }
    if (typeof showToast === 'function') {
        showToast(webSearchEnabled ? '网络搜索已开启' : '网络搜索已关闭', 'info');
    }
}

/**
 * 切换聊天页的思考模式开关。
 *
 * 页面位置：聊天输入框附近的“思考模式”按钮。
 * 这个状态同样会由 sendMessage() 传入后端；当前提示里已经明确写了仅 Claude 侧会真正生效。
 */
function toggleThinking() {
    thinkingEnabled = !thinkingEnabled;
    const btn = document.getElementById('thinking-toggle');
    if (btn) {
        btn.classList.toggle('active', thinkingEnabled);
    }
    if (typeof showToast === 'function') {
        showToast(thinkingEnabled ? '思考模式已开启 (仅 Claude 有效)' : '思考模式已关闭', 'info');
    }
}

// 不自动初始化，由 app_core.js 的页面切换逻辑调用
