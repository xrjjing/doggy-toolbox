// HTTP 请求集合管理
let allCollections = [];
let currentCollection = null;
let currentRequest = null;
let importCollectionFileContent = '';
let newRequestCollectionId = '';
let newRequestFolderPath = [];
let sidebarCollapsed = false;
let httpCollectionsZoom = 100;

// 初始化缩放
function initHttpCollectionsZoom() {
    const savedZoom = localStorage.getItem('httpCollectionsZoom');
    if (savedZoom) {
        httpCollectionsZoom = parseInt(savedZoom);
        applyHttpCollectionsZoom();
    }
}

// 应用缩放
function applyHttpCollectionsZoom() {
    const container = document.getElementById('page-http-collections');
    if (container) {
        const scale = httpCollectionsZoom / 100;
        container.style.transform = `scale(${scale})`;
        container.style.transformOrigin = 'top left';
        container.style.width = `${100 / scale}%`;
        container.style.height = `${100 / scale}%`;
    }

    const zoomLevel = document.getElementById('http-collections-zoom-level');
    if (zoomLevel) {
        zoomLevel.textContent = `${httpCollectionsZoom}%`;
    }

    // 保存到 localStorage
    localStorage.setItem('httpCollectionsZoom', httpCollectionsZoom);
}

// 调整缩放
function adjustHttpCollectionsZoom(delta) {
    httpCollectionsZoom = Math.max(50, Math.min(100, httpCollectionsZoom + delta));
    applyHttpCollectionsZoom();
}

// 重置缩放
function resetHttpCollectionsZoom() {
    httpCollectionsZoom = 100;
    applyHttpCollectionsZoom();
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

// 加载所有集合
async function loadHttpCollections() {
    if (!window.pywebview || !window.pywebview.api) return;
    if (!document.getElementById('collections-list')) return;

    // 初始化缩放
    initHttpCollectionsZoom();

    allCollections = await pywebview.api.get_http_collections();
    renderCollectionsList();
}

// 渲染集合列表
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

// 加载请求详情
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

// 渲染 HTTP 工具的键值对编辑器
function renderHttpKvEditor(editorId, items, keyPlaceholder, valuePlaceholder, addHandler) {
    const editorEl = document.getElementById(editorId);
    if (!editorEl) return;

    let html = '';
    (items || []).forEach(item => {
        html += `
            <div class="http-kv-row">
                <input type="text" placeholder="${keyPlaceholder}" class="http-kv-key" value="${escapeHtml(item.key || '')}">
                <input type="text" placeholder="${valuePlaceholder}" class="http-kv-value" value="${escapeHtml(item.value || '')}">
                <label class="http-kv-enable"><input type="checkbox" ${item.enabled !== false ? 'checked' : ''}> 启用</label>
                <button class="btn btn-sm btn-ghost" onclick="removeHttpKvRow(this)">-</button>
            </div>
        `;
    });

    html += `
        <div class="http-kv-row">
            <input type="text" placeholder="${keyPlaceholder}" class="http-kv-key">
            <input type="text" placeholder="${valuePlaceholder}" class="http-kv-value">
            <label class="http-kv-enable"><input type="checkbox" checked> 启用</label>
            <button class="btn btn-sm btn-ghost" onclick="${addHandler}()">+</button>
        </div>
    `;

    editorEl.innerHTML = html;
}

// 收集 HTTP 编辑器数据
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

// 发送 HTTP 请求（从集合）
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

// 导入集合
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

// 保存当前请求
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
