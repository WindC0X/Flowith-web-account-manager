# Project Context

## Purpose
本项目是一个全新的跨平台桌面应用：**Flowith Web Account Manager（Desktop）**。

目标：
- 仅通过用户提供的 `refresh_token` 文本（不需要账号密码 / OAuth）完成账号导入与登录态注入；
- 在一个桌面窗口内以 Tabs 并行管理多个 Flowith Web（默认 `https://flowith.io`）会话；
- 支持按账号配置代理与 User-Agent，兼容国内访问需要代理的网络环境；
- 支持账号信息展示（订阅、积分等）、账号标签、导入/导出 token；
- 全流程遵守安全基线：不在 UI/日志中暴露任何敏感 token。

## Tech Stack
- Electron（Chromium + Node.js）
- TypeScript
- React + Vite（renderer）
- Supabase JS（用于 `refresh_token` 刷新会话）
- 本地存储：`electron-store` + `electron.safeStorage`（加密持久化 refresh_token）

## Project Conventions

### Code Style
- TypeScript 优先，开启严格类型（`noImplicitAny` 等）
- 禁止在日志/错误信息中输出敏感内容（`refresh_token`/`access_token`/`session`）
- IPC API 最小化、强类型、入参做校验（renderer 不直接持有明文 token，导出场景除外）

### Architecture Patterns
- Electron 三层隔离：main / preload / renderer
- Electron 安全基线：`contextIsolation=true`、`nodeIntegration=false`、最小权限 IPC
- 多账号隔离：每账号独立 `partition`（`session.fromPartition`）+ 独立 BrowserView/WebContents
- 网络与指纹：per-account `setProxy()` + `setUserAgent()`

### Testing Strategy
- 单元测试：纯函数（tags 规范化、代理规则校验、配置归一化等）
- 集成/冒烟：导入 token → 打开 Tab → 切换账号 → 代理/UA 生效 → 导出 token → 重启偏好仍在
- 避免依赖外部不稳定系统的自动化 E2E（必要时用手工 checklist 作为验收）

### Git Workflow
- 默认 trunk-based（main 分支）
- 小步提交，变更以 OpenSpec change 为单位组织

## Domain Context
- 交付方式：你只能提供文本形式的 `refresh_token`（可一行一个），不能提供账号密码
- Flowith Web 在国内通常需要代理：系统代理 / TUN / 应用内自定义代理都需要兼容
- 目标体验：低学习成本、多账号并行（桌面端）

## Important Constraints
- 不记录敏感信息：password / access_token / refresh_token / session（只允许 mask/指纹）
- refresh_token 持久化必须加密（优先 `electron.safeStorage`）；加密不可用时禁止明文落盘（可允许本次运行临时导入）
- Web 嵌入必须不破坏应用布局：网页只占 Workspace 视口区域，随窗口/侧边栏变化正确 resize
- per-account 代理不得允许包含 `username:password@host` 形式的凭据（避免凭据落盘）

## External Dependencies
- Flowith Web：`https://flowith.io`
- Flowith edge（如需连通性检测）：`https://edge.flowith.net`
- Flowith 使用的 Supabase 项目（用于刷新会话与登录态注入）
- （可选）Worker/账号信息接口：用于订阅/积分等展示
