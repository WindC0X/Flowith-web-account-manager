---
## 1. Implementation
- [ ] 创建 Electron+Vite+React+TS 项目骨架（main/preload/renderer 分层），启用安全基线配置
- [ ] 基于 `\"docs/ui-demo-flowith-web-account-manager.html\"` 落地 Workspace 单页 UI 骨架（Topbar/Sidebar/Tabs/Inspector/Dialog），保证不溢出/不遮挡/可交互
- [ ] 设计并实现最小化 IPC（workspace/accounts/preferences），确保 renderer 不接触明文 token（导出场景除外）
- [ ] 实现账号存储：加密 refresh_token（`safeStorage`）+ tags/displayName + per-account net/UA 配置；Linux 加密不可用时禁用持久化
- [ ] 实现 token 导入：一行一个 refresh_token → 刷新 Supabase session 校验 → 入库；错误信息脱敏
- [ ] 实现 token 导出：选中账号导出 refresh_token（每行一个）；UI 明确提示敏感性，默认不自动复制
- [ ] 实现 WebWorkspaceService：按账号创建 BrowserView + partition；Tab 切换 attach/detach；viewport bounds 跟随 UI resize
- [ ] 实现 per-account 代理（system/custom/direct）：应用到 partition session；禁止含凭据的 proxy URL；提供连通性检测
- [ ] 实现 per-account UA：预设 + 自定义；应用到对应 webContents；切换/刷新时生效
- [ ] 实现登录态注入：refresh_token → session → 注入 partition 存储 → reload → 进入已登录态（实现阶段确认 key/格式并适配）
- [ ] 实现账号信息面板：订阅/积分等（若有可用 API，则按账号刷新并缓存；无则降级显示占位）
- [ ] 实现主题与 i18n：zh-CN/en；偏好持久化

## 2. Tests
- [ ] 单元测试：tags 规范化、proxy rules 校验、net 配置归一化（不触网）
- [ ] 冒烟（手工 checklist）：导入→打开 Tab→切换→代理/UA 生效→导出→重启偏好仍在

## 3. Docs
- [ ] `\"docs/usage.md\"`：导入/导出/工作区 Tabs/代理模式说明（system/custom/direct）
- [ ] `\"docs/security.md\"`：token 脱敏、导出风险、Linux 加密不可用时的行为

## 4. Validation
- [ ] lint/typecheck（以项目脚本为准）
- [ ] `dev` 启动并完成冒烟 checklist
- [ ] 打包验证：Windows +（可选）Linux 打包可启动

