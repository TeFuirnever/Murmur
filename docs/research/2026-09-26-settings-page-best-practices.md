# Murmur 设置页（Settings Page）设计业界最佳实践调研（2026-09-26）

> 方法：全部回溯到一手来源——平台设计规范原文（Apple HIG、Microsoft Learn、NN/g、W3C、i18next 官方文档）与产品源码/官方文档（VS Code、Raycast、Obsidian）。所有论断均给出处 URL。
> **标注约定**：`【规范】` = 权威设计规范/官方指南的建议；`【实践】` = 某产品在真实发布产品中的做法。两者严格区分，不混写。
> 本文是设置页方案设计的输入，不包含任何代码改动。

---

## 0. TL;DR

| 维度      | 一句话结论                                                                                                | 核心来源                                           |
| --------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 功能取舍  | 设置项只收「低频改动 + 全局影响行为」的配置；默认值承担主责，"最少设置"是各家规范的共识                   | Apple HIG、Microsoft WinUI、NN/g                   |
| 组织方式  | 浅层分组 + 搜索 + 单项可见描述；「常用优先、高级折叠」；大规模时演化出「UI 编辑器 + 配置文件」双层模型    | Microsoft WinUI、Apple HIG、VS Code、Obsidian 1.13 |
| 生效机制  | 默认即时生效、不要 Apply/确认按钮；少数必须重载的项要明示后果（规范侧唯一硬性要求来自 Microsoft）         | Microsoft WinUI、NN/g #1/#3                        |
| i18n 文案 | key + 占位符 + 术语表 + fallback 链是工程基线；翻译膨胀（短串可达 200–300%）用弹性布局 + 伪本地化测试兜底 | W3C、Microsoft Globalization、i18next              |

---

## 1. 功能取舍：什么样的东西才值得做成设置项

### 1.1 【规范】Apple HIG：最少设置 + 最优默认值

来源：[Apple HIG — Settings](https://developer.apple.com/design/human-interface-guidelines/settings)（页面 changelog：2024-06-10 重组）

原文要点（逐条均为页面原文）：

- "Minimize the number of settings you offer."——设置过多会让体验变得不友好（feel less approachable），且让特定设置难以找到。
- "Aim to provide default settings that give the best experience to the largest number of people."——默认值要以覆盖最大多数人的最佳体验为目标，理想状态是用户无需任何调整即可开始使用。
- "Avoid using settings to ask for setup information you can get in other ways."——能自动检测的就别问（例如游戏自动检测手柄，而不是让玩家选）。
- "Respect people's systemwide settings and avoid including redundant versions of them in your custom settings area."——不要在应用设置里复制系统级设置（如无障碍、深色模式跟随），否则用户会怀疑系统设置是否对你的应用生效。
- "Put general, infrequently changed settings in your custom settings area."——应用自己的设置区只放「全局 + 低频改动」项；用户打开设置必须中断当前任务，所以高频项不该放进去。
- "When possible, prefer letting people modify task-specific options without going to your settings area."——任务内选项（显示/隐藏视图、过滤列表等）应放在任务发生的界面上（contextual），而不是收进设置页。
- 入口遵循平台惯例：macOS 用 App 菜单里的 Settings 项 + 标准 `Cmd-,` 快捷键。

### 1.2 【规范】Microsoft WinUI：准入判据 + 数量上限

来源：[Microsoft Learn — Guidelines for app settings (WinUI)](https://learn.microsoft.com/en-us/windows/apps/design/app-settings/guidelines-for-app-settings)

- **准入判据（正面清单）**——属于设置页的内容：
  - "Configuration options that affect the behavior of the app and don't require frequent readjustment"（如单位制、账户、通知、无障碍）；
  - 依赖用户偏好的选项（音效、主题色）；
  - 低频访问的应用信息（隐私政策、版本、版权）。
- **准入判据（负面清单）**："Commands that are part of the typical app workflow (for example, changing the brush size in an art app) shouldn't be in a settings page."——工作流内的命令是功能不是设置。
- **数量与默认值**："Keep your settings simple. Define smart defaults and keep the number of settings to a minimum."
- **每页数量上限**："Try to keep the total number of settings to a maximum of four or five."（针对单页可见设置）
- **上下文一致性**："Display the same settings regardless of the app context. If some settings aren't relevant in a certain context, disable ... by setting `IsEnabled` to `false`."——不同上下文显示同样的设置，不相关的置灰并给 `Description` 解释原因，而不是动态增删。

### 1.3 【规范】NN/g：默认值的支配力 + 自定义的高成本

来源 A：[NN/g — The Power of Defaults（Jakob Nielsen, 2005）](https://www.nngroup.com/articles/the-power-of-defaults/)

- 引 Cornell（Joachims et al., SIGIR 2005）实验：把 Google 前两条结果偷偷交换后，第一条的点击率仅从 42% 降到 34%——用户对「默认排列位置」有强烈偏信，质量信息都纠正不过来。
- 设计含义（原文）："pre-populate fields with the most common value"；"It's therefore important to select helpful defaults, rather than those based on the first letter of the alphabet"。
- 警告：如果总把最贵选项设为默认，"you'll lose credibility, so don't overdo it"。

来源 B：[NN/g — Customization vs. Personalization（2016）](https://www.nngroup.com/articles/customization-personalization/)

- "most users are not interested in doing the work required to tweak the user interface"——大多数用户不愿意为调界面付出劳动。
- "Customization imposes higher interaction cost"——每个自定义功能本身就是一个独立的 UI，有学习、寻找、决策成本。
- "it's the designer's job to prioritize the ideas and create a tight base-level design"——设计师的职责是替用户做减法，而不是把决策外包给设置页。
- "Personalization and customization should enhance an already good experience, rather than try to fix a poor one."——自定义是锦上添花，不能用来掩盖默认体验的问题。
- 另外 [10 Usability Heuristics #7](https://www.nngroup.com/articles/ten-usability-heuristics/) 也说 "Allow users to tailor frequent actions"——自定义要收敛在「高频动作」上，而不是万物皆可调。

### 1.4 【实践】产品如何执行这套判据

- **VS Code**：把全部默认值公开可查（`Preferences: Open Default Settings` 命令打开 `defaultSettings.json`）——默认值是被当作一等公民管理的资产，而不是埋在代码里的魔法值。来源：[VS Code Settings 文档](https://code.visualstudio.com/docs/getstarted/settings)。
- **Raycast**：扩展偏好用 **required 声明**表达「不设好就不能用」的项——"Required preferences need to be set by the user before a command opens."，且配 `help.md` 引导首次配置。这是「设置项 = 用户必须完成的 setup」与「设置项 = 可选微调」两类语义在入口上的显式区分。来源：[Raycast API — Preferences](https://developers.raycast.com/api-reference/preferences.md)。
- **Raycast**：偏好值的读取内建 default fallback——"the defined default values are used as fallback values"（`getPreferenceValues`）。来源同上。

### 1.5 小结：设置项准入 checklist

综合以上（Apple + Microsoft + NN/g），一个东西值得做成设置项当且仅当它同时满足：

1. 影响应用全局行为（不是某个任务内部的临时操作——任务内选项放任务界面）；
2. 用户低频改动（改完不常回来动）；
3. 无法用可靠的自动决策替代（能检测/能推断的就别问）；
4. 有一个合理且负责任的 smart default（覆盖最大多数人），设置项本身只是默认值的例外出口；
5. 不与系统级设置重复。

---

## 2. 组织方式：信息架构、搜索、默认值策略、高级项折叠

### 2.1 【规范】Microsoft WinUI 与 Apple HIG 的 IA 规则

来源：[WinUI app settings guidance](https://learn.microsoft.com/en-us/windows/apps/design/app-settings/guidelines-for-app-settings)、[Apple HIG — Settings](https://developer.apple.com/design/human-interface-guidelines/settings)

Microsoft（Windows 11 / WinUI）：

- **入口位置**：NavigationView 布局下，设置应是导航列表最后一项、钉在底部（`IsSettingsVisible` 内建支持）；命令栏布局下放 "More" 溢出菜单末尾。
- **布局**：设置页全屏打开，单列、可滚动、限最大宽度（约 1000–1100px）；相关设置用 section header 分组（BodyStrong 字重）。
- **控件选择**：二元设置用 toggle switch；≤5 个互斥选项用 radio buttons；更多选项用 combo box；文本输入按内容类型（email/password 等）。
- **卡片控件**：官方建议用 Windows Community Toolkit 的 `SettingsCard`（Header + Description + Icon + 右侧动作控件）与 `SettingsExpander`（主行 + 按需展开的子项）——"This keeps the page compact while still surfacing advanced options. Avoid nesting expanders deeper than one level."
- **标签命名**："Use descriptive, one-word labels for settings headers. For example, name the setting "Accounts" instead of "Account settings"。"（名词短语、非动词句）
- **少用项折叠**："Combine less-used settings into a `SettingsExpander` so that common settings can each have their own `SettingsCard`."
- **About 区**：设置页底部放 About（应用名/图标/版本折叠行 + 仓库/反馈/依赖/法务链接）。

Apple（macOS）：

- 设置窗口用**不可自定义的稳定 toolbar** 切换 pane（"People rely on a stable settings interface to help them find what they need"）；
- "Update the window's title to reflect the currently visible pane."；
- **"Restore the most recently viewed pane."**——下次打开设置恢复上次所在 pane（用户经常连续调一组相关设置）；
- 设置窗口 "Dim a settings window's minimize and maximize buttons"（窗口随 pane 内容自适应尺寸，不驻留 Dock）。

### 2.2 【实践】VS Code：UI 编辑器 + settings.json 双层模型

来源：[VS Code — User and Workspace Settings](https://code.visualstudio.com/docs/getstarted/settings)；源码仓库 microsoft/vscode（`src/vs/workbench/contrib/preferences/browser/settingsEditor2.ts`，即 Settings Editor 的实现 `SettingsEditor2`，经 GitHub code search 验证）

- **双层模型**："VS Code stores setting values in a settings JSON file."，Settings editor 只是 "a graphical interface to manage settings"——底层唯一真相是 JSON，UI 是它的图形投影（二者写同一文件）。少数高级项（如 Workbench: Color Customizations）只能进 JSON 编辑。
- **作用域链与优先级**：Default → User → Remote → Workspace → Workspace Folder → 语言特定 → Policy，"later scopes override earlier scopes"；Object 类型做 merge 而非整体覆盖；语言特定编辑器设置永远压过非语言特定的设置。
- **搜索语法化**：搜索框支持 `@modified`（值 ≠ default 的项）、`@ext:`、`@id:`、`@lang:`、`@tag:`、`@haspolicy` 等过滤器，且 "remembers your settings search queries and supports undo or redo"。
- **modified 指示 + 单项重置**：被改过的设置项左侧显示色条（"similar to modified lines in the editor"）；gear 菜单提供 "reset a setting to its default value" 以及复制 setting ID / JSON 片段。
- **常用优先**：设置树顶部有 "Commonly Used" 分组。
- **高级项标签**：源码中存在 `ADVANCED_SETTING_TAG = 'advanced'`（`src/vs/workbench/contrib/preferences/common/preferences.ts`）——设置可打 `advanced` 标签，供过滤与分层（配合 `@tag:advanced` 搜索）。

### 2.3 【实践】Obsidian：三分区 + 1.13 的搜索化改造

来源：[Obsidian Help — Settings](https://obsidian.md/help/settings)；[Obsidian 1.13.4 Desktop changelog（2026-07-30）](https://obsidian.md/changelog/2026-07-30-desktop-v1.13.4)

- 历史结构：设置分三区——**Options**（General / Editor / Files and links / Appearance / Hotkeys 等核心项）、**Core plugins**（内建插件，逐个开关 + 独立设置页）、**Community plugins**（第三方插件逐个开关 + 独立设置页）。每个插件自己的设置页 + 热键页内搜索过滤。
- 1.13（2026-05 早期访问 → 2026-07 公开）整体重做："Settings have been completely revamped with keyboard navigation, search, and new APIs for plugin developers."；"Added search. You can now search for settings by name or description."；设置改为可开新窗口；官方同时 "Deprecated the Settings Search plugin as it overlaps with the new search functionality"——设置搜索最终收敛为内置能力，而不是留给插件生态。
- 插件生态教训：1.13 要求 community plugins 迁移到新 Settings API 才能进入搜索索引——**插件式设置如果各自为政，搜索/一致性就无法保证**。

### 2.4 【实践】Raycast：平面 tabs + Advanced 折叠 + 配置可迁移

来源：[Raycast Manual — Settings](https://manual.raycast.com/settings)；[Raycast API — Preferences](https://developers.raycast.com/api-reference/preferences.md)

- 单一设置界面（`Cmd-,` 打开）+ 平面 tabs：Account / General / Launcher / Shortcuts / Keyboard / **Advanced** / Organizations / About / AI / Applications / Extensions。原文："The Advanced tab provides additional configuration for power users."
- **扩展偏好组织**：Extensions tab 内每个扩展在侧栏选中后显示自己的偏好页（"Select any extension to manage its preferences..."），逐命令开关（禁用的命令不进 Root Search）；偏好类型受控（manifest 声明 `textfield` / `password` / `checkbox` / `dropdown` / `appPicker` / `file` / `directory` 七种），类型由 manifest 自动生成 TS 类型（`raycast-env.d.ts`）。
- **配置可迁移**："Export your full Raycast configuration to a file and import it on another machine."（Advanced tab 内）。
- 偏好读取带默认值 fallback（见 1.4）。

### 2.5 小结：IA 模板（按规模取用）

| 规模                          | 模板                                                                       | 来源                                    |
| ----------------------------- | -------------------------------------------------------------------------- | --------------------------------------- |
| 设置 ≤ 十几项                 | 单列 + 3~5 个分组 header + 少用项进 expander/Advanced                      | Microsoft 4–5 项上限 + SettingsExpander |
| 设置几十~几百项（含扩展贡献） | UI 编辑器（搜索 + modified 指示 + reset）+ 底层配置文件双层模型            | VS Code                                 |
| 插件生态型                    | 宿主三区（核心 / 内建扩展 / 第三方扩展）+ 插件设置页统一 schema + 全局搜索 | Obsidian                                |

---

## 3. 生效机制：即时生效 vs 重启生效、Apply 按钮、反馈与撤销

### 3.1 【规范】权威建议

- **Microsoft（最明确）**："When a user changes a setting, the app should immediately reflect the change — don't require a confirmation button."——设置改动应立即生效，**不要**要求确认按钮。来源：[WinUI app settings guidance](https://learn.microsoft.com/en-us/windows/apps/design/app-settings/guidelines-for-app-settings)。
- **NN/g**：
  - 改动后的反馈是启发式 #1 的要求："The design should always keep users informed about what is going on, through appropriate feedback"（[10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)）。
  - 撤销是启发式 #3 的要求："Users often perform actions by mistake. They need a clearly marked 'emergency exit'"；tips 原文 "Support Undo and Redo"。对设置页而言，最轻量的 emergency exit 就是**单项 reset 回默认值**（而非做完整的 undo 栈）。
- **Apple HIG** 未对「设置改动的生效时机」给出逐字要求（其 Settings 页面只规定了入口、pane、恢复上次 pane 等），不应被引用为「即时生效」的依据。
- 反面模式（Microsoft 明令反对的）：OK/Apply/Cancel 三件套。规范侧没有「必须重启生效」的正面建议——重启生效是被各家规范规避开的设计。

### 3.2 【实践】产品做法

- **VS Code**："VS Code applies changes to settings directly as you change them."——官方文档明示全量设置改动即时写盘生效；文档中没有任何「需要重启」的常规路径说明。来源：[VS Code Settings 文档](https://code.visualstudio.com/docs/getstarted/settings)。
- **Raycast**：设置改动即时反映到界面（如 Interface Size："When you change the size, Raycast's windows resize to match, and all UI elements scale with them"）。来源：[Raycast Manual — Settings](https://manual.raycast.com/settings)。
- **Raycast / Obsidian**：两者都**没有**全局「重置所有设置」按钮，只有局部重置（Raycast 的搜索历史 reset、AI 工具 allowlist 的 Reset All）——全局 reset 被避免，重置粒度收敛在具体功能域。来源同上。
- **VS Code**：重置的落点是「回默认值」而非「回上次值」：gear 菜单的 reset 语义是 "reset a setting to its default value"——默认值体系（1.4）是重置机制的前提。

### 3.3 小结：生效机制决策表

| 设置类型                                     | 生效方式                                                                 | 依据                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| 纯 UI/偏好类（主题、字号、开关）             | 即时生效，无确认按钮                                                     | Microsoft 明文 + VS Code/Raycast 实践                |
| 有副作用的资源类（如换语言模型、换存储位置） | 即时写偏好，但重载/迁移动作显式给反馈（进度/toast），完成前旧值继续可用  | NN/g #1 反馈 + Microsoft 即时要求折中                |
| 极少数必须重启进程的项                       | 在该项的描述文案里明示"重启后生效"并内联提供重启按钮；能不设这种项就不设 | Microsoft 反对确认按钮的延伸；无规范正面支持重启模式 |

---

## 4. i18n 文案规范：长度、占位符、术语、fallback、伪本地化

### 4.1 【规范】翻译膨胀与弹性布局（W3C）

来源：[W3C — Text size in translation（Richard Ishida）](https://www.w3.org/International/articles/article-text-size/)

- "The general message is that text will normally expand"；"the smaller the source message, the higher the likely translation length"。IBM 数据：英文源 ≤10 字符的串翻译后平均膨胀 **200–300%**，>70 字符的串约 130%。
- 实测比例（Flickr "views" 一词）：中文 1.2×、韩语 0.8×、葡语/法语 2.6×、德语 2.8×、意语 3.0×——英文/中文是紧凑源语言，**以中/英为源语言做界面时必须按膨胀设计**。
- 行高注意：泰文行高约为拉丁文的 150%；阿文、中文、日文、韩文、天城文等都需要额外行高。
- 设计准则："In general, the more flexibly you can design your layout, the better."；避免 "small fixed-width containers or tight squeezes"；"Separate presentation and content, so that font sizes, line heights, etc. can be easily adapted."

### 4.2 【规范】占位符与转义（i18next）

来源：[i18next — Interpolation](https://www.i18next.com/translation-function/interpolation)

- 占位符语法：`"key": "{{what}} is {{how}}"`，调用 `t('key', { what: 'i18next', how: 'great' })`；支持嵌套取值 `{{author.name}}`。
- **转义默认开启**：`escapeValue` 默认 `true`，"escapes passed in values to avoid XSS injection"；对含标记的受控值用 `{{- myVar}}`（`unescapePrefix`）显式关闭，且文档警告 "If you toggle escaping off, escape any user input yourself!"
- 嵌套翻译：`$t(nestedKey)`；防注入选项 `skipOnVariables` 默认 `true`，文档原话 "we strongly suggest to keep this option to true"（变量值不再被二次插值）。

### 4.3 【规范】复数与 context（i18next）

来源：[i18next — Plurals](https://www.i18next.com/translation-function/plurals)、[i18next — Essentials](https://www.i18next.com/translation-function/essentials)

- 复数后缀遵循 CLDR/`Intl.PluralRules`：`_one` / `_other`，阿拉伯语等还有 `_zero` / `_two` / `_few` / `_many`；count 为 0 且存在 `_zero` 词条时优先用 `_zero`。
- 陷阱（原文）："The variable name must be `count`"；"There will be **no** fallback to the `'key'` value if count is not provided."——忘传 `count` 不会静默退回基础 key。
- context（性别等场景变体）通过 `context` 选项表达："used for contexts (eg. male / female)"（Essentials 页）。

### 4.4 【规范】key 组织与术语一致性（i18next）

来源：[i18next — Namespaces](https://www.i18next.com/principles/namespaces)

- 拆分信号："You start losing the overview having more than 300 segments in a file"。
- 语义分组示例：`common.json`（"Things that are reused everywhere, eg. Button labels 'save', 'cancel'"）、`validation.json`、**`glossary.json`**（"Words we want to be reused consistently inside texts"）——**术语一致性靠共享术语表 namespace 保证，而不是靠译者记忆**。
- 技术分组：namespace per view/page、per feature set、per lazy-loaded module。

### 4.5 【规范】locale fallback 链（i18next + W3C）

来源：[i18next — Fallback](https://www.i18next.com/principles/fallback.md)；[W3C — When to use language negotiation](https://www.w3.org/International/questions/qa-when-lang-neg)

- i18next 解析顺序：精确变体（`en-GB`）→ 同语言更宽变体（`en`）→ `fallbackLng` 链 → **key 本身**（"If a key does not return a value the key acts as fallback"）。`fallbackLng` 支持字符串/数组/对象/函数；默认值是 `'dev'`（developer language），"For production use, just set `fallbackLng` to an existing language."。对象形态可表达地域习惯，如 `'de-CH': ['fr', 'it']`。
- 语言选择策略（W3C）：自动协商（对应桌面应用 = 跟随系统 locale）"almost always, but not alone"——必须始终提供**可见的语言切换控件**且显式选择要有粘性（"stickyness of the explicit language selection"）；协商失败时回退到默认语言。IP 地址不属于可靠的语言信号。

### 4.6 【规范】伪本地化测试（Microsoft Globalization）

来源：[Microsoft Learn — Pseudolocalization](https://learn.microsoft.com/en-us/globalization/methodology/pseudolocalization)

- 定义："With pseudolocalization, you can verify that your product is localizable without actually localizing into a real language."——在翻译开始前的最早开发阶段即可执行，并贯穿整个开发周期。
- 手段（原文）：
  - 字符替换为带变音符/其他文字（`a` → `αäáàā…`，数字 → ①-⑨）；
  - **长度膨胀**："a good heuristic is to lengthen the text by 40%"，极端情况真实翻译可到 200%–400%；
  - 首尾加定界符（如 `^...^`）："Wrapping a string instantly reveals truncations... Concatenations will also be revealed by paired delimiters embedded in the displayed text."——**暴露截断与字符串拼接**；
  - 未接入 i18n 的硬编码串"won't be pseudo-translated"，一眼可见。
- 伪 locale：Windows 用 `qps-ploc` / `qps-plocm`（镜像 RTL）/ `qps-ploca`（东亚）；ICU 约定 `en-XA`（accents）与 `en-XB`（bidi）；语言子标签按 RFC4646 的私有使用区 `qaa`–`qtz`，避免与真实 locale 冲突（Microsoft 曾用 `tk-TM` 踩坑）。

---

## 5. 权威规范 vs 产品做法对照总表

| 议题          | 权威规范怎么说                                                                                      | 产品怎么做（佐证）                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 设置项准入    | Apple：minimize settings、能自动检测就别问；Microsoft：低频 + 全局行为项才入设置，工作流命令不入    | VS Code 公开全部 default；Raycast 用 required 偏好区分 setup 类与微调类                         |
| 数量与默认值  | Microsoft：单页 4–5 个上限 + smart defaults；NN/g：默认值有支配力，用户不做自定义劳动               | Raycast 偏好读取内建 default fallback                                                           |
| 分组与折叠    | Microsoft：section header + SettingsExpander（≤1 层嵌套）；Apple：稳定 toolbar pane + 恢复上次 pane | Raycast 平面 tabs + Advanced tab；VS Code `advanced` tag                                        |
| 搜索          | （规范未强制；属大规模实践）                                                                        | Obsidian 1.13 内置 name+description 搜索并废弃搜索插件；VS Code `@modified` 等语法化过滤        |
| 双层模型      | （无规范要求；源自开发者工具实践）                                                                  | VS Code settings.json 唯一真相 + Settings editor 图形投影                                       |
| 生效方式      | Microsoft：立即生效，不要确认按钮（唯一硬性规范）                                                   | VS Code "applies changes directly"；Raycast 实时 resize                                         |
| 反馈与重置    | NN/g #1 反馈、#3 emergency exit（"Support Undo and Redo"）                                          | VS Code modified 色条 + gear 单项 reset 回默认值；Raycast/Obsidian 只做局部 reset，无全局 reset |
| i18n 长度     | W3C：短串膨胀可达 200–300%，弹性布局                                                                | （工程侧）伪本地化 40% 膨胀启发式（Microsoft）                                                  |
| 术语一致      | i18next：glossary.json namespace                                                                    | —                                                                                               |
| 语言 fallback | W3C：自动协商 + 可见切换控件 + 显式选择粘性                                                         | i18next 变体→宽语言→fallbackLng→key 链                                                          |

---

## 6. 对 Murmur 这类 Electron 本地优先应用的落地建议

以下 10 条均标注依据来源；结合 Murmur 现状（Electron + React 渲染层、`useSettings.ts` 四处同步纪律、`settingsHandlers.ts` 的 `ALLOWED_SETTING_KEYS`、FunASR Python 子进程、本地 SQLite、中英双语）：

1. **设置项准入只认 checklist（1.5 节 5 条）**，并给每个新设置项写一句「为什么不能是默认行为」的注释——写不出来就别做成设置项。【规范：Apple HIG / Microsoft WinUI / NN/g Customization】
2. **每个设置项必须有负责任的 smart default**，目标是"大多数用户永远不需要打开设置"；默认值作为常量集中在 `DEFAULT_SETTINGS`，禁止散落。【规范：Apple HIG "best experience to the largest number of people" + NN/g Power of Defaults】
3. **首层克制 + 高级折叠**：单页可见设置对齐 Microsoft 的 4–5 个上限，低频项收进"高级"分组（expander 或子页），不嵌套超过一层。【规范：Microsoft WinUI 4–5 上限 + SettingsExpander】【实践：Raycast Advanced tab + VS Code `advanced` tag】
4. **默认即时生效、无 Apply/确认按钮**；极少数必须重载的项（如 FunASR 模型/热词切换）在该项描述里明示后果并提供内联"立即重载"动作，重载完成前旧值继续可用。【规范：Microsoft "immediately reflect the change" + NN/g #1】
5. **不复制系统级设置**：深色模式、语言跟随、全局快捷键冲突处理等尽量沿用系统值，应用内只做"跟随系统/自定义"二选一而非独立实现。【规范：Apple HIG "Respect people's systemwide settings"】
6. **modified 指示 + 单项重置**：每个设置项显示"已修改（默认值 X）"状态与 reset 回默认值的入口；不做全局"重置所有"，reset 粒度收敛到单个设置项或功能域。【实践：VS Code modified 色条 + gear reset；Raycast 局部 reset】【规范：NN/g #3 emergency exit】
7. **设置搜索的触发阈值**：设置项 < 20 个时分组已足够（Microsoft 模板）；一旦含插件/扩展贡献的设置或总数明显增长，就内置「按 name + description 搜索」，不要重蹈 Obsidian 靠插件补搜索的覆辙。【实践：Obsidian 1.13 内置搜索并废弃 Settings Search plugin + VS Code 搜索语法】
8. **i18n 基线**：所有用户可见文案走 key + `{{placeholder}}`，禁止运行时字符串拼接（伪本地化定界符可当场暴露拼接）；建 `glossary` 级别的术语 namespace 统一「语音识别/AI 文本优化」等既有术语；复数走 `_one/_other`（中文虽只有 `_other`，key 结构必须为多复数语言预留）。【规范：i18next Interpolation/Namespaces/Plurals + Microsoft 伪本地化定界符】
9. **locale fallback 链 + 语言切换粘性**：`zh-Hant → zh → en`（生产必须显式设 `fallbackLng`，不能留 `'dev'`）；语言项提供「跟随系统」+ 显式覆盖并持久化。【规范：i18next Fallback + W3C language negotiation】
10. **把设置 schema 做成单一定义源**：每个设置项一处声明（key、类型、默认值、描述 i18n key、作用域、是否需要重载），渲染 UI、校验、持久化白名单（`ALLOWED_SETTING_KEYS`）与类型全部从该声明生成——根治现有「4 处漏一处即静默失败」的纪律负担；扩展贡献的设置沿用同一 schema 入口。【实践：Raycast manifest 声明式偏好 + 类型自动生成；VS Code configuration contribution】【呼应 Murmur CLAUDE.md 规则 5】

---

## 附：本文引用的全部一手来源

| 来源                                                                            | 类型         | URL                                                                                                           |
| ------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| Apple HIG — Settings                                                            | 规范         | https://developer.apple.com/design/human-interface-guidelines/settings                                        |
| Microsoft Learn — Guidelines for app settings (WinUI)                           | 规范         | https://learn.microsoft.com/en-us/windows/apps/design/app-settings/guidelines-for-app-settings                |
| NN/g — The Power of Defaults (2005)                                             | 规范/研究    | https://www.nngroup.com/articles/the-power-of-defaults/                                                       |
| NN/g — Customization vs. Personalization (2016)                                 | 规范/研究    | https://www.nngroup.com/articles/customization-personalization/                                               |
| NN/g — 10 Usability Heuristics                                                  | 规范         | https://www.nngroup.com/articles/ten-usability-heuristics/                                                    |
| W3C — Text size in translation                                                  | 规范         | https://www.w3.org/International/articles/article-text-size/                                                  |
| W3C — When to use language negotiation                                          | 规范         | https://www.w3.org/International/questions/qa-when-lang-neg                                                   |
| Microsoft Learn — Pseudolocalization                                            | 规范         | https://learn.microsoft.com/en-us/globalization/methodology/pseudolocalization                                |
| i18next — Interpolation / Plurals / Essentials / Namespaces / Fallback          | 规范         | https://www.i18next.com/translation-function/interpolation 等（见正文各节）                                   |
| VS Code — User and Workspace Settings 文档                                      | 实践         | https://code.visualstudio.com/docs/getstarted/settings                                                        |
| microsoft/vscode — settingsEditor2.ts、preferences.ts（`ADVANCED_SETTING_TAG`） | 实践（源码） | https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/preferences/browser/settingsEditor2.ts |
| Raycast Manual — Settings                                                       | 实践         | https://manual.raycast.com/settings                                                                           |
| Raycast API — Preferences                                                       | 实践         | https://developers.raycast.com/api-reference/preferences.md                                                   |
| Obsidian Help — Settings                                                        | 实践         | https://obsidian.md/help/settings                                                                             |
| Obsidian 1.13.4 Desktop changelog (2026-07-30)                                  | 实践         | https://obsidian.md/changelog/2026-07-30-desktop-v1.13.4                                                      |
