"""
SQLite 数据库管理模块
统一管理所有数据的增删改查操作
"""
import sqlite3
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime
import logging
import shutil

logger = logging.getLogger(__name__)


class DatabaseManager:
    """数据库管理器"""

    VERSION = "1.0.0"

    def __init__(self, db_path: Path):
        """
        初始化数据库管理器

        Args:
            db_path: 数据库文件路径
        """
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_database()

    def _get_connection(self) -> sqlite3.Connection:
        """获取数据库连接"""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row  # 返回字典格式
        conn.execute("PRAGMA foreign_keys = ON")  # 启用外键约束
        return conn

    def _init_database(self):
        """初始化数据库表结构"""
        conn = self._get_connection()
        cursor = conn.cursor()

        try:
            # 1. 应用配置表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS app_config (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # 2. AI Provider 表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS ai_providers (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    name TEXT NOT NULL,
                    enabled INTEGER DEFAULT 1,
                    config TEXT NOT NULL,
                    capabilities TEXT,
                    stats TEXT,
                    compatibility TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_ai_providers_enabled
                ON ai_providers(enabled)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_ai_providers_type
                ON ai_providers(type)
            """)

            # 3. 工具 AI 配置表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS tool_ai_config (
                    tool_id TEXT PRIMARY KEY,
                    enabled INTEGER DEFAULT 1,
                    features TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # 4. HTTP 请求集合表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS http_collections (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    parent_id TEXT,
                    type TEXT DEFAULT 'folder',
                    data TEXT,
                    order_index INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_http_collections_parent
                ON http_collections(parent_id)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_http_collections_type
                ON http_collections(type)
            """)

            # 5. 电脑使用命令表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS computer_commands (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT,
                    commands TEXT NOT NULL,
                    tab_id TEXT NOT NULL,
                    order_index INTEGER DEFAULT 0,
                    tags TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_computer_commands_tab
                ON computer_commands(tab_id)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_computer_commands_order
                ON computer_commands(order_index)
            """)

            # 6. 命令标签页表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS command_tabs (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    order_index INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_command_tabs_order
                ON command_tabs(order_index)
            """)

            # 7. 凭据管理表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS credentials (
                    id TEXT PRIMARY KEY,
                    service TEXT NOT NULL,
                    url TEXT,
                    account TEXT,
                    password TEXT,
                    extra TEXT,
                    order_index INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_credentials_service
                ON credentials(service)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_credentials_order
                ON credentials(order_index)
            """)

            # 8. 转化节点表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS conversion_nodes (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    category TEXT,
                    order_index INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_conversion_nodes_category
                ON conversion_nodes(category)
            """)

            # 9. 活跃配置表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS active_config (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # 10. 数据库元信息表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS db_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # 11. 聊天会话表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    mode TEXT NOT NULL DEFAULT 'chat',
                    provider_id TEXT,
                    system_prompt TEXT,
                    message_count INTEGER NOT NULL DEFAULT 0,
                    last_message_at TIMESTAMP,
                    pinned INTEGER NOT NULL DEFAULT 0,
                    archived INTEGER NOT NULL DEFAULT 0,
                    metadata TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_chat_sessions_last_message
                ON chat_sessions(last_message_at DESC)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_chat_sessions_archived
                ON chat_sessions(archived)
            """)

            # 12. 聊天消息表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    content_type TEXT DEFAULT 'text/markdown',
                    sequence INTEGER NOT NULL,
                    provider_id TEXT,
                    token_count INTEGER,
                    meta TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_chat_messages_session_seq
                ON chat_messages(session_id, sequence)
            """)

            # 13. Prompt 模板分类表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS prompt_categories (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    icon TEXT,
                    order_index INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_prompt_categories_order
                ON prompt_categories(order_index)
            """)

            # 14. Prompt 模板表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS prompt_templates (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    category_id TEXT,
                    description TEXT,
                    tags TEXT,
                    variables TEXT,
                    is_favorite INTEGER DEFAULT 0,
                    is_system INTEGER DEFAULT 0,
                    usage_count INTEGER DEFAULT 0,
                    order_index INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(category_id) REFERENCES prompt_categories(id) ON DELETE SET NULL
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_prompt_templates_category
                ON prompt_templates(category_id)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_prompt_templates_favorite
                ON prompt_templates(is_favorite)
            """)

            # 设置数据库版本
            cursor.execute("""
                INSERT OR REPLACE INTO db_metadata (key, value, updated_at)
                VALUES ('version', ?, ?)
            """, (self.VERSION, datetime.now().isoformat()))

            conn.commit()
            logger.info(f"数据库初始化成功: {self.db_path}")

        except Exception as e:
            conn.rollback()
            logger.error(f"数据库初始化失败: {e}")
            raise
        finally:
            conn.close()

    # ========== 通用增删改查方法 ==========

    def execute_query(self, query: str, params: tuple = ()) -> List[Dict[str, Any]]:
        """
        执行查询并返回结果

        Args:
            query: SQL 查询语句
            params: 查询参数

        Returns:
            查询结果列表
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(query, params)
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def execute_update(self, query: str, params: tuple = ()) -> int:
        """
        执行更新操作（INSERT/UPDATE/DELETE）

        Args:
            query: SQL 更新语句
            params: 更新参数

        Returns:
            影响的行数
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(query, params)
            conn.commit()
            return cursor.rowcount
        except Exception as e:
            conn.rollback()
            logger.error(f"执行更新失败: {e}")
            raise
        finally:
            conn.close()

    def insert(self, table: str, data: Dict[str, Any]) -> bool:
        """
        插入数据

        Args:
            table: 表名
            data: 数据字典

        Returns:
            是否成功
        """
        # 获取表的列信息
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(f"PRAGMA table_info({table})")
        columns = {row[1] for row in cursor.fetchall()}
        conn.close()

        # 只在表有时间戳字段时才添加
        if 'created_at' in columns and 'created_at' not in data:
            data['created_at'] = datetime.now().isoformat()
        if 'updated_at' in columns and 'updated_at' not in data:
            data['updated_at'] = datetime.now().isoformat()

        # JSON 字段处理
        data = self._serialize_json_fields(data)

        columns = ', '.join(data.keys())
        placeholders = ', '.join(['?' for _ in data])
        query = f"INSERT INTO {table} ({columns}) VALUES ({placeholders})"

        try:
            self.execute_update(query, tuple(data.values()))
            return True
        except Exception as e:
            logger.error(f"插入数据失败 (table={table}): {e}")
            return False

    def update(self, table: str, data: Dict[str, Any], where: str, params: tuple = ()) -> bool:
        """
        更新数据

        Args:
            table: 表名
            data: 更新的数据字典
            where: WHERE 条件
            params: WHERE 参数

        Returns:
            是否成功
        """
        # 自动更新时间戳
        data['updated_at'] = datetime.now().isoformat()

        # JSON 字段处理
        data = self._serialize_json_fields(data)

        set_clause = ', '.join([f"{k} = ?" for k in data.keys()])
        query = f"UPDATE {table} SET {set_clause} WHERE {where}"

        try:
            self.execute_update(query, tuple(data.values()) + params)
            return True
        except Exception as e:
            logger.error(f"更新数据失败 (table={table}): {e}")
            return False

    def delete(self, table: str, where: str, params: tuple = ()) -> bool:
        """
        删除数据

        Args:
            table: 表名
            where: WHERE 条件
            params: WHERE 参数

        Returns:
            是否成功
        """
        query = f"DELETE FROM {table} WHERE {where}"

        try:
            self.execute_update(query, params)
            return True
        except Exception as e:
            logger.error(f"删除数据失败 (table={table}): {e}")
            return False

    def get_by_id(self, table: str, id_value: str, id_column: str = 'id') -> Optional[Dict[str, Any]]:
        """
        根据 ID 获取单条记录

        Args:
            table: 表名
            id_value: ID 值
            id_column: ID 列名

        Returns:
            记录字典或 None
        """
        query = f"SELECT * FROM {table} WHERE {id_column} = ?"
        results = self.execute_query(query, (id_value,))

        if results:
            return self._deserialize_json_fields(results[0])
        return None

    def get_all(self, table: str, where: str = "", params: tuple = (),
                order_by: str = None) -> List[Dict[str, Any]]:
        """
        获取所有记录

        Args:
            table: 表名
            where: WHERE 条件
            params: WHERE 参数
            order_by: 排序条件（None 则自动检测）

        Returns:
            记录列表
        """
        # 自动检测排序字段
        if order_by is None:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(f"PRAGMA table_info({table})")
            columns = {row[1] for row in cursor.fetchall()}
            conn.close()

            if 'order_index' in columns:
                order_by = "order_index ASC"
            elif 'created_at' in columns:
                order_by = "created_at DESC"
            else:
                order_by = ""

        query = f"SELECT * FROM {table}"
        if where:
            query += f" WHERE {where}"
        if order_by:
            query += f" ORDER BY {order_by}"

        results = self.execute_query(query, params)
        return [self._deserialize_json_fields(row) for row in results]

    # ========== JSON 序列化/反序列化 ==========

    def _serialize_json_fields(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """将字典/列表字段序列化为 JSON 字符串"""
        result = {}
        for key, value in data.items():
            if isinstance(value, (dict, list)):
                result[key] = json.dumps(value, ensure_ascii=False)
            else:
                result[key] = value
        return result

    def _deserialize_json_fields(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """将 JSON 字符串字段反序列化为字典/列表"""
        result = dict(data)
        json_fields = ['config', 'capabilities', 'stats', 'compatibility',
                      'features', 'data', 'commands', 'tags', 'extra', 'meta', 'metadata', 'variables']

        for field in json_fields:
            if field in result and isinstance(result[field], str):
                try:
                    result[field] = json.loads(result[field])
                except (json.JSONDecodeError, TypeError):
                    pass

        return result

    # ========== 备份和恢复 ==========

    def backup(self, backup_path: Path) -> bool:
        """
        备份数据库

        Args:
            backup_path: 备份文件路径

        Returns:
            是否成功
        """
        try:
            backup_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(self.db_path, backup_path)
            logger.info(f"数据库备份成功: {backup_path}")
            return True
        except Exception as e:
            logger.error(f"数据库备份失败: {e}")
            return False

    def restore(self, backup_path: Path) -> bool:
        """
        从备份恢复数据库

        Args:
            backup_path: 备份文件路径

        Returns:
            是否成功
        """
        try:
            if not backup_path.exists():
                raise FileNotFoundError(f"备份文件不存在: {backup_path}")

            # 先备份当前数据库
            current_backup = self.db_path.parent / f"{self.db_path.stem}_before_restore.db"
            shutil.copy2(self.db_path, current_backup)

            # 恢复备份
            shutil.copy2(backup_path, self.db_path)
            logger.info(f"数据库恢复成功: {backup_path}")
            return True
        except Exception as e:
            logger.error(f"数据库恢复失败: {e}")
            return False

    def export_to_sql(self, export_path: Path) -> bool:
        """
        导出数据库为 SQL 脚本

        Args:
            export_path: 导出文件路径

        Returns:
            是否成功
        """
        try:
            conn = self._get_connection()
            export_path.parent.mkdir(parents=True, exist_ok=True)

            with open(export_path, 'w', encoding='utf-8') as f:
                for line in conn.iterdump():
                    f.write(f"{line}\n")

            conn.close()
            logger.info(f"数据库导出成功: {export_path}")
            return True
        except Exception as e:
            logger.error(f"数据库导出失败: {e}")
            return False

    def get_app_config(self, key: str, default: Any = None) -> Any:
        """
        获取应用配置

        Args:
            key: 配置键
            default: 默认值

        Returns:
            配置值（自动反序列化 JSON）
        """
        row = self.get_by_id("app_config", key, "key")
        if not row:
            return default

        value = row.get("value")
        if value is None:
            return default

        # 尝试 JSON 反序列化
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            # 如果不是 JSON，返回原始字符串
            return value

    def set_app_config(self, key: str, value: Any) -> bool:
        """
        设置应用配置

        Args:
            key: 配置键
            value: 配置值（自动序列化为 JSON）

        Returns:
            是否成功
        """
        try:
            # 统一序列化为 JSON（包括字符串）
            json_value = json.dumps(value, ensure_ascii=False)
        except (TypeError, ValueError) as e:
            logger.error(f"配置值序列化失败 (key={key}): {e}")
            return False

        # 使用 UPSERT 避免并发问题
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO app_config (key, value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP
            """, (key, json_value))
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            logger.error(f"配置写入失败 (key={key}): {e}")
            return False