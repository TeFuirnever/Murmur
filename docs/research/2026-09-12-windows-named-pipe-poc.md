# Windows named pipe 安全 PoC 结论文档 (Spec #258, ticket #263)

日期:2026-09-12 | 执行环境:GitHub Actions `windows-latest`(Windows_NT, Node 22.23.2),探针脚本 `scripts/poc/windows-named-pipe-acl.mjs`,workflow `poc-named-pipe`(workflow_dispatch,可重复执行)
状态:**研究完成,不改任何 src/ 产品代码**;服务端与探针客户端为两个无关进程(跨进程,同用户)
原始 verdict:run [34665452749](https://github.com/TeFuirnever/Murmur/actions/runs/34665452749)(首轮,P1 比对 bug 修复前)+ run [34666090603](https://github.com/TeFuirnever/Murmur/actions/runs/34666090603)(修复后完整数据),artifact `named-pipe-poc-verdict`

| #   | 项                                  | 结论                                                 |
| --- | ----------------------------------- | ---------------------------------------------------- |
| P1  | 管道命名空间枚举(无关进程,仅凭前缀) | **VERIFIED — 可枚举且精确定位目标管道**              |
| P2  | 无凭据连接与读取(默认 DACL 暴露面)  | **VERIFIED — 无 token 直连成功读到服务端数据帧**     |
| P3  | Node 运行时 ACL 控制面              | **VERIFIED — net.Server 无任何 security/DACL API**   |
| P4  | 应用层 token 握手(候选补偿控制)     | **VERIFIED — 错/缺 token 拒绝,正 token 放行,端到端** |
| P5  | 不可猜名基线                        | **VERIFIED — 未知 128 位名 ENOENT 不可达**           |
| —   | 跨**用户**读取                      | **UNVERIFIED**(CI 单用户限制,见「残余风险」)         |

---

## P1 管道枚举 — VERIFIED(2026-09-12 run 34666090603)

客户端子进程以 `fs.readdirSync("\\\\.\\pipe\\")` 列举命名空间:系统共存 39 条管道,其中以 `murmur-poc-` 为前缀的**恰好命中 1 条,且就是服务端当次监听的目标管道**(`enumeratedTargetName: "murmur-poc-236b042f6b273c354c88dc0c20f31090"`)。

**设计推论:「不可猜管道名」不构成机密性控制。** 命名空间对本机所有进程可读,随机名只能防"撞名/误连",防不了主动探测。首轮采集中该探针曾因比对前缀归一化 bug 误报 `foundTarget: false`(39 条、前缀命中 1 条的数据已足以暴露真相),修复后结论确定。

## P2 无凭据读取 — VERIFIED(默认 DACL 暴露面坐实)

同一无关进程在**不提交任何 token** 的情况下 `net.connect` 到服务管道成功,并读到服务端主动发出的问候帧 `{"greeting":"unauthenticated-greeting"}`。

**设计推论:默认 DACL 下,本机任意进程都能连上 Murmur 的管道并读取其主动下发的数据。** 若通道协议存在"服务端先说话"的帧(进度推送、状态广播),这些内容对全机可见;同时任意进程可占连接、注入帧——通道的机密性与完整性在传输层均为零。

## P3 Node ACL 控制面 — VERIFIED(约束成立)

对处于监听态的 `net.Server` 实例做完整原型链成员枚举(serverMembers 全量随 verdict 入库),正则 `secur|dacl|acl|sid|priv` 匹配 **0 项**(`hasSecurityApi: false`)。与 Node 文档口径一致:**net 模块无法设置管道 DACL,收紧必须出 Node(native/PowerShell P/Invoke),不属于首期工程合理成本。**

## P4 应用层 token 握手 — VERIFIED(补偿控制有效)

- 错 token(`"definitely-not-the-token"`)→ 首帧即回 `{"error":"token-rejected"}` 并断开;
- 缺 token(`{token:null}`)→ 同样拒绝;
- 正 token(32 字节随机,另一连接)→ `{"accepted":true}`。

**设计推论:机密性与完整性可以在应用层完整重建,与传输层 DACL 无关。** 握手前服务端不发任何业务帧(拒绝帧除外)。

## P5 基线 — VERIFIED

对未监听的 128 位随机名连接:`ENOENT`。随机名本身不可猜中(但见 P1:可被枚举,故随机名的价值是防误连与提高噪声,不是访问控制)。

## 决策

**Windows 本地通道采用 named pipe + 补偿控制组合,不退回回环 TCP。**

1. **补偿控制(全部落地,缺一不可)**:
   - 首帧 token 握手(P4 已证):token 存 userData 内 0600 文件,会话短 TTL;握手前服务端零业务输出;
   - 管道名含 128 位随机段(P5):防误连/降低可发现噪声(P1 已证其单独不构成控制,依赖 token);
   - 拒绝帧与限速:握手失败即断开(实测语义),防本机进程占连接。
2. **不退回回环 TCP 的依据**:回环 TCP 端口同样对本机任意进程开放(暴露面等价甚至更差——端口可被扫描、无命名空间隔离还要处理端口冲突),而补偿控制组合在 named pipe 上已被 P4 证明足够。退回 TCP 不减少任何风险,只增加复杂度。
3. **对 #265(本地 IPC 通道)的硬性输入**:协议首帧必须为 `{"token": "..."}`,服务端在 token 校验前不 emit 任何业务帧;会话 TTL 到期后要求重新握手。

## 残余风险(诚实记录)

- **跨用户读取 UNVERIFIED**:CI runner 单用户,无法实测"另一用户会话的进程"的访问结果。Microsoft 文档口径为默认 DACL 授予 Everyone 读权限——按保守假设**视为可读**。该残余不影响上述决策:token 握手在应用层,不依赖 DACL;跨用户场景下"枚举发现管道 + 建连"都成功也没关系,过不了握手就拿不到任何业务数据。
- 握手前的一帧拒绝响应(`token-rejected`)对任意进程可见:泄露的仅是"这里有一个 Murmur 管道",无业务信息。
- 未验证大量恶意连接下的行为(本机 DoS):Phase 1 实现时以并发连接上限兜底,不属本 spike 范围。

## 供 #265 的直接输入汇总

1. named pipe 形态确定;回环 TCP 仅作(named pipe 创建失败等)异常回退,非安全回退。
2. 通道安全 = 随机名 + 首帧 token + 短 TTL + 失败即断,全部应用层,已实测有效。
3. 服务端握手前零业务帧是实现红线(P2 证明默认状态下"先说话"等于向全机广播)。
