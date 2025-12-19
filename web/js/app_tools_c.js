// ==================== 数据备份与恢复 ====================
async function initBackupPage() {
    await updateBackupStats();
}

async function updateBackupStats() {
    try {
        const stats = await pywebview.api.get_data_stats();
        document.getElementById('stat-tabs').textContent = stats.tabs ?? '-';
        document.getElementById('stat-commands').textContent = stats.commands ?? '-';
        document.getElementById('stat-credentials').textContent = stats.credentials ?? '-';
        document.getElementById('stat-nodes').textContent = stats.nodes ?? '-';
    } catch (e) {
        console.error('Failed to load backup stats:', e);
    }
}

async function exportBackup() {
    const resultEl = document.getElementById('backup-result');
    resultEl.style.display = 'none';
    resultEl.className = 'backup-result';

    try {
        const data = await pywebview.api.export_data();
        const jsonStr = JSON.stringify(data, null, 2);

        const now = new Date();
        const ts = now.toISOString().slice(0, 19).replace(/[:\-T]/g, '').replace(/(\d{8})(\d{6})/, '$1_$2');
        const filename = `狗狗百宝箱_备份_${ts}.json`;

        // 优先使用后端保存对话框（避免 pywebview 环境下前端下载导致崩溃）
        if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file_dialog) {
            const result = await window.pywebview.api.save_file_dialog({
                content: jsonStr,
                default_filename: filename
            });
            if (result.success) {
                resultEl.className = 'backup-result backup-success';
                resultEl.innerHTML = `
                    <div class="backup-result-title">✅ 导出成功</div>
                    <div class="backup-result-details">
                        备份文件已保存到：<strong>${escapeHtml(result.path)}</strong>
                        <ul>
                            <li>页签：${data.data.tabs?.length ?? 0} 条</li>
                            <li>命令：${data.data.commands?.length ?? 0} 条</li>
                            <li>凭证：${data.data.credentials?.length ?? 0} 条</li>
                            <li>节点：${data.data.nodes?.length ?? 0} 条</li>
                        </ul>
                    </div>
                `;
                resultEl.style.display = '';
            } else if (result.error && result.error !== '用户取消了保存') {
                throw new Error(result.error);
            }
            return;
        }

        // 回退到前端下载方式
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        resultEl.className = 'backup-result backup-success';
        resultEl.innerHTML = `
            <div class="backup-result-title">✅ 导出成功</div>
            <div class="backup-result-details">
                备份文件已下载：<strong>${filename}</strong>
                <ul>
                    <li>页签：${data.data.tabs?.length ?? 0} 条</li>
                    <li>命令：${data.data.commands?.length ?? 0} 条</li>
                    <li>凭证：${data.data.credentials?.length ?? 0} 条</li>
                    <li>节点：${data.data.nodes?.length ?? 0} 条</li>
                </ul>
            </div>
        `;
        resultEl.style.display = '';
    } catch (e) {
        resultEl.className = 'backup-result backup-error';
        resultEl.innerHTML = `
            <div class="backup-result-title">❌ 导出失败</div>
            <div class="backup-result-details">${escapeHtml(e.message || String(e))}</div>
        `;
        resultEl.style.display = '';
    }
}

async function importBackup(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const resultEl = document.getElementById('backup-result');
    resultEl.style.display = 'none';
    resultEl.className = 'backup-result';

    try {
        const text = await file.text();
        const jsonData = JSON.parse(text);

        if (!jsonData.data) {
            throw new Error('无效的备份文件格式：缺少 data 字段');
        }

        if (!confirm('导入将覆盖现有数据，是否继续？')) {
            event.target.value = '';
            return;
        }

        const result = await pywebview.api.import_data(jsonData);

        if (result.success) {
            resultEl.className = 'backup-result backup-success';
            resultEl.innerHTML = `
                <div class="backup-result-title">✅ 导入成功</div>
                <div class="backup-result-details">
                    已导入数据：
                    <ul>
                        <li>页签：${result.imported.tabs} 条</li>
                        <li>命令：${result.imported.commands} 条</li>
                        <li>凭证：${result.imported.credentials} 条</li>
                        <li>节点：${result.imported.nodes} 条</li>
                    </ul>
                    页面将自动刷新以加载新数据...
                </div>
            `;
            resultEl.style.display = '';
            await updateBackupStats();
            setTimeout(() => location.reload(), 2000);
        } else {
            throw new Error(result.error || '导入失败');
        }
    } catch (e) {
        resultEl.className = 'backup-result backup-error';
        resultEl.innerHTML = `
            <div class="backup-result-title">❌ 导入失败</div>
            <div class="backup-result-details">${escapeHtml(e.message || String(e))}</div>
        `;
        resultEl.style.display = '';
    }

    event.target.value = '';
}

// ==================== M22 Markdown 预览工具 ====================

function setMarkdownViewMode(mode) {
    if (!['split', 'edit', 'preview'].includes(mode)) return;
    markdownViewMode = mode;

    const editPanel = document.getElementById('markdown-edit-panel');
    const previewPanel = document.getElementById('markdown-preview-panel');
    const layout = document.getElementById('markdown-layout');

    // 更新按钮状态
    document.querySelectorAll('.view-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    if (!editPanel || !previewPanel || !layout) return;

    // 重置样式
    editPanel.style.display = '';
    previewPanel.style.display = '';
    editPanel.style.flex = '';
    previewPanel.style.flex = '';

    switch (mode) {
        case 'edit':
            previewPanel.style.display = 'none';
            editPanel.style.flex = '1';
            break;
        case 'preview':
            editPanel.style.display = 'none';
            previewPanel.style.flex = '1';
            break;
        case 'split':
        default:
            // 默认分屏模式，两个面板各占一半
            break;
    }
}

function clearMarkdownTool() {
    document.getElementById('markdown-input').value = '';
    document.getElementById('markdown-preview').innerHTML = '';
}

// 防抖定时器
let _markdownDebounceTimer = null;

function updateMarkdownTool() {
    // 防抖：避免频繁输入导致卡顿
    if (_markdownDebounceTimer) {
        clearTimeout(_markdownDebounceTimer);
    }
    _markdownDebounceTimer = setTimeout(_doUpdateMarkdown, 150);
}

function _doUpdateMarkdown() {
    const inputEl = document.getElementById('markdown-input');
    const previewEl = document.getElementById('markdown-preview');
    if (!inputEl || !previewEl) return;

    const input = inputEl.value;

    if (!input.trim()) {
        previewEl.innerHTML = '<p class="placeholder-text">预览将在此处显示...</p>';
        return;
    }

    if (!window.DogToolboxM22Utils) {
        previewEl.innerHTML = '<div class="error-message">工具模块未加载</div>';
        return;
    }

    try {
        const html = DogToolboxM22Utils.parseMarkdown(input);
        previewEl.innerHTML = html;
    } catch (e) {
        previewEl.innerHTML = `<div class="error-message">解析错误：${escapeHtml(e.message || String(e))}</div>`;
    }
}

function copyMarkdownHtml(btn) {
    const previewEl = document.getElementById('markdown-preview');
    const html = previewEl.innerHTML;

    if (!html || html.includes('placeholder-text')) {
        return;
    }

    copyToolText(btn, html, { showTextFeedback: true });
}

async function exportMarkdownAsHtml() {
    const inputEl = document.getElementById('markdown-input');
    const input = inputEl?.value;

    if (!input || !input.trim()) {
        return;
    }

    if (!window.DogToolboxM22Utils) {
        showToast('工具模块未加载', 'error');
        return;
    }

    try {
        // 生成完整 HTML
        const htmlContent = window.DogToolboxM22Utils.exportAsHtml(input, {
            title: 'Markdown 文档'
        });

        // 生成文件名（带时间戳）
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
        const filename = `markdown-export-${timestamp}.html`;

        // 优先使用后端保存对话框
        if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file_dialog) {
            const result = await window.pywebview.api.save_file_dialog({
                content: htmlContent,
                default_filename: filename
            });
            if (result.success) {
                showToast('已保存到: ' + result.path);
            } else if (result.error && result.error !== '用户取消了保存') {
                showToast('保存失败: ' + result.error, 'error');
            }
            return;
        }

        // 回退到前端下载方式
        const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (e) {
        showToast('导出失败：' + (e.message || String(e)), 'error');
    }
}

// ==================== 输入验证辅助函数 ====================

/**
 * 验证输入字段，为空则添加错误样式
 * @param {string} elementId - 元素ID
 * @param {string} value - 字段值
 * @returns {boolean} 是否通过验证
 */
function validateInput(elementId, value) {
    const el = document.getElementById(elementId);
    if (!el) return true; // 元素不存在，跳过验证

    const isValid = value && value.trim() !== '';

    if (isValid) {
        el.classList.remove('input-error');
    } else {
        el.classList.add('input-error');
    }

    return isValid;
}

/**
 * 清除所有验证错误样式
 * @param {string[]} elementIds - 元素ID数组
 */
function clearValidationErrors(elementIds) {
    elementIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('input-error');
    });
}

// ==================== 原有 M26 Git 命令生成器 ====================

// ==================== M26 Git 命令生成器 ====================

// 场景切换
function switchGitScene(scene, evt) {
    currentGitScene = scene;

    // 更新 tab 激活状态
    document.querySelectorAll('.tool-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    if (evt?.target) {
        evt.target.classList.add('active');
    }

    // 更新场景显示
    document.querySelectorAll('.git-scene').forEach(s => {
        s.classList.remove('active');
    });
    document.getElementById(`git-scene-${scene}`)?.classList.add('active');

    // 重置面板过滤状态
    resetPanelFiltering('.git-tool');

    // 如果是模板场景，加载模板
    if (scene === 'templates') {
        loadGitTemplates();
    } else {
        updateGitCommand();
    }
}

// 加载常用命令模板
function loadGitTemplates() {
    if (!window.DogToolboxM26Utils) return;

    const templates = DogToolboxM26Utils.getCommonTemplates();
    const container = document.getElementById('git-templates-list');
    
    // Add grid class if not present
    container.className = 'git-templates-grid';

    // Helper to pick icon
    const getIcon = (name) => {
        if (name.includes('初始化')) return '🏁';
        if (name.includes('状态')) return '🔍';
        if (name.includes('添加')) return '➕';
        if (name.includes('差异')) return '⚖️';
        if (name.includes('推送')) return '⬆️';
        if (name.includes('拉取')) return '⬇️';
        if (name.includes('远程')) return '🔗';
        if (name.includes('标签')) return '🏷️';
        if (name.includes('检出')) return '↩️';
        if (name.includes('日志') || name.includes('详情')) return '📜';
        if (name.includes('清理')) return '🧹';
        return '🔹';
    };

    container.innerHTML = templates.map(t => `
        <button type="button" class="git-template-card" onclick="applyGitTemplate('${escapeAttr(t.command)}')">
            <div class="git-template-header">
                <div class="git-template-icon" aria-hidden="true">${getIcon(t.name)}</div>
                <div class="git-template-info">
                    <div class="git-template-name">${escapeHtml(t.name)}</div>
                    <div class="git-template-desc">${escapeHtml(t.description)}</div>
                </div>
            </div>
            <div class="git-template-footer">
                <code class="git-template-code">${escapeHtml(t.command)}</code>
                <span class="git-template-hint">点击应用</span>
            </div>
        </button>
    `).join('');
}

// 应用模板到输出区
function applyGitTemplate(command) {
    document.getElementById('git-command-output').value = command;
    document.getElementById('git-command-desc').textContent = '已选择模板命令';
}

// 更新分支表单显示
function updateGitBranchForm() {
    const action = document.getElementById('git-branch-action')?.value;
    const nameGroup = document.getElementById('git-branch-name-group');
    const newnameGroup = document.getElementById('git-branch-newname-group');
    const forceGroup = document.getElementById('git-branch-force-group');
    const remoteGroup = document.getElementById('git-branch-remote-group');

    if (!action) return;

    // 隐藏所有可选字段
    if (nameGroup) nameGroup.style.display = 'none';
    if (newnameGroup) newnameGroup.style.display = 'none';
    if (forceGroup) forceGroup.style.display = 'none';
    if (remoteGroup) remoteGroup.style.display = 'none';

    // 根据操作类型显示相应字段
    switch (action) {
        case 'create':
        case 'switch':
            if (nameGroup) nameGroup.style.display = '';
            break;
        case 'delete':
            if (nameGroup) nameGroup.style.display = '';
            if (forceGroup) forceGroup.style.display = '';
            break;
        case 'rename':
            if (nameGroup) nameGroup.style.display = '';
            if (newnameGroup) newnameGroup.style.display = '';
            break;
        case 'list':
            if (remoteGroup) remoteGroup.style.display = '';
            break;
    }
}

// 更新暂存表单显示
function updateGitStashForm() {
    const action = document.getElementById('git-stash-action')?.value;
    const messageGroup = document.getElementById('git-stash-message-group');
    const indexGroup = document.getElementById('git-stash-index-group');

    if (!action) return;

    // 隐藏所有字段
    if (messageGroup) messageGroup.style.display = 'none';
    if (indexGroup) indexGroup.style.display = 'none';

    // 根据操作类型显示相应字段
    switch (action) {
        case 'save':
            if (messageGroup) messageGroup.style.display = '';
            break;
        case 'pop':
        case 'apply':
        case 'drop':
            if (indexGroup) indexGroup.style.display = '';
            break;
        // list 和 clear 不需要额外字段
    }
}

// 更新命令预览
function updateGitCommand() {
    const outputEl = document.getElementById('git-command-output');
    const descEl = document.getElementById('git-command-desc');

    if (!window.DogToolboxM26Utils) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = '工具模块未加载';
        return;
    }

    try {
        let result = null;

        switch (currentGitScene) {
            case 'commit':
                result = generateCommitCmd();
                break;
            case 'branch':
                result = generateBranchCmd();
                break;
            case 'log':
                result = generateLogCmd();
                break;
            case 'reset':
                result = generateResetCmd();
                break;
            case 'clone':
                result = generateCloneCmd();
                break;
            case 'merge':
                result = generateMergeCmd();
                break;
            case 'stash':
                result = generateStashCmd();
                break;
        }

        if (result) {
            if (outputEl) outputEl.value = result.command || '';
            if (descEl) descEl.textContent = result.description || '';
        } else {
            if (outputEl) outputEl.value = '';
            if (descEl) descEl.textContent = '请填写必要参数';
        }
    } catch (e) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = `错误：${e.message || String(e)}`;
    }
}

// 生成 Commit 命令
function generateCommitCmd() {
    const message = document.getElementById('git-commit-message')?.value.trim();

    // 验证必填字段
    if (!validateInput('git-commit-message', message)) {
        return null;
    }

    const options = {
        all: document.getElementById('git-commit-all')?.checked || false,
        amend: document.getElementById('git-commit-amend')?.checked || false,
        noVerify: document.getElementById('git-commit-noverify')?.checked || false
    };

    return DogToolboxM26Utils.generateCommitCommand(message, options);
}

// 生成 Branch 命令
function generateBranchCmd() {
    const action = document.getElementById('git-branch-action')?.value;
    const name = document.getElementById('git-branch-name')?.value.trim();

    if (action === 'list') {
        // list 操作不需要 name，清除错误样式
        clearValidationErrors(['git-branch-name']);
        const options = {
            remote: document.getElementById('git-branch-remote')?.checked || false
        };
        return DogToolboxM26Utils.generateBranchCommand(action, '', options);
    }

    // 其他操作需要验证 name
    if (!validateInput('git-branch-name', name)) {
        return null;
    }

    const options = {
        newName: document.getElementById('git-branch-newname')?.value.trim(),
        force: document.getElementById('git-branch-force')?.checked || false
    };

    return DogToolboxM26Utils.generateBranchCommand(action, name, options);
}

// 生成 Log 命令
function generateLogCmd() {
    const options = {
        oneline: document.getElementById('git-log-oneline')?.checked || false,
        graph: document.getElementById('git-log-graph')?.checked || false,
        maxCount: parseInt(document.getElementById('git-log-count')?.value) || null,
        author: document.getElementById('git-log-author')?.value.trim(),
        grep: document.getElementById('git-log-grep')?.value.trim()
    };

    return DogToolboxM26Utils.generateLogCommand(options);
}

// 生成 Reset 命令
function generateResetCmd() {
    const mode = document.getElementById('git-reset-mode')?.value || 'mixed';
    const ref = document.getElementById('git-reset-ref')?.value.trim();

    return DogToolboxM26Utils.generateResetCommand(mode, ref);
}

// 生成 Clone 命令
function generateCloneCmd() {
    const url = document.getElementById('git-clone-url')?.value.trim();

    // 验证必填字段
    if (!validateInput('git-clone-url', url)) {
        return null;
    }

    const options = {
        branch: document.getElementById('git-clone-branch')?.value.trim(),
        targetDir: document.getElementById('git-clone-dir')?.value.trim(),
        depth: parseInt(document.getElementById('git-clone-depth')?.value) || null,
        recursive: document.getElementById('git-clone-recursive')?.checked || false
    };

    return DogToolboxM26Utils.generateCloneCommand(url, options);
}

// 生成 Merge 命令
function generateMergeCmd() {
    const branch = document.getElementById('git-merge-branch')?.value.trim();

    // 验证必填字段
    if (!validateInput('git-merge-branch', branch)) {
        return null;
    }

    const options = {
        noFf: document.getElementById('git-merge-noff')?.checked || false,
        squash: document.getElementById('git-merge-squash')?.checked || false,
        message: document.getElementById('git-merge-message')?.value.trim()
    };

    return DogToolboxM26Utils.generateMergeCommand(branch, options);
}

// 生成 Stash 命令
function generateStashCmd() {
    const action = document.getElementById('git-stash-action')?.value;

    const options = {
        message: document.getElementById('git-stash-message')?.value.trim(),
        index: parseInt(document.getElementById('git-stash-index')?.value)
    };

    if (isNaN(options.index)) {
        options.index = undefined;
    }

    return DogToolboxM26Utils.generateStashCommand(action, options);
}

function copyGitCommand(btn) {
    const output = document.getElementById('git-command-output').value;
    if (!output) return;
    copyToolText(btn, output, { showTextFeedback: true });
}

// ==================== M27 Docker 命令生成器 ====================

function switchDockerScene(scene, evt) {
    currentDockerScene = scene;

    // 更新标签激活状态
    document.querySelectorAll('.tool-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    if (evt?.target) {
        evt.target.classList.add('active');
    }

    // 更新场景显示
    document.querySelectorAll('.docker-scene').forEach(s => {
        s.classList.remove('active');
    });
    document.getElementById(`docker-scene-${scene}`)?.classList.add('active');

    // 重置面板过滤状态
    resetPanelFiltering('.docker-tool');

    // 更新命令
    updateDockerCommand();
}

function updateDockerComposeForm() {
    const action = document.getElementById('docker-compose-action')?.value;
    const serviceGroup = document.getElementById('docker-compose-service-group');
    const detachGroup = document.getElementById('docker-compose-detach-group');
    const volumesGroup = document.getElementById('docker-compose-volumes-group');

    if (!action) return;

    // 默认全部隐藏
    if (serviceGroup) serviceGroup.style.display = 'none';
    if (detachGroup) detachGroup.style.display = 'none';
    if (volumesGroup) volumesGroup.style.display = 'none';

    // 根据操作类型显示相应字段
    switch (action) {
        case 'up':
            if (detachGroup) detachGroup.style.display = '';
            if (serviceGroup) serviceGroup.style.display = '';
            break;
        case 'down':
            if (volumesGroup) volumesGroup.style.display = '';
            break;
        case 'start':
        case 'stop':
        case 'restart':
        case 'build':
        case 'pull':
            if (serviceGroup) serviceGroup.style.display = '';
            break;
        case 'logs':
        case 'exec':
            if (serviceGroup) serviceGroup.style.display = '';
            break;
    }
}


function updateDockerCommand() {
    const outputEl = document.getElementById('docker-command-output');
    const descEl = document.getElementById('docker-command-desc');

    if (!window.DogToolboxM27Utils) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = '工具模块未加载';
        return;
    }

    try {
        let result = null;

        switch (currentDockerScene) {
            case 'run': result = generateRunCmd(); break;
            case 'build': result = generateBuildCmd(); break;
            case 'compose': result = generateComposeCmd(); break;
            case 'exec': result = generateExecCmd(); break;
            case 'logs': result = generateLogsCmd(); break;
            case 'ps': result = generatePsCmd(); break;
            case 'images': result = generateImagesCmd(); break;
            case 'container': result = generateContainerCmd(); break;
        }

        if (result) {
            if (outputEl) outputEl.value = result.command || '';
            if (descEl) descEl.textContent = result.description || '';
        } else {
            if (outputEl) outputEl.value = '';
            if (descEl) descEl.textContent = '请填写必要参数';
        }
    } catch (e) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = `错误：${e.message || String(e)}`;
    }
}

function generateRunCmd() {
    const image = document.getElementById('docker-run-image')?.value.trim();

    // 验证必填字段
    if (!validateInput('docker-run-image', image)) {
        return null;
    }

    const options = {
        name: document.getElementById('docker-run-name')?.value.trim(),
        detach: document.getElementById('docker-run-detach')?.checked || false,
        interactive: document.getElementById('docker-run-interactive')?.checked || false,
        rm: document.getElementById('docker-run-rm')?.checked || false,
        network: document.getElementById('docker-run-network')?.value.trim(),
        restart: document.getElementById('docker-run-restart')?.value.trim(),
        memory: document.getElementById('docker-run-memory')?.value.trim(),
        cpus: document.getElementById('docker-run-cpus')?.value.trim(),
        command: document.getElementById('docker-run-command')?.value.trim()
    };

    // 解析端口映射
    const portsStr = document.getElementById('docker-run-ports')?.value.trim();
    if (portsStr) {
        options.ports = portsStr.split(',').map(p => p.trim()).filter(p => p);
    }

    // 解析卷挂载
    const volumesStr = document.getElementById('docker-run-volumes')?.value.trim();
    if (volumesStr) {
        options.volumes = volumesStr.split(',').map(v => v.trim()).filter(v => v);
    }

    // 解析环境变量
    const envStr = document.getElementById('docker-run-env')?.value.trim();
    if (envStr) {
        options.env = envStr.split(',').map(e => e.trim()).filter(e => e);
    }

    return DogToolboxM27Utils.generateRunCommand(image, options);
}

function generateBuildCmd() {
    const path = document.getElementById('docker-build-path')?.value.trim();
    const tag = document.getElementById('docker-build-tag')?.value.trim();

    // 验证必填字段
    const pathValid = validateInput('docker-build-path', path);
    const tagValid = validateInput('docker-build-tag', tag);

    if (!pathValid || !tagValid) {
        return null;
    }

    const options = {
        tag: tag,
        file: document.getElementById('docker-build-file')?.value.trim(),
        target: document.getElementById('docker-build-target')?.value.trim(),
        noCache: document.getElementById('docker-build-nocache')?.checked || false,
        pull: document.getElementById('docker-build-pull')?.checked || false
    };

    // 解析构建参数
    const argStr = document.getElementById('docker-build-arg')?.value.trim();
    if (argStr) {
        options.buildArg = argStr.split(',').map(a => a.trim()).filter(a => a);
    }

    return DogToolboxM27Utils.generateBuildCommand(path, options);
}

function generateComposeCmd() {
    const action = document.getElementById('docker-compose-action')?.value;
    if (!action) return null;

    const options = {
        file: document.getElementById('docker-compose-file')?.value.trim(),
        projectName: document.getElementById('docker-compose-project')?.value.trim(),
        service: document.getElementById('docker-compose-service')?.value.trim(),
        detach: document.getElementById('docker-compose-detach')?.checked || false,
        volumes: document.getElementById('docker-compose-volumes')?.checked || false
    };

    return DogToolboxM27Utils.generateComposeCommand(action, options);
}

function generateExecCmd() {
    const container = document.getElementById('docker-exec-container')?.value.trim();
    const command = document.getElementById('docker-exec-command')?.value.trim();

    // 验证必填字段
    const containerValid = validateInput('docker-exec-container', container);
    const commandValid = validateInput('docker-exec-command', command);

    if (!containerValid || !commandValid) {
        return null;
    }

    const options = {
        interactive: document.getElementById('docker-exec-interactive')?.checked || false,
        workdir: document.getElementById('docker-exec-workdir')?.value.trim(),
        user: document.getElementById('docker-exec-user')?.value.trim()
    };

    return DogToolboxM27Utils.generateExecCommand(container, command, options);
}

function generateLogsCmd() {
    const container = document.getElementById('docker-logs-container')?.value.trim();

    // 验证必填字段
    if (!validateInput('docker-logs-container', container)) {
        return null;
    }

    const options = {
        follow: document.getElementById('docker-logs-follow')?.checked || false,
        timestamps: document.getElementById('docker-logs-timestamps')?.checked || false,
        tail: document.getElementById('docker-logs-tail')?.value.trim(),
        since: document.getElementById('docker-logs-since')?.value.trim()
    };

    return DogToolboxM27Utils.generateLogsCommand(container, options);
}

function generatePsCmd() {
    const options = {
        all: document.getElementById('docker-ps-all')?.checked || false,
        quiet: document.getElementById('docker-ps-quiet')?.checked || false,
        filter: document.getElementById('docker-ps-filter')?.value.trim()
    };

    return DogToolboxM27Utils.generatePsCommand(options);
}

function generateImagesCmd() {
    const options = {
        all: document.getElementById('docker-images-all')?.checked || false,
        quiet: document.getElementById('docker-images-quiet')?.checked || false,
        filter: document.getElementById('docker-images-filter')?.value.trim()
    };

    return DogToolboxM27Utils.generateImagesCommand(options);
}

function generateContainerCmd() {
    const action = document.getElementById('docker-container-action')?.value;
    const namesStr = document.getElementById('docker-container-names')?.value.trim();

    if (!action || !namesStr) return null;

    const containers = namesStr.split(/\s+/).filter(n => n);
    if (containers.length === 0) return null;

    const options = {
        force: document.getElementById('docker-container-force')?.checked || false
    };

    return DogToolboxM27Utils.generateContainerCommand(action, containers, options);
}


function copyDockerCommand(btn) {
    const output = document.getElementById('docker-command-output').value;
    if (!output) return;
    copyToolText(btn, output, { showTextFeedback: true });
}

// ==================== Docker Service 命令生成器 ====================

let currentDockerServiceScene = 'create';

function switchDockerServiceScene(scene, evt) {
    currentDockerServiceScene = scene;

    // 更新标签激活状态
    const container = document.querySelector('.docker-service-tool');
    if (container) {
        container.querySelectorAll('.tool-tab').forEach(tab => {
            tab.classList.remove('active');
            tab.setAttribute('aria-selected', 'false');
        });
    }
    if (evt?.target) {
        const tab = evt.target.closest('.tool-tab');
        if (tab) {
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
        }
    }

    // 更新场景显示
    document.querySelectorAll('.docker-service-scene').forEach(s => {
        s.classList.remove('active');
    });
    document.getElementById(`docker-service-scene-${scene}`)?.classList.add('active');

    const toolEl = document.querySelector('.docker-service-tool');
    if (toolEl && !toolEl.dataset.panelFilterInit) {
        initPanelFiltering('.docker-service-tool');
        toolEl.dataset.panelFilterInit = 'true';
    }

    resetPanelFiltering('.docker-service-tool');
    updateDockerServiceCommand();
}

function updateDockerServiceCommand() {
    const outputEl = document.getElementById('docker-service-command-output');
    const descEl = document.getElementById('docker-service-command-desc');

    if (!window.DogToolboxM27Utils) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = '工具模块未加载';
        return;
    }

    try {
        let result = null;

        switch (currentDockerServiceScene) {
            case 'create': result = generateServiceCreateCmd(); break;
            case 'update': result = generateServiceUpdateCmd(); break;
            case 'scale': result = generateServiceScaleCmd(); break;
            case 'logs': result = generateServiceLogsCmd(); break;
            case 'ps': result = generateServicePsCmd(); break;
            case 'ls': result = generateServiceLsCmd(); break;
            case 'rm': result = generateServiceRmCmd(); break;
        }

        if (result) {
            if (outputEl) outputEl.value = result.command || '';
            if (descEl) descEl.textContent = result.description || '';
        } else {
            if (outputEl) outputEl.value = '';
            if (descEl) descEl.textContent = '请填写必要参数';
        }
    } catch (e) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = `错误：${e.message || String(e)}`;
    }
}

function generateServiceCreateCmd() {
    const image = document.getElementById('docker-service-create-image')?.value.trim();
    const name = document.getElementById('docker-service-create-name')?.value.trim();

    const imageValid = validateInput('docker-service-create-image', image);
    const nameValid = validateInput('docker-service-create-name', name);

    if (!imageValid || !nameValid) {
        return null;
    }

    const options = {
        image,
        name,
        replicas: document.getElementById('docker-service-create-replicas')?.value.trim(),
        endpointMode: document.getElementById('docker-service-create-endpoint-mode')?.value.trim(),
        cpuLimit: document.getElementById('docker-service-create-cpu-limit')?.value.trim(),
        cpuReserve: document.getElementById('docker-service-create-cpu-reserve')?.value.trim(),
        memoryLimit: document.getElementById('docker-service-create-memory-limit')?.value.trim(),
        memoryReserve: document.getElementById('docker-service-create-memory-reserve')?.value.trim(),
        updateParallelism: document.getElementById('docker-service-create-update-parallelism')?.value.trim(),
        updateDelay: document.getElementById('docker-service-create-update-delay')?.value.trim(),
        updateFailureAction: document.getElementById('docker-service-create-update-failure-action')?.value.trim()
    };

    const publishStr = document.getElementById('docker-service-create-publish')?.value.trim();
    if (publishStr) {
        options.publish = publishStr.split(',').map(p => p.trim()).filter(p => p);
    }

    const networksStr = document.getElementById('docker-service-create-networks')?.value.trim();
    if (networksStr) {
        options.networks = networksStr.split(',').map(n => n.trim()).filter(n => n);
    }

    const mountsStr = document.getElementById('docker-service-create-mounts')?.value.trim();
    if (mountsStr) {
        options.mounts = mountsStr.split(',').map(m => m.trim()).filter(m => m);
    }

    return DogToolboxM27Utils.generateServiceCreateCommand(options);
}

function generateServiceUpdateCmd() {
    const serviceName = document.getElementById('docker-service-update-name')?.value.trim();

    if (!validateInput('docker-service-update-name', serviceName)) {
        return null;
    }

    const options = {
        image: document.getElementById('docker-service-update-image')?.value.trim(),
        replicas: document.getElementById('docker-service-update-replicas')?.value.trim(),
        endpointMode: document.getElementById('docker-service-update-endpoint-mode')?.value.trim(),
        cpuLimit: document.getElementById('docker-service-update-cpu-limit')?.value.trim(),
        cpuReserve: document.getElementById('docker-service-update-cpu-reserve')?.value.trim(),
        memoryLimit: document.getElementById('docker-service-update-memory-limit')?.value.trim(),
        memoryReserve: document.getElementById('docker-service-update-memory-reserve')?.value.trim(),
        updateParallelism: document.getElementById('docker-service-update-update-parallelism')?.value.trim(),
        updateDelay: document.getElementById('docker-service-update-update-delay')?.value.trim(),
        updateFailureAction: document.getElementById('docker-service-update-update-failure-action')?.value.trim()
    };

    const publishStr = document.getElementById('docker-service-update-publish')?.value.trim();
    if (publishStr) {
        options.publish = publishStr.split(',').map(p => p.trim()).filter(p => p);
    }

    const networksStr = document.getElementById('docker-service-update-networks')?.value.trim();
    if (networksStr) {
        options.networks = networksStr.split(',').map(n => n.trim()).filter(n => n);
    }

    const mountsStr = document.getElementById('docker-service-update-mounts')?.value.trim();
    if (mountsStr) {
        options.mounts = mountsStr.split(',').map(m => m.trim()).filter(m => m);
    }

    return DogToolboxM27Utils.generateServiceUpdateCommand(serviceName, options);
}

function generateServiceScaleCmd() {
    const serviceName = document.getElementById('docker-service-scale-name')?.value.trim();
    const replicas = document.getElementById('docker-service-scale-replicas')?.value.trim();

    const nameValid = validateInput('docker-service-scale-name', serviceName);
    const replicasValid = validateInput('docker-service-scale-replicas', replicas);

    if (!nameValid || !replicasValid) {
        return null;
    }

    return DogToolboxM27Utils.generateServiceScaleCommand(serviceName, replicas);
}

function generateServiceLogsCmd() {
    const serviceName = document.getElementById('docker-service-logs-name')?.value.trim();

    if (!validateInput('docker-service-logs-name', serviceName)) {
        return null;
    }

    const options = {
        follow: document.getElementById('docker-service-logs-follow')?.checked || false,
        timestamps: document.getElementById('docker-service-logs-timestamps')?.checked || false,
        tail: document.getElementById('docker-service-logs-tail')?.value.trim()
    };

    return DogToolboxM27Utils.generateServiceLogsCommand(serviceName, options);
}

function generateServicePsCmd() {
    const serviceName = document.getElementById('docker-service-ps-name')?.value.trim();

    if (!validateInput('docker-service-ps-name', serviceName)) {
        return null;
    }

    return DogToolboxM27Utils.generateServicePsCommand(serviceName);
}

function generateServiceLsCmd() {
    return DogToolboxM27Utils.generateServiceLsCommand();
}

function generateServiceRmCmd() {
    const namesStr = document.getElementById('docker-service-rm-names')?.value.trim();

    if (!validateInput('docker-service-rm-names', namesStr)) {
        return null;
    }

    const names = namesStr.split(/\s+/).filter(n => n);
    if (names.length === 0) return null;

    return DogToolboxM27Utils.generateServiceRmCommand(names);
}

function copyDockerServiceCommand(btn) {
    const output = document.getElementById('docker-service-command-output').value;
    if (!output) return;
    copyToolText(btn, output, { showTextFeedback: true });
}

// ==================== Docker Swarm 命令生成器 ====================

let currentDockerSwarmL1 = 'swarm';
let currentDockerSwarmL2 = 'init';
let currentDockerStackL2 = 'deploy';

function switchDockerSwarmL1Tab(l1, evt) {
    currentDockerSwarmL1 = l1;

    // 更新 L1 标签激活状态
    const container = document.querySelector('.docker-swarm-tool');
    if (container) {
        container.querySelectorAll('.tool-tabs-modern:not(.tool-tabs-modern-level2) > .tool-tab').forEach(tab => {
            tab.classList.remove('active');
            tab.setAttribute('aria-selected', 'false');
        });
    }
    if (evt?.target) {
        const tab = evt.target.closest('.tool-tab');
        if (tab) {
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
        }
    }

    // 更新 L1 场景显示
    document.querySelectorAll('.docker-swarm-l1-scene').forEach(s => {
        s.classList.remove('active');
    });
    document.getElementById(`docker-swarm-l1-scene-${l1}`)?.classList.add('active');

    updateDockerSwarmCommand();
}

function switchDockerSwarmL2Tab(l1, l2, evt) {
    if (l1 === 'swarm') {
        currentDockerSwarmL2 = l2;
    } else {
        currentDockerStackL2 = l2;
    }

    // 更新 L2 标签激活状态
    const l1Container = document.getElementById(`docker-swarm-l1-scene-${l1}`);
    if (l1Container) {
        l1Container.querySelectorAll('.tool-tabs-modern-level2 .tool-tab').forEach(tab => {
            tab.classList.remove('active');
            tab.setAttribute('aria-selected', 'false');
        });
    }
    if (evt?.target) {
        const tab = evt.target.closest('.tool-tab');
        if (tab) {
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
        }
    }

    // 更新 L2 场景显示
    const sceneClass = l1 === 'swarm' ? 'docker-swarm-l2-scene' : 'docker-stack-l2-scene';
    const scenePrefix = l1 === 'swarm' ? 'docker-swarm-l2-scene' : 'docker-stack-l2-scene';

    if (l1Container) {
        l1Container.querySelectorAll(`.${sceneClass}`).forEach(s => {
            s.classList.remove('active');
        });
    }
    document.getElementById(`${scenePrefix}-${l2}`)?.classList.add('active');

    updateDockerSwarmCommand();
}

function updateDockerSwarmCommand() {
    const outputEl = document.getElementById('docker-swarm-command-output');
    const descEl = document.getElementById('docker-swarm-command-desc');

    if (!window.DogToolboxM27Utils) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = '工具模块未加载';
        return;
    }

    try {
        let result = null;

        if (currentDockerSwarmL1 === 'swarm') {
            switch (currentDockerSwarmL2) {
                case 'init': result = generateSwarmInitCmd(); break;
                case 'join': result = generateSwarmJoinCmd(); break;
                case 'leave': result = generateSwarmLeaveCmd(); break;
                case 'update': result = generateSwarmUpdateCmd(); break;
                case 'unlock': result = generateSwarmUnlockCmd(); break;
            }
        } else {
            switch (currentDockerStackL2) {
                case 'deploy': result = generateStackDeployCmd(); break;
                case 'ls': result = generateStackLsCmd(); break;
                case 'ps': result = generateStackPsCmd(); break;
                case 'services': result = generateStackServicesCmd(); break;
                case 'rm': result = generateStackRmCmd(); break;
            }
        }

        if (result) {
            if (outputEl) outputEl.value = result.command || '';
            if (descEl) descEl.textContent = result.description || '';
        } else {
            if (outputEl) outputEl.value = '';
            if (descEl) descEl.textContent = '请填写必要参数';
        }
    } catch (e) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = `错误：${e.message || String(e)}`;
    }
}

function generateSwarmInitCmd() {
    const options = {
        advertiseAddr: document.getElementById('swarm-init-advertise-addr')?.value.trim(),
        listenAddr: document.getElementById('swarm-init-listen-addr')?.value.trim(),
        forceNewCluster: document.getElementById('swarm-init-force-new-cluster')?.checked || false
    };

    return DogToolboxM27Utils.generateSwarmInitCommand(options);
}

function generateSwarmJoinCmd() {
    const addr = document.getElementById('swarm-join-addr')?.value.trim();
    const token = document.getElementById('swarm-join-token')?.value.trim();

    const addrValid = validateInput('swarm-join-addr', addr);
    const tokenValid = validateInput('swarm-join-token', token);

    if (!addrValid || !tokenValid) {
        return null;
    }

    const options = {
        token,
        advertiseAddr: document.getElementById('swarm-join-advertise-addr')?.value.trim(),
        listenAddr: document.getElementById('swarm-join-listen-addr')?.value.trim()
    };

    return DogToolboxM27Utils.generateSwarmJoinCommand(addr, options);
}

function generateSwarmLeaveCmd() {
    const options = {
        force: document.getElementById('swarm-leave-force')?.checked || false
    };

    return DogToolboxM27Utils.generateSwarmLeaveCommand(options);
}

function generateSwarmUpdateCmd() {
    const autolockTrue = document.getElementById('swarm-update-autolock-true')?.checked || false;
    const autolockFalse = document.getElementById('swarm-update-autolock-false')?.checked || false;

    const options = {
        certExpiry: document.getElementById('swarm-update-cert-expiry')?.value.trim(),
        dispatcherHeartbeat: document.getElementById('swarm-update-dispatcher-heartbeat')?.value.trim()
    };

    if (autolockTrue) options.autolock = true;
    else if (autolockFalse) options.autolock = false;

    return DogToolboxM27Utils.generateSwarmUpdateCommand(options);
}

function generateSwarmUnlockCmd() {
    return DogToolboxM27Utils.generateSwarmUnlockCommand();
}

function generateStackDeployCmd() {
    const stackName = document.getElementById('stack-deploy-name')?.value.trim();
    const composeFiles = document.getElementById('stack-deploy-compose-files')?.value.trim();

    const nameValid = validateInput('stack-deploy-name', stackName);
    const filesValid = validateInput('stack-deploy-compose-files', composeFiles);

    if (!nameValid || !filesValid) {
        return null;
    }

    const files = composeFiles.split(',').map(f => f.trim()).filter(f => f);

    const options = {
        composeFiles: files,
        withRegistryAuth: document.getElementById('stack-deploy-with-registry-auth')?.checked || false,
        prune: document.getElementById('stack-deploy-prune')?.checked || false,
        resolveImage: document.getElementById('stack-deploy-resolve-image')?.value.trim()
    };

    return DogToolboxM27Utils.generateStackDeployCommand(stackName, options);
}

function generateStackLsCmd() {
    return DogToolboxM27Utils.generateStackLsCommand();
}

function generateStackPsCmd() {
    const stackName = document.getElementById('stack-ps-name')?.value.trim();

    if (!validateInput('stack-ps-name', stackName)) {
        return null;
    }

    return DogToolboxM27Utils.generateStackPsCommand(stackName);
}

function generateStackServicesCmd() {
    const stackName = document.getElementById('stack-services-name')?.value.trim();

    if (!validateInput('stack-services-name', stackName)) {
        return null;
    }

    return DogToolboxM27Utils.generateStackServicesCommand(stackName);
}

function generateStackRmCmd() {
    const namesStr = document.getElementById('stack-rm-names')?.value.trim();

    if (!validateInput('stack-rm-names', namesStr)) {
        return null;
    }

    const names = namesStr.split(/\s+/).filter(n => n);
    if (names.length === 0) return null;

    return DogToolboxM27Utils.generateStackRmCommand(names);
}

function copyDockerSwarmCommand(btn) {
    const output = document.getElementById('docker-swarm-command-output').value;
    if (!output) return;
    copyToolText(btn, output, { showTextFeedback: true });
}


// ==================== M28 JSON Schema 生成 ====================
function clearJsonSchemaTool() {
    document.getElementById('jsonschema-input').value = '';
    document.getElementById('jsonschema-output').value = '';
    document.getElementById('jsonschema-errors').innerHTML = '';
}

function updateJsonSchemaTool() {
    const input = document.getElementById('jsonschema-input').value;
    const outputEl = document.getElementById('jsonschema-output');
    const errorsEl = document.getElementById('jsonschema-errors');
    const allRequiredEl = document.getElementById('jsonschema-all-required');
    const inferEnumEl = document.getElementById('jsonschema-infer-enum');

    errorsEl.innerHTML = '';

    if (!input.trim()) {
        outputEl.value = '';
        return;
    }

    const options = {
        allRequired: allRequiredEl?.checked ?? true,
        inferEnum: inferEnumEl?.checked ?? false
    };

    const result = DogToolboxM28Utils.generateSchema(input, options);

    if (result.error) {
        errorsEl.innerHTML = `<div class="error-message">错误：${escapeHtml(result.error)}</div>`;
        outputEl.value = '';
    } else {
        outputEl.value = JSON.stringify(result.schema, null, 2);
    }
}

function copyJsonSchemaOutput(btn) {
    const output = document.getElementById('jsonschema-output').value;
    if (!output) return;
    copyToolText(btn, output, { showTextFeedback: true });
}

async function downloadJsonSchema() {
    const output = document.getElementById('jsonschema-output').value;
    if (!output) return;

    // 优先使用后端保存对话框（避免 pywebview 环境下前端下载导致崩溃）
    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file_dialog) {
        try {
            const result = await window.pywebview.api.save_file_dialog({
                content: output,
                default_filename: 'schema.json'
            });
            if (result.success) {
                showToast('已保存到: ' + result.path);
            } else if (result.error && result.error !== '用户取消了保存') {
                showToast('保存失败: ' + result.error, 'error');
            }
        } catch (e) {
            showToast('保存失败: ' + e.message, 'error');
        }
        return;
    }

    // 回退到前端下载方式
    const blob = new Blob([output], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schema.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==================== M24 HTTP 请求测试 ====================

function initHttpTool() {
    // 初始化默认请求头
    const headersEditor = document.getElementById('http-headers-editor');
    if (headersEditor) {
        headersEditor.innerHTML = `
            <div class="http-kv-row">
                <input type="text" placeholder="Header Name" class="http-kv-key" value="Content-Type">
                <input type="text" placeholder="Header Value" class="http-kv-value" value="application/json">
                <button class="btn btn-sm btn-ghost" onclick="removeHttpKvRow(this)">-</button>
            </div>
            <div class="http-kv-row">
                <input type="text" placeholder="Header Name" class="http-kv-key">
                <input type="text" placeholder="Header Value" class="http-kv-value">
                <button class="btn btn-sm btn-ghost" onclick="addHttpHeader()">+</button>
            </div>
        `;
    }
}

function clearHttpTool() {
    document.getElementById('http-url').value = '';
    document.getElementById('http-method').value = 'GET';
    document.getElementById('http-body-text').value = '';
    document.getElementById('http-response-body').value = '';
    document.getElementById('http-response-headers-text').value = '';
    document.getElementById('http-response-meta').innerHTML = '';
    document.getElementById('http-curl-input').value = '';

    // 重置参数和请求头
    const paramsEditor = document.getElementById('http-params-editor');
    if (paramsEditor) {
        paramsEditor.innerHTML = `
            <div class="http-kv-row">
                <input type="text" placeholder="Key" class="http-kv-key">
                <input type="text" placeholder="Value" class="http-kv-value">
                <button class="btn btn-sm btn-ghost" onclick="addHttpParam()">+</button>
            </div>
        `;
    }

    initHttpTool();
}

function switchHttpTab(tab) {
    // 切换标签激活状态
    document.querySelectorAll('.http-tabs .http-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // 切换内容显示
    document.querySelectorAll('.http-request .http-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `http-tab-${tab}`);
    });
}

function switchHttpResponseTab(tab) {
    // 切换标签激活状态
    document.querySelectorAll('.http-response-tabs .http-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // 切换内容显示
    document.querySelectorAll('.http-response-content .http-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `http-tab-${tab}`);
    });
}

function switchHttpBodyType(type) {
    httpBodyType = type;
    const editor = document.getElementById('http-body-editor');
    if (type === 'none') {
        editor.style.display = 'none';
    } else {
        editor.style.display = 'block';
    }
}

function addHttpParam() {
    const editor = document.getElementById('http-params-editor');
    const lastRow = editor.querySelector('.http-kv-row:last-child');
    const newRow = document.createElement('div');
    newRow.className = 'http-kv-row';
    newRow.innerHTML = `
        <input type="text" placeholder="Key" class="http-kv-key">
        <input type="text" placeholder="Value" class="http-kv-value">
        <button class="btn btn-sm btn-ghost" onclick="addHttpParam()">+</button>
    `;

    // 将最后一行的 + 按钮改为 - 按钮
    const lastBtn = lastRow.querySelector('button');
    lastBtn.textContent = '-';
    lastBtn.onclick = function() { removeHttpKvRow(this); };

    editor.appendChild(newRow);
}

function addHttpHeader() {
    const editor = document.getElementById('http-headers-editor');
    const lastRow = editor.querySelector('.http-kv-row:last-child');
    const newRow = document.createElement('div');
    newRow.className = 'http-kv-row';
    newRow.innerHTML = `
        <input type="text" placeholder="Header Name" class="http-kv-key">
        <input type="text" placeholder="Header Value" class="http-kv-value">
        <button class="btn btn-sm btn-ghost" onclick="addHttpHeader()">+</button>
    `;

    // 将最后一行的 + 按钮改为 - 按钮
    const lastBtn = lastRow.querySelector('button');
    lastBtn.textContent = '-';
    lastBtn.onclick = function() { removeHttpKvRow(this); };

    editor.appendChild(newRow);
}

function removeHttpKvRow(btn) {
    const row = btn.closest('.http-kv-row');
    row.remove();
}

function getHttpParams() {
    const params = {};
    document.querySelectorAll('#http-params-editor .http-kv-row').forEach(row => {
        const key = row.querySelector('.http-kv-key').value.trim();
        const value = row.querySelector('.http-kv-value').value.trim();
        if (key) {
            params[key] = value;
        }
    });
    return params;
}

function getHttpHeaders() {
    const headers = {};
    document.querySelectorAll('#http-headers-editor .http-kv-row').forEach(row => {
        const key = row.querySelector('.http-kv-key').value.trim();
        const value = row.querySelector('.http-kv-value').value.trim();
        if (key) {
            headers[key] = value;
        }
    });
    return headers;
}

async function sendHttpRequest() {
    const method = document.getElementById('http-method').value;
    const url = document.getElementById('http-url').value.trim();
    const responseBodyEl = document.getElementById('http-response-body');
    const responseHeadersEl = document.getElementById('http-response-headers-text');
    const responseMetaEl = document.getElementById('http-response-meta');

    if (!url) {
        responseBodyEl.value = '错误：请输入 URL';
        return;
    }

    try {
        // 构建完整 URL（带参数）
        const params = getHttpParams();
        const fullUrl = DogToolboxM24Utils.buildUrl(url, params);

        // 构建请求头
        const headers = getHttpHeaders();

        // 构建请求体
        let body = null;
        if (httpBodyType !== 'none' && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            body = document.getElementById('http-body-text').value || null;
        }

        // 显示发送中状态
        responseMetaEl.innerHTML = '<span style="color: #666;">发送中...</span>';

        // 优先使用后端代理（解决 CORS 问题）
        let result;
        if (window.pywebview && window.pywebview.api && window.pywebview.api.http_request) {
            result = await window.pywebview.api.http_request(method, fullUrl, headers, body, 30);

            if (!result.success && result.error) {
                responseBodyEl.value = `错误：${result.error}`;
                responseMetaEl.innerHTML = '<span style="color: #ef4444;">请求失败</span>';
                return;
            }

            // 显示响应
            responseBodyEl.value = result.body || '';

            // 格式化响应头
            if (result.headers) {
                responseHeadersEl.value = Object.keys(result.headers)
                    .map(key => `${key}: ${result.headers[key]}`)
                    .join('\n');
            }

            // 显示元信息
            const statusColor = result.status >= 200 && result.status < 400 ? '#10b981' : '#ef4444';
            const size = new Blob([result.body || '']).size;
            responseMetaEl.innerHTML = `
                <span style="color: ${statusColor}; font-weight: bold;">Status: ${result.status} ${result.statusText || ''}</span>
                <span style="margin-left: 16px;">Time: ${DogToolboxM24Utils.formatResponseTime(result.duration || 0)}</span>
                <span style="margin-left: 16px;">Size: ${DogToolboxM24Utils.formatResponseSize(size)}</span>
            `;
        } else {
            // 回退到前端 fetch（可能有 CORS 限制）
            const config = {
                method: method,
                headers: headers
            };

            if (body) {
                config.body = body;
            }

            const startTime = Date.now();
            const response = await fetch(fullUrl, config);
            const endTime = Date.now();
            const duration = endTime - startTime;

            // 获取响应头
            const responseHeaders = {};
            response.headers.forEach((value, key) => {
                responseHeaders[key] = value;
            });

            // 获取响应体
            const contentType = response.headers.get('content-type') || '';
            let responseBody;

            if (contentType.includes('application/json')) {
                const json = await response.json();
                responseBody = JSON.stringify(json, null, 2);
            } else {
                responseBody = await response.text();
            }

            // 显示响应
            responseBodyEl.value = responseBody;
            responseHeadersEl.value = Object.keys(responseHeaders)
                .map(key => `${key}: ${responseHeaders[key]}`)
                .join('\n');

            // 显示元信息
            const statusColor = response.ok ? '#10b981' : '#ef4444';
            const size = new Blob([responseBody]).size;
            responseMetaEl.innerHTML = `
                <span style="color: ${statusColor}; font-weight: bold;">Status: ${response.status} ${response.statusText}</span>
                <span style="margin-left: 16px;">Time: ${DogToolboxM24Utils.formatResponseTime(duration)}</span>
                <span style="margin-left: 16px;">Size: ${DogToolboxM24Utils.formatResponseSize(size)}</span>
            `;
        }

    } catch (e) {
        responseBodyEl.value = `错误：${e.message || String(e)}`;
        responseMetaEl.innerHTML = '<span style="color: #ef4444;">请求失败</span>';
    }
}

function importCurl() {
    const curlInput = document.getElementById('http-curl-input').value;
    if (!curlInput.trim()) return;

    const config = DogToolboxM24Utils.parseCurl(curlInput);

    if (config.error) {
        alert(config.error);
        return;
    }

    // 设置 URL 和方法
    document.getElementById('http-url').value = config.url;
    document.getElementById('http-method').value = config.method;

    // 设置请求头
    const headersEditor = document.getElementById('http-headers-editor');
    headersEditor.innerHTML = '';
    Object.keys(config.headers).forEach(key => {
        const row = document.createElement('div');
        row.className = 'http-kv-row';
        row.innerHTML = `
            <input type="text" placeholder="Header Name" class="http-kv-key" value="${escapeHtml(key)}">
            <input type="text" placeholder="Header Value" class="http-kv-value" value="${escapeHtml(config.headers[key])}">
            <button class="btn btn-sm btn-ghost" onclick="removeHttpKvRow(this)">-</button>
        `;
        headersEditor.appendChild(row);
    });

    // 添加空行
    const emptyRow = document.createElement('div');
    emptyRow.className = 'http-kv-row';
    emptyRow.innerHTML = `
        <input type="text" placeholder="Header Name" class="http-kv-key">
        <input type="text" placeholder="Header Value" class="http-kv-value">
        <button class="btn btn-sm btn-ghost" onclick="addHttpHeader()">+</button>
    `;
    headersEditor.appendChild(emptyRow);

    // 设置请求体
    if (config.body) {
        document.querySelector('input[name="http-body-type"][value="raw"]').checked = true;
        switchHttpBodyType('raw');
        document.getElementById('http-body-text').value = config.body;
    }

    alert('cURL 命令已导入');
}

function exportCurl() {
    const method = document.getElementById('http-method').value;
    const url = document.getElementById('http-url').value.trim();

    if (!url) {
        alert('请先输入 URL');
        return;
    }

    const params = getHttpParams();
    const fullUrl = DogToolboxM24Utils.buildUrl(url, params);

    const config = {
        method: method,
        url: fullUrl,
        headers: getHttpHeaders(),
        body: httpBodyType !== 'none' ? document.getElementById('http-body-text').value : ''
    };

    const curl = DogToolboxM24Utils.generateCurl(config);
    document.getElementById('http-curl-input').value = curl;

    // 切换到 cURL 标签
    switchHttpTab('curl');
}

// ==================== M25 WebSocket 测试 ====================

function initWebSocketTool() {
    // 初始化完成
}

function clearWebSocketTool() {
    if (wsConnection) {
        wsConnection.close();
        wsConnection = null;
    }
    document.getElementById('ws-url').value = '';
    document.getElementById('ws-message-input').value = '';
    clearWebSocketMessages();
    updateWebSocketStatus('未连接', 'disconnected');
}

function clearWebSocketMessages() {
    wsMessages = [];
    document.getElementById('ws-messages-list').innerHTML = '';
}

function updateWebSocketStatus(text, status) {
    const statusEl = document.getElementById('ws-status');
    const btnEl = document.getElementById('ws-connect-btn');

    statusEl.textContent = text;
    statusEl.className = `ws-status ws-status-${status}`;

    if (status === 'connected') {
        btnEl.textContent = '断开';
        btnEl.classList.remove('btn-primary');
        btnEl.classList.add('btn-danger');
    } else {
        btnEl.textContent = '连接';
        btnEl.classList.remove('btn-danger');
        btnEl.classList.add('btn-primary');
    }
}

function addWebSocketMessage(type, content) {
    const message = DogToolboxM25Utils.formatMessage(type, content);
    wsMessages.push(message);

    const messagesList = document.getElementById('ws-messages-list');
    const messageEl = document.createElement('div');
    messageEl.className = `ws-message ws-message-${type}`;

    const formatJson = document.getElementById('ws-format-json').checked;
    let displayContent = content;

    if (formatJson && type !== 'system') {
        displayContent = DogToolboxM25Utils.tryFormatJson(content);
    }

    messageEl.innerHTML = `
        <div class="ws-message-header">
            <span class="ws-message-type">${type === 'sent' ? '发送' : type === 'received' ? '接收' : '系统'}</span>
            <span class="ws-message-time">${message.timestamp}</span>
        </div>
        <div class="ws-message-content">${escapeHtml(displayContent)}</div>
    `;

    messagesList.appendChild(messageEl);
    messagesList.scrollTop = messagesList.scrollHeight;
}

function toggleWebSocketConnection() {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        // 断开连接
        wsAutoReconnect = false;
        wsConnection.close();
    } else {
        // 建立连接
        connectWebSocket();
    }
}

function connectWebSocket() {
    const url = document.getElementById('ws-url').value.trim();

    if (!url) {
        addWebSocketMessage('system', '错误：请输入 WebSocket URL');
        return;
    }

    if (!DogToolboxM25Utils.isValidWsUrl(url)) {
        addWebSocketMessage('system', '错误：无效的 WebSocket URL（必须以 ws:// 或 wss:// 开头）');
        return;
    }

    try {
        updateWebSocketStatus('连接中...', 'connecting');
        wsConnection = new WebSocket(url);
        wsAutoReconnect = document.getElementById('ws-auto-reconnect').checked;

        wsConnection.onopen = function() {
            updateWebSocketStatus('已连接', 'connected');
            addWebSocketMessage('system', `已连接到 ${url}`);

            if (wsReconnectTimer) {
                clearTimeout(wsReconnectTimer);
                wsReconnectTimer = null;
            }
        };

        wsConnection.onmessage = function(event) {
            addWebSocketMessage('received', event.data);
        };

        wsConnection.onerror = function(error) {
            addWebSocketMessage('system', '连接错误');
            updateWebSocketStatus('错误', 'error');
        };

        wsConnection.onclose = function(event) {
            updateWebSocketStatus('已断开', 'disconnected');
            addWebSocketMessage('system', `连接已关闭 (code: ${event.code})`);

            // 自动重连
            if (wsAutoReconnect && !wsReconnectTimer) {
                addWebSocketMessage('system', '5 秒后自动重连...');
                wsReconnectTimer = setTimeout(() => {
                    wsReconnectTimer = null;
                    connectWebSocket();
                }, 5000);
            }
        };

    } catch (e) {
        addWebSocketMessage('system', `连接失败：${e.message || String(e)}`);
        updateWebSocketStatus('失败', 'error');
    }
}

function sendWebSocketMessage() {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
        addWebSocketMessage('system', '错误：未连接到 WebSocket 服务器');
        return;
    }

    const messageInput = document.getElementById('ws-message-input');
    const message = messageInput.value.trim();

    if (!message) {
        return;
    }

    const messageType = document.querySelector('input[name="ws-message-type"]:checked').value;

    try {
        let sendData = message;

        if (messageType === 'json') {
            // 验证 JSON 格式
            JSON.parse(message);
        }

        wsConnection.send(sendData);
        addWebSocketMessage('sent', sendData);
        messageInput.value = '';

    } catch (e) {
        addWebSocketMessage('system', `发送失败：${e.message || String(e)}`);
    }
}

function sendWebSocketPing() {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
        addWebSocketMessage('system', '错误：未连接到 WebSocket 服务器');
        return;
    }

    try {
        wsConnection.send('ping');
        addWebSocketMessage('sent', 'ping');
    } catch (e) {
        addWebSocketMessage('system', `Ping 失败：${e.message || String(e)}`);
    }
}

// ==================== M29 Mock 数据生成 ====================
function clearMockTool() {
    document.getElementById('mock-output').value = '';
}

function generateMockData() {
    const type = document.getElementById('mock-type').value;
    const count = parseInt(document.getElementById('mock-count').value) || 10;
    const format = document.getElementById('mock-output-format')?.value || 'lines';
    const outputEl = document.getElementById('mock-output');

    const results = [];

    try {
        for (let i = 0; i < count; i++) {
            let value;
            switch (type) {
                case 'name':
                    value = DogToolboxM29Utils.randomName();
                    break;
                case 'email':
                    value = DogToolboxM29Utils.randomEmail();
                    break;
                case 'phone':
                    value = DogToolboxM29Utils.randomPhone();
                    break;
                case 'idcard':
                    value = DogToolboxM29Utils.randomIdCard();
                    break;
                case 'address':
                    value = DogToolboxM29Utils.randomAddress();
                    break;
                case 'uuid':
                    value = DogToolboxM29Utils.randomUuid();
                    break;
                case 'date':
                    value = DogToolboxM29Utils.randomDate();
                    break;
                default:
                    value = DogToolboxM29Utils.randomName();
            }
            results.push(value);
        }

        // 根据输出格式生成结果
        let output;
        switch (format) {
            case 'json':
                output = JSON.stringify(results, null, 2);
                break;
            case 'csv':
                output = results.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',\n');
                break;
            case 'jsonlines':
                output = results.map(v => JSON.stringify(v)).join('\n');
                break;
            case 'lines':
            default:
                output = results.join('\n');
        }

        outputEl.value = output;
    } catch (e) {
        outputEl.value = `错误：${e.message || String(e)}`;
    }
}

function copyMockOutput(btn) {
    const output = document.getElementById('mock-output').value;
    if (!output) {
        if (btn) {
            const orig = btn.textContent;
            btn.textContent = '无内容';
            btn.classList.add('btn-danger');
            setTimeout(() => { btn.textContent = orig; btn.classList.remove('btn-danger'); }, 1200);
        }
        return;
    }
    copyToolText(btn, output, { showTextFeedback: true });
}

// ==================== M30 数据脱敏 ====================
function clearMaskTool() {
    document.getElementById('mask-input').value = '';
    document.getElementById('mask-output').value = '';
}

function updateMaskTool() {
    const input = document.getElementById('mask-input').value;
    const type = document.getElementById('mask-type').value;
    const outputEl = document.getElementById('mask-output');
    const jsonFieldsGroup = document.getElementById('mask-json-fields-group');

    // 显示/隐藏 JSON 字段输入框
    if (jsonFieldsGroup) {
        jsonFieldsGroup.style.display = type === 'json' ? 'block' : 'none';
    }

    if (!input.trim()) {
        outputEl.value = '';
        return;
    }

    try {
        let result;
        if (type === 'auto') {
            // smartMask 返回 {result, type} 对象，需要逐行处理
            const lines = input.split('\n');
            const masked = lines.map(line => {
                if (!line.trim()) return line;
                const maskResult = DogToolboxM30Utils.smartMask(line.trim());
                return maskResult.result || line;
            });
            result = masked.join('\n');
        } else if (type === 'json') {
            // JSON 递归脱敏模式
            const jsonFieldsEl = document.getElementById('mask-json-fields');
            const customFields = jsonFieldsEl ? jsonFieldsEl.value.split(',').map(f => f.trim()).filter(Boolean) : [];
            const parsed = JSON.parse(input);
            const masked = DogToolboxM30Utils.maskJsonRecursive(parsed, customFields);
            result = JSON.stringify(masked, null, 2);
        } else {
            const lines = input.split('\n');
            const masked = lines.map(line => {
                if (!line.trim()) return line;
                switch (type) {
                    case 'phone':
                        return DogToolboxM30Utils.maskPhone(line.trim());
                    case 'idcard':
                        return DogToolboxM30Utils.maskIdCard(line.trim());
                    case 'email':
                        return DogToolboxM30Utils.maskEmail(line.trim());
                    case 'bankcard':
                        return DogToolboxM30Utils.maskBankCard(line.trim());
                    case 'name':
                        return DogToolboxM30Utils.maskName(line.trim());
                    case 'address':
                        return DogToolboxM30Utils.maskAddress(line.trim());
                    default:
                        return line;
                }
            });
            result = masked.join('\n');
        }
        outputEl.value = result;
    } catch (e) {
        outputEl.value = `错误：${e.message || String(e)}`;
    }
}

function copyMaskOutput(btn) {
    const output = document.getElementById('mask-output').value;
    if (!output) return;
    copyToolText(btn, output, { showTextFeedback: true });
}

// ==================== 工具箱：CSV 处理 (M23) ====================

function initCsvTool() {
    const inputEl = document.getElementById('csv-input');
    if (!inputEl) return;

    // Initialize state
    csvInputFormat = 'csv';
    csvOutputFormat = 'json';
    updateCsvToolUi();
}

function setCsvInputFormat(fmt) {
    if (fmt !== 'csv' && fmt !== 'json') return;
    csvInputFormat = fmt;
    updateCsvToolUi();
    updateCsvTool();
}

function setCsvOutputFormat(fmt) {
    if (fmt !== 'csv' && fmt !== 'json') return;
    csvOutputFormat = fmt;
    updateCsvToolUi();
    updateCsvTool();
}

function updateCsvToolUi() {
    document.getElementById('csv-in-csv')?.classList.toggle('active', csvInputFormat === 'csv');
    document.getElementById('csv-in-json')?.classList.toggle('active', csvInputFormat === 'json');
    document.getElementById('csv-out-csv')?.classList.toggle('active', csvOutputFormat === 'csv');
    document.getElementById('csv-out-json')?.classList.toggle('active', csvOutputFormat === 'json');
}

function updateCsvTool() {
    const inputEl = document.getElementById('csv-input');
    const outputEl = document.getElementById('csv-output');
    const errorsEl = document.getElementById('csv-errors');
    const delimiterEl = document.getElementById('csv-delimiter');
    const hasHeaderEl = document.getElementById('csv-has-header');

    if (!inputEl || !outputEl || !errorsEl) return;

    errorsEl.innerHTML = '';
    const input = inputEl.value;
    if (!input.trim()) {
        outputEl.value = '';
        return;
    }

    if (!window.DogToolboxM23Utils) {
        errorsEl.innerHTML = '<div>⚠ 工具模块未加载</div>';
        return;
    }

    try {
        const options = {
            delimiter: delimiterEl?.value || ',',
            hasHeader: hasHeaderEl?.checked ?? true
        };

        let data;
        // Parse input
        if (csvInputFormat === 'csv') {
            data = window.DogToolboxM23Utils.parseCSV(input, options);
        } else {
            data = JSON.parse(input);
        }

        // Generate output
        let output;
        if (csvOutputFormat === 'csv') {
            output = window.DogToolboxM23Utils.stringifyCSV(data, options);
        } else {
            output = JSON.stringify(data, null, 2);
        }

        outputEl.value = output;
    } catch (e) {
        const errorMsg = escapeHtml(e.message || String(e));
        errorsEl.innerHTML = `<div>⚠ ${errorMsg}</div>`;
    }
}

function clearCsvTool() {
    const inputEl = document.getElementById('csv-input');
    const outputEl = document.getElementById('csv-output');
    const errorsEl = document.getElementById('csv-errors');
    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
}

function copyCsvOutput(btn) {
    const outputEl = document.getElementById('csv-output');
    copyToolText(btn, outputEl?.value || '', { showTextFeedback: true });
}

function detectCsvDelimiter() {
    const inputEl = document.getElementById('csv-input');
    const delimiterEl = document.getElementById('csv-delimiter');
    if (!inputEl || !delimiterEl || !window.DogToolboxM23Utils) return;

    const input = inputEl.value;
    if (!input.trim()) return;

    const detected = window.DogToolboxM23Utils.detectDelimiter(input);
    delimiterEl.value = detected;
    updateCsvTool();
}

// ==================== M22 Markdown 工具初始化 ====================
function initMarkdownTool() {
    const inputEl = document.getElementById('markdown-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateMarkdownTool);
    updateMarkdownTool();

    // 将帮助弹窗移动到 body，避免被 page 容器裁剪或影响层级
    const modal = document.getElementById('markdown-help-modal');
    if (modal && modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
}

// ==================== 面板过滤功能 ====================
function initPanelFiltering(containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    const panels = container.querySelectorAll('.converter-panel');
    let activePanel = null;
    let savedPanelOffset = 0; // 记录面板在滚动容器视口中的位置，便于还原
    let savedScrollTop = 0;

    const scrollContainer = container.closest('.content')
        || document.getElementById('page-root')
        || document.scrollingElement
        || document.documentElement;
    const isWindowScroll = scrollContainer === document.documentElement || scrollContainer === document.body;
    const getScrollTop = () => (isWindowScroll
        ? (window.scrollY || document.documentElement.scrollTop || 0)
        : scrollContainer.scrollTop);
    const setScrollTop = (top) => {
        const targetTop = Math.max(top, 0);
        if (isWindowScroll) {
            window.scrollTo({ top: targetTop, behavior: 'auto' });
        } else {
            scrollContainer.scrollTo({ top: targetTop, behavior: 'auto' });
        }
    };
    const getContainerTop = () => (isWindowScroll ? 0 : scrollContainer.getBoundingClientRect().top);
    const getPanelTop = (panelEl) => panelEl.getBoundingClientRect().top - getContainerTop() + getScrollTop();
    const scrollPanelToOffset = (panelEl, offset) => {
        if (!panelEl) return;
        const panelTop = getPanelTop(panelEl);
        const targetTop = panelTop - offset;
        setScrollTop(targetTop);
    };

    panels.forEach(panel => {
        const header = panel.querySelector('.panel-header');
        if (!header) return;

        // Add title hint
        header.title = "点击聚焦/还原面板";
        const titleEl = header.querySelector('h3');
        if (titleEl && !titleEl.querySelector('.panel-return-indicator')) {
            const indicator = document.createElement('span');
            indicator.className = 'panel-return-indicator';
            indicator.textContent = '❮ 返回';
            indicator.setAttribute('aria-hidden', 'true');
            titleEl.prepend(indicator);
        }

        header.addEventListener('click', (e) => {
            // 如果点击的是按钮，不触发过滤
            if (e.target.closest('button')) return;

            // 如果点击的是当前激活的面板，显示所有面板
            if (activePanel === panel) {
                // 还原所有面板
                panels.forEach(p => {
                    p.classList.remove('panel-filtered');
                    const h = p.querySelector('.panel-header');
                    if (h) h.classList.remove('active-filter');
                });
                activePanel = null;

                const restoreScrollTop = savedScrollTop;
                requestAnimationFrame(() => {
                    setScrollTop(restoreScrollTop);
                });
            } else {
                savedScrollTop = getScrollTop();
                savedPanelOffset = panel.getBoundingClientRect().top - getContainerTop();

                // 聚焦当前面板
                panels.forEach(p => {
                    if (p === panel) {
                        p.classList.remove('panel-filtered');
                        const h = p.querySelector('.panel-header');
                        if (h) h.classList.add('active-filter');
                    } else {
                        p.classList.add('panel-filtered');
                        const h = p.querySelector('.panel-header');
                        if (h) h.classList.remove('active-filter');
                    }
                });
                activePanel = panel;

                // 聚焦后保持面板在原视口位置
                requestAnimationFrame(() => {
                    scrollPanelToOffset(panel, savedPanelOffset);
                });
            }
        });
    });
}

function resetPanelFiltering(containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    const panels = container.querySelectorAll('.converter-panel');
    panels.forEach(p => {
        p.classList.remove('panel-filtered');
        const h = p.querySelector('.panel-header');
        if (h) h.classList.remove('active-filter');
    });
}

// ==================== M26 Git 命令生成器初始化 ====================
function initGitTool() {
    // Git 工具使用场景切换和模板加载，无需额外初始化
    // 所有事件处理器已通过 onclick 绑定
    loadGitTemplates();
    initPanelFiltering('.git-tool');
}

// ==================== M27 Docker 命令生成器初始化 ====================
function initDockerTool() {
    // Docker 工具使用场景切换，无需额外初始化
    // 所有事件处理器已通过 onclick 绑定
    initPanelFiltering('.docker-tool');
}

// ==================== M28 JSON Schema 生成器初始化 ====================
function initJsonSchemaTool() {
    const inputEl = document.getElementById('jsonschema-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateJsonSchemaTool);
    updateJsonSchemaTool();
}

// ==================== M29 Mock 数据生成器初始化 ====================
function initMockTool() {
    // Mock 工具使用按钮触发，无需额外初始化
    // 所有事件处理器已通过 onclick 绑定
}

// ==================== M30 数据脱敏工具初始化 ====================
function initMaskTool() {
    const inputEl = document.getElementById('mask-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateMaskTool);
    updateMaskTool();
}

// ==================== M35 二维码生成器 ====================

function initQrcodeTool() {
    const inputEl = document.getElementById('qrcode-input');
    if (!inputEl) return;

    // 监听输入更新字节计数
    inputEl.addEventListener('input', () => {
        const text = inputEl.value;
        const bytes = new Blob([text]).size;
        document.getElementById('qrcode-byte-count').textContent = `${bytes} 字节`;
    });
}

function generateQrcode() {
    const text = document.getElementById('qrcode-input').value;
    if (!text) {
        showToast('请输入内容', 'warning');
        return;
    }

    const size = parseInt(document.getElementById('qrcode-size').value);
    const errorLevel = document.getElementById('qrcode-error-level').value;
    const darkColor = document.getElementById('qrcode-dark-color').value;
    const lightColor = document.getElementById('qrcode-light-color').value;

    const result = M35Utils.generate(text, {
        size,
        errorCorrectionLevel: errorLevel,
        darkColor,
        lightColor
    });

    if (result.error) {
        showToast(result.error, 'error');
        return;
    }

    qrcodeCanvas = result.canvas;
    qrcodeDataUrl = result.dataUrl;

    // 显示预览
    const preview = document.getElementById('qrcode-preview');
    const frame = preview.querySelector('.qr-code-frame');
    if (!frame) {
        showToast('预览容器初始化失败', 'error');
        return;
    }
    frame.innerHTML = '';
    const img = document.createElement('img');
    img.src = qrcodeDataUrl;
    img.alt = '二维码';
    img.className = 'qr-result-img';
    frame.appendChild(img);

    // 显示操作按钮
    document.getElementById('qrcode-actions').style.display = 'flex';
    showToast('二维码生成成功', 'success');
}

async function downloadQrcode() {
    if (!qrcodeDataUrl) {
        showToast('请先生成二维码', 'warning');
        return;
    }

    // 优先使用后端保存对话框（pywebview 环境下前端下载可能不工作）
    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_binary_file_dialog) {
        try {
            // 提取 base64 数据（去掉 data:image/png;base64, 前缀）
            const base64Data = qrcodeDataUrl.split(',')[1];

            const result = await window.pywebview.api.save_binary_file_dialog(
                base64Data,
                'qrcode.png'
            );

            if (result.success) {
                showToast('已保存到: ' + result.path, 'success');
            } else if (result.error && result.error !== '用户取消了保存') {
                showToast('保存失败: ' + result.error, 'error');
            }
        } catch (e) {
            // 出错时回退到前端下载
            M35Utils.download(qrcodeDataUrl, 'qrcode.png');
            showToast('下载成功', 'success');
        }
        return;
    }

    // 回退到前端下载方式
    M35Utils.download(qrcodeDataUrl, 'qrcode.png');
    showToast('下载成功', 'success');
}

async function copyQrcode() {
    if (!qrcodeCanvas) {
        showToast('请先生成二维码', 'warning');
        return;
    }
    const result = await M35Utils.copyToClipboard(qrcodeCanvas);
    if (result.error) {
        showToast(result.error, 'error');
    } else {
        showToast('已复制到剪贴板', 'success');
    }
}

function clearQrcodeTool() {
    document.getElementById('qrcode-input').value = '';
    document.getElementById('qrcode-byte-count').textContent = '0 字节';
    document.getElementById('qrcode-actions').style.display = 'none';
    qrcodeCanvas = null;
    qrcodeDataUrl = null;

    const preview = document.getElementById('qrcode-preview');
    const frame = preview.querySelector('.qr-code-frame');
    if (!frame) return;
    frame.innerHTML = `
        <div class="qr-preview-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <path d="M3 14h7v7H3z"></path>
            </svg>
            <span>输入内容并点击生成<br>预览将显示在这里</span>
        </div>
    `;
}
