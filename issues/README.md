# Issues CSV 执行规范

本仓库以 `issues/*.csv` 作为批次执行边界与状态源。每一行代表一个可交付的 issue，开发/Review/回归/提交状态都必须落盘到 CSV。

## CSV 表头（权威）

必须与实际 CSV 第一行一致：

`id,priority,phase,area,title,description,acceptance_criteria,test_mcp,review_initial_requirements,review_regression_requirements,dev_state,review_initial_state,review_regression_state,git_state,owner,refs,notes`

## 状态枚举（必须使用这些值）

- `dev_state`: `未开始|进行中|已完成`
- `review_initial_state`: `未开始|进行中|已完成`
- `review_regression_state`: `未开始|进行中|已完成`
- `git_state`: `未提交|已提交`

## `test_mcp`（验证方式）

按 issue 的可验证方式填写，常用值：

- `MANUAL`: 人工步骤（必须在 `notes` 写 `manual_test:`）
- `AUTOFRONTEND` / `AUTOSERVER` / `AUTOE2E` / `CONTRACT` / `MIGRATION`: 若项目存在对应自动化入口

如果当前环境无法运行验证（例如 headless 没有 GUI），允许“受限验收”，但必须在 `notes` 写清：

- `validation_limited:<原因>`
- `manual_test:<后续可执行的命令/步骤>`
- `evidence:<已完成的替代验证，例如 lint/typecheck/build 输出>`
- `risk:<low|medium|high> <说明>`

## `refs` 约定

- 至少包含 1 个 `path:line`（入口/关键函数），多个用 `;` 分隔。
- 例：`src/renderer/src/WorkspaceShell.tsx:1081; src/main/ipc.ts:67`

## `notes` 常用键

推荐用 `;` 分隔键值，便于回溯：

- `picked_reason:<为什么选这条先做>`
- `started_at:<YYYY-MM-DD>` / `done_at:<YYYY-MM-DD>`
- `blocked:<原因>`（阻塞时）
- `gemini_session:<id>`（如使用 Gemini 协作）

## CSV 格式要求

- 必须保持 **UTF-8 BOM**（兼容 Excel/WPS）。
- 字段内包含逗号时必须用双引号包裹（CSV 标准）。
