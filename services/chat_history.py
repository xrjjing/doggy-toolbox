"""
聊天历史管理服务
"""
import json
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from services.db_manager import DatabaseManager

logger = logging.getLogger(__name__)


class ChatHistoryService:
    """聊天历史服务"""

    def __init__(self, db: DatabaseManager):
        if db is None:
            raise ValueError("数据库未就绪")
        self.db = db

    def create_session(
        self,
        title: Optional[str] = None,
        mode: str = "chat",
        provider_id: Optional[str] = None,
        system_prompt: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> Dict[str, Any]:
        session_id = str(uuid.uuid4())
        data = {
            "id": session_id,
            "title": title,
            "mode": mode,
            "provider_id": provider_id,
            "system_prompt": system_prompt,
            "metadata": json.dumps(metadata or {}, ensure_ascii=False),
        }
        ok = self.db.insert("chat_sessions", data)
        if not ok:
            return {"success": False, "error": "创建会话失败"}
        return {"success": True, "session": self.get_session(session_id)}

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        rows = self.db.execute_query(
            "SELECT * FROM chat_sessions WHERE id = ?",
            (session_id,),
        )
        if rows:
            return self.db._deserialize_json_fields(rows[0])
        return None

    def list_sessions(
        self,
        keyword: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        include_archived: bool = False,
    ) -> List[Dict[str, Any]]:
        where = []
        params: List[Any] = []
        if not include_archived:
            where.append("archived = 0")
        if keyword:
            where.append("title LIKE ?")
            params.append(f"%{keyword}%")
        where_sql = " AND ".join(where) if where else ""
        query = "SELECT * FROM chat_sessions"
        if where_sql:
            query += f" WHERE {where_sql}"
        query += " ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = self.db.execute_query(query, tuple(params))
        return [self.db._deserialize_json_fields(r) for r in rows]

    def update_session_title(self, session_id: str, title: str) -> bool:
        now = datetime.now().isoformat()
        rowcount = self.db.execute_update(
            "UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?",
            (title, now, session_id),
        )
        return rowcount > 0

    def set_session_archived(self, session_id: str, archived: bool) -> bool:
        now = datetime.now().isoformat()
        rowcount = self.db.execute_update(
            "UPDATE chat_sessions SET archived = ?, updated_at = ? WHERE id = ?",
            (1 if archived else 0, now, session_id),
        )
        return rowcount > 0

    def delete_session(self, session_id: str) -> Dict[str, Any]:
        rowcount = self.db.execute_update(
            "DELETE FROM chat_sessions WHERE id = ?",
            (session_id,),
        )
        return {"success": rowcount > 0, "deleted": rowcount}

    def _next_sequence(self, session_id: str) -> int:
        rows = self.db.execute_query(
            "SELECT COALESCE(MAX(sequence), 0) AS seq FROM chat_messages WHERE session_id = ?",
            (session_id,),
        )
        return int(rows[0]["seq"]) + 1 if rows else 1

    def append_message(
        self,
        session_id: str,
        role: str,
        content: str,
        provider_id: Optional[str] = None,
        content_type: str = "text/markdown",
        token_count: Optional[int] = None,
        meta: Optional[dict] = None,
    ) -> Dict[str, Any]:
        message_id = str(uuid.uuid4())
        seq = self._next_sequence(session_id)
        data = {
            "id": message_id,
            "session_id": session_id,
            "role": role,
            "content": content,
            "content_type": content_type,
            "sequence": seq,
            "provider_id": provider_id,
            "token_count": token_count,
            "meta": json.dumps(meta or {}, ensure_ascii=False),
        }
        ok = self.db.insert("chat_messages", data)
        if not ok:
            return {"success": False, "error": "写入消息失败"}

        now = datetime.now().isoformat()
        self.db.execute_update(
            "UPDATE chat_sessions SET message_count = message_count + 1, last_message_at = ?, updated_at = ? WHERE id = ?",
            (now, now, session_id),
        )

        if role == "user":
            session = self.get_session(session_id) or {}
            if not session.get("title"):
                title = content.strip().splitlines()[0][:40]
                self.update_session_title(session_id, title)

        return {"success": True, "message_id": message_id, "sequence": seq}

    def get_messages(
        self,
        session_id: str,
        limit: Optional[int] = None,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        query = "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY sequence ASC"
        params: List[Any] = [session_id]
        if limit is not None:
            query += " LIMIT ? OFFSET ?"
            params.extend([limit, offset])
        rows = self.db.execute_query(query, tuple(params))
        return [self.db._deserialize_json_fields(r) for r in rows]

    def search_messages(
        self,
        keyword: str,
        session_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        like = f"%{keyword}%"
        query = """
            SELECT m.*, s.title AS session_title
            FROM chat_messages m
            JOIN chat_sessions s ON s.id = m.session_id
            WHERE m.content LIKE ?
        """
        params: List[Any] = [like]
        if session_id:
            query += " AND m.session_id = ?"
            params.append(session_id)
        query += " ORDER BY m.created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = self.db.execute_query(query, tuple(params))
        return [self.db._deserialize_json_fields(r) for r in rows]

    def export_session_markdown(self, session_id: str, include_system: bool = False) -> str:
        session = self.get_session(session_id) or {}
        title = session.get("title") or "未命名对话"
        lines = [f"# {title}", ""]
        if session.get("created_at"):
            lines.append(f"> 创建时间：{session.get('created_at')}")
            lines.append("")
        messages = self.get_messages(session_id)
        for msg in messages:
            if not include_system and msg.get("role") == "system":
                continue
            role_name = {"user": "用户", "assistant": "助手", "system": "系统"}.get(msg.get("role"), "消息")
            lines.append(f"## {role_name}")
            lines.append("")
            lines.append(msg.get("content") or "")
            lines.append("")
        return "\n".join(lines)
