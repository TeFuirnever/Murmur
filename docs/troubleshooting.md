# Troubleshooting / 故障排除

---

## 中文

### FunASR 模型下载失败

**症状**: 首次启动时一直显示"正在下载模型"或下载失败

**解决方案**:
1. 检查网络连接，确保能访问 ModelScope（`modelscope.cn`）
2. 如果使用代理，在 `.env` 文件中设置 `HTTP_PROXY` 和 `HTTPS_PROXY`
3. 手动下载模型：
   ```bash
   python download_models.py
   ```
4. 检查磁盘空间（需要至少 2GB 可用空间）

### Python 环境问题

**症状**: 提示"找不到 Python"或 Python 模块导入失败

**解决方案**:
1. 确保安装了 Python 3.8+（推荐 3.11）
2. 推荐使用 `uv` 管理环境：
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   uv sync
   ```
3. 或手动安装依赖：
   ```bash
   pip install funasr modelscope torch torchaudio librosa numpy
   ```

### FunASR 服务启动失败

**症状**: 设置中显示 FunASR 状态为"错误"或"未就绪"

**解决方案**:
1. 检查 Python 依赖是否完整：`pip install funasr modelscope torch`
2. 检查模型文件是否存在：`ls models/` 目录
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

### FunASR Model Download Fails

**Symptom**: First launch shows "downloading model" indefinitely or fails

**Solutions**:
1. Check network connection and access to ModelScope (`modelscope.cn`)
2. If using a proxy, set `HTTP_PROXY` and `HTTPS_PROXY` in `.env`
3. Download models manually:
   ```bash
   python download_models.py
   ```
4. Ensure at least 2GB free disk space

### Python Environment Issues

**Symptom**: "Python not found" or module import errors

**Solutions**:
1. Install Python 3.8+ (3.11 recommended)
2. Use `uv` for environment management:
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   uv sync
   ```
3. Or install dependencies manually:
   ```bash
   pip install funasr modelscope torch torchaudio librosa numpy
   ```

### FunASR Service Won't Start

**Symptom**: Settings shows FunASR status as "error" or "not ready"

**Solutions**:
1. Verify Python dependencies: `pip install funasr modelscope torch`
2. Check model files exist: `ls models/`
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
