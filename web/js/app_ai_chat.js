/**
 * AI 聊天页面 - 核心逻辑
 * 功能：流式对话、Markdown 渲染、代码高亮
 */

// 全局变量
let chatHistory = []; // 对话历史
let currentSessionId = null; // 当前流式会话 ID
let pollingInterval = null; // 轮询定时器
let chatMode = 'chat'; // 对话模式：'chat' 普通对话, 'explain' 解释模式

/**
 * 获取 PyWebView API（带检查）
 */
function getPywebviewApi() {
    return (window.pywebview && window.pywebview.api) ? window.pywebview.api : null;
}

/**
 * 初始化 AI 聊天页面
 */
function initAIChatPage() {
    console.log('[AI Chat] 初始化 AI 聊天页面');

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

    console.log('[AI Chat] 初始化完成，事件已绑定');
}

/**
 * 加载 AI 设置抽屉内容（简化版，避免 DOM id 冲突）
 */
function loadSettingsDrawer(drawerElement) {
    if (!drawerElement) return;

    drawerElement.innerHTML = `
        <div style="padding:16px 24px">
            <h3 style="margin:0 0 8px;font-size:18px;font-weight:600">AI 配置</h3>
            <p style="margin:0 0 12px;opacity:0.85;font-size:14px">
                AI Provider 的新增/编辑请在左侧导航「AI 管理 → AI 配置」中完成。
            </p>
            <button class="ai-btn ai-btn-primary" type="button" id="ai-chat-open-settings-page-btn">
                打开 AI 配置页面
            </button>
        </div>
    `;

    const btn = drawerElement.querySelector('#ai-chat-open-settings-page-btn');
    if (btn) {
        btn.addEventListener('click', () => {
            closeAIChatSettings();
            // 切换到 AI 配置页面
            if (typeof window.switchPage === 'function') {
                window.switchPage('ai-settings');
            }
        });
    }
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
 * 发送消息
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

        // 调用后端流式接口（传递模式和工具推荐开关）
        const result = await api.ai_chat_stream(text, chatHistory.slice(0, -1), null, chatMode, true);

        if (result.success) {
            currentSessionId = result.session_id;

            // 如果有工具推荐，先显示工具推荐卡片
            if (result.tool_recommendations && result.tool_recommendations.tools && result.tool_recommendations.tools.length > 0) {
                addToolRecommendationsCard(result.tool_recommendations.tools);
            }

            // 如果有搜索结果，显示搜索结果
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
 * 添加搜索结果卡片（可折叠）
 */
function addSearchResultsCard(searchResults) {
    const messagesContainer = document.getElementById('chat-messages');
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
            <p class="search-result-snippet">${escapeHtml(r.snippet ? r.snippet.substring(0, 150) + '...' : '')}</p>
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
 * 添加工具推荐卡片
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
        <span class="btn-icon">🧠</span>
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
 * 开始轮询获取流式内容
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
 * 添加消息到聊天列表
 */
function addMessage(content, sender, isStreaming) {
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

    bubble.appendChild(contentDiv);
    messagesContainer.appendChild(bubble);

    scrollToBottom();

    return messageId;
}

/**
 * 更新消息内容
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
        // 重新初始化设置（刷新数据）
        if (window.initAiSettingsPage) {
            window.initAiSettingsPage();
        }
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

/* 搜索结果卡片样式 */
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
    max-height: 300px;
    overflow-y: auto;
    transition: max-height 0.3s ease, padding 0.3s ease, opacity 0.2s ease;
}

.search-results-card.collapsed .search-results-content {
    max-height: 0;
    padding: 0 14px;
    opacity: 0;
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

/* 工具推荐卡片样式 */
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

// 不自动初始化，由 app_core.js 的页面切换逻辑调用