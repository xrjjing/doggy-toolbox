/*
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

(function () {
  if (typeof console !== 'undefined' && console.warn) {
    console.warn('web/app.js 已拆分：请查看 web/js/app_core.js 等文件（index.html 已更新脚本引用）。');
  }
})();

