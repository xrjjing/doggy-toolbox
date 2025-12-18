#!/usr/bin/env python3
"""
启动时间测量（准备阶段，非 GUI）

目的：
- 记录后端“启动准备阶段”的耗时，用于对比拆分/优化前后的变化。
- 不启动 GUI 主循环（不会阻塞或需要手动关闭）。

说明：
- 该测量无法覆盖 WebView 首帧渲染/前端加载时间；若要测量 GUI 启动时间，需要在真实运行时结合前端埋点。
"""

from __future__ import annotations

import time
from pathlib import Path


def _ms(s: float) -> str:
    return f"{s * 1000:.1f}ms"


def main() -> int:
    t0 = time.perf_counter()

    import webview  # noqa: F401

    t1 = time.perf_counter()

    from api import Api  # noqa: F401

    t2 = time.perf_counter()

    from services import ComputerUsageService, NodeConverterService  # noqa: F401

    t3 = time.perf_counter()

    root = Path(__file__).resolve().parent.parent
    web_dir = root / "web"
    index_html = web_dir / "index.html"
    pages_dir = web_dir / "pages"

    pages_count = len(list(pages_dir.glob("*.html"))) if pages_dir.exists() else 0
    t4 = time.perf_counter()

    api = Api(root)
    t5 = time.perf_counter()

    # 仅创建窗口对象，不启动事件循环
    _ = webview.create_window(
        title="狗狗百宝箱（启动测量）",
        url=str(index_html),
        js_api=api,
        width=1200,
        height=800,
        min_size=(800, 600),
        background_color="#1f2937",
        frameless=True,
        easy_drag=True,
        transparent=True,
    )
    t6 = time.perf_counter()

    print("=== 启动准备阶段耗时（非 GUI）===")
    print(f"导入 pywebview: {_ms(t1 - t0)}")
    print(f"导入 Api: {_ms(t2 - t1)}")
    print(f"导入 services: {_ms(t3 - t2)}")
    print(f"路径/资源检查（pages={pages_count}）: {_ms(t4 - t3)}")
    print(f"Api 初始化: {_ms(t5 - t4)}")
    print(f"create_window(): {_ms(t6 - t5)}")
    print(f"总计: {_ms(t6 - t0)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

