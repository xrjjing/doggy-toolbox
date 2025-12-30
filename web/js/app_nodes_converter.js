// ==================== 节点转换 ====================
async function convertLinks() {
    if (!window.pywebview || !window.pywebview.api) return;
    const linksText = document.getElementById('links-input').value.trim();
    if (!linksText) {
        alert('请输入节点链接');
        return;
    }

    const result = await pywebview.api.convert_links(linksText);
    applyConvertResult(result);
}

function isLikelyNodeLinks(text) {
    const t = (text || '').trim();
    if (!t) return false;
    // 多行基本就是节点列表
    if (t.includes('\n') || t.includes('\r')) return true;
    // 单条节点链接（常见协议）
    return /^(vless|hysteria2|ss):\/\//i.test(t);
}

function initConverterOutput() {
    updateConverterFormatButtons();
}

function setConvertOutputFormat(format) {
    if (format !== 'yaml' && format !== 'json') return;
    convertOutputFormat = format;
    renderConvertOutput();
    updateConverterFormatButtons();
}

function updateConverterFormatButtons() {
    const yamlBtn = document.getElementById('format-yaml-btn');
    const jsonBtn = document.getElementById('format-json-btn');
    yamlBtn?.classList.toggle('active', convertOutputFormat === 'yaml');
    jsonBtn?.classList.toggle('active', convertOutputFormat === 'json');
}

function renderConvertOutput() {
    const outputEl = document.getElementById('yaml-output');
    if (!outputEl) return;
    outputEl.value = convertOutputFormat === 'json' ? (lastConvertedJson || '') : (lastConvertedYaml || '');
}

function applyConvertResult(result) {
    const nodes = Array.isArray(result?.nodes) ? result.nodes : [];
    const yaml = typeof result?.yaml === 'string' ? result.yaml : '';
    const errors = Array.isArray(result?.errors) ? result.errors : [];

    convertedNodes = nodes;
    lastConvertedYaml = yaml;
    lastConvertedJson = JSON.stringify(nodes, null, 2);

    renderConvertOutput();
    updateConverterFormatButtons();
    showErrors(errors);
}

async function fetchSubscription() {
    if (!window.pywebview || !window.pywebview.api) return;
    const url = document.getElementById('subscription-url').value.trim();
    if (!url) {
        alert('请输入订阅URL');
        return;
    }

    // 兼容用户误把“节点链接”粘贴到“订阅链接”输入框的情况
    if (isLikelyNodeLinks(url)) {
        document.getElementById('links-input').value = url;
        await convertLinks();
        return;
    }

    const result = await pywebview.api.fetch_subscription(url);
    applyConvertResult(result);
}

function showErrors(errors) {
    const container = document.getElementById('convert-errors');
    if (!container) return;
    const safeErrors = Array.isArray(errors) ? errors : [];
    container.innerHTML = safeErrors.map(e => `<div>⚠ ${escapeHtml(e)}</div>`).join('');
}

function copyYaml() {
    const content = document.getElementById('yaml-output').value;
    if (content) {
        copyToClipboard(content).then((ok) => {
            alert(ok ? '已复制到剪贴板' : '复制失败，请手动复制');
        });
    }
}

async function saveConvertedNodes() {
    if (!window.pywebview || !window.pywebview.api) return;
    if (!convertedNodes.length) {
        alert('没有可保存的节点');
        return;
    }

    for (const node of convertedNodes) {
        await pywebview.api.save_node(
            node.name,
            node.type,
            node.server,
            node.port,
            '',
            JSON.stringify(node, null, 2)
        );
    }
    alert(`已保存 ${convertedNodes.length} 个节点`);
    loadNodes();
}

// ==================== 节点管理 ====================
let currentTagFilter = null;

async function loadNodes() {
    if (!window.pywebview || !window.pywebview.api) return;

    // 加载所有标签
    await loadNodeTags();

    // 根据筛选条件获取节点
    let nodes;
    if (currentTagFilter) {
        nodes = await pywebview.api.get_nodes_by_tag(currentTagFilter);
    } else {
        nodes = await pywebview.api.get_nodes();
    }

    const container = document.getElementById('nodes-list');
    if (!container) return;

    if (!nodes.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🌐</div>
                <div class="empty-state-text">${currentTagFilter ? '该标签下暂无节点' : '暂无保存的节点'}</div>
            </div>`;
        return;
    }

    container.innerHTML = nodes.map(node => `
        <div class="node-card" data-node-id="${node.id}">
            <div class="node-header">
                <span class="node-name">${escapeHtml(node.name)}</span>
                <div style="display:flex;gap:8px;align-items:center">
                    <span class="node-type">${escapeHtml(node.type)}</span>
                    <button class="btn btn-sm btn-ghost" onclick="showTagEditor('${node.id}')" title="编辑标签"><span class="btn-icon">🏷️</span></button>
                    <button class="btn btn-sm btn-danger" onclick="deleteNode('${node.id}')" title="删除"><span class="btn-icon">🗑️</span></button>
                </div>
            </div>
            <div class="node-info">
                <span>🖥 ${escapeHtml(node.server)}</span>
                <span>🔌 ${node.port}</span>
            </div>
            ${renderNodeTags(node.tags || [])}
        </div>
    `).join('');
}

function renderNodeTags(tags) {
    if (!tags || !tags.length) return '';
    return `<div class="node-tags">${tags.map(t => `<span class="node-tag" data-tag="${escapeAttr(t)}">${escapeHtml(t)}</span>`).join('')}</div>`;
}

async function loadNodeTags() {
    if (!window.pywebview || !window.pywebview.api) return;
    const tags = await pywebview.api.get_all_node_tags();
    const container = document.getElementById('node-tags-filter');
    if (!container) return;

    if (!tags.length) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <span class="tag-filter-label">标签筛选:</span>
        <button class="tag-filter-btn ${!currentTagFilter ? 'active' : ''}" data-tag="">全部</button>
        ${tags.map(t => `<button class="tag-filter-btn ${currentTagFilter === t ? 'active' : ''}" data-tag="${escapeAttr(t)}">${escapeHtml(t)}</button>`).join('')}
    `;

    // 事件委托：标签筛选按钮（避免重复绑定）
    if (!container._tagFilterBound) {
        container._tagFilterBound = true;
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.tag-filter-btn');
            if (btn) {
                const tag = btn.dataset.tag || null;
                filterByTag(tag);
            }
        });
    }
}

// 事件委托：节点标签点击
document.addEventListener('click', (e) => {
    const nodeTag = e.target.closest('.node-tag[data-tag]');
    if (nodeTag) {
        const tag = nodeTag.dataset.tag;
        if (tag) filterByTag(tag);
    }
});

function filterByTag(tag) {
    currentTagFilter = tag;
    loadNodes();
}

function showTagEditor(nodeId) {
    const card = document.querySelector(`.node-card[data-node-id="${nodeId}"]`);
    if (!card) return;

    const existingEditor = card.querySelector('.tag-editor');
    if (existingEditor) {
        existingEditor.remove();
        return;
    }

    const tagsContainer = card.querySelector('.node-tags');
    const currentTags = tagsContainer
        ? Array.from(tagsContainer.querySelectorAll('.node-tag')).map(el => el.textContent)
        : [];

    const editor = document.createElement('div');
    editor.className = 'tag-editor';
    editor.innerHTML = `
        <input type="text" class="tag-input" placeholder="输入标签，逗号分隔" value="${escapeAttr(currentTags.join(', '))}">
        <button class="btn btn-sm btn-primary tag-save-btn">保存</button>
        <button class="btn btn-sm btn-ghost tag-cancel-btn">取消</button>
    `;

    // 使用事件委托绑定
    editor.querySelector('.tag-save-btn').addEventListener('click', () => saveNodeTags(nodeId, editor));
    editor.querySelector('.tag-cancel-btn').addEventListener('click', () => editor.remove());

    card.appendChild(editor);
    editor.querySelector('.tag-input').focus();
}

async function saveNodeTags(nodeId, editor) {
    if (!window.pywebview || !window.pywebview.api) return;
    const input = editor.querySelector('.tag-input');
    const tagsStr = input.value.trim();
    const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];

    const result = await pywebview.api.update_node_tags(nodeId, tags);
    if (result) {
        showToast?.('标签已更新', 'success');
        loadNodes();
    } else {
        showToast?.('更新失败', 'error');
    }
}

async function deleteNode(id) {
    if (!window.pywebview || !window.pywebview.api) return;
    if (confirm('确定删除此节点？')) {
        await pywebview.api.delete_node(id);
        loadNodes();
    }
}

// ==================== 批量导入 ====================
async function batchImportSubscriptions() {
    const textarea = document.getElementById('batch-import-urls');
    if (!textarea) return;

    const urls = textarea.value.split('\n').filter(u => u.trim());
    if (urls.length === 0) {
        showToast('请输入订阅链接', 'warning');
        return;
    }

    if (!window.pywebview?.api?.batch_import_subscriptions) {
        showToast('批量导入功能不可用', 'error');
        return;
    }

    showToast('正在导入...', 'info');

    try {
        const result = await pywebview.api.batch_import_subscriptions(urls);
        if (result.total_nodes > 0) {
            showToast(`成功导入 ${result.total_nodes} 个节点`, 'success');
            renderBatchImportResults(result);
        } else {
            showToast('未能导入任何节点', 'warning');
        }
    } catch (e) {
        console.error('批量导入失败:', e);
        showToast('批量导入失败', 'error');
    }
}

function renderBatchImportResults(result) {
    const container = document.getElementById('batch-import-results');
    if (!container) return;

    let html = `<div class="import-summary">共导入 ${result.total_nodes} 个节点</div>`;

    result.results.forEach(r => {
        const statusClass = r.nodes_count > 0 ? 'success' : 'error';
        html += `
            <div class="import-result-item ${statusClass}">
                <span class="import-url">${escapeHtml(r.url)}</span>
                <span class="import-count">${r.nodes_count} 个节点</span>
            </div>
        `;
    });

    if (result.total_errors.length > 0) {
        html += '<div class="import-errors-title">错误信息：</div>';
        result.total_errors.forEach(e => {
            html += `<div class="import-error">${escapeHtml(e)}</div>`;
        });
    }

    container.innerHTML = html;
}

// ==================== 节点验证 ====================
async function validateAllConvertedNodes() {
    if (!convertedNodes.length) {
        showToast('没有可验证的节点', 'warning');
        return;
    }

    if (!window.pywebview?.api?.validate_all_nodes) {
        showToast('验证功能不可用', 'error');
        return;
    }

    try {
        const results = await pywebview.api.validate_all_nodes(convertedNodes);
        renderValidationResults(results);
    } catch (e) {
        console.error('验证失败:', e);
        showToast('验证失败', 'error');
    }
}

function renderValidationResults(results) {
    const container = document.getElementById('validation-results');
    if (!container) return;

    const validCount = results.filter(r => r.valid).length;
    const invalidCount = results.length - validCount;

    let html = `
        <div class="validation-summary">
            <span class="valid-count">✓ ${validCount} 个有效</span>
            <span class="invalid-count">✗ ${invalidCount} 个无效</span>
        </div>
    `;

    results.forEach(r => {
        const statusClass = r.valid ? 'valid' : 'invalid';
        const statusIcon = r.valid ? '✓' : '✗';
        html += `
            <div class="validation-item ${statusClass}">
                <div class="validation-header">
                    <span class="validation-status">${statusIcon}</span>
                    <span class="validation-name">${escapeHtml(r.name)}</span>
                    <span class="validation-type">${escapeHtml(r.type)}</span>
                </div>
        `;

        if (r.errors.length > 0) {
            html += '<div class="validation-errors">';
            r.errors.forEach(e => {
                html += `<div class="validation-error">❌ ${escapeHtml(e)}</div>`;
            });
            html += '</div>';
        }

        if (r.warnings.length > 0) {
            html += '<div class="validation-warnings">';
            r.warnings.forEach(w => {
                html += `<div class="validation-warning">⚠️ ${escapeHtml(w)}</div>`;
            });
            html += '</div>';
        }

        html += '</div>';
    });

    container.innerHTML = html;
    container.style.display = 'block';
}

// ==================== 二维码导出 ====================
async function exportNodeAsQR(nodeIndex) {
    if (!convertedNodes[nodeIndex]) {
        showToast('节点不存在', 'error');
        return;
    }

    const node = convertedNodes[nodeIndex];

    if (!window.pywebview?.api?.generate_node_share_link) {
        showToast('分享链接生成功能不可用', 'error');
        return;
    }

    try {
        const result = await pywebview.api.generate_node_share_link(node);
        if (result.success && result.link) {
            // 跳转到二维码工具并填充链接
            transferDataToTool('tool-qrcode', result.link, 'text');
            showToast('已跳转到二维码工具', 'success');
        } else {
            showToast(result.error || '生成分享链接失败', 'error');
        }
    } catch (e) {
        console.error('生成分享链接失败:', e);
        showToast('生成分享链接失败', 'error');
    }
}

function copyNodeShareLink(nodeIndex) {
    if (!convertedNodes[nodeIndex]) {
        showToast('节点不存在', 'error');
        return;
    }

    const node = convertedNodes[nodeIndex];

    if (!window.pywebview?.api?.generate_node_share_link) {
        showToast('分享链接生成功能不可用', 'error');
        return;
    }

    pywebview.api.generate_node_share_link(node).then(result => {
        if (result.success && result.link) {
            copyToClipboard(result.link).then(ok => {
                showToast(ok ? '分享链接已复制' : '复制失败', ok ? 'success' : 'error');
            });
        } else {
            showToast(result.error || '生成分享链接失败', 'error');
        }
    }).catch(e => {
        console.error('生成分享链接失败:', e);
        showToast('生成分享链接失败', 'error');
    });
}
