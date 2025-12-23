"""
数据迁移模块
负责将 JSON 数据迁移到 SQLite 数据库
"""
import json
import logging
from pathlib import Path
from typing import Dict, List, Any
from datetime import datetime
import uuid

from services.db_manager import DatabaseManager

logger = logging.getLogger(__name__)


class DataMigration:
    """数据迁移器"""

    def __init__(self, data_dir: Path, db_manager: DatabaseManager):
        """
        初始化数据迁移器

        Args:
            data_dir: 数据目录
            db_manager: 数据库管理器
        """
        self.data_dir = data_dir
        self.db = db_manager
        self.migration_log = []

    def check_migration_needed(self) -> bool:
        """
        检查是否需要迁移

        Returns:
            是否需要迁移
        """
        # 检查数据库是否已有数据
        metadata = self.db.get_by_id('db_metadata', 'migrated', 'key')
        if metadata and metadata['value'] == 'true':
            logger.info("数据已迁移，跳过迁移流程")
            return False

        # 检查是否有 JSON 文件存在
        json_files = [
            self.data_dir / "config.json",
            self.data_dir / "AI配置" / "providers.json",
            self.data_dir / "AI配置" / "tool_ai_config.json",
            self.data_dir / "HTTP请求" / "collections.json",
            self.data_dir / "电脑使用" / "commands.json",
            self.data_dir / "电脑使用" / "command_tabs.json",
            self.data_dir / "电脑使用" / "credentials.json",
        ]

        has_json = any(f.exists() for f in json_files)
        logger.info(f"检测到 JSON 文件: {has_json}")
        return has_json

    def migrate_all(self) -> Dict[str, Any]:
        """
        迁移所有数据

        Returns:
            迁移结果
        """
        if not self.check_migration_needed():
            return {
                'success': True,
                'message': '无需迁移',
                'migrated': []
            }

        logger.info("开始数据迁移...")
        self.migration_log = []

        try:
            # 1. 迁移应用配置
            self._migrate_app_config()

            # 2. 迁移 AI Provider
            self._migrate_ai_providers()

            # 3. 迁移工具 AI 配置
            self._migrate_tool_ai_config()

            # 4. 迁移 HTTP 请求集合
            self._migrate_http_collections()

            # 5. 迁移电脑使用命令
            self._migrate_computer_commands()

            # 6. 迁移命令标签页
            self._migrate_command_tabs()

            # 7. 迁移凭据
            self._migrate_credentials()

            # 8. 迁移转化节点
            self._migrate_conversion_nodes()

            # 标记迁移完成
            self.db.insert('db_metadata', {
                'key': 'migrated',
                'value': 'true'
            })

            logger.info("数据迁移完成")
            return {
                'success': True,
                'message': '迁移成功',
                'migrated': self.migration_log
            }

        except Exception as e:
            logger.error(f"数据迁移失败: {e}")
            return {
                'success': False,
                'message': f'迁移失败: {str(e)}',
                'migrated': self.migration_log
            }

    def _migrate_app_config(self):
        """迁移应用配置"""
        config_file = self.data_dir / "config.json"
        if not config_file.exists():
            logger.info("跳过应用配置迁移（文件不存在）")
            return

        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                config = json.load(f)

            for key, value in config.items():
                self.db.insert('app_config', {
                    'key': key,
                    'value': str(value)
                })

            self.migration_log.append('应用配置')
            logger.info("应用配置迁移完成")

        except Exception as e:
            logger.error(f"应用配置迁移失败: {e}")

    def _migrate_ai_providers(self):
        """迁移 AI Provider"""
        providers_file = self.data_dir / "AI配置" / "providers.json"
        if not providers_file.exists():
            logger.info("跳过 AI Provider 迁移（文件不存在）")
            return

        try:
            with open(providers_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            providers = data.get('providers', [])
            for provider in providers:
                self.db.insert('ai_providers', {
                    'id': provider.get('id'),
                    'type': provider.get('type'),
                    'name': provider.get('name'),
                    'enabled': 1 if provider.get('enabled', True) else 0,
                    'config': provider.get('config', {}),
                    'capabilities': provider.get('capabilities', {}),
                    'stats': provider.get('stats', {}),
                    'compatibility': provider.get('compatibility')
                })

            # 迁移活跃的 Provider
            active_provider = data.get('active_provider')
            if active_provider:
                self.db.insert('active_config', {
                    'key': 'active_ai_provider',
                    'value': active_provider
                })

            self.migration_log.append('AI Provider')
            logger.info(f"AI Provider 迁移完成 ({len(providers)} 条)")

        except Exception as e:
            logger.error(f"AI Provider 迁移失败: {e}")

    def _migrate_tool_ai_config(self):
        """迁移工具 AI 配置"""
        config_file = self.data_dir / "AI配置" / "tool_ai_config.json"
        if not config_file.exists():
            logger.info("跳过工具 AI 配置迁移（文件不存在）")
            return

        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            # 迁移全局开关
            global_enabled = data.get('global_enabled', True)
            self.db.insert('active_config', {
                'key': 'tool_ai_global_enabled',
                'value': 'true' if global_enabled else 'false'
            })

            # 迁移工具配置
            tools = data.get('tools', {})
            for tool_id, tool_config in tools.items():
                self.db.insert('tool_ai_config', {
                    'tool_id': tool_id,
                    'enabled': 1 if tool_config.get('enabled', True) else 0,
                    'features': tool_config.get('features', {})
                })

            self.migration_log.append('工具 AI 配置')
            logger.info(f"工具 AI 配置迁移完成 ({len(tools)} 条)")

        except Exception as e:
            logger.error(f"工具 AI 配置迁移失败: {e}")

    def _migrate_http_collections(self):
        """迁移 HTTP 请求集合"""
        collections_file = self.data_dir / "HTTP请求" / "collections.json"
        if not collections_file.exists():
            logger.info("跳过 HTTP 请求集合迁移（文件不存在）")
            return

        try:
            with open(collections_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            collections = data.get('collections', [])
            self._migrate_collections_recursive(collections)

            self.migration_log.append('HTTP 请求集合')
            logger.info(f"HTTP 请求集合迁移完成 ({len(collections)} 条)")

        except Exception as e:
            logger.error(f"HTTP 请求集合迁移失败: {e}")

    def _migrate_collections_recursive(self, collections: List[Dict], parent_id: str = None, order: int = 0):
        """递归迁移请求集合（支持嵌套）"""
        for idx, item in enumerate(collections):
            item_id = item.get('id', str(uuid.uuid4()))

            # 判断类型：如果有 'method' 字段，则为请求；否则为文件夹
            is_request = 'method' in item
            item_type = 'request' if is_request else 'folder'

            # 准备数据
            data = {
                'id': item_id,
                'name': item.get('name', ''),
                'description': item.get('description', ''),
                'parent_id': parent_id,
                'type': item_type,
                'order_index': order + idx
            }

            # 如果是请求，保存完整数据
            if is_request:
                data['data'] = item

            self.db.insert('http_collections', data)

            # 递归处理子项（支持多种格式）
            # 格式1：使用 'items' 字段（Postman 导入格式）
            if 'items' in item:
                self._migrate_collections_recursive(item['items'], item_id, 0)

            # 格式2：使用 'folders' 和 'requests' 字段（原有格式）
            if 'folders' in item and item['folders']:
                self._migrate_collections_recursive(item['folders'], item_id, 0)

            if 'requests' in item and item['requests']:
                # requests 需要单独处理，因为它们是叶子节点
                for req_idx, request in enumerate(item['requests']):
                    req_id = request.get('id', str(uuid.uuid4()))
                    req_data = {
                        'id': req_id,
                        'name': request.get('name', ''),
                        'description': request.get('description', ''),
                        'parent_id': item_id,
                        'type': 'request',
                        'data': request,
                        'order_index': req_idx
                    }
                    self.db.insert('http_collections', req_data)

    def _migrate_computer_commands(self):
        """迁移电脑使用命令"""
        commands_file = self.data_dir / "电脑使用" / "commands.json"
        if not commands_file.exists():
            logger.info("跳过电脑使用命令迁移（文件不存在）")
            return

        try:
            with open(commands_file, 'r', encoding='utf-8') as f:
                commands = json.load(f)

            for cmd in commands:
                self.db.insert('computer_commands', {
                    'id': cmd.get('id'),
                    'title': cmd.get('title'),
                    'description': cmd.get('description', ''),
                    'commands': cmd.get('commands', []),
                    'tab_id': cmd.get('tab_id', '0'),
                    'order_index': cmd.get('order', 0),
                    'tags': cmd.get('tags', [])
                })

            self.migration_log.append('电脑使用命令')
            logger.info(f"电脑使用命令迁移完成 ({len(commands)} 条)")

        except Exception as e:
            logger.error(f"电脑使用命令迁移失败: {e}")

    def _migrate_command_tabs(self):
        """迁移命令标签页"""
        tabs_file = self.data_dir / "电脑使用" / "command_tabs.json"
        if not tabs_file.exists():
            logger.info("跳过命令标签页迁移（文件不存在）")
            return

        try:
            with open(tabs_file, 'r', encoding='utf-8') as f:
                tabs = json.load(f)

            for tab in tabs:
                self.db.insert('command_tabs', {
                    'id': tab.get('id'),
                    'name': tab.get('name'),
                    'order_index': tab.get('order', 0)
                })

            self.migration_log.append('命令标签页')
            logger.info(f"命令标签页迁移完成 ({len(tabs)} 条)")

        except Exception as e:
            logger.error(f"命令标签页迁移失败: {e}")

    def _migrate_credentials(self):
        """迁移凭据"""
        credentials_file = self.data_dir / "电脑使用" / "credentials.json"
        if not credentials_file.exists():
            logger.info("跳过凭据迁移（文件不存在）")
            return

        try:
            with open(credentials_file, 'r', encoding='utf-8') as f:
                credentials = json.load(f)

            for cred in credentials:
                self.db.insert('credentials', {
                    'id': cred.get('id'),
                    'service': cred.get('service'),
                    'url': cred.get('url', ''),
                    'account': cred.get('account', ''),
                    'password': cred.get('password', ''),
                    'extra': cred.get('extra', []),
                    'order_index': cred.get('order', 0)
                })

            self.migration_log.append('凭据')
            logger.info(f"凭据迁移完成 ({len(credentials)} 条)")

        except Exception as e:
            logger.error(f"凭据迁移失败: {e}")

    def _migrate_conversion_nodes(self):
        """迁移转化节点"""
        nodes_file = self.data_dir / "转化节点" / "nodes.md"
        if not nodes_file.exists():
            logger.info("跳过转化节点迁移（文件不存在）")
            return

        try:
            with open(nodes_file, 'r', encoding='utf-8') as f:
                content = f.read()

            # 解析 Markdown 文件（简单按标题分割）
            sections = self._parse_markdown_sections(content)

            for idx, section in enumerate(sections):
                node_id = str(uuid.uuid4())
                self.db.insert('conversion_nodes', {
                    'id': node_id,
                    'title': section['title'],
                    'content': section['content'],
                    'category': section.get('category', '默认'),
                    'order_index': idx
                })

            self.migration_log.append('转化节点')
            logger.info(f"转化节点迁移完成 ({len(sections)} 条)")

        except Exception as e:
            logger.error(f"转化节点迁移失败: {e}")

    def _parse_markdown_sections(self, content: str) -> List[Dict[str, str]]:
        """
        解析 Markdown 文件为节点列表

        Args:
            content: Markdown 内容

        Returns:
            节点列表
        """
        sections = []
        lines = content.split('\n')
        current_section = None

        for line in lines:
            # 检测标题（# 或 ##）
            if line.startswith('# ') or line.startswith('## '):
                if current_section:
                    sections.append(current_section)

                title = line.lstrip('#').strip()
                current_section = {
                    'title': title,
                    'content': '',
                    'category': '默认'
                }
            elif current_section:
                current_section['content'] += line + '\n'

        # 添加最后一个节点
        if current_section:
            sections.append(current_section)

        return sections

    def backup_json_files(self) -> bool:
        """
        备份所有 JSON 文件到 backup 目录

        Returns:
            是否成功
        """
        try:
            backup_dir = self.data_dir / "_json_backup" / datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_dir.mkdir(parents=True, exist_ok=True)

            json_files = [
                ("config.json", self.data_dir / "config.json"),
                ("AI配置/providers.json", self.data_dir / "AI配置" / "providers.json"),
                ("AI配置/tool_ai_config.json", self.data_dir / "AI配置" / "tool_ai_config.json"),
                ("HTTP请求/collections.json", self.data_dir / "HTTP请求" / "collections.json"),
                ("电脑使用/commands.json", self.data_dir / "电脑使用" / "commands.json"),
                ("电脑使用/command_tabs.json", self.data_dir / "电脑使用" / "command_tabs.json"),
                ("电脑使用/credentials.json", self.data_dir / "电脑使用" / "credentials.json"),
                ("转化节点/nodes.md", self.data_dir / "转化节点" / "nodes.md"),
            ]

            for rel_path, src_file in json_files:
                if src_file.exists():
                    dest_file = backup_dir / rel_path
                    dest_file.parent.mkdir(parents=True, exist_ok=True)
                    import shutil
                    shutil.copy2(src_file, dest_file)

            logger.info(f"JSON 文件备份成功: {backup_dir}")
            return True

        except Exception as e:
            logger.error(f"JSON 文件备份失败: {e}")
            return False