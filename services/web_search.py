# -*- coding: utf-8 -*-
"""
Web Search Service
使用 ddgs (DuckDuckGo Search) 提供网络搜索功能
"""

import logging
from typing import List, Dict, Any
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=2)


def _search_sync(query: str, max_results: int = 5, region: str = 'wt-wt') -> List[Dict[str, Any]]:
    """同步搜索（内部使用）"""
    try:
        from ddgs import DDGS
        import time

        for attempt in range(3):
            try:
                results = []
                with DDGS() as ddgs:
                    for r in ddgs.text(query, region=region, max_results=max_results):
                        results.append({
                            'title': r.get('title', ''),
                            'url': r.get('href', ''),
                            'snippet': r.get('body', '')
                        })

                if results:
                    return results

                if attempt < 2:
                    logger.warning(f"搜索无结果，第 {attempt + 1} 次重试...")
                    time.sleep(0.5)

            except Exception as e:
                if attempt < 2:
                    logger.warning(f"搜索出错，第 {attempt + 1} 次重试: {e}")
                    time.sleep(0.5)
                else:
                    raise

        return results

    except ImportError:
        logger.error("搜索库未安装，请运行: pip install ddgs")
        return []
    except Exception as e:
        logger.error(f"搜索失败: {e}")
        return []


async def search(query: str, max_results: int = 5, region: str = 'wt-wt') -> List[Dict[str, Any]]:
    """
    异步执行网络搜索

    Args:
        query: 搜索关键词
        max_results: 最大结果数量
        region: 搜索区域，默认 wt-wt（全球）

    Returns:
        搜索结果列表，每项包含 title, url, snippet
    """
    import asyncio
    from functools import partial
    loop = asyncio.get_event_loop()
    func = partial(_search_sync, query, max_results, region)
    return await loop.run_in_executor(_executor, func)


def format_search_results(results: List[Dict[str, Any]], max_length: int = 2000) -> str:
    """格式化搜索结果为可注入 prompt 的文本"""
    if not results:
        return ""

    lines = [
        "# 已提供的参考资料",
        "",
        "你无法实时浏览互联网，但已为你提供以下参考资料。请基于这些资料回答用户问题，如资料不足请说明。不要说「我无法搜索」或「我无法联网」。",
        ""
    ]

    for i, r in enumerate(results, 1):
        title = r.get('title', '无标题')
        url = r.get('url', '')
        snippet = r.get('snippet', '')

        if len(snippet) > 300:
            snippet = snippet[:300] + "..."

        lines.append(f"**资料 {i}**: {title}")
        if url:
            lines.append(f"来源: {url}")
        if snippet:
            lines.append(f"内容: {snippet}")
        lines.append("")

    text = "\n".join(lines)

    # 如果超过最大长度，截断
    if len(text) > max_length:
        text = text[:max_length] + "\n...(搜索结果已截断)"

    return text


def extract_search_query(user_message: str) -> str:
    """
    从用户消息中提取搜索关键词
    简单实现：直接使用用户消息，去除常见的搜索指令词

    Args:
        user_message: 用户原始消息

    Returns:
        提取后的搜索关键词
    """
    # 去除常见的搜索指令词
    remove_phrases = [
        '搜索一下', '搜一下', '帮我搜', '帮我查', '查一下', '查询一下',
        '请搜索', '请查询', '网上搜', '上网查', '百度一下', '谷歌一下',
        'search for', 'search', 'look up', 'find'
    ]

    query = user_message.strip()
    for phrase in remove_phrases:
        query = query.replace(phrase, '')

    return query.strip()
