# Murmur 客户端首航全面侦察报告

- **审计基线**:commit `353793b09e7e91a8cef2c0916b8ad560cdeaa662`(short hash `353793b`,2026-08-20 11:50:52 +0800,`origin/main` tip,detached HEAD)。
- **与船长参照的差异**:无。船长参照坐标即 `main@353793b` / v1.4.0;当前 tip 与参照完全一致。tag `v1.4.0` 打在其前 2 个 commit `8f1f60b`(353793b 是 v1.4.0 之后的 2 个 docs-only commit,无代码差异)。
- **审计性质**:只读调查 + 本 worktree 内安装依赖/跑测试。未改任何产品代码,未 commit,未推送分支,未触碰主克隆 `/Users/guanxueliang/Desktop/oh-my-ai/Murmur`。
- **报告日期**:2026-08-20。

---

## 0. 审计方法与环境

| 项         | 值                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------- |
| worktree   | `/Users/guanxueliang/.treehouse/Murmur-4865ca/1/Murmur`(git worktree,detached HEAD @ 353793b,clean) |
| OS         | macOS 26.6.2(Build 25G83),Apple Silicon                                                             |
| Node       | v24.15.0(系统 Node,ABI 137;`.nvmrc` = 24)                                                           |
| Electron   | 39.8.10(内含 Node 22.x,ABI 140)                                                                     |
| pnpm       | 11.1.2                                                                                              |
| Playwright | 1.60.0                                                                                              |

方法:通读 `main.ts` / `preload.ts` / `src/helpers/ipc-contracts.ts` / 全部 9 个 IPC handler 模块 + updateManager、全部 renderer 入口(`App.tsx`、`history.tsx`、`settings.tsx` + 4 个 section)、5 个 hook、`funasrManager.ts` / `funasrServer.ts`(关键段)/ Python 侧 `funasr_server.py`(关键段);对 43 个契约 channel 与 12 个 push event 做**双向矩阵核对**(renderer 调用 ↔ preload binding ↔ ipcMain handler ↔ 底层 service ↔ 事件 sender/listener);比对 `tests/unit`(115 文件)、`tests/e2e/suites`(13 文件)、`tests/python`(8 文件)与 CI workflow;最后在本机实跑 unit + e2e 两轮。

---

## 1. 功能清点与实现核对

三档结论:**完好**(代码路径、IPC 链、UI 入口全部就位)/ **断裂**(链路存在但某环断开或承诺未兑现)/ **缺失**(功能点不存在)。逐项附证据(file:line 基于 353793b)。

### 1.1 语音输入(实时录音 → 识别 → 自动粘贴)— **完好**

- **代码路径**:renderer `src/hooks/useRecording.ts`(MediaRecorder 采集 → `convertToWav` 16kHz PCM → `transcribeAudio`);main 侧 `src/helpers/ipc/transcriptionHandlers.ts:214`(AUDIO handler:T14 热词注入 + 空热词重试)→ `src/helpers/funasrManager.ts:131` → `src/helpers/funasrServer.ts:491` → Python `funasr_server.py`。
- **IPC 链**:`TRANSCRIPTION.AUDIO`("transcribe-audio"):`useRecording.ts:193` 调用 → `preload.ts:62` 暴露 → `transcriptionHandlers.ts:214` handler → funasrManager。payload 两端一致(audioData + options,热词在 main 侧注入,preload 签名未动)。
- **UI 入口**:主窗麦克风按钮 `src/App.tsx:597-644`(data-testid="mic-button"),全局热键 `CommandOrCtrl+Shift+Space`(`App.tsx:287` 注册,`hotkeyHandlers.ts:33` → `hotkeyManager.ts:46` globalShortcut)。T12 空闲卸载后热键按下预热重载:`useRecording.ts:85` `reloadFunasrModels()` → `environmentHandlers.ts:79`(fire-and-forget)→ `funasrManager.ts:391` → `funasr_server.py:1191 _do_reload`。链完整。
- **备注**:录音完成后自动粘贴链 `safePaste`(`App.tsx:94-129`)→ `CLIPBOARD.PASTE/COPY` → `clipboard.ts`(AppleScript/robotjs 路径),受 `auto_paste` 设置控制,链完整。

### 1.2 AI 文本润色 — **完好**(一处死设置见 1.6/§3)

- **代码路径**:`src/helpers/ipc/aiHandlers.ts`(processTextWithAI,588 行起 handler;BUILT_IN_MODES:optimize/optimize_long/format/correct/summarize/enhance/xiaohongshu…),prompt 模板 `src/helpers/aiPrompts.ts`(内置 + userData/templates 自定义模板)。
- **IPC 链**:`AI.PROCESS`:`useRecording.ts:270`(自动润色)/ `TranscriptionResult.tsx:118`(手动润色)→ `preload.ts:75` → `aiHandlers.ts:588` → OpenAI 兼容 HTTP。`AI.GET_MODES`:`TranscriptionResult.tsx:97` → `preload.ts:78` → `aiHandlers.ts:612`。`AI.CHECK_STATUS`:`useSettings.ts:316`(测试连接)→ `aiHandlers.ts:598`。`AI.GET_PROVIDER_PRESETS` / `AI.DETECT_LOCAL_MODELS`:`useSettings.ts:409/413` → `aiHandlers.ts:616/620`。全部两端对齐。
- **UI 入口**:设置 → AI 配置(API Key/base_url/model/temperature/max_tokens/测试连接/供应商预设/本地模型探测);结果卡片手动润色按钮(`ProcessingPanel`);文件转录结果的 AI 创作稿(`FileImport.tsx` `aiReviewTranscription` → `TRANSCRIPTION.AI_REVIEW` handler `transcriptionHandlers.ts:455`)。
- **备注(半断裂)**:`default_mode` 设置只有读取端、没有写入端——`useRecording.ts:238`、`useFileTranscription.ts:184` 读它,但设置 UI 无此控件,且它不在 `settingsHandlers.ts:16` 的 `ALLOWED_SETTING_KEYS` 里(写会被 `validateSetting` 拒绝),因此永远是 null,恒走 `enable_ai_optimization` 迁移路径。功能可用,但"选择默认处理模式"这个已实现一半的能力对用户不可达(详见 §3-G、§6 建议 2)。

### 1.3 文件转录(导入/拖拽/进度/取消/说话人分离)— **完好**

- **代码路径**:renderer `src/hooks/useFileTranscription.ts` + `src/components/FileImport.tsx` / `FileDropZone.tsx` / `TranscriptionProgress.tsx`;main 侧 `transcriptionHandlers.ts:268`(VALIDATE)/`:294`(TRANSCRIBE_FILE:校验 → 热词注入+fallback → T10 清洗 → 存库 → 返回 id)。
- **IPC 链**:`IMPORT_FILE`(dialog,`transcriptionHandlers.ts:235`)、`VALIDATE_FILE`(`useFileTranscription.ts:68` 调用)、`TRANSCRIBE_FILE`(`:156`)、`CANCEL`(`:238`)、进度 push `EVENTS.FILE_TRANSCRIPTION_PROGRESS`(sender `transcriptionHandlers.ts:307` ↔ listener `useFileTranscription.ts:148`)全部两端对齐。路径校验走 `src/helpers/audioPathValidator.ts`(Windows C:\ 全放行 / UNC 早拒;macOS realpath + /Volumes 前缀)。
- **说话人分离**:`TRANSCRIPTION.DIARIZE`:`TranscriptionResult.tsx:81`(`diarizeAudio(id)`)→ handler `transcriptionHandlers.ts:355` → `funasrServer.ts:616` → Python speaker 模型(懒加载)。UI 按钮 `TranscriptionResult.tsx:293-300`(仅 segments 存在且有 id 时渲染——文件转录路径满足)。
- **UI 入口**:主窗"文件导入"tab(`App.tsx:578-587`)→ 拖拽/选择 → 开始转录 → 进度+取消 → 结果+导出+说话人分离。

### 1.4 转录历史 — **完好**(两个小缺口)

- **代码路径**:独立窗口 `src/history.tsx`(searchbar 客户端过滤 `:89-97`、复制 `:25`、删除 `:125`、导出全部 `:178`);DB 层 `src/helpers/database.ts`。
- **IPC 链**:`WINDOW.OPEN_HISTORY`(`App.tsx:365` 历史按钮)→ `windowHandlers.ts:103` → `windowManager.ts`(第三个窗口,preload 同一份,`windowManager.ts:203-205`);`GET_ALL`(`history.tsx:105`)、`DELETE`(`:125`)、`EXPORT_ALL`(`:178`)handler 分别在 `transcriptionHandlers.ts:511/522/530`。
- **缺口①**:`TRANSCRIPTION.CLEAR`("clear-all-transcriptions")handler(`transcriptionHandlers.ts:526`)+ preload binding(`preload.ts:93`)存在,但 history UI **没有"清空全部"按钮**,renderer 零调用(半孤儿,§3-E)。
- **缺口②**:历史窗"导出全部"硬编码 `exportTranscriptions("txt")`(`history.tsx:178`),而单条导出 UI 支持 txt/srt/vtt/md/docx(`ExportPanel.tsx:4-10`)、`EXPORT_ALL` handler 与 `exportFormatters` 本可支持多格式——全部导出只有 txt。

### 1.5 热词(T14,2026-08 新增)— **完好**

- **代码路径**:设置 UI `GeneralSection.tsx:160-186`(多行 textarea,限额提示 200 行 × 32 字);边界清洗 `src/helpers/hotwords.ts`(`sanitizeHotwordInput`,控制字符/lone surrogate/码点截断);注入 `transcriptionHandlers.ts:147`(`injectStoredHotwords`,settings 同步读 + 调用方热词优先 + 失败不阻断);空热词重试 `withHotwordFallback`(`:185`,cancel 不可重试);Python 侧二次防御 `funasr_server.py:120 sanitize_hotword`。
- **IPC 链**:无专用 channel(复用 SETTINGS.SET + TRANSCRIPTION.AUDIO/TRANSCRIBE_FILE options 注入——设计如此,preload/IPC 签名未动)。降级提示:`hotword_degraded` → `useRecording.ts:198-204` / `useFileTranscription.ts:165-171` → i18n toast(`recording.hotwordDegraded`)。
- **UI 入口**:设置 → 通用 → 热词。四地同步(`SettingsState`/`DEFAULT_SETTINGS`/loadSettings builder/saveSettings 循环 + `ALLOWED_SETTING_KEYS` 含 "hotwords")全齐;且刻意不入 `~/.murmur.json` 明文(`fileConfig.ts:8-20` FILE_CONFIGURABLE_KEYS 注释 + hotwords 排除)。

### 1.6 设置 — **基本完好,一处断裂(热键自定义)**

- **代码路径**:独立设置窗 `src/settings.tsx`(4 section:general/permissions/ai/about)+ `src/settings/useSettings.ts`(481 行:getAllSettings 加载 / handleInputChange 即时持久化 / saveSettings 显式保存循环 / 主题即时应用 / 更新下载状态机)。
- **IPC 链**:`SETTINGS.GET/SET/GET_ALL/SAVE/RESET`(`settingsHandlers.ts:77-114`,allowlist 校验 + API key 脱敏 `maskApiKey` + `SETTINGS_UPDATE` 广播 `:70-75`);renderer 监听 `onSettingsUpdate` 刷新缓存(`App.tsx:349-353`)与模型状态(`useModelStatus.tsx:371-378`)。持久化三层:SQLite(safeStorage 加密 `ai_api_key`,`database.ts:74/94`)+ `~/.murmur.json`(白名单键)+ 广播。链完整。
- **断裂点(承诺未兑现)**:热键注册失败时 toast 说"可在设置中更换快捷键"(`App.tsx:289-291`),但设置四个 section **均无热键设置控件**;热键硬编码 `CommandOrControl+Shift+Space`(`App.tsx:287`),`useHotkey.ts` 只读 `getCurrentHotkey` 不读任何设置键。而基础设施全部就位:`ALLOWED_SETTING_KEYS` 有 `"hotkey"`(`settingsHandlers.ts:27`)、`FILE_CONFIGURABLE_KEYS` 也有 `"hotkey"`(`fileConfig.ts:16`)、`HOTKEY.REGISTER/UNREGISTER` handler(`hotkeyHandlers.ts:33/79`)与 preload binding 都在——**只差一个 UI 控件和一行读取**,属于"承诺了但没做"的断裂(§3-F、§6 建议 1)。
- **自动持久化**:`handleInputChange` 逐键 `setSetting`(`useSettings.ts:221-226`),修复过 General 页丢设置的问题,行为与注释一致。

### 1.7 i18n(中/英)— **部分断裂**

- **代码路径**:`src/i18n/index.ts`(i18next,zh-CN/en,localStorage 持久化)+ `locales/{zh-CN,en}.json`。
- **已接入**:设置窗全部(`settings.tsx` + 4 sections + `useSettings.ts` 全部 toast)、权限、关于、热词降级提示(`useRecording.ts:203`)。
- **断裂**:主窗口 `App.tsx` 与历史窗 `history.tsx` **完全没有接入 i18n**——`App.tsx` 无 `useTranslation` import,标题栏 tooltip("最小化/历史记录/设置")、模式 tab("实时录音/文件导入")、模型状态文案(`getStageStatusText`,`App.tsx:32-45`)、历史窗全部文案("Murmur - 转录历史"、"搜索转录内容…"、"暂无转录历史"等 `history.tsx:52/165/203`)均为硬编码中文。**切换语言后只有设置窗口变英文,主窗与历史窗仍是中文**。单元测试 `phase4-i18n.test.ts` 只验证依赖/配置/locale 文件结构,不验证主窗接入度,所以一直绿(§4)。
- 结论:i18n 作为"产品支持双语"的宣称,当前只兑现了约一半(settings + 部分流式提示)。

### 1.8 双平台支持(Windows / macOS)— **完好**

- **代码路径**:`src/helpers/pythonEnvironment.ts:57-71`(Windows `python/python.exe` + `Lib/site-packages`;macOS `bin/python3.11` + `lib/python3.11`);进程管理 `funasrServer.ts` gracefulShutdown(Windows `taskkill /T /F`,Unix SIGKILL,有 `funasrServer-killtree.test.ts` 看护);路径校验 `audioPathValidator.ts` 双平台分支;`main.ts:95-127` 双平台 PATH 注入;`scripts/prepare-embedded-python.js` 双平台下载器。
- **CI**:`ci.yml` unit job 是 **macos-latest × windows-latest 矩阵(阻塞)**;`build.yml` 发布产物 build-win(windows-latest)+ build-mac(macos-latest),五道发布门(native ABI / preload 存在 / Python 打包 import 门 / mac+win 打包 boot smoke / NSIS 命名)。
- **测试**:`windows-compat.test.ts`、`pythonEnvironment-embedded-layout.test.ts`、`funasrServer-killtree.test.ts`、CI 配置自检 `ci-config.test.ts`/`phase1-ci-config.test.ts`。

### 1.9 模型管理(检测/下载/idle-unload/reload)— **完好**

- **代码路径**:`src/helpers/modelManager.ts`(checkModelFiles/downloadModels,断点续传 + `MODEL_DOWNLOAD_PROGRESS` 进度);`funasrManager.ts:13-25`(idle-unload 常量,`MURMUR_IDLE_UNLOAD_MS` 可覆盖,clamp [10s,24h],默认 5min)+ `_resetIdleUnloadTimer`/`_onIdleUnloadTimeout`(`:348-385`,转写计数器防中途卸载);SeACo-Paraformer 主模型 + 旧模型回退(`funasr_server.py:311-315`,PR#200)。
- **IPC 链**:`MODELS.CHECK/DOWNLOAD`(`useModelStatus.tsx:70/227` → `modelHandlers.ts:22/26`);`FUNASR.STATUS`(3 秒轮询 `useModelStatus.tsx:291`);`FUNASR.RESTART`(下载完成后自动重启 `useModelStatus.tsx:241`);`FUNASR.RELOAD_MODELS`(热键预热,见 1.1)。全部两端对齐。
- **UI 入口**:模型未就绪时主窗内联下载区(`App.tsx:678-687` `ModelDownloadProgress` + 下载按钮)+ FTUE 三步引导(`App.tsx:668-675`)。

### 1.10 应用内更新检查(semi-auto)— **完好**

- **代码路径**:`src/helpers/updateManager.ts`(GitHub Releases API + 平台资产 + checksums 校验,`UPDATE.CHECK/DOWNLOAD/CANCEL/INSTALL` 四 handler `:105/148/287/295`;三个进度事件 sender `:223/248/277`)。
- **IPC 链**:`useSettings.ts:354/388` + `AboutSection.tsx:57/107/129/155`(检查/下载/取消/安装按钮)→ preload → handler;三个 update 事件 listener `useSettings.ts:420-436`。链完整。
- **UI 入口**:设置 → 关于 → 检查更新 → 版本卡片(下载/进度条/取消/安装)。

### 1.11 剪贴板 / 自动粘贴 — **完好**(见 1.1;`CLIPBOARD.COPY/PASTE` handler `clipboardHandlers.ts:25/34`,UI:结果卡片复制、设置三档 auto_paste)。

### 1.12 窗口管理(置顶/最大化/托盘/关闭行为)— **完好**

- `WINDOW.MINIMIZE/MAXIMIZE/CLOSE/CLOSE_APP/SET_TOP`(`App.tsx:310-320`、`GeneralSection.tsx:37` setAlwaysOnTop 即时生效)→ `windowHandlers.ts`;`WINDOW_MAXIMIZE_CHANGE` 事件(sender `windowManager.ts:123/133` ↔ listener `App.tsx:323`);托盘(`tray.ts:106-145`:显示主窗口/关于/退出,直接调 windowManager 不走 IPC);关闭行为 hide|quit 设置(`App.tsx:299-308`)。
- **备注**:sandbox:true + CSP(`windowManager.ts:42-60/92`)三个窗口一致;preload 路径 `app.getAppPath()` 相对解析(打包/开发双态)。

### 1.13 权限(麦克风/辅助功能)— **完好**(handler 侧三个孤儿见 §3-E)

- 设置 → 权限:麦克风测试(`usePermissions.ts` `navigator.mediaDevices.getUserMedia`)与辅助功能测试(实际 `pasteText("Murmur辅助功能测试")` 验证)。UI 就位。
- **半孤儿**:`SYSTEM.PERMISSIONS/REQUEST_PERMS/OPEN_PERMS` 三个 handler(`systemHandlers.ts:53/71/93`)+ preload binding 存在但 renderer 零调用——权限页走的是上面两条更真实的路径,这三个 handler 是遗留(§3-E)。

### 1.14 FTUE 首用引导 — **完好**(模型缺失时:下载提示 + mic 禁用 + 三步引导文案,`App.tsx:652-675`;e2e `00-ftue` 三用例看护)。

### 1.15 日志 / 诊断 — **完好**(`SYSTEM.LOG`(`systemHandlers.ts:111`)渲染进程 33 处调用 → `logManager.ts`;`SYSTEM.DEBUG_INFO`(`systemHandlers.ts:127`)有 e2e 调用。`SYSTEM.INFO/VERSION/OPEN_EXTERNAL` 各有真实调用)。

---

## 2. IPC 契约完整性总评

- **43 个双向 channel**:全部有 handler(`ipc-contract-completeness.test.ts:305` 有自动化断言看护)、全部 preload binding 有 `ElectronAPI` d.ts 同步(`preload.ts:46` 类型注解 + `pnpm typecheck` 把关)。**不存在"有调用无 handler"或"有 handler 无 binding"的断裂**。
- **payload 两端核对**:抽对的全部通道(audio/file/settings/hotkey/update/model)参数顺序与形态一致;唯一注意点:`useRecording.ts:193` 传 `arrayBuffer` 而非 `uint8Array`(同源同值,无实害)。
- **孤儿端清单**(renderer caller 维度,仓库自带测试网不到的区域)见 §3。

---

## 3. 孤儿端与断裂点清单(按严重度)

| #   | 类型                                                 | 位置                                                                                                                                | 事实                                                                                                                                                                                | 影响                                                                                                                                                |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **死事件(有 listener 无 sender)**                    | `EVENTS.PROCESSING_UPDATE`("processing-update")                                                                                     | `useModelStatus.tsx:344-369` 注册监听并处理 `model_initialization`;全仓库(main.ts/src/helpers/preload.ts)无任何 `send(PROCESSING_UPDATE)`                                           | 模型初始化推送永远不达,模型状态只能靠 3s 轮询兜底(功能未坏,事件白发)。契约注释自称该事件是 "model status changes"(`src/types/ipc.ts:265`)——名不副实 |
| B   | **双端死事件**                                       | `EVENTS.TRANSCRIPTION_UPDATE`、`EVENTS.ERROR`                                                                                       | preload 有 binding(`preload.ts:164/176`),main 无 sender,renderer 无 listener                                                                                                        | 纯死代码;只有 `preload-listener-lifecycle.test.ts` 在测 preload 包装本身                                                                            |
| C   | **孤儿 emitter**                                     | `EVENTS.FUNASR_INSTALL_PROGRESS`("funasr-install-progress")                                                                         | `environmentHandlers.ts:72` 发送,但 preload **没有**对应 onXxx binding,renderer 无监听                                                                                              | 安装进度事件永远无人收(且唯一触发通道 FUNASR.INSTALL 本身是孤儿,见 D,双死)                                                                          |
| D   | **孤儿 invoke(有 handler+binding 无 renderer 调用)** | `FUNASR.INSTALL`("install-funasr")                                                                                                  | handler `environmentHandlers.ts:70`,binding `preload.ts:64`,src/ 零调用                                                                                                             | FunASR/Python 安装无 UI 入路。打包场景靠 embedded python 无碍;开发/损坏场景只能 CLI                                                                 |
| E   | **半孤儿 invoke(同上,遗留基础设施)**                 | `WINDOW.SHOW`、`WINDOW.IS_MAX`、`SETTINGS.SAVE`("save-setting")、`SYSTEM.REQUEST_PERMS`、`SYSTEM.OPEN_PERMS`、`TRANSCRIPTION.CLEAR` | handler + binding 齐,renderer 零调用(SHOW 由托盘直调 `mainWindow.show()` 绕过 IPC;SET 通道已覆盖 SAVE 的用途;CLEAR 无"清空全部"按钮)                                                | 死代码面;CLEAR 缺 UI 是用户可感的功能缺口(历史只能逐条删)                                                                                           |
| F   | **断裂(承诺未兑现)**                                 | 热键自定义                                                                                                                          | `App.tsx:289-291` toast "可在设置中更换快捷键";设置无该控件;热键硬编码 `App.tsx:287`;而 `"hotkey"` 键在 allowlist + fileConfig 白名单都预留了,`HOTKEY.REGISTER/UNREGISTER` IPC 全在 | 用户被 toast 指向一个不存在的设置项;基础设施全就位,只差 UI                                                                                          |
| G   | **死设置**                                           | `default_mode`                                                                                                                      | 读端:`useRecording.ts:238`、`useFileTranscription.ts:184`;写端:UI 无控件,且不在 `ALLOWED_SETTING_KEYS`(`settingsHandlers.ts:16-34`),setSetting 会被拒                               | "默认 AI 处理模式"永远 null,恒走 `enable_ai_optimization` 布尔迁移路径;模板/模式选择只存在于单次结果面板                                            |
| H   | **i18n 覆盖断裂**                                    | 主窗 + 历史窗                                                                                                                       | `App.tsx`/`history.tsx` 无 useTranslation,文案硬编码中文                                                                                                                            | 切英文后主窗/历史窗仍中文;双语宣称兑现一半                                                                                                          |

**为什么仓库自己的网没兜住**:`ipc-contracts-orphans.test.ts:68` 只要求 channel 被 "handler **或** preload" 引用即算非孤儿——renderer caller 维度不在网内;`ipc-contract-completeness.test.ts` 只保证 handler 存在。A–E 全部漏网。这是测试网的结构性盲区(§4)。

---

## 4. 测试看护审计(功能 → 测试映射)

### 4.1 映射表

| 功能         | unit(vitest)                                                                                                                                                                                                                                                                                     | e2e(Playwright)                                                                                           | python(stdlib unittest)                                                                                                                                                                       | 评级                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 语音输入     | `useRecording.test.tsx`(55.6K,最大单文件:采集/转换/识别回调/AI 超时/保存)、`transcriptionHandlers.test.ts`、`funasrServer-transcribe.test.ts`、`app-behaviors.test.tsx`                                                                                                                          | `03-recording.test.ts`(6 用例,**IPC mock 驱动**:`ipc-mock.ts`)                                            | `test_funasr_server_protocol.py`、`test_server_preprocess_wiring.py`、`test_unload_reload.py`、`test_suppress_stdout_thread_safety.py`、`test_seaco_fallback.py`、`test_inference_threads.py` | **看护强,但真实音频→Python 全链路无 e2e**(依赖 mock + python 单测拼合;可接受的重模型策略)    |
| AI 润色      | `aiHandlers.test.ts`、`aiPrompts.test.ts`、`aiPrompts-few-shot.test.ts`、`ai-config-expanded.test.tsx`、`determineProcessingMode.test.ts`                                                                                                                                                        | `03-recording` 3.4/3.5(mock 成功/失败)、`10-errors` 10.1                                                  | —                                                                                                                                                                                             | 强(mock 边界有失败用例)                                                                      |
| 文件转录     | `useFileTranscription.test.tsx`(22.3K)、`file-import.test.tsx`、`audioPathValidator-branches/symlink.test.ts`、`audioFileHelpers.test.ts`、`transcriptionHandlers-clean.test.ts`、`dynamicTranscriptionTimeout.test.ts`、`export-formatters(.coverage).test.ts`                                  | `05-file-import.test.ts` **只测 3 条:tab 切换 + validate 通过/拒绝**;转录/取消/进度/说话人分离 **无 e2e** | `test_audio_preprocessing.py`                                                                                                                                                                 | **e2e 薄弱**:主流程只有 unit(mock seam);validate 之外全靠 unit                               |
| 转录历史     | `history-page.test.tsx`、`database(.coverage/-branches/-error-paths/-init-errors/-encryption-failure).test.ts`、`fileConfig(.errors).test.ts`                                                                                                                                                    | `08-history.test.ts`(getTranscriptions/客户端搜索/删除)                                                   | —                                                                                                                                                                                             | 中;"导出全部"、CLEAR 无任何测试(CLEAR 连 UI 都没有)                                          |
| 热词         | `hotwords.test.ts`(sanitize 单测)、`hotword-injection.test.ts`(注入+fallback seam)                                                                                                                                                                                                               | **无**                                                                                                    | `test_server_preprocess_wiring.py`(Python 侧)                                                                                                                                                 | **无 e2e**;unit 覆盖 sanitize 与注入边界,UI 端到端空白                                       |
| 设置         | `settingsHandlers.test.ts`、`useSettings-hook.test.tsx`(33.2K)、`settings-sections.test.tsx`、`general-section.test.tsx`、`settings-refactor.test.ts`、`providerPresets.test.ts`                                                                                                                 | `07-settings.test.ts`(set/get、getAll、presets)                                                           | —                                                                                                                                                                                             | 强                                                                                           |
| i18n         | `phase4-i18n.test.ts`(依赖/配置/locale 文件结构,**不测接入度**)                                                                                                                                                                                                                                  | 无                                                                                                        | —                                                                                                                                                                                             | **薄弱**:主窗/历史窗未接入这件事测试网不可见(§3-H 的根因)                                    |
| 双平台       | `windows-compat.test.ts`、`pythonEnvironment-embedded-layout.test.ts`、`funasrServer-killtree.test.ts`、`ci-config.test.ts`                                                                                                                                                                      | e2e 仅 macOS 本地/CI 单平台                                                                               | —                                                                                                                                                                                             | 中强(CI 矩阵双平台跑 unit)                                                                   |
| 模型管理     | `model-download-guards.test.ts`、`modelManager-shape.test.ts`、`funasrManager-idle-unload.test.ts`、`funasrManager-init-race.test.ts`、`funasrManager-orchestration.test.ts`(28.6K)、`funasrServer-crash-restart/spawn/reload-suppression.test.ts`、`seaco-model-catalog/fallback-check.test.ts` | `02-model-download.test.ts`(4 状态用例,mock)                                                              | `test_seaco_fallback.py`、`test_unload_reload.py`                                                                                                                                             | **强**(T12/SeACo 两个新特性看护充分)                                                         |
| 更新         | `updateManager-behavioral.test.ts`、`updateManager-require-resolution.test.ts`、`phase3-semi-auto-update.test.ts`                                                                                                                                                                                | 无                                                                                                        | —                                                                                                                                                                                             | 中(纯 unit;下载/校验安装链无 e2e——可理解,涉及真实网络)                                       |
| 剪贴板       | `clipboardHandlers.test.ts`                                                                                                                                                                                                                                                                      | `06-clipboard.test.ts`(3 用例)                                                                            | —                                                                                                                                                                                             | 中强                                                                                         |
| 窗口/托盘    | `windowHandlers.test.ts`、`windowManager-events.test.ts`                                                                                                                                                                                                                                         | `09-window.test.ts`(minimize/maximize/置顶)                                                               | —                                                                                                                                                                                             | 中强(托盘菜单本身无自动化)                                                                   |
| 权限         | `usePermissions.test.ts`                                                                                                                                                                                                                                                                         | **无**(permissions section 无 e2e)                                                                        | —                                                                                                                                                                                             | 中弱                                                                                         |
| FTUE         | —                                                                                                                                                                                                                                                                                                | `00-ftue.test.ts`(3 用例)                                                                                 | —                                                                                                                                                                                             | 中(e2e-only)                                                                                 |
| IPC 契约自身 | `ipc-contract-completeness/orphans/contracts.test.ts`、`preload-bridge-contract/loadable/listener-lifecycle.test.ts`、`ipcRateLimiter(.Integration).test.ts`、`backend-type-safety.test.ts`                                                                                                      | `00-boot-health` 0.2/0.3(全域 handler 应答 + preload 50+ 方法)                                            | —                                                                                                                                                                                             | **强但有盲区**:orphans 测试只看 handler-or-preload,renderer caller 维度无网(§3 A–E 漏网根因) |

### 4.2 明确的"无看护"功能点

1. `TRANSCRIPTION.CLEAR` / "清空全部历史"(无 UI、无测试)。
2. 历史窗"导出全部"(UI 存在,无 e2e;unit 只有 exportFormatters 纯函数)。
3. 热词 UI 端到端(设置→录入→下一次转写生效→降级 toast;仅 seam 单测)。
4. 说话人分离(diarize)任何 e2e。
5. 权限 section 任何 e2e。
6. 更新下载/安装链 e2e。
7. 托盘菜单行为。

### 4.3 看护薄弱点

1. **e2e 在 CI 全部 `continue-on-error: true`**(`ci.yml` 最后三步)——e2e 失败**不阻塞合并**;且如 §5 所证,CI 的步骤顺序(unit 前 rebuild 到系统 ABI)使 e2e 在 CI 上**结构性必挂**(better-sqlite3 ABI 不匹配 → main 进程 ERR_DLOPEN_FAILED → firstWindow 超时)。也就是说:**仓库的 e2e 资产在 CI 上从未真正绿过,也从未拦过任何回归**。boot-health 步骤自己的注释也承认 "STATUS: NON-BLOCKING until validated on real macOS"。
2. `phase4-i18n.test.ts` 只测 i18n 基础设施,不测组件接入度 → §3-H 长期不可见。
3. e2e 大量依赖 `ipc-mock.ts`(`03-recording` 等)——测的是"renderer 在 mock 响应下的行为",真正 main 进程 handler 只被 `00-boot-health 0.2`(存在性应答)覆盖。**且该 mock 基建本身已坏**(`require is not defined`,§5.3-①):11/19 失败源于此,意味着所有 mock 驱动的 e2e 自 ADR-010 bundle 化起就不可运行。
4. `preload-listener-lifecycle.test.ts` 对死事件 TRANSCRIPTION_UPDATE/ERROR 的 binding 做了生命周期测试——测的是死代码的生命周期。
5. e2e 存在**测旧架构残留**的用例(§5.3-②:1.5 测已删除的 in-app settings route;2.4/8.1 的 payload 断言与现行契约不符)——与"从未真正跑过"互为因果。

---

## 5. e2e 实测

### 5.1 入口与前置(先读到的)

- 入口:`pnpm test:e2e` = `playwright test --config playwright.config.ts`;testDir `tests/e2e/suites`,**workers:1**,timeout 45s,retries 0;`global-setup.ts` 先 build main/preload/renderer 三 bundle。
- 隐含前置(文档化在 CLAUDE.md,不在 script 里):**Electron ABI 的 better-sqlite3**——`npx @electron/rebuild -f -w better-sqlite3`。CI 里这一步不存在于 e2e 之前(见 4.3-1)。
- 隔离:每测例 `MURMUR_DB_PATH=:memory:`(`electron-launch.ts:237`),DB 不落盘;但 userData 仍是真实的 `~/Library/Application Support/murmur`(设置页测试会写 `~/.murmur.json` 白名单键——本机已有该文件,风险低但值得知晓)。

### 5.2 第一轮(仓库安装后直接跑,即 CI 同构状态)

- 命令:`pnpm install`(已 up-to-date,136ms)→ `pnpm run build:main && build:preload`(为 unit)→ `pnpm test:e2e`。
- 结果:**16 failed / 30 did not run / 0 passed**,总时长约 8 分钟。
- 失败形态:13 个 suite 的**第一条用例全部** `electronApplication.firstWindow: Timeout 30000ms exceeded`(serial describe 的 beforeAll 挂掉,同 suite 后续用例 did not run)。
- 根因定位(证据链):
  1. 当时 `node_modules/better-sqlite3` 为系统 Node ABI(137;`scripts/check-native-abi.js` 在系统 Node 下报 OK)。
  2. 复现:`ELECTRON_RUN_AS_NODE=1 npx electron -e "require('better-sqlite3')…"` → **`ERR_DLOPEN_FAILED`**(Electron 39 需 ABI 140)。
  3. `src/helpers/database.ts:5` 顶层 `import Database from "better-sqlite3"`,esbuild `--external` 后等价 main 进程加载即 require → main.ts 在创建窗口前崩溃 → firstWindow 必然 30s 超时。
  4. 修复前置:`npx @electron/rebuild -f -w better-sqlite3` → 同一探针命令输出 `Electron ABI gate passed`。
- 结论:**环境前置缺失,非产品缺陷**;但它精确复现了 CI 上 e2e 的结构性必挂路径(CI 在 e2e 前把 ABI rebuild 到了系统 Node),坐实 4.3-1。

### 5.3 第二轮(Electron ABI 修复后)

- 命令:`npx @electron/rebuild -f -w better-sqlite3`(→ `Electron ABI gate passed`)→ `pnpm test:e2e`。跑了三次(list/tail/json 三种 reporter),结果**完全可复现**。
- 结果:**22 passed / 19 failed / 5 skipped(未运行)/ 共 46 用例**,测试段耗时 20.3–20.6s。
- **全绿的 suite**:`00-boot-health` 7/7(DB round-trip、全 handler 域应答、preload 50+ 方法、React 挂载、无未捕获错误、session、6 秒退出)——这是全 e2e 中信息量最大的一组,真实 Electron + 真实 main bundle + 真实 handler 全部通过;另有 launch-only、lifecycle 1.1–1.4、ftue 0.2、file-import 5.1、clipboard 6.1/6.2、settings 7.1–7.3、history 8.2、window 9.2、errors 10.2 通过。
- **19 个失败逐条归因(附关键报错)**,零产品缺陷,分四类:

  **① mock/主进程 eval 基建断裂(11 条:2.2、2.3、3.1、4.2、4.3、5.2、5.3、8.3、9.1、9.3、10.1)**
  `Error: electronApplication.evaluate: ReferenceError: require is not defined`(`tests/e2e/helpers/ipc-mock.ts:31` 与 `09-window.test.ts:104` 等处直接在 eval 体内 `require("electron")`)。ADR-010 之后 main 只有 esbuild CJS bundle,eval 作用域没有 `require`。**这批测试在"bundle 化 main"之后从未可能通过**——此前从未暴露,是因为 CI 的 e2e 在 ABI 上就死在 firstWindow(§5.2),本地也从未跑通过。属 e2e 基建欠账,非产品问题。

  **② 测试断言漂移/测旧架构(4 条)**
  - `1.5 Settings page route renders correctly`:在主窗 body 里找"主题/设置"——但 in-app settings route 已随 `[20260816_Refactor_DeadChannels]` 删除(settings 是独立 `settings.html` 窗口,`App.tsx:17-19` 注释明说)。**测的是被删掉的旧架构**。
  - `4.1 Default hotkey displayed in UI`:断言 body 含 `"Shift"`/`"Space"`(`04-hotkey.test.ts:33-34`),而 `useHotkey.ts:93-108 formatHotkey` 早已把展示格式符号化为 `⌘ + ⇧ + 空格`。断言没跟上展示层变更。
  - `8.1 getTranscriptions returns array`:`window.electronAPI.getTranscriptions({ limit: 10, offset: 0 })` 传**对象**,preload 契约是 `(limit: number, offset: number)` 位置参数(`preload.ts:89`);handler 原样转发 → better-sqlite3 `RangeError: Too few parameter values were provided`。测试签名漂移(同 suite 的 8.2 用正确签名调用,**通过**,反证产品链路无恙)。
  - `2.4 Model status IPC returns valid structure`:期望 `checkModelFiles()` 返回 `{stage, isReady}`,实际 `MODELS.CHECK` 返回 `{success, models_downloaded, minimum_ready, missing_models}`(`modelManager.ts:186`)——把 `checkModelFiles` 和 `useModelStatus` 的派生态混了。

  **③ 环境假设/时序(3 条:2.1、ftue 0.1、0.3)**
  断言 `body` 含"下载/download"或 onboarding 三步文案。模型检查是异步的,初次 stage=`checking` 时段落文案是"模型未就绪,请稍候…"(`App.tsx:43`),测试在 `domcontentloaded` 后立即读 `textContent` 未等状态落定;且断言假设"新机器无模型"这一本机不保证的前提。boot-health 0.4/0.5(React 挂载、无未捕获错误)通过,无产品缺陷证据。

  **④ 契约小疣(1 条:6.3)**
  `pasteText` 成功路径返回 `undefined`(`clipboardHandlers.ts:34-41` 直接透传 `clipboardManager.pasteText` 的 void resolve),测试 `expect(result).toBeDefined()`(`06-clipboard.test.ts:65`)。测试注释自己都写"Result is either void (success) or an error object"却断言 toBeDefined——断言自相矛盾;但也暴露 PASTE 与 COPY 的返回契约不一致(可顺手统一为 `{success:true}`)。

- **5 条 skipped**:3.2–3.6(3.1 在共享 fixture 的 suite 内先挂,后续连锁跳过)。
- **结论**:e2e 资产当前状态 = "boot-health 真、其余大面积测试侧坏"。修复清单见 §6 建议 1/9。
- **ABI 状态备注**:e2e 后 `better-sqlite3` 处于 Electron ABI;此时跑 `pnpm test` 会被 `pretest` ABI 探针拦下,需先 `pnpm rebuild better-sqlite3` 切回系统 ABI——这正是 CLAUDE.md 记载的双 ABI 之舞,双向都成立。

### 5.4 旁证:unit suite

- `pnpm test`(先 build main/preload):**1523 用例全过**(首轮因缺 build 有 13 个 preload bundle 用例挂,build 后复跑 13/13 过——`pnpm test` 自身不 build,CI 先 build,故是本地用法陷阱而非缺陷)。
- `pnpm run test:python:unit` 未跑(worktree 无 embedded python 环境;CI 用 setup-python 兜底)。按任务约束如实记录:**python 单测未在本机执行,看护评级基于文件审查**。

---

## 6. 应修缺陷与建议(只列不动手)

按建议优先级:

1. **[CI 结构性缺陷] e2e 在 CI 永远红且被 continue-on-error 掩盖**(§5.2 证据链)。建议:在 e2e 步骤前加 `npx @electron/rebuild -f -w better-sqlite3`(或 e2e 专用 job:install 后不 rebuild 系统 ABI),然后摘掉 boot-health 的 continue-on-error 观察两周,再考虑全量 e2e 转阻塞。这是把 13 个 suite、约 45 条用例从"装饰品"变回"门"的唯一路径。
2. **[用户可感断裂] 热键自定义**:要么补设置 UI(allowlist/fileConfig/IPC 全就位,只差控件 + `useHotkey` 读设置,小改动),要么改掉 `App.tsx:289` 的 toast 文案别再指向不存在的设置。
3. **[死事件清理] `PROCESSING_UPDATE`**:要么在 main 侧模型初始化完成处真正 send(消掉 3s 轮询的必要性),要么删 listener + 契约;`TRANSCRIPTION_UPDATE`/`ERROR`/`FUNASR_INSTALL_PROGRESS` 建议连同孤儿 handler(FUNASR.INSTALL 等 §3-D/E)做一轮 dead-channel 清理——项目在 `[20260816_Refactor_DeadChannels]` 已有同类先例,模式现成。
4. **[功能补齐] 历史"清空全部"**(CLEAR 链路全在,加一个带确认的按钮)+ "导出全部"支持多格式(UI 从硬编码 "txt" 改为格式选择,handler 已支持)。
5. **[一致性] `default_mode`**:补 UI + 加入 ALLOWED_SETTING_KEYS,或删掉两处读取端。现状是实现了 60% 的悬空能力。
6. **[i18n] 主窗/历史窗接入 useTranslation**(文案已双份在 locale 文件?核对后补 key),否则建议文档里把语言支持标注为"设置界面双语"。
7. **[测试网补盲] 给 ipc-contracts-orphans.test 加 renderer-caller 维度**(扫 src/ 的 `electronAPI.X` 调用,channel 无 caller 即黄名单)——本报告 §3 A–E 即该测试应能自动抓出的清单。
8. **[小] e2e userData 隔离**:launch 时给 `--user-data-dir` 指到临时目录,避免测试写真实 `~/Library/Application Support/murmur` 与 `~/.murmur.json`。
9. **[e2e 修复包](对应 §5.3 四类失败)**:① mock 基建:`ipc-mock.ts`/窗口断言里的 `require("electron")` 改为不依赖 eval 作用域 require 的注入方式(如在 `app.evaluate` 里走 `process.mainModule`/全局钩子,或 main 暴露 test-only 挂载点);② 修 4 条断言漂移(1.5 删或改为真设置窗;4.1 断言 `⌘`/`⇧`/`空格`;8.1 改位置参数;2.4 对齐 MODELS.CHECK 真实 payload);③ 2.1/ftue 加显式 waitFor 文案且注入空模型缓存目录;④ pasteText 返回 `{success:true}` 统一契约。修完后这套 e2e 才具备转阻塞的资格。
10. **[小] `useRecording.ts:193`** 传 `arrayBuffer` 而旁边算好的 `uint8Array` 不用——行为等价但易误读,顺手统一。

---

## 7. 附录:关键命令记录

```
git log --oneline -5 / describe --tags        # 基线确认 353793b, v1.4.0@8f1f60b
pnpm install                                   # Already up to date (136ms)
node scripts/check-native-abi.js               # [abi] OK under system node (137)
pnpm run build:main && pnpm run build:preload  # unit/e2e 前置 bundle
pnpm test                                      # 1523 passed(先 build)
npx vitest run tests/unit/preload-*.test.ts    # 13/13 复跑通过
pnpm test:e2e                                  # 第一轮:16 failed / 30 did not run
ELECTRON_RUN_AS_NODE=1 npx electron -e "…better-sqlite3…"   # ERR_DLOPEN_FAILED → 复现根因
npx @electron/rebuild -f -w better-sqlite3     # Rebuild Complete → ABI gate passed
pnpm test:e2e                                  # 第二轮:22 passed / 19 failed / 5 skipped(§5.3)
npx playwright test --reporter=json            # 第三次复跑核对逐条状态,结果一致
```

审计覆盖文件清单(全部通读或关键段核读):main.ts、preload.ts、ipc-contracts.ts、ipc/{index,environmentHandlers,modelHandlers,aiHandlers,transcriptionHandlers,settingsHandlers,windowHandlers,hotkeyHandlers,clipboardHandlers,systemHandlers}.ts、updateManager.ts、funasrManager.ts、funasrServer.ts(关键段)、modelManager.ts、pythonEnvironment.ts(关键段)、hotwords.ts、hotkeyManager.ts、tray.ts、windowManager.ts(关键段)、database.ts(关键段)、fileConfig.ts(关键段)、audioPathValidator/exportFormatters/aiPrompts(结构)、funasr_server.py(结构+unload/reload/hotword/SeACo 段);renderer 全部:App.tsx、main.tsx、history.tsx、settings.tsx、settings/_、hooks/_(全部 5 个)、components/{FileImport,TranscriptionResult,ExportPanel,FileDropZone}.tsx、i18n/index.ts;tests 全量清单 + 抽读 4 个契约测试 + e2e 全部 suite 用例名 + electron-launch/global-setup。
