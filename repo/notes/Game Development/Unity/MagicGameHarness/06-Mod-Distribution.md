# Magic Game Harness — Mod 分发流程（作者 → 构建 → 玩家 → 激活）

> 基于 spec 第 7 节 "System Context" + 第 8 节 "Private Source and Assembly Architecture" + 第 9 节 "Runtime Scopes and VContainer"
> **注意**：Mod SDK 的具体编辑器工具、Addressables 打包、HybridCLR build pipeline 当前**还没实现**——spec 描述了应该长什么样，本篇基于 spec 推断架构。

---

## 0. 完整链路全景

```
┌─────────────────────────────────────────────────────────────┐
│ ① 作者开发（Mod SDK + Unity）                                │
└─────────────────────────────────────────────────────────────┘
        ↓ 编译出
┌─────────────────────────────────────────────────────────────┐
│ ② 构建产物（HybridCLR DLL + Addressables + Manifest）         │
└─────────────────────────────────────────────────────────────┘
        ↓ 上传到
┌─────────────────────────────────────────────────────────────┐
│ ③ Mod Distribution Service（云端）                            │
└─────────────────────────────────────────────────────────────┘
        ↓ 玩家通过
┌─────────────────────────────────────────────────────────────┐
│ ④ Mod Browser / Collection / Subscription（客户端 UI）        │
└─────────────────────────────────────────────────────────────┘
        ↓ 玩家下载
┌─────────────────────────────────────────────────────────────┐
│ ⑤ Resolver + Downloader（本地安装）                            │
└─────────────────────────────────────────────────────────────┘
        ↓ 加载时
┌─────────────────────────────────────────────────────────────┐
│ ⑥ Per-World Mod Lockfile（确定性加载清单）                      │
└─────────────────────────────────────────────────────────────┘
        ↓ 启动
┌─────────────────────────────────────────────────────────────┐
│ ⑦ Game Player（AOT Kernel + Context Runtime + HybridCLR 加载）│
└─────────────────────────────────────────────────────────────┘
        ↓ 在 Session 内
┌─────────────────────────────────────────────────────────────┐
│ ⑧ Mod Activation（Context Runtime 解析依赖 + 激活 fiber）     │
└─────────────────────────────────────────────────────────────┘
```

**整个链路**涉及 **8 个独立环节**——每个环节都有自己的 spec 约束和实现阶段。

---

## 1. 阶段 ① 作者开发（Unity + Mod SDK）

### 1.1 作者的工具

spec 第 3.1 节：

> Provide a professional Unity Mod SDK, test player, CLI, MCP adapter, AI instructions,
> reusable skills, and automated validation pipeline.

**作者用这些工具**：

| 工具 | 用途 |
|---|---|
| **Unity Editor** | 写 C#、放 Addressables 资源 |
| **Mod SDK package**（`Packages/com.mimizh.game-mod-sdk`）|） | 提供 `Game.Core.Primitives.dll` + `Game.ModApi.dll` 让作者引用 |
| **SDK 测试工具** | 在 SDK 内测 Mod 是否合法 |
| **CLI 工具** | 命令行构建/打包 |
| **MCP adapter** | AI 辅助代码生成 |
| **AI instructions** | 给 Cursor/Copilot 用的 prompt 模板 |

### 1.2 作者的项目结构

作者创建一个 **独立的 Unity 项目**——不是游戏主项目的 fork：

```
mod-project-alpha/
├── Assets/
│   ├── Scripts/
│   │   ├── AlphaModule.cs        (implements IModule)
│   │   ├── AlphaRules.cs         (提供 game.alpha-rules capability)
│   │   └── ...
│   ├── Content/                  (Addressables 资源)
│   │   ├── Prefabs/
│   │   ├── ScriptableObjects/
│   │   └── ...
│   └── Game.ModApi.asmdef        (引用 SDK 提供的 DLL)
├── Packages/
│   └── manifest.json
└── ProjectSettings/
```

**关键**：`Game.ModApi.asmdef` 让作者的代码**能引用** Mod SDK 的 dll，但**不能引用**游戏私有程序集（`Game.Core.Context`、`Game.Bootstrap` 等）。

### 1.3 SDK 里提供什么

spec 第 8.1 节描述了 SDK 必须**包含**：

```text
Packages/com.mimizh.game-mod-sdk/
├── package.json
├── Runtime/
│   ├── Plugins/
│   │   ├── Game.Core.Primitives.dll    ← Mod 引用
│   │   ├── Game.Core.Primitives.xml
│   │   ├── Game.ModApi.dll              ← Mod 引用
│   │   └── Game.ModApi.xml
│   └── Game.ModSdk.Runtime.asmdef
├── Editor/
│   ├── Game.ModSdk.Editor.asmdef
│   ├── Manifest/          ← Mod 元数据编辑器
│   ├── Validation/        ← 自动校验 Mod 合法
│   ├── HybridCLRBuild/    ← HybridCLR 编译管线
│   ├── AddressablesBuild/ ← Addressables 打包
│   ├── Packaging/         ← 最终 .modpkg 文件打包
│   ├── TestPlayer/        ← SDK 自带的"测试玩家"
│   └── Diagnostics/
├── Templates~/            ← 新 Mod 项目模板
├── Documentation~/
└── Tests/
```

**测试 `Distributed_sdk_contains_no_private_source_or_contract_binaries`** 已经在守这条规则——SDK 当前只有空 `AssemblyAnchor.cs`，等真正实现时会把上面这些组件填进来。

### 1.4 作者写代码

作者实现 `IModule`：

```csharp
using Game.ModApi.Lifecycle;
using Game.ModApi.Capabilities;
using Game.ModApi.Versioning;
using Game.Core.Primitives;
using Game.ModApi.Diagnostics;

public sealed class AlphaModule : IModule
{
    public ModuleDescriptor Descriptor { get; } = new ModuleDescriptor(
        id: ModuleId.Parse("author.alpha-rules"),
        version: ModuleVersion.Parse("1.0.0"),
        requiredCapabilities: new[]
        {
            new CapabilityRequirement(
                CapabilityKey.Parse("framework.physics-2d"),
                CapabilityVersion.Parse("1.x")),
        },
        providedCapabilities: new[]
        {
            new CapabilityProvision(
                CapabilityKey.Parse("game.alpha-rules"),
                CapabilityVersion.Parse("1.0.0")),
        });

    public async Task<ModuleOperationResult> ActivateAsync(
        IModuleContext context, CancellationToken cancellationToken)
    {
        // 注册 capability、提供方
        var rules = new AlphaRules(context.Diagnostics);
        context.RegisterCapability<IGameRules>(rules);
        return ModuleOperationResult.Success();
    }

    public async Task<ModuleOperationResult> DeactivateAsync(CancellationToken cancellationToken)
    {
        return ModuleOperationResult.Success();
    }
}
```

**关键点**：
- ❌ 作者**不能** `using Game.Core.Context`（编译期就阻止）
- ❌ 作者**不能** `using VContainer`（架构测试守门）
- ✅ 作者**只能**用 SDK 暴露的接口

---

## 2. 阶段 ② 构建产物

### 2.1 三种产物

spec 第 11 节命名空间里有 **Packaging**——Mod 最终打包成 3 类产物：

#### (a) HybridCLR DLL

```text
mod-author-alpha.dll
├── namespace Author.AlphaModule
├── class AlphaModule : IModule
├── class AlphaRules : IGameRules
└── ...
```

**HybridCLR 编译管线**（在 SDK 的 `HybridCLRBuild/` 下）：
1. **编译 mod-project** 为 .NET 程序集
2. **HybridCLR 工具链**把 .NET IL 转换为 **HybridCLR 兼容格式**（AOT 友好的元数据 + IL）
3. **签名**（可选）保证 dll 没被篡改
4. **输出** `mod-author-alpha.dll`

**这一步 HybridCLR 是怎么工作的？** 简单说：
- **传统 .NET**：运行时 JIT 编译 IL → native
- **IL2CPP（AOT）**：运行时**没有** JIT，IL2CPP 在编译时全转 native
- **HybridCLR**：保留了一个**受限的** JIT，能加载"额外"的 dll（你的 mod）但**不破坏** IL2CPP 的 AOT 假设

#### (b) Addressables 包

```text
content-author-alpha/
├── catalog.json              ← Addressables catalog
├── prefabs_assets_all.bundle
├── textures_assets_all.bundle
├── audio_assets_all.bundle
└── ...
```

**每个 mod 自己的 Addressables catalog**——spec 第 3.1 节："Support independent Addressables content packages for each module"。

#### (c) Mod Manifest

```json
{
  "manifestVersion": 1,
  "id": "author.alpha-rules",
  "version": "1.0.0",
  "dependencies": [
    {
      "id": "framework.physics-2d",
      "version": "1.x",
      "type": "capability"
    }
  ],
  "provides": [
    {
      "id": "game.alpha-rules",
      "version": "1.0.0",
      "type": "capability"
    }
  ],
  "permissions": [
    "world.modify",
    "world.read",
    "ui.overlay"
  ],
  "compatibility": {
    "gameBuild": "framework.phase1_dev-1",
    "modApi": "0.1.0",
    "networkProtocol": 1,
    "contentCompatibility": 1
  },
  "artifacts": {
    "dll": "mod-author-alpha.dll",
    "contentCatalog": "content-author-alpha/catalog.json",
    "size": 4582912,
    "sha256": "abc123..."
  }
}
```

**5 个核心字段**：
| 字段 | 用途 |
|---|---|
| `id` / `version` | ModuleId + ModuleVersion（来自 Primitives 笔记） |
| `dependencies` | required capabilities（来自 ModApi 笔记） |
| `provides` | provided capabilities |
| `permissions` | **spec 10.1 列了但当前没实现**——未来会加 |
| `compatibility` | `FrameworkCompatibility` 4 个维度（来自 Primitives 笔记） |

**`compatibility` 字段是关键**——spec 第 11.2 节"Stable Contracts"要求 Mod 声明它兼容哪个 build/Mod API/网络协议/内容版本，**否则不加载**。

### 2.2 最终打包

3 个产物打包成一个 `.modpkg` 文件（具体格式 spec 没强约束，可以是 zip）：

```text
author.alpha-rules-1.0.0.modpkg
├── manifest.json
├── mod-author-alpha.dll
└── content/
    └── catalog.json + bundles...
```

---

## 3. 阶段 ③ Mod Distribution Service（云端）

spec 第 7 节：

```text
Coordination Services
  - identity
  - session directory and host election metadata
  - byte relay
  - mod manifest and package distribution    ← 这就是 Mod Distribution Service
  - save backup and anomaly metadata
```

### 3.1 服务做什么

**Mod Distribution Service**（云端后端）：

| API | 用途 |
|---|---|
| `POST /api/v1/mods` | 作者上传 `.modpkg` |
| `GET /api/v1/mods/{id}` | 拿 manifest |
| `GET /api/v1/mods/{id}/versions` | 列出所有版本 |
| `GET /api/v1/mods/{id}/versions/{version}/download` | 下载 `.modpkg` |
| `GET /api/v1/mods/search?q=...` | 搜索 |
| `POST /api/v1/collections` | 用户创建 mod 集合（"我装这些 mod 一起玩"）|

**关键约束**（spec 5.1 节"Trusted cooperative client-host authority"）：
- ✅ 服务**验证 manifest 的 hash**（防止中间人篡改）
- ✅ 服务**验证 mod 在合规列表里**（防止恶意 mod 传播）
- ❌ 服务**不验证** mod 的玩法逻辑——因为 mod 在客户端跑，服务没法检测
- ❌ 服务**不验证** mod 不会作弊——这是 client-host 模型的固有限制

### 3.2 服务不验证 mod 玩法 — 后果

**重要**：spec 第 5.2 节明说"the AOT kernel and AOT core rules are a **correctness boundary for conforming modules**, **not a security boundary**"——也就是说：

> 一个 mod 可以拿到 host 权限后任意伪造游戏状态。
> 服务无法阻止。
> 这是**有意的设计选择**——换取"职业 mod 作者不需要源码"。

---

## 4. 阶段 ④ Mod Browser（客户端 UI）

spec 第 7 节：

```text
Ordinary Player
  -> Mod Browser / Collection / Subscription   ← 这就是这个 UI
  -> Resolver and Downloader
  -> Per-World Mod Lockfile
  -> Game Player
```

### 4.1 UI 长什么样

参考 Steam Workshop / Modrinth 的设计：

```
┌──────────────────────────────────────────────────────────┐
│ Mod Browser                                               │
├──────────────────────────────────────────────────────────┤
│ [搜索框] [分类: 玩法 / 内容 / UI / 工具] [排序: 安装量/评分] │
├──────────────────────────────────────────────────────────┤
│ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐│
│ │ Alpha Rules    │ │ Better Caves   │ │ Better Mobs   ││
│ │ 作者 author    │ │ 作者 contrib2  │ │ 作者 contrib3 ││
│ │ ★★★★☆ 1.2k   │ │ ★★★★★ 5.4k   │ │ ★★★☆☆ 800    ││
│ │ v1.0.0        │ │ v2.3.1        │ │ v0.9.0-beta   ││
│ │ [订阅]         │ │ [已订阅]       │ │ [订阅]         ││
│ └────────────────┘ └────────────────┘ └────────────────┘│
└──────────────────────────────────────────────────────────┘
```

**4 个核心功能**：
- **搜索/分类**：找感兴趣的 mod
- **订阅**：下载到本地 + 自动更新
- **评分/评论**：社区反馈
- **依赖预览**："安装这个 mod 需要先装 X、Y"

### 4.2 "集合"和"订阅"的区别

| 概念 | 含义 |
|---|---|
| **订阅** | "我下载了这个 mod"——把 `.modpkg` 存到本地 |
| **集合（Collection）** | "我装这些 mod 一起玩"——一组订阅的引用 |
| **Lockfile** | "我这次进入**这个世界**用这些 mod"——一个具体世界的加载清单 |

**订阅 ≠ 启用**：可以订阅但不进 Lockfile。Lockfile 决定**这次会话**加载什么。

---

## 5. 阶段 ⑤ Resolver + Downloader

### 5.1 Resolver 的职责

**Resolver**：拿到 Lockfile → 计算**实际要加载**的 mod 集合 + **依赖**。

例如 Lockfile 写：
```
author.alpha-rules@1.0.0
```

但 `author.alpha-rules@1.0.0` 依赖 `framework.physics-2d@1.x`，而 `framework.physics-2d` 是**框架自带的**——所以 Resolver 要：
1. 解析依赖图
2. 标记哪些是 framework-provided、哪些要下载、哪些已有
3. 输出 **resolved mod set**

### 5.2 Downloader 的职责

**Downloader**：把 Resolver 标记为 `missing` 的 mod 从 Mod Distribution Service 拉下来。

**Downloader 必须验证**：
- ✅ `manifest.json` 的 hash 和下载的字节匹配
- ✅ `manifest.json.compatibility` 与当前 `FrameworkCompatibility` 兼容
- ✅ Mod 所需的 `capability` 都存在（否则不能加载）
- ❌ 不能验证 mod 的玩法逻辑（这是 spec 的限制）

### 5.3 兼容性拒绝示例

```
当前 build: framework.phase1_dev-2
Mod:        author.alpha-rules@1.0.0
  GameBuild:   framework.phase1_dev-1     ← 不匹配！
```

**结果**：拒绝加载 + 报告 `framework.mod-incompatible` 诊断。

这就是 Primitives 笔记里 `FrameworkCompatibility` 4 个维度的实际用途——**mod 加载前的硬约束**。

---

## 6. 阶段 ⑥ Per-World Mod Lockfile

spec 第 3.1 节：

> Make module activation, deactivation, dependency replacement, and failure rollback
> explicit and testable.

> Provide deterministic package manifests, dependency resolution, per-world lockfiles,
> and reproducible mod sets.

**Lockfile 是"世界的身份证"**——每个世界可以有不同的 mod 集合。

### 6.1 Lockfile 格式（推断）

```json
{
  "lockfileVersion": 1,
  "worldId": "user-home-world-abc123",
  "resolvedMods": [
    {
      "id": "author.alpha-rules",
      "version": "1.0.0",
      "sha256": "abc123...",
      "source": "downloaded" | "cached" | "bundled"
    },
    {
      "id": "contrib.better-caves",
      "version": "2.3.1",
      "sha256": "def456...",
      "source": "downloaded"
    }
  ],
  "frozenAt": "2026-08-21T10:00:00Z"
}
```

**3 个用途**：

#### (a) **确定性加载** — 同一 Lockfile 一定加载同一组 mod

`frozenAt` 时间戳固定 + 所有版本号写死 → **可重现**。

#### (b) **跨玩家一致** — 多人联机时所有玩家加载同样的 mod

```text
玩家 A 的 Lockfile: alpha-rules@1.0.0 + better-caves@2.3.1
玩家 B 的 Lockfile: alpha-rules@1.0.0 + better-caves@2.3.1
→ 大家都加载同一组 mod
```

#### (c) **存档可重现** — 存档 + Lockfile = 完整世界

存档文件 + Lockfile = "那个世界当时的样子"——即使 mod 后来更新了，旧存档仍然能加载（用当时版本的 mod）。

### 6.2 Lockfile 的"冻结"

当世界创建时，Lockfile 被**冻结**：
- 即使玩家**订阅了新版本**的 mod，**已经存档的世界**仍然用旧版本
- 想用新版本 → 创建新世界或显式"迁移"

**这就是 spec 第 3.2 节"preserve save data when a mod is missing, disabled, upgraded, or reinstalled"的具体机制**。

---

## 7. 阶段 ⑦ Game Player 启动

spec 第 7 节 System Context：

```text
Game Player
  -> AOT Kernel                  ← 框架主体（编译进 .exe）
  -> Context Runtime             ← 加载时跑（读 Lockfile → 解析依赖 → 激活 mod）
  -> HybridCLR Module Loader     ← 用 HybridCLR 加载 mod DLL
  -> Addressables Module Content ← 加载 mod 的内容
  -> NGO Custom-Message Network Bridge
  -> Local Save Store
  -> Coordination Services
```

### 7.1 启动序列（推断）

```
1. Unity 启动 → AppLifetimeScope.prefab 实例化
2. Configure(): 注册 services + 捕获主线程
3. ApplicationLifecycleCoordinator.Start()
   → 发 framework.application.starting 诊断
4. 读 FrameworkCompatibility 配置
5. 读 World Lockfile
6. Resolver: 解析依赖图
7. Downloader: 补全缺失的 mod（已在本地则跳过）
8. Validation: 每个 mod 的 compatibility 检查
9. HybridCLR: 预加载 AOT 元数据
10. Addressables: 预加载所有 catalog
11. SessionFactory.CreateSession() → Session.StartAsync()
    → 创建 child scope
12. Context Runtime 开始按 topological order 激活 mod
13. 全部 mod 激活完 → 发 framework.application.started
14. 玩家进入游戏
```

### 7.2 HybridCLR 加载的关键点

```csharp
// 伪代码（Context Runtime 实现时）
foreach (var resolvedMod in lockfile.ResolvedMods)
{
    var dllBytes = File.ReadAllBytes(resolvedMod.DllPath);
    var sha256 = ComputeSha256(dllBytes);
    if (sha256 != resolvedMod.Sha256) throw new ModCorruptedException();
    
    // HybridCLR 加载
    var assembly = HybridCLR.RuntimeApi.LoadAssembly(dllBytes);
    
    // 找到 IModule 类型
    var moduleType = assembly.GetTypes().Single(t => typeof(IModule).IsAssignableFrom(t));
    var module = (IModule)Activator.CreateInstance(moduleType);
    
    // 排队到 Context Runtime（按依赖顺序激活）
    modulesToActivate.Add(module);
}
```

**关键约束**：
- ✅ 加载时**验证 hash**
- ✅ 加载时**强制单 IModule**（一个 dll 只能有一个 mod 入口）
- ❌ 不能**沙箱化** mod（spec 第 5.2 节明确不假装能阻止恶意 mod）

---

## 8. 阶段 ⑧ Mod Activation（Context Runtime）

### 8.1 Activation 序列

**Context Runtime 是 spec 第 10 节"Context Runtime"的实现**——这是 spec 里"计划中的下一个实现"。所以这个阶段当前**还没代码**。

**预期算法**：

```csharp
// 伪代码
var graph = BuildDependencyGraph(lockfile.ResolvedMods);  // capability → providers
var sortedMods = TopologicalSort(graph);                  // dependency before dependent

foreach (var mod in sortedMods)
{
    var allRequiredResolved = mod.Descriptor.RequiredCapabilities
        .All(req => registry.HasProvider(req.Key, req.Version));
    
    if (!allRequiredResolved)
    {
        // 跳过但不报错——optional capabilities 缺失没事
        continue;
    }
    
    var fiber = new Fiber(mod, scope);
    await fiber.ActivateAsync(context);
}
```

### 8.2 Provider-before-consumer 顺序

spec 第 6.6 节：

> A fiber may begin loading only when all required capabilities resolve.

```
Phase 1: 加载所有底层 mod（无依赖）
  → 注册它们提供的 capability

Phase 2: 加载依赖 Phase 1 的 mod
  → 它们的 required capabilities 都已 resolve
  → 激活

Phase 3: 加载依赖 Phase 2 的 mod
  → ...
```

### 8.3 Failure Rollback

spec 第 10.5 节：

> When an active provider leaves, it first stops resolving for new consumers.
> Existing consumers retain their committed provider view during teardown.
> A provider waits for committed consumers to unload before disposing its own resources.

**反向拓扑序卸载**——consumer 先停，provider 后停。

### 8.4 Session 边界

**Mod 加载绑在 Session 上**——AOT Kernel 启动时**不加载 mod**，而是创建 Session 时按 Lockfile 加载。

```
App LifetimeScope (启动 1 次)
  ├ Session LifetimeScope (创建 1 次或多次)
  │  ├ Fiber for mod-a (created in session)
  │  ├ Fiber for mod-b
  │  └ Fiber for mod-c
  └ (next session 用不同 Lockfile → 不同 mod)
```

**好处**：换世界 = 换 Session = 卸载所有 mod → 加载新 mod。**完美的隔离边界**。

---

## 9. 全链路总结图

```
作者                          Mod Distribution           玩家
  │                                │                       │
  │ ① Unity + Mod SDK 开发        │                       │
  ├──────────────────────┐         │                       │
  │                       ↓         │                       │
  │ ② HybridCLR Build + Addressables + Manifest           │
  ├──────────────────────┐         │                       │
  │                       ↓         │                       │
  │ ③ POST /api/v1/mods  ─────────→│                       │
  │                                │                       │
  │                                │ ④ Mod Browser UI      │
  │                                │←──────────────────────┤
  │                                │                       │
  │                                │ ⑤ Download .modpkg   │
  │                                │─────────────────────→│
  │                                │                       │
  │                                │        ⑥ 选择世界      │
  │                                │        (用其 Lockfile)│
  │                                │                       │
  │                                │ ⑦ Player 启动         │
  │                                │   读 Lockfile         │
  │                                │   Resolver + Downloader│
  │                                │   HybridCLR 加载      │
  │                                │   Session + Context   │
  │                                │   Runtime             │
  │                                │   按依赖顺序激活 mod  │
  │                                │                       ↓
  │                                │               ⑧ 进入游戏
```

---

## 10. 与 spec 的章节对照

| spec 章节 | 对应阶段 |
|---|---|
| 第 3.1 节 Goals | 全链路总目标 |
| 第 5 节 Trust and Authority Model | Mod Distribution Service 的限制 |
| 第 7 节 System Context | 阶段 ⑦ Game Player 组件 |
| 第 8 节 Private Source and Assembly Architecture | 阶段 ①② Mod SDK 设计 |
| 第 9 节 Runtime Scopes and VContainer | 阶段 ⑦⑧ Session scope |
| 第 10 节 Context Runtime | 阶段 ⑧ Mod Activation 算法 |
| 第 11.7 节 Packaging Contracts | 阶段 ② manifest.json |
| 第 11.10 节 Versioning | Lockfile 版本固定 |

---

## 11. 当前实现进度

| 阶段 | spec 已定义 | 代码已实现 |
|---|---|---|
| ① 作者开发 | ✅ | ✅ SDK 骨架（`AssemblyAnchor`） |
| ② 构建产物 | ✅ | ❌ HybridCLR Build pipeline 未实现 |
| ③ Mod Distribution Service | ✅ | ❌ 服务端未实现 |
| ④ Mod Browser | ✅ | ❌ UI 未实现 |
| ⑤ Resolver + Downloader | ✅ | ❌ 未实现 |
| ⑥ Lockfile | ✅ | ❌ 未实现 |
| ⑦ Game Player 启动 | ✅ | ⏳ App/Session scope 已实现，Mod 加载未实现 |
| ⑧ Mod Activation | ✅ | ❌ Context Runtime 未实现（下一个 plan）|

**已完成**：脚手架 + Primitives + ModApi + Bootstrap + 架构守门
**下一步**：Context Runtime（spec 第 10 节）——这是 Mod 激活算法的核心
**再下一步**：HybridCLR Build pipeline + Lockfile + Resolver

---

## 12. 我的整体评价

### 优点

1. **职责分离清晰**——作者工具 / 云端服务 / 客户端 / 加载器 / 运行时**互不耦合**
2. **"Mod 作者拿不到源码"** 的承诺贯穿整个链路——SDK 只暴露 public 程序集
3. **Per-World Lockfile** 给世界存档**可重现性**——mod 升级不破坏旧世界
4. **Compatibility 4 维检查** 在加载前完成——mod 加载失败前就发现不兼容
5. **HybridCLR** 允许运行时加载 mod dll——不重启游戏就能更新 mod
6. **Provider-before-consumer 顺序** 保证依赖 mod 一定先激活

### 局限与可改进点

1. **没有 mod sandbox**——恶意 mod 可以伪造游戏状态（spec 明确说这是 trade-off）
2. **没有 mod 间消息总线规范**——mod-on-mod 调用靠 capability interface，未来可能需要更显式的 pub/sub
3. **没有 mod "热替换"** ——spec 第 3.2 节说支持，但当前还没实现
4. **Mod size 没有限制**——可能有人上传 GB 级的 Addressables 包，需要加限制
5. **没有 mod 签名链**——Mod Distribution Service 验证 hash，但 mod 作者身份验证 spec 没强约束
6. **没有 "mod beta 通道" 机制**——只有"正式发布"一种状态，开发版 mod 流程没定义

### 可借鉴的设计模式

| 模式 | 适用 | 学习难度 |
|---|---|---|
| Per-World Lockfile + Frozen | 任何需要"存档 + 版本可重现"的系统 | 🟡 中等 |
| Mod Distribution Service + Manifest | 任何"插件市场"系统 | 🟡 中等 |
| HybridCLR 加载时 hash 验证 | 任何运行时加载 dll 的系统 | 🟢 简单 |
| Provider-before-consumer 拓扑序 | 任何有依赖的插件系统 | 🟡 中等 |
| SDK 只暴露 public 程序集 | 任何"插件作者"的系统 | 🟢 简单 |
| Compatibility 4 维度硬约束 | 任何有版本号的系统 | 🟡 中等 |

---

## 13. 关键 takeaway

读完整个分发流程，最大的认知收获：

> **Mod 不是"放一个 dll 进 Plugins 文件夹"那么简单**——它是一条**8 环节**的精密链路，每一环节都有自己的 spec 约束。

具体到这个项目：
- **作者工具链**（Mod SDK）保证作者只能写合法 mod
- **云端服务**（Mod Distribution）保证 mod 不被篡改
- **客户端工具**（Resolver + Downloader）保证 mod 兼容
- **加载机制**（HybridCLR + Addressables）保证 mod 能跑
- **运行时**（Context Runtime）保证 mod 正确激活

这套模式可以应用到：
- **VSCode 扩展系统**（marketplace + VSIX + manifest）
- **Sublime Package Control**（package + channel + lockfile 类似）
- **WordPress 插件市场**
- **Kubernetes Operators**（OperatorHub + OLM bundle）
- **任何"运行时第三方代码"的系统**

---

## 参考链接

- [Steam Workshop 文档](https://partner.steamgames.com/doc/features/workshop)
- [Modrinth API](https://docs.modrinth.com/)
- [HashiCorp Terraform Registry Protocol](https://developer.hashicorp.com/terraform/internals/registry-protocol)
- [Helm Chart 依赖解析](https://helm.sh/docs/chart_best_practices/dependencies/)
- [Kubernetes Operator Lifecycle Manager](https://olm.operatorhub.io/)
- [HybridCLR 文档](https://github.com/focus-creative-games/hybridclr)
- [Unity Addressables 文档](https://docs.unity3d.com/Packages/com.unity.addressables@2.0)

---

**系列续作**。这是 5 篇源码解读笔记之外的**应用层笔记**——从"代码怎么写"上升到"系统怎么运作"。后续 Context Runtime 实际落地后，可以再加一篇 `07-Context-Runtime-Deep-Dive.md` 来讲实际的算法实现。