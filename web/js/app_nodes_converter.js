/*
 * 文件总览：节点转换与节点管理前端逻辑。
 *
 * 服务页面：
 * - web/pages/converter.html：把节点链接转换成 YAML/JSON 等结果；
 * - web/pages/nodes.html：管理已保存节点、标签、二维码导出、批量导入和校验。
 *
 * 调用链：页面按钮 -> 本文件函数 -> window.pywebview.api -> api.py -> NodeConverterService。
 *
 * 排查建议：
 * - 转换按钮点击后无输出：先看 convertLinks() / applyConvertResult()；
 * - 节点列表、标签、二维码异常：优先看 loadNodes()、renderNodeTags()、exportNodeAsQR()。
 */

// ==================== 节点转换：对应 converter.html ====================
// 负责原始节点链接输入、订阅抓取、转换结果渲染与输出格式切换。
// 页面触发：converter 页里的“转换”按钮。
// 这是“原始节点链接 -> 后端转换 -> 前端回填”的总入口。
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

// 判断用户在“订阅 URL”输入框里粘贴的内容，其实是不是节点链接本体。
// 这是一个兜底辅助函数，用来提升页面容错率，避免外行把内容贴错框时完全没反应。
function isLikelyNodeLinks(text) {
    const t = (text || '').trim();
    if (!t) return false;
    // 多行基本就是节点列表
    if (t.includes('\n') || t.includes('\r')) return true;
    // 单条节点链接（常见协议）
    return /^(vless|hysteria2|ss):\/\//i.test(t);
}

// 初始化转换页的输出模式按钮状态。
// 页面位置：converter 页右侧输出区上方的 YAML / JSON 切换按钮。
function initConverterOutput() {
    updateConverterFormatButtons();
}

// 在 YAML / JSON 两种输出模式之间切换。
// 页面触发：converter 页输出区的格式切换按钮。
function setConvertOutputFormat(format) {
    if (format !== 'yaml' && format !== 'json') return;
    convertOutputFormat = format;
    renderConvertOutput();
    updateConverterFormatButtons();
}

// 刷新输出格式按钮的选中态。
// 页面位置：converter 页结果区上方的 YAML / JSON 两个切换按钮。
// 它不负责转换数据本身，只负责把“当前正在看哪种格式”用激活样式告诉用户。
function updateConverterFormatButtons() {
    const yamlBtn = document.getElementById('format-yaml-btn');
    const jsonBtn = document.getElementById('format-json-btn');
    yamlBtn?.classList.toggle('active', convertOutputFormat === 'yaml');
    jsonBtn?.classList.toggle('active', convertOutputFormat === 'json');
}

// 根据最近一次转换结果，把内容写回输出框。
// 页面位置：converter 页右侧大输出框。
function renderConvertOutput() {
    const outputEl = document.getElementById('yaml-output');
    if (!outputEl) return;
    outputEl.value = convertOutputFormat === 'json' ? (lastConvertedJson || '') : (lastConvertedYaml || '');
}

// 把后端转换结果统一写回前端状态。
// 负责内容：转换后的节点数组、YAML 文本、JSON 文本、错误提示区。
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

// 页面触发：converter 页里的“抓取订阅”按钮。
// 如果用户误把多条节点链接粘到订阅输入框，这里也会自动分流回 convertLinks()。
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

// 渲染转换错误提示区：对应结果区附近的错误列表。
// 数据来源：window.pywebview.api.convert_links()/fetch_subscription() 返回结果里的 errors 数组。
// 用户说“有些节点没被成功转换”时，通常先看这里有没有把后端给出的失败原因真正渲染出来。
function showErrors(errors) {
    const container = document.getElementById('convert-errors');
    if (!container) return;
    const safeErrors = Array.isArray(errors) ? errors : [];
    container.innerHTML = safeErrors.map(e => `<div>⚠ ${escapeHtml(e)}</div>`).join('');
}

// 复制当前结果区内容：对应“复制结果”按钮。
// 名字虽然叫 copyYaml，但它复制的其实是右侧输出框当前展示的文本，所以 YAML / JSON 两种模式都会走这里。
// 如果用户切到了 JSON 模式再点复制，复制出去的也是 JSON，而不是固定的 YAML。
function copyYaml() {
    const content = document.getElementById('yaml-output').value;
    if (content) {
        copyToClipboard(content).then((ok) => {
            alert(ok ? '已复制到剪贴板' : '复制失败，请手动复制');
        });
    }
}

// 把当前转换结果批量保存到已保存节点列表。
// 页面触发：converter 页里的“保存节点”按钮。
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

// ==================== 节点管理：对应 nodes.html ====================
// 已保存节点的列表展示、标签维护、删除与导出入口集中在这里。
let currentTagFilter = null;

// nodes 页数据加载入口：
// 页面位置：已保存节点列表页。
// 会先加载标签筛选，再根据当前筛选条件拉节点数据并渲染卡片。
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

// 把节点标签渲染成卡片里的标签徽标区域。
// 页面位置：nodes 页里每张节点卡片底部的标签区。
// 这里返回的是一段 HTML 字符串，真正插入到卡片里的动作由 loadNodes() 在拼整张卡片时完成。
function renderNodeTags(tags) {
    if (!tags || !tags.length) return '';
    return `<div class="node-tags">${tags.map(t => `<span class="node-tag" data-tag="${escapeAttr(t)}">${escapeHtml(t)}</span>`).join('')}</div>`;
}

// 标签筛选条的数据加载与渲染入口。
// 页面位置：nodes 页顶部的标签筛选条。
// 如果标签按钮没刷新，或者点击标签无效，通常先看这里和 filterByTag()；
// 它负责把“全部 + 每个标签按钮”的 DOM 一次性重绘出来。
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

// 事件委托：节点卡片里的标签点击。
// 用户点卡片内某个标签时，不会打开编辑器，而是直接把该标签作为当前筛选条件，
// 相当于从“卡片标签展示区”快速跳到“顶部标签筛选”同样的过滤效果。
document.addEventListener('click', (e) => {
    const nodeTag = e.target.closest('.node-tag[data-tag]');
    if (nodeTag) {
        const tag = nodeTag.dataset.tag;
        if (tag) filterByTag(tag);
    }
});

// 根据标签筛选节点：既可由顶部筛选按钮触发，也可由节点卡片上的标签点击触发。
// 外行可以把它理解为“记住当前选中了哪个标签，然后重新请求/渲染节点列表”。
// 因为真正的数据刷新在 loadNodes()，所以点击标签没变化时，通常要把这两个函数一起看。
function filterByTag(tag) {
    currentTagFilter = tag;
    loadNodes();
}

// 页面触发：单个节点卡片上的“编辑标签”按钮。
// 这里会在卡片底部临时插入一个内联编辑器，而不是单独开弹窗。
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

// 节点标签保存入口：
// 页面触发：节点卡片内联标签编辑器里的“保存”按钮。
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

// 删除已保存节点：对应 nodes.html 中每张节点卡片右上角的删除按钮。
// 调用链：删除按钮 -> 本函数 -> pywebview.api.delete_node() -> api.py -> NodeConverterService。
// 删除成功后会重新 loadNodes()，让列表、标签筛选结果和空状态提示保持同步。
async function deleteNode(id) {
    if (!window.pywebview || !window.pywebview.api) return;
    if (confirm('确定删除此节点？')) {
        await pywebview.api.delete_node(id);
        loadNodes();
    }
}

// ==================== 批量导入：节点订阅或多条节点一次性入库 ====================
// 这里负责把多来源输入整理成统一结果，再交给后端保存。
// 页面触发：nodes 页里的“批量导入订阅 / 链接”按钮。
// 页面位置：通常和批量导入文本框 batch-import-urls、结果区 batch-import-results 配套出现。
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

// 页面位置：批量导入结果区域。
// 负责把每个来源的导入数量、错误信息和总计结果展示出来。
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

// ==================== 节点验证：用于批量检查转换后节点的基本有效性 ====================
// 当用户怀疑转换结果格式不对时，优先看这一段。
// 页面触发：converter 页里的“校验全部节点”按钮。
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

// 页面位置：converter 页的“校验结果”展示区。
// 会把有效 / 无效数量、每个节点的错误和 warning 都渲染出来。
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

// ==================== 二维码导出：把单条节点分享信息转成二维码 ====================
// 对应页面上的导出二维码按钮和预览流程。
// 页面触发：转换结果列表里的“导出二维码”按钮。
// 它不会在当前页直接画二维码，而是把分享链接送到 tool-qrcode 页面继续处理。
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

// 页面触发：转换结果列表里的“复制分享链接”按钮。
// 复制单条节点的分享链接：对应“复制分享链接”按钮。
// 适合用户不想跳转二维码工具，只想把节点分享串直接发出去的场景。
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
