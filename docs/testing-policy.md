# Testing Policy（与 Issue CSV 对齐）

本仓库的验证策略以 `issues/*.csv` 为准：每条 issue 必须能被验证（自动化或可复现的手工步骤），并把验证过程与证据落盘到该行字段。

## 每条 issue 必填项

- `acceptance_criteria`: 可验证的验收口径（最好包含触发步骤与预期）
- `test_mcp`: 验证方式（例如 `MANUAL` / `AUTOFRONTEND` / `AUTOSERVER` / `AUTOE2E` / `CONTRACT` / `MIGRATION`）
- `review_initial_requirements`: 实现完成后的自查/Review 清单
- `review_regression_requirements`: 回归点（避免功能回退）
- 状态字段：`dev_state` / `review_initial_state` / `review_regression_state` / `git_state`

## 推荐的最小验证（本项目）

优先跑与改动最相关的命令，再扩大到 build：

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

UI/交互类变更若无稳定 E2E，允许 `test_mcp=MANUAL`，但必须给出可复现清单：

- 在该行 `notes` 写 `manual_test:<命令 + 步骤>`

## 受限验收（允许，但必须写清风险）

当环境限制导致无法运行关键验证（例如 headless 无法完成 Electron GUI 冒烟）时，允许将 `review_regression_state` 标记为 `已完成`，但该行 `notes` 必须包含：

- `validation_limited:<原因>`
- `manual_test:<后续可执行的命令/步骤>`
- `evidence:<替代证据，例如 lint/typecheck/build 输出>`
- `risk:<low|medium|high> <说明>`
