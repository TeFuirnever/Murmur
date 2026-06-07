/**
 * Shared test fixtures for E2E tests.
 *
 * All test data uses clearly fake values to prevent
 * accidental credential exposure in CI logs.
 */

/** Sample transcription responses */
const TRANSCRIPTION_RESPONSES = {
  success: {
    success: true,
    text: "这是一段测试转录文本",
    raw_text: "这是一段测试转录文本",
    confidence: 0.95,
    duration: 3.5,
    language: "zh-CN",
  },
  empty: {
    success: true,
    text: "",
    raw_text: "",
    confidence: 0,
    duration: 0,
    language: "zh-CN",
  },
  failure: {
    success: false,
    error: "识别失败：音频为空",
  },
};

/** Sample AI processing responses */
const AI_RESPONSES = {
  success: {
    success: true,
    text: "这是优化后的文本内容",
    enhanced_by_ai: true,
    mode: "optimize",
  },
  failure: {
    success: false,
    error: "AI 服务连接失败",
  },
};

/** Sample model status responses */
const MODEL_RESPONSES = {
  needDownload: {
    stage: "need_download",
    isReady: false,
    downloadProgress: 0,
  },
  downloading: (progress = 50) => ({
    stage: "downloading",
    isReady: false,
    downloadProgress: progress,
  }),
  loading: {
    stage: "loading",
    isReady: false,
  },
  ready: {
    stage: "ready",
    isReady: true,
  },
  error: (msg = "模型加载失败") => ({
    stage: "error",
    isReady: false,
    error: msg,
  }),
};

/** Sample transcription records for history tests */
const HISTORY_RECORDS = [
  {
    id: 1,
    text: "今天天气很好，适合出门散步",
    raw_text: "今天天气很好适合出门散步",
    confidence: 0.92,
    duration: 5.2,
    source_type: "recording",
    created_at: "2026-06-07T10:00:00Z",
  },
  {
    id: 2,
    text: "会议纪要：项目进度正常",
    raw_text: "会议纪要项目进度正常",
    confidence: 0.88,
    duration: 8.1,
    source_type: "file",
    source_file_path: "/tmp/meeting.wav",
    created_at: "2026-06-07T11:00:00Z",
  },
  {
    id: 3,
    text: "人工智能正在改变世界",
    raw_text: "人工智能正在改变世界",
    confidence: 0.96,
    duration: 3.0,
    source_type: "recording",
    created_at: "2026-06-07T12:00:00Z",
  },
];

/** Sample settings for tests */
const DEFAULT_SETTINGS = {
  ai_api_key: "", // NEVER use real API keys in test fixtures
  ai_base_url: "https://api.openai.com/v1",
  ai_model: "gpt-3.5-turbo",
  ai_temperature: 0.3,
  ai_max_tokens: 2000,
  enable_ai_optimization: true,
  window_always_on_top: true,
  auto_paste: "paste",
  close_behavior: "hide",
  theme: "system",
};

/** Fake API key for testing — clearly marked as fake */
const FAKE_API_KEY = "sk-test-FAKE-xxxx-do-not-use";

module.exports = {
  TRANSCRIPTION_RESPONSES,
  AI_RESPONSES,
  MODEL_RESPONSES,
  HISTORY_RECORDS,
  DEFAULT_SETTINGS,
  FAKE_API_KEY,
};
