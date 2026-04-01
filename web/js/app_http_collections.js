/*
 * 文件总览：HTTP 请求集合工作台前端逻辑。
 *
 * 服务页面：web/pages/http-collections.html。
 * 主要职责：
 * - 维护左侧集合树、文件夹和请求节点；
 * - 在右侧编辑请求方法、URL、Header、Body，并发送请求；
 * - 处理导入导出、环境变量、响应查看与本地请求历史。
 *
 * 调用链：页面按钮/树节点 -> 本文件 -> window.pywebview.api 或后端 HTTP 代理接口 -> api.py -> HttpCollectionsService / http_request。
 *
 * 排查建议：
 * - 左侧集合树不刷新：先看 loadHttpCollections()/renderCollectionsList()；
 * - 右侧请求内容没切换：看 loadRequest()；
 * - 发送请求没结果：看 sendHttpRequestFromCollection() 和响应渲染相关逻辑。
 */

// HTTP 请求集合管理：这里的顶层状态决定左侧集合树和右侧编辑器当前在操作哪个对象。
let allCollections = [];
let currentCollection = null;
let currentRequest = null;
let importCollectionFileContent = '';
let newRequestCollectionId = '';
let newRequestFolderPath = [];
let sidebarCollapsed = false;

// HTTP 请求历史：保存最近的请求回放信息，主要用于调试回看，不是后端持久化主数据。
const HTTP_HISTORY_KEY = 'http_request_history';
const HTTP_HISTORY_MAX = 50;
let lastHttpResponse = null;

// 下拉菜单切换：集合树节点上的更多操作菜单由这里统一控制打开/关闭。
function toggleDropdown(btn) {
    const dropdown = btn.closest('.dropdown');
    if (!dropdown) return;

    const isOpen = dropdown.classList.contains('open');

    // 关闭所有其他下拉菜单
    document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));

    // 切换当前下拉菜单
    if (!isOpen) {
        dropdown.classList.add('open');

        // 点击外部关闭
        const closeHandler = (e) => {
            if (!dropdown.contains(e.target)) {
                dropdown.classList.remove('open');
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }
}

// 切换侧边栏收缩
function toggleCollectionsSidebar() {
    const sidebar = document.getElementById('collections-sidebar');
    if (!sidebar) return;

    sidebarCollapsed = !sidebarCollapsed;

    if (sidebarCollapsed) {
        sidebar.classList.add('collapsed');
    } else {
        sidebar.classList.remove('collapsed');
    }
}

// HTTP 集合页首屏数据加载：
// 页面位置：进入 http-collections 页面后的首轮初始化。
// - 进入页面后，先拉左侧集合树，再补环境变量下拉框；
// - 如果页面骨架正常但左侧目录空白，通常先看这里是否成功拿到了 pywebview 数据。
async function loadHttpCollections() {
    if (!window.pywebview || !window.pywebview.api) return;
    if (!document.getElementById('collections-list')) return;

    allCollections = await pywebview.api.get_http_collections();
    renderCollectionsList();

    // 加载环境变量
    await loadHttpEnvironments();
}

// 渲染左侧集合树根节点：
// 页面位置：HTTP 集合页左侧目录树。
// - 这里只负责把 collection 级别的数据变成树的第一层；
// - folder/request 的递归展开分别交给 renderFolders()/renderRequests()。
function renderCollectionsList() {
    const listEl = document.getElementById('collections-list');
    if (!listEl) return;

    if (allCollections.length === 0) {
        listEl.innerHTML = '<div class="empty-message">暂无集合，点击"新建集合"或"导入"开始</div>';
        return;
    }

    let html = '';
    allCollections.forEach(collection => {
        html += `
            <div class="collection-item">
                <div class="collection-header" onclick="toggleCollection('${collection.id}')">
                    <span class="collection-icon">📁</span>
                    <span class="collection-name">${escapeHtml(collection.name)}</span>
                    <button class="btn-icon" onclick="event.stopPropagation(); deleteCollection('${collection.id}')" title="删除集合">🗑️</button>
                </div>
                <div class="collection-content" id="collection-${collection.id}" style="display: none;">
                    ${renderFolders(collection.folders, collection.id, [])}
                    ${renderRequests(collection.requests, collection.id, [])}
                    <button class="btn btn-sm" onclick="showNewRequestModal('${collection.id}', [])" style="margin-top: 8px;">+ 新建请求</button>
                </div>
            </div>
        `;
    });

    listEl.innerHTML = html;
}

// 渲染文件夹
function renderFolders(folders, collectionId, path) {
    if (!folders || folders.length === 0) return '';

    let html = '';
    folders.forEach(folder => {
        const folderPath = [...path, folder.id];
        html += `
            <div class="folder-item" style="margin-left: ${folder.level * 20}px;">
                <div class="folder-header" onclick="toggleFolder('${folder.id}')">
                    <span class="folder-icon">📂</span>
                    <span class="folder-name">${escapeHtml(folder.name)}</span>
                </div>
                <div class="folder-content" id="folder-${folder.id}" style="display: none;">
                    ${renderFolders(folder.folders, collectionId, folderPath)}
                    ${renderRequests(folder.requests, collectionId, folderPath)}
                    ${folder.level < 3 ? `<button class="btn btn-sm" onclick="showNewFolderModal('${collectionId}', ${JSON.stringify(folderPath)}, ${folder.level + 1})">+ 新建文件夹</button>` : ''}
                    <button class="btn btn-sm" onclick="showNewRequestModal('${collectionId}', ${JSON.stringify(folderPath)})">+ 新建请求</button>
                </div>
            </div>
        `;
    });

    return html;
}

// 渲染请求列表
function renderRequests(requests, collectionId, path) {
    if (!requests || requests.length === 0) return '';

    let html = '';
    requests.forEach(request => {
        const methodClass = `method-${request.method.toLowerCase()}`;
        html += `
            <div class="request-item-wrapper">
                <div class="request-item" onclick="loadRequest('${collectionId}', '${request.id}')">
                    <span class="request-method ${methodClass}">${request.method}</span>
                    <span class="request-name">${escapeHtml(request.name)}</span>
                </div>
                <div class="request-item-actions">
                    <button class="btn-icon-sm" onclick="event.stopPropagation(); cloneRequest('${collectionId}', '${request.id}')" title="复制">📋</button>
                    <button class="btn-icon-sm" onclick="event.stopPropagation(); deleteRequestFromList('${collectionId}', '${request.id}')" title="删除">🗑️</button>
                </div>
            </div>
        `;
    });

    return html;
}

// 切换集合展开/折叠
function toggleCollection(collectionId) {
    const contentEl = document.getElementById(`collection-${collectionId}`);
    if (contentEl) {
        contentEl.style.display = contentEl.style.display === 'none' ? 'block' : 'none';
    }
}

// 切换文件夹展开/折叠
function toggleFolder(folderId) {
    const contentEl = document.getElementById(`folder-${folderId}`);
    if (contentEl) {
        contentEl.style.display = contentEl.style.display === 'none' ? 'block' : 'none';
    }
}

// 把某个请求节点加载到右侧编辑器：
// 页面触发：左侧请求节点点击。
// - 先在集合树里递归找到目标请求；
// - 再把方法、URL、参数、Header、Body 依次回填到右侧编辑区；
// - 这是“左侧点一项 -> 右侧出现详情”的核心桥接函数。
function loadRequest(collectionId, requestId) {
    const collection = allCollections.find(c => c.id === collectionId);
    if (!collection) return;

    // 递归查找请求
    function findRequest(container) {
        for (const req of container.requests || []) {
            if (req.id === requestId) return req;
        }
        for (const folder of container.folders || []) {
            const found = findRequest(folder);
            if (found) return found;
        }
        return null;
    }

    const request = findRequest(collection);
    if (!request) return;

    currentCollection = collection;
    currentRequest = request;

    // 显示请求编辑器
    const emptyStateEl = document.getElementById('empty-state');
    const editorEl = document.getElementById('request-editor');
    if (emptyStateEl) emptyStateEl.style.display = 'none';
    if (editorEl) editorEl.style.display = 'flex';

    // 填充请求名称
    const nameEl = document.getElementById('request-name');
    if (nameEl) nameEl.value = request.name || '';

    // 填充 HTTP 工具
    const methodEl = document.getElementById('http-method');
    if (methodEl) methodEl.value = request.method || 'GET';

    const urlEl = document.getElementById('http-url');
    if (urlEl) urlEl.value = request.url || '';

    // 填充 Params
    renderHttpKvEditor('http-params-editor', request.params || [], 'Key', 'Value', 'addHttpParam');

    // 填充 Headers
    renderHttpKvEditor('http-headers-editor', request.headers || [], 'Header Name', 'Header Value', 'addHttpHeader');

    // 填充 Body
    const bodyType = request.body?.type || 'none';
    const bodyRadio = document.querySelector(`input[name="http-body-type"][value="${bodyType}"]`);
    if (bodyRadio) bodyRadio.checked = true;

    const bodyEditor = document.getElementById('http-body-editor');
    if (bodyEditor) {
        bodyEditor.style.display = bodyType === 'none' ? 'none' : 'block';
    }

    const bodyEl = document.getElementById('http-body-text');
    if (bodyEl) bodyEl.value = request.body?.content || '';

    // 清空响应
    const responseBodyEl = document.getElementById('http-response-body');
    const responseHeadersEl = document.getElementById('http-response-headers-text');
    const responseMetaEl = document.getElementById('http-response-meta');
    if (responseBodyEl) responseBodyEl.value = '';
    if (responseHeadersEl) responseHeadersEl.value = '';
    if (responseMetaEl) responseMetaEl.innerHTML = '';
}

// 渲染键值对编辑器：
// 页面位置：右侧请求编辑器中的 Params / Headers / FormData 行编辑区。
// - Params / Headers / FormData 这几类编辑器都复用这套 DOM 模板；
// - 每一行都保留 key、value、enabled 三元结构，便于后续收集和发送请求。
function renderHttpKvEditor(editorId, items, keyPlaceholder, valuePlaceholder, addHandler) {
    const editorEl = document.getElementById(editorId);
    if (!editorEl) return;

    let html = '';
    (items || []).forEach(item => {
        html += `
            <div class="http-kv-row">
                <input type="text" placeholder="${keyPlaceholder}" class="http-kv-key" autocapitalize="off" autocorrect="off" spellcheck="false" value="${escapeAttr(item.key || '')}">
                <input type="text" placeholder="${valuePlaceholder}" class="http-kv-value" autocapitalize="off" autocorrect="off" spellcheck="false" value="${escapeAttr(item.value || '')}">
                <label class="http-kv-enable"><input type="checkbox" ${item.enabled !== false ? 'checked' : ''}> 启用</label>
                <button class="btn btn-sm btn-ghost" onclick="removeHttpKvRow(this)">-</button>
            </div>
        `;
    });

    html += `
        <div class="http-kv-row">
            <input type="text" placeholder="${keyPlaceholder}" class="http-kv-key" autocapitalize="off" autocorrect="off" spellcheck="false">
            <input type="text" placeholder="${valuePlaceholder}" class="http-kv-value" autocapitalize="off" autocorrect="off" spellcheck="false">
            <label class="http-kv-enable"><input type="checkbox" checked> 启用</label>
            <button class="btn btn-sm btn-ghost" onclick="${addHandler}()">+</button>
        </div>
    `;

    editorEl.innerHTML = html;
}

// 收集键值对编辑器当前值：
// - 把 DOM 中的多行输入重新组装成统一数组结构；
// - saveCurrentRequest() 和真正发送请求前都会依赖它。
function collectHttpEditorItems(editorId) {
    const editorEl = document.getElementById(editorId);
    if (!editorEl) return [];

    const rows = editorEl.querySelectorAll('.http-kv-row');
    const items = [];

    rows.forEach(row => {
        const keyInput = row.querySelector('.http-kv-key');
        const valueInput = row.querySelector('.http-kv-value');
        const enabledInput = row.querySelector('input[type="checkbox"]');

        const key = keyInput?.value?.trim() || '';
        const value = valueInput?.value?.trim() || '';

        if (!key) return;

        items.push({
            key: key,
            value: value,
            enabled: enabledInput ? enabledInput.checked : true
        });
    });

    return items;
}

// 从集合页右侧编辑器触发实际发送：
// 页面触发：右侧请求编辑器里的“发送”按钮。
// - 当前页面本身负责“保存请求定义”和“选中哪个请求”；
// - 真正发送仍然复用 app_tools_c.js 里的 sendHttpRequest() 逻辑。
async function sendHttpRequestFromCollection() {
    if (!currentCollection || !currentRequest) {
        alert('请先选择一个请求');
        return;
    }

    // 调用 M24 工具的发送请求函数
    if (typeof sendHttpRequest === 'function') {
        await sendHttpRequest();
    } else {
        alert('HTTP 请求工具未加载');
    }
}

// 显示新建集合弹窗
function showNewCollectionModal() {
    document.getElementById('new-collection-name').value = '';
    document.getElementById('new-collection-description').value = '';
    openModal('new-collection-modal');
}

// 创建新集合
async function createNewCollection() {
    const name = document.getElementById('new-collection-name').value.trim();
    const description = document.getElementById('new-collection-description').value.trim();

    if (!name) {
        alert('请输入集合名称');
        return;
    }

    await pywebview.api.add_http_collection(name, description);
    closeModal('new-collection-modal');
    await loadHttpCollections();
}

// 删除集合
async function deleteCollection(collectionId) {
    if (!confirm('确定删除此集合？')) return;

    await pywebview.api.delete_http_collection(collectionId);
    await loadHttpCollections();
}

// 显示导入集合弹窗
function showImportCollectionModal() {
    document.getElementById('import-format').value = 'postman';
    document.getElementById('import-file-name').value = '';
    importCollectionFileContent = '';
    openModal('import-collection-modal');
}

// 选择导入文件
async function pickImportCollectionFile() {
    if (!window.pywebview || !window.pywebview.api) return;

    try {
        const result = await pywebview.api.open_collection_file_dialog();

        if (result.success) {
            document.getElementById('import-file-name').value = result.fileName;
            importCollectionFileContent = result.content;
        } else {
            if (result.error !== '未选择文件') {
                alert(`选择文件失败：${result.error}`);
            }
        }
    } catch (e) {
        alert(`选择文件失败：${e.message}`);
    }
}

// 导入外部集合定义：
// 页面触发：导入弹窗中的“确认导入”按钮。
// - 这里根据用户选择的格式，分发到 Postman / Apifox / OpenAPI 对应后端接口；
// - 导入成功后统一刷新左侧集合树。
async function importCollection() {
    const format = document.getElementById('import-format').value;

    if (!importCollectionFileContent) {
        alert('请先选择文件');
        return;
    }

    try {
        const data = JSON.parse(importCollectionFileContent);

        let result;
        if (format === 'postman') {
            result = await pywebview.api.import_postman_collection(data);
        } else if (format === 'apifox') {
            result = await pywebview.api.import_apifox_collection(data);
        } else if (format === 'openapi') {
            result = await pywebview.api.import_openapi_collection(data);
        }

        closeModal('import-collection-modal');
        await loadHttpCollections();
        alert(`导入成功：${result.name}`);
    } catch (e) {
        alert(`导入失败：${e.message}`);
    }
}

// 保存当前右侧编辑器中的请求定义：
// 页面触发：右侧请求编辑器里的“保存”按钮。
// - 把页面上的名称、方法、URL、Params、Headers、Body 重新组装成 requestData；
// - 再回写到 api.py -> HttpCollectionsService 持久化。
async function saveCurrentRequest() {
    if (!currentCollection || !currentRequest) return;

    const requestData = {
        name: document.getElementById('request-name').value,
        method: document.getElementById('http-method').value,
        url: document.getElementById('http-url').value,
        headers: collectHttpEditorItems('http-headers-editor'),
        params: collectHttpEditorItems('http-params-editor'),
        body: {
            type: document.querySelector('input[name="http-body-type"]:checked').value,
            content: document.getElementById('http-body-text').value
        },
        auth: {
            type: 'none'
        }
    };

    await pywebview.api.update_http_request(currentCollection.id, currentRequest.id, requestData);
    await loadHttpCollections();
    alert('保存成功');
}

// 删除当前请求
async function deleteCurrentRequest() {
    if (!currentCollection || !currentRequest) return;
    if (!confirm('确定删除此请求？')) return;

    await pywebview.api.delete_http_request(currentCollection.id, currentRequest.id);
    await loadHttpCollections();

    // 清空编辑器
    document.getElementById('empty-state').style.display = 'block';
    document.getElementById('request-editor').style.display = 'none';
    currentRequest = null;
}

// 从列表删除请求
async function deleteRequestFromList(collectionId, requestId) {
    if (!confirm('确定删除此请求？')) return;

    await pywebview.api.delete_http_request(collectionId, requestId);
    await loadHttpCollections();

    // 如果删除的是当前请求，清空编辑器
    if (currentRequest && currentRequest.id === requestId) {
        document.getElementById('empty-state').style.display = 'block';
        document.getElementById('request-editor').style.display = 'none';
        currentRequest = null;
    }
}

// 复制请求
async function cloneRequest(collectionId, requestId) {
    const collection = allCollections.find(c => c.id === collectionId);
    if (!collection) return;

    // 递归查找请求
    function findRequest(container) {
        for (const req of container.requests || []) {
            if (req.id === requestId) return req;
        }
        for (const folder of container.folders || []) {
            const found = findRequest(folder);
            if (found) return found;
        }
        return null;
    }

    const request = findRequest(collection);
    if (!request) return;

    // 创建副本
    const clonedRequest = {
        name: `${request.name} (副本)`,
        method: request.method,
        url: request.url,
        headers: request.headers || [],
        params: request.params || [],
        body: request.body || { type: 'none', content: '' },
        auth: request.auth || { type: 'none' },
        description: request.description || '',
        tags: request.tags || []
    };

    await pywebview.api.add_http_request(collectionId, clonedRequest);
    await loadHttpCollections();
    alert('请求已复制');
}

// 显示新建文件夹弹窗
function showNewFolderModal(collectionId, parentPath, level) {
    // TODO: 实现新建文件夹功能
    alert('新建文件夹功能待实现');
}

// 显示新建请求弹窗
function showNewRequestModal(collectionId, folderPath) {
    newRequestCollectionId = collectionId;
    newRequestFolderPath = folderPath || [];

    document.getElementById('new-request-name').value = '';
    document.getElementById('new-request-method').value = 'GET';
    document.getElementById('new-request-url').value = '';
    openModal('new-request-modal');
}

// 创建新请求
async function createNewRequest() {
    const name = document.getElementById('new-request-name').value.trim();
    const method = document.getElementById('new-request-method').value;
    const url = document.getElementById('new-request-url').value.trim();

    if (!name) {
        alert('请输入请求名称');
        return;
    }

    const requestData = {
        name: name,
        method: method,
        url: url,
        headers: [],
        params: [],
        body: { type: 'none', content: '' },
        auth: { type: 'none' },
        description: '',
        tags: []
    };

    await pywebview.api.add_http_request(newRequestCollectionId, requestData, newRequestFolderPath);
    closeModal('new-request-modal');
    await loadHttpCollections();
    alert('请求已创建');
}

// ==================== 导出功能：把集合结构导出到外部文件 ====================
// 这里对应页面中的导出按钮和格式选择，是对外分享/备份集合的主要入口。

/**
 * 导出集合为 OpenAPI 3.0 格式
 * @param {string} collectionId - 集合 ID，为空则导出所有
 */
async function exportCollectionOpenAPI(collectionId = null) {
    if (!window.pywebview?.api?.export_openapi_collection) {
        showToast('导出功能不可用', 'error');
        return;
    }

    try {
        const result = await pywebview.api.export_openapi_collection(collectionId);
        if (result.success) {
            const filename = collectionId
                ? `${allCollections.find(c => c.id === collectionId)?.name || 'api'}_openapi.json`
                : 'api_openapi.json';
            downloadAsFile(result.data, filename, 'application/json');
            showToast('已导出 OpenAPI 文档', 'success');
        } else {
            showToast(result.error || '导出失败', 'error');
        }
    } catch (e) {
        console.error('导出 OpenAPI 失败:', e);
        showToast('导出失败', 'error');
    }
}

/**
 * 导出集合为 Postman Collection v2.1 格式
 * @param {string} collectionId - 集合 ID，为空则导出所有
 */
async function exportCollectionPostman(collectionId = null) {
    if (!window.pywebview?.api?.export_postman_collection) {
        showToast('导出功能不可用', 'error');
        return;
    }

    try {
        const result = await pywebview.api.export_postman_collection(collectionId);
        if (result.success) {
            const filename = collectionId
                ? `${allCollections.find(c => c.id === collectionId)?.name || 'api'}_postman.json`
                : 'api_postman.json';
            downloadAsFile(result.data, filename, 'application/json');
            showToast('已导出 Postman Collection', 'success');
        } else {
            showToast(result.error || '导出失败', 'error');
        }
    } catch (e) {
        console.error('导出 Postman 失败:', e);
        showToast('导出失败', 'error');
    }
}

/**
 * 下载数据为文件
 * @param {object} data - 要下载的数据
 * @param {string} filename - 文件名
 * @param {string} mimeType - MIME 类型
 */
function downloadAsFile(data, filename, mimeType) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==================== 环境变量管理：请求发送前的变量替换配置 ====================
// 当 URL、Header、Body 里使用 {{变量}} 时，实际值通常来自这里维护的环境。

let httpEnvironments = [];
let activeEnvironmentId = null;

// 加载环境变量集合：
// 页面位置：顶部环境选择器与环境管理弹窗的数据来源。
// - 用于支撑 {{变量}} 替换；
// - 页面初次进入、环境新增/删除/保存后都会重新走这里刷新本地缓存。
async function loadHttpEnvironments() {
    if (!window.pywebview?.api?.get_http_environments) return;

    try {
        httpEnvironments = await pywebview.api.get_http_environments();
        const active = httpEnvironments.find(e => e.is_active);
        activeEnvironmentId = active?.id || null;
        renderEnvironmentSelector();
    } catch (e) {
        console.error('加载环境变量失败:', e);
    }
}

// 渲染顶部环境下拉框：
// 页面位置：右侧请求编辑器顶部的环境选择框。
// - 这里只关心当前有哪些环境和哪个是活跃环境；
// - 真正的环境编辑在下方管理弹窗里处理。
function renderEnvironmentSelector() {
    const selector = document.getElementById('env-selector');
    if (!selector) return;

    let html = '<option value="">无环境</option>';
    httpEnvironments.forEach(env => {
        const selected = env.id === activeEnvironmentId ? 'selected' : '';
        html += `<option value="${env.id}" ${selected}>${escapeHtml(env.name)}</option>`;
    });
    selector.innerHTML = html;
}

// 切换当前活跃环境：
// 页面触发：顶部环境下拉框 onchange。
// - 切换后后续 URL/Header/Body 中的 {{变量}} 都会走新的环境值替换；
// - 不会立即重发请求，真正生效通常发生在下一次发送时。
async function switchHttpEnvironment(envId) {
    if (!window.pywebview?.api?.set_active_http_environment) return;

    try {
        await pywebview.api.set_active_http_environment(envId || null);
        activeEnvironmentId = envId || null;
        showToast(envId ? '已切换环境' : '已清除环境', 'success');
    } catch (e) {
        console.error('切换环境失败:', e);
        showToast('切换环境失败', 'error');
    }
}

function openEnvManagerModal() {
    const modal = document.getElementById('env-manager-modal');
    if (modal) {
        modal.classList.add('active');
        renderEnvManagerList();
    }
}

function closeEnvManagerModal() {
    const modal = document.getElementById('env-manager-modal');
    if (modal) modal.classList.remove('active');
}

// 渲染环境管理弹窗列表：
// 页面位置：环境管理弹窗主体区域。
// - 展示环境名称、活跃状态和变量预览；
// - 编辑/删除按钮也在这里一起渲染。
function renderEnvManagerList() {
    const list = document.getElementById('env-manager-list');
    if (!list) return;

    if (httpEnvironments.length === 0) {
        list.innerHTML = '<div class="empty-state">暂无环境，点击上方按钮创建</div>';
        return;
    }

    let html = '';
    httpEnvironments.forEach(env => {
        const activeClass = env.is_active ? 'is-active' : '';
        html += `
            <div class="env-item ${activeClass}" data-env-id="${env.id}">
                <div class="env-item-header">
                    <span class="env-name">${escapeHtml(env.name)}</span>
                    ${env.is_active ? '<span class="env-badge">活跃</span>' : ''}
                    <div class="env-actions">
                        <button class="btn btn-sm btn-ghost" onclick="editEnvironment('${env.id}')" title="编辑">✏️</button>
                        <button class="btn btn-sm btn-ghost" onclick="deleteEnvironment('${env.id}')" title="删除">🗑️</button>
                    </div>
                </div>
                <div class="env-variables">
                    ${env.variables.slice(0, 3).map(v => `<span class="env-var-tag">${escapeHtml(v.key)}</span>`).join('')}
                    ${env.variables.length > 3 ? `<span class="env-var-more">+${env.variables.length - 3}</span>` : ''}
                </div>
            </div>
        `;
    });
    list.innerHTML = html;
}

async function createEnvironment() {
    const name = prompt('请输入环境名称（如：开发环境、测试环境）');
    if (!name?.trim()) return;

    if (!window.pywebview?.api?.create_http_environment) return;

    try {
        const result = await pywebview.api.create_http_environment(name.trim(), []);
        if (result.success) {
            showToast('环境创建成功', 'success');
            await loadHttpEnvironments();
            renderEnvManagerList();
            editEnvironment(result.id);
        } else {
            showToast(result.error || '创建失败', 'error');
        }
    } catch (e) {
        console.error('创建环境失败:', e);
        showToast('创建失败', 'error');
    }
}

async function editEnvironment(envId) {
    const env = httpEnvironments.find(e => e.id === envId);
    if (!env) return;

    const modal = document.getElementById('env-edit-modal');
    if (!modal) return;

    document.getElementById('env-edit-id').value = envId;
    document.getElementById('env-edit-name').value = env.name;
    renderEnvVariablesEditor(env.variables);

    modal.classList.add('active');
}

function closeEnvEditModal() {
    const modal = document.getElementById('env-edit-modal');
    if (modal) modal.classList.remove('active');
}

function renderEnvVariablesEditor(variables) {
    const container = document.getElementById('env-variables-editor');
    if (!container) return;

    let html = '';
    (variables || []).forEach((v, idx) => {
        html += `
            <div class="env-var-row" data-idx="${idx}">
                <input type="checkbox" ${v.enabled !== false ? 'checked' : ''} onchange="updateEnvVarEnabled(${idx}, this.checked)">
                <input type="text" class="env-var-key" value="${escapeAttr(v.key || '')}" placeholder="变量名" onchange="updateEnvVarKey(${idx}, this.value)">
                <input type="text" class="env-var-value" value="${escapeAttr(v.value || '')}" placeholder="值" onchange="updateEnvVarValue(${idx}, this.value)">
                <button class="btn btn-sm btn-ghost" onclick="removeEnvVar(${idx})">×</button>
            </div>
        `;
    });
    html += `
        <div class="env-var-add">
            <button class="btn btn-sm btn-ghost" onclick="addEnvVar()">+ 添加变量</button>
        </div>
    `;
    container.innerHTML = html;
}

let editingEnvVariables = [];

function getEditingVariables() {
    const envId = document.getElementById('env-edit-id')?.value;
    const env = httpEnvironments.find(e => e.id === envId);
    return env?.variables || [];
}

function updateEnvVarEnabled(idx, enabled) {
    const vars = getEditingVariables();
    if (vars[idx]) vars[idx].enabled = enabled;
}

function updateEnvVarKey(idx, key) {
    const vars = getEditingVariables();
    if (vars[idx]) vars[idx].key = key;
}

function updateEnvVarValue(idx, value) {
    const vars = getEditingVariables();
    if (vars[idx]) vars[idx].value = value;
}

function addEnvVar() {
    const envId = document.getElementById('env-edit-id')?.value;
    const env = httpEnvironments.find(e => e.id === envId);
    if (env) {
        env.variables.push({ key: '', value: '', enabled: true });
        renderEnvVariablesEditor(env.variables);
    }
}

function removeEnvVar(idx) {
    const envId = document.getElementById('env-edit-id')?.value;
    const env = httpEnvironments.find(e => e.id === envId);
    if (env) {
        env.variables.splice(idx, 1);
        renderEnvVariablesEditor(env.variables);
    }
}

// 保存环境变量编辑弹窗：
// 页面触发：环境编辑弹窗中的“保存”按钮。
// - 先从 DOM 表单重新收集变量行；
// - 再统一提交给后端保存；
// - 保存成功后刷新顶部下拉框和环境管理列表。
async function saveEnvironment() {
    const envId = document.getElementById('env-edit-id')?.value;
    const name = document.getElementById('env-edit-name')?.value?.trim();

    if (!envId || !name) {
        showToast('请填写环境名称', 'warning');
        return;
    }

    const env = httpEnvironments.find(e => e.id === envId);
    if (!env) return;

    // 收集变量
    const variables = [];
    document.querySelectorAll('#env-variables-editor .env-var-row').forEach(row => {
        const key = row.querySelector('.env-var-key')?.value?.trim();
        const value = row.querySelector('.env-var-value')?.value || '';
        const enabled = row.querySelector('input[type="checkbox"]')?.checked ?? true;
        if (key) {
            variables.push({ key, value, enabled });
        }
    });

    if (!window.pywebview?.api?.update_http_environment) return;

    try {
        const result = await pywebview.api.update_http_environment(envId, name, variables);
        if (result.success) {
            showToast('环境保存成功', 'success');
            closeEnvEditModal();
            await loadHttpEnvironments();
            renderEnvManagerList();
        } else {
            showToast(result.error || '保存失败', 'error');
        }
    } catch (e) {
        console.error('保存环境失败:', e);
        showToast('保存失败', 'error');
    }
}

async function deleteEnvironment(envId) {
    if (!confirm('确定要删除这个环境吗？')) return;

    if (!window.pywebview?.api?.delete_http_environment) return;

    try {
        const result = await pywebview.api.delete_http_environment(envId);
        if (result.success) {
            showToast('环境已删除', 'success');
            await loadHttpEnvironments();
            renderEnvManagerList();
        } else {
            showToast(result.error || '删除失败', 'error');
        }
    } catch (e) {
        console.error('删除环境失败:', e);
        showToast('删除失败', 'error');
    }
}

// 在文本里执行环境变量替换：
// 典型调用方：sendHttpRequest()、URL 输入框、Header/Body 发送前处理。
// - 典型输入是 URL、Header、Body 中的 {{baseUrl}} 这类占位符；
// - 只会替换当前活跃环境中启用的变量。
function replaceVariablesInText(text) {
    if (!text || !activeEnvironmentId) return text;

    const env = httpEnvironments.find(e => e.id === activeEnvironmentId);
    if (!env?.variables) return text;

    let result = String(text);
    env.variables.forEach(v => {
        if (v.enabled !== false && v.key) {
            try {
                // 转义正则特殊字符
                const escapedKey = v.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`\\{\\{${escapedKey}\\}\\}`, 'g');
                // 使用函数形式避免 $1 等被当作分组引用
                result = result.replace(regex, () => v.value || '');
            } catch (e) {
                // 忽略单个变量替换失败
            }
        }
    });
    return result;
}

// ==================== JSON 树形视图：把响应 JSON 以树形方式展开查看 ====================
// 如果“响应有数据但用户看不懂结构”，通常就是这里负责的展示层。
// 响应 JSON 树形视图渲染：
// 页面位置：右侧响应区的 JSON Tree 标签或树形容器。
// - 文本响应框负责原始文本，这里负责“结构化可展开查看”；
// - 如果用户说“JSON 文本有了，但树形视图没出来”，优先看这里和 M16 模块是否加载。
function renderHttpJsonTreeView(jsonText) {
    const container = document.getElementById('http-response-tree');
    if (!container) return;

    if (!window.DogToolboxM16Utils?.parseAndRender) {
        container.innerHTML = '<div class="jtree-empty">JSON 树形视图模块未加载</div>';
        return;
    }

    try {
        const result = window.DogToolboxM16Utils.parseAndRender(jsonText);
        if (result.error) {
            container.innerHTML = `<div class="jtree-error">解析错误: ${escapeHtml(result.error)}</div>`;
        } else {
            // 使用 DOM 方式插入，避免直接 innerHTML
            container.innerHTML = '';
            const wrapper = document.createElement('div');
            wrapper.innerHTML = result.html;
            container.appendChild(wrapper);
        }
    } catch (e) {
        container.innerHTML = `<div class="jtree-error">渲染错误: ${escapeHtml(e.message)}</div>`;
    }
}

function updateHttpResponseTree() {
    const responseBody = document.getElementById('http-response-body')?.value || '';
    renderHttpJsonTreeView(responseBody);
}

// ==================== 请求历史记录：记录最近的调试痕迹，便于回放和复核 ====================
// 适合排查“刚才发过什么请求、返回了什么”的问题。
// 记录最近请求历史：
// 页面位置：不是直接可见的 UI，而是为“请求历史”标签页准备本地缓存。
// - 这里只写 localStorage，目的是方便调试回放，不是正式集合数据；
// - 每次请求成功返回后通常都会走这里，把关键元数据压缩保存。
function saveHttpRequestHistory(method, url, headers, body, response) {
    try {
        const raw = localStorage.getItem(HTTP_HISTORY_KEY);
        const data = raw ? JSON.parse(raw) : { entries: [] };

        const entry = {
            id: Date.now().toString(),
            method,
            url: url.slice(0, 500),
            headers: headers ? JSON.stringify(headers).slice(0, 1000) : null,
            body: body ? body.slice(0, 1000) : null,
            responseStatus: response?.status,
            responseBody: response?.body?.slice(0, 2000),
            duration: response?.duration,
            timestamp: Date.now()
        };

        data.entries.unshift(entry);
        if (data.entries.length > HTTP_HISTORY_MAX) {
            data.entries = data.entries.slice(0, HTTP_HISTORY_MAX);
        }

        localStorage.setItem(HTTP_HISTORY_KEY, JSON.stringify(data));
        renderHttpRequestHistory();
    } catch (e) { /* ignore */ }
}

function loadHttpRequestHistory() {
    try {
        const raw = localStorage.getItem(HTTP_HISTORY_KEY);
        return raw ? JSON.parse(raw).entries || [] : [];
    } catch (e) {
        return [];
    }
}

// 渲染“最近请求历史”标签页：
// 页面位置：右侧响应区中的历史列表面板。
// - 负责把 localStorage 里的最近请求转成可点击列表；
// - 点击后会触发 replayHttpRequest() 回填到当前请求编辑器。
function renderHttpRequestHistory() {
    const container = document.getElementById('http-request-history');
    if (!container) return;

    const entries = loadHttpRequestHistory();
    if (!entries.length) {
        container.innerHTML = '<div class="http-history-empty">暂无请求历史</div>';
        return;
    }

    const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

    container.innerHTML = entries.map(e => {
        const statusClass = e.responseStatus >= 200 && e.responseStatus < 400 ? 'success' : 'error';
        const safeMethod = ALLOWED_METHODS.includes(e.method?.toUpperCase()) ? e.method.toUpperCase() : 'GET';
        const methodClass = safeMethod.toLowerCase();
        return `
            <div class="http-history-item" data-history-id="${escapeAttr(e.id)}">
                <div class="http-history-header">
                    <span class="http-history-method method-${methodClass}">${safeMethod}</span>
                    <span class="http-history-url">${escapeHtml(e.url.slice(0, 60))}${e.url.length > 60 ? '...' : ''}</span>
                </div>
                <div class="http-history-meta">
                    <span class="http-history-status ${statusClass}">${e.responseStatus || '-'}</span>
                    <span class="http-history-duration">${e.duration ? e.duration + 'ms' : '-'}</span>
                    <span class="http-history-time">${formatHttpHistoryTime(e.timestamp)}</span>
                </div>
            </div>
        `;
    }).join('');

    // 事件委托（避免重复绑定）
    if (!container._historyClickBound) {
        container._historyClickBound = true;
        container.addEventListener('click', (e) => {
            const item = e.target.closest('.http-history-item');
            if (item) {
                const historyId = item.dataset.historyId;
                if (historyId) replayHttpRequest(historyId);
            }
        });
    }
}

// 回放一条历史请求到当前编辑器：
// 页面触发：历史列表中的“回放/再次使用”按钮。
// - 这一步不会自动发送，只是帮助用户把当时的 method/url/header/body 快速恢复出来；
// - 恢复后仍然需要用户再次点击发送。
function replayHttpRequest(historyId) {
    const entries = loadHttpRequestHistory();
    const entry = entries.find(e => e.id === historyId);
    if (!entry) return;

    // 填充请求表单
    const methodEl = document.getElementById('http-method');
    const urlEl = document.getElementById('http-url');

    if (methodEl) methodEl.value = entry.method;
    if (urlEl) urlEl.value = entry.url;

    // 填充请求头
    if (entry.headers) {
        try {
            const headers = JSON.parse(entry.headers);
            const items = Object.entries(headers).map(([key, value]) => ({ key, value, enabled: true }));
            renderHttpKvEditor('http-headers-editor', items, 'Header', 'Value', 'addHttpHeader');
        } catch (e) { /* ignore */ }
    }

    // 填充请求体
    if (entry.body) {
        const bodyEl = document.getElementById('http-body-text');
        if (bodyEl) bodyEl.value = entry.body;
    }

    showToast?.('已加载历史请求', 'info');
}

function clearHttpRequestHistory() {
    localStorage.removeItem(HTTP_HISTORY_KEY);
    renderHttpRequestHistory();
    showToast?.('历史记录已清空', 'info');
}

function formatHttpHistoryTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
