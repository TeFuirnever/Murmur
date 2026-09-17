# 当期研究快照 — Murmur GitHub README 主图

- captured_at: 2026-09-08
- mode: official-guidance-only（本平台本账号无历史封面数据；检索范围为仓库内 Spec #299 README 审计记录与 GitHub 官方 social preview 文档要点）
- scope: 本仓库 git 历史 #300–#304 / PR #308–#310 中记录的 5 个同类开源语音项目 README 基准审计；GitHub 官方仓库社交预览指南；本仓库现有真实截图资产
- limitations: 基准审计为仓库内二手记录，未重新逐项目截图复核；无平台后台数据；机制观察只生成假设，不构成平台算法结论
- anti_copy_boundary: true（只抽象机制，不复制任何第三方成图、标题或身份信号）

## 模式观察

1. 首屏真实产品图是同类开源项目的通行证明方式：Spec #299 审计记录 5/5 基准项目在首屏内嵌真实 UI 图；真实截图比抽象插画更常承担首屏证明（审计记录见 git #300–#304 与 README.md 头部注释）。
2. 可验证属性比主观自评更可信：审计记录 0/5 基准项目发布带星级自评的对比表；本仓库已把对比表改为可验证属性行。
3. GitHub README 图需在明暗两种主题下都可读，且必须有 alt text；社交预览是独立资产，不能与 README 图混用尺寸（GitHub 官方指南要点，本仓库 profile github-readme-image.v1 已固化为 1280×720 本地合同）。

## 本账号历史结果

无（本账号此前未发布过 README 品牌主图），记为"未提供"。

## 2026-09-16 追记：英文门脸变体与人工批准

- cover-a-en：已批准 cover-a 的英文文案变体（同 concept-outcome、同真实证据截图、同狐狸锚点，仅文案层英译；render_covers.py `variant_a_en` 确定性渲染，asset_sha256 8ed3e7d8…c22a0c）。
- 人工门关闭：owner 于本会话批准 cover-a（README.zh-CN.md）与 cover-a-en（README.md）；bundle `human_review.status = approved`，`reviewed_pair_sha256 = 9a7d19…`（cover-a 标题-封面配对）。
- cover-a-en 复核资产在 `review/cover-a-en/`（手动复刻 build-cover-review-artifacts.py 输出；v5 schema 限定三候选，变体不占用 finalist 名额）。
- 仍开放：推送 GitHub 后的 readme_desktop / readme_mobile / dark_theme / light_theme 真实预览回执。
