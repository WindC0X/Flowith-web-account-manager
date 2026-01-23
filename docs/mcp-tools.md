# MCP Tools（环境快照）

Generated: 2026-01-23

说明：本文件用于记录 **当前 Codex 运行环境** 中可用的 MCP server/tool 名称，便于在 Issue CSV 的 `notes` 或协作流程中引用。不同机器/Runner 的可用 MCP 可能不同，请以实际环境输出为准。

## Servers / Tools

### augment-context-engine-mcp

- `codebase-retrieval` — 语义检索代码库（用于快速定位文件/符号/调用链）

### context7

- `resolve-library-id` — 解析库名为 Context7 的 libraryId
- `query-docs` — 查询库文档片段（需要先 resolve 或直接使用 libraryId）

### exa

- `exa_search` — Web 搜索（用于外部资料检索）

### mcp-deepwiki

- `deepwiki_fetch` — 拉取 deepwiki.com 仓库内容（内部规范/约定/文档）

### shadcn

- `get_add_command_for_items`
- `get_audit_checklist`
- `get_item_examples_from_registries`
- `get_project_registries`
- `list_items_in_registries`
- `search_items_in_registries`
- `view_items_in_registries`

## 再生成建议

如果你使用 Codex CLI，建议以 `codex mcp list`（或仓库内技能 `mcp-tools-catalog`）重新生成/校验本文件，并更新 Generated 日期。
