# Design: Flowith Web Account Manager (Desktop MVP)

## 1. Goals
- **最低使用成本**：用户只需粘贴 `refresh_token` 即可开始使用，不要求账号密码/OAuth。
- **多账号并行**：同一窗口内 Tabs 管理多个账号，每个账号互相隔离、互不串号。
- **代理兼容**：支持 system/custom/direct，覆盖系统代理、TUN 与应用内设置三类用户习惯。
- **安全默认**：不记录 token；IPC 最小化；renderer 默认不接触明文 token（导出场景例外）。

## 2. UI baseline (Demo-driven)
UI 以 `\"docs/ui-demo-flowith-web-account-manager.html\"` 为基准：
- 布局层级：Topbar / Sidebar / Tabs Workspace / Inspector / Import&Export Dialog
- 关键交互：侧边栏折叠仍可恢复、卡片/列表视图切换、批量操作、账号详情编辑（标签/显示名/网络与 UA）

实现方式：在 renderer 中用 React 组件复刻 Demo 的 DOM 结构与 class 语义；主题与颜色 tokens 直接对齐 Demo，优先保证布局不溢出、不遮挡、不错位。

## 3. Architecture (Electron)

### 3.1 Main process
新增 `WebWorkspaceService`：
- 维护账号 Tab：`Map<accountId, BrowserView>`（或 `webContents`）
- 每个账号使用独立 `partition`（例如 `persist:flowith-web-${accountId}`）实现 cookies/localStorage 隔离
- per-account 网络与 UA：
  - `session.fromPartition(partition).setProxy(...)`
  - `webContents.setUserAgent(...)`
- Web 登录态注入：
  - 用 refresh_token 刷新 Supabase session
  - 将 session 注入到该 partition 的存储（实现阶段确认 key/格式）
  - reload 确保 `\"https://flowith.io\"` 进入登录态

导航与安全：
- 限制导航到非信任 origin（仅允许 `flowith.io` 及必要子域）
- 拦截 `window.open`，外链用系统默认浏览器打开
- 禁用 Node 集成与危险特性（按 Electron 安全基线）

### 3.2 Preload
暴露最小 API（不返回 token 明文）：
- `workspace.openTab(accountId)`
- `workspace.closeTab(accountId)`
- `workspace.setActiveTab(accountId)`
- `workspace.setViewportBounds(bounds)`
- `workspace.reloadActive()`

账号管理 API：
- `accounts.importRefreshTokens(text)`
- `accounts.exportRefreshTokens(accountIds)`
- `accounts.updateAccountMeta(accountId, { displayName, tags, net, ua })`

### 3.3 Renderer
单页 Workspace：
- Sidebar：账号列表（显示名称、标签、订阅/积分摘要、状态点）
- Tabs：账号 tab strip + Web viewport 容器
  - 容器上报 `getBoundingClientRect()` 给 main 用于 BrowserView `setBounds`
- Inspector：账号详情（显示名/标签、订阅/积分、代理与 UA 配置、连通性检测、导出入口）

UI 偏好（主题/i18n/折叠/视图）在本地持久化（实现阶段可选 localStorage 或 main store）。

## 4. Token storage & security
- refresh_token 本地持久化必须加密：
  - 优先 `electron.safeStorage`
  - 若不可用：不持久化 refresh_token（可允许本次运行临时导入）
- 所有日志/错误信息必须经过脱敏与截断，任何 token 字符串视为敏感数据。

## 5. Proxy strategy
按账号维度支持三种模式：
- `system`：遵循系统代理/PAC；对 TUN 用户通常也可直连
- `direct`：强制直连（用于排查代理问题）
- `custom`：应用内输入 proxy rules（禁止包含 `username:password@`）

连通性检测：以“当前账号的有效网络配置”为准，对关键端点给出 OK/FAIL 与延迟。

## 6. Validation plan (high-level)
1) 导入 refresh_token（每行一个）→ 校验成功 → 账号列表出现条目（不显示明文 token）。
2) 两个账号分别打开 Tab → 切换 Tab 保持互不干扰的登录态。
3) 对某个账号设置 custom proxy + UA → reload 后生效 → 连通性检测结果可见。
4) 导出选中账号 refresh_token → 每行一个；未选中不导出；UI 提示敏感性。
5) 主题/语言/折叠状态重启后保留。

