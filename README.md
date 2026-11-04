# 摩羯桌宠

Windows / macOS 桌面宠物。角色素材仅经过安全裁切、抠图、透明化和等比归一化。

## 功能

- 透明、无边框、始终置顶的桌宠窗口
- 单击角色随机播放被戳反应和嘴毒对白
- 红黑切角终端风格对话气泡，状态栏与表情状态同步
- 对话气泡底栏提供“视频下载”和“一键提速”快捷入口
- 右键桌宠打开独立红黑切角控制台，不再使用系统原生菜单
- 双击打开互动菜单
- 拖动角色时播放挣扎表情，并限制在系统工作区内
- 右键切换表情、隐藏、置顶、缩放、设置和退出
- 托盘显示/隐藏、设置和干净退出
- 待机摇摆、随机小动作、眨眼、90 秒无交互进入睡眠
- 状态优先级、自动回待机时间和定时器清理
- 位置、缩放、置顶、音量、开机启动和托盘图标状态持久化
- 统一 `448 × 448` 透明画布，等比显示，不拉伸角色
- 一键提速：安全 dry-run、路径预览、确认后清理临时文件与浏览器缓存
- 视频下载：网址校验、yt-dlp 队列、进度、取消、重试和保存目录
- 大模型聊天：角色化 Prompt、流式回复、独立聊天窗口、多轮裁剪、停止和清空

## 环境要求

- Node.js `22.12.0` 或更高版本
- npm
- Windows 10/11 或 macOS

当前项目使用 Electron `45.x` 和无构建器的原生 HTML/CSS/JavaScript。

## 运行

```powershell
$env:HTTP_PROXY=''
$env:HTTPS_PROXY=''
$env:NO_PROXY='*'
npm install
npm run dev
```

首次安装会通过项目的 `postinstall` 钩子下载 Electron 运行时。项目默认使用 npmmirror，避免 GitHub Release 在当前网络环境下连接失败。表情 PNG 已经生成并包含在项目中，正常启动不需要再次处理素材。

Windows 项目已包含校验过的 `yt-dlp.exe` 和版本清单。其他平台首次使用视频功能前执行：

```powershell
npm run setup:video-tools
```

该命令从 yt-dlp 官方 GitHub Release API 获取对应平台文件，并验证官方 SHA-256 摘要。FFmpeg 由 npm 包 `@ffmpeg-installer/ffmpeg` 提供。

当前机器的本地代理 `127.0.0.1:7890` 可能未运行；上面先清空代理环境变量。如果你的网络环境必须使用代理，请改为设置可用代理地址。

静态检查：

```powershell
npm run check
```

单独打开两个新增模块做界面检查：

```powershell
npm run smoke:modules
```

Windows 桌面快捷方式：

```powershell
npm run shortcut
```

该命令会编译无控制台窗口的 `CapriPetLauncher.exe`，并在桌面创建“摩羯桌宠”快捷方式。项目移动后重新运行一次即可更新快捷方式。

## 操作

| 操作 | 行为 |
|---|---|
| 单击角色 | 随机被戳表情，随后进入一个随机情绪并显示气泡 |
| 双击角色 | 打开互动菜单 |
| 按住并移动 | 拖动窗口，播放 `drag` 表情 |
| 右键角色 | 打开红黑终端风格桌宠控制台 |
| 气泡快捷栏 | 直接打开视频下载或一键提速 |
| 气泡快捷栏“找她说话” | 打开独立的摩羯聊天窗口 |
| 托盘单击 | 显示或隐藏桌宠 |
| 托盘右键 | 显示/隐藏、和大模型聊天、一键提速、视频下载、设置、退出 |

右键菜单里的“退出摩羯”和设置页里的“退出程序”会销毁窗口与托盘图标并退出 Electron，不会留下后台进程。

## 一键提速

从桌宠右键菜单或托盘菜单打开“一键提速…”。

1. 选择临时目录、Chrome 缓存、Edge 缓存或 Capri 日志。
2. 点击“扫描并预览”，主进程只读取路径、大小和文件数。
3. 检查每条路径，只勾选需要清理的项目。
4. 点击“确认并清理所选”，主进程还会显示一次原生警告对话框。
5. 删除失败的锁定文件或权限不足文件会跳过，并显示在结果中。

安全边界：

- 只操作白名单中解析出的真实目录。
- 全部禁止 `C:\Windows`、`System32`、程序目录、系统盘根目录、`/etc`、`/usr/bin` 等路径。
- 不跟随符号链接或 Windows 目录联接。
- 临时目录默认跳过 24 小时内文件。
- 浏览器只处理 `Cache`、`Code Cache` 和 `GPUCache`，不触碰 Cookie、密码、历史、书签和扩展目录。
- 项目 `node_modules` 默认关闭，必须通过系统文件夹选择器手动选择有效 Node 项目。
- 首版不清空回收站。
- 不结束进程、不修改注册表、不伪造内存释放数值。

## 视频下载

从桌宠右键菜单或托盘菜单打开“输入网址下载…”。

1. 粘贴视频页面 URL。
2. 勾选版权与访问权限确认。
3. 点击“解析并下载”。
4. 在队列中查看解析、下载和合并进度。
5. 完成后可打开文件位置；桌宠会播放 `happy` 并显示下载完成气泡。

安全与合规边界：

- 网络请求和 yt-dlp 子进程全部由 Electron 主进程管理。
- 渲染进程通过专用 preload 调用有限 IPC，不拥有 `fs`、`child_process` 或原始 `ipcRenderer`。
- 仅接受 `http`/`https`，拒绝用户信息、localhost、内网 IP 和保留网段。
- 使用绝对工具路径、参数数组和 `shell: false`，不使用命令字符串拼接。
- 使用 `--ignore-config`，不读取用户级 yt-dlp 配置注入。
- 不支持 DRM、登录绕过、会员绕过或验证码绕过。
- 不读取浏览器 Cookie；私密或需要登录的内容会失败。
- 默认输出到 `Downloads/CAPRI`。

> 请仅下载你拥有版权、授权或许可的内容，并遵守目标网站服务条款和版权规定。

可通过 `CAPRI_YTDLP_PATH` 和 `CAPRI_FFMPEG_PATH` 覆盖工具路径。第三方工具许可说明见 `tools/THIRD_PARTY_NOTICES.md`。

## 大模型聊天

从桌宠气泡快捷栏“找她说话”、右键菜单或托盘菜单打开独立聊天窗口。聊天窗口不复用桌宠透明窗口，因此打开、关闭或调整聊天窗口不会改变桌宠的透明置顶逻辑。

### Provider 配置

打开聊天窗口后点击“连接设置”，填写：

- Base URL：例如 `https://api.openai.com/v1`
- 模型名：填写你的 OpenAI Chat Completions 兼容模型
- 关系尺度：用户本人、熟人或陌生人
- 活动窗口上下文：可选择关闭

请求由 Electron 主进程发出，使用：

```text
POST {Base URL}/chat/completions
stream: true
```

兼容标准 SSE `choices[0].delta.content`；如果 Provider 忽略 `stream` 而返回完整 JSON，也能正常解析。Base URL 允许 HTTPS，以及本机的 `http://localhost`、`http://127.0.0.1` 和 `http://[::1]`。

### API Key 与安全

API Key 在聊天设置中以密码框输入，提交后立即从页面控件清空：

1. 优先使用 `keytar` 写入 Windows Credential Manager 或 macOS Keychain。
2. 系统钥匙串失败时，使用 Electron `safeStorage` 加密后写入 `userData/chat/provider-key.enc`。
3. 两种安全存储都不可用时，仅保留在本次主进程内存中，并明确提示不会持久化。

不会把 API Key 写入聊天记录、`provider.json`、`localStorage`、日志或渲染层可读取的配置。渲染进程只能在提交时短暂读取密码框内容，申请后不能重新读取已保存密钥。聊天 preload 只暴露收发消息、停止、清空、保存 Provider 配置和设置/删除密钥的最小 API。

升级 Electron 或更换 Node ABI 后如果钥匙串模块无法加载，可执行：

```powershell
npm run rebuild:native
```

安全注意事项：

- 不要在 Base URL 中拼接用户名、密码或 API Key。
- 远程 Provider 必须使用 HTTPS；不要使用来源不明或要求关闭 TLS 校验的代理。
- API Key 只应授予所需权限，并定期轮换。
- 活动窗口上下文默认只发送应用名和截断为 80 字符的窗口标题，不发送窗口路径。窗口标题可能包含文件名或网页标题，可在设置中关闭。
- 聊天内容会发送给配置的 Provider；不要输入不希望交给该服务的敏感信息。

### Prompt 与上下文

System Prompt 分为：

- L0：角色名、性格和身份边界
- L1：句式、口头禅、语气词密度和 5 条禁用表达
- L2：陌生人、熟人、用户本人的关系尺度，以及冒犯和展开策略
- L3：当前时间、活动窗口、桌宠状态、最近摘要
- L4：`reply/emotion/action` JSON 输出约束

角色配置位于 `config/persona.json`，全局规则和裁剪上限位于 `config/chat.defaults.json`。合并优先级固定为：

```text
用户覆盖 > 角色 manifest > 全局默认
```

用户覆盖文件位于 `%APPDATA%\mojie-desktop-pet\chat\persona-overrides\<personaId>.json`。合并后仍会重新校验反例数量和 emotion/action 白名单。

每次请求最多发送 24 条、12000 字符，并进一步限制在最近 6 轮；最新用户消息不会被静默丢弃。被裁剪的旧轮次会压成本地滚动摘要，不额外调用模型。消息正文持久化在：

```text
userData/chat/sessions/<personaId>.json
```

会话按角色隔离。切换角色只中止当前请求并加载对应文件，不会清空或混用另一角色的历史。当前版本不建立原始对话全文长期记忆库，只保留会话内摘要。

### 桌宠联动与降级

- 收到消息时依次进入 `chat_listening`、`chat_thinking`。
- 首个正文增量到达后进入 `chat_speaking`，流式文本同时更新聊天窗口和桌宠气泡。
- 完成后按 JSON 的 emotion/action 切换表情，再回到 idle。
- “停止生成”保留已经出现的文本，不显示错误弹窗。
- “清空会话”会先中止当前请求，再删除当前角色的历史和摘要。
- 网络失败、超时和 JSON 损坏只产生一次角色化简短回复，并回到 idle。

`chat_listening`、`chat_thinking`、`chat_speaking` 复用现有表情帧，没有新增或重绘角色素材。

聊天测试：

```powershell
npm run test:chat
npm run test:chat-credentials
npm run test:chat-module
```

后两条命令会启动 Electron，分别验证系统密钥存储/加密回退和完整聊天模块；测试结束会删除测试密钥。

## 素材

正式素材来自：

- `assets/source/mojie_sheet_A.jpg`：`1206 × 2012`，3 列 × 5 行，提供 15 个唯一表情
- `assets/source/mojie_sheet_B.jpg`：`1206 × 637`，4 列 × 2 行，仅用于比对重复帧

两张附件虽然原始扩展名是 `.PNG`，实际文件头为 JPEG。项目内副本已按真实格式命名，但图像像素没有被重新导出或改变。

第二张图的重复关系：

```text
B1=A7   B2=A14  B3=A15  B4=A12
B5=A3   B6=A5   B7=A6   B8=A10
```

两张原始 JPEG 都不带透明通道，背景也不是严格纯色。项目使用边缘泛洪、alpha 羽化、小连通噪点清理和固定画布锚点生成运行时素材。

重新生成透明素材：

```powershell
npm run prepare:assets
```

生成结果：

- `assets/emotions/*.png`：15 个透明表情帧
- `assets/tray/mojie_tray.png`：从 A1 原图裁出的托盘图标

## 配置

### `config/emotions.json`

定义：

- 原图尺寸、安全切分带、背景色和去背参数
- 每个表情的源裁切框、生成文件、显示名称和可选基线
- 状态优先级、帧池、持续时间、结束后去向和动画类型
- 眨眼间隔、随机小动作间隔、睡眠时间和点击后的情绪池

`blink` 使用素材中 A6 的闭眼姿态短暂闪现 `160 ms`。原图没有“与 A1 完全同姿势、仅闭眼”的独立帧，因此没有对角色整体做非等比压缩来伪造眨眼。

### `config/dialogues.json`

按事件分组保存随机对白：

```text
click, drag, dragEnd, happy, angry, sad,
surprised, shy, sleep, wake, work, micro
```

直接编辑数组即可增加台词，不需要改代码。

### `config/default-settings.json`

定义首次启动时的缩放、置顶、开机启动、音量和托盘状态。用户修改后的设置保存在 Electron 的 `userData/settings.json`，不会写回项目目录。

常见位置：

- Windows：`%APPDATA%\mojie-desktop-pet\settings.json`
- macOS：`~/Library/Application Support/mojie-desktop-pet/settings.json`

实际路径以 Electron 的 `app.getPath("userData")` 为准。

## 状态优先级

```text
drag 100
click 90
surprised 80
angry 70
happy / sad / shy 60
work 30
sleep 20
blink 10
idle 0
```

依次验证：

1. 待机时随机眨眼，但不改变角色横向比例。
2. 单击后先播放 `click`，结束后进入随机情绪，再自动回 `idle`。
3. 双击只打开菜单，不会提前触发单击气泡。
4. 拖动时鼠标移动超过 `6 px` 才进入 `drag`，松手立即回 `idle`。
5. 拖动、缩放和跨屏幕后，窗口仍保持在当前系统工作区内。
6. 90 秒无交互进入睡眠；点击、拖动或打开菜单会唤醒。
7. 关闭托盘图标时，桌宠不会被隐藏到无法恢复的位置。
8. 退出后任务管理器中不再保留 Electron/摩羯进程。

## 项目结构

```text
capri/
├─ assets/
│  ├─ source/                原始差分图
│  ├─ emotions/              15 个透明 PNG
│  └─ tray/                  托盘图标
├─ config/
│  ├─ emotions.json
│  ├─ dialogues.json
│  └─ default-settings.json
├─ scripts/
│  ├─ prepare-assets.cjs
│  ├─ check-config.cjs
│  ├─ install-electron.cjs
│  ├─ module-smoke.cjs
│  └─ setup-video-tools.cjs
├─ tools/
│  ├─ THIRD_PARTY_NOTICES.md
│  └─ bin/<platform>-<arch>/yt-dlp + manifest.json
├─ src/
│  ├─ main.js                Electron 主进程、窗口、菜单、托盘、持久化
│  ├─ main/pet-menu.js       自定义桌宠右键控制台
│  ├─ preload.js             安全 IPC 桥
│  ├─ main/
│  │  ├─ chat/               聊天服务、上下文、凭据、SSE 和会话
│  │  ├─ cleaner/            文件扫描、安全计划、删除执行器
│  │  └─ video/              URL 策略、工具解析、下载队列
│  ├─ preload/
│  │  ├─ chat.js             聊天窗口最小 API
│  │  ├─ cleaner.js          清理窗口最小 API
│  │  ├─ pet-menu.js         右键菜单最小 API
│  │  └─ video.js            下载窗口最小 API
│  └─ renderer/
│     ├─ chat/               独立角色聊天窗口
│     ├─ cleaner/            清理预览窗口
│     ├─ pet-menu/           红黑桌宠控制台
│     ├─ video/              下载队列窗口
│     └─ ...                 桌宠和设置窗口
├─ package.json
└─ README.md
```

## 已知平台说明

- 开发模式下，开机启动注册指向当前 Electron 可执行文件；正式分发时建议封装为安装包后再验证系统启动项。
- macOS 的登录项、托盘和窗口层级由 Electron 原生接口处理，主体页面代码不需要修改。
- 桌宠窗口会捕获自身透明矩形内的鼠标事件。这是为了保证角色、气泡和菜单位置稳定；窗口不会覆盖 Windows 任务栏工作区域。
