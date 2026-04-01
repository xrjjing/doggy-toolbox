/*
  文件总览：兼容占位入口（不是当前真实业务主入口）

  这个文件现在不再承载页面逻辑。
  原先的大体量 web/app.js 已按职责拆分到了 web/js/ 目录，
  index.html 当前实际加载的也是拆分后的模块文件。

  目前它保留在仓库里的目的只有两个：
  1. 兼容旧文档、旧引用或外部脚本，避免直接访问 web/app.js 时 404；
  2. 给维护者一个明确提示：真正要排查页面逻辑时，请去看 web/js/app_*.js。

  主要迁移目标：
  - web/js/app_state.js：跨页面共享状态与基础工具函数
  - web/js/app_core.js：页面切换、懒加载、主题/设置、全局导航
  - web/js/app_computer_usage.js：命令/凭证管理页逻辑
  - web/js/app_nodes_converter.js：节点转换与节点管理逻辑
  - web/js/app_tools_a.js / b.js / c.js：工具页逻辑
  - web/js/app_ai_chat.js / app_ai_settings.js：AI 聊天与 AI 设置

  说明（2025-12-17）：
  - 原 web/app.js 体积过大（约 6000+ 行），已按职责拆分到 web/js/ 目录。
  - 入口页面 web/index.html 已改为加载：
    - web/js/app_state.js
    - web/js/app_core.js
    - web/js/app_computer_usage.js
    - web/js/app_nodes_converter.js
    - web/js/app_tools_a.js
    - web/js/app_tools_b.js
    - web/js/app_tools_c.js

  保留本文件的目的：
  - 避免外部脚本/旧文档仍引用 web/app.js 时直接 404；
  - 提供迁移提示，便于定位新入口文件。
*/

/*
 * 这个 IIFE 是兼容壳的唯一实际行为：
 * - 只在控制台打印“主入口已迁移”的提示；
 * - 不负责页面初始化、按钮绑定、数据加载或 pywebview 通信。
 * 所以如果页面功能失效，不要在这里排查业务逻辑，直接去看 web/js/app_*.js。
 */
(function () {
  if (typeof console !== 'undefined' && console.warn) {
    // 这里只做迁移提示，不参与任何页面初始化、事件绑定或数据加载。
    console.warn('web/app.js 已拆分：请查看 web/js/app_core.js 等文件（index.html 已更新脚本引用）。');
  }
})();
