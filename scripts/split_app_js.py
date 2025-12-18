#!/usr/bin/env python3
"""
将 web/app.js 按“功能段落”拆分为多个文件（无构建链、无 ESM import）。

拆分策略（基于 app.js 内已有的分段注释）：
- web/js/app_core.js：核心/导航/主题/毛玻璃/标题栏/错误横幅/全局状态声明等（到“凭证管理”之前）
- web/js/app_computer_usage.js：凭证/命令/页签/批量导入
- web/js/app_nodes_converter.js：节点转换 + 节点管理
- web/js/app_tools_a.js：Base64/UUID/命名/JWT/时间/日期/哈希/对称加密/对比/Base64↔Hex
- web/js/app_tools_b.js：工具函数 + URL/进制/Unicode/HMAC/RSA/字符统计/密码/JSON/文本/正则/cURL/颜色/IP/Cron/SQL
- web/js/app_tools_c.js：备份/Markdown/Git/Docker/JSON Schema/HTTP/WS/Mock/脱敏/CSV/二维码 等

注意：
1) 该脚本只做“文本切片”，不做逻辑改造；逻辑改造请在拆分后针对性修改各文件。
2) 生成文件默认覆盖同名输出，请确保已提交/备份后再执行。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Slice:
    name: str
    start_line: int  # 1-based
    end_line: int  # inclusive, 1-based
    out_path: Path


def _read_lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").splitlines(keepends=True)


def _write_slice(lines: list[str], sl: Slice) -> None:
    content = "".join(lines[sl.start_line - 1 : sl.end_line])
    sl.out_path.parent.mkdir(parents=True, exist_ok=True)
    sl.out_path.write_text(content, encoding="utf-8")


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    src = root / "web" / "app.js"
    out_dir = root / "web" / "js"

    lines = _read_lines(src)
    total = len(lines)
    if total < 100:
        print("app.js 内容过短，疑似不是目标文件，退出。")
        return 1

    # 注意：这些行号基于当前仓库 app.js 的结构分段（如变更，需要更新切片范围）
    slices = [
        Slice("app_core", 1, 557, out_dir / "app_core.js"),
        Slice("app_computer_usage", 558, 1170, out_dir / "app_computer_usage.js"),
        Slice("app_nodes_converter", 1171, 1320, out_dir / "app_nodes_converter.js"),
        Slice("app_tools_a", 1321, 2728, out_dir / "app_tools_a.js"),
        Slice("app_tools_b", 2729, 4832, out_dir / "app_tools_b.js"),
        Slice("app_tools_c", 4833, total, out_dir / "app_tools_c.js"),
    ]

    for sl in slices:
        if sl.start_line < 1 or sl.end_line > total or sl.start_line > sl.end_line:
            raise ValueError(f"切片范围非法: {sl}")
        _write_slice(lines, sl)

    print(f"已拆分 app.js -> {out_dir}（共 {len(slices)} 个文件）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

