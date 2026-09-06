# GUI 桌面应用 + CLI 伴侣:业界工程模式与 Agent 友好 CLI 设计调研

<!-- [20260906_Research_DesktopCliCompanion] 本文档为 Murmur CLI/MCP 规划的一手资料调研:
   调研 GUI 桌面应用的 CLI 伴侣模式(单实例转发、分发、agent 友好设计、本地 IPC 安全)。
   全部结论标注一手来源(官方文档 / 官方仓库源码),查证不了的明确标注"未验证"。 -->

- **日期**: 2026-09-06
- **方法**: 只采信一手资料 —— Electron/VS Code/1Password/Docker/Microsoft/GitHub/Stripe/Cloudflare 官方文档与官方 GitHub 仓库源码(microsoft/vscode 源码逐文件核对;Homebrew cask 元数据来自 formulae.brew.sh 官方 API)。所有结论附来源 URL,涉及代码的附仓库文件路径。无法从一手来源确认的信息标注"未验证"。
- **范围**: ① Electron 单实例 + CLI 转发机制;② 随应用分发的 CLI 的安装模式;③ Agent 友好 CLI 设计(2026);④ 本地 IPC 安全。结论面向 Murmur(Electron + 嵌入式 FunASR,本地优先,Windows + macOS)的 CLI/MCP 规划。
- **本地仓库输入**: `docs/adr/004-file-based-config.md`(murmur.json 三级配置链)、`docs/homebrew/murmur.rb`(DRAFT cask)、`docs/winget/Murmur.yaml`(DRAFT winget)、`package.json` build 段(electron-builder,win 未指定 target 即默认 NSIS)。

---

## TL;DR

1. **Electron 官方 `app.requestSingleInstanceLock()` 是"参数上抛"而非"请求-响应"**:第二实例把 `argv`/`workingDirectory`/`additionalData` 发给主实例后即退出,主实例通过 `second-instance` 事件收到,但 CLI 拿不到任何返回值。它适合"唤起 GUI",**不适合 `murmur transcribe` 这种 CLI 要拿结果输出的场景**——后者需要 CLI ↔ 运行实例的双向 IPC(unix socket / named pipe),业界由 1Password、Docker 证明。
2. **VS Code 没有用 `requestSingleInstanceLock`,而是自建 IPC**:主进程绑定 `createStaticIPCHandle()` 生成的确定性 socket/named pipe(路径 = userDataPath 的 SHA-256 前 8 字节),`EADDRINUSE` 则作为客户端连接,通过 `ILaunchMainService.start(args, env)` 转发后退出;`ECONNREFUSED` 时删除陈旧 socket 重试。`code` 命令本体是 app bundle 内的 shell 脚本,用 `ELECTRON_RUN_AS_NODE=1` 把 Electron 二进制当 Node 运行——**不需要给用户机额外装 Node,CLI 零依赖**。
3. **VS Code 的关键架构:CLI 本地子命令在 CLI 进程内直接执行,不经过 GUI 实例**(`--list-extensions` 等走 `cliProcessMain.js`)。对应到 Murmur:`murmur config get/set`、`murmur history` 这类只读/写文件与 DB 的命令应直接在 CLI 进程执行(ADR-004 的 murmur.json 已铺路),只有需要 FunASR 引擎或 GUI 交互的命令才连运行中的实例。
4. **CLI 分发三个已验证的模板**:macOS = app bundle 内二进制 + Homebrew cask `binary` stanza 软链到 `$(brew --prefix)/bin`(VS Code cask 有 `code`/`code-tunnel` 两条 binary;1Password 的 `op` 走独立 cask `1password-cli`,与桌面应用分开分发);Windows = NSIS 安装器把 `{app}\bin` 写入注册表 `HKCU\Environment\Path`(VS Code `build/win32/code.iss` 第 1302 行,task 默认勾选);MSIX App Execution Alias 是系统级替代但要求打包形态。Murmur 现有 DRAFT cask/winget 只差这几行配置。
5. **Agent 友好已成 2026 年 CLI 标配**:`--json` 结构化输出(gh 需字段列表 + 内建 `--jq`/`--template`;stripe `--json`;wrangler 部分 `--json` + 2025-11 新增 `WRANGLER_OUTPUT_FILE_PATH` 捕获 ND-JSON)、稳定退出码(gh:0 成功/1 失败/2 取消/4 需认证)、stdin 管道(VS Code 要求显式 `-` 参数,因 TTY 检测不可靠)、AGENTS.md 已成 Linux Foundation 旗下标准(60k+ 开源项目采用)。
6. **"同一 API 双出口(CLI + MCP)"是主流并行建设模式**:GitHub(gh + github-mcp-server,远程 `api.githubcopilot.com/mcp/`)、Stripe(stripe CLI + `mcp.stripe.com` 远程 MCP)、Cloudflare(wrangler + `bindings.mcp.cloudflare.com/mcp` 系列领域服务器)、Docker(`docker mcp` CLI 插件即 MCP Gateway)。**与 Murmur 形态最接近的是 1Password:MCP server 内置在桌面应用中**(`1password-mcp`,stdio,GUI 内授权确认,永不向客户端返回明文 secret)。
7. **本地 IPC 安全三件套**:Unix socket 用文件权限位收口(ssh-agent socket "only readable by the owner";Docker socket root:docker group,官方明确 "The docker group grants root-level privileges");**Windows named pipe 默认 DACL 对 Everyone 开放读,必须显式收紧**(Docker 用 `docker-users` 组 + pipe ACL);对连接方做身份验证 + 短时会话(1Password:双向代码签名校验 / Linux setgid GID 校验,10 分钟会话 + 12 小时硬上限,锁库即撤销)。
8. **对 Murmur 的核心架构建议**(详见末节):`murmur` CLI 用 `ELECTRON_RUN_AS_NODE` 模式零依赖分发;本地子命令直连 murmur.json/SQLite;需要引擎的命令走确定性路径的 unix socket / named pipe 连运行实例,附 token 握手;macOS 用 cask `binary` stanza,Windows 用 NSIS 写 HKCU Path;MCP server 仿 1Password 内置在主进程、复用与 CLI 相同的命令层。

---

## 一、Electron 单实例 + CLI 模式

### 1.1 Electron 官方:`requestSingleInstanceLock()` + `second-instance`

来源:Electron 官方文档 <https://www.electronjs.org/docs/latest/api/app>

- **API 形态**:`app.requestSingleInstanceLock([additionalData])`,入参 `additionalData` 为任意 JSON 对象(`Record<any, any>`);返回 `boolean` —— `true` 表示本进程是主实例继续加载,`false` 表示已有实例持有锁、"can assume that another instance of your application is already running with the lock and exit immediately"。
- **`second-instance` 事件回调参数**(主实例侧收到):
  - `event`
  - `argv: string[]` —— "An array of the second instance's command line arguments"
  - `workingDirectory: string` —— "The second instance's working directory"
  - `additionalData: unknown` —— "A JSON object of additional data passed from the second instance"
- **官方明确的坑**:
  - `argv` "will not be exactly the same list of arguments as those passed" 给第二实例——顺序可能改变、可能有追加;"it's advised to use `additionalData` instead"。
  - Chromium 会附加参数(如 `--original-process-start-time`)。
  - 第二实例由**其他用户**运行时,`argv` 不含其参数。
  - macOS/Linux 上参数与 `additionalData` 合并为一条消息发送,**上限 32MB,超限直接丢弃**(主实例不会触发 `second-instance`)。
  - 事件保证在 `app` 的 `ready` 之后触发。
  - macOS 上 Finder/dock 打开由系统强制单实例(走 `open-file`/`open-url`),但"when users start your app in command line, the system's single instance mechanism will be bypassed",命令行场景必须用此 API。
- **配套 API**:`app.hasSingleInstanceLock()`、`app.releaseSingleInstanceLock()`。
- **对本节的工程判断**:该机制是单向上报(fire-and-forget),第二实例无法从主实例取回任何数据、也无法得知命令是否成功。`murmur transcribe foo.mp3 --json` 要把转写文本打到 stdout,这条路走不通;它只适合 `murmur open`/`murmur show-history` 这类"唤起 GUI"命令。

### 1.2 VS Code:`code` CLI 如何与已运行实例通信

来源均为 microsoft/vscode 仓库源码(2026-09 master 分支)与官方文档。

**(a) `code` 命令本体:app bundle 内的 shell 脚本,零外部依赖**

`resources/darwin/bin/code.sh`(仓库路径,构建时模板替换 `@@NAME@@`):

```bash
# 关键逻辑(节选):
# 1. 远程终端场景优先走 VSCODE_IPC_HOOK_CLI 指定的 remote CLI
if [ -n "$VSCODE_IPC_HOOK_CLI" ]; then ...
# 2. 通过 app_realpath() 从自身 symlink 反解出 .app 真实路径
APP_PATH="$(app_realpath "${BASH_SOURCE[0]}")"
ELECTRON="$CONTENTS/MacOS/@@NAME@@"
CLI="$CONTENTS/Resources/app/out/cli.js"
ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$@"
```

要点:用 `ELECTRON_RUN_AS_NODE=1` 把 **Electron 二进制本身当 Node 运行时**执行编译后的 `out/cli.js`。用户机器不需要装 Node,CLI 与 GUI 永远同版本。

**(b) CLI 进程内的命令路由:本地命令不碰 GUI 实例**

`src/vs/code/node/cli.ts`:`main()` 解析 argv 后分流——

- `--help` / `--version` / `--locate-shell-integration-path`:纯本地打印;
- `shouldSpawnCliProcess()` 命中(`--list-extensions`、`--install-extension`、`--uninstall-extension`、`--update-extensions`、`--add-mcp`、`--telemetry` 等):在本 CLI 进程内动态 import `cliProcessMain.js` 直接执行,**不连接任何运行中的实例**;
- 其余(打开文件/文件夹):spawn 一个真正的 GUI 实例 —— 非 macOS 直接 `spawn(process.execPath, argv.slice(2), { detached: true })`;macOS 特殊地用 `open -n -g -a <app>` 启动("to obtain behavior similar to if the app was launched from the dock",见 cli.ts 内注释及引用的 issue #102975),GUI 实例起来后再走下面的单实例收敛逻辑。
- 工程细节:stdin 需要显式传 `-` 参数才读取("Just checking for stdin being connected to a TTY is not enough",引用 issue #40351),读入后落临时文件再作为参数传给目标实例;`--wait` 通过 wait-marker 文件的删除来感知编辑器关闭。

**(c) GUI 主进程:自建 socket 单实例收敛(不是 `requestSingleInstanceLock`)**

`src/vs/code/electron-main/main.ts` 的 `CodeMain.claimInstance()`:

1. `nodeIPCServe(environmentMainService.mainIPCHandle)` 尝试绑定 —— 成功即第一实例;
2. 捕获 `EADDRINUSE` → 已有实例在跑:`nodeIPCConnect(mainIPCHandle)` 连上去,`ProxyChannel.toService<ILaunchMainService>(client.getChannel('launch'))` 拿到远端代理,调用 `otherInstanceLaunchMainService.start(environmentMainService.args, process.env)` 把**解析后的参数 + 整个环境变量**发给运行实例,然后本进程以 `ExpectedError('Sent env to running instance. Terminating...')` 退出;
3. `ECONNREFUSED`(仅 Linux/macOS):"it happens on Linux and OS X that the pipe is left behind" → `unlinkSync(mainIPCHandle)` 删除陈旧 socket 文件后重试一次 —— **僵尸 socket 自愈**;
4. `EPERM`(Windows):弹窗提示另一实例正以管理员运行;
5. 另写 `code.lock`(内容为 pid)作为锁文件,10 秒无响应弹"running but not responding"警告。

**(d) socket/named pipe 路径:确定性派生,无需注册表/环境变量也能找到**

`src/vs/base/parts/ipc/node/ipc.net.ts` 的 `createStaticIPCHandle(directoryPath, type, version)`:

- 路径由 userDataPath 的 `sha256` 前 8 个十六进制字符 + 版本前 4 位 + 类型前 6 位构成,server 与 client 天然一致;
- Windows:命名管道 `\\.\pipe\{scope8}-{version4}-{type6}-sock`;
- Linux:优先 `$XDG_RUNTIME_DIR/vscode-{scope}-{version}-{type}.sock`,否则 userDataPath 下;
- macOS:userDataPath 下 `{version4}-{type6}.sock`;
- 明确处理 `sun_path` 长度上限(Linux 107 / macOS 103,源码常量 `safeIpcPathLengths`),超长打警告;
- 主进程 `patchEnvironment()` 把 `VSCODE_IPC_HOOK=mainIPCHandle` 注入环境(`main.ts`),供子进程快速发现实例 —— 但路径本身确定性,env 只是加速器。

**(e) 通信协议**:不是裸 JSON,而是 VS Code 的 `base/parts/ipc` 通道协议(IPCServer/Protocol/ProxyChannel),同一套 channel 抽象横跨 Electron IPC、Node socket、MessagePort(架构文档:"CLI ↔ running instance" 走 Node IPC)。对 Murmur 的启示:用 JSON-RPC/NDJSON 自定义协议即可,重点是"确定性路径 + EADDRINUSE 收敛 + 陈旧 socket 自愈"这套流程。

**(f) CLI 调用时应用未运行怎么办**:VS Code 的答案分两层——本地子命令(扩展管理等)根本不需要应用在跑;打开文件的命令则**由 CLI 直接 spawn 一个新的 GUI 进程**(detached),新进程竞争 socket 锁后成为主实例。即"CLI 自己把应用拉起来"。

### 1.3 1Password:`op` CLI ↔ 桌面应用集成

来源:1Password 官方开发者文档(1password.dev,即 developer.1password.com 当前域名)。

- **启用方式**:桌面应用 Settings → Developer → "Integrate with 1Password CLI"。<https://www.1password.dev/cli/app-integration>
- **IPC 机制**(官方安全文档逐平台说明,<https://www.1password.dev/cli/app-integration-security>):
  - **macOS**:"The `NSXPCConnection` XPC API is used for IPC." 桌面应用拉起一个 XPC 服务(1Password Browser Helper),CLI 与应用都连它,helper "acts as a message relay between the 1Password app and 1Password CLI";
  - **Linux**:"1Password CLI connects to a Unix socket opened by the 1Password app",socket "owned by the current user/group, allowing any process started by this user to connect";
  - **Windows**:"1Password CLI connects to a named pipe opened by the 1Password app"。
- **连接方身份验证**(同上安全文档):
  - macOS:"Authenticity of both is confirmed by verifying the code signature"(双向代码签名校验);
  - Linux:`op` 二进制属 `onepassword-cli` 组且带 setgid 位,桌面应用检查连接进程的 GID,"If the GID doesn't match, the connection is reset before any messages are accepted";
  - Windows:双向 Authenticode 签名校验。
- **会话模型**:每个新终端窗口/tab 首次使用需 biometric 授权,建立 10 分钟会话(每次使用自动刷新),12 小时硬上限;会话凭据绑定 "the current `tty`, plus the start time"(Mac/Linux)或调用进程 PID(Windows);"When the 1Password app is locked, all prior authorization is revoked"。
- **应用未运行/锁定时**:官方安全文档未直接描述未运行场景;明确的是 "Authorizing use of 1Password CLI while the 1Password app is locked will result in the 1Password app unlocking"(授权动作会顺带把应用解锁)。CLI 在应用未运行时的具体报错行为:**未验证**(官方文档未列)。
- **分发**:`op` 与桌面应用**完全分开分发** —— macOS `brew install 1password-cli`(独立 cask,见 Homebrew 官方 API <https://formulae.brew.sh/api/cask/1password-cli.json>:binary `op` → `$HOMEBREW_PREFIX/bin/op`);Windows `winget install 1password-cli`;Linux 官方 apt/yum 仓库(`apt install 1password-cli`)。来源:<https://www.1password.dev/cli/get-started/>。注意该页明确:桌面应用的 "Integrate with 1Password CLI" 开关**不负责安装 CLI**,只负责集成。
- IPC 层公共代码:官方 Rust crate `onepassword-ipc-client`(<https://github.com/1Password/onepassword-ipc-client>),是 CLI↔桌面应用 IPC 的跨平台客户端参考实现。

### 1.4 Docker Desktop ↔ docker CLI

来源:Docker 官方文档。

- **机制**:docker CLI 是纯 REST API 客户端。Linux/macOS 走 HTTP over unix domain socket —— dockerd 官方文档:"By default, a unix domain socket (or IPC socket) is created at `/var/run/docker.sock`, requiring either root permission, or docker group membership"(<https://docs.docker.com/reference/cli/dockerd/>);Windows 走命名管道 `\\.\pipe/docker_engine`(另见 `docker_engine_windows` 用于 Windows 容器,来源:Docker 论坛,**非一手**:<https://forums.docker.com/t/error-response-from-daemon-open-pipe-docker-engine-windows-the-system-cannot-find-the-file-specified/131750>)。
- **Docker Desktop 的代理结构**:真正的 dockerd 跑在轻量 VM 中,Desktop 把 VM 内 daemon 的 API 代理到宿主机 socket/管道。macOS 设置项 "Allow the default Docker socket to be used":"Creates `/var/run/docker.sock` which some third party clients may use to communicate with Docker Desktop"(<https://docs.docker.com/desktop/settings-and-maintenance/settings/>)。
- **CLI 调用时 Desktop 未运行**:CLI 连不上 socket/pipe 直接报错退出(典型报错 "Cannot connect to the Docker daemon ... Is the docker daemon running?";此为社区教程转述,**一手文档未专门陈述**)——**Docker 模式 = CLI 不负责拉起后端,失败即报错**,与 VS Code 的"CLI 拉起应用"相反。
- **CLI 分发**(见第二节):Desktop 自带 CLI 并提供 System/User 两种 symlink 位置;同时 docker CLI 也可完全独立安装(Homebrew formula `docker` 即纯 CLI)。

### 1.5 Raycast CLI:官方无用户级 CLI(查证结论)

- Homebrew 官方 cask 元数据(<https://formulae.brew.sh/api/cask/raycast.json>):**只有 `app` + `uninstall`/`zap` artifact,没有 `binary` stanza** —— Raycast 不随应用分发任何 CLI 二进制。
- 官方对终端的答案:`raycast://` URL scheme deep link(从终端 `open "raycast://..."` 触发)与 Script Commands;面向开发者的 "Raycast CLI" 是 npm 生态工具(`@raycast/api` 附带,用于构建/开发/lint 扩展,<https://developers.raycast.com/information/developer-tools/cli>),不是面向用户的伴侣 CLI。
- 社区第三方 CLI `pomdtr/ray`(<https://github.com/pomdtr/ray>),非官方。
- Raycast 2026 "X-Ray" 跨平台重写(<https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast>)中是否有 CLI 计划:**未验证**(官方页面未见相关承诺)。
- 对 Murmur 的参照意义:一个以"键盘效率"著称的桌面工具长期没有官方 CLI 也能成立,但 2025-2026 的 agent 浪潮下,1Password/GitHub/Stripe/Cloudflare/Docker 全部补齐了 CLI/MCP 出口 —— CLI 伴侣正在从"可选"变成"agent 时代的默认界面"。

---

## 二、随应用分发的 CLI 的安装模式

### 2.1 macOS:app bundle 内二进制 + symlink

- **Homebrew Cask `binary` stanza(官方 DSL)**:"the source file is linked into the `$(brew --prefix)/bin` directory on installation";支持 `target:` 重命名;binary 可以指向 app bundle 内部路径。来源:Cask Cookbook <https://docs.brew.sh/Cask-Cookbook>。
- **VS Code 实测证据**(Homebrew 官方 API <https://formulae.brew.sh/api/cask/visual-studio-code.json>,artifacts 段):
  ```ruby
  binary "$APPDIR/Visual Studio Code.app/Contents/Resources/app/bin/code"       # → $HOMEBREW_PREFIX/bin/code
  binary "$APPDIR/Visual Studio Code.app/Contents/Resources/app/bin/code-tunnel" # → $HOMEBREW_PREFIX/bin/code-tunnel
  ```
  即 brew 安装 VS Code 时自动把 bundle 内 `bin/code` 壳脚本软链进 PATH —— **这正是 Murmur DRAFT cask(`docs/homebrew/murmur.rb`)缺的一行**。
- **VS Code 自身安装方式**(官方文档 <https://code.visualstudio.com/docs/setup/mac>):GUI 内 Command Palette 运行 "Shell Command: Install 'code' command in PATH";手动方式是把 `/Applications/Visual Studio Code.app/Contents/Resources/app/bin` 追加进 `~/.zprofile`/`~/.bash_profile` 的 `PATH`(文档给的命令即 PATH 方案,非 symlink)。注意 `code.sh` 的 `app_realpath()` 专门处理了"从 symlink 反解 .app 路径"——bundle 内脚本对被软链完全免疫。
- **Docker Desktop 4.89+ 的双选项**(<https://docs.docker.com/desktop/settings-and-maintenance/settings/>):System = "Install Docker CLI tools to `/usr/local/bin`"(需密码);User = "Install Docker CLI tools to `$HOME/.docker/bin`. This is the default with version 4.89.0 and later"且自动加入 PATH;Desktop 的自检会 "checks the symlinks of Docker binaries to `/usr/local/bin`" —— **趋势是从需要管理员权限的 `/usr/local/bin` 退到用户目录**(Apple Silicon 上 Homebrew 默认前缀也是 `/opt/homebrew/bin`,无需 sudo)。
- **1Password**:op 不随 app 分发,独立 cask(见 1.3)。

### 2.2 Windows:安装器写 PATH(主流) / App Execution Alias(系统机制)

- **VS Code NSIS/Inno 安装器(源码级证据,microsoft/vscode `build/win32/code.iss`)**:
  - 文件安装:把 `bin\code.cmd`(cmd 壳)、`bin\code`(bash 壳,供 Git Bash/WSL 互调用)、`bin\code-tunnel.exe` 装到 `{app}\bin`(第 103-105 行);
  - 可选任务 `addtopath`(默认勾选,第 91 行,无 `unchecked` flag;文案见 `build/win32/i18n/messages.en.isl`:"AddToPath=Add to PATH (requires shell restart)");
  - 注册表写入(第 1302 行):用户级安装写 `HKCU\Environment` 的 `Path`(expandsz),系统级写 `HKLM\...\Session Manager\Environment`,并有 `NeedsAddToPath()` 幂等检查;
  - 另写 `App Paths\code.exe` 注册表键,让资源管理器地址栏/运行框也能解析 `code`(第 1305 行)。
  - 官方文档侧只说 "Setup adds Visual Studio Code to your %PATH% environment variable"(<https://code.visualstudio.com/docs/setup/windows>)。
- **MSIX App Execution Alias(系统机制,依赖打包形态)**:打包应用通过 manifest 声明 `uap5:AppExecutionAlias` / `desktop:ExecutionAlias`,系统在 `%LOCALAPPDATA%\Microsoft\WindowsApps` 放置零字节 reparse-point 存根,用户可在 Settings → Apps → Advanced app settings → App execution aliases 逐应用开关。来源:<https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/desktop-to-uwp-extensions>、<https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-uap5-appexecutionalias>、<https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-desktop-executionalias>。**代价是必须 MSIX 化**,Murmur 目前是 NSIS(`docs/winget/Murmur.yaml` 的 `InstallerType: exe`),走 VS Code 式"安装器写 PATH"成本最低。
- **1Password Windows**:官方推荐 `winget install 1password-cli`;手动方式 = 下载 zip、放 `C:\Program Files\1Password CLI\`、自己加 PATH(官方页面提供自动化 PowerShell 一行流,见 <https://www.1password.dev/cli/get-started/>)。
- **Docker Desktop Windows**:Desktop 安装器管理 CLI 工具与管道权限;安装者自动加入 `docker-users` 组("If you performed the installation, you are automatically added to the `docker-users` group, but other users must be added manually",<https://docs.docker.com/desktop/setup/install/windows-permission-requirements/>)。

### 2.3 Linux

- **VS Code**:deb/rpm 安装到 `/usr/bin/code`(文档通过 `update-alternatives --set editor /usr/bin/code` 佐证该路径),并提示安装 apt/yum 官方仓库实现自动更新;snap 安装则在 `/snap/bin/code`。来源:<https://code.visualstudio.com/docs/setup/linux>。(deb 包内 `/usr/bin/code` 是否 symlink 指向 `/usr/share/code/code`:官方文档未说明,**未验证**。)
- **Docker / 1Password**:均走发行版包管理体系(apt/yum/apk 官方仓库,见上)。
- Murmur 当前不做 Linux 渠道,此节仅作模式参照。

### 2.4 模式小结

| 案例      | CLI 形态                                   | macOS PATH 方式                                        | Windows PATH 方式                                      | 与 GUI 的关系             |
| --------- | ------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------ | ------------------------- |
| VS Code   | bundle 内 shell 脚本(ELECTRON_RUN_AS_NODE) | Command Palette symlink / cask `binary` / 手动 PATH    | Inno task 写 HKCU/HKLM `Environment\Path`(`{app}\bin`) | 同一安装包,同版本         |
| 1Password | 独立 Go 二进制                             | 独立 cask `1password-cli`                              | 独立 winget 包                                         | **分开分发**,版本可不同步 |
| Docker    | 独立二进制(Go)                             | Desktop 建 `/usr/local/bin` 或 `~/.docker/bin` symlink | Desktop 管理 + `docker-users` 组                       | Desktop 自带 + 可独立安装 |
| Raycast   | 无                                         | 无(cask 无 binary stanza)                              | 无                                                     | —                         |

---

## 三、Agent 友好的 CLI 设计(2026 最佳实践)

### 3.1 结构化输出

- **gh(GitHub CLI)**:`--json` 必须带逗号分隔字段列表("The --json flag requires a comma separated list of fields to fetch");裸 `--json` 可列出该命令支持的字段;`--jq`(内置 jq 实现,"The jq utility does not need to be installed on the system")与 `--template`(Go template + sprig + hyperlink/tablerow 等 helper)做二次加工;"When connected to a terminal, the output is automatically pretty-printed"(**TTY 感知:人类 pretty-print,管道输出紧凑 JSON**)。来源:<https://cli.github.com/manual/gh_help_formatting>。
- **Stripe CLI**:`--json` — "Output the API response as structured JSON";且 "the CLI creates output files with 600 permissions for non-interactive environments"(非交互环境输出文件收紧到 0600)。来源:<https://docs.stripe.com/cli/tools/operations>、<https://docs.stripe.com/projects>。
- **wrangler(Cloudflare)**:部分命令 `--json`("Display output as clean JSON format instead of formatted text",如 `wrangler deployments`);2025-11-03 changelog 新增 `WRANGLER_OUTPUT_FILE_PATH` 环境变量,以 **ND-JSON** 捕获命令输出 —— 官方定位即面向脚本/agent 的结构化输出通道。来源:<https://developers.cloudflare.com/workers/wrangler/commands/>、<https://developers.cloudflare.com/changelog/post/2025-11-03-wrangler-output-file/>。全局 `--json` 仍有社区 issue 在推进(cloudflare/workers-sdk #2012、#3470),说明**"逐步铺开 per-command --json + 全局环境变量兜底"**是务实路径。

### 3.2 稳定退出码

- **gh 官方语义**(<https://cli.github.com/manual/gh_help_exit-codes>):0 = 成功;1 = "If a command fails for any reason";2 = "If a command is running but gets cancelled";4 = "If a command requires authentication"。并声明 "gh follows normal conventions regarding exit codes"。
- 给 Murmur 的映射建议(从 gh 语义推导):`0` 成功 / `1` 一般失败 / `2` 中断取消(如 Ctrl-C、转写取消)/ 专用码表示"GUI 未运行"(参考 Docker 的 "daemon not running" 类错误面)与"需要授权"。

### 3.3 stdin 管道与无 TTY 行为

- **VS Code 的 stdin 经验**(源码 `src/vs/code/node/cli.ts`,注释即一手证据):必须显式传 `-` 才读 stdin,原因写在注释里——"there is no reliable way to find out if data is piped to stdin. Just checking for stdin being connected to a TTY is not enough"(issue #40351);若检测到有数据流入但用户没写 `-`,1 秒后打印提示帮助用户。
- Stripe 在非交互环境的输出文件权限自动收紧到 600(见上),是"无 TTY 时更保守"的范例。
- 通用共识(由上述各官方文档综合):**无 TTY 时禁止交互式 prompt**、颜色/进度条自动关闭、错误以机器可读格式输出。

### 3.4 AGENTS.md 约定

来源:官网 <https://agents.md>(一手)。

- 定位:"Think of AGENTS.md as a README for agents: a dedicated, predictable place to provide the context and instructions to help AI coding agents work on your project."
- 治理:"AGENTS.md is now stewarded by the Agentic AI Foundation under the Linux Foundation";最初由 OpenAI Codex、Amp、Google Jules、Cursor、Factory 协作产生。
- 格式:"AGENTS.md is just standard Markdown. Use any headings you like; the agent simply parses the text you provide."
- 放置与发现:仓库根目录一份;monorepo 每个包内可再放;"Agents automatically read the nearest file in the directory tree, so the closest one takes precedence";"The closest AGENTS.md to the edited file wins; explicit user prompts override everything."
- 采用:VS Code、Cursor、Codex、Gemini CLI、Jules、Aider、Warp、Zed、Copilot coding agent 等,"over 60k open-source projects"。
- 与 CLAUDE.md/AGENTS.md 的关系:Murmur 仓库已有 AGENTS.md,天然符合该约定;CLI 若提供 `murmur doctor`/`murmur mcp` 类命令,其 README 化文档可同步沉淀进 AGENTS.md。

### 3.5 "同一 API 同时出 CLI 和 MCP"的并行建设案例

| 厂商       | CLI        | MCP 出口                                                                                                                                                                                                                                                                                                                           | 证据                                                                                           |
| ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GitHub     | `gh`       | `github-mcp-server`:远程托管在 `https://api.githubcopilot.com/mcp/`(OAuth/PAT),本地 Docker `ghcr.io/github/github-mcp-server`;toolsets 分组可按需启用;支持 read-only flag 与 lockdown mode                                                                                                                                         | <https://github.com/github/github-mcp-server>(官方 README)                                     |
| Stripe     | `stripe`   | 远程 MCP `https://mcp.stripe.com`(OAuth);agent plugin 打包 MCP server + agent skills 并自动更新                                                                                                                                                                                                                                    | <https://docs.stripe.com/mcp>、<https://github.com/stripe/ai>                                  |
| Cloudflare | `wrangler` | `mcp-server-cloudflare`:按领域拆分的远程服务器(Workers Bindings、Observability、Audit Logs 等,`https://bindings.mcp.cloudflare.com/mcp`,Streamable HTTP);另推荐 "Code Mode" 服务器用代码执行覆盖全 API                                                                                                                             | <https://github.com/cloudflare/mcp-server-cloudflare>                                          |
| Docker     | `docker`   | **`docker mcp` CLI 插件即 MCP Gateway**("The MCP Toolkit, in Docker Desktop, allows developers to configure and consume MCP servers from the Docker MCP Catalog. Underneath, the Toolkit is powered by..." mcp-gateway)—— MCP 网关直接做成了 CLI 子命令                                                                            | <https://github.com/docker/mcp-gateway>、<https://docs.docker.com/ai/mcp-catalog-and-toolkit/> |
| 1Password  | `op`       | **MCP server 内置在桌面应用**:`1password-mcp`(stdio;"runs locally on your computer as part of the 1Password desktop app";Settings → Labs 开启;首次对某 Environment 调用工具时 GUI 弹授权,批准后"until 1Password locks";"the server cannot return secret values stored in 1Password to the client, even if an agent requests them") | <https://www.1password.dev/environments/mcp-server/>                                           |

**趋势结论(从上表事实归纳)**:① 同一后端 API 双出口(CLI + MCP)已成一线厂商默认动作;② MCP 形态分化为"远程托管 URL + OAuth"(GitHub/Stripe/Cloudflare)与"本地 stdio + GUI 授权"(1Password)两派,**Murmur 本地优先的形态天然对应 1Password 派**;③ Docker 证明 MCP 网关本身可以作为 CLI 子命令存在(`docker mcp ...`),即 CLI 与 MCP 可以共享同一命令实现层。

---

## 四、本地 IPC 安全

### 4.1 Unix domain socket:文件权限位控制

- **ssh-agent(OpenBSD 手册,一手)**:socket 由 `SSH_AUTH_SOCK` 暴露路径;"It is accessible only to the current user, but is easily abused by root or another instance of the same user";FILES 节明确 "These sockets should only be readable by the owner";现代默认路径 `$HOME/.ssh/agent/s.*`(或 `-a` 指定),agent 退出自动清理(可选 `-u` 只清理陈旧 socket)。来源:<https://man.openbsd.org/ssh-agent>。
- **Docker**:默认 socket `/var/run/docker.sock`,"requiring either root permission, or docker group membership"(dockerd 官方文档);官方 postinstall 警告原句:**"The `docker` group grants root-level privileges to the user."**(来源:<https://docs.docker.com/engine/install/linux-postinstall/>);安全文档说明可用 "traditional Unix permission checks to limit access to the control socket",并记载历史教训:0.5.2 起把 API 从 `127.0.0.1` TCP 改为 unix socket,因为 TCP 方案 "prone to cross-site request forgery attacks"(来源:<https://docs.docker.com/engine/security/>)。**即:本地 socket 的安全模型 = 文件属主/权限位(chmod 0600/0660 + 组),权限即授权;能读写 socket 等于拿到服务全部能力,所以要配最小授权的服务端设计。**
- **1Password(Linux)**:socket "owned by the current user/group",同用户进程即可连接,安全靠**应用层的连接方校验**(GID + setgid,见 1.3)而非仅权限位。
- 实现注意(工程经验,非单一官方文档):Node.js `net` 创建的 unix socket 遵循 umask,常见做法是 bind 后立刻 `fs.chmodSync(path, 0o600)`;VS Code 将 socket 放在 userData/XDG_RUNTIME_DIR 下并依赖目录权限(源码见 1.2d)。

### 4.2 Windows named pipe:显式 DACL(默认 ACL 是开放的!)

来源(一手):Microsoft Learn "Named Pipe Security and Access Rights" <https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights>。

- 管道安全由 `CreateNamedPipe` 时的 security descriptor(DACL)控制,管两端;
- **关键陷阱原文**:"If you specify NULL, the named pipe gets a default security descriptor. The ACLs in the default security descriptor for a named pipe grant full control to the LocalSystem account, administrators, and the creator owner. **They also grant read access to members of the Everyone group and the anonymous account.**" —— 不显式设 ACL,同机任何用户可读;
- 首个实例的创建者之外,后续 `CreateNamedPipe` 需要 DACL 授予 `FILE_CREATE_PIPE_INSTANCE`;
- 防跨会话/远程访问的官方建议:"use the logon SID on the DACL for the pipe"(把管道锁定到当前登录会话);
- 另注意 `FILE_GENERIC_WRITE` 天然包含 `FILE_CREATE_PIPE_INSTANCE`(与 `FILE_APPEND_DATA` 同值),官方建议拆开用单独权限位。
- **Docker Desktop 实例**:特权 helper "listens on the named pipe `//./pipe/dockerBackendV2`",且 "only users that are part of the `docker-users` group can have access to it";非特权管道限制为 "The user that launched Docker Desktop"、Administrators 与 LOCALSYSTEM;官方同时警告(Windows 容器场景)"members of the `docker-users` group are able to elevate to administrators on the host"。来源:<https://docs.docker.com/desktop/setup/install/windows-permission-requirements/>。
- 实现注意(工程事实):Node.js 内置 `net` 模块创建 named pipe 时不暴露 `lpSecurityAttributes`,**默认即落入上述 "NULL → Everyone 可读" 的 DACL**;收紧需要原生模块/PowerShell 辅助或 Edge.js 层方案。Murmur 若在 Windows 上开管道,这是必须提前设计的点(未在单一官方文档汇总,属跨源工程结论;Node.js 无 ACL API 的事实可查 Node 官方 `net` 文档确认——**标注:建议实现前用 PoC 验证**)。

### 4.3 连接方认证与会话(token 握手模式)

- **VS Code 模式(无 token)**:socket 路径确定性派生(userDataPath 哈希,见 1.2d)+ 宿主目录权限;发现靠 `VSCODE_IPC_HOOK` 环境变量。路径不可枚举性提供了"弱 secret",本质仍依赖文件系统权限。
- **ssh-agent 模式(发现 + 权限)**:`SSH_AUTH_SOCK`(路径发现)+ socket 属主权限;不加密、不做协议级认证,信任边界就是 OS 用户。
- **Docker 模式(组授权)**:socket 属 root:docker;组成员即授权;无 token、无会话。
- **1Password 模式(强校验 + 短会话,最完备)**:协议握手前先做连接进程身份验证(macOS 代码签名 / Linux setgid GID / Windows Authenticode,双向);授权建立**有 TTL 的会话**(10 分钟滑动 + 12 小时硬上限);会话凭据绑定终端身份(tty+start time / PID),防跨终端串用;锁库即全部撤销。来源:<https://www.1password.dev/cli/app-integration-security>。
- **通用 token 握手(业界通行做法,综合上述案例归纳)**:服务启动时生成高熵随机 token,写入仅当前用户可读的位置(如 userData 下 0600 文件),CLI 连接后首条消息携带 token,服务端校验后绑定会话;敏感操作再加 GUI 确认(1Password 的授权提示)或 TTL。对 Murmur:这是 unix socket(chmod 0600)与 Windows pipe(ACL 受限时)之上成本最低的纵深防御。

---

## 五、对 Murmur 的直接启示

以下由上文事实推导,结合 Murmur 现状:ADR-004 已落地 `{userData}/murmur.json`(白名单键,DB > 文件 > 默认三级链)、`docs/homebrew/murmur.rb` 与 `docs/winget/Murmur.yaml` 均为 DRAFT 未发布、electron-builder 的 win 未配 target(默认 NSIS,与 winget manifest 的 `InstallerType: exe` 一致)。

1. **CLI 形态:学 VS Code,`ELECTRON_RUN_AS_NODE=1` 零依赖**。`murmur` 入口做成随 app 分发的壳脚本/`.cmd`(macOS bundle 内 `Contents/Resources/app/bin/murmur` + Windows `{app}\bin\murmur.cmd`),用 Electron 自带 Node 跑 CLI 主逻辑 —— 不要求用户装 Node/Python,CLI 与 GUI 永远同版本,Python 生命周期(funasrManager)语义不变。VS Code `resources/darwin/bin/code.sh` 与 `build/win32/code.iss` 是可直接照抄的模板。

2. **命令分两层:"本地子命令"与"实例命令"**。VS Code 的 `shouldSpawnCliProcess()` 模式(1.2b)证明:管理类命令不必经过 GUI —— `murmur config get/set`(读写 murmur.json,ADR-004 白名单)、`murmur history list/export`(读 SQLite)、`murmur doctor`、`murmur version` 应在 CLI 进程直接执行,**GUI 未运行也可用**;只有需要 FunASR 引擎/音频转写/AI 润色的命令才连接运行中的实例。

3. **实例 IPC:不要用 `second-instance` 承载转写命令**。`requestSingleInstanceLock` 是单向上抛(1.1),CLI 拿不到转写结果;而 `murmur transcribe` 的本质是请求-响应(1Password/Docker 模式)。建议:主进程监听**确定性路径**的 unix socket(macOS:userData 下,如 `{userData}/murmur.sock`)/ Windows named pipe(路径由 userData 派生,参考 VS Code `createStaticIPCHandle` 的 hash 方案,`src/vs/base/parts/ipc/node/ipc.net.ts`),协议用 NDJSON/JSON-RPC;务必实现 VS Code 式**陈旧 socket 自愈**(ECONNREFUSED → unlink → 重试)与路径长度上限(macOS sun_path 103)处理。`second-instance` 仍保留,但只用于"CLI 唤起 GUI"(如 `murmur open`)。
   - **应用未运行时的两种策略都要支持**(对照 1.2f/1.4):转写类命令默认报错并提示先启动 GUI(Docker 模式,简单可预测);提供 `--wait`/自动拉起开关(VS Code 模式)作为后续增强。

4. **分发:现有 DRAFT 渠道各补一步即可**。
   - macOS:`docs/homebrew/murmur.rb` 增加 `binary "#{appdir}/Murmur.app/Contents/Resources/app/bin/murmur"`(照抄 visual-studio-code cask 的写法,2.1);发布前该 cask 本就要提交 homebrew-cask(文件头注释已注明),binary stanza 一并 upstream。
   - Windows:NSIS 自定义脚本把 `{app}\bin` 写入 `HKCU\Environment\Path`(Murmur winget manifest 是 `Scope: user`,正好对应 HKCU 用户级,无需管理员;VS Code `code.iss` 第 1291-1302 行是逐行模板);winget manifest 无需结构性改动。
   - 两个渠道都注意:CLI 与 GUI 同包同版本(1Password 的"分开分发、版本漂移"是被动的产品现状,不是值得模仿的设计)。

5. **Agent 友好是发布标准,不是增强**:全局 `--json`(gh 式"字段列表 + 内置 jq"可选,MVP 先做全字段 JSON)、gh 式四档退出码(0/1/2 + 专用码)、stdin 支持(`murmur transcribe -` 读音频,遵循 VS Code 的显式 `-` 约定)、无 TTY 时零交互(所有 prompt 降级为错误码 + JSON 错误对象,含 machine-readable error code)。发布后在仓库 AGENTS.md(已是标准,3.4)中补 CLI 速查段。

6. **MCP:两条被验证的路线中选 1Password 路线**。Murmur 是本地桌面应用 + 本地数据,MCP server 应**内置在 Electron 主进程**(stdio,命令名如 `murmur-mcp`),工具层与 CLI 共享同一套实现(Docker 证明 MCP 可以就是 CLI 的子命令/同一层,3.5);敏感能力(读历史、发起转写)首次调用时走 GUI 确认 + 短 TTL 会话(1Password 模式,3.5/4.3)。远程托管 MCP(GitHub/Stripe 模式)与 Murmur 的本地优先定位不符,不建议首期做。

7. **安全设计(按优先级)**:
   - macOS/Linux:socket 放 userData(chmod 0600,bind 后显式 chmod);
   - Windows:**named pipe 默认 DACL 对 Everyone 开放读**(4.2 原文),而 Node `net` 不暴露 ACL 设置 —— 首期就应评估原生辅助或接受"路径不可猜 + token 握手"的补偿控制,并在威胁模型中记录;
   - 会话握手:启动时生成随机 token 写 userData(0600),CLI 首连携带;写操作(如 `config set`、转写历史删除)可要求 GUI 二次确认;
   - 参照 1Password 的 TTL/撤销语义:GUI 退出/锁定即关闭 socket(进程退出自然达成),避免长期有效凭据。

8. **风险与测试建议**(对应仓库 MUST DO #5):
   - IPC 属新增高风险面(对照 AGENTS.md 的 IPC 高风险清单):socket/管道生命周期(崩溃残留、端口占用、权限)需要 e2e 测试覆盖,尤其 Windows pipe ACL 行为需要 PoC 先行验证(本文标注的两个"未验证/需 PoC"点);
   - CLI 进程直接读 SQLite 有并发风险(node:sqlite 与 GUI 进程同库),建议只读命令用 WAL 只读连接,写命令走实例 IPC;
   - 退出码与 `--json` 输出 schema 一旦发布即成兼容性承诺,应先写契约测试(type-contract test)再实现。

---

## 附:未验证事项清单

| 事项                                          | 状态                          | 说明                                                                                                  |
| --------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| Raycast 2026 "X-Ray" 是否会出官方 CLI         | 未验证                        | 官方深度文章未见承诺                                                                                  |
| VS Code deb 包内 `/usr/bin/code` 是否 symlink | 未验证                        | 官方 Linux 文档未描述包内结构                                                                         |
| Docker CLI 在 Desktop 未运行时的确切报错文案  | 未验证(行为为常识,来源为社区) | 官方文档未专门陈述                                                                                    |
| 1Password `op` 在桌面应用未运行时的行为       | 未验证                        | 官方安全文档只覆盖"锁定"场景(会触发解锁)                                                              |
| Windows `docker_engine` 管道名细节            | 部分社区来源                  | 官方一手证据为 `dockerBackendV2`(helper 管道);`\\.\pipe\docker_engine` 为通行事实但本文未取得官方原文 |
| Node.js named pipe 无法设置 ACL               | 需 PoC                        | Node 官方 `net` 文档未提供 `lpSecurityAttributes`;实现前应写 PoC 验证(含 Electron 环境)               |
