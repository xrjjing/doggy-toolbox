/*
 * 文件总览：命令管理与凭证管理前端逻辑。
 *
 * 服务页面：
 * - web/pages/credentials.html：凭证列表、卡片/列表视图切换、增删改查、拖拽排序；
 * - web/pages/commands.html：命令页签、命令卡片、搜索过滤、拖拽排序、批量导入。
 *
 * 调用链：
 * - 页面按钮和输入框通过 onclick/oninput 或初始化逻辑进入本文件；
 * - 本文件再调用 window.pywebview.api.xxx()；
 * - 后端最终落到 api.py -> ComputerUsageService。
 *
 * 排查建议：
 * - 页面结构正常但列表没数据：优先看 loadCredentials()/loadTabs()/loadCommands()；
 * - 拖拽排序不生效：看 onDragStart/onDrop/reorder*()；
 * - 弹窗保存失败：看 saveCredential()/saveCommand() 以及对应 pywebview API 调用。
 */

// ==================== 凭证管理：对应 credentials.html ====================
// 这一段覆盖凭证页的视图切换、列表渲染、弹窗编辑、复制字段与拖拽排序。
// 当前视图模式：保存“卡片/列表”展示偏好，页面刷新后仍能维持用户上一次的阅读方式。
let credentialsViewMode = localStorage.getItem('credentials_view_mode') || 'card';

// SVG 图标定义：凭证卡片里的复制、编辑、删除等按钮都复用这里的内联图标。
const CREDENTIAL_ICONS = {
    delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    extra: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>'
};

// 视图切换函数：点击页面头部的视图按钮后，会先改本地状态，再驱动列表容器换展示模式。
function switchCredentialsView(view) {
    credentialsViewMode = view;
    localStorage.setItem('credentials_view_mode', view);

    // 更新按钮状态
    const toggle = document.getElementById('credentials-view-toggle');
    if (toggle) {
        toggle.querySelectorAll('.view-toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view);
        });
    }

    // 更新容器视图
    const container = document.getElementById('credentials-list');
    if (container) {
        container.dataset.view = view;
    }
}

// 初始化视图切换按钮状态。
// 页面位置：credentials 页头部的“卡片 / 列表”切换按钮。
// 这个函数不拉数据，只负责把当前状态同步到按钮高亮和列表容器上。
function initCredentialsViewToggle() {
    const toggle = document.getElementById('credentials-view-toggle');
    if (toggle) {
        toggle.querySelectorAll('.view-toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === credentialsViewMode);
        });
    }
    const container = document.getElementById('credentials-list');
    if (container) {
        container.dataset.view = credentialsViewMode;
    }
}

// 数据加载入口：进入凭证页时通常会先调用这里，从后端拉取完整凭证列表后再交给 renderCredentials()。
async function loadCredentials() {
    if (!window.pywebview || !window.pywebview.api) return;
    if (!document.getElementById('credentials-list')) return;
    allCredentials = await pywebview.api.get_credentials();
    initCredentialsViewToggle();
    renderCredentials(allCredentials);
}

// 列表渲染核心：根据当前视图模式拼装卡片/列表 DOM，也是“页面上这一块数据从哪来”的关键函数。
function renderCredentials(credentials) {
    const container = document.getElementById('credentials-list');
    if (!container) return;
    if (!credentials.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔐</div>
                <div class="empty-state-text">暂无记录，点击右上角添加</div>
            </div>`;
        return;
    }

    container.innerHTML = credentials.map(cred => `
        <div class="credential-card" data-cred-id="${cred.id}" draggable="true"
             ondragstart="onCredentialDragStart(event)"
             ondragover="onCredentialDragOver(event)"
             ondrop="onCredentialDrop(event)"
             ondragend="onCredentialDragEnd(event)"
             onclick="toggleCredentialCardExpand(this, event)">
            <div class="credential-header">
                <div class="credential-title-area">
                    <div class="credential-service">${escapeHtml(cred.service)}</div>
                    ${cred.url ? `<div class="credential-url"><a href="${escapeHtml(cred.url)}" target="_blank" onclick="event.stopPropagation()">${escapeHtml(cred.url)}</a></div>` : ''}
                    <div class="credential-inline-info">
                        ${cred.account ? `<span class="inline-field"><span class="inline-label">账号:</span> <span class="inline-value">${escapeHtml(cred.account)}</span><button class="copy-btn inline-copy" onclick="event.stopPropagation(); copyField(this, '${escapeAttr(cred.account)}')" title="复制">${CREDENTIAL_ICONS.copy}</button></span>` : ''}
                        ${cred.password ? `<span class="inline-field"><span class="inline-label">密码:</span> <span class="inline-value">${escapeHtml(cred.password)}</span><button class="copy-btn inline-copy" onclick="event.stopPropagation(); copyField(this, '${escapeAttr(cred.password)}')" title="复制">${CREDENTIAL_ICONS.copy}</button></span>` : ''}
                    </div>
                </div>
                <div class="credential-actions">
                    ${cred.extra && cred.extra.length ? `<button class="btn btn-sm btn-ghost credential-extra-btn" onclick="event.stopPropagation(); toggleCredentialExtra('${cred.id}', event)" title="附加信息"><span class="btn-icon">${CREDENTIAL_ICONS.extra}</span></button>` : ''}
                    <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation(); editCredential('${cred.id}')" title="编辑"><span class="btn-icon">${CREDENTIAL_ICONS.edit}</span></button>
                    <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteCredential('${cred.id}')" title="删除"><span class="btn-icon">${CREDENTIAL_ICONS.delete}</span></button>
                </div>
            </div>
            <div class="credential-body">
                ${cred.account ? `
                <div class="credential-field">
                    <span class="credential-label">账号</span>
                    <span class="credential-value">${escapeHtml(cred.account)}</span>
                    <button class="copy-btn" onclick="event.stopPropagation(); copyField(this, '${escapeAttr(cred.account)}')" title="复制">${CREDENTIAL_ICONS.copy}</button>
                </div>` : ''}
                ${cred.password ? `
                <div class="credential-field">
                    <span class="credential-label">密码</span>
                    <span class="credential-value">${escapeHtml(cred.password)}</span>
                    <button class="copy-btn" onclick="event.stopPropagation(); copyField(this, '${escapeAttr(cred.password)}')" title="复制">${CREDENTIAL_ICONS.copy}</button>
                </div>` : ''}
            </div>
            ${cred.extra && cred.extra.length ? `
            <div class="credential-extra-toggle">
                <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation(); toggleCredentialExtra('${cred.id}', event)">
                    ${expandedCredentialIds.has(cred.id) ? '收起附加信息' : '展开附加信息'}
                </button>
            </div>
            <div class="credential-extra ${expandedCredentialIds.has(cred.id) ? 'expanded' : ''}">
                ${cred.extra.map(e => `<div class="credential-extra-item">${escapeHtml(e)}</div>`).join('')}
            </div>` : ''}
        </div>
    `).join('');
}

// 列表视图里的展开 / 收起入口。
// 页面位置：credentials 页切到“列表”模式后，每一行凭证记录本身就是可点击区域。
// 为了避免误触，这里特意排除了按钮和链接点击；
// 所以用户点“复制 / 编辑 / 删除”不会走这里，只有点整行空白区域才会展开或收起详情。
function toggleCredentialCardExpand(card, event) {
    const container = document.getElementById('credentials-list');
    if (!container || container.dataset.view !== 'list') return;

    // 如果点击的是按钮或链接，不处理
    if (event.target.closest('button') || event.target.closest('a')) return;

    card.classList.toggle('expanded');
}

// 搜索过滤入口：对应凭证页顶部搜索框。
// 用户每输入一个关键字，都会在前端按 service / account / url 重新筛选，
// 然后把结果交给 renderCredentials() 重新绘制列表区域。
function filterCredentials() {
    const input = document.getElementById('credential-search');
    if (!input) return;
    const keyword = input.value.toLowerCase();
    const filtered = allCredentials.filter(c =>
        c.service.toLowerCase().includes(keyword) ||
        c.account.toLowerCase().includes(keyword) ||
        c.url.toLowerCase().includes(keyword)
    );
    renderCredentials(filtered);
}

// 打开“添加记录 / 编辑记录”弹窗。
// 这是凭证页右上角新增按钮、卡片编辑按钮共同进入的表单入口，
// 负责把弹窗标题、隐藏 id、各输入框默认值一次性填好。
function showCredentialModal(cred = null) {
    document.getElementById('credential-modal-title').textContent = cred ? '编辑记录' : '添加记录';
    document.getElementById('credential-id').value = cred?.id || '';
    document.getElementById('credential-service').value = cred?.service || '';
    document.getElementById('credential-url').value = cred?.url || '';
    document.getElementById('credential-account').value = cred?.account || '';
    document.getElementById('credential-password').value = cred?.password || '';
    document.getElementById('credential-extra').value = cred?.extra?.join('\n') || '';
    openModal('credential-modal');
}

// 页面触发：凭证卡片上的“编辑”按钮。
async function editCredential(id) {
    const cred = allCredentials.find(c => c.id === id);
    if (cred) showCredentialModal(cred);
}

// 凭证保存主入口：
// 页面触发：credentials 页弹窗里的“保存”按钮。
// 这是“表单字段 -> pywebview.api.add/update_credential()”的桥接点。
async function saveCredential() {
    const id = document.getElementById('credential-id').value;
    const service = document.getElementById('credential-service').value.trim();
    const url = document.getElementById('credential-url').value.trim();
    const account = document.getElementById('credential-account').value.trim();
    const password = document.getElementById('credential-password').value.trim();
    const extra = document.getElementById('credential-extra').value.split('\n').filter(l => l.trim());

    if (!service) {
        alert('请填写服务名称');
        return;
    }

    if (id) {
        await pywebview.api.update_credential(id, service, url, account, password, extra);
    } else {
        await pywebview.api.add_credential(service, url, account, password, extra);
    }
    closeModal('credential-modal');
    loadCredentials();
}

// 页面触发：凭证卡片上的“删除”按钮。
// 这里只负责确认、调用后端删除、再刷新列表；真正的数据删除发生在 pywebview API 后面。
async function deleteCredential(id) {
    if (confirm('确定删除此记录？')) {
        await pywebview.api.delete_credential(id);
        loadCredentials();
    }
}

// 展开 / 收起凭证附加信息。
// 对应卡片里的“附加信息”按钮或“展开附加信息”按钮，
// 会更新 expandedCredentialIds，再重新 render，确保按钮文案和展开区同步刷新。
function toggleCredentialExtra(id, e) {
    if (e) e.stopPropagation();
    if (expandedCredentialIds.has(id)) {
        expandedCredentialIds.delete(id);
    } else {
        expandedCredentialIds.add(id);
    }
    // 重新渲染以更新展开状态与按钮文案
    const keyword = document.getElementById('credential-search').value.toLowerCase();
    const filtered = allCredentials.filter(c =>
        c.service.toLowerCase().includes(keyword) ||
        c.account.toLowerCase().includes(keyword) ||
        c.url.toLowerCase().includes(keyword)
    );
    renderCredentials(keyword ? filtered : allCredentials);
}

// ==================== 凭证拖拽排序：对应 credentials.html 的卡片拖拽 ====================
// 这一组函数负责“拖动凭证卡片调整顺序”：
// - onCredentialDragStart / onCredentialDragOver / onCredentialDrop 负责页面上的拖拽视觉与命中目标；
// - reorderCredentials() 负责真正重排内存数组并调用后端保存顺序。

// 拖拽开始：记录当前被拖动的凭证卡片 id，并给卡片加上拖拽中的样式。
function onCredentialDragStart(e) {
    const card = e.target.closest('.credential-card');
    if (!card) return;
    draggedCredentialId = card.dataset.credId;
    card.classList.add('dragging');
    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
    }
}

// 拖拽悬停：允许当前目标卡片成为放置点，并给它增加高亮提示。
function onCredentialDragOver(e) {
    e.preventDefault();
    const target = e.target.closest('.credential-card');
    if (target && target.dataset.credId !== draggedCredentialId) {
        target.classList.add('drag-over');
    }
}

// 拖拽释放：当用户把卡片松手放到另一张卡片上时，进入这里触发实际重排。
// 这里只做目标判定和收尾清理，真正的顺序变更交给 reorderCredentials()。
async function onCredentialDrop(e) {
    e.preventDefault();
    const target = e.target.closest('.credential-card');
    if (target && draggedCredentialId && target.dataset.credId !== draggedCredentialId) {
        await reorderCredentials(draggedCredentialId, target.dataset.credId);
    }
    document.querySelectorAll('.credential-card').forEach(el => el.classList.remove('drag-over'));
}

// 拖拽结束：无论是否成功排序，最后都要清空拖拽中的临时状态和高亮样式。
function onCredentialDragEnd() {
    draggedCredentialId = null;
    document.querySelectorAll('.credential-card').forEach(el => {
        el.classList.remove('dragging', 'drag-over');
    });
}

// 凭证排序真正落盘的入口。
// 用户拖拽卡片后，前端会先调整内存顺序，再通过这里把新顺序同步给后端。
async function reorderCredentials(draggedId, targetId) {
    const draggedIdx = allCredentials.findIndex(c => c.id === draggedId);
    const targetIdx = allCredentials.findIndex(c => c.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;

    const [dragged] = allCredentials.splice(draggedIdx, 1);
    allCredentials.splice(targetIdx, 0, dragged);

    const keyword = document.getElementById('credential-search').value.toLowerCase();
    const displayList = keyword
        ? allCredentials.filter(c =>
            c.service.toLowerCase().includes(keyword) ||
            c.account.toLowerCase().includes(keyword) ||
            c.url.toLowerCase().includes(keyword)
        )
        : allCredentials;

    renderCredentials(displayList);
    await pywebview.api.reorder_credentials(allCredentials.map(c => c.id));
}

// ==================== 页签管理：对应 commands.html 的分类栏 ====================
// 负责命令页上方的页签加载、切换、拖拽重排以及页签弹窗相关逻辑。
// 页签数据加载入口：进入命令页、页签新增/删除/重排后，通常都会重新走这里。
// 它只负责把“所有页签原始数据”拿回来并决定默认选中项，
// 真正把顶部页签条画出来的是后面的 renderTabs()。
async function loadTabs() {
    if (!window.pywebview || !window.pywebview.api) return;
    if (!document.getElementById('command-tabs')) return;
    allTabs = await pywebview.api.get_tabs();
    if (!currentTabId && allTabs.length) {
        currentTabId = allTabs[0].id;
    }
    renderTabs();
}

// 页面位置：commands 页顶部的页签条。
// 负责渲染页签名称、当前激活态和每个页签下命令数量。
function renderTabs() {
    const container = document.getElementById('command-tabs');
    if (!container) return;
    container.innerHTML = allTabs.map(tab => {
        const count = allCommands.filter(c => c.tab_id === tab.id).length;
        return `
            <div class="tab-item ${tab.id === currentTabId ? 'active' : ''}"
                 data-tab-id="${tab.id}"
                 draggable="true"
                 onclick="selectTab('${tab.id}')"
                 ondragstart="onTabDragStart(event)"
                 ondragover="onTabDragOver(event)"
                 ondrop="onTabDrop(event)"
                 ondragend="onTabDragEnd(event)">
                <span>${escapeHtml(tab.name)}</span>
                <span class="tab-count">${count}</span>
            </div>
        `;
    }).join('');
}

// 页签切换入口：对应 commands 页顶部分类条里每个可点击页签。
// 外行可以把它理解为“点击哪个页签，就让下面命令区只显示这个分组的内容”。
// 这里先改当前选中状态，再分别刷新顶部激活样式和下方命令卡片区。
function selectTab(tabId) {
    currentTabId = tabId;
    renderTabs();
    renderCommandsByTab();
}

// 统计某个页签下有多少条命令。
// 页面位置：顶部页签名称右侧的小数字徽标。
// 如果用户反馈“页签上的数量不对”，通常要先回看 loadCommands() 是否拉到了最新 allCommands。
function getTabCommandCount(tabId) {
    return allCommands.filter(c => c.tab_id === tabId).length;
}

// ==================== 页签拖拽排序：对应 commands.html 顶部分栏 ====================
// 这一组函数负责“拖动页签调整顺序”。
// 前几个函数只负责前端拖拽过程，reorderTabs() 才会把顺序同步给后端。

// 顶部页签拖拽开始：记录被拖动的页签 id，并给当前标签加拖拽态样式。
function onTabDragStart(e) {
    draggedTabId = e.target.dataset.tabId;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

// 顶部页签拖拽经过：允许放置，并给潜在放置目标加高亮。
function onTabDragOver(e) {
    e.preventDefault();
    const target = e.target.closest('.tab-item');
    if (target && target.dataset.tabId !== draggedTabId) {
        target.classList.add('drag-over');
    }
}

// 顶部页签拖拽释放：命中目标页签后，调用 reorderTabs() 做真正排序。
function onTabDrop(e) {
    e.preventDefault();
    const target = e.target.closest('.tab-item');
    if (target && draggedTabId && target.dataset.tabId !== draggedTabId) {
        const targetId = target.dataset.tabId;
        reorderTabs(draggedTabId, targetId);
    }
    document.querySelectorAll('.tab-item').forEach(el => el.classList.remove('drag-over'));
}

// 顶部页签拖拽结束：清空拖拽临时状态，避免残留样式影响下一次拖拽。
function onTabDragEnd(e) {
    draggedTabId = null;
    document.querySelectorAll('.tab-item').forEach(el => {
        el.classList.remove('dragging', 'drag-over');
    });
}

// 页签顺序更新的真正入口。
// 不论是在顶部页签条还是管理弹窗里拖拽，最后都会落到这里。
async function reorderTabs(draggedId, targetId) {
    const draggedIdx = allTabs.findIndex(t => t.id === draggedId);
    const targetIdx = allTabs.findIndex(t => t.id === targetId);

    const [dragged] = allTabs.splice(draggedIdx, 1);
    allTabs.splice(targetIdx, 0, dragged);

    const newOrder = allTabs.map(t => t.id);
    await pywebview.api.reorder_tabs(newOrder);
    renderTabs();
}

// 页签管理弹窗。
// 页面触发：commands 页里的“管理页签”按钮。
// 弹窗内部会列出所有页签，并提供新增、编辑、删除、拖拽调整顺序的操作。
function showTabModal() {
    renderTabManageList();
    openModal('tab-modal');
}

// 页面位置：页签管理弹窗里的列表区域。
// 负责渲染页签名称、拖拽手柄、编辑/删除按钮。
function renderTabManageList() {
    const container = document.getElementById('tabs-manage-list');
    if (!container) return;
    container.innerHTML = allTabs.map(tab => `
        <div class="tab-manage-item" data-tab-id="${tab.id}" draggable="true"
             ondragstart="onManageTabDragStart(event)"
             ondragover="onManageTabDragOver(event)"
             ondrop="onManageTabDrop(event)"
             ondragend="onManageTabDragEnd(event)">
            <span class="tab-drag-handle">☰</span>
            <div class="tab-manage-name">${escapeHtml(tab.name)}</div>
            <div class="tab-manage-actions">
                <button class="tab-manage-btn" onclick="editTabName('${tab.id}')" title="编辑">✏️</button>
                ${tab.id !== '0' ? `<button class="tab-manage-btn delete" onclick="deleteTab('${tab.id}')" title="删除">🗑</button>` : ''}
            </div>
        </div>
    `).join('');
}

// ==================== 页签管理弹窗内的拖拽 ====================
// 这套拖拽只服务于“管理页签”弹窗里的列表区，最终仍然复用 reorderTabs() 保存真实顺序。

// 管理弹窗拖拽开始：从弹窗列表项中取到被拖拽的页签 id。
function onManageTabDragStart(e) {
    draggedManageTabId = e.target.closest('.tab-manage-item').dataset.tabId;
    e.target.closest('.tab-manage-item').classList.add('dragging');
}

// 管理弹窗拖拽经过：给目标管理项加高亮，帮助用户确认放置位置。
function onManageTabDragOver(e) {
    e.preventDefault();
    const target = e.target.closest('.tab-manage-item');
    if (target && target.dataset.tabId !== draggedManageTabId) {
        target.classList.add('drag-over');
    }
}

// 管理弹窗拖拽释放：把弹窗内的操作转成 reorderTabs() 调用，并立即重绘管理列表。
function onManageTabDrop(e) {
    e.preventDefault();
    const target = e.target.closest('.tab-manage-item');
    if (target && draggedManageTabId && target.dataset.tabId !== draggedManageTabId) {
        reorderTabs(draggedManageTabId, target.dataset.tabId);
        renderTabManageList();
    }
    document.querySelectorAll('.tab-manage-item').forEach(el => el.classList.remove('drag-over'));
}

// 管理弹窗拖拽结束：清理弹窗列表里的拖拽样式。
function onManageTabDragEnd(e) {
    draggedManageTabId = null;
    document.querySelectorAll('.tab-manage-item').forEach(el => {
        el.classList.remove('dragging', 'drag-over');
    });
}

// 新增页签入口：对应页签管理弹窗里的输入框和“新增”按钮。
// 调用链：弹窗表单 -> pywebview.api.add_tab() -> 后端保存 -> 重新加载顶部页签栏与弹窗列表。
// 也就是说，如果新增成功但页面上没出现新页签，优先检查这里后面的 loadTabs()/renderTabManageList() 是否执行到。
async function addTab() {
    const nameInput = document.getElementById('new-tab-name');
    if (!nameInput) return;
    const name = nameInput.value.trim();
    if (!name) {
        alert('请输入页签名称');
        return;
    }
    await pywebview.api.add_tab(name);
    nameInput.value = '';
    await loadTabs();
    renderTabManageList();
}

// 编辑页签名称：对应页签管理弹窗中每一项右侧的编辑按钮。
// 这是一个很轻量的“改名入口”，先弹浏览器 prompt，再把新名称提交给后端，然后刷新两处页签显示。
async function editTabName(tabId) {
    const tab = allTabs.find(t => t.id === tabId);
    if (!tab) return;

    const newName = prompt('输入新名称', tab.name);
    if (newName && newName.trim() && newName !== tab.name) {
        await pywebview.api.update_tab(tabId, newName.trim());
        await loadTabs();
        renderTabManageList();
    }
}

// 删除页签：对应页签管理弹窗中的删除按钮。
// 业务效果：页签本身会被删除，但原页签里的命令不会丢失，而是被转移到“未分类”。
// 所以这里保存完成后不仅要刷新页签，还必须刷新命令区，否则用户会误以为命令被删掉了。
async function deleteTab(tabId) {
    if (confirm('删除页签后，其中的命令将移至"未分类"。确定删除？')) {
        await pywebview.api.delete_tab(tabId);
        if (currentTabId === tabId) {
            currentTabId = '0';
        }
        await loadTabs();
        await loadCommands();
        renderTabManageList();
    }
}

// ==================== 命令块管理：对应 commands.html 的卡片区 ====================
// 命令卡片的加载、过滤、编辑、保存、删除都集中在这里，属于命令页最常排查的区块。
// 命令数据加载入口：进入 commands 页，或执行保存 / 删除 / 移动 / 导入后，通常都会重新调用这里。
// 它会一次性刷新三块内容：allCommands 原始数据、拖拽事件委托、顶部页签计数与当前页签卡片区。
async function loadCommands() {
    if (!window.pywebview || !window.pywebview.api) return;
    if (!document.getElementById('commands-list')) return;
    allCommands = await pywebview.api.get_commands();
    initCommandDragEvents(); // 初始化拖拽事件委托
    renderTabs(); // 更新计数
    renderCommandsByTab();
}

// 根据当前选中页签，筛出本次要显示的命令集合。
// 页面位置：commands 页顶部页签栏和中间命令卡片区之间的衔接点。
// 外行排查时可以记住：页签点了没反应，通常不是 renderCommands() 本身有问题，而是这里没有拿到正确的 currentTabId 或 allCommands。
function renderCommandsByTab() {
    const commands = currentTabId
        ? allCommands.filter(c => c.tab_id === currentTabId)
        : allCommands;
    renderCommands(commands);
}

// 命令卡片上的常用按钮图标。
// 页面上看到的“删除 / 复制 / 移动 / 编辑”小图标都从这里集中取值，
// 这样调整样式时只需要改这一处，不必到 renderCommands() 里逐个翻按钮结构。
const COMMAND_ICONS = {
    delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    move: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
};

// 页面位置：commands 页中间的命令卡片列表区。
// 这是“当前页签里的命令块从哪里渲染出来”的核心函数。
function renderCommands(commands) {
    const container = document.getElementById('commands-list');
    if (!container) return;
    if (!commands.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">⌨️</div>
                <div class="empty-state-text">当前页签暂无命令</div>
            </div>`;
        return;
    }

    container.innerHTML = commands.map(cmd => `
        <div class="command-card" data-cmd-id="${cmd.id}">
            <div class="command-header">
                <div class="command-info">
                    <div class="command-title">${escapeHtml(cmd.title)}</div>
                    ${cmd.description ? `<div class="command-description">${escapeHtml(cmd.description)}</div>` : ''}
                </div>
                <div class="command-actions">
                    <button class="btn btn-sm btn-ghost" onclick="showMoveCommandModal('${cmd.id}')" title="移动"><span class="btn-icon">${COMMAND_ICONS.move}</span></button>
                    <button class="btn btn-sm btn-ghost" onclick="editCommand('${cmd.id}')" title="编辑"><span class="btn-icon">${COMMAND_ICONS.edit}</span></button>
                    <button class="btn btn-sm btn-danger" onclick="deleteCommand('${cmd.id}')" title="删除"><span class="btn-icon">${COMMAND_ICONS.delete}</span></button>
                </div>
            </div>
            <div class="command-body">
                <pre>${escapeHtml(cmd.commands.join('\n'))}</pre>
                <button class="command-copy-btn" onclick="copyCommand(this, \`${escapeAttr(cmd.commands.join('\n'))}\`)" title="复制命令">${COMMAND_ICONS.copy}</button>
            </div>
        </div>
    `).join('');
}

// ==================== 命令拖拽排序：对应 commands.html 命令卡片区 ====================
// 这里使用事件委托而不是给每张卡片单独绑事件，原因是命令卡片经常会重新 render。
// 页面上看到的拖拽区域主要是每张卡片的 header，真正持久化顺序仍由 reorderCommands() 负责。

// 初始化命令列表的拖拽事件委托。
// 页面位置：commands 页命令卡片容器。
// 这一层把拖拽事件统一挂到列表容器，避免每张卡片都重复绑监听。
function initCommandDragEvents() {
    const container = document.getElementById('commands-list');
    if (!container || container._dragEventsInitialized) return;
    container._dragEventsInitialized = true;

    // mousedown: 只在 header 区域启用拖拽
    container.addEventListener('mousedown', (e) => {
        const header = e.target.closest('.command-header');
        if (!header || e.target.closest('button')) return;
        const card = header.closest('.command-card');
        if (card) {
            card.setAttribute('draggable', 'true');
        }
    });

    // mouseup: 禁用拖拽
    container.addEventListener('mouseup', (e) => {
        const card = e.target.closest('.command-card');
        if (card) {
            card.setAttribute('draggable', 'false');
        }
    });

    // 开始拖拽某张命令卡片
    container.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.command-card');
        if (!card) return;
        draggedCommandId = card.dataset.cmdId;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    });

    // 拖拽经过其它命令卡片时高亮目标位置
    container.addEventListener('dragover', (e) => {
        if (!draggedCommandId) return;
        e.preventDefault();
        const target = e.target.closest('.command-card');
        if (target && target.dataset.cmdId !== draggedCommandId) {
            // 清除其他卡片的 drag-over
            container.querySelectorAll('.command-card.drag-over').forEach(el => {
                if (el !== target) el.classList.remove('drag-over');
            });
            target.classList.add('drag-over');
        }
    });

    // 放下卡片后执行真正重排
    container.addEventListener('drop', async (e) => {
        if (!draggedCommandId) return;
        e.preventDefault();
        const target = e.target.closest('.command-card');
        if (target && target.dataset.cmdId !== draggedCommandId) {
            await reorderCommands(draggedCommandId, target.dataset.cmdId);
        }
        container.querySelectorAll('.command-card').forEach(el => el.classList.remove('drag-over'));
    });

    // 拖拽结束后统一清理样式
    container.addEventListener('dragend', () => {
        draggedCommandId = null;
        container.querySelectorAll('.command-card').forEach(el => {
            el.classList.remove('dragging', 'drag-over');
            el.setAttribute('draggable', 'false');
        });
    });
}

// 命令拖拽排序真正落盘的入口。
// 页面触发：commands 页卡片拖拽完成后。
async function reorderCommands(draggedId, targetId) {
    const currentCmds = allCommands.filter(c => c.tab_id === currentTabId);
    const draggedIdx = currentCmds.findIndex(c => c.id === draggedId);
    const targetIdx = currentCmds.findIndex(c => c.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;

    const [dragged] = currentCmds.splice(draggedIdx, 1);
    currentCmds.splice(targetIdx, 0, dragged);

    currentCmds.forEach((cmd, idx) => {
        cmd.order = idx;
    });

    allCommands.sort((a, b) => {
        if (a.tab_id === b.tab_id) {
            return (a.order || 0) - (b.order || 0);
        }
        return a.tab_id < b.tab_id ? -1 : 1;
    });

    renderCommands(currentCmds);
    await pywebview.api.reorder_commands(currentTabId, currentCmds.map(c => c.id));
}

// 命令搜索过滤：对应命令页顶部搜索框。
// 搜索范围不是整站，而是“先按当前页签收窄，再按标题/描述/命令正文关键字过滤”。
// 所以用户觉得“明明有这条命令却搜不到”时，要同时确认当前页签和搜索词两个条件。
function filterCommands() {
    const keyword = document.getElementById('command-search').value.toLowerCase();
    let commands = currentTabId
        ? allCommands.filter(c => c.tab_id === currentTabId)
        : allCommands;

    if (keyword) {
        commands = commands.filter(c =>
            c.title.toLowerCase().includes(keyword) ||
            c.description.toLowerCase().includes(keyword) ||
            c.commands.some(cmd => cmd.toLowerCase().includes(keyword))
        );
    }
    renderCommands(commands);
}

// 打开命令编辑弹窗：既服务“新增命令”，也服务“编辑已有命令”。
// 页面位置：commands 页右上角“添加命令”按钮，以及每张命令卡片上的编辑按钮，最后都会走到这里。
// 负责内容：弹窗标题、隐藏 id、标题/描述/命令内容、所属页签下拉框，都会在这里一次性回填。
function showCommandModal(cmd = null) {
    document.getElementById('command-modal-title').textContent = cmd ? '编辑命令' : '添加命令';
    document.getElementById('command-id').value = cmd?.id || '';
    document.getElementById('command-tab-id').value = cmd?.tab_id || currentTabId || '0';
    document.getElementById('command-title').value = cmd?.title || '';
    document.getElementById('command-description').value = cmd?.description || '';
    document.getElementById('command-content').value = cmd?.commands?.join('\n') || '';

    // 填充页签选择
    const select = document.getElementById('command-tab-select');
    select.innerHTML = allTabs.map(tab =>
        `<option value="${tab.id}" ${tab.id === (cmd?.tab_id || currentTabId || '0') ? 'selected' : ''}>${escapeHtml(tab.name)}</option>`
    ).join('');

    openModal('command-modal');
}

// 编辑命令快捷入口：命令卡片点“编辑”后，会先从 allCommands 中找到原记录，再复用 showCommandModal() 打开表单。
// 这个函数本身不负责保存，只负责“找到数据并把弹窗切到编辑态”。
// 页面触发：命令卡片上的“编辑”按钮。
// 这是一个轻量跳转函数：先从 allCommands 中找到当前卡片对应的数据，
// 然后把真正的弹窗回填工作交给 showCommandModal()，避免编辑逻辑分散在多个地方。
async function editCommand(id) {
    const cmd = allCommands.find(c => c.id === id);
    if (cmd) showCommandModal(cmd);
}

// 命令保存主入口：
// 页面触发：commands 页弹窗里的“保存”按钮。
// 这是“表单字段 -> add/update_command -> 刷新列表”的完整入口。
async function saveCommand() {
    const id = document.getElementById('command-id').value;
    const title = document.getElementById('command-title').value.trim();
    const description = document.getElementById('command-description').value.trim();
    const tabId = document.getElementById('command-tab-select').value;
    const commands = document.getElementById('command-content').value.split('\n').filter(l => l.trim());

    if (!title || !commands.length) {
        alert('请填写标题和命令');
        return;
    }

    if (id) {
        await pywebview.api.update_command(id, title, description, commands, tabId, []);
    } else {
        await pywebview.api.add_command(title, description, commands, tabId, []);
    }
    closeModal('command-modal');
    await loadCommands();
}

// 删除命令入口：对应命令卡片右上角“删除”按钮。
// 真正删除动作由 pywebview.api.delete_command() 落到后端执行，前端这里只负责二次确认和删除后的列表刷新。
// 如果用户说“点删除后 UI 没更新”，先看这里最后的 loadCommands() 是否重新把最新结果拉回来了。
async function deleteCommand(id) {
    if (confirm('确定删除此命令？')) {
        await pywebview.api.delete_command(id);
        await loadCommands();
    }
}

// 移动命令到页签。
// 页面触发：命令卡片上的“移动”按钮。
// 这里只负责弹出目标页签选择弹窗，不直接修改数据。
function showMoveCommandModal(cmdId) {
    const cmd = allCommands.find(c => c.id === cmdId);
    if (!cmd) return;

    document.getElementById('move-command-id').value = cmdId;
    const container = document.getElementById('move-tab-options');

    container.innerHTML = allTabs.map(tab => `
        <div class="move-tab-option ${tab.id === cmd.tab_id ? 'current' : ''}" onclick="moveCommandToTab('${cmdId}', '${tab.id}')">
            <span class="move-tab-icon">📁</span>
            <span class="move-tab-name">${escapeHtml(tab.name)}</span>
            ${tab.id === cmd.tab_id ? '<span class="move-tab-current">当前</span>' : ''}
        </div>
    `).join('');

    openModal('move-command-modal');
}

// 真正执行“命令移到其它页签”的入口。
// 页面触发：移动弹窗里的目标页签项点击。
async function moveCommandToTab(cmdId, tabId) {
    await pywebview.api.move_command_to_tab(cmdId, tabId);
    closeModal('move-command-modal');
    await loadCommands();
}

// ==================== 批量导入：命令/凭证共用的文本导入入口 ====================
// 当用户把整理好的纯文本批量转成记录时，会先经过这里，再交给后端解析入库。
// 页面触发：凭证页 / 命令页上的“批量导入”按钮。
function showImportModal(type) {
    document.getElementById('import-type').value = type;
    document.getElementById('import-content').value = '';

    if (type === 'credentials') {
        document.getElementById('import-modal-title').textContent = '批量导入凭证';
        document.getElementById('import-hint').innerHTML = `
            支持格式：<br>
            1. <code>服务名 URL || 账号 || 密码</code><br>
            2. 多行格式（空行分隔）：<br>
            <code>服务名<br>账号：xxx<br>密码：xxx</code>
        `;
    } else {
        document.getElementById('import-modal-title').textContent = '批量导入命令块';
        document.getElementById('import-hint').innerHTML = `
            格式：以 <code># 注释</code> 或 <code>标题：</code> 开头作为块标题，<br>
            后续行作为命令，空行分隔不同命令块<br>
            <small>导入的命令将添加到当前页签</small>
        `;
    }
    openModal('import-modal');
}

// 批量导入真正执行入口：对应导入弹窗底部“开始导入 / 确认导入”按钮。
// 调用链：弹窗文本框 -> import_credentials()/import_commands() -> 后端解析入库 -> 刷新对应列表区块。
// 外行排查时可以把它理解为“批量文本真正落库的提交按钮逻辑”，前面的 showImportModal() 只负责打开弹窗，不负责保存。
async function doImport() {
    const type = document.getElementById('import-type').value;
    const content = document.getElementById('import-content').value.trim();

    if (!content) {
        alert('请粘贴要导入的内容');
        return;
    }

    let result;
    if (type === 'credentials') {
        result = await pywebview.api.import_credentials(content);
        loadCredentials();
    } else {
        result = await pywebview.api.import_commands(content);
        await loadCommands();
    }

    closeModal('import-modal');
    alert(`成功导入 ${result.imported} 条记录`);
}
