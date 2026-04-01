/*
 * 文件总览：Prompt 模板管理前端逻辑。
 *
 * 服务页面：web/pages/prompt-templates.html。
 * 主要职责：
 * - 加载模板分类和模板列表；
 * - 处理搜索、收藏、分类切换；
 * - 管理分类/模板弹窗；
 * - 处理“使用模板”和“填写变量后应用”的流程。
 *
 * 调用链：页面交互 -> 本文件 -> window.pywebview.api -> api.py -> PromptTemplateService。
 *
 * 排查建议：
 * - 页面上模板不显示：先看 loadPromptCategories()/loadPromptTemplates()；
 * - 变量弹窗应用后内容不对：看 showPromptVariablesModal()/applyPromptTemplate()。
 */

// Prompt 模板管理：页面级状态会围绕分类、模板列表和当前编辑对象持续变化。
let allPromptCategories = [];
let allPromptTemplates = [];
let currentCategoryId = null;
let editingTemplateId = null;

// 初始化入口：进入模板页后，先加载分类，再加载模板列表，保证页签和内容区一起刷新。
// 页面位置：prompt-templates 页面整体入口。
async function initPromptTemplates() {
    await loadPromptCategories();
    await loadPromptTemplates();
}

// 分类数据加载：负责顶部分类页签和分类管理弹窗列表的共同数据源。
// 调用链：页面初始化/新增分类/编辑分类/删除分类后 -> pywebview.api.list_prompt_categories() -> renderPromptCategoryTabs()/renderCategoryList()。
// 如果顶部分类栏和弹窗里的分类列表显示不一致，通常优先检查这里是否重新拉到了最新数据。
async function loadPromptCategories() {
    if (!window.pywebview?.api) return;

    const result = await pywebview.api.list_prompt_categories();
    if (result.success) {
        allPromptCategories = result.categories || [];
        renderPromptCategoryTabs();
        renderCategoryList();
    }
}

// 模板数据加载：会综合当前分类、搜索关键字和“仅收藏”勾选状态请求后端。
// 页面位置：prompt-templates 页中部模板卡片区的数据入口。
// 外行可以把它理解为“模板列表真正从后端拿数据的入口”，很多筛选动作最后都会汇总到这里。
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

// 分类标签栏渲染：这是页面顶部“按分类切换模板”的可见入口。
// 页面位置：prompt-templates 页顶部分类标签栏。
// 这里生成的是“全部 + 每个分类”的按钮条，用户看到哪个分类被高亮，也是由这里决定的。
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

// 分类切换：点击顶部分类标签后，会更新 currentCategoryId 并触发重新加载模板。
// 页面效果：上方标签高亮先切换，再重新请求该分类下的模板卡片列表。
function selectPromptCategory(categoryId) {
    currentCategoryId = categoryId;
    renderPromptCategoryTabs();
    loadPromptTemplates();
}

// 搜索/筛选触发器：输入关键字或切换“仅收藏”后，最终都会回到 loadPromptTemplates()。
// 这个函数本身不做筛选计算，它更像一个统一的“刷新模板列表”入口。
function filterPromptTemplates() {
    loadPromptTemplates();
}

// 模板列表渲染：负责把模板卡片、空状态和收藏按钮真正输出到页面中。
// 页面位置：模板页中部的大卡片列表区。
// 外行用户看到的标题、描述、标签、收藏星标、使用按钮，都是在这里拼出来的。
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

// 打开分类管理弹窗。
// 页面触发：模板页里的“管理分类”按钮。
// 弹窗内可以新增、编辑、删除分类，因此这里是分类维护操作的总入口；它还会顺手清空新增表单，避免沿用上一次输入。
function showPromptCategoryModal() {
    document.getElementById('prompt-category-modal').style.display = 'flex';
    document.getElementById('new-category-name').value = '';
    document.getElementById('new-category-icon').value = '';
    renderCategoryList();
}

// 关闭分类管理弹窗。
function closePromptCategoryModal() {
    document.getElementById('prompt-category-modal').style.display = 'none';
}

// 渲染分类列表（弹窗内）。
// 页面位置：分类管理弹窗主体区域。
// 这个列表和顶部分类切换栏不是同一块 DOM：顶部用于切换查看，弹窗用于增删改分类，所以这里刷新了并不代表顶部一定同步，顶部还要靠 loadPromptCategories() 里的 renderPromptCategoryTabs()。
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

// 添加分类。
// 页面触发：分类弹窗里的“添加分类”按钮。
// 成功后会重新拉取分类数据，让顶部标签栏和弹窗列表同时刷新。
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

// 编辑分类入口：对应分类弹窗里单个分类行的“编辑”按钮。
// 交互方式比较轻量：依次弹出名称和图标输入框，再调用后端更新，成功后回到 loadPromptCategories() 统一刷新。
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

// 删除分类。
// 页面触发：分类弹窗里单个分类行的“删除”按钮。
// 删除后分类下的模板会变成“未分类”，所以成功后要同时刷新分类与模板列表。
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

// 打开“添加模板 / 编辑模板”弹窗。
// 页面触发：模板页里的“添加模板”按钮，或者模板卡片上的“编辑”按钮。
// 负责把新建 / 编辑两种状态的表单内容准备好：包含弹窗标题、隐藏 id、分类下拉框、描述、正文、标签输入框。
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

// 关闭模板编辑弹窗，并清空当前正在编辑的模板标记。
function closePromptTemplateModal() {
    document.getElementById('prompt-template-modal').style.display = 'none';
    editingTemplateId = null;
}

// 模板保存主入口：对应模板编辑弹窗里的“保存”按钮。
// 调用链：弹窗表单字段 -> pywebview.api.create/update_prompt_template() -> closePromptTemplateModal() -> loadPromptTemplates()。
// 外行定位时可以把它当成“模板新增/编辑最后真正提交”的地方。
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

// 编辑模板快捷入口：从模板卡片的编辑按钮进入，最终仍然复用 showPromptTemplateModal()。
// 这个函数的职责很单一：只负责把模板 id 交给弹窗入口，不在这里直接操作 DOM 表单字段。
function editPromptTemplate(templateId) {
    showPromptTemplateModal(templateId);
}

// 删除模板：对应模板卡片右上角删除按钮。
// 删除成功后会重新加载当前筛选条件下的模板列表，确保卡片区、收藏筛选和分类视图保持一致。
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

// 切换收藏状态。
// 页面触发：模板卡片右上角的星标按钮。
// 这里不是直接改某张卡片的星标样式，而是调用后端后整体重载当前筛选结果，保证“仅收藏”模式下列表也立即正确刷新。
async function togglePromptFavorite(templateId) {
    const result = await pywebview.api.toggle_prompt_template_favorite(templateId);
    if (result.success) {
        await loadPromptTemplates();
    } else {
        showToast(result.error || '操作失败', 'error');
    }
}

// 使用模板主入口。
// 页面触发：模板卡片右下角的“使用”按钮。
// 如果模板包含变量，会转去 showPromptVariablesModal()；否则直接应用。
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

// 打开变量填充弹窗。
// 页面位置：用户点击“使用”后，如果模板正文里含有变量占位符，就会弹出这层二次输入弹窗。
// 弹窗里的每个输入框，都对应模板正文里的一个变量名；后续 applyPromptTemplate() 会把这些值一起提交给后端展开模板。
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

// 关闭变量填充弹窗。
// 这里只关闭界面，不会清空模板数据；下一次打开时会重新由 showPromptVariablesModal() 生成表单。
function closePromptVariablesModal() {
    document.getElementById('prompt-variables-modal').style.display = 'none';
}

// 应用模板（填充变量后）。
// 页面触发：变量弹窗里的“应用”按钮。
// 负责收集变量输入区里的值、请求后端把 {{变量}} 展开成最终文本，
// 再把最终内容交给 applyPromptContent()，送到聊天输入框或剪贴板。
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

// 应用 Prompt 内容到聊天输入框。
// 页面位置：优先落到 AI 聊天页的输入框；如果当前聊天输入框不在 DOM 中，就退化为复制到剪贴板。
// 这是模板页和聊天页之间最关键的桥接函数，相当于“模板生成好以后，最终送到哪里”的最后一跳。
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

// 从聊天页面保存消息为模板。
// 页面触发：聊天页里“保存为模板”的入口最终会走到这里。
// 这个函数相当于“聊天页内容 -> 模板库”的桥接保存入口：先询问标题，再调用后端落库。
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

// 获取收藏模板：供 AI 聊天页等其他页面读取收藏列表。
// 这不是页面渲染函数，而是一个“给别的页面复用的数据读取接口”。
async function getFavoritePromptTemplates() {
    if (!window.pywebview?.api) return [];

    const result = await pywebview.api.list_prompt_templates(null, null, true);
    return result.success ? result.templates : [];
}

// 获取全部模板：供其他页面拉取完整模板数据时使用。
async function getAllPromptTemplates() {
    if (!window.pywebview?.api) return [];

    const result = await pywebview.api.list_prompt_templates(null, null, false);
    return result.success ? result.templates : [];
}

// ========== 导入导出功能 ==========

// 导出模板。
// 页面触发：模板页“导出”按钮。
// 处理流程：先让后端生成 JSON 文本，再优先尝试 pywebview 保存对话框；如果桌面保存能力不可用，再回退成浏览器下载。
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

// 打开模板导入弹窗。
// 页面触发：模板页“导入”按钮。
// 弹窗支持两种输入方式：选择本地 JSON 文件，或者直接粘贴 JSON 文本；这里会先把旧内容清空，避免误把上一次导入内容再次提交。
function showImportPromptModal() {
    document.getElementById('import-file').value = '';
    document.getElementById('import-json-content').value = '';
    document.getElementById('import-overwrite').checked = false;
    document.getElementById('prompt-import-modal').style.display = 'flex';
}

// 关闭导入弹窗。
function closeImportPromptModal() {
    document.getElementById('prompt-import-modal').style.display = 'none';
}

// 处理文件选择。
// 页面触发：导入弹窗里的文件选择控件。
// 会把用户选中的本地 JSON 文件读入到弹窗文本框，便于导入前再次确认。
function handleImportFile(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('import-json-content').value = e.target.result;
    };
    reader.readAsText(file);
}

// 执行导入。
// 页面触发：导入弹窗里的“开始导入”按钮。
// 负责校验 JSON 文本、调用后端导入，并在成功后刷新分类和模板列表。
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
