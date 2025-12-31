#!/usr/bin/env python3
"""狗狗百宝箱 - 主入口"""

import sys
import argparse
import logging
from pathlib import Path

import webview

from api import Api
from services.db_manager import DatabaseManager
from services.data_migration import DataMigration

logger = logging.getLogger(__name__)


def parse_args():
    parser = argparse.ArgumentParser(description="狗狗百宝箱")
    parser.add_argument(
        "-d", "--debug", action="store_true", help="启用调试模式（允许打开开发者工具）"
    )
    return parser.parse_args()


# 判断是否为打包环境
def is_bundled():
    return getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")


def get_base_path():
    """获取程序基础路径"""
    if is_bundled():
        return Path(sys._MEIPASS)
    return Path(__file__).parent


def get_data_dir():
    """获取数据存储目录"""
    if is_bundled():
        # 打包后使用用户主目录下的文件夹
        home = Path.home()
        data_dir = home / ".dog_toolbox"
        data_dir.mkdir(exist_ok=True)
        return data_dir
    else:
        # 开发环境使用项目目录
        return Path(__file__).parent


def main():
    args = parse_args()
    debug_mode = args.debug

    data_dir = get_data_dir()

    # 初始化数据库并执行迁移
    db_path = data_dir / "doggy_toolbox.db"
    try:
        db_manager = DatabaseManager(db_path)
        migration = DataMigration(data_dir, db_manager)

        if migration.check_migration_needed():
            logger.info("检测到 JSON 数据，开始迁移...")
            # 备份 JSON 文件
            migration.backup_json_files()
            # 执行迁移
            result = migration.migrate_all()
            if result["success"]:
                logger.info("数据迁移成功")
            else:
                logger.error(f"数据迁移失败: {result.get('message')}")
    except Exception as e:
        logger.error(f"数据库初始化失败: {e}")

    api = Api(data_dir, debug_mode=debug_mode)

    web_dir = get_base_path() / "web"
    window = webview.create_window(
        title="狗狗百宝箱",
        url=str(web_dir / "index.html"),
        js_api=api,
        width=1200,
        height=800,
        min_size=(800, 600),
        background_color="#1f2937",
        frameless=True,  # 无边框窗口，自定义标题栏
        # 只允许在标记了 .pywebview-drag-region 的区域拖拽窗口：
        # - 避免在滑动条/输入框等交互控件上拖动时“误触拖动整个窗口”
        # - 该问题在“简约模式 + 调整毛玻璃透明度滑块”场景更明显
        easy_drag=False,
        transparent=True,
    )
    api.set_window(window)  # 传递窗口引用
    # 启用本地 HTTP 服务：
    # - 允许前端通过 fetch()/XHR 加载 web/pages/* 等静态资源（避免 file:// 限制）
    # - 对"index.html 拆分为页面片段按需注入"的架构是必要条件
    webview.start(debug=debug_mode, http_server=True)
    sys.exit()


if __name__ == "__main__":
    main()
