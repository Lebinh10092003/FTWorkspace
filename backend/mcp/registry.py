from __future__ import annotations

import inspect
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional


@dataclass
class MCPTool:
    name: str
    description: str
    module: str  # Phân hệ: digital-training, examination, work-schedule, attendance, finance-report, account-management, documents, social-dashboard, system, auth
    handler: Callable
    parameters: Dict[str, Any]  # JSON Schema for parameters
    min_role: Optional[str] = "EMPLOYEE"  # VIEWER, EMPLOYEE, MANAGER, ADMIN
    require_finance: bool = False
    audit_action: Optional[str] = None  # Tên hành động ghi log audit nếu tool này thay đổi dữ liệu
    requires_auth: bool = True  # Nếu False thì có thể gọi không cần đăng nhập trước (ví dụ: auth_login)
    title: Optional[str] = None  # Tên ngắn hiển thị trong client MCP
    destructive: Optional[bool] = None  # True: xóa/thu hồi dữ liệu, client nên hỏi xác nhận

    @property
    def read_only(self) -> bool:
        return not self.audit_action

    @property
    def is_destructive(self) -> bool:
        if self.destructive is not None:
            return self.destructive
        return any(word in self.name for word in ("delete", "revoke", "remove"))

    def annotations(self) -> Dict[str, Any]:
        """Gợi ý hành vi theo đặc tả MCP (2025-03-26+) để client biết khi nào cần hỏi xác nhận."""
        hints: Dict[str, Any] = {
            "readOnlyHint": self.read_only,
            "openWorldHint": False,
        }
        if not self.read_only:
            hints["destructiveHint"] = self.is_destructive
        if self.title:
            hints["title"] = self.title
        return hints

    def to_mcp_format(self) -> Dict[str, Any]:
        """Định dạng theo đặc tả Model Context Protocol (MCP)."""
        payload = {
            "name": self.name,
            "description": f"[{self.module.upper()}] {self.description}",
            "inputSchema": self.parameters,
            "annotations": self.annotations(),
        }
        if self.title:
            payload["title"] = self.title
        return payload

    def to_openapi_operation(self) -> Dict[str, Any]:
        """Định dạng theo OpenAPI 3.1 dùng cho ChatGPT Custom GPT Actions."""
        has_required = bool(self.parameters.get("required"))
        op: Dict[str, Any] = {
            "summary": self.description[:100],
            "description": f"Phân hệ: {self.module}. Quyền tối thiểu: {self.min_role}. {self.description}",
            "operationId": self.name,
            "requestBody": {
                "required": has_required,
                "content": {
                    "application/json": {
                        "schema": self.parameters,
                    }
                },
            },
            "responses": {
                "200": {
                    "description": "Thành công",
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "properties": {
                                    "success": {"type": "boolean"},
                                    "data": {"type": "object"},
                                    "message": {"type": "string"},
                                },
                            }
                        }
                    },
                },
                "401": {
                    "description": "Chưa xác thực (Authentication Required)",
                },
                "403": {
                    "description": "Từ chối quyền truy cập (Permission Denied)",
                },
            },
        }

        # Nếu tool này không bắt buộc auth trước (như auth_login)
        if not self.requires_auth:
            op["security"] = []

        return op


class ToolRegistry:
    _instance = None
    _tools: Dict[str, MCPTool] = {}

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._tools = {}
        return cls._instance

    @classmethod
    def register(
        cls,
        name: str,
        description: str,
        module: str,
        parameters: Dict[str, Any],
        min_role: Optional[str] = "EMPLOYEE",
        require_finance: bool = False,
        audit_action: Optional[str] = None,
        requires_auth: bool = True,
        title: Optional[str] = None,
        destructive: Optional[bool] = None,
    ):
        def decorator(func: Callable):
            tool = MCPTool(
                name=name,
                description=description,
                module=module,
                handler=func,
                parameters=parameters,
                min_role=min_role,
                require_finance=require_finance,
                audit_action=audit_action,
                requires_auth=requires_auth,
                title=title,
                destructive=destructive,
            )
            registry = cls()
            registry._tools[name] = tool
            return func

        return decorator

    @classmethod
    def get_tool(cls, name: str) -> Optional[MCPTool]:
        return cls()._tools.get(name)

    @classmethod
    def list_all_tools(cls) -> List[MCPTool]:
        return list(cls()._tools.values())

    @classmethod
    def export_mcp_tools(cls) -> List[Dict[str, Any]]:
        return [tool.to_mcp_format() for tool in cls()._tools.values()]

    @classmethod
    def export_openapi_spec(cls, server_url: str = "/api/mcp") -> Dict[str, Any]:
        """Tạo lược đồ OpenAPI 3.1 hoàn chỉnh cho toàn bộ các Tools để nạp vào ChatGPT Web."""
        paths: Dict[str, Any] = {}
        for name, tool in cls()._tools.items():
            path_key = f"/action/{name}"
            paths[path_key] = {
                "post": tool.to_openapi_operation(),
            }

        return {
            "openapi": "3.1.0",
            "info": {
                "title": "FTWorkspace Unified MCP & AI Actions API",
                "description": "Giao tiếp toàn diện với hệ sinh thái FTWorkspace (Khảo thí, CRM Công nghệ, Lịch công tác, Chấm công, Thu chi, Hành chính) xác thực bằng Mã kết nối AI (ft_ai_...).",
                "version": "1.0.0",
            },
            "servers": [
                {
                    "url": server_url,
                    "description": "FTWorkspace MCP Gateway",
                }
            ],
            "paths": paths,
            "components": {
                "securitySchemes": {
                    "BasicAuth": {
                        "type": "http",
                        "scheme": "basic",
                        "description": "Nhập Mã kết nối AI (ft_ai_...) vào ô username hoặc password. Không dùng mật khẩu tài khoản.",
                    },
                    "BearerAuth": {
                        "type": "http",
                        "scheme": "bearer",
                        "description": "Mã kết nối AI ft_ai_... tạo ở Hồ sơ cá nhân > Trợ lý AI & MCP.",
                    },
                }
            },
            "security": [
                {"BasicAuth": []},
                {"BearerAuth": []},
            ],
        }


register_tool = ToolRegistry.register
