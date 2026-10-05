<!-- [20261006_README_IntroVideo] Archive for the 15s product intro video
     embedded in README.md / README.zh-CN.md. -->

# Murmur 15s 产品介绍视频 · 归档

| 文件                          | 说明                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `murmur-intro-15s.mp4`        | 发布版（带 BGM），README 引用                                                           |
| `murmur-intro-15s-nobgm.mp4`  | 无 BGM 版（保留全部 SFX），供平台自配音乐                                               |
| `murmur-intro-15s-poster.jpg` | 备用封面帧（f300，润色对比画面；README 现用 user-attachments 内嵌播放器，此图留作备用） |

- 规格：15.0s / 1920×1080 / 30fps / H.264 + AAC
- 制作工程（可编辑重渲）：`productions/intro-15s-remotion/`（Remotion，时间线事实源 `src/timeline.ts`）
  重渲：`cd productions/intro-15s-remotion && npx remotion render src/index.ts MurmurIntro out/promo.mp4`
- 素材口径：界面为真实截图（演示语音经真实 FunASR 本地转写，内容为虚构演示文案），无任何真实用户数据

## 素材授权

- BGM：**Deep Urban** — Eugenio Mininni，[Mixkit](https://mixkit.co/free-stock-music/tech-house/)（track #623，直链 `assets.mixkit.co/music/623/623.mp3`）。Mixkit License：免费商用、免署名。已通过 MD5 比对完成来源复核（`03028dc6670a0b0f69c652b192c8e48a`，与曲库下载件字节一致）。
- SFX：Mixkit 免费商用音效库（同上许可）。
- 渲染引擎：Remotion（仅约束使用该软件，不约束渲染产物；个人与小团队免费）。
