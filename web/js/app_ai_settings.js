// AI 配置页面逻辑

let currentProviderConfig = {
    id: null,
    type: 'openai',
    category: 'openai',
    models: []
};

// 初始化 AI 配置页面
async function initAISettingsPage() {
    await loadProviders();
    initProviderTypeListeners();
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
        const providers = await pywebview.api.get_ai_providers();
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
                ${p.active ? '<span class="badge-active">当前使用</span>' : ''}
            </div>

            <div class="provider-stats">
                <div class="stat-item">
                    <span class="stat-label">请求次数</span>
                    <span class="stat-value">${p.stats?.total_requests || 0}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">平均延迟</span>
                    <span class="stat-value">${p.stats?.avg_latency || 0}s</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">失败率</span>
                    <span class="stat-value">${calculateFailureRate(p.stats)}%</span>
                </div>
            </div>

            <div class="provider-actions">
                <button class="ai-btn ai-btn-outline btn-sm" onclick="switchProvider('${p.id}')" ${p.active ? 'disabled' : ''}>
                    ${p.active ? '✓ 当前使用' : '切换'}
                </button>
                <button class="ai-btn ai-btn-ghost btn-sm" onclick="editProvider('${p.id}')">
                    编辑
                </button>
                <button class="ai-btn ai-btn-ghost btn-sm" onclick="deleteProvider('${p.id}')">
                    删除
                </button>
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
    // TODO: 实现编辑功能
    showToast('编辑功能开发中', 'info');
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
    document.getElementById('auth-json').value = '';
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

    // 隐藏所有专用字段
    document.getElementById('field-auth-json').style.display = 'none';
    document.getElementById('field-api-key').style.display = 'none';
    document.getElementById('field-base-url').style.display = 'none';
    document.getElementById('field-organization').style.display = 'none';
    document.getElementById('field-api-version').style.display = 'none';
    document.getElementById('third-party-fields').style.display = 'none';

    // 根据类型显示对应字段
    if (type === 'openai') {
        // OpenAI 官方：支持 API Key 或 auth.json
        document.getElementById('field-auth-json').style.display = 'block';
        document.getElementById('field-api-key').style.display = 'block';
        document.getElementById('field-organization').style.display = 'block';
        // 显示"二选一"提示
        document.getElementById('api-key-optional-hint').style.display = 'inline';
        document.getElementById('api-key-required-hint').style.display = 'none';
        // 自动设置默认 Base URL（隐藏但有值）
        document.getElementById('base-url').value = 'https://api.openai.com/v1';
        // 设置互斥监听
        setupAuthMutualExclusion();
    } else if (type === 'claude') {
        // Claude：使用 API Key + Base URL
        document.getElementById('field-api-key').style.display = 'block';
        document.getElementById('field-base-url').style.display = 'block';
        document.getElementById('field-api-version').style.display = 'block';
        document.getElementById('base-url').value = 'https://api.anthropic.com';
        document.getElementById('url-hint').textContent = 'Anthropic 官方地址';
        // 显示必填提示
        document.getElementById('api-key-optional-hint').style.display = 'none';
        document.getElementById('api-key-required-hint').style.display = 'inline';
    } else if (type === 'openai-compatible') {
        // 第三方兼容：使用 API Key + Base URL
        document.getElementById('field-api-key').style.display = 'block';
        document.getElementById('field-base-url').style.display = 'block';
        document.getElementById('third-party-fields').style.display = 'block';
        document.getElementById('base-url').value = '';
        document.getElementById('url-hint').innerHTML = '⚠️ 请输入第三方 API 地址';
        // 显示必填提示
        document.getElementById('api-key-optional-hint').style.display = 'none';
        document.getElementById('api-key-required-hint').style.display = 'inline';
    }

    // 清空模型列表
    document.getElementById('default-model').innerHTML = '<option value="">⏳ 请先获取模型列表</option>';
    document.getElementById('default-model').disabled = true;
}

// 获取模型列表
async function fetchModels() {
    const type = currentProviderConfig.type;
    const baseUrl = document.getElementById('base-url').value.trim();

    // OpenAI 官方和 ChatGPT 不需要用户输入 Base URL
    if (type !== 'openai' && type !== 'chatgpt' && !baseUrl) {
        showToast('请先输入 Base URL', 'warning');
        return;
    }

    // 获取认证信息
    const authJsonStr = document.getElementById('auth-json').value.trim();
    const apiKey = document.getElementById('api-key').value.trim();

    // OpenAI 官方支持 auth.json 或 API Key
    if (type === 'openai') {
        // 优先使用 auth.json，其次使用 API Key
        if (!authJsonStr && !apiKey) {
            showToast('请输入 auth.json 或 API Key', 'warning');
            return;
        }
        if (authJsonStr) {
            try {
                JSON.parse(authJsonStr);
            } catch (e) {
                showToast('auth.json 格式错误，请检查 JSON 语法', 'error');
                return;
            }
        }
    } else {
        // 其他类型使用 API Key
        if (!apiKey) {
            showToast('请先输入 API Key', 'warning');
            return;
        }
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
        };

        // OpenAI 官方支持 auth.json
        if (type === 'openai' && authJsonStr) {
            tempConfig.auth_data = JSON.parse(authJsonStr);
        }
        if (apiKey) {
            tempConfig.api_key = apiKey;
        }

        if (type === 'openai-compatible') {
            tempConfig.compatibility = {
                auth_header: document.getElementById('auth-header').value,
                auth_prefix: document.getElementById('auth-prefix').value,
                custom_headers: {}
            };
        }

        const result = await pywebview.api.fetch_ai_models(tempConfig);

        if (result.success) {
            currentProviderConfig.models = result.models;
            updateModelOptions(result.models);
            showToast(`成功获取 ${result.models.length} 个模型`, 'success');
        } else {
            showToast(`获取失败: ${result.error}`, 'error');
            enableManualModelInput();
        }
    } catch (error) {
        console.error('获取模型列表失败:', error);
        showToast('获取模型列表失败', 'error');
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
    modelSelect.innerHTML = '<option value="__manual__">✏️ 手动输入模型名</option>';
    document.getElementById('manual-model-group').style.display = 'block';
}

// 测试连接
async function testConnection() {
    const type = currentProviderConfig.type;
    const baseUrl = document.getElementById('base-url').value.trim();
    const model = getSelectedModel();

    // OpenAI 官方不需要用户输入 Base URL
    if (type !== 'openai' && !baseUrl) {
        showToast('请先填写 Base URL', 'warning');
        return;
    }

    // 获取认证信息
    const authJsonStr = document.getElementById('auth-json').value.trim();
    const apiKeyStr = document.getElementById('api-key').value.trim();
    let authData = null;
    let apiKey = null;

    // OpenAI 官方支持 auth.json 或 API Key
    if (type === 'openai') {
        if (!authJsonStr && !apiKeyStr) {
            showToast('请输入 auth.json 或 API Key', 'warning');
            return;
        }
        if (authJsonStr) {
            try {
                authData = JSON.parse(authJsonStr);
            } catch (e) {
                showToast('auth.json 格式错误', 'error');
                return;
            }
        }
        if (apiKeyStr) {
            apiKey = apiKeyStr;
        }
    } else {
        apiKey = apiKeyStr;
        if (!apiKey) {
            showToast('请先填写 API Key', 'warning');
            return;
        }
    }

    showToast('🔌 正在测试连接...', 'info');

    try {
        const tempConfig = {
            type: type,
            config: {
                base_url: type === 'openai' ? 'https://api.openai.com/v1' : baseUrl,
                default_model: model || (type === 'claude' ? 'claude-sonnet-4-5-20250514' : 'gpt-4.1')
            }
        };

        // OpenAI 官方支持 auth.json
        if (type === 'openai' && authData) {
            tempConfig.config.auth_data = authData;
        }
        if (apiKey) {
            tempConfig.config.api_key = apiKey;
        }

        if (type === 'openai') {
            tempConfig.config.organization = document.getElementById('organization')?.value;
        } else if (type === 'claude') {
            tempConfig.config.api_version = document.getElementById('api-version')?.value;
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
    const model = getSelectedModel();

    // 基础验证
    if (!name) {
        showToast('请填写显示名称', 'warning');
        return;
    }
    // OpenAI 官方和 ChatGPT 不需要用户输入 Base URL
    if (type !== 'openai' && type !== 'chatgpt' && !baseUrl) {
        showToast('请填写 Base URL', 'warning');
        return;
    }
    if (!model) {
        showToast('请选择或输入默认模型', 'warning');
        return;
    }

    // 获取认证信息
    const authJsonStr = document.getElementById('auth-json').value.trim();
    const apiKeyStr = document.getElementById('api-key').value.trim();
    let authData = null;
    let apiKey = null;

    // OpenAI 官方支持 auth.json 或 API Key
    if (type === 'openai') {
        if (!authJsonStr && !apiKeyStr) {
            showToast('请输入 auth.json 或 API Key', 'warning');
            return;
        }
        if (authJsonStr) {
            try {
                authData = JSON.parse(authJsonStr);
            } catch (e) {
                showToast('auth.json 格式错误，请检查 JSON 语法', 'error');
                return;
            }
        }
        if (apiKeyStr) {
            apiKey = apiKeyStr;
        }
    } else {
        apiKey = apiKeyStr;
        if (!apiKey) {
            showToast('请填写 API Key', 'warning');
            return;
        }
    }

    const config = {
        id: currentProviderConfig.id || generateProviderId(),
        type: type,
        name: name,
        enabled: true,
        config: {
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
    // OpenAI 官方支持 auth.json
    if (type === 'openai' && authData) {
        config.config.auth_data = authData;
    }
    if (apiKey) {
        config.config.api_key = apiKey;
    }

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

// 设置 auth.json 和 API Key 互斥
function setupAuthMutualExclusion() {
    const authJsonInput = document.getElementById('auth-json');
    const apiKeyInput = document.getElementById('api-key');

    // 移除旧的监听器（避免重复绑定）
    authJsonInput.removeEventListener('input', handleAuthJsonInput);
    apiKeyInput.removeEventListener('input', handleApiKeyInput);

    // 添加新的监听器
    authJsonInput.addEventListener('input', handleAuthJsonInput);
    apiKeyInput.addEventListener('input', handleApiKeyInput);
}

// 处理 auth.json 输入
function handleAuthJsonInput(e) {
    const apiKeyInput = document.getElementById('api-key');
    if (e.target.value.trim()) {
        apiKeyInput.disabled = true;
        apiKeyInput.placeholder = '已使用 auth.json，无需填写';
        apiKeyInput.value = '';
    } else {
        apiKeyInput.disabled = false;
        apiKeyInput.placeholder = 'sk-xxx 或 anthropic-key';
    }
}

// 处理 API Key 输入
function handleApiKeyInput(e) {
    const authJsonInput = document.getElementById('auth-json');
    if (e.target.value.trim()) {
        authJsonInput.disabled = true;
        authJsonInput.placeholder = '已使用 API Key，无需填写';
        authJsonInput.value = '';
    } else {
        authJsonInput.disabled = false;
        authJsonInput.placeholder = '{\n  "OPENAI_API_KEY": null,\n  ...';
    }
}