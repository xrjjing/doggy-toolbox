// AI 配置页面逻辑

let currentProviderConfig = {
    id: null,
    type: 'openai',
    category: 'openai',
    models: []
};

// 工具 AI 配置缓存
let toolAIDefinitions = null;
let toolAIConfig = null;

// 初始化 AI 配置页面
async function initAISettingsPage() {
    // 等待 API 就绪后再加载
    await waitForAPIReady();
    await loadProviders();
    initProviderTypeListeners();
    await loadToolAIData();
}

// 等待 pywebview API 就绪
async function waitForAPIReady(maxRetries = 10, delayMs = 200) {
    for (let i = 0; i < maxRetries; i++) {
        if (window.pywebview && window.pywebview.api) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    console.warn('PyWebView API 未就绪，AI 功能开关可能不可用');
    return false;
}

// 切换主 Tab
function switchAIMainTab(tabName) {
    // 更新 Tab 按钮状态
    document.querySelectorAll('.ai-main-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // 更新内容区域
    document.querySelectorAll('.ai-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `ai-tab-${tabName}`);
    });

    // 如果切换到功能开关 Tab，渲染工具列表
    if (tabName === 'features') {
        renderToolAICategories();
    }
}

// 加载工具 AI 配置数据
async function loadToolAIData() {
    try {
        const api = window.pywebview && window.pywebview.api;
        if (!api) return;

        // 并行加载定义和配置
        const [definitions, config] = await Promise.all([
            api.get_tool_ai_definitions(),
            api.get_tool_ai_config()
        ]);

        toolAIDefinitions = definitions;
        toolAIConfig = config;
    } catch (error) {
        console.error('加载工具 AI 配置失败:', error);
    }
}

// 渲染工具 AI 分类列表
function renderToolAICategories() {
    if (!toolAIDefinitions || !toolAIConfig) {
        console.warn('工具 AI 配置数据未加载');
        return;
    }

    const container = document.getElementById('tool-ai-categories');
    if (!container) return;

    // 更新全局开关状态
    const globalToggle = document.getElementById('global-ai-toggle');
    if (globalToggle) {
        globalToggle.checked = toolAIConfig.global_enabled !== false;
    }

    const globalEnabled = toolAIConfig.global_enabled !== false;

    // 渲染分类
    container.innerHTML = toolAIDefinitions.categories.map(category => {
        const enabledCount = category.tools.filter(tool => {
            const toolConfig = toolAIConfig.tools[tool.id];
            return toolConfig ? toolConfig.enabled : true;
        }).length;

        return `
            <div class="tool-category-card" data-category="${category.id}">
                <div class="category-header" onclick="toggleCategory('${category.id}')">
                    <div class="category-title">
                        <h4>${getCategoryIcon(category.id)} ${category.name}</h4>
                        <span class="category-count">${enabledCount}/${category.tools.length} 已启用</span>
                    </div>
                    <span class="category-toggle">▼</span>
                </div>
                <div class="category-tools" id="category-tools-${category.id}">
                    ${category.tools.map(tool => renderToolItem(tool, globalEnabled)).join('')}
                </div>
            </div>
        `;
    }).join('');
}

// 获取分类图标
function getCategoryIcon(categoryId) {
    const icons = {
        'generators': '🔧',
        'data': '📊',
        'text': '📝',
        'encoding': '🔄',
        'dev': '⚙️',
        'crypto': '🔐'
    };
    return icons[categoryId] || '📦';
}

// 渲染单个工具项
function renderToolItem(tool, globalEnabled) {
    const toolConfig = toolAIConfig.tools[tool.id] || { enabled: true, features: {} };
    const isEnabled = toolConfig.enabled !== false;

    const featureBadges = tool.features.map(f => {
        const labels = { generate: 'AI 生成', fix: 'AI 修复', analyze: 'AI 分析' };
        return `<span class="feature-badge ${f}">${labels[f] || f}</span>`;
    }).join('');

    return `
        <div class="tool-item" data-tool="${tool.id}">
            <div class="tool-info">
                <span class="tool-name">${tool.name}</span>
                <div class="tool-features">${featureBadges}</div>
            </div>
            <label class="tool-toggle">
                <input type="checkbox"
                       ${isEnabled ? 'checked' : ''}
                       ${!globalEnabled ? 'disabled' : ''}
                       onchange="toggleToolAI('${tool.id}', this.checked)">
                <span class="tool-toggle-slider"></span>
            </label>
        </div>
    `;
}

// 切换分类展开/折叠
function toggleCategory(categoryId) {
    const card = document.querySelector(`.tool-category-card[data-category="${categoryId}"]`);
    const header = card.querySelector('.category-header');
    const tools = card.querySelector('.category-tools');

    header.classList.toggle('collapsed');
    tools.classList.toggle('collapsed');
}

// 切换全局 AI 开关
async function toggleGlobalAI(enabled) {
    try {
        const api = window.pywebview && window.pywebview.api;
        if (!api) {
            showToast('后端 API 未就绪，请稍后重试', 'warning');
            // 恢复开关状态
            document.getElementById('global-ai-toggle').checked = !enabled;
            return;
        }

        const result = await api.set_global_ai_enabled(enabled);
        if (result.success) {
            toolAIConfig.global_enabled = enabled;
            renderToolAICategories();
            showToast(enabled ? 'AI 功能已全局启用' : 'AI 功能已全局禁用', 'success');
            // 刷新所有工具页面的 AI 按钮
            if (typeof refreshAllToolAIButtons === 'function') {
                refreshAllToolAIButtons();
            }
        } else {
            showToast(`操作失败: ${result.error}`, 'error');
            // 恢复开关状态
            document.getElementById('global-ai-toggle').checked = !enabled;
        }
    } catch (error) {
        console.error('切换全局 AI 开关失败:', error);
        showToast('操作失败', 'error');
        document.getElementById('global-ai-toggle').checked = !enabled;
    }
}

// 切换单个工具的 AI 开关
async function toggleToolAI(toolId, enabled) {
    try {
        const api = window.pywebview && window.pywebview.api;
        if (!api) {
            showToast('后端 API 未就绪，请稍后重试', 'warning');
            // 恢复开关状态
            const checkbox = document.querySelector(`.tool-item[data-tool="${toolId}"] input`);
            if (checkbox) checkbox.checked = !enabled;
            return;
        }

        const result = await api.set_tool_ai_enabled(toolId, enabled);
        if (result.success) {
            // 更新本地缓存
            if (!toolAIConfig.tools[toolId]) {
                toolAIConfig.tools[toolId] = { enabled: enabled, features: {} };
            } else {
                toolAIConfig.tools[toolId].enabled = enabled;
            }
            // 更新分类计数
            updateCategoryCount(toolId);
            // 刷新该工具的 AI 按钮
            if (typeof initToolAIButtons === 'function') {
                initToolAIButtons(toolId);
            }
        } else {
            showToast(`操作失败: ${result.error}`, 'error');
            // 恢复开关状态
            const checkbox = document.querySelector(`.tool-item[data-tool="${toolId}"] input`);
            if (checkbox) checkbox.checked = !enabled;
        }
    } catch (error) {
        console.error('切换工具 AI 开关失败:', error);
        showToast('操作失败', 'error');
        const checkbox = document.querySelector(`.tool-item[data-tool="${toolId}"] input`);
        if (checkbox) checkbox.checked = !enabled;
    }
}

// 更新分类计数
function updateCategoryCount(toolId) {
    // 找到工具所属的分类
    for (const category of toolAIDefinitions.categories) {
        const tool = category.tools.find(t => t.id === toolId);
        if (tool) {
            const enabledCount = category.tools.filter(t => {
                const config = toolAIConfig.tools[t.id];
                return config ? config.enabled : true;
            }).length;

            const countEl = document.querySelector(`.tool-category-card[data-category="${category.id}"] .category-count`);
            if (countEl) {
                countEl.textContent = `${enabledCount}/${category.tools.length} 已启用`;
            }
            break;
        }
    }
}

// 全部启用
async function enableAllTools() {
    try {
        const api = window.pywebview && window.pywebview.api;
        if (!api) return;

        // 构建全部启用的配置
        const newConfig = {
            global_enabled: true,
            tools: {}
        };

        for (const category of toolAIDefinitions.categories) {
            for (const tool of category.tools) {
                newConfig.tools[tool.id] = {
                    enabled: true,
                    features: tool.features.reduce((acc, f) => ({ ...acc, [f]: true }), {})
                };
            }
        }

        const result = await api.save_tool_ai_config(newConfig);
        if (result.success) {
            toolAIConfig = newConfig;
            renderToolAICategories();
            showToast('已启用所有工具的 AI 功能', 'success');
        } else {
            showToast(`操作失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('全部启用失败:', error);
        showToast('操作失败', 'error');
    }
}

// 全部禁用
async function disableAllTools() {
    try {
        const api = window.pywebview && window.pywebview.api;
        if (!api) return;

        // 构建全部禁用的配置
        const newConfig = {
            global_enabled: true, // 保持全局开关开启，只禁用各个工具
            tools: {}
        };

        for (const category of toolAIDefinitions.categories) {
            for (const tool of category.tools) {
                newConfig.tools[tool.id] = {
                    enabled: false,
                    features: tool.features.reduce((acc, f) => ({ ...acc, [f]: true }), {})
                };
            }
        }

        const result = await api.save_tool_ai_config(newConfig);
        if (result.success) {
            toolAIConfig = newConfig;
            renderToolAICategories();
            showToast('已禁用所有工具的 AI 功能', 'success');
        } else {
            showToast(`操作失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('全部禁用失败:', error);
        showToast('操作失败', 'error');
    }
}

// 初始化 Provider 类型选择监听器
function initProviderTypeListeners() {
    // 监听 OpenAI 子类型选择
    document.querySelectorAll('.subtype-option input[type="radio"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            // 更新选中状态样式
            document.querySelectorAll('.subtype-option').forEach(opt => {
                opt.classList.toggle('active', opt.querySelector('input').checked);
            });
            // 更新表单字段
            updateFormFields();
        });
    });
}

// 切换 Provider 类别（OpenAI 系列 / Claude）
function switchProviderCategory(category) {
    currentProviderConfig.category = category;

    // 更新 Tab 样式
    document.querySelectorAll('.type-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.category === category);
    });

    // 显示/隐藏子类型选项
    document.getElementById('openai-subtype').style.display = category === 'openai' ? 'block' : 'none';
    document.getElementById('claude-subtype').style.display = category === 'claude' ? 'block' : 'none';

    // 设置当前类型
    if (category === 'claude') {
        currentProviderConfig.type = 'claude';
    } else {
        // OpenAI 系列：根据选中的 radio 确定类型
        const checkedRadio = document.querySelector('.subtype-option input[type="radio"]:checked');
        currentProviderConfig.type = checkedRadio ? checkedRadio.value : 'openai';
    }

    // 更新表单字段
    updateFormFields();
}

// 加载 Provider 列表
async function loadProviders() {
    try {
        const api = window.pywebview && window.pywebview.api;
        if (!api || typeof api.get_ai_providers !== 'function') {
            console.warn('PyWebView API 未就绪，稍后重试');
            return;
        }
        const providers = await api.get_ai_providers();
        renderProviders(providers);
    } catch (error) {
        console.error('加载 Provider 列表失败:', error);
        showToast('加载 Provider 列表失败', 'error');
    }
}

// 当前列表显示的分类
let currentListCategory = 'openai';

// 切换列表分类
function switchListCategory(category) {
    currentListCategory = category;

    // 更新 Tab 样式
    document.querySelectorAll('.list-category-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.category === category);
    });

    // 重新渲染列表
    loadProviders();
}

// 渲染 Provider 列表
function renderProviders(providers) {
    const container = document.getElementById('providers-list');

    if (!providers || providers.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>暂无 AI Provider 配置</p>
                <p>点击"添加 Provider"按钮开始配置</p>
            </div>
        `;
        return;
    }

    // 按分类过滤
    const filteredProviders = providers.filter(p => {
        if (currentListCategory === 'openai') {
            return p.type === 'openai' || p.type === 'openai-compatible';
        } else {
            return p.type === 'claude';
        }
    });

    if (filteredProviders.length === 0) {
        const categoryName = currentListCategory === 'openai' ? 'OpenAI' : 'Claude';
        container.innerHTML = `
            <div class="empty-state">
                <p>暂无 ${categoryName} Provider 配置</p>
                <p>点击"添加 Provider"按钮开始配置</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filteredProviders.map(p => `
        <div class="provider-card ${p.active ? 'active' : ''}">
            <div class="provider-header">
                <div class="provider-info">
                    <h4>${escapeHtml(p.name)}</h4>
                    <span class="provider-type">${getProviderTypeLabel(p.type)}</span>
                </div>
                ${p.active ? '<span class="badge-active">当前</span>' : ''}
            </div>

            <div class="provider-stats">
                <div class="stat-item">
                    <span class="stat-value">${p.stats?.total_requests || 0}</span>
                    <span class="stat-label">请求</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${p.stats?.avg_latency || 0}s</span>
                    <span class="stat-label">延迟</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${calculateFailureRate(p.stats)}%</span>
                    <span class="stat-label">失败</span>
                </div>
            </div>

            <div class="provider-actions">
                <button class="ai-btn ai-btn-outline btn-sm" onclick="switchProvider('${p.id}')" ${p.active ? 'disabled' : ''}>
                    ${p.active ? '✓ 使用中' : '切换'}
                </button>
                <button class="ai-btn ai-btn-ghost btn-sm" onclick="editProvider('${p.id}')">编辑</button>
                <button class="ai-btn ai-btn-ghost btn-sm" onclick="deleteProvider('${p.id}')">删除</button>
            </div>
        </div>
    `).join('');
}

// 获取 Provider 类型标签
function getProviderTypeLabel(type) {
    const labels = {
        'openai': 'OpenAI 官方',
        'claude': 'Claude',
        'openai-compatible': '第三方兼容'
    };
    return labels[type] || type;
}

// 计算失败率
function calculateFailureRate(stats) {
    if (!stats || !stats.total_requests) return 0;
    const rate = (stats.failed_requests / stats.total_requests) * 100;
    return rate.toFixed(1);
}

// 打开添加 Provider 弹窗
function openAddProviderModal() {
    currentProviderConfig = {
        id: null,
        type: 'openai-compatible',
        category: 'openai',
        models: []
    };

    document.getElementById('modal-title').textContent = '添加 AI Provider';
    resetForm();

    // 重置 Tab 和子类型选项
    document.querySelectorAll('.type-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.category === 'openai');
    });
    document.getElementById('openai-subtype').style.display = 'block';
    document.getElementById('claude-subtype').style.display = 'none';

    // 重置 OpenAI 子类型选项 - 默认选择第三方兼容
    document.querySelectorAll('.subtype-option').forEach(opt => {
        const radio = opt.querySelector('input[type="radio"]');
        const isCompatible = radio.value === 'openai-compatible';
        radio.checked = isCompatible;
        opt.classList.toggle('active', isCompatible);
    });

    updateFormFields();
    document.getElementById('provider-modal').style.display = 'flex';
}

// 编辑 Provider
async function editProvider(providerId) {
    try {
        // 获取所有 Provider
        const api = window.pywebview && window.pywebview.api;
        if (!api) {
            throw new Error('后端 API 未就绪');
        }

        const providers = await api.get_ai_providers();
        const provider = providers.find(p => p.id === providerId);

        if (!provider) {
            showToast('未找到指定的 Provider', 'error');
            return;
        }

        // 设置当前编辑的 Provider ID
        currentProviderConfig.id = provider.id;
        currentProviderConfig.type = provider.type;
        // 确定分类：claude 独立分类，openai 和 openai-compatible 归为 openai 系列
        currentProviderConfig.category = provider.type === 'claude' ? 'claude' : 'openai';

        // 先切换顶部分类 Tab，确保显示正确的表单区域
        switchProviderCategory(currentProviderConfig.category);

        // 选择对应的子类型（仅 OpenAI 系列需要）
        if (currentProviderConfig.category === 'openai') {
            const subtypeRadio = document.querySelector(`input[name="provider-type"][value="${provider.type}"]`);
            if (subtypeRadio) {
                subtypeRadio.checked = true;
                // 触发 change 事件以更新表单字段
                subtypeRadio.dispatchEvent(new Event('change'));
            }
        }

        // 更新选中状态样式
        document.querySelectorAll('.subtype-option').forEach(opt => {
            opt.classList.toggle('active', opt.querySelector('input').checked);
        });

        // 先更新表单字段显示（决定哪些字段可见）
        updateFormFields();

        // 再填充表单数据（会覆盖 updateFormFields 设置的默认值）
        const config = provider.config || {};

        // 基本信息
        document.getElementById('provider-name').value = provider.name || '';
        document.getElementById('api-key').value = config.api_key || '';

        // Base URL - 在 updateFormFields 之后再次设置，覆盖默认值
        if (config.base_url) {
            document.getElementById('base-url').value = config.base_url;
        }

        // 可选字段
        if (document.getElementById('organization')) {
            document.getElementById('organization').value = config.organization || '';
        }
        if (document.getElementById('project')) {
            document.getElementById('project').value = config.project || '';
        }

        // 默认模型
        const defaultModel = config.default_model || '';
        const modelSelect = document.getElementById('default-model');

        // 编辑模式：恢复模型选项
        if (defaultModel) {
            // 先添加当前默认模型作为选项
            modelSelect.innerHTML = `<option value="${defaultModel}">${defaultModel}</option>`;
            modelSelect.value = defaultModel;
            modelSelect.disabled = false;
        }

        // 如果有 models 列表，更新完整的模型列表
        if (provider.models && provider.models.length > 0) {
            currentProviderConfig.models = provider.models;
            updateModelOptions(provider.models);
            // 重新设置默认模型（因为 updateModelOptions 会重建列表）
            if (defaultModel) {
                modelSelect.value = defaultModel;
            }
        }

        // 高级配置反显
        if (config.temperature !== undefined) {
            document.getElementById('temperature').value = config.temperature;
            updateRangeValue('temperature', 'temp-value');
        }
        if (config.top_p !== undefined) {
            document.getElementById('top-p').value = config.top_p;
            updateRangeValue('top-p', 'top-p-value');
        }
        if (config.max_tokens !== undefined) {
            document.getElementById('max-tokens').value = config.max_tokens;
        }
        if (config.timeout !== undefined) {
            document.getElementById('timeout').value = config.timeout;
        }
        if (config.frequency_penalty !== undefined) {
            document.getElementById('freq-penalty').value = config.frequency_penalty;
            updateRangeValue('freq-penalty', 'freq-value');
        }
        if (config.presence_penalty !== undefined) {
            document.getElementById('pres-penalty').value = config.presence_penalty;
            updateRangeValue('pres-penalty', 'pres-value');
        }
        if (config.max_retries !== undefined) {
            document.getElementById('max-retries').value = config.max_retries;
        }
        if (config.stream !== undefined) {
            document.getElementById('stream-enabled').checked = config.stream;
        }
        if (config.proxy) {
            document.getElementById('proxy').value = config.proxy;
        }

        // 更新表单字段显示
        updateFormFields();

        // 打开弹窗
        document.getElementById('modal-title').textContent = '编辑 AI Provider';
        document.getElementById('provider-modal').style.display = 'flex';

        showToast('已加载 Provider 配置', 'success');
    } catch (error) {
        console.error('加载 Provider 配置失败:', error);
        showToast(`加载失败：${error.message}`, 'error');
    }
}

// 关闭弹窗
function closeProviderModal() {
    document.getElementById('provider-modal').style.display = 'none';
    resetForm();
}

// 重置表单
function resetForm() {
    // 重置类型状态 - 默认第三方兼容
    currentProviderConfig.type = 'openai-compatible';
    currentProviderConfig.category = 'openai';

    document.getElementById('provider-name').value = '';
    document.getElementById('api-key').value = '';
    document.getElementById('base-url').value = 'https://api.openai.com/v1';
    document.getElementById('organization').value = '';
    document.getElementById('default-model').innerHTML = '<option value="">⏳ 请先获取模型列表</option>';
    document.getElementById('default-model').disabled = true;
    document.getElementById('manual-model-group').style.display = 'none';
    document.getElementById('temperature').value = 0.7;
    document.getElementById('top-p').value = 1;
    document.getElementById('max-tokens').value = 2000;
    document.getElementById('timeout').value = 60;
    document.getElementById('freq-penalty').value = 0;
    document.getElementById('pres-penalty').value = 0;
    document.getElementById('max-retries').value = 3;
    document.getElementById('stream-enabled').checked = true;
    document.getElementById('proxy').value = '';

    updateRangeValue('temperature', 'temp-value');
    updateRangeValue('top-p', 'top-p-value');
    updateRangeValue('freq-penalty', 'freq-value');
    updateRangeValue('pres-penalty', 'pres-value');
}

// 更新表单字段（根据 Provider 类型）
function updateFormFields() {
    // 获取当前类型
    let type;
    if (currentProviderConfig.category === 'claude') {
        type = 'claude';
    } else {
        const checkedRadio = document.querySelector('.subtype-option input[type="radio"]:checked');
        type = checkedRadio ? checkedRadio.value : 'openai';
    }
    currentProviderConfig.type = type;
    currentProviderConfig.category = type;  // 同步设置 category

    // 隐藏所有专用字段
    document.getElementById('field-api-key').style.display = 'none';
    document.getElementById('field-base-url').style.display = 'none';
    document.getElementById('field-organization').style.display = 'none';
    document.getElementById('field-api-version').style.display = 'none';
    document.getElementById('third-party-fields').style.display = 'none';

    // 判断是否为编辑模式（有 id 表示编辑）
    const isEditMode = !!currentProviderConfig.id;
    const currentBaseUrl = document.getElementById('base-url').value;

    // 根据类型显示对应字段
    if (type === 'openai') {
        // OpenAI 官方：使用 API Key
        document.getElementById('field-api-key').style.display = 'block';
        document.getElementById('field-organization').style.display = 'block';
        // 仅在新建模式或无值时设置默认 Base URL
        if (!isEditMode || !currentBaseUrl) {
            document.getElementById('base-url').value = 'https://api.openai.com/v1';
        }
    } else if (type === 'claude') {
        // Claude：使用 API Key + Base URL
        document.getElementById('field-api-key').style.display = 'block';
        document.getElementById('field-base-url').style.display = 'block';
        document.getElementById('field-api-version').style.display = 'block';
        // 仅在新建模式或无值时设置默认值
        if (!isEditMode || !currentBaseUrl) {
            document.getElementById('base-url').value = 'https://api.anthropic.com';
        }
        document.getElementById('url-hint').textContent = 'Anthropic 官方地址';
    } else if (type === 'openai-compatible') {
        // 第三方兼容：使用 API Key + Base URL
        document.getElementById('field-api-key').style.display = 'block';
        document.getElementById('field-base-url').style.display = 'block';
        document.getElementById('third-party-fields').style.display = 'block';
        // 编辑模式下不清空 base_url
        if (!isEditMode && !currentBaseUrl) {
            document.getElementById('base-url').value = '';
        }
        document.getElementById('url-hint').innerHTML = '⚠️ 请输入第三方 API 地址';
    }

    // 仅在新建模式下清空模型列表
    if (!isEditMode) {
        document.getElementById('default-model').innerHTML = '<option value="">⏳ 请先获取模型列表</option>';
        document.getElementById('default-model').disabled = true;
    }
}

// 获取模型列表
async function fetchModels() {
    const type = currentProviderConfig.type;
    const baseUrl = document.getElementById('base-url').value.trim();
    const apiKey = document.getElementById('api-key').value.trim();

    // OpenAI 官方不需要用户输入 Base URL
    if (type !== 'openai' && !baseUrl) {
        showToast('请先输入 Base URL', 'warning');
        return;
    }

    if (!apiKey) {
        showToast('请先输入 API Key', 'warning');
        return;
    }

    const modelSelect = document.getElementById('default-model');
    const fetchBtn = document.getElementById('fetch-models-btn');

    modelSelect.disabled = true;
    fetchBtn.disabled = true;
    fetchBtn.textContent = '🔄 获取中...';

    try {
        const tempConfig = {
            type: type,
            base_url: type === 'openai' ? 'https://api.openai.com/v1' : baseUrl,
            api_key: apiKey
        };

        if (type === 'openai-compatible') {
            tempConfig.compatibility = {
                auth_header: document.getElementById('auth-header').value,
                auth_prefix: document.getElementById('auth-prefix').value,
                custom_headers: {}
            };
        }

        const result = await pywebview.api.fetch_ai_models(tempConfig);

        if (result.success && result.models && result.models.length > 0) {
            currentProviderConfig.models = result.models;
            updateModelOptions(result.models);
            showToast(`成功获取 ${result.models.length} 个模型`, 'success');
        } else {
            // 获取失败或无模型，直接启用手动输入
            const errorMsg = result.error || '未获取到模型列表';
            showToast(`${errorMsg}，请手动输入模型名称`, 'warning');
            enableManualModelInput();
        }
    } catch (error) {
        console.error('获取模型列表失败:', error);
        showToast('获取模型列表失败，请手动输入模型名称', 'warning');
        enableManualModelInput();
    } finally {
        modelSelect.disabled = false;
        fetchBtn.disabled = false;
        fetchBtn.textContent = '🔄 获取模型';
    }
}

// 更新模型下拉列表
function updateModelOptions(models) {
    const modelSelect = document.getElementById('default-model');
    modelSelect.innerHTML = '';

    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name || model.id;
        modelSelect.appendChild(option);
    });

    // 添加手动输入选项
    const manualOption = document.createElement('option');
    manualOption.value = '__manual__';
    manualOption.textContent = '✏️ 手动输入模型名';
    modelSelect.appendChild(manualOption);

    modelSelect.addEventListener('change', handleModelSelect);
}

// 处理模型选择
function handleModelSelect(e) {
    const manualGroup = document.getElementById('manual-model-group');
    if (e.target.value === '__manual__') {
        manualGroup.style.display = 'block';
    } else {
        manualGroup.style.display = 'none';
    }
}

// 启用手动输入
function enableManualModelInput() {
    const modelSelect = document.getElementById('default-model');
    const manualGroup = document.getElementById('manual-model-group');
    const manualInput = document.getElementById('manual-model-input');

    // 设置下拉框为手动输入选项
    modelSelect.innerHTML = '<option value="__manual__">✏️ 手动输入模型名</option>';
    modelSelect.value = '__manual__';
    modelSelect.disabled = false;

    // 显示手动输入框
    if (manualGroup) {
        manualGroup.style.display = 'block';
    }

    // 聚焦到输入框
    if (manualInput) {
        manualInput.focus();
    }
}

// 测试连接
async function testConnection() {
    const type = currentProviderConfig.type;
    const baseUrl = document.getElementById('base-url').value.trim();
    const apiKey = document.getElementById('api-key').value.trim();
    const model = getSelectedModel();

    // OpenAI 官方不需要用户输入 Base URL
    if (type !== 'openai' && !baseUrl) {
        showToast('请先填写 Base URL', 'warning');
        return;
    }

    if (!apiKey) {
        showToast('请先填写 API Key', 'warning');
        return;
    }

    showToast('🔌 正在测试连接...', 'info');

    try {
        const tempConfig = {
            type: type,
            config: {
                api_key: apiKey,
                base_url: type === 'openai' ? 'https://api.openai.com/v1' : baseUrl,
                default_model: model || (type === 'claude' ? 'claude-sonnet-4-5-20250514' : 'gpt-4.1')
            }
        };

        if (type === 'openai') {
            tempConfig.config.organization = document.getElementById('organization')?.value;
        } else if (type === 'claude') {
            // 确保 api_version 有值，否则使用默认值
            const apiVersionInput = document.getElementById('api-version');
            const apiVersion = apiVersionInput?.value?.trim();
            tempConfig.config.api_version = apiVersion || '2023-06-01';
        } else if (type === 'openai-compatible') {
            tempConfig.compatibility = {
                endpoint: document.getElementById('endpoint').value,
                auth_header: document.getElementById('auth-header').value,
                auth_prefix: document.getElementById('auth-prefix').value,
                verify_ssl: document.getElementById('verify-ssl').checked
            };
        }

        const result = await pywebview.api.test_ai_connection(tempConfig);

        if (result.success) {
            showToast(`✅ 连接成功！延迟: ${result.latency}s`, 'success');
        } else {
            showToast(`❌ 连接失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('测试连接失败:', error);
        showToast('❌ 连接测试失败', 'error');
    }
}

// 保存 Provider
async function saveProvider() {
    const type = currentProviderConfig.type;
    const name = document.getElementById('provider-name').value.trim();
    const baseUrl = document.getElementById('base-url').value.trim();
    const apiKey = document.getElementById('api-key').value.trim();
    const model = getSelectedModel();

    // 基础验证
    if (!name) {
        showToast('请填写显示名称', 'warning');
        return;
    }
    // OpenAI 官方不需要用户输入 Base URL
    if (type !== 'openai' && !baseUrl) {
        showToast('请填写 Base URL', 'warning');
        return;
    }
    if (!apiKey) {
        showToast('请填写 API Key', 'warning');
        return;
    }
    if (!model) {
        showToast('请选择或输入默认模型', 'warning');
        return;
    }

    const config = {
        id: currentProviderConfig.id || generateProviderId(),
        type: type,
        name: name,
        enabled: true,
        config: {
            api_key: apiKey,
            base_url: type === 'openai' ? 'https://api.openai.com/v1' : baseUrl,
            default_model: model,
            temperature: parseFloat(document.getElementById('temperature').value),
            max_tokens: parseInt(document.getElementById('max-tokens').value),
            top_p: parseFloat(document.getElementById('top-p').value),
            frequency_penalty: parseFloat(document.getElementById('freq-penalty').value),
            presence_penalty: parseFloat(document.getElementById('pres-penalty').value),
            timeout: parseInt(document.getElementById('timeout').value),
            max_retries: parseInt(document.getElementById('max-retries').value),
            stream: document.getElementById('stream-enabled').checked,
            proxy: document.getElementById('proxy').value.trim()
        },
        capabilities: {
            streaming: true,
            vision: false,
            tools: false,
            json_mode: false
        },
        stats: {
            total_requests: 0,
            failed_requests: 0,
            total_latency: 0,
            avg_latency: 0
        }
    };

    // 根据类型添加专用配置
    if (type === 'openai') {
        config.config.organization = document.getElementById('organization')?.value.trim();
    } else if (type === 'claude') {
        config.config.api_version = document.getElementById('api-version')?.value;
    } else if (type === 'openai-compatible') {
        config.compatibility = {
            endpoint: document.getElementById('endpoint').value,
            auth_header: document.getElementById('auth-header').value,
            auth_prefix: document.getElementById('auth-prefix').value,
            verify_ssl: document.getElementById('verify-ssl').checked
        };
    }

    try {
        const result = await pywebview.api.save_ai_provider(config);
        if (result.success) {
            showToast('配置保存成功！', 'success');
            closeProviderModal();
            await loadProviders();
        } else {
            showToast(`保存失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('保存配置失败:', error);
        showToast('保存配置失败', 'error');
    }
}

// 获取选中的模型
function getSelectedModel() {
    const modelSelect = document.getElementById('default-model');
    const selectedValue = modelSelect.value;

    if (selectedValue === '__manual__') {
        const manualInput = document.getElementById('manual-model-input');
        return manualInput ? manualInput.value.trim() : '';
    }

    return selectedValue;
}

// 生成 Provider ID
function generateProviderId() {
    const type = currentProviderConfig.type;
    const timestamp = Date.now();
    return `${type}-${timestamp}`;
}

// 切换 Provider
async function switchProvider(providerId) {
    try {
        const result = await pywebview.api.switch_ai_provider(providerId);
        if (result.success) {
            showToast('切换成功', 'success');
            await loadProviders();
        } else {
            showToast(`切换失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('切换 Provider 失败:', error);
        showToast('切换失败', 'error');
    }
}

// 删除 Provider
async function deleteProvider(providerId) {
    if (!confirm('确定要删除这个 Provider 吗？')) {
        return;
    }

    try {
        const result = await pywebview.api.delete_ai_provider(providerId);
        if (result.success) {
            showToast('删除成功', 'success');
            await loadProviders();
        } else {
            showToast(`删除失败: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('删除 Provider 失败:', error);
        showToast('删除失败', 'error');
    }
}

// 更新滑块显示值
function updateRangeValue(sliderId, displayId) {
    const slider = document.getElementById(sliderId);
    const display = document.getElementById(displayId);
    if (slider && display) {
        display.textContent = slider.value;
    }
}

// 切换密码可见性
function togglePasswordVisibility() {
    const input = document.getElementById('api-key');
    const eyeOpen = document.querySelector('.toggle-password-btn .eye-open');
    const eyeClosed = document.querySelector('.toggle-password-btn .eye-closed');

    if (input.type === 'password') {
        input.type = 'text';
        if (eyeOpen) eyeOpen.style.display = 'none';
        if (eyeClosed) eyeClosed.style.display = 'block';
    } else {
        input.type = 'password';
        if (eyeOpen) eyeOpen.style.display = 'block';
        if (eyeClosed) eyeClosed.style.display = 'none';
    }
}


// 显式暴露：供 app_core 的 PAGE_INIT_MAP 调用，并兼容旧的大小写写法
window.initAISettingsPage = initAISettingsPage;
window.initAiSettingsPage = initAISettingsPage;
