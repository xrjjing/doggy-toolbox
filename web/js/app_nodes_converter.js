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
async function loadNodes() {
    if (!window.pywebview || !window.pywebview.api) return;
    const nodes = await pywebview.api.get_nodes();
    const container = document.getElementById('nodes-list');
    if (!container) return;

    if (!nodes.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🌐</div>
                <div class="empty-state-text">暂无保存的节点</div>
            </div>`;
        return;
    }

    container.innerHTML = nodes.map(node => `
        <div class="node-card">
            <div class="node-header">
                <span class="node-name">${escapeHtml(node.name)}</span>
                <div style="display:flex;gap:8px;align-items:center">
                    <span class="node-type">${escapeHtml(node.type)}</span>
                    <button class="btn btn-sm btn-danger" onclick="deleteNode('${node.id}')" title="删除"><span class="btn-icon">🗑️</span></button>
                </div>
            </div>
            <div class="node-info">
                <span>🖥 ${escapeHtml(node.server)}</span>
                <span>🔌 ${node.port}</span>
            </div>
        </div>
    `).join('');
}

async function deleteNode(id) {
    if (!window.pywebview || !window.pywebview.api) return;
    if (confirm('确定删除此节点？')) {
        await pywebview.api.delete_node(id);
        loadNodes();
    }
}
