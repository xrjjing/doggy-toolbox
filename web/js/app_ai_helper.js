// AI 辅助功能通用组件
// 提供工具页面中的 AI 生成和 AI 修复功能

// AI 辅助功能配置缓存
let _aiHelperConfigCache = null;

/**
 * 等待 pywebview API 就绪
 * @param {number} maxRetries - 最大重试次数
 * @param {number} delayMs - 每次重试间隔（毫秒）
 * @returns {Promise<boolean>}
 */
async function waitForAIHelperAPI(maxRetries = 15, delayMs = 200) {
    for (let i = 0; i < maxRetries; i++) {
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_tool_ai_enabled === 'function') {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    console.warn('AI Helper: pywebview API 未就绪');
    return false;
}

// 工具特定的 AI Prompt 配置
const TOOL_AI_PROMPTS = {
    // 命令生成器类
    'tool-git': {
        generate: {
            systemPrompt: '你是一个 Git 专家。根据用户的描述生成对应的 Git 命令。只返回命令本身，不要解释。如果需要多个命令，用换行分隔。',
            placeholder: '描述你想要执行的 Git 操作...',
            examples: ['撤销最近一次提交但保留修改', '查看某个文件的修改历史', '合并 feature 分支到 main']
        },
        fix: {
            systemPrompt: '你是一个 Git 专家。检查并修复用户提供的 Git 命令中的错误。只返回修正后的命令，不要解释。',
            placeholder: '粘贴需要修复的 Git 命令...'
        }
    },
    'tool-docker': {
        generate: {
            systemPrompt: '你是一个 Docker 专家。根据用户的描述生成对应的 Docker 命令。只返回命令本身，不要解释。',
            placeholder: '描述你想要执行的 Docker 操作...',
            examples: ['运行一个 nginx 容器并映射 80 端口', '查看所有运行中的容器', '构建镜像并推送到仓库']
        },
        fix: {
            systemPrompt: '你是一个 Docker 专家。检查并修复用户提供的 Docker 命令中的错误。只返回修正后的命令，不要解释。',
            placeholder: '粘贴需要修复的 Docker 命令...'
        }
    },
    'tool-nginx': {
        generate: {
            systemPrompt: '你是一个 nginx 配置专家。根据用户的描述生成对应的 nginx 配置片段。只返回配置内容，不要解释。',
            placeholder: '描述你需要的 nginx 配置...',
            examples: ['反向代理到 localhost:3000', '配置 HTTPS 和 HTTP/2', '设置静态文件缓存']
        },
        fix: {
            systemPrompt: '你是一个 nginx 配置专家。检查并修复用户提供的 nginx 配置中的错误。只返回修正后的配置，不要解释。',
            placeholder: '粘贴需要修复的 nginx 配置...'
        }
    },

    // 数据处理类
    'tool-mock': {
        generate: {
            systemPrompt: '你是一个数据生成专家。根据用户的描述生成符合要求的 Mock 测试数据。返回 JSON 格式的数据数组。',
            placeholder: '描述你需要的测试数据...',
            examples: ['生成 10 个用户信息，包含姓名、邮箱、手机号', '生成电商订单数据', '生成随机的 IP 地址列表']
        }
    },
    'tool-json': {
        generate: {
            systemPrompt: '你是一个 JSON 专家。根据用户的描述生成对应的 JSON 数据结构。只返回 JSON，不要解释。',
            placeholder: '描述你需要的 JSON 结构...',
            examples: ['用户配置文件结构', 'API 响应格式', '商品信息数据结构']
        },
        fix: {
            systemPrompt: '你是一个 JSON 专家。修复用户提供的 JSON 中的语法错误。只返回修正后的 JSON，不要解释。',
            placeholder: '粘贴需要修复的 JSON...'
        }
    },
    'tool-json-schema': {
        generate: {
            systemPrompt: '你是一个 JSON Schema 专家。根据用户的描述或示例 JSON 生成对应的 JSON Schema。只返回 Schema，不要解释。',
            placeholder: '描述数据结构或粘贴示例 JSON...'
        }
    },

    // 文本处理类
    'tool-regex': {
        generate: {
            systemPrompt: '你是一个正则表达式专家。根据用户的描述生成对应的正则表达式。只返回正则表达式本身（不含分隔符），不要解释。',
            placeholder: '描述你想要匹配的内容...',
            examples: ['匹配邮箱地址', '匹配中国手机号', '提取 URL 中的域名']
        },
        fix: {
            systemPrompt: '你是一个正则表达式专家。检查并修复用户提供的正则表达式中的错误。只返回修正后的正则表达式，不要解释。',
            placeholder: '粘贴需要修复的正则表达式...'
        }
    },
    'tool-sql': {
        generate: {
            systemPrompt: '你是一个 SQL 专家。根据用户的描述生成对应的 SQL 语句。只返回 SQL 语句，不要解释。',
            placeholder: '描述你需要的 SQL 查询...',
            examples: ['查询最近 7 天的订单', '统计每个分类的商品数量', '更新用户状态']
        },
        fix: {
            systemPrompt: '你是一个 SQL 专家。检查并修复用户提供的 SQL 语句中的语法错误。只返回修正后的 SQL，不要解释。',
            placeholder: '粘贴需要修复的 SQL...'
        }
    },
    'tool-curl': {
        generate: {
            systemPrompt: '你是一个 HTTP/cURL 专家。根据用户的描述生成对应的 cURL 命令。只返回 cURL 命令，不要解释。',
            placeholder: '描述你需要的 HTTP 请求...',
            examples: ['POST JSON 数据到 API', '带 Bearer Token 的 GET 请求', '上传文件']
        },
        fix: {
            systemPrompt: '你是一个 HTTP/cURL 专家。检查并修复用户提供的 cURL 命令中的错误。只返回修正后的命令，不要解释。',
            placeholder: '粘贴需要修复的 cURL 命令...'
        }
    },
    'tool-cron': {
        generate: {
            systemPrompt: '你是一个 Cron 表达式专家。根据用户的描述生成对应的 Cron 表达式。只返回 Cron 表达式，不要解释。',
            placeholder: '描述定时任务的执行时间...',
            examples: ['每天凌晨 3 点执行', '每周一上午 9 点', '每 5 分钟执行一次']
        }
    }
};

/**
 * 检查工具的 AI 功能是否启用
 * @param {string} toolId - 工具 ID
 * @returns {Promise<{enabled: boolean, features: {generate: boolean, fix: boolean}}>}
 */
async function checkToolAIEnabled(toolId) {
    try {
        // 等待 API 就绪
        const apiReady = await waitForAIHelperAPI();
        if (!apiReady) {
            return { enabled: false, features: { generate: false, fix: false } };
        }

        const result = await window.pywebview.api.get_tool_ai_enabled(toolId);
        return result;
    } catch (error) {
        console.error('检查工具 AI 状态失败:', error);
        return { enabled: false, features: { generate: false, fix: false } };
    }
}

/**
 * 执行 AI 生成
 * @param {string} toolId - 工具 ID
 * @param {string} userInput - 用户输入
 * @param {object} context - 上下文信息（可选）
 * @returns {Promise<{success: boolean, result?: string, error?: string}>}
 */
async function executeAIGenerate(toolId, userInput, context = {}) {
    const config = TOOL_AI_PROMPTS[toolId];
    if (!config || !config.generate) {
        return { success: false, error: '该工具不支持 AI 生成功能' };
    }

    try {
        const api = window.pywebview && window.pywebview.api;
        if (!api) {
            return { success: false, error: 'API 未就绪' };
        }

        // 构建 prompt
        let prompt = userInput;
        if (context.currentContent) {
            prompt = `当前内容：\n${context.currentContent}\n\n用户需求：${userInput}`;
        }

        const result = await api.ai_chat(prompt, config.generate.systemPrompt);

        if (result.success) {
            return { success: true, result: result.response };
        } else {
            return { success: false, error: result.error || 'AI 请求失败' };
        }
    } catch (error) {
        console.error('AI 生成失败:', error);
        return { success: false, error: error.message || 'AI 请求失败' };
    }
}

/**
 * 执行 AI 修复
 * @param {string} toolId - 工具 ID
 * @param {string} content - 需要修复的内容
 * @param {string} errorMessage - 错误信息（可选）
 * @returns {Promise<{success: boolean, result?: string, error?: string}>}
 */
async function executeAIFix(toolId, content, errorMessage = '') {
    const config = TOOL_AI_PROMPTS[toolId];
    if (!config || !config.fix) {
        return { success: false, error: '该工具不支持 AI 修复功能' };
    }

    try {
        const api = window.pywebview && window.pywebview.api;
        if (!api) {
            return { success: false, error: 'API 未就绪' };
        }

        // 构建 prompt
        let prompt = content;
        if (errorMessage) {
            prompt = `内容：\n${content}\n\n错误信息：${errorMessage}\n\n请修复上述内容中的错误。`;
        }

        const result = await api.ai_chat(prompt, config.fix.systemPrompt);

        if (result.success) {
            return { success: true, result: result.response };
        } else {
            return { success: false, error: result.error || 'AI 请求失败' };
        }
    } catch (error) {
        console.error('AI 修复失败:', error);
        return { success: false, error: error.message || 'AI 请求失败' };
    }
}

/**
 * 创建 AI 辅助按钮组
 * @param {string} toolId - 工具 ID
 * @param {object} callbacks - 回调函数 { onGenerate, onFix, getContent }
 * @returns {HTMLElement} - 按钮组元素
 */
function createAIHelperButtons(toolId, callbacks) {
    const container = document.createElement('div');
    container.className = 'ai-helper-buttons';
    container.dataset.toolId = toolId;

    const config = TOOL_AI_PROMPTS[toolId] || {};

    // AI 生成按钮
    if (config.generate) {
        const generateBtn = document.createElement('button');
        generateBtn.className = 'btn btn-sm ai-helper-btn ai-generate-btn';
        generateBtn.innerHTML = '✨ AI 生成';
        generateBtn.title = config.generate.placeholder || 'AI 生成';
        generateBtn.onclick = () => showAIGenerateModal(toolId, callbacks);
        container.appendChild(generateBtn);
    }

    // AI 修复按钮
    if (config.fix) {
        const fixBtn = document.createElement('button');
        fixBtn.className = 'btn btn-sm ai-helper-btn ai-fix-btn';
        fixBtn.innerHTML = '🔧 AI 修复';
        fixBtn.title = config.fix.placeholder || 'AI 修复';
        fixBtn.onclick = async () => {
            const content = callbacks.getContent ? callbacks.getContent() : '';
            if (!content.trim()) {
                showToast('请先输入内容', 'warning');
                return;
            }
            await executeAIFixWithUI(toolId, content, callbacks.onFix);
        };
        container.appendChild(fixBtn);
    }

    return container;
}

/**
 * 显示 AI 生成弹窗
 */
function showAIGenerateModal(toolId, callbacks) {
    const config = TOOL_AI_PROMPTS[toolId];
    if (!config || !config.generate) return;

    // 创建弹窗
    const modal = document.createElement('div');
    modal.className = 'modal ai-generate-modal';
    modal.style.display = 'flex';

    const examples = config.generate.examples || [];

    modal.innerHTML = `
        <div class="modal-content ai-generate-content">
            <div class="modal-header">
                <h3>✨ AI 生成</h3>
                <button class="btn-close">×</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>描述你的需求</label>
                    <textarea id="ai-generate-input" class="form-input" rows="3" placeholder="${escapeHtml(config.generate.placeholder || '描述你想要生成的内容...')}"></textarea>
                </div>
                ${examples.length > 0 ? '<div class="ai-examples"><span class="examples-label">示例：</span></div>' : ''}
            </div>
            <div class="modal-footer">
                <button class="btn btn-ghost btn-cancel">取消</button>
                <button class="btn btn-primary ai-generate-submit">
                    <span class="btn-text">生成</span>
                    <span class="btn-loading" style="display:none">⏳</span>
                </button>
            </div>
        </div>
    `;

    // 安全地添加示例按钮
    if (examples.length > 0) {
        const examplesContainer = modal.querySelector('.ai-examples');
        examples.forEach(ex => {
            const chip = document.createElement('button');
            chip.className = 'example-chip';
            chip.textContent = ex;
            chip.addEventListener('click', () => {
                const textarea = modal.querySelector('textarea');
                if (textarea) textarea.value = ex;
            });
            examplesContainer.appendChild(chip);
        });
    }

    // 绑定事件
    modal.querySelector('.btn-close').addEventListener('click', () => modal.remove());
    modal.querySelector('.btn-cancel').addEventListener('click', () => modal.remove());
    modal.querySelector('.ai-generate-submit').addEventListener('click', () => submitAIGenerate(toolId));

    // 保存回调
    modal._callbacks = callbacks;

    document.body.appendChild(modal);

    // 聚焦输入框
    setTimeout(() => {
        modal.querySelector('textarea').focus();
    }, 100);
}

// HTML 转义辅助函数
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 提交 AI 生成请求
 */
async function submitAIGenerate(toolId) {
    const modal = document.querySelector('.ai-generate-modal');
    if (!modal) return;

    const input = modal.querySelector('#ai-generate-input');
    const submitBtn = modal.querySelector('.ai-generate-submit');
    const userInput = input.value.trim();

    if (!userInput) {
        showToast('请输入描述', 'warning');
        return;
    }

    // 显示加载状态
    submitBtn.disabled = true;
    submitBtn.querySelector('.btn-text').style.display = 'none';
    submitBtn.querySelector('.btn-loading').style.display = 'inline';

    try {
        const result = await executeAIGenerate(toolId, userInput);

        if (result.success) {
            // 调用回调
            if (modal._callbacks && modal._callbacks.onGenerate) {
                modal._callbacks.onGenerate(result.result);
            }
            modal.remove();
            showToast('AI 生成完成', 'success');
        } else {
            showToast(`生成失败: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast('AI 请求失败', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.querySelector('.btn-text').style.display = 'inline';
        submitBtn.querySelector('.btn-loading').style.display = 'none';
    }
}

/**
 * 执行 AI 修复并更新 UI
 */
async function executeAIFixWithUI(toolId, content, onFix) {
    showToast('🔧 AI 正在修复...', 'info');

    const result = await executeAIFix(toolId, content);

    if (result.success) {
        if (onFix) {
            onFix(result.result);
        }
        showToast('AI 修复完成', 'success');
    } else {
        showToast(`修复失败: ${result.error}`, 'error');
    }
}

/**
 * 初始化工具页面的 AI 辅助功能
 * @param {string} toolId - 工具 ID
 * @param {object} options - 配置选项
 */
async function initToolAIHelper(toolId, options = {}) {
    // 检查 AI 功能是否启用
    const aiStatus = await checkToolAIEnabled(toolId);

    if (!aiStatus.enabled) {
        return; // AI 功能未启用，不显示按钮
    }

    const {
        containerSelector,  // 按钮容器选择器
        inputSelector,      // 输入框选择器
        outputSelector,     // 输出框选择器
        onGenerate,         // 生成回调
        onFix               // 修复回调
    } = options;

    const container = document.querySelector(containerSelector);
    if (!container) return;

    // 创建按钮组
    const buttons = createAIHelperButtons(toolId, {
        onGenerate: onGenerate || ((result) => {
            const output = document.querySelector(outputSelector);
            if (output) {
                if (output.tagName === 'TEXTAREA' || output.tagName === 'INPUT') {
                    output.value = result;
                } else {
                    output.textContent = result;
                }
            }
        }),
        onFix: onFix || ((result) => {
            const input = document.querySelector(inputSelector);
            if (input) {
                if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
                    input.value = result;
                } else {
                    input.textContent = result;
                }
            }
        }),
        getContent: () => {
            const input = document.querySelector(inputSelector);
            return input ? (input.value || input.textContent || '') : '';
        }
    });

    // 根据启用的功能过滤按钮
    if (!aiStatus.features.generate) {
        const genBtn = buttons.querySelector('.ai-generate-btn');
        if (genBtn) genBtn.remove();
    }
    if (!aiStatus.features.fix) {
        const fixBtn = buttons.querySelector('.ai-fix-btn');
        if (fixBtn) fixBtn.remove();
    }

    // 如果还有按钮，添加到容器
    if (buttons.children.length > 0) {
        container.appendChild(buttons);
    }
}

/**
 * 工具 AI 按钮配置映射
 * 定义每个工具的按钮容器和输入/输出元素
 */
const TOOL_AI_BUTTON_CONFIG = {
    'tool-git': {
        containerId: 'git-ai-buttons',
        inputSelector: '#git-command-output',
        outputSelector: '#git-command-output',
        onGenerate: (result) => {
            const output = document.getElementById('git-command-output');
            if (output) output.value = result;
        }
    },
    'tool-docker': {
        containerId: 'docker-ai-buttons',
        inputSelector: '#docker-command-output',
        outputSelector: '#docker-command-output',
        onGenerate: (result) => {
            const output = document.getElementById('docker-command-output');
            if (output) output.value = result;
        }
    },
    'tool-nginx': {
        containerId: 'nginx-ai-buttons',
        inputSelector: '#nginx-output',
        outputSelector: '#nginx-output',
        onGenerate: (result) => {
            const output = document.getElementById('nginx-output');
            if (output) output.value = result;
        },
        onFix: (result) => {
            const output = document.getElementById('nginx-output');
            if (output) output.value = result;
        },
        getContent: () => document.getElementById('nginx-output')?.value || ''
    },
    'tool-regex': {
        containerId: 'regex-ai-buttons',
        inputSelector: '#regex-pattern',
        outputSelector: '#regex-pattern',
        onGenerate: (result) => {
            const patternEl = document.getElementById('regex-pattern');
            if (patternEl) {
                patternEl.value = result.replace(/^\/|\/[gimsuvy]*$/g, '');
                if (typeof updateRegexTool === 'function') updateRegexTool();
            }
        },
        onFix: (result) => {
            const patternEl = document.getElementById('regex-pattern');
            if (patternEl) {
                patternEl.value = result.replace(/^\/|\/[gimsuvy]*$/g, '');
                if (typeof updateRegexTool === 'function') updateRegexTool();
            }
        },
        getContent: () => document.getElementById('regex-pattern')?.value || ''
    },
    'tool-mock': {
        containerId: 'mock-ai-buttons',
        inputSelector: '#mock-output',
        outputSelector: '#mock-output',
        onGenerate: (result) => {
            const output = document.getElementById('mock-output');
            if (output) output.value = result;
        }
    },
    'tool-json': {
        containerId: 'json-ai-buttons',
        inputSelector: '#json-input',
        outputSelector: '#json-output',
        onGenerate: (result) => {
            const input = document.getElementById('json-input');
            if (input) {
                input.value = result;
                if (typeof updateJsonTool === 'function') updateJsonTool();
            }
        },
        onFix: (result) => {
            const input = document.getElementById('json-input');
            if (input) {
                input.value = result;
                if (typeof updateJsonTool === 'function') updateJsonTool();
            }
        },
        getContent: () => document.getElementById('json-input')?.value || ''
    },
    'tool-json-schema': {
        containerId: 'json-schema-ai-buttons',
        inputSelector: '#jsonschema-input',
        outputSelector: '#jsonschema-output',
        onGenerate: (result) => {
            const input = document.getElementById('jsonschema-input');
            if (input) {
                input.value = result;
                if (typeof updateJsonSchemaTool === 'function') updateJsonSchemaTool();
            }
        }
    },
    'tool-sql': {
        containerId: 'sql-ai-buttons',
        inputSelector: '#sql-input',
        outputSelector: '#sql-output',
        onGenerate: (result) => {
            const input = document.getElementById('sql-input');
            if (input) {
                input.value = result;
                if (typeof updateSqlTool === 'function') updateSqlTool();
            }
        },
        onFix: (result) => {
            const input = document.getElementById('sql-input');
            if (input) {
                input.value = result;
                if (typeof updateSqlTool === 'function') updateSqlTool();
            }
        },
        getContent: () => document.getElementById('sql-input')?.value || ''
    },
    'tool-curl': {
        containerId: 'curl-ai-buttons',
        inputSelector: '#curl-input',
        outputSelector: '#curl-input',
        onGenerate: (result) => {
            const input = document.getElementById('curl-input');
            if (input) {
                input.value = result;
                if (typeof parseCurlCommand === 'function') parseCurlCommand();
            }
        },
        onFix: (result) => {
            const input = document.getElementById('curl-input');
            if (input) {
                input.value = result;
                if (typeof parseCurlCommand === 'function') parseCurlCommand();
            }
        },
        getContent: () => document.getElementById('curl-input')?.value || ''
    },
    'tool-cron': {
        containerId: 'cron-ai-buttons',
        inputSelector: '#cron-input',
        outputSelector: '#cron-input',
        onGenerate: (result) => {
            const input = document.getElementById('cron-input');
            if (input) {
                input.value = result;
                if (typeof updateCronTool === 'function') updateCronTool();
            }
        }
    }
};

/**
 * 初始化指定工具的 AI 按钮
 * @param {string} toolId - 工具 ID
 */
async function initToolAIButtons(toolId) {
    const config = TOOL_AI_BUTTON_CONFIG[toolId];
    if (!config) return;

    const container = document.getElementById(config.containerId);
    if (!container) return;

    // 清空现有按钮
    container.innerHTML = '';

    // 检查 AI 功能是否启用
    const aiStatus = await checkToolAIEnabled(toolId);
    if (!aiStatus.enabled) return;

    const promptConfig = TOOL_AI_PROMPTS[toolId];
    if (!promptConfig) return;

    // AI 生成按钮
    if (aiStatus.features.generate && promptConfig.generate) {
        const generateBtn = document.createElement('button');
        generateBtn.className = 'btn btn-sm ai-helper-btn ai-generate-btn';
        generateBtn.innerHTML = '✨ AI 生成';
        generateBtn.title = promptConfig.generate.placeholder || 'AI 生成';
        generateBtn.addEventListener('click', () => {
            showAIGenerateModal(toolId, {
                onGenerate: config.onGenerate
            });
        });
        container.appendChild(generateBtn);
    }

    // AI 修复按钮
    if (aiStatus.features.fix && promptConfig.fix) {
        const fixBtn = document.createElement('button');
        fixBtn.className = 'btn btn-sm ai-helper-btn ai-fix-btn';
        fixBtn.innerHTML = '🔧 AI 修复';
        fixBtn.title = promptConfig.fix.placeholder || 'AI 修复';
        fixBtn.addEventListener('click', async () => {
            const content = config.getContent ? config.getContent() : '';
            if (!content.trim()) {
                if (typeof showToast === 'function') {
                    showToast('请先输入内容', 'warning');
                }
                return;
            }
            if (typeof showToast === 'function') {
                showToast('🔧 AI 正在修复...', 'info');
            }
            const result = await executeAIFix(toolId, content);
            if (result.success) {
                if (config.onFix) config.onFix(result.result);
                if (typeof showToast === 'function') {
                    showToast('AI 修复完成', 'success');
                }
            } else {
                if (typeof showToast === 'function') {
                    showToast(`修复失败: ${result.error}`, 'error');
                }
            }
        });
        container.appendChild(fixBtn);
    }
}

/**
 * 刷新所有已加载工具页面的 AI 按钮
 * 当全局开关或工具开关变化时调用
 */
async function refreshAllToolAIButtons() {
    for (const toolId of Object.keys(TOOL_AI_BUTTON_CONFIG)) {
        const config = TOOL_AI_BUTTON_CONFIG[toolId];
        const container = document.getElementById(config.containerId);
        if (container) {
            await initToolAIButtons(toolId);
        }
    }
}

/**
 * 页面进入时初始化 AI 按钮
 * 在 app_core.js 的 handlePageEnter 中调用
 * @param {string} pageId - 页面 ID
 */
async function initPageAIButtons(pageId) {
    // 将页面 ID 转换为工具 ID（去掉 page- 前缀）
    const toolId = pageId.replace(/^page-/, '');
    if (TOOL_AI_BUTTON_CONFIG[toolId]) {
        await initToolAIButtons(toolId);
    }
}

// 导出函数
window.waitForAIHelperAPI = waitForAIHelperAPI;
window.checkToolAIEnabled = checkToolAIEnabled;
window.executeAIGenerate = executeAIGenerate;
window.executeAIFix = executeAIFix;
window.createAIHelperButtons = createAIHelperButtons;
window.initToolAIHelper = initToolAIHelper;
window.showAIGenerateModal = showAIGenerateModal;
window.submitAIGenerate = submitAIGenerate;
window.initToolAIButtons = initToolAIButtons;
window.refreshAllToolAIButtons = refreshAllToolAIButtons;
window.initPageAIButtons = initPageAIButtons;
window.TOOL_AI_BUTTON_CONFIG = TOOL_AI_BUTTON_CONFIG;
