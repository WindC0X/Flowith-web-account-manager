# Change: Add Flowith Web Account Manager (Desktop MVP)

## Why
用户只能通过文本形式交付 `refresh_token`（无账号密码、无可用的 Google OAuth），但仍希望在桌面端低成本使用 Flowith Web，并满足：
- 多平台（Windows/macOS/Linux）；
- 多账号并行（标签式 Tabs 打开多个账号）；
- 国内网络环境下需兼容代理（系统代理 / TUN / 应用内自定义代理）；
- token 的导入/导出与账号信息展示（订阅、积分等）。

## What Changes
- 新增桌面应用形态的 **Workspace（单页主界面）**：
  - 左侧账号列表 + 搜索/过滤；
  - 中间 Tabs 工作区（每账号一个 Tab，独立会话隔离）；
  - 右侧账号详情（显示名、标签、订阅/积分、网络与 UA 设置）。
- UI 参照并尽量复用现有 Demo UI：
  - 以 `\"docs/ui-demo-flowith-web-account-manager.html\"` 的布局层级与视觉 tokens 为基准（Topbar / Sidebar / Tabs Workspace / Inspector / Import&Export Dialog）；
  - 实际产品以 React 组件实现，但结构/交互保持一致，减少“重做 UI”与学习成本。
- token 导入/导出（仅 refresh_token）：
  - 导入：支持一行一个 `refresh_token`，逐条校验（刷新 Supabase session）并落库；
  - 导出：仅在用户显式操作时导出选中账号的 token（每行一个），默认不自动复制，不在日志中暴露。
- token 驱动的 Web 登录态注入：
  - 打开账号 Tab 时，用 refresh_token 刷新 session；
  - 将登录态写入该账号 Web partition 的存储，并 reload 使 `\"https://flowith.io\"` 自动登录。
- per-account 网络与指纹（固定一套，可更换）：
  - 代理模式：`system` / `custom` / `direct`；
  - User-Agent：预设 + 自定义；
  - 连通性检测：对 Flowith Web / edge / supabase/worker（如适用）提供 OK/FAIL 与延迟。
- UI 偏好设置：
  - 黑/白主题；
  - 中英文（i18n）；
  - 侧边栏折叠、账号列表视图（卡片/列表）等偏好持久化。

## Non-goals
- 不实现 flowithOS 相关联动（写入 flowithOS session / OS 切号等）。
- 不实现账号密码登录与 OAuth 登录（只做 token 导入/刷新链路）。
- 不做“高级指纹/反检测”（本期仅提供 UA 与代理）。
- 不覆盖移动端（手机端后续另行评估）。

## Impact
- Affected specs (new):
  - `\"openspec/changes/add-flowith-web-desktop-mvp/specs/web-workspaces/spec.md\"`
  - `\"openspec/changes/add-flowith-web-desktop-mvp/specs/accounts-vault/spec.md\"`
  - `\"openspec/changes/add-flowith-web-desktop-mvp/specs/network-fingerprints/spec.md\"`
  - `\"openspec/changes/add-flowith-web-desktop-mvp/specs/ui-shell/spec.md\"`
  - `\"openspec/changes/add-flowith-web-desktop-mvp/specs/ui-preferences/spec.md\"`
- Affected code (expected):
  - main: `\"src/main/**\"`（accounts/auth/workspace/network/storage）
  - preload: `\"src/preload/**\"`（最小化 IPC API）
  - renderer: `\"src/renderer/**\"`（Workspace 单页 UI）
- Key risks:
  - **安全**：token 绝不能出现在日志/渲染层错误堆栈中；导出必须明确提示风险。
  - **Linux 加密**：`electron.safeStorage` 可能不可用，需要降级为“不持久化 token”而不是明文落盘。
  - **登录态注入不确定性**：Flowith Web 的 Supabase token 存储 key/格式需要在实现阶段验证，可能需要适配策略。

