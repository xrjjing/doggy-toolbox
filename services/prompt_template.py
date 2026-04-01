"""Prompt 模板服务。

负责模板分类、模板内容、收藏状态、变量解析与导入导出，既支撑 prompt-templates.html，
也会被 ai-chat.html 的“模板选择器 / 变量填写弹窗”复用。
"""

import json
import logging
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from services.db_manager import DatabaseManager

logger = logging.getLogger(__name__)

# ========== 模板变量语法与内置默认数据 ==========

VARIABLE_PATTERN = re.compile(r'\{\{(\w+)(?::([^}|]+))?(?:\|([^}]+))?\}\}')

DEFAULT_CATEGORIES = [
    {"id": "cat_coding", "name": "编程开发", "icon": "</>", "order_index": 0},
    {"id": "cat_writing", "name": "写作创作", "icon": "✍️", "order_index": 1},
    {"id": "cat_translate", "name": "翻译润色", "icon": "🌐", "order_index": 2},
    {"id": "cat_analysis", "name": "分析总结", "icon": "📊", "order_index": 3},
    {"id": "cat_other", "name": "其他", "icon": "📌", "order_index": 4},
]

DEFAULT_TEMPLATES = [
    {
        "id": "tpl_code_explain",
        "title": "代码解释",
        "content": "请解释以下代码的功能和原理：\n\n```{{language:python}}\n{{code}}\n```\n\n要求：\n1. 说明代码的整体功能\n2. 逐行或逐块解释关键逻辑\n3. 指出可能的优化点",
        "category_id": "cat_coding",
        "description": "让 AI 解释代码的功能和实现原理",
        "tags": ["代码", "解释", "学习"],
        "is_system": 1,
    },
    {
        "id": "tpl_code_optimize",
        "title": "代码优化",
        "content": "请优化以下代码，重点关注{{focus|性能|可读性|安全性|全面优化}}：\n\n```{{language:python}}\n{{code}}\n```\n\n请提供优化后的代码并说明改进点。",
        "category_id": "cat_coding",
        "description": "优化代码的性能、可读性或安全性",
        "tags": ["代码", "优化", "重构"],
        "is_system": 1,
    },
    {
        "id": "tpl_bug_fix",
        "title": "Bug 修复",
        "content": "以下代码存在问题：\n\n```{{language:python}}\n{{code}}\n```\n\n错误信息：{{error}}\n\n请分析问题原因并提供修复方案。",
        "category_id": "cat_coding",
        "description": "分析代码错误并提供修复方案",
        "tags": ["代码", "Bug", "调试"],
        "is_system": 1,
    },
    {
        "id": "tpl_translate",
        "title": "中英互译",
        "content": "请将以下内容翻译成{{target_lang|中文|英文|日文}}：\n\n{{text}}\n\n要求：\n- 保持原文的语气和风格\n- 专业术语翻译准确\n- 语句通顺自然",
        "category_id": "cat_translate",
        "description": "中英文互译，保持原文风格",
        "tags": ["翻译", "中英文"],
        "is_system": 1,
    },
    {
        "id": "tpl_polish",
        "title": "文本润色",
        "content": "请润色以下文本，使其更加{{style|专业正式|简洁明了|生动有趣}}：\n\n{{text}}\n\n要求保持原意，改善表达。",
        "category_id": "cat_translate",
        "description": "改善文本表达，提升可读性",
        "tags": ["润色", "写作"],
        "is_system": 1,
    },
    {
        "id": "tpl_summary",
        "title": "文章摘要",
        "content": "请为以下内容生成摘要：\n\n{{content}}\n\n要求：\n- 摘要长度约 {{length:200}} 字\n- 提取核心观点\n- 保持客观准确",
        "category_id": "cat_analysis",
        "description": "生成文章或内容的摘要",
        "tags": ["摘要", "总结"],
        "is_system": 1,
    },
    {
        "id": "tpl_meeting_notes",
        "title": "会议纪要",
        "content": "请根据以下会议记录整理会议纪要：\n\n{{notes}}\n\n格式要求：\n1. 会议主题\n2. 参会人员\n3. 讨论要点\n4. 决议事项\n5. 待办任务",
        "category_id": "cat_analysis",
        "description": "整理会议记录为结构化纪要",
        "tags": ["会议", "纪要", "工作"],
        "is_system": 1,
    },
    {
        "id": "tpl_weekly_report",
        "title": "周报生成",
        "content": "请根据以下工作内容生成周报：\n\n本周完成：\n{{completed}}\n\n进行中：\n{{in_progress}}\n\n下周计划：\n{{next_week:待规划}}\n\n请按照标准周报格式整理。",
        "category_id": "cat_writing",
        "description": "根据工作内容生成周报",
        "tags": ["周报", "工作", "汇报"],
        "is_system": 1,
    },
    {
        "id": "tpl_sql_generate",
        "title": "SQL 生成",
        "content": "请根据以下需求生成 SQL 语句：\n\n数据库类型：{{db_type|MySQL|PostgreSQL|SQLite}}\n表结构：{{schema}}\n需求：{{requirement}}\n\n请提供完整的 SQL 语句并解释。",
        "category_id": "cat_coding",
        "description": "根据需求生成 SQL 语句",
        "tags": ["SQL", "数据库"],
        "is_system": 1,
    },
    {
        "id": "tpl_regex",
        "title": "正则表达式",
        "content": "请生成一个正则表达式，用于：{{requirement}}\n\n测试用例：\n{{test_cases:请提供测试用例}}\n\n请提供正则表达式并解释各部分含义。",
        "category_id": "cat_coding",
        "description": "根据需求生成正则表达式",
        "tags": ["正则", "匹配"],
        "is_system": 1,
    },
]


class PromptTemplateService:
    """Prompt 模板的分类、增删改查与变量处理服务。

    这个类既服务独立模板页，也服务 AI 聊天中的模板选择器和变量填充弹窗。"""

    def __init__(self, db: DatabaseManager):
        if db is None:
            raise ValueError("数据库未就绪")
        self.db = db
        self._ensure_default_data()

    def _ensure_default_data(self):
        """确保默认分类和模板存在"""
        for cat in DEFAULT_CATEGORIES:
            existing = self.db.get_by_id("prompt_categories", cat["id"])
            if not existing:
                self.db.insert("prompt_categories", cat.copy())

        for tpl in DEFAULT_TEMPLATES:
            existing = self.db.get_by_id("prompt_templates", tpl["id"])
            if not existing:
                data = tpl.copy()
                data["tags"] = json.dumps(data.get("tags", []), ensure_ascii=False)
                data["variables"] = json.dumps(self.parse_variables(data["content"]), ensure_ascii=False)
                self.db.insert("prompt_templates", data)

    # ========== 分类管理 ==========

    def list_categories(self) -> List[Dict[str, Any]]:
        return self.db.get_all("prompt_categories", order_by="order_index ASC")

    def create_category(self, name: str, icon: Optional[str] = None) -> Dict[str, Any]:
        cat_id = str(uuid.uuid4())
        max_order = self.db.execute_query(
            "SELECT COALESCE(MAX(order_index), -1) AS max_order FROM prompt_categories"
        )
        order_index = max_order[0]["max_order"] + 1 if max_order else 0
        data = {"id": cat_id, "name": name, "icon": icon, "order_index": order_index}
        ok = self.db.insert("prompt_categories", data)
        if not ok:
            return {"success": False, "error": "创建分类失败"}
        return {"success": True, "category": self.db.get_by_id("prompt_categories", cat_id)}

    def update_category(self, category_id: str, name: str, icon: Optional[str] = None) -> Dict[str, Any]:
        data = {"name": name}
        if icon is not None:
            data["icon"] = icon
        ok = self.db.update("prompt_categories", data, "id = ?", (category_id,))
        if not ok:
            return {"success": False, "error": "更新分类失败"}
        return {"success": True, "category": self.db.get_by_id("prompt_categories", category_id)}

    def delete_category(self, category_id: str) -> Dict[str, Any]:
        self.db.execute_update(
            "UPDATE prompt_templates SET category_id = NULL WHERE category_id = ?",
            (category_id,)
        )
        ok = self.db.delete("prompt_categories", "id = ?", (category_id,))
        return {"success": ok}

    def reorder_categories(self, category_ids: List[str]) -> Dict[str, Any]:
        for idx, cat_id in enumerate(category_ids):
            self.db.execute_update(
                "UPDATE prompt_categories SET order_index = ? WHERE id = ?",
                (idx, cat_id)
            )
        return {"success": True}

    # ========== 模板管理 ==========

    def list_templates(
        self,
        category_id: Optional[str] = None,
        keyword: Optional[str] = None,
        favorites_only: bool = False,
    ) -> List[Dict[str, Any]]:
        where = []
        params: List[Any] = []
        if category_id:
            where.append("category_id = ?")
            params.append(category_id)
        if keyword:
            where.append("(title LIKE ? OR description LIKE ? OR content LIKE ?)")
            like = f"%{keyword}%"
            params.extend([like, like, like])
        if favorites_only:
            where.append("is_favorite = 1")
        where_sql = " AND ".join(where) if where else ""
        return self.db.get_all("prompt_templates", where_sql, tuple(params), order_by="order_index ASC")

    def get_template(self, template_id: str) -> Optional[Dict[str, Any]]:
        return self.db.get_by_id("prompt_templates", template_id)

    def create_template(
        self,
        title: str,
        content: str,
        category_id: Optional[str] = None,
        description: Optional[str] = None,
        tags: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        tpl_id = str(uuid.uuid4())
        variables = self.parse_variables(content)
        max_order = self.db.execute_query(
            "SELECT COALESCE(MAX(order_index), -1) AS max_order FROM prompt_templates"
        )
        order_index = max_order[0]["max_order"] + 1 if max_order else 0
        data = {
            "id": tpl_id,
            "title": title,
            "content": content,
            "category_id": category_id,
            "description": description,
            "tags": json.dumps(tags or [], ensure_ascii=False),
            "variables": json.dumps(variables, ensure_ascii=False),
            "order_index": order_index,
        }
        ok = self.db.insert("prompt_templates", data)
        if not ok:
            return {"success": False, "error": "创建模板失败"}
        return {"success": True, "template": self.get_template(tpl_id)}

    def update_template(self, template_id: str, **kwargs) -> Dict[str, Any]:
        data = {}
        for key in ["title", "content", "category_id", "description"]:
            if key in kwargs:
                data[key] = kwargs[key]
        if "tags" in kwargs:
            data["tags"] = json.dumps(kwargs["tags"] or [], ensure_ascii=False)
        if "content" in kwargs:
            data["variables"] = json.dumps(self.parse_variables(kwargs["content"]), ensure_ascii=False)
        if not data:
            return {"success": False, "error": "无更新内容"}
        ok = self.db.update("prompt_templates", data, "id = ?", (template_id,))
        if not ok:
            return {"success": False, "error": "更新模板失败"}
        return {"success": True, "template": self.get_template(template_id)}

    def delete_template(self, template_id: str) -> Dict[str, Any]:
        ok = self.db.delete("prompt_templates", "id = ?", (template_id,))
        return {"success": ok}

    def toggle_favorite(self, template_id: str) -> Dict[str, Any]:
        tpl = self.get_template(template_id)
        if not tpl:
            return {"success": False, "error": "模板不存在"}
        new_val = 0 if tpl.get("is_favorite") else 1
        self.db.execute_update(
            "UPDATE prompt_templates SET is_favorite = ?, updated_at = ? WHERE id = ?",
            (new_val, datetime.now().isoformat(), template_id)
        )
        return {"success": True, "is_favorite": new_val}

    def increment_usage(self, template_id: str) -> Dict[str, Any]:
        self.db.execute_update(
            "UPDATE prompt_templates SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?",
            (datetime.now().isoformat(), template_id)
        )
        return {"success": True}

    # ========== 变量解析与填充 ==========

    @staticmethod
    # ========== 模板变量解析与内容填充 ==========
    def parse_variables(content: str) -> List[Dict[str, Any]]:
        """
        解析模板中的变量
        语法：
          {{name}}           - 基础文本变量
          {{name:default}}   - 带默认值
          {{name|opt1|opt2}} - 下拉选择
        """
        variables = []
        seen = set()
        for match in VARIABLE_PATTERN.finditer(content):
            name = match.group(1)
            if name in seen:
                continue
            seen.add(name)
            default_val = match.group(2)
            options_str = match.group(3)
            var = {"name": name, "type": "text", "default": default_val or ""}
            if options_str:
                var["type"] = "select"
                var["options"] = [opt.strip() for opt in options_str.split("|")]
                if not var["default"] and var["options"]:
                    var["default"] = var["options"][0]
            variables.append(var)
        return variables

    @staticmethod
    def fill_template(content: str, values: Dict[str, str]) -> str:
        """用给定值填充模板变量"""
        def replacer(match):
            name = match.group(1)
            default_val = match.group(2) or ""
            options_str = match.group(3)
            if name in values:
                return values[name]
            if options_str:
                opts = [opt.strip() for opt in options_str.split("|")]
                return opts[0] if opts else ""
            return default_val
        return VARIABLE_PATTERN.sub(replacer, content)

    def use_template(self, template_id: str, values: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """使用模板：增加使用次数并返回填充后的内容"""
        tpl = self.get_template(template_id)
        if not tpl:
            return {"success": False, "error": "模板不存在"}
        self.increment_usage(template_id)
        filled = self.fill_template(tpl["content"], values or {})
        return {"success": True, "content": filled, "template": tpl}

    # ========== 从消息生成模板、导入导出 ==========
    def save_as_template(
        self,
        content: str,
        title: Optional[str] = None,
        category_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """将内容保存为新模板"""
        if not title:
            title = content.strip().splitlines()[0][:30] or "未命名模板"
        return self.create_template(title=title, content=content, category_id=category_id)

    # ========== 导入导出 ==========

    def export_templates(
        self,
        template_ids: Optional[List[str]] = None,
        include_categories: bool = True,
    ) -> Dict[str, Any]:
        """
        导出模板为 JSON 格式
        Args:
            template_ids: 要导出的模板 ID 列表，为空则导出全部
            include_categories: 是否包含分类信息
        """
        if template_ids:
            templates = [self.get_template(tid) for tid in template_ids]
            templates = [t for t in templates if t]
        else:
            templates = self.list_templates()

        export_data = {
            "version": "1.0",
            "export_time": datetime.now().isoformat(),
            "templates": [],
        }

        category_ids = set()
        for tpl in templates:
            tpl_data = {
                "title": tpl.get("title"),
                "content": tpl.get("content"),
                "description": tpl.get("description"),
                "tags": tpl.get("tags") or [],
                "category_id": tpl.get("category_id"),
            }
            export_data["templates"].append(tpl_data)
            if tpl.get("category_id"):
                category_ids.add(tpl["category_id"])

        if include_categories and category_ids:
            categories = self.list_categories()
            export_data["categories"] = [
                {"id": c["id"], "name": c["name"], "icon": c.get("icon")}
                for c in categories if c["id"] in category_ids
            ]

        return {
            "success": True,
            "data": export_data,
            "json": json.dumps(export_data, ensure_ascii=False, indent=2),
        }

    def import_templates(
        self,
        import_data: Dict[str, Any],
        overwrite: bool = False,
    ) -> Dict[str, Any]:
        """
        从 JSON 数据导入模板
        Args:
            import_data: 导入的数据
            overwrite: 是否覆盖同名模板
        """
        imported_count = 0
        skipped_count = 0
        errors = []

        category_map = {}
        if "categories" in import_data:
            for cat_data in import_data["categories"]:
                old_id = cat_data.get("id")
                name = cat_data.get("name")
                if not name:
                    continue
                existing = self.db.execute_query(
                    "SELECT id FROM prompt_categories WHERE name = ?", (name,)
                )
                if existing:
                    category_map[old_id] = existing[0]["id"]
                else:
                    result = self.create_category(name, cat_data.get("icon"))
                    if result.get("success"):
                        category_map[old_id] = result["category"]["id"]

        for tpl_data in import_data.get("templates", []):
            title = tpl_data.get("title")
            content = tpl_data.get("content")
            if not title or not content:
                errors.append(f"模板缺少标题或内容")
                continue

            existing = self.db.execute_query(
                "SELECT id FROM prompt_templates WHERE title = ?", (title,)
            )

            old_cat_id = tpl_data.get("category_id")
            new_cat_id = category_map.get(old_cat_id) if old_cat_id else None

            if existing:
                if overwrite:
                    self.update_template(
                        existing[0]["id"],
                        title=title,
                        content=content,
                        description=tpl_data.get("description"),
                        tags=tpl_data.get("tags"),
                        category_id=new_cat_id,
                    )
                    imported_count += 1
                else:
                    skipped_count += 1
            else:
                result = self.create_template(
                    title=title,
                    content=content,
                    category_id=new_cat_id,
                    description=tpl_data.get("description"),
                    tags=tpl_data.get("tags"),
                )
                if result.get("success"):
                    imported_count += 1
                else:
                    errors.append(f"导入模板 '{title}' 失败")

        return {
            "success": True,
            "imported": imported_count,
            "skipped": skipped_count,
            "errors": errors,
        }
