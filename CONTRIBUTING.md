# Contributing to Murmur

感谢你对 Murmur 的关注！本文档帮助你快速上手开发。

## 开发环境

### 必要条件

- **Node.js** 18+（推荐 22 LTS）
- **pnpm** 9+（`npm install -g pnpm`）
- **Python** 3.8+（推荐 3.11）
- **ffmpeg**（音频格式转换，macOS: `brew install ffmpeg`）
- **Git**
- macOS / Windows / Linux

### 搭建步骤

```bash
git clone https://github.com/TeFuirnever/Murmur.git
cd Murmur
pnpm install

# Python 环境（推荐 uv）
curl -LsSf https://astral.sh/uv/install.sh | sh
uv sync
uv run python download_models.py

# 启动
pnpm dev
```

### 常用命令

| 命令                               | 说明                                |
| ---------------------------------- | ----------------------------------- |
| `pnpm dev`                         | 启动开发模式（Electron + Vite HMR） |
| `pnpm test`                        | 运行所有测试                        |
| `pnpm test:watch`                  | 监听模式运行测试                    |
| `pnpm test:coverage`               | 运行测试并生成覆盖率报告            |
| `pnpm test:e2e`                    | 运行端到端测试（Playwright）        |
| `pnpm lint`                        | ESLint 代码检查                     |
| `pnpm format:check`                | 检查代码格式（Prettier）            |
| `pnpm format`                      | 自动格式化代码                      |
| `pnpm license:check`               | 检查依赖许可证（拦截 GPL/AGPL）     |
| `pnpm ci:check`                    | 本地运行所有 CI 门禁                |
| `pnpm ci:fix`                      | 自动修复 CI 问题                    |
| `pnpm run build`                   | 构建生产版本                        |
| `pnpm run prepare:python:embedded` | 准备嵌入式 Python 环境              |

## 项目结构

```
main.js                  # Electron 主进程入口
preload.js               # 渲染进程 ↔ 主进程桥接
funasr_server.py         # FunASR Python 服务（stdin/stdout IPC）
src/
  App.jsx                # 主界面
  settings.jsx           # 设置页面
  history.jsx            # 历史记录页面
  main.jsx               # React 入口
  components/            # UI 组件
  hooks/                 # React Hooks（useRecording, useHotkey 等）
  helpers/               # 主进程模块（Node.js）
  utils/                 # 工具函数
tests/                   # 测试文件（Vitest）
```

## 代码规范

### 提交格式

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 添加音频预处理功能
fix: 修复录音中断后未保存的问题
docs: 更新 API 文档
test: 添加数据库 CRUD 测试
refactor: 提取转录逻辑到独立 hook
chore: 升级 Electron 到 v36
```

### 代码风格

- ESLint 配置在项目根目录 `eslint.config.js`
- 运行 `pnpm lint` 检查，确保 0 errors
- 未使用的变量/参数用 `_` 前缀

### 测试

- 测试框架：Vitest
- 位置：`tests/unit/`
- 覆盖率阈值：statements 97%、branches 90%、functions 100%、lines 98%
- 修改代码后运行 `pnpm test` 确保不引入回归
- 提交前运行 `pnpm ci:check` 确保所有门禁通过

## PR 流程

1. **Fork** 仓库
2. 创建分支：`git checkout -b feat/your-feature`
3. 开发 + 测试：确保 `pnpm lint` 和 `pnpm test` 通过
4. 提交：使用 conventional commit 格式
5. 推送：`git push origin feat/your-feature`
6. 创建 **Pull Request** 到 `main` 分支
7. 等待 review

### PR 检查清单

- [ ] `pnpm ci:check` 通过（包含 lint、format、license、test+coverage、build）
- [ ] 新功能有对应测试
- [ ] 提交信息符合 conventional commits

### CI Gates

每次 PR 自动运行以下检查：

1. **Format check** — `pnpm format:check`（Prettier）
2. **Lint** — `pnpm lint`（ESLint，0 warnings）
3. **Security audit** — `pnpm audit --audit-level moderate`（非阻塞）
4. **License compliance** — `pnpm license:check`（拦截 GPL/AGPL）
5. **Dependency review** — PR 中自动审查新增依赖
6. **Test + coverage** — `pnpm test -- --coverage`（覆盖率阈值：97%/90%/100%/98%）
7. **Build preload** — `pnpm run build:preload`
8. **Build renderer** — `pnpm run build:renderer`
9. **E2E tests** — `pnpm test:e2e`（非阻塞）

## 架构概览

### 主进程 ↔ 渲染进程通信

```
渲染进程 (React)
    ↕ contextBridge (preload.js)
主进程 (Electron)
    ↕ stdin/stdout
FunASR Python 进程
```

- **IPC 通道**：常量定义在 `src/helpers/ipc-contracts.js`，处理器按领域拆分在 `src/helpers/ipc/`，通过 `preload.js` 暴露为 `window.electronAPI`
- **FunASR 通信**：Node.js spawn Python 子进程，通过 JSON over stdin/stdout 通信
- **消息路由**：`ServerMessageRouter` 管理 UUID 请求-响应匹配

### 数据流

1. 用户按热键 → MediaRecorder 录音
2. 录音结束 → WAV 音频数据通过 IPC 发送到主进程
3. 主进程发送给 Python FunASR 服务 → 返回转录文本
4. 可选：AI API 优化文本
5. 结果保存到 SQLite + 自动粘贴到光标位置

### Python 子进程生命周期

FunASR 以 Python 子进程方式运行，生命周期由 `FunASRManager`（`src/helpers/funasrManager.js`）管理：

1. **启动（spawn）**：Electron 主进程通过 `child_process.spawn` 启动 `funasr_server.py`，传入模型路径和配置参数
2. **通信（stdin/stdout JSON IPC）**：Node.js 通过 stdin 向 Python 发送 JSON 请求（含 UUID），Python 处理后通过 stdout 返回 JSON 响应。`ServerMessageRouter` 通过 UUID 匹配请求与响应
3. **健康监控（health check）**：每 30 秒发送 ping 消息，Python 返回 pong。若超时未收到响应，自动触发重启
4. **自动重启（auto-restart）**：健康检查失败时自动重启 Python 进程，最多重试 3 次（`maxRestarts = 3`）
5. **优雅关闭（graceful shutdown）**：应用退出时发送关闭信号，等待 Python 进程退出，超时后强制 kill

### 数据库 Schema

使用 SQLite（`better-sqlite3`），数据库文件位于 `src/helpers/database.js` 管理：

**transcriptions 表**：
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键自增 |
| text | TEXT | 最终文本（经 AI 优化后的） |
| raw_text | TEXT | 原始识别文本 |
| processed_text | TEXT | AI 处理后的文本 |
| confidence | REAL | 识别置信度 |
| language | TEXT | 语言（默认 `zh-CN`） |
| duration | REAL | 录音时长（秒） |
| file_size | INTEGER | 音频文件大小 |
| source_type | TEXT | 来源类型：`recording`（录音）/ `file`（文件导入） |
| source_file_path | TEXT | 导入文件的原始路径 |
| segments | TEXT | 分段信息（JSON） |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

**settings 表**：
| 字段 | 类型 | 说明 |
|------|------|------|
| key | TEXT | 设置键（主键） |
| value | TEXT | 设置值（JSON 字符串） |
| updated_at | DATETIME | 更新时间 |

### 关键模块

| 模块                | 文件                                 | 职责                                                                                                    |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| FunASRManager       | `src/helpers/funasrManager.js`       | FunASR 门面，委托到 `funasrServer.js`、`modelManager.js`、`pythonEnvironment.js`、`audioFileHelpers.js` |
| IPC Handlers        | `src/helpers/ipc/`                   | 按 9 个领域拆分的 Electron IPC 处理器，常量定义在 `ipc-contracts.js`                                    |
| DatabaseManager     | `src/helpers/database.js`            | SQLite CRUD、schema 迁移、数据查询分页                                                                  |
| WindowManager       | `src/helpers/windowManager.js`       | 窗口创建、大小管理、浮动控件                                                                            |
| ClipboardManager    | `src/helpers/clipboard.js`           | 自动粘贴到光标位置（macOS osascript / Electron clipboard）                                              |
| HotkeyManager       | `src/helpers/hotkeyManager.js`       | 全局热键注册、F2 双击检测                                                                               |
| PythonInstaller     | `src/helpers/pythonInstaller.js`     | 嵌入式 Python 环境准备                                                                                  |
| ServerMessageRouter | `src/helpers/serverMessageRouter.js` | UUID 请求-响应匹配路由                                                                                  |
| ExportFormatters    | `src/helpers/exportFormatters.js`    | TXT/SRT/VTT/MD/DOCX 导出格式化                                                                          |
| UpdateManager       | `src/helpers/updateManager.js`       | 半自动更新（SHA256 校验、进度 UI、系统通知）                                                            |

## 报告问题

- **Bug**: [创建 Issue](https://github.com/TeFuirnever/Murmur/issues/new?template=bug_report.md)
- **功能建议**: [创建 Issue](https://github.com/TeFuirnever/Murmur/issues/new?template=feature_request.md)

## 行为准则

请遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。尊重每一位贡献者。
