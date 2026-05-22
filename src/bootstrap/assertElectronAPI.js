// Asserts window.electronAPI is available. If not, renders a plain-DOM
// fallback (zero React/import dependencies to avoid self-crash) and returns
// false so the caller can skip mounting. Reload button uses location.reload(),
// not electronAPI.
export function assertElectronAPI() {
  if (typeof window === "undefined" || !window.electronAPI) {
    if (typeof document !== "undefined") {
      document.body.innerHTML =
        '<div style="position:fixed;inset:0;display:flex;flex-direction:column;' +
        "align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;" +
        'padding:24px;text-align:center;background:#1c1c1e;color:#f5f5f7">' +
        '<h1 style="font-size:20px;margin:0 0 12px">Electron API 不可用</h1>' +
        '<p style="margin:0 0 24px;opacity:0.7;line-height:1.5">' +
        "preload 脚本加载失败，主功能均无法工作。<br/>请重启 Murmur。" +
        "</p>" +
        '<button onclick="location.reload()" ' +
        'style="padding:10px 20px;border-radius:8px;border:0;' +
        'background:#0071e3;color:#fff;cursor:pointer;font-size:14px">' +
        "重新加载" +
        "</button>" +
        "</div>";
    }
    return false;
  }
  return true;
}
