# Magic Game Harness Unity — 项目总览与阅读路线图

> 源码：[github.com/mimizmi/magic-game-harness-unity](https://github.com/mimizmi/magic-game-harness-unity)
> 状态：脚手架 + 部分实现（截至 `1fe2010` commit, 2026-08-21）
> **这是 mimizmi 自己的项目**——一个 Unity 6 模块化游戏框架，目标类似"Bevy + mod-first"的 Unity 等价物。

---

## 1. 项目要解决什么问题

设想你要做这样的平台：

1. **核心团队**开发"框架"——AOT 内核、生命周期、网络桥、存档、Hot Reload
2. **职业 Mod 创作者**写 DLL 形式的玩法模块、UI、规则，**不需要拿到游戏源码**
3. **普通玩家**一键安装/卸载/组合 Mod，世界存档不会因为某个 Mod 升级而损坏

**核心矛盾**：Mod 要够"自由"（能注册能力、能订阅事件、能修改规则），但又**不能**绕过框架的 AOT 校验机制（否则一个 Bug Mod 就能毁掉整个世界）。

Magic Game Harness 的答案是：

| 层 | 谁能改 | 责任 |
|---|---|---|
| **AOT Kernel** | 框架开发者 | 不变量、生命周期、版本兼容性、依赖解析 |
| **ModApi（公共契约）** | 框架开发者 | Mod 能调用的接口，stable across versions |
| **HybridCLR 热更层** | Mod 作者 | 玩法逻辑、AI 技能、内容定义 |

**关键设计**：Mod **不能**直接引用 Context Runtime、Networking、Persistence 等内部实现，只能引用 Primitives + ModApi 这两个**对外公开**的程序集。

---

## 2. 13 个 AOT 程序集的依赖图（spec 第 8 节）

```
Game.Core.Primitives          ← 零依赖，最底层（namespaced IDs、版本、诊断原语）
        ↓
Game.ModApi                   ← 公共契约，仅依赖 Primitives（给 Mod 编译用）
        ↓
   ┌────┴────┬─────────┬───────────┬────────────┐
Context    Rules    Networking  Persistence  HotUpdate       Diagnostics
   └────┴────┴─────────┴───────────┴────────────┘
                        ↓
                Game.Bootstrap            ← 组合根（VContainer 装配）
```

| 程序集 | 责任 | 实际代码量（截至当前 commit） |
|---|---|---|
| `Game.Core.Primitives` | StableId、Result、Clock、诊断原语 | 4 文件 / ~580 行 ✅ 已实现 |
| `Game.ModApi` | 11 个子命名空间（Lifecycle/Capabilities/UI/Input/...） | 8 文件 / ~290 行 ✅ 契约定义 |
| `Game.Core.Context` | Fiber registry、依赖解析、effect ownership | ❌ 空 anchor |
| `Game.Core.Rules` | 权威规则提供者 | ❌ 空 anchor |
| `Game.Core.Networking` | NGO 自定义消息桥 | ❌ 空 anchor |
| `Game.Core.Persistence` | Snapshot / journal / schema / lockfile | ❌ 空 anchor |
| `Game.Core.HotUpdate` | HybridCLR bootstrap | ❌ 空 anchor |
| `Game.Core.Diagnostics` | 结构化日志 | ⏳ 部分（DiagnosticEventFactory） |
| `Game.Bootstrap` | VContainer scope + App/Session 生命周期 | ✅ 7 文件 / ~580 行 |
| `Game.Framework.Editor` | 框架开发工具 | ❌ 空 anchor |
| `Game.Framework.Conformance` | 合成夹具（中性 Mod 验证） | ✅ NeutralModuleFixture.cs |
| `Game.Framework.Tests.EditMode` | EditMode 测试 | ✅ 14 文件 |
| `Game.Framework.Tests.PlayMode` | PlayMode 测试 | ✅ 4 文件 |

**当前状态**：脚手架完整 + Primitives + ModApi 契约 + Bootstrap + 大量测试。下一步要实现的是 **Context Runtime**（spec 第 10 节，框架的灵魂）。

---

## 3. 关键设计原则（spec 第 6 节）

### 3.1 Stable contracts, replaceable implementations

> 公共 API 只暴露接口 + DTO，不暴露内部 Context Runtime。

`Game.ModApi` 是 Mod 唯一能引用的程序集；它不依赖 `Game.Core.Context`（依赖图是单向的）。

### 3.2 AOT for invariants, hot for variability

- 性能/完整性关键的基础设施（版本校验、依赖解析、生命周期）→ AOT
- 频繁变化的玩法/内容 → HybridCLR 热更

### 3.3 Explicit ownership — 副作用归属

每个注册/订阅/任务都归属一个 **module fiber**（生命周期纤维）：
- 注册 → 拿一个 `IDisposable` handle
- 卸载 fiber → **LIFO 逆序**释放所有 handle

### 3.4 Provider-before-consumer 启停顺序

```
启动：provider 先激活 → consumer 再激活（能找到能力）
卸载：consumer 先卸载 → provider 再卸载（不会还有人在用）
```

### 3.5 Logical ≠ Physical unload

- **Logical unload**（必做）：停止行为、取消任务、释放 Addressables 句柄、销毁 Unity 对象、清理静态注册表
- **Physical unload**（可选）：HybridCLR 卸载 DLL，依赖 Edition 版本

**物理卸载失败不能复活逻辑已禁用的行为。**

### 3.6 Trusted cooperative client-host authority

- 一个玩家被选为 host，**host 执行权威仿真**
- 其他客户端提交操作提案
- relay 服务只搬运字节，**不验证游戏语义**
- 云存档做异步审计，**不是反作弊机制**

> 推论：这套架构**不**支持竞技排名 / 服务器经济 / 有价值交易。

---

## 4. 阅读路线图

| 顺序 | 主题 | 笔记 | 状态 |
|---|---|---|---|
| 1️⃣ | **Primitives** — 命名空间 ID、版本、诊断原语 | [02-Primitives-Deep-Dive.md](./02-Primitives-Deep-Dive.md) | ✅ 已写 |
| 2️⃣ | **Bootstrap** — VContainer scope + App/Session 生命周期 | [03-Bootstrap-Architecture.md](./03-Bootstrap-Architecture.md) | ✅ 已写 |
| 3️⃣ | **ModApi** — Mod 作者视角的契约 | [04-ModApi-Contract-Surface.md](./04-ModApi-Contract-Surface.md) | ✅ 已写 |
| 4️⃣ | **Architecture Tests** — 依赖规则如何被测试守住 | [05-Architecture-Enforcement.md](./05-Architecture-Enforcement.md) | ✅ 已写 |
| 5️⃣ | **Mod 分发流程** — 作者→构建→玩家→激活的完整链路 | [06-Mod-Distribution.md](./06-Mod-Distribution.md) | ✅ 已写 |
| 6️⃣ | **vs SMAPI** — Stardew Valley mod 平台对比 | [07-Comparison-with-SMAPI.md](./07-Comparison-with-SMAPI.md) | ✅ 已写 |
| 7️⃣ | **vs Bevy ECS** — Rust ECS 引擎对比 | [08-Comparison-with-Bevy-ECS.md](./08-Comparison-with-Bevy-ECS.md) | ✅ 已写 |
| 8️⃣ | **Context Runtime** — Fiber + 依赖解析（计划中的下一个实现） | — | 🔜 未实现 |

---

## 5. 推荐阅读顺序（先做什么后做什么）

| 阶段 | 目标 | 时间投入 |
|---|---|---|
| **第 1 阶段：基础类型** | 把 Primitives 全部读完并理解 FNV-1a、SemVer 优先级、Guid N format 这些"小但关键"的设计 | 1-2 小时 |
| **第 2 阶段：组合根** | 读 Bootstrap，看 VContainer scope 怎么分层、生命周期状态机怎么写 | 2-3 小时 |
| **第 3 阶段：公共契约** | 读 ModApi，理解 Mod 作者会接触到的接口（这部分完整但还没接入 Context） | 2-3 小时 |
| **第 4 阶段：架构守门** | 读 Architecture 测试，理解依赖规则怎么用代码强制（防止后续实现违反 spec） | 1 小时 |

---

## 6. 参考资料

- 完整 spec：`docs/superpowers/specs/2026-08-19-modular-game-harness-design.md`（1487 行）
- 实现计划：
  - `docs/superpowers/plans/2026-08-19-game-framework-scaffold.md` — 脚手架任务
  - `docs/superpowers/plans/2026-08-20-kernel-composition-roots.md` — Bootstrap
  - `docs/superpowers/plans/2026-08-20-kernel-composition-roots-corrections.md` — Bootstrap 修正
- 核心概念参考：
  - **FNV-1a hash** — 跨进程稳定的字符串哈希
  - **SemVer 2.0.0** spec 第 11 节 — precedence 比较规则
  - **VContainer** — Unity 的 DI 容器
  - **HybridCLR** — Unity 的 C# 热更新方案（运行时加载 DLL）
  - **Netcode for GameObjects (NGO)** — Unity 官方网络栈
  - **Addressables** — Unity 的资源异步加载系统

---

## 7. 我对项目的整体观感

1. **规范先行**——1487 行的 spec + 多份 plan 文档先行落地，代码按 spec 实现。这是非常成熟的工程做法（对比很多"边写边想"的项目）。
2. **测试驱动**——架构测试（强制依赖图）+ 行为测试（每个值对象都有 5-10 个边界 case），先于实现写好。
3. **Primitives 扎实**——这部分实现质量很高，FNV-1a、SemVer 优先级、Guid N format 都是教科书级别。
4. **设计留白合理**——Context/Networking/Persistence 等还是 anchor，等下一个 plan 落地后填充，避免"凭空虚构"。

**类比**：
- Primitives 像 `std::chrono` + `semver` C++ 库
- ModApi 像 Vulkan 的公共头文件（稳定、不依赖私有类型）
- Bootstrap 像 tokio runtime 的 builder