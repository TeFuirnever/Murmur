# Troubleshooting / 故障排除

---

## 中文

<!-- [20260911_Fix_DamagedAppWorkaround] Issue #337：v1.5.0 macOS dmg 只带 Electron
     链接器 ad-hoc 签名、无资源密封，Apple Silicon 上被 Gatekeeper 判为"已损坏"。
     与"无法验证开发者"是不同故障，右键打开无法绕过。 -->

### macOS 提示"已损坏，无法打开"

**症状**: 首次安装打开时提示"Murmur.app 已损坏，无法打开。你应该将它移到废纸篓。"

**原因**: v1.5.0 及更早版本的安装包签名密封损坏（ad-hoc 签名缺少资源密封）。注意这与"无法验证开发者"是**不同**的问题——后者右键点击应用 →"打开"即可，本场景右键打开无效。

**解决方案**（终端执行）:

```bash
xattr -cr /Applications/Murmur.app && codesign --force --deep --sign - /Applications/Murmur.app
```

第一条清除下载隔离属性，第二条用本地 ad-hoc 签名重建密封。如提示权限不足，在命令前加 `sudo`。修复后即可正常打开。

<!-- [20260911_Fix_DamagedAppWorkaround] END -->

### 模型下载失败

<!-- [20261006_Docs_423_T10] spec #412 (T10): rewritten for the ONNX int8
     engine's dual-source downloader (modelDownloader.ts). The old advice to
     run `python download_models.py` fetched the legacy fp32 torch
     checkpoints, which the new engine never reads — removed. Sources,
     resume and the integrity manifest are pinned by
     tests/unit/onnx-docs-sync.test.ts. -->

**症状**: 首次启动时一直显示"正在下载模型"或下载失败

**解决方案**:

1. 检查网络连接，确保能访问 ModelScope（`modelscope.cn`）和 GitHub Release 镜像——下载支持双源自动回退：ModelScope 主源失败时自动切换到 GitHub Release 镜像（同一 sha256 清单，逐字节一致）
2. 如果使用代理，请让应用进程能读到 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量（下载失败的应用内提示也会指引检查代理设置）
3. 下载支持断点续传：失败后在应用内重试，将从断点继续，无需从头下载
4. 检查磁盘空间（需要至少 2GB 可用空间）
5. 模型完整性逐文件 sha256 校验：若提示"模型损坏"，删除模型下载目录后在应用内重新下载

### Python 环境问题

**症状**: 提示"找不到 Python"或 Python 模块导入失败

**说明**: 桌面应用自带嵌入式 Python（funasr-onnx 运行时），普通用户无需安装任何 Python 环境。以下步骤仅适用于从源码运行的开发场景。

**解决方案**:

1. 确保安装了 Python 3.11+（与 `pyproject.toml` 的 requires-python 一致）
2. 推荐使用 `uv` 按依赖声明安装：
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   uv sync
   ```

### 语音识别服务启动失败

**症状**: 设置中显示语音识别状态为"错误"或"未就绪"

**解决方案**:

1. 从源码运行时，先用 `uv sync` 按 `pyproject.toml` 完成依赖安装；打包应用使用内置运行时，无需手动安装依赖
2. 检查模型文件是否存在（应用数据目录下 `models/onnx-int8/`，或设置中的模型下载目录）
3. Murmur 内置健康监控，会自动尝试重启（最多 3 次）
4. 重启 Murmur 应用

### 全局热键不工作

**症状**: 按 `Cmd+Shift+Space` 没有反应

**解决方案**:

1. 检查是否有其他应用占用了相同热键
2. macOS: 系统偏好设置 → 键盘 → 快捷键 → 检查冲突
3. 尝试重启 Murmur
4. 检查 Murmur 是否有辅助功能权限（macOS）

### 音频文件导入失败

**症状**: 导入 mp3/m4a 文件时报错

**解决方案**:

1. 确保已安装 ffmpeg（`ffmpeg -version` 检查）
2. macOS: `brew install ffmpeg`
3. Windows: `winget install ffmpeg`
4. WAV 和 FLAC 格式无需 ffmpeg，可直接导入

### 录音没有声音 / 识别结果为空

**症状**: 按热键录音后没有文字输出

**解决方案**:

1. 检查麦克风权限（系统设置 → 隐私 → 麦克风）
2. 检查默认输入设备是否正确
3. 尝试对着麦克风说话，观察音量指示器是否有反应
4. 检查 FunASR 服务状态是否为"就绪"

### AI 文本优化不工作

**症状**: 识别结果未被 AI 优化

**解决方案**:

1. 检查 API Key 是否正确填写
2. 检查 API 地址是否可达
3. 检查网络连接
4. 查看日志中的错误信息

---

## English

<!-- [20260911_Fix_DamagedAppWorkaround] Issue #337: the v1.5.0 macOS dmg shipped
     with only Electron's linker ad-hoc signature and no resource seal, so
     Gatekeeper on Apple Silicon rejects it as "damaged". This is a different
     failure from "unidentified developer"; right-click → Open cannot bypass it. -->

### macOS Reports "Murmur.app Is Damaged and Can't Be Opened"

**Symptom**: On first launch after installing, macOS says "Murmur.app is damaged and can't be opened. You should move it to the Trash."

**Cause**: v1.5.0 and earlier shipped with a broken signature seal (ad-hoc signature without a resource seal). This is a **different** issue from "cannot verify the developer" — that one is fixed by right-click → Open, which does NOT work here.

**Solutions** (run in Terminal):

```bash
xattr -cr /Applications/Murmur.app && codesign --force --deep --sign - /Applications/Murmur.app
```

The first command clears the quarantine attribute, the second rebuilds the seal with a local ad-hoc signature. Prefix with `sudo` if you get a permission error. The app opens normally afterwards.

<!-- [20260911_Fix_DamagedAppWorkaround] END -->

### Model Download Fails

<!-- [20261006_Docs_423_T10] spec #412 (T10): rewritten for the ONNX int8
     engine's dual-source downloader (modelDownloader.ts). The old advice to
     run `python download_models.py` fetched the legacy fp32 torch
     checkpoints, which the new engine never reads — removed. -->

**Symptom**: First launch shows "downloading model" indefinitely or fails

**Solutions**:

1. Check network access to ModelScope (`modelscope.cn`) and the GitHub Release mirror — downloads use dual sources with automatic failover: when the ModelScope primary fails, the GitHub Release mirror takes over (same sha256 manifest, byte-identical)
2. If you use a proxy, make sure the app process can read the `HTTP_PROXY` / `HTTPS_PROXY` environment variables (the in-app failure hint also points at proxy settings)
3. Downloads resume from the breakpoint: retry in the app after a failure and it continues — no need to start over
4. Ensure at least 2GB free disk space
5. Integrity is verified per file against sha256: if the app reports "model corrupted", delete the model download directory and download again in the app

### Python Environment Issues

**Symptom**: "Python not found" or module import errors

**Note**: The desktop app ships an embedded Python (the funasr-onnx runtime) — end users never need to install Python. The steps below apply only to running from source.

**Solutions**:

1. Install Python 3.11+ (matches the `pyproject.toml` requires-python)
2. Use `uv` to install the declared dependencies:
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   uv sync
   ```

### Speech Recognition Service Won't Start

**Symptom**: Settings shows the speech recognition status as "error" or "not ready"

**Solutions**:

1. When running from source, install dependencies via `uv sync` per `pyproject.toml` first; the packaged app uses the embedded runtime and needs no manual dependency install
2. Check the model files exist (`models/onnx-int8/` under the app data directory, or the model download directory shown in Settings)
3. Murmur has a built-in health monitor with auto-restart (up to 3 attempts)
4. Restart Murmur

### Global Hotkey Not Working

**Symptom**: `Cmd+Shift+Space` has no response

**Solutions**:

1. Check if another app uses the same hotkey
2. macOS: System Preferences → Keyboard → Shortcuts → check for conflicts
3. Try restarting Murmur
4. Check if Murmur has Accessibility permissions (macOS)

### Audio File Import Fails

**Symptom**: Error when importing mp3/m4a files

**Solutions**:

1. Ensure ffmpeg is installed (`ffmpeg -version`)
2. macOS: `brew install ffmpeg`
3. Windows: `winget install ffmpeg`
4. WAV and FLAC formats work without ffmpeg

### No Sound / Empty Recognition Results

**Symptom**: No text output after recording

**Solutions**:

1. Check microphone permissions (System Settings → Privacy → Microphone)
2. Verify the default input device is correct
3. Speak into the microphone and check if the volume indicator responds
4. Check FunASR service status is "ready"

### AI Text Optimization Not Working

**Symptom**: Recognition results are not AI-optimized

**Solutions**:

1. Verify the API Key is correct
2. Check if the API URL is reachable
3. Check network connection
4. Review error messages in logs
