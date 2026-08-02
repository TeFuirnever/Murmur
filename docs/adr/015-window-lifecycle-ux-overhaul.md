# ADR 015: 窗口生命周期与设置页面 UX 全面改造

**状态**: 待批准（pending approval）
**日期**: 2026-08-02
**关联**: ralplan 共识规划（Architect=ITERATE→已修订, Critic=ITERATE→已修订, Tracer=8/10 确认）

## 上下文

用户报告了 Murmur Electron 应用中六个关联的 UX 问题：

1. **主窗口莫名消失** — 浮动面板（`frame: false`, `transparent: true`, `skipTaskbar: true`, `alwaysOnTop: true`）消失后无可见恢复路径。
2. **主窗口与设置窗口冲突** — 两个窗口都继承 `alwaysOnTop`，交互时 z-order 管理混乱。
3. **桌面不显示应用图标** — `skipTaskbar: true` 导致任务栏无图标；TrayManager 创建失败时错误被静默吞掉。
4. **隐藏窗口时任务丢失** — `backgroundThrottling` 未关闭，渲染进程定时器被限流到 ~1次/秒，AI 优化的 100ms 延迟变成 1s+，60s 超时竞态可能误判。
5. **AI 配置页面 UX 差** — 无字段级校验、模型选择器笨拙、提供商列表扁平、Ollama 需手动配置。
6. **保存成功提示遮挡内容** — toast 位于 `top-right`，在 700×600 的设置窗口中与表单内容冲突。

### 根因链（代码追踪验证）

通过三路并行探索 + 对抗性 review 确认以下根因：

| #   | 根因                                                         | 文件:行号                                         | 验证                                       |
| --- | ------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------ |
| 1   | Escape 键全局隐藏窗口（`document` 级监听，无任何 guard）     | `App.tsx:387-396`                                 | ✅ Tracer 确认                             |
| 2   | `skipTaskbar: true` — 任务栏无入口                           | `windowManager.ts:83`                             | ✅ Tracer 确认唯一引用点                   |
| 3   | `backgroundThrottling` 未设置（Electron 默认 `true`）        | `windowManager.ts:85-93`                          | ✅ Tracer 确认全仓库无设置                 |
| 4   | TrayManager 无 logger — 创建失败静默吞掉                     | `main.ts:145`                                     | ✅ Tracer 确认构造函数接受 logger 但未传入 |
| 5   | 设置窗口 `closed` 仅 null 引用，不恢复主窗口焦点             | `windowManager.ts:211-213`                        | ✅ Tracer 确认                             |
| 6   | WINDOW.SHOW 只 `.show()` 不 `.focus()`                       | `windowHandlers.ts:40-44`                         | ✅ Tracer 确认                             |
| 7   | `transparent: true` 实际未被 CSS 使用（body/#root 已不透明） | `windowManager.ts:78`, `index.css:67-73`          | ✅ Tracer 确认                             |
| 8   | 所有窗口共享 `alwaysOnTop`                                   | `windowManager.ts:188`, `windowHandlers.ts:89-99` | ✅ Tracer 确认 SET_TOP 遍历三窗口          |

## 决策

### D1: 关闭 `backgroundThrottling`

在主窗口 `webPreferences` 中设置 `backgroundThrottling: false`。

**理由**: 语音转文字工具的核心场景是"录音 → 隐藏窗口 → 后台处理 → 恢复查看结果"。Electron 默认的后台限流（~1次/秒）会导致 AI 优化的 `setTimeout(100ms)` 延迟到 1s+，且 60s 超时竞态可能因限流而误判超时，转录结果丢失。

**CPU 缓解**: 配套在 `EffectsLayer.tsx` 中添加 `visibilitychange` 监听，隐藏时暂停 WebGL 渲染循环。

### D2: 移除 `transparent: true` 和 `skipTaskbar: true`

移除主窗口的 `transparent: true`（Tracer 确认 body `background-color: hsl(0 0% 96.5%)` 和 root `bg-[#f5f5f7]` 均为不透明，透明度未被视觉使用）和 `skipTaskbar: true`。

**理由**:

- `transparent: true` + `skipTaskbar: false` 在 Windows 上是已知坏组合（任务栏缩略图黑屏、DWM 阴影泄漏、Aero Peek 透明矩形）。仓库已有两个 transparent-window 变通方案（`[20260602_Fix_MaximizeToggle]`），不应继续叠加。
- 移除 `skipTaskbar` 让应用在任务栏显示品牌图标，这是用户找到应用的首要入口。
- 添加 `icon` 属性复用 `tray.ts:getTrayIconPath()` 的 dev/prod 路径解析模式。

**附带收益**: `[20260602_Fix_MaximizeToggle]` workaround（`isMaximized()` 在透明窗口上总返回 false）可能不再需要——作为后续 PR 单独处理。

### D3: 打开子窗口时临时取消主窗口 alwaysOnTop

不改为移除设置/历史窗口的 `alwaysOnTop`（那会导致 always-on-top 主窗口覆盖设置窗口）。改为：

- `showSettingsWindow()` / `showHistoryWindow()`：调用 `mainWindow.setAlwaysOnTop(false)`
- 子窗口 `closed` 处理器：恢复 `mainWindow.setAlwaysOnTop(this._alwaysOnTop)`
- `WINDOW.SET_TOP` 仅应用于 `mainWindow`

**理由**: Architect review 发现移除子窗口 alwaysOnTop 会制造 z-order 倒置。临时取消主窗口置顶是 VS Code / macOS inspector 的标准模式。

### D4: 移除全局 Escape → 隐藏窗口

移除 `App.tsx:387-396` 的 `document.addEventListener("keydown", handleKeyPress)` useEffect。

**理由**: Escape 在文本框中应清除输入，不应隐藏整个窗口。用户已明确确认完全移除。

### D5: 子窗口关闭后恢复主窗口焦点

在 `createSettingsWindow` / `createHistoryWindow` 的 `closed` 事件处理器中调用新增的 `restoreMainWindow()` 方法（`show()` + `focus()` + 恢复 `alwaysOnTop`）。

**理由**: 当前关闭设置窗口后焦点不回到主窗口，用户感觉应用"消失"了。

### D6: TrayManager 传入 logger

`main.ts:145` 改为 `new TrayManager(logger)`。

**理由**: `clipboardManager` 和 `funasrManager` 都传了 logger，唯独 trayManager 漏了。托盘创建失败时 catch 块 `if (this.logger && this.logger.error)` 永远为 false，错误被完全吞掉。

### D7: Toast 移至 bottom-center + 内联按钮反馈

- 设置窗口 `<Toaster position="bottom-center" />`，改用主题感知包装器 `./components/ui/sonner`
- `saveSettings` 返回 `boolean`，保存成功时按钮闪烁 "✓ 已保存" 1.5 秒

**理由**: 底部居中是表单保存反馈的业界标准（Gmail、Notion、Linear）。`saveSettings` 返回值确保 flash 只在成功时触发。

## 不做的事（明确排除）

| 提案                                                  | 排除原因                                                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 重排保存流程（先存原始文本再 AI 优化后更新）          | Review 发现无 `updateTranscription` DB 方法/IPC 通道。`backgroundThrottling: false` 已解决根因（定时器限流），不需要重排。 |
| Ollama 自动配置（建议横幅 + 模型自动填充）            | 与报告的 bug 无关，作为独立 issue 处理。                                                                                   |
| AI 配置表单 UX 改进（粘性底栏、字段校验、提供商分组） | 与窗口 bug 无关，作为独立 issue 处理。                                                                                     |
| 缩窄 Escape 监听器（仅非 input 时触发）               | 用户已明确选择完全移除。                                                                                                   |
| 移除 `[20260602_Fix_MaximizeToggle]` workaround       | 需要独立验证 transparent 移除后是否仍需要，不在本次范围。                                                                  |

## 交付策略

分两个 PR，降低合并风险：

### PR1 — 安全修复（~50-60 行，低风险）

| 变更                                                 | 文件                                    |
| ---------------------------------------------------- | --------------------------------------- |
| `backgroundThrottling: false`                        | `windowManager.ts`                      |
| EffectsLayer visibilitychange 暂停                   | `EffectsLayer.tsx`                      |
| WINDOW.SHOW 加 `.focus()`                            | `windowHandlers.ts`                     |
| TrayManager 传入 logger                              | `main.ts`                               |
| 移除全局 Escape useEffect                            | `App.tsx`                               |
| 子窗口 closed 恢复主窗口焦点 + `restoreMainWindow()` | `windowManager.ts`, `windowHandlers.ts` |
| Toast bottom-center + 主题包装器                     | `settings.tsx`                          |
| saveSettings 返回 boolean + savedFlash               | `useSettings.ts`, `AIConfigSection.tsx` |

### PR2 — 窗口架构（~40-50 行，需 Windows 手动验证）

| 变更                                           | 文件                |
| ---------------------------------------------- | ------------------- |
| 移除 `transparent: true` + `skipTaskbar: true` | `windowManager.ts`  |
| 添加 `icon` 属性（复用 tray 路径模式）         | `windowManager.ts`  |
| showSettings/History 临时取消主窗口置顶        | `windowManager.ts`  |
| SET_TOP 仅 mainWindow                          | `windowHandlers.ts` |

## 验证计划

### 回归测试（TDD — 先写失败测试）

| 测试                        | 文件                           | 断言                                            |
| --------------------------- | ------------------------------ | ----------------------------------------------- |
| backgroundThrottling 配置   | `windowManager-events.test.ts` | webPreferences 含 `backgroundThrottling: false` |
| WINDOW.SHOW focus           | `windowHandlers.test.ts`       | `.show()` 和 `.focus()` 均调用                  |
| HIDE_SETTINGS 恢复焦点      | `windowHandlers.test.ts`       | `restoreMainWindow()` 被调用                    |
| closed 恢复焦点             | `windowManager-events.test.ts` | `mainWindow.show()` + `.focus()` 调用           |
| SET_TOP 仅 mainWindow       | `windowHandlers.test.ts`       | 不对 settings/history 调用 setAlwaysOnTop       |
| showSettings 取消主窗口置顶 | `windowManager-events.test.ts` | `mainWindow.setAlwaysOnTop(false)` 调用         |
| saveSettings 返回值         | 新建 `useSettings.test.ts`     | 成功返回 true，失败返回 false                   |

### 手动验证（确定性步骤）

| #   | 操作                                             | 预期                                |
| --- | ------------------------------------------------ | ----------------------------------- |
| 1   | 启动应用                                         | 任务栏显示 Murmur 品牌图标          |
| 2   | 录音 → Escape 隐藏 → 等转录完成 → 点击任务栏恢复 | 转录结果完整（DB 记录数一致）       |
| 3   | 录音 → 热键隐藏 → 等 10s → 恢复                  | AI 优化完整，`processed_text` 非空  |
| 4   | 打开设置 → X 关闭                                | 主窗口获焦点，alwaysOnTop 恢复      |
| 5   | 设置页文本框 → Escape                            | 清除输入，窗口不隐藏                |
| 6   | 保存 AI 配置                                     | toast 底部居中，按钮闪烁 "✓ 已保存" |
| 7   | 保存时断网                                       | 按钮不闪烁，toast 显示错误          |
| 8   | 开启 EffectsLayer → 隐藏窗口 → 查 CPU            | CPU 不持续高占用                    |

### CI 门禁

`pnpm ci:check`：格式检查、lint、license、测试+覆盖率、build:preload、build:renderer、effects chunk 隔离检查。

## 风险评估

| 风险                                         | 严重性 | 缓解                                                   |
| -------------------------------------------- | ------ | ------------------------------------------------------ |
| 移除 `transparent: true` 改变窗口外观        | 🟡 中  | Tracer 确认 body/#root 已不透明。需 Windows 手动验证。 |
| `backgroundThrottling: false` 增加隐藏时 CPU | 🟡 中  | EffectsLayer visibilitychange 暂停缓解。               |
| showSettings 取消置顶后崩溃未恢复            | 🟢 低  | closed 处理器无条件恢复 alwaysOnTop。                  |
| saveSettings 返回值变更影响调用方            | 🟢 低  | 仅 `settings.tsx:142` 调用，改为 await + 检查返回值。  |

## Review 记录

本计划经过 ralplan 三路对抗性 review：

- **Architect (Opus)**: ITERATE → 发现 3 个 BLOCKER（无 UPDATE API、transparent+skipTaskbar 坏组合、z-order 倒置）→ 全部解决
- **Critic (Opus)**: ITERATE → 发现 savedFlash 误触发、icon 路径未验证 prod、"surgical" 措辞误导 → 全部解决
- **Tracer (Sonnet)**: 10 项声明验证，8 项 CONFIRMED，2 项 PARTIALLY TRUE → 已修正

关键修订见"不做的事"和"交付策略"中的 PR 拆分。
