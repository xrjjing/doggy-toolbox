#!/usr/bin/env python3
"""
前端拆分回归审计（静态检查）

目标：
1) 验证 web/index.html 是否已壳化，且使用 #page-root 容器。
2) 验证导航 data-page 与 web/pages/<page>.html 片段一致，且片段内存在对应的 #page-<page>。
3) 验证 app_core.js 中 PAGE_INIT_MAP 的页面与 init 函数均存在。
4) 扫描 index/pages 中所有内联事件处理器（onclick/oninput/onchange/...）引用的函数名是否可在前端脚本中找到定义。
5) 验证模块映射 PAGE_MODULE_MAP 中的 window.* 全局模块名均可在工具脚本中找到定义（防止模块加载错误边界误报）。

说明：
- 这是“无构建链 + pywebview”项目的可重复静态回归检查，不依赖浏览器或 GUI。
- 若你需要进一步做 GUI 自动化（点击/输入/截图），建议再引入 Playwright（会增加依赖与运行时）。
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"


@dataclass(frozen=True)
class AuditResult:
    ok: bool
    title: str
    details: list[str]


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _iter_files(paths: Iterable[Path], suffixes: tuple[str, ...]) -> list[Path]:
    out: list[Path] = []
    for p in paths:
        if p.is_file() and p.suffix in suffixes:
            out.append(p)
        elif p.is_dir():
            for f in p.rglob("*"):
                if f.is_file() and f.suffix in suffixes:
                    out.append(f)
    return out


def check_index_shell() -> AuditResult:
    index_path = WEB_DIR / "index.html"
    if not index_path.exists():
        return AuditResult(False, "index.html 存在性", [f"缺失: {index_path}"])

    html = _read_text(index_path)
    details: list[str] = []

    if 'id="page-root"' not in html:
        details.append('未找到 `id="page-root"`，页面片段容器可能缺失')

    if '<section id="page-' in html:
        details.append("index.html 仍包含 page- 页面 section，可能未完全壳化")

    ok = not details
    if ok:
        details.append("index.html 已壳化，且包含 #page-root 容器")
    return AuditResult(ok, "index.html 壳化检查", details)


def extract_nav_pages(index_html: str) -> set[str]:
    # 只从 data-page 提取，不依赖 DOM 解析器
    return set(re.findall(r'data-page="([^"]+)"', index_html))


def check_page_fragments() -> AuditResult:
    index_path = WEB_DIR / "index.html"
    html = _read_text(index_path)
    pages = sorted(extract_nav_pages(html))
    pages_dir = WEB_DIR / "pages"

    details: list[str] = []
    missing: list[str] = []
    bad_id: list[str] = []

    for page in pages:
        f = pages_dir / f"{page}.html"
        if not f.exists():
            missing.append(page)
            continue
        frag = _read_text(f)
        if f'id="page-{page}"' not in frag:
            bad_id.append(page)

    if missing:
        details.append(f"缺失页面片段文件: {missing}")
    if bad_id:
        details.append(f"页面片段内缺失对应 #page-<page> id: {bad_id}")

    ok = not details
    if ok:
        details.append(f"导航页面共 {len(pages)} 个，均存在对应 web/pages/<page>.html 且 id 匹配")

    return AuditResult(ok, "导航与页面片段一致性", details)


def parse_page_init_map(app_core_js: str) -> dict[str, str]:
    # 匹配：'tool-xxx': initXxxTool,
    m = re.search(r"const PAGE_INIT_MAP\s*=\s*Object\.freeze\(\{\s*(.*?)\s*}\);", app_core_js, re.S)
    if not m:
        return {}
    body = m.group(1)
    # 兼容两种写法：
    # 1) 'tool-xxx': initXxxTool
    # 2) 'tool-xxx': 'initXxxTool'（拆分多文件后推荐，避免提前引用未定义标识符）
    pairs: list[tuple[str, str]] = []
    for k, v in re.findall(r"'([^']+)'\s*:\s*'([^']+)'\s*,?", body):
        pairs.append((k, v))
    for k, v in re.findall(r"'([^']+)'\s*:\s*([A-Za-z0-9_]+)\s*,?", body):
        pairs.append((k, v))
    return {k: v for k, v in pairs}


def check_page_init_map() -> AuditResult:
    core_path = WEB_DIR / "js" / "app_core.js"
    if not core_path.exists():
        return AuditResult(False, "PAGE_INIT_MAP 检查", [f"缺失: {core_path}"])

    core = _read_text(core_path)
    mapping = parse_page_init_map(core)
    if not mapping:
        return AuditResult(False, "PAGE_INIT_MAP 检查", ["未解析到 PAGE_INIT_MAP（正则未命中或结构变更）"])

    pages_dir = WEB_DIR / "pages"
    js_files = _iter_files([WEB_DIR / "js"], (".js",))
    js_text = "\n".join(_read_text(p) for p in js_files)

    details: list[str] = []
    missing_page: list[str] = []
    missing_init: list[str] = []

    for page, init_name in sorted(mapping.items()):
        if not (pages_dir / f"{page}.html").exists():
            missing_page.append(page)
        # 只做“存在性”校验：function initXxxTool(...) 或 async function initXxxTool(...)
        if not re.search(rf"\bfunction\s+{re.escape(init_name)}\s*\(", js_text):
            # 有的 init 可能是 const initFoo = (...) => {}，也做兜底匹配
            if not re.search(rf"\b{re.escape(init_name)}\s*=\s*(async\s*)?\(", js_text):
                missing_init.append(f"{page}:{init_name}")

    if missing_page:
        details.append(f"PAGE_INIT_MAP 引用的页面片段缺失: {missing_page}")
    if missing_init:
        details.append(f"PAGE_INIT_MAP 引用的初始化函数缺失: {missing_init}")

    ok = not details
    if ok:
        details.append(f"PAGE_INIT_MAP 共 {len(mapping)} 项：页面片段与初始化函数均可找到")
    return AuditResult(ok, "PAGE_INIT_MAP 完整性", details)


def extract_inline_handlers(html: str) -> set[str]:
    """
    提取内联事件处理器引用的函数名：
    - onclick="foo(...)"
    - oninput="bar(...)"
    - ondragstart="baz(event)" 等
    """
    handlers = set()
    for attr in ("onclick", "oninput", "onchange", "onsubmit", "ondragstart", "ondragover", "ondrop", "ondragend", "onkeydown"):
        for m in re.finditer(rf'{attr}\s*=\s*"([^"]+)"', html):
            expr = m.group(1).strip()
            # 只取最常见的函数调用形式：name(...)
            call = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*\(", expr)
            if call:
                handlers.add(call.group(1))
    return handlers


def check_inline_handlers_defined() -> AuditResult:
    index_path = WEB_DIR / "index.html"
    pages_dir = WEB_DIR / "pages"

    html_sources: list[Path] = [index_path] + sorted(pages_dir.glob("*.html"))
    handler_names: set[str] = set()
    for p in html_sources:
        handler_names |= extract_inline_handlers(_read_text(p))

    # 允许的“非本项目函数”黑名单（例如直接调用 window.xxx 或浏览器内建不在此列）
    # 注意：此处只处理函数名形式 foo(...)，因此 windowClose/windowMinimize 等仍会进来，需要存在定义。
    if not handler_names:
        return AuditResult(True, "内联事件处理器校验", ["未发现任何内联事件处理器（可能已全部迁移为事件绑定）"])

    js_files = _iter_files([WEB_DIR / "js", WEB_DIR], (".js",))
    js_text = "\n".join(_read_text(p) for p in js_files)

    missing: list[str] = []
    for name in sorted(handler_names):
        # 允许在工具模块里以 window.Name = ... 的方式暴露
        patterns = [
            rf"\bfunction\s+{re.escape(name)}\s*\(",
            rf"\b{re.escape(name)}\s*=\s*(async\s*)?\(",
            rf"\bwindow\.{re.escape(name)}\s*=",
        ]
        if not any(re.search(p, js_text) for p in patterns):
            missing.append(name)

    details: list[str] = []
    if missing:
        details.append(f"以下内联事件处理器未找到对应 JS 定义（可能会导致点击/输入无响应）: {missing}")
    else:
        details.append(f"共发现 {len(handler_names)} 个内联事件处理器函数名，均可在 JS 中找到定义")
    return AuditResult(not missing, "内联事件处理器定义检查", details)


def parse_page_module_map(app_core_js: str) -> dict[str, str]:
    m = re.search(r"const PAGE_MODULE_MAP\s*=\s*\{\s*(.*?)\s*};", app_core_js, re.S)
    if not m:
        return {}
    body = m.group(1)
    pairs = re.findall(r"'([^']+)'\s*:\s*'([^']+)'\s*,?", body)
    return {k: v for k, v in pairs}


def check_page_module_map_defined() -> AuditResult:
    core_path = WEB_DIR / "js" / "app_core.js"
    core = _read_text(core_path)
    mapping = parse_page_module_map(core)
    if not mapping:
        return AuditResult(False, "PAGE_MODULE_MAP 检查", ["未解析到 PAGE_MODULE_MAP（正则未命中或结构变更）"])

    # 搜索 window.<ModuleName> 的定义来源（tools_m*.js 等）
    tool_js_files = sorted(WEB_DIR.glob("tools_m*.js")) + sorted((WEB_DIR / "lib").glob("*.js"))
    tool_text = "\n".join(_read_text(p) for p in tool_js_files if p.exists())

    missing_modules: list[str] = []
    for module_name in sorted(set(mapping.values())):
        # 兼容 UMD：tools_m*.js 使用 (root, factory) 形式挂到 globalThis/window/root/self 等
        patterns = [
            rf"\bwindow\.{re.escape(module_name)}\s*=",
            rf"\bglobalThis\.{re.escape(module_name)}\s*=",
            rf"\bself\.{re.escape(module_name)}\s*=",
            rf"\broot\.{re.escape(module_name)}\s*=",
            rf"\bthis\.{re.escape(module_name)}\s*=",
        ]
        if not any(re.search(p, tool_text) for p in patterns):
            missing_modules.append(module_name)

    details: list[str] = []
    if missing_modules:
        details.append(f"PAGE_MODULE_MAP 引用的全局模块名未在工具脚本中找到 window.<name> 定义: {missing_modules}")
    else:
        details.append(f"PAGE_MODULE_MAP 共引用 {len(set(mapping.values()))} 个全局模块名，均可在工具脚本中找到定义")
    return AuditResult(not missing_modules, "工具模块全局名定义检查", details)


def check_dom_id_coverage() -> AuditResult:
    """
    校验“拆分后是否丢了关键 DOM”：
    - 收集 index.html + pages/*.html 的静态 id
    - 收集 web/js/*.js 中 document.getElementById('...') 的字面量
    - 检查 JS 引用的 id 是否在 HTML 中存在
    """
    html_paths = [WEB_DIR / "index.html"] + sorted((WEB_DIR / "pages").glob("*.html"))
    html_text = "\n".join(_read_text(p) for p in html_paths if p.exists())
    html_ids = set(re.findall(r'id="([A-Za-z0-9_\-:]+)"', html_text))

    js_paths = sorted((WEB_DIR / "js").glob("*.js"))
    js_text = "\n".join(_read_text(p) for p in js_paths if p.exists())
    used_ids = set(re.findall(r"getElementById\(\s*['\"]([^'\"]+)['\"]\s*\)", js_text))

    # 允许缺失：不是功能必须的 UI 元素（仅影响展示）
    optional_missing = {"themeMascot"}

    missing = sorted([i for i in used_ids if i not in html_ids and i not in optional_missing])

    details: list[str] = []
    if missing:
        details.append(f"JS getElementById 引用但未在 HTML 中找到的 id（疑似丢失/拼写错误）: {missing}")
        return AuditResult(False, "DOM id 覆盖检查", details)

    # 仅提示可选项
    opt_missing = sorted([i for i in used_ids if i not in html_ids and i in optional_missing])
    if opt_missing:
        details.append(f"可选 DOM id 未找到（不影响核心功能，仅影响展示）: {opt_missing}")

    details.append(f"HTML 静态 id: {len(html_ids)}，JS getElementById 字面量: {len(used_ids)}，覆盖检查通过")
    return AuditResult(True, "DOM id 覆盖检查", details)


def check_queryselector_id_coverage() -> AuditResult:
    """
    补充覆盖：检查 JS 中 querySelector/querySelectorAll 的“静态 #id 选择器”是否存在于 HTML。
    说明：
    - 仅检查字面量形式的 '#xxx'（含单引号/双引号/反引号）。
    - 对复杂选择器（如 '#a .b'）只取第一个 #id 进行校验。
    """
    html_paths = [WEB_DIR / "index.html"] + sorted((WEB_DIR / "pages").glob("*.html"))
    html_text = "\n".join(_read_text(p) for p in html_paths if p.exists())
    html_ids = set(re.findall(r'id="([A-Za-z0-9_\-:]+)"', html_text))

    js_paths = sorted((WEB_DIR / "js").glob("*.js"))
    js_text = "\n".join(_read_text(p) for p in js_paths if p.exists())

    selector_ids = set()
    # 直接匹配 querySelector('#id') / querySelectorAll("#id ...") / querySelector(`'#id'`)
    for m in re.finditer(r"querySelector(All)?\(\s*([\"'`])([^\"'`]+)\2\s*\)", js_text):
        selector = m.group(3)
        id_m = re.search(r"#([A-Za-z0-9_\-:]+)", selector)
        if id_m:
            selector_ids.add(id_m.group(1))

    missing = sorted([i for i in selector_ids if i not in html_ids])
    details: list[str] = []
    if missing:
        details.append(f"querySelector/querySelectorAll 引用但未在 HTML 中找到的 #id: {missing}")
        return AuditResult(False, "querySelector #id 覆盖检查", details)

    details.append(f"发现 {len(selector_ids)} 个静态 #id 选择器，覆盖检查通过")
    return AuditResult(True, "querySelector #id 覆盖检查", details)


def check_map_keys_vs_navigation() -> AuditResult:
    """
    交叉检查：
    - PAGE_MODULE_MAP / PAGE_INIT_MAP 的 key 是否存在于导航 data-page 中
    - 导航里以 tool- 开头的页面是否至少出现在 PAGE_MODULE_MAP 或 PAGE_INIT_MAP 中
    说明：这类不一定是错误（例如工具无需模块映射），但很容易暴露“拼写不一致/历史残留”。
    """
    index_path = WEB_DIR / "index.html"
    html = _read_text(index_path)
    nav_pages = extract_nav_pages(html)

    core_path = WEB_DIR / "js" / "app_core.js"
    core = _read_text(core_path)
    init_map = parse_page_init_map(core)
    module_map = parse_page_module_map(core)

    details: list[str] = []

    init_keys = set(init_map.keys())
    module_keys = set(module_map.keys())

    extra_init = sorted([k for k in init_keys if k not in nav_pages])
    extra_module = sorted([k for k in module_keys if k not in nav_pages])

    if extra_init:
        details.append(f"PAGE_INIT_MAP 中存在但导航未出现的 page key（可能是历史残留/拼写不一致）: {extra_init}")
    if extra_module:
        details.append(f"PAGE_MODULE_MAP 中存在但导航未出现的 page key（可能是历史残留/拼写不一致）: {extra_module}")

    tool_nav = sorted([p for p in nav_pages if p.startswith("tool-")])
    uncovered = []
    for p in tool_nav:
        if p not in init_keys and p not in module_keys:
            uncovered.append(p)
    if uncovered:
        details.append(f"导航中的工具页未出现在 PAGE_INIT_MAP/PAGE_MODULE_MAP（不一定错，但建议确认是否忘记登记）: {uncovered}")

    if not details:
        details.append("PAGE_INIT_MAP/PAGE_MODULE_MAP 与导航 data-page 的交叉关系无异常")

    # 该项默认只做提示，不作为硬失败（避免误伤“无需登记”的页面）
    return AuditResult(True, "映射表与导航交叉检查", details)


def run_all() -> list[AuditResult]:
    results: list[AuditResult] = []
    results.append(check_index_shell())
    results.append(check_page_fragments())
    results.append(check_page_init_map())
    results.append(check_inline_handlers_defined())
    results.append(check_page_module_map_defined())
    results.append(check_dom_id_coverage())
    results.append(check_queryselector_id_coverage())
    results.append(check_map_keys_vs_navigation())
    return results


def main() -> int:
    results = run_all()
    failed = [r for r in results if not r.ok]

    print("=== 前端拆分回归审计（静态检查）===\n")
    for r in results:
        status = "✓ 通过" if r.ok else "✗ 失败"
        print(f"[{status}] {r.title}")
        for d in r.details:
            print(f"  - {d}")
        print()

    if failed:
        print(f"结论：存在 {len(failed)} 项失败，请优先修复。")
        return 1

    print("结论：全部静态检查通过。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
