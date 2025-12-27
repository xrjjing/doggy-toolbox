// Prompt 模板管理
let allPromptCategories = [];
let allPromptTemplates = [];
let currentCategoryId = null;
let editingTemplateId = null;

// 初始化 Prompt 模板页面
async function initPromptTemplates() {
    await loadPromptCategories();
    await loadPromptTemplates();
}

// 加载分类列表
async function loadPromptCategories() {
    if (!window.pywebview?.api) return;

    const result = await pywebview.api.list_prompt_categories();
    if (result.success) {
        allPromptCategories = result.categories || [];
        renderPromptCategoryTabs();
        renderCategoryList();
    }
}

// 加载模板列表
async function loadPromptTemplates() {
    if (!window.pywebview?.api) return;

    const keyword = document.getElementById('prompt-search')?.value || '';
    const favoritesOnly = document.getElementById('prompt-favorites-only')?.checked || false;

    const result = await pywebview.api.list_prompt_templates(currentCategoryId, keyword, favoritesOnly);
    if (result.success) {
        allPromptTemplates = result.templates || [];
        renderPromptTemplates();
    }
}

// 渲染分类标签栏
function renderPromptCategoryTabs() {
    const tabsEl = document.getElementById('prompt-category-tabs');
    if (!tabsEl) return;

    let html = `<button class="tab-btn ${!currentCategoryId ? 'active' : ''}" onclick="selectPromptCategory(null)">全部</button>`;

    allPromptCategories.forEach(cat => {
        const icon = cat.icon || '📁';
        html += `<button class="tab-btn ${currentCategoryId === cat.id ? 'active' : ''}" onclick="selectPromptCategory('${cat.id}')">${icon} ${escapeHtml(cat.name)}</button>`;
    });

    tabsEl.innerHTML = html;
}

// 选择分类
function selectPromptCategory(categoryId) {
    currentCategoryId = categoryId;
    renderPromptCategoryTabs();
    loadPromptTemplates();
}

// 筛选模板
function filterPromptTemplates() {
    loadPromptTemplates();
}

// 渲染模板列表
function renderPromptTemplates() {
    const listEl = document.getElementById('prompt-templates-list');
    if (!listEl) return;

    if (allPromptTemplates.length === 0) {
        listEl.innerHTML = `
            <div class="prompt-empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
                <h3>暂无模板</h3>
                <p>点击"添加模板"创建你的第一个 Prompt 模板</p>
            </div>
        `;
        return;
    }

    let html = '';
    allPromptTemplates.forEach(template => {
        const category = allPromptCategories.find(c => c.id === template.category_id);
        const categoryName = category ? `${category.icon || '📁'} ${category.name}` : '未分类';
        const tags = template.tags || [];
        const isFavorite = template.is_favorite;

        html += `
            <div class="prompt-template-card ${isFavorite ? 'favorite' : ''}">
                <div class="tpl-card-header">
                    <div class="tpl-card-title">
                        <h4>${escapeHtml(template.title)}</h4>
                        <div class="tpl-card-category">${categoryName}</div>
                    </div>
                    <div class="tpl-card-actions">
                        <button class="tpl-action-btn ${isFavorite ? 'is-favorite' : ''}" onclick="togglePromptFavorite('${template.id}')" title="${isFavorite ? '取消收藏' : '收藏'}">
                            <svg viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                        </button>
                        <button class="tpl-action-btn" onclick="editPromptTemplate('${template.id}')" title="编辑">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="tpl-action-btn is-delete" onclick="deletePromptTemplate('${template.id}')" title="删除">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </div>
                ${template.description ? `<div class="tpl-card-desc">${escapeHtml(template.description)}</div>` : ''}
                <div class="tpl-card-preview">${escapeHtml(template.content)}</div>
                <div class="tpl-card-footer">
                    <div class="tpl-tags">
                        ${tags.map(tag => `<span class="tpl-tag">${escapeHtml(tag)}</span>`).join('')}
                    </div>
                    <button class="tpl-use-btn" onclick="usePromptTemplate('${template.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>使用</button>
                </div>
            </div>
        `;
    });

    listEl.innerHTML = html;
}

// 显示分类管理弹窗
function showPromptCategoryModal() {
    document.getElementById('prompt-category-modal').style.display = 'flex';
    document.getElementById('new-category-name').value = '';
    document.getElementById('new-category-icon').value = '';
    renderCategoryList();
}

// 关闭分类管理弹窗
function closePromptCategoryModal() {
    document.getElementById('prompt-category-modal').style.display = 'none';
}

// 渲染分类列表（弹窗内）
function renderCategoryList() {
    const listEl = document.getElementById('category-list');
    if (!listEl) return;

    if (allPromptCategories.length === 0) {
        listEl.innerHTML = '<div class="empty-message">暂无分类</div>';
        return;
    }

    let html = '';
    allPromptCategories.forEach(cat => {
        html += `
            <div class="prompt-cat-item" data-id="${cat.id}">
                <span class="prompt-cat-item-icon">${cat.icon || '📁'}</span>
                <span class="prompt-cat-item-name">${escapeHtml(cat.name)}</span>
                <div class="prompt-cat-item-actions">
                    <button onclick="editPromptCategory('${cat.id}')" title="编辑">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="is-delete" onclick="deletePromptCategory('${cat.id}')" title="删除">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
        `;
    });

    listEl.innerHTML = html;
}

// 添加分类
async function addPromptCategory() {
    const name = document.getElementById('new-category-name').value.trim();
    const icon = document.getElementById('new-category-icon').value.trim();

    if (!name) {
        showToast('请输入分类名称', 'warning');
        return;
    }

    const result = await pywebview.api.create_prompt_category(name, icon || null);
    if (result.success) {
        showToast('分类创建成功', 'success');
        document.getElementById('new-category-name').value = '';
        document.getElementById('new-category-icon').value = '';
        await loadPromptCategories();
    } else {
        showToast(result.error || '创建失败', 'error');
    }
}

// 编辑分类
async function editPromptCategory(categoryId) {
    const category = allPromptCategories.find(c => c.id === categoryId);
    if (!category) return;

    const newName = prompt('分类名称:', category.name);
    if (newName === null) return;

    const newIcon = prompt('分类图标 (emoji):', category.icon || '');

    const result = await pywebview.api.update_prompt_category(categoryId, newName, newIcon || null);
    if (result.success) {
        showToast('分类更新成功', 'success');
        await loadPromptCategories();
    } else {
        showToast(result.error || '更新失败', 'error');
    }
}

// 删除分类
async function deletePromptCategory(categoryId) {
    if (!confirm('确定要删除此分类吗？分类下的模板将变为未分类。')) return;

    const result = await pywebview.api.delete_prompt_category(categoryId);
    if (result.success) {
        showToast('分类已删除', 'success');
        if (currentCategoryId === categoryId) {
            currentCategoryId = null;
        }
        await loadPromptCategories();
        await loadPromptTemplates();
    } else {
        showToast(result.error || '删除失败', 'error');
    }
}

// 显示模板编辑弹窗
function showPromptTemplateModal(templateId = null) {
    editingTemplateId = templateId;
    const modal = document.getElementById('prompt-template-modal');
    const titleEl = document.getElementById('prompt-modal-title');

    // 更新分类下拉框
    const categorySelect = document.getElementById('template-category');
    categorySelect.innerHTML = '<option value="">未分类</option>';
    allPromptCategories.forEach(cat => {
        categorySelect.innerHTML += `<option value="${cat.id}">${cat.icon || '📁'} ${escapeHtml(cat.name)}</option>`;
    });

    if (templateId) {
        titleEl.textContent = '编辑模板';
        const template = allPromptTemplates.find(t => t.id === templateId);
        if (template) {
            document.getElementById('edit-template-id').value = template.id;
            document.getElementById('template-title').value = template.title;
            document.getElementById('template-category').value = template.category_id || '';
            document.getElementById('template-description').value = template.description || '';
            document.getElementById('template-content').value = template.content;
            document.getElementById('template-tags').value = (template.tags || []).join(', ');
        }
    } else {
        titleEl.textContent = '添加模板';
        document.getElementById('edit-template-id').value = '';
        document.getElementById('template-title').value = '';
        document.getElementById('template-category').value = currentCategoryId || '';
        document.getElementById('template-description').value = '';
        document.getElementById('template-content').value = '';
        document.getElementById('template-tags').value = '';
    }

    modal.style.display = 'flex';
}

// 关闭模板编辑弹窗
function closePromptTemplateModal() {
    document.getElementById('prompt-template-modal').style.display = 'none';
    editingTemplateId = null;
}

// 保存模板
async function savePromptTemplate() {
    const templateId = document.getElementById('edit-template-id').value;
    const title = document.getElementById('template-title').value.trim();
    const categoryId = document.getElementById('template-category').value || null;
    const description = document.getElementById('template-description').value.trim();
    const content = document.getElementById('template-content').value.trim();
    const tagsStr = document.getElementById('template-tags').value.trim();
    const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(t => t) : [];

    if (!title) {
        showToast('请输入模板标题', 'warning');
        return;
    }
    if (!content) {
        showToast('请输入模板内容', 'warning');
        return;
    }

    let result;
    if (templateId) {
        result = await pywebview.api.update_prompt_template(templateId, title, content, categoryId, description, tags);
    } else {
        result = await pywebview.api.create_prompt_template(title, content, categoryId, description, tags);
    }

    if (result.success) {
        showToast(templateId ? '模板更新成功' : '模板创建成功', 'success');
        closePromptTemplateModal();
        await loadPromptTemplates();
    } else {
        showToast(result.error || '保存失败', 'error');
    }
}

// 编辑模板
function editPromptTemplate(templateId) {
    showPromptTemplateModal(templateId);
}

// 删除模板
async function deletePromptTemplate(templateId) {
    if (!confirm('确定要删除此模板吗？')) return;

    const result = await pywebview.api.delete_prompt_template(templateId);
    if (result.success) {
        showToast('模板已删除', 'success');
        await loadPromptTemplates();
    } else {
        showToast(result.error || '删除失败', 'error');
    }
}

// 切换收藏状态
async function togglePromptFavorite(templateId) {
    const result = await pywebview.api.toggle_prompt_template_favorite(templateId);
    if (result.success) {
        await loadPromptTemplates();
    } else {
        showToast(result.error || '操作失败', 'error');
    }
}

// 使用模板
async function usePromptTemplate(templateId) {
    const template = allPromptTemplates.find(t => t.id === templateId);
    if (!template) return;

    // 解析变量
    const result = await pywebview.api.parse_prompt_variables(template.content);
    const variables = result.success ? result.variables : [];

    if (variables.length > 0) {
        // 有变量，显示变量填充弹窗
        showPromptVariablesModal(templateId, variables);
    } else {
        // 无变量，直接应用
        applyPromptContent(template.content, templateId);
    }
}

// 显示变量填充弹窗
function showPromptVariablesModal(templateId, variables) {
    document.getElementById('use-template-id').value = templateId;

    const formEl = document.getElementById('variables-form');
    let html = '';

    variables.forEach(v => {
        html += `
            <div class="form-group">
                <label>${escapeHtml(v.name)}</label>
                <input type="text" id="var-${v.name}" placeholder="请输入 ${v.name}">
            </div>
        `;
    });

    formEl.innerHTML = html;
    document.getElementById('prompt-variables-modal').style.display = 'flex';
}

// 关闭变量填充弹窗
function closePromptVariablesModal() {
    document.getElementById('prompt-variables-modal').style.display = 'none';
}

// 应用模板（填充变量后）
async function applyPromptTemplate() {
    const templateId = document.getElementById('use-template-id').value;
    const template = allPromptTemplates.find(t => t.id === templateId);
    if (!template) return;

    // 收集变量值
    const values = {};
    const inputs = document.querySelectorAll('#variables-form input');
    inputs.forEach(input => {
        const varName = input.id.replace('var-', '');
        values[varName] = input.value;
    });

    const result = await pywebview.api.use_prompt_template(templateId, values);
    if (result.success) {
        closePromptVariablesModal();
        applyPromptContent(result.content, templateId);
    } else {
        showToast(result.error || '应用失败', 'error');
    }
}

// 应用 Prompt 内容到聊天输入框
function applyPromptContent(content, templateId) {
    // 尝试填充到 AI 聊天输入框
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.value = content;
        chatInput.focus();
        // 自动调整高度
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 180) + 'px';
        showToast('模板已应用到输入框', 'success');

        // 如果当前不在 AI 聊天页面，跳转过去
        if (typeof navigateTo === 'function') {
            navigateTo('ai-chat');
        }
    } else {
        // 复制到剪贴板
        navigator.clipboard.writeText(content).then(() => {
            showToast('模板内容已复制到剪贴板', 'success');
        }).catch(() => {
            showToast('复制失败，请手动复制', 'error');
        });
    }
}

// 从聊天页面保存消息为模板
async function saveMessageAsTemplate(content) {
    const title = prompt('请输入模板标题:');
    if (!title) return;

    const result = await pywebview.api.save_message_as_template(content, title, null);
    if (result.success) {
        showToast('已保存为模板', 'success');
    } else {
        showToast(result.error || '保存失败', 'error');
    }
}

// 获取收藏的模板（供 AI 聊天页面使用）
async function getFavoritePromptTemplates() {
    if (!window.pywebview?.api) return [];

    const result = await pywebview.api.list_prompt_templates(null, null, true);
    return result.success ? result.templates : [];
}

// 获取所有模板（供 AI 聊天页面使用）
async function getAllPromptTemplates() {
    if (!window.pywebview?.api) return [];

    const result = await pywebview.api.list_prompt_templates(null, null, false);
    return result.success ? result.templates : [];
}

// ========== 导入导出功能 ==========

// 导出模板
async function exportPromptTemplates() {
    if (!window.pywebview?.api) return;

    const result = await pywebview.api.export_prompt_templates(null, true);
    if (!result.success) {
        showToast(result.error || '导出失败', 'error');
        return;
    }

    const jsonContent = result.json;
    const filename = `prompt_templates_${new Date().toISOString().slice(0, 10)}.json`;

    // 尝试使用保存对话框
    if (typeof pywebview.api.save_file_dialog === 'function') {
        await pywebview.api.save_file_dialog(jsonContent, filename, [['JSON 文件', '*.json']]);
    } else {
        // 回退到下载方式
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    showToast('模板导出成功', 'success');
}

// 显示导入弹窗
function showImportPromptModal() {
    document.getElementById('import-file').value = '';
    document.getElementById('import-json-content').value = '';
    document.getElementById('import-overwrite').checked = false;
    document.getElementById('prompt-import-modal').style.display = 'flex';
}

// 关闭导入弹窗
function closeImportPromptModal() {
    document.getElementById('prompt-import-modal').style.display = 'none';
}

// 处理文件选择
function handleImportFile(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('import-json-content').value = e.target.result;
    };
    reader.readAsText(file);
}

// 执行导入
async function doImportPromptTemplates() {
    if (!window.pywebview?.api) return;

    const jsonContent = document.getElementById('import-json-content').value.trim();
    const overwrite = document.getElementById('import-overwrite').checked;

    if (!jsonContent) {
        showToast('请选择文件或粘贴 JSON 内容', 'warning');
        return;
    }

    let importData;
    try {
        importData = JSON.parse(jsonContent);
    } catch (e) {
        showToast('JSON 格式错误', 'error');
        return;
    }

    const result = await pywebview.api.import_prompt_templates(importData, overwrite);
    if (result.success) {
        closeImportPromptModal();
        await loadPromptCategories();
        await loadPromptTemplates();

        let msg = `导入完成：${result.imported} 个模板`;
        if (result.skipped > 0) {
            msg += `，跳过 ${result.skipped} 个`;
        }
        showToast(msg, 'success');
    } else {
        showToast(result.error || '导入失败', 'error');
    }
}
