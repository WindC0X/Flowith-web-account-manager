# 使用指南（小白版）

本指南面向第一次使用 **Flowith Web Account Manager（桌面版）** 的用户，按“照着做就能跑”的方式说明：安装 → 配置 → 导入账号 → 打开 Web → 下载与更新 → 常见问题。

> 安全提醒：`refresh_token` 等同于账号登录凭证。**不要**把 token 发给任何人、不要截图公开、不要粘贴到不可信网站/聊天机器人/工单系统。

## 1. 我需要准备什么？

你需要两类东西：

1. **应用安装包**（从 GitHub Release 下载）
2. **账号的 `refresh_token`**（导入时一行一个）

另外：如果你在导入/打开 Tab 时看到“缺少 Supabase 配置”之类的提示，则需要额外配置 Supabase（用于校验/刷新 token、自动进入登录态）。应用通过环境变量读取该配置：

- `FLOWITH_SUPABASE_URL`
- `FLOWITH_SUPABASE_ANON_KEY`

如果没配置这两个环境变量：

- 导入 token 可能无法校验
- 打开 Tab 时无法自动进入登录态

## 2. 安装与首次运行

### 2.1 Windows

1. 从 Release 下载 Windows 安装包（`.exe`）。
2. 双击安装（默认即可）。
3. 首次运行前建议先配置好环境变量（下一节）。

### 2.2 macOS

1. 从 Release 下载 macOS 安装包（`.dmg`）。
2. 打开 dmg 并把应用拖到“应用程序”目录。
3. 首次运行前建议先配置好环境变量（下一节）。

### 2.3 Linux

1. 从 Release 下载 `.AppImage`。
2. 赋予可执行权限后运行：

```bash
chmod +x Flowith-web-account-manager*.AppImage
./Flowith-web-account-manager*.AppImage
```

## 3. 配置 Supabase（如需）

### 3.1 Windows（图形界面方式）

1. 打开“设置” → 搜索“环境变量” → 进入“编辑系统环境变量”
2. 点击“环境变量…”
3. 在“用户变量”中新增：
   - 变量名：`FLOWITH_SUPABASE_URL`，变量值：你的 Supabase URL
   - 变量名：`FLOWITH_SUPABASE_ANON_KEY`，变量值：你的 anon key
4. 完成后**彻底退出应用并重新打开**（让新环境变量生效）。

### 3.2 macOS / Linux（终端方式）

只对当前终端会话生效（关闭终端会失效）：

```bash
export FLOWITH_SUPABASE_URL="https://xxxxx.supabase.co"
export FLOWITH_SUPABASE_ANON_KEY="your_anon_key"
```

然后从同一个终端启动应用（或把环境变量写入你的 shell 配置文件再重启系统）。

## 4. 导入账号（refresh_token）

1. 打开应用，进入 **导入** 页面。
2. 把 token 粘贴进去：**一行一个** `refresh_token`。
3. 点击导入：
   - 应用会尝试刷新 Supabase session 来校验 token
   - 导入成功后会在账号列表出现账号

### 4.1 关于“token 无法持久化”的提示

在某些环境（例如部分 Linux、受限环境、Windows Sandbox），系统加密能力可能不可用，应用会提示类似：

- “Token encryption is unavailable… tokens are runtime-only…”

这意味着：

- token **不会被永久保存**，重启后需要重新导入

## 5. 打开 Web（Tab）

1. 在账号列表里选中一个账号。
2. 点击 **打开 Tab**（或卡片上的快捷按钮）。
3. 应用会自动：
   - 用 `refresh_token` 校验并刷新登录态
   - 为每个账号使用独立的浏览器存储空间，避免 Cookie/localStorage 串号

## 6. 代理与 User-Agent（按账号设置）

### 6.1 代理模式（Proxy）

每个账号都可以设置代理模式：

- `system`：跟随系统代理/PAC
- `direct`：强制直连（排查网络问题时很有用）
- `custom`：手动填写代理规则（例如 `http=127.0.0.1:7890;https=127.0.0.1:7890`）

注意：

- 带账号密码的代理规则（例如 `user:pass@host`）会被拒绝

### 6.2 连通性检测

在账号详情中可以进行“连通性检测”，会展示：

- 每个 endpoint 的成功/失败与延迟
- 包括 Flowith Web、edge、以及 Supabase（如果已配置）

### 6.3 User-Agent

你可以使用默认 UA、预设 UA 或自定义 UA。保存时会做基本校验；如果提示无效，请换一个标准浏览器 UA 字符串再试。

## 7. 下载（保存方式 / 进度 / 常见问题）

### 7.1 保存方式

你可以在设置中选择下载保存方式：

- **每次另存为（默认）**
- 自动保存到 Downloads
- 自动保存到指定目录

### 7.2 下载进度在哪里看？

下载开始/进行中/完成/失败会显示在应用 UI 的通知区域（顶栏或提示区），并提供：

- 取消
- 打开文件
- 在文件夹中显示
- 复制路径

### 7.3 常见问题：另存为弹出两次

如果你遇到“同一次下载弹出两个另存为对话框”，请更新到最新版本再试；若仍复现，建议记录：

- 操作步骤（从哪个页面触发、是否 `blob:` 下载）
- 应用版本号
- 系统版本

## 8. 更新（自动更新 / 增量下载）

### 8.1 怎么检查更新？

自动更新只在 **打包后的安装版**可用（从源码运行的开发版不可用）：

1. 打开 **设置（⚙）** → **Updates**
2. 点击 **Check updates**
3. 下载完成后点击 **Restart & install**

### 8.2 为什么安装包几十 MB，但更新只下载几 MB？

这是正常现象：

- 安装包是完整应用（包含 Electron 运行时 + 应用资源）
- 更新下载可能是“差分块”（增量下载），只拉取变化的部分，最后在本机合成为完整新版本

## 9. 常见问题（FAQ）

### 9.1 打开 Tab 报错：`Failed to inject session: storage write failed`

可能原因：

- 页面尚未真正加载到 Flowith 域就开始注入（时序问题）
- 运行环境限制了存储写入（例如 Windows Sandbox 的某些限制）

建议：

1. 先确认网络可访问 `https://flowith.io`
2. 关闭 Tab 重新打开
3. 尽量在非 Sandbox 的真实系统环境运行
4. 若错误信息包含 `href=... readyState=...`，把它连同复现步骤提供出来方便定位
