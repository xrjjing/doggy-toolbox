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
    // ========== 命令生成器类 ==========
    'tool-git': {
        generate: {
            systemPrompt: `【角色】Git 命令生成助手
【任务】根据用户的操作需求，生成可直接执行的 Git 命令
【输出要求】
1. 只输出命令本身，每个命令占一行
2. 不要输出任何解释、说明、注释
3. 不要使用 Markdown 代码块
4. 不要输出"你可以执行"、"命令如下"等引导语
【示例输出】
git checkout -b feature/login
git add .
git commit -m "feat: add login"`,
            placeholder: '描述你想要执行的 Git 操作...',
            examples: ['撤销最近一次提交但保留修改', '查看某个文件的修改历史', '合并 feature 分支到 main']
        },
        fix: {
            systemPrompt: `【角色】Git 命令修复助手
【任务】修复用户提供的 Git 命令中的语法错误或参数错误
【输出要求】
1. 只输出修正后的命令
2. 不要输出任何解释或对比
3. 不要使用 Markdown 代码块`
        }
    },
    'tool-docker': {
        generate: {
            systemPrompt: `【角色】Docker 命令生成助手
【任务】根据用户的操作需求，生成可直接执行的 Docker 命令
【输出要求】
1. 只输出命令本身，每个命令占一行
2. 不要输出任何解释、说明、注释
3. 不要使用 Markdown 代码块
4. 不要输出"你可以执行"、"命令如下"等引导语`,
            placeholder: '描述你想要执行的 Docker 操作...',
            examples: ['运行一个 nginx 容器并映射 80 端口', '查看所有运行中的容器', '构建镜像并推送到仓库']
        },
        fix: {
            systemPrompt: `【角色】Docker 命令修复助手
【任务】修复用户提供的 Docker 命令中的语法错误或参数错误
【输出要求】
1. 只输出修正后的命令
2. 不要输出任何解释或对比
3. 不要使用 Markdown 代码块`
        }
    },
    'tool-nginx': {
        generate: {
            systemPrompt: `【角色】nginx 配置生成助手
【任务】根据用户需求生成 nginx 配置片段
【输出要求】
1. 只输出配置内容本身
2. 不要输出任何解释或说明
3. 不要使用 Markdown 代码块
4. 配置格式要正确，包含必要的大括号和分号`,
            placeholder: '描述你需要的 nginx 配置...',
            examples: ['反向代理到 localhost:3000', '配置 HTTPS 和 HTTP/2', '设置静态文件缓存']
        },
        fix: {
            systemPrompt: `【角色】nginx 配置修复助手
【任务】修复用户提供的 nginx 配置中的语法错误
【输出要求】
1. 只输出修正后的完整配置
2. 不要输出任何解释
3. 不要使用 Markdown 代码块`
        }
    },

    // ========== 数据处理类 ==========
    'tool-mock': {
        generate: {
            systemPrompt: `你是 Mock 数据生成器。用户会描述需要的数据结构，你必须直接输出 JSON 数组。

严格规则（违反任何一条都是错误）：
- 只输出 JSON，不输出任何其他文字
- 不要问问题，不要确认，不要解释
- 不要使用 markdown 代码块
- 数据要真实可信（中文姓名、11位手机号、真实邮箱格式）

用户输入: 3个用户，包含姓名和手机号
正确输出: [{"name":"张三","phone":"13812345678"},{"name":"李四","phone":"13987654321"},{"name":"王五","phone":"13698765432"}]`,
            placeholder: '描述你需要的测试数据结构...',
            examples: ['生成 10 个用户信息，包含姓名、邮箱、手机号', '生成电商订单数据', '生成随机的 IP 地址列表']
        },
        analyze: {
            systemPrompt: `你是数据质量分析师。用户会提供 JSON 数据，你必须用中文分析数据质量。

严格规则：
- 不要问问题，直接分析
- 使用 Markdown 格式输出
- 必须包含以下章节：

## 📊 数据概览
（描述结构、字段数、记录数）

## ✅ 数据质量评估
- **完整性**：空值/缺失情况
- **一致性**：格式统一性
- **真实性**：是否符合真实场景

## ⚠️ 发现的问题
（具体问题列表，无则写"未发现明显问题"）

## 💡 改进建议
（可操作的建议）`,
            placeholder: '分析 Mock 数据质量和真实性'
        }
    },
    'tool-json': {
        generate: {
            systemPrompt: `你是 JSON 生成器。用户会描述需要的数据结构，你必须直接输出 JSON。

严格规则（违反任何一条都是错误）：
- 只输出 JSON，不输出任何其他文字
- 不要问问题，不要确认，不要解释
- 不要使用 markdown 代码块
- 字段命名使用 camelCase

用户输入: 用户信息，包含姓名、邮箱、年龄
正确输出: {"userName":"张三","email":"zhangsan@example.com","age":28}`,
            placeholder: '描述你需要的 JSON 结构...',
            examples: ['用户配置文件结构', 'API 响应格式', '商品信息数据结构']
        },
        fix: {
            systemPrompt: `你是 JSON 修复器。用户会提供有语法错误的 JSON，你必须修复并直接输出正确的 JSON。

严格规则（违反任何一条都是错误）：
- 只输出修复后的 JSON，不输出任何其他文字
- 不要解释修复了什么
- 不要使用 markdown 代码块

用户输入: {name: "张三", age: 28,}
正确输出: {"name":"张三","age":28}`
        },
        analyze: {
            systemPrompt: `你是 JSON 数据分析师。用户会提供 JSON 数据，你必须用中文分析其结构。

严格规则：
- 不要问问题，直接分析
- 使用 Markdown 格式输出
- 必须包含以下章节：

## 📊 数据结构概览
（描述整体结构、层级深度、用途）

## 🏷️ 字段说明
| 字段名 | 类型 | 说明 |
|--------|------|------|

## 📝 TypeScript 类型定义
\`\`\`typescript
interface DataType {
  // 类型定义
}
\`\`\`

## ⚠️ 潜在问题
（问题列表，无则写"未发现明显问题"）`,
            placeholder: '分析 JSON 结构、生成类型定义、发现潜在问题'
        }
    },
    'tool-json-schema': {
        generate: {
            systemPrompt: `你是 JSON Schema 生成器。用户会描述数据结构或提供示例 JSON，你必须直接输出 JSON Schema。

严格规则（违反任何一条都是错误）：
- 只输出 JSON Schema，不输出任何其他文字
- 不要问问题，不要确认，不要解释
- 不要使用 markdown 代码块
- Schema 必须包含 $schema、type、properties

用户输入: 用户信息，包含姓名(必填)和年龄
正确输出: {"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"name":{"type":"string"},"age":{"type":"integer","minimum":0}},"required":["name"]}`,
            placeholder: '描述数据结构或粘贴示例 JSON...'
        },
        fix: {
            systemPrompt: `你是 JSON Schema 修复器。用户会提供有错误的 JSON Schema，你必须修复并直接输出正确的 Schema。

严格规则（违反任何一条都是错误）：
- 只输出修复后的 JSON Schema，不输出任何其他文字
- 不要解释修复了什么
- 不要使用 markdown 代码块`
        }
    },

    // ========== 文本处理类 ==========
    'tool-regex': {
        generate: {
            systemPrompt: `你是正则表达式生成器。用户会描述匹配需求，你必须直接输出正则表达式。

严格规则（违反任何一条都是错误）：
- 只输出正则表达式本身，不输出任何其他文字
- 不要包含分隔符 / 或标志位
- 不要问问题，不要解释

用户输入: 匹配邮箱
正确输出: [a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}`,
            placeholder: '描述你想要匹配的内容...',
            examples: ['匹配邮箱地址', '匹配中国手机号', '提取 URL 中的域名']
        },
        fix: {
            systemPrompt: `你是正则表达式修复器。用户会提供有语法错误的正则表达式，你必须修复并直接输出。

严格规则（违反任何一条都是错误）：
- 只输出修复后的正则表达式，不输出任何其他文字
- 不要包含分隔符 / 或标志位
- 不要解释修复了什么`
        }
    },
    'tool-sql': {
        generate: {
            systemPrompt: `你是 SQL 生成器。用户会描述查询需求，你必须直接输出 SQL 语句。

严格规则（违反任何一条都是错误）：
- 只输出 SQL 语句，不输出任何其他文字
- 不要问问题，不要确认，不要解释
- 不要使用 markdown 代码块
- 使用标准 SQL 语法

用户输入: 查询最近7天的订单
正确输出: SELECT * FROM orders WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
            placeholder: '描述你需要的 SQL 查询...',
            examples: ['查询最近 7 天的订单', '统计每个分类的商品数量', '更新用户状态']
        },
        fix: {
            systemPrompt: `你是 SQL 修复器。用户会提供有语法错误的 SQL，你必须修复并直接输出正确的 SQL。

严格规则（违反任何一条都是错误）：
- 只输出修复后的 SQL，不输出任何其他文字
- 不要解释修复了什么
- 不要使用 markdown 代码块

用户输入: SELEC * FORM users WHER id = 1
正确输出: SELECT * FROM users WHERE id = 1`
        }
    },
    'tool-curl': {
        generate: {
            systemPrompt: `你是 cURL 命令生成器。用户会描述 HTTP 请求需求，你必须直接输出 cURL 命令。

严格规则（违反任何一条都是错误）：
- 只输出 cURL 命令，不输出任何其他文字
- 不要问问题，不要确认，不要解释
- 不要使用 markdown 代码块
- 复杂命令可用 \\ 换行

用户输入: POST JSON 到 https://api.example.com/users
正确输出: curl -X POST https://api.example.com/users -H "Content-Type: application/json" -d '{"name":"test"}'`,
            placeholder: '描述你需要的 HTTP 请求...',
            examples: ['POST JSON 数据到 API', '带 Bearer Token 的 GET 请求', '上传文件']
        },
        fix: {
            systemPrompt: `你是 cURL 命令修复器。用户会提供有错误的 cURL 命令，你必须修复并直接输出。

严格规则（违反任何一条都是错误）：
- 只输出修复后的 cURL 命令，不输出任何其他文字
- 不要解释修复了什么
- 不要使用 markdown 代码块`
        }
    },
    'tool-cron': {
        generate: {
            systemPrompt: `你是 Cron 表达式生成器。用户会描述定时规则，你必须直接输出 Cron 表达式。

严格规则（违反任何一条都是错误）：
- 只输出 Cron 表达式（5位或6位格式），不输出任何其他文字
- 不要问问题，不要解释

用户输入: 每天凌晨3点
正确输出: 0 3 * * *`,
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
 * 清理 AI 输出中的 Markdown 代码块
 * @param {string} text - AI 返回的文本
 * @returns {string} 清理后的文本
 */
function cleanAICodeBlockOutput(text) {
    if (!text) return text;
    // 移除 ```language\n...\n``` 格式的代码块
    let cleaned = text.replace(/^```[\w]*\n?/gm, '').replace(/\n?```$/gm, '');
    // 移除开头的引导语（如"以下是..."、"这是..."等）
    cleaned = cleaned.replace(/^(以下是|这是|下面是|生成的|修复后的|正确的)[^：:\n]*[：:]\s*/i, '');
    return cleaned.trim();
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
            return { success: true, result: cleanAICodeBlockOutput(result.response) };
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
            return { success: true, result: cleanAICodeBlockOutput(result.response) };
        } else {
            return { success: false, error: result.error || 'AI 请求失败' };
        }
    } catch (error) {
        console.error('AI 修复失败:', error);
        return { success: false, error: error.message || 'AI 请求失败' };
    }
}

/**
 * 执行 AI 分析
 * @param {string} toolId - 工具 ID
 * @param {string} content - 需要分析的内容
 * @returns {Promise<{success: boolean, result?: string, error?: string}>}
 */
async function executeAIAnalyze(toolId, content) {
    const config = TOOL_AI_PROMPTS[toolId];
    if (!config || !config.analyze) {
        return { success: false, error: '该工具不支持 AI 分析功能' };
    }

    try {
        const api = window.pywebview && window.pywebview.api;
        if (!api) {
            return { success: false, error: 'API 未就绪' };
        }

        const result = await api.ai_chat(content, config.analyze.systemPrompt);

        if (result.success) {
            return { success: true, result: result.response };
        } else {
            return { success: false, error: result.error || 'AI 请求失败' };
        }
    } catch (error) {
        console.error('AI 分析失败:', error);
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
 * 显示 AI 分析结果弹窗
 * @param {string} content - 分析结果内容（Markdown 格式）
 */
function showAIAnalyzeResultModal(content) {
    // 移除已存在的弹窗
    const existingModal = document.querySelector('.ai-analyze-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.className = 'modal ai-analyze-modal';
    modal.style.display = 'flex';

    modal.innerHTML = `
        <div class="modal-content ai-analyze-content">
            <div class="modal-header">
                <h3>🔍 AI 分析结果</h3>
                <button class="btn-close">×</button>
            </div>
            <div class="modal-body ai-analyze-body">
                <div class="ai-analyze-result"></div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-ghost btn-copy-result">📋 复制结果</button>
                <button class="btn btn-primary btn-close-modal">关闭</button>
            </div>
        </div>
    `;

    // 渲染 Markdown 内容
    const resultContainer = modal.querySelector('.ai-analyze-result');
    resultContainer.innerHTML = renderAnalyzeMarkdown(content);

    // 绑定事件
    modal.querySelector('.btn-close').addEventListener('click', () => modal.remove());
    modal.querySelector('.btn-close-modal').addEventListener('click', () => modal.remove());
    modal.querySelector('.btn-copy-result').addEventListener('click', () => {
        navigator.clipboard.writeText(content).then(() => {
            showToast('已复制到剪贴板', 'success');
        }).catch(() => {
            showToast('复制失败', 'error');
        });
    });

    // 点击遮罩关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);
}

/**
 * 简单的 Markdown 渲染（用于分析结果）
 * 安全处理：先转义所有 HTML，再做安全的 Markdown 替换
 */
function renderAnalyzeMarkdown(text) {
    if (!text) return '';

    // 先对全文做 HTML 转义
    let html = escapeHtml(text);

    // 代码块 ```language\ncode\n``` (已转义的版本)
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        const language = lang || 'plaintext';
        return `<pre class="analyze-code-block"><code class="language-${language}">${code.trim()}</code></pre>`;
    });

    // 行内代码 `code` (已转义)
    html = html.replace(/`([^`]+)`/g, '<code class="analyze-inline-code">$1</code>');

    // 标题 ##
    html = html.replace(/^## (.+)$/gm, '<h4 class="analyze-heading">$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h5 class="analyze-subheading">$1</h5>');

    // 粗体 **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // 斜体 *text*
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // 列表项 - item
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul class="analyze-list">$&</ul>');

    // 段落（换行符转 <br>，但保留代码块内的换行）
    html = html.replace(/\n(?!<)/g, '<br>');

    return html;
}

/**
 * 执行 AI 分析并显示结果
 * @param {string} toolId - 工具 ID
 * @param {string} content - 需要分析的内容
 */
async function executeAIAnalyzeWithUI(toolId, content) {
    if (!content.trim()) {
        showToast('请先输入内容', 'warning');
        return;
    }

    showToast('🔍 AI 正在分析...', 'info');

    const result = await executeAIAnalyze(toolId, content);

    if (result.success) {
        showAIAnalyzeResultModal(result.result);
        showToast('AI 分析完成', 'success');
    } else {
        showToast(`分析失败: ${result.error}`, 'error');
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
        },
        onAnalyze: (result) => {
            showAIAnalyzeResultModal(result);
        },
        getContent: () => document.getElementById('mock-output')?.value || ''
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
        onAnalyze: (result) => {
            showAIAnalyzeResultModal(result);
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
        },
        onFix: (result) => {
            const output = document.getElementById('jsonschema-output');
            if (output) output.value = result;
        },
        getContent: () => document.getElementById('jsonschema-output')?.value || ''
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

    // AI 分析按钮
    if (aiStatus.features.analyze && promptConfig.analyze) {
        const analyzeBtn = document.createElement('button');
        analyzeBtn.className = 'btn btn-sm ai-helper-btn ai-analyze-btn';
        analyzeBtn.innerHTML = '🔍 AI 分析';
        analyzeBtn.title = promptConfig.analyze.placeholder || 'AI 分析';
        analyzeBtn.addEventListener('click', async () => {
            const content = config.getContent ? config.getContent() : '';
            if (!content.trim()) {
                if (typeof showToast === 'function') {
                    showToast('请先输入内容', 'warning');
                }
                return;
            }
            if (typeof showToast === 'function') {
                showToast('🔍 AI 正在分析...', 'info');
            }
            const result = await executeAIAnalyze(toolId, content);
            if (result.success) {
                if (config.onAnalyze) {
                    config.onAnalyze(result.result);
                } else {
                    showAIAnalyzeResultModal(result.result);
                }
                if (typeof showToast === 'function') {
                    showToast('AI 分析完成', 'success');
                }
            } else {
                if (typeof showToast === 'function') {
                    showToast(`分析失败: ${result.error}`, 'error');
                }
            }
        });
        container.appendChild(analyzeBtn);
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
window.cleanAICodeBlockOutput = cleanAICodeBlockOutput;
window.executeAIGenerate = executeAIGenerate;
window.executeAIFix = executeAIFix;
window.executeAIAnalyze = executeAIAnalyze;
window.createAIHelperButtons = createAIHelperButtons;
window.initToolAIHelper = initToolAIHelper;
window.showAIGenerateModal = showAIGenerateModal;
window.showAIAnalyzeResultModal = showAIAnalyzeResultModal;
window.renderAnalyzeMarkdown = renderAnalyzeMarkdown;
window.executeAIAnalyzeWithUI = executeAIAnalyzeWithUI;
window.submitAIGenerate = submitAIGenerate;
window.initToolAIButtons = initToolAIButtons;
window.refreshAllToolAIButtons = refreshAllToolAIButtons;
window.initPageAIButtons = initPageAIButtons;
window.TOOL_AI_BUTTON_CONFIG = TOOL_AI_BUTTON_CONFIG;
