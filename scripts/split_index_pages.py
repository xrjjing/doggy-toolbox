#!/usr/bin/env python3
"""
将 web/index.html 内的 <section id="page-xxx">...</section> 页面片段拆分为独立文件：

- 输出目录：web/pages/
- 输出文件：web/pages/<pageKey>.html（pageKey 为 page- 后缀，如 credentials、tool-base64）

说明：
1) 该脚本用于“无构建链”场景下，把超大的 index.html 拆分成可维护的小片段文件。
2) 拆分后的 index.html 建议只保留壳结构（标题栏/侧边栏/主容器/全局弹窗等），页面内容由 JS 按需注入。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class PageBlock:
    page_key: str
    html: str


def _find_page_blocks(index_html: str) -> list[PageBlock]:
    blocks: list[PageBlock] = []
    marker = '<section id="page-'
    pos = 0
    n = len(index_html)

    while True:
        start = index_html.find(marker, pos)
        if start < 0:
            break

        # 解析 pageKey（page- 后缀到引号结束）
        key_start = start + len('<section id="page-')
        key_end = index_html.find('"', key_start)
        if key_end < 0:
            raise ValueError("无法解析 pageKey：缺少结束引号")
        page_key = index_html[key_start:key_end]

        # 找到对应的 </section>，用计数法处理可能的嵌套（正常情况下页面 section 不嵌套）
        open_count = 0
        i = start
        end = -1
        while i < n:
            next_open = index_html.find("<section", i)
            next_close = index_html.find("</section>", i)
            if next_close < 0:
                raise ValueError(f"无法找到 </section>：page={page_key}")

            if next_open != -1 and next_open < next_close:
                open_count += 1
                i = next_open + len("<section")
                continue

            # 遇到 close
            open_count -= 1
            i = next_close + len("</section>")
            if open_count == 0:
                end = i
                break

        if end < 0:
            raise ValueError(f"无法定位页面结束位置：page={page_key}")

        html = index_html[start:end].strip() + "\n"
        blocks.append(PageBlock(page_key=page_key, html=html))
        pos = end

    return blocks


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    index_path = root / "web" / "index.html"
    pages_dir = root / "web" / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)

    index_html = index_path.read_text(encoding="utf-8")
    blocks = _find_page_blocks(index_html)
    if not blocks:
        print("未找到任何 page- 页面片段，未生成文件。")
        return 1

    for block in blocks:
        out_path = pages_dir / f"{block.page_key}.html"
        header = f"<!-- 自动拆分自 web/index.html：{block.page_key} -->\n"
        out_path.write_text(header + block.html, encoding="utf-8")

    print(f"已生成 {len(blocks)} 个页面片段到: {pages_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

