# Magic Game Harness — Bootstrap 架构解读

> 源码位置：`Assets/GameFramework/Bootstrap/` + `Assets/GameFramework/Core/Diagnostics/`
> 实文件 14 + 7 + 测试 13 = ~3500 行
> **这是当前框架里**已经完整实现**的部分**——可以看到 spec 第 9 节"Runtime Scopes and VContainer"是怎么落地的。

---

## 0. Bootstrap 在整个框架里的位置

按 spec 第 8.3 节的依赖图：

```
Game.Core.Primitives        ← 原子层
        ↓
Game.ModApi                 ← 公共契约
        ↓
Game.Core.Context/Rules/Networking/Persistence/HotUpdate/Diagnostics
        ↓
Game.Bootstrap              ← 组合根（这一篇）
```

**Bootstrap 是所有具体实现的"汇合点"**——它依赖其他 9 个 runtime 程序集（spec 表 8.3 写的 "every core assembly"），反过来其它程序集**不**依赖它。

**责任**：
1. **VContainer 装配**——把 Primitives/ModApi/Diagnostics 等等注册成可注入服务
2. **主线程守门**——任何触碰 Unity 对象的生命周期操作必须 Unity 主线程
3. **应用 + Session 双层生命周期**——一个 App 进程可运行多个 Session（虽然 spec 允许"一个 active session"）
4. **诊断路由**——把诊断事件分发给 sinks，且生命周期锁**永远不在** sink 回调里持有

---

## 1. 文件全景与依赖图

### 1.1 Bootstrap 目录 14 个文件

```
Bootstrap/
├── ApplicationLifecycleCoordinator.cs   (247 行) ← App 级生命周期
├── AppLifetimeScope.cs                  (63 行)  ← VContainer 配置入口
├── AppLifetimeScope.prefab              (1 个 MonoBehaviour 挂载点)
├── AssemblyInfo.cs                      (4 行)  ← InternalsVisibleTo 测试程序集
├── EntryPointFailureReporter.cs         (31 行) ← VContainer entry-point 异常 → 诊断
├── FrameworkCompatibilityConfiguration.cs (19 行) ← ScriptableObject → FrameworkCompatibility
├── FrameworkIdentityProvider.cs         (10 行) ← 暴露兼容性信息
├── IFrameworkIdentityProvider.cs        (9 行)
├── ModuleDiagnosticsAdapter.cs          (59 行) ← IModuleDiagnostics 适配器
│
├── Session/
│   ├── ISession.cs                      (15 行) ← IAsyncDisposable + Start/Stop
│   ├── ISessionFactory.cs               (9 行)
│   ├── Session.cs                       (420 行) ← Session 实现（核心）
│   ├── SessionFactory.cs                (89 行) ← Session 工厂 + latch
│   ├── SessionLifetime.cs               (46 行) ← 不可变 Session 视图
│   ├── SessionState.cs                  (12 行) ← 状态枚举
│   └── VContainerSessionScopeFactory.cs (73 行) ← 实际 VContainer 集成
│
└── Threading/
    └── UnityMainThreadGuard.cs          (77 行) ← 主线程守门（核心）
```

### 1.2 相关依赖：Core/Diagnostics 7 个文件

```
Core/Diagnostics/
├── DiagnosticRouter.cs             ← 路由到多个 sink，捕获 sink 异常
├── DiagnosticEventFactory.cs       ← 把 10 个字段打包成 DiagnosticEvent
├── FrameworkDiagnosticEvents.cs    ← 10 个标准事件名常量
├── IDiagnosticSink.cs              ← sink 接口
├── InMemoryDiagnosticSink.cs       ← 测试用 sink
├── UnityConsoleDiagnosticSink.cs   ← 把事件写到 Unity 控制台
└── (1 个 README)
```

### 1.3 关键类型关系

```
AppLifetimeScope (Unity MonoBehaviour)
    │ VContainer Configure
    ↓
registers: IUnityMainThreadGuard, SessionFactory, DiagnosticRouter, ...
    │
    ↓
ApplicationLifecycleCoordinator (VContainer EntryPoint)
    │ owns
    ↓
SessionFactory
    │ creates
    ↓
Session
    │ owns
    ↓
VContainerSessionScope (child VContainer scope)
    │
    ↓
SessionLifetime (immutable view, exposed to services)
```

**3 个生命周期所有者**：`ApplicationLifecycleCoordinator` → `SessionFactory` → `Session`。**每一层都校验主线程、状态机、清理顺序**。

---

## 2. AppLifetimeScope — 装配入口

**文件**：`AppLifetimeScope.cs`（63 行）

### 2.1 配置时机

```csharp
public sealed class AppLifetimeScope : LifetimeScope
{
    [SerializeField] FrameworkCompatibilityConfiguration compatibilityConfiguration;

    protected override void Configure(IContainerBuilder builder)
    {
        var mainThreadGuard = UnityMainThreadGuard.CaptureCurrentThread();
        // ... 验证 compatibility、注册服务
    }
}
```

**`AppLifetimeScope` 是 `VContainer.Unity.LifetimeScope` 子类**——通过 Unity 的 prefab 机制（`AppLifetimeScope.prefab`）挂在 SampleScene 上。VContainer 触发 `Configure` 方法时**就在 Unity 主线程**——这正是为什么 **mainThreadGuard 的捕获点选在这里**：

```csharp
// 来自 UnityMainThreadGuard 的注释：
// "its identity is captured inside AppLifetimeScope.Configure,
//  which VContainer runs during composition on the Unity main thread;
//  it is never guessed from a static initializer, which would latch
//  whichever thread first touched the type"
```

**为什么不用静态初始化？**

```csharp
// ❌ 错误做法：static init 捕获
public static readonly UnityMainThreadGuard Instance =
    new UnityMainThreadGuard(Thread.CurrentThread.ManagedThreadId);
//    ↑ 第一次访问这个类型的线程就是"主线程"——但这是错的
//       如果 test runner 的某个 background task 先 touch，guard 就废了
```

**✅ 正确做法**：在已知的主线程（VContainer.Configure / Unity 主循环）显式 `CaptureCurrentThread()`，且**每个 App root 都拿到一个新实例**（避免 Domain Reload 禁用时的脏状态）。

### 2.2 注册的服务

```csharp
var consoleSink = new UnityConsoleDiagnosticSink();
var router = new DiagnosticRouter(new[] { consoleSink });
var eventFactory = new DiagnosticEventFactory();
compatibility = compatibilityConfiguration.ToRuntime();

var identity = new FrameworkIdentityProvider(compatibility);
var failureReporter = new EntryPointFailureReporter(router, eventFactory);

builder.RegisterInstance<IUnityMainThreadGuard>(mainThreadGuard);
builder.RegisterInstance(compatibility);
builder.RegisterInstance(router);
builder.RegisterInstance(eventFactory);
builder.RegisterInstance<IFrameworkIdentityProvider>(identity);
builder.Register<ModuleDiagnosticsAdapterFactory>(Lifetime.Singleton);
builder.Register<VContainerSessionScopeFactory>(Lifetime.Singleton).As<ISessionScopeFactory>();
builder.Register<SessionFactory>(Lifetime.Singleton).AsSelf().As<ISessionFactory>();
builder.RegisterInstance(failureReporter);
builder.RegisterEntryPointExceptionHandler(failureReporter.Report);
builder.RegisterEntryPoint<ApplicationLifecycleCoordinator>();
```

**9 个注册**，全部用 `Singleton` 生命周期：

| 注册 | 类型 | 用途 |
|---|---|---|
| `IUnityMainThreadGuard` | 单例 | 主线程守门 |
| `FrameworkCompatibility` | 实例 | 当前 build 兼容性元数据 |
| `DiagnosticRouter` | 实例 | 路由诊断事件 |
| `DiagnosticEventFactory` | 实例 | 构造诊断事件 |
| `IFrameworkIdentityProvider` | 单例 | 暴露兼容性 |
| `ModuleDiagnosticsAdapterFactory` | 单例 | Mod 诊断适配器工厂 |
| `ISessionScopeFactory` | 单例 | VContainer 子 scope 创建 |
| `SessionFactory` | 单例 | Session 工厂 |
| `EntryPointFailureReporter` | 实例 | VContainer entry-point 异常捕获 |

**关键设计**：所有服务都是 `Singleton`——App 进程范围内只有一个，**通过 child scope 隔离 Session 状态**。

### 2.3 注册顺序的隐性约束

```csharp
builder.RegisterEntryPointExceptionHandler(failureReporter.Report);
builder.RegisterEntryPoint<ApplicationLifecycleCoordinator>();
```

**`RegisterEntryPointExceptionHandler` 必须在 `RegisterEntryPoint` 之前**——否则 entry-point 抛出的异常**不会被 reporter 捕获**。

这就是为什么 `AppLifetimeScope.Configure` 是一个**手写顺序敏感的方法**——没有反射、没有约定。

### 2.4 兼容性验证

```csharp
FrameworkCompatibility compatibility;
try
{
    if (compatibilityConfiguration == null)
        throw new System.InvalidOperationException("AppLifetimeScope requires a compatibility configuration asset.");
    compatibility = compatibilityConfiguration.ToRuntime();
}
catch (System.Exception exception)
{
    router.Emit(eventFactory.Create(
        DiagnosticSeverity.Critical,
        FrameworkDiagnosticEvents.ApplicationStartFailed,
        CorrelationId.New(),
        lifecycleEpisodeId: LifecycleEpisodeId.New(),
        error: new DiagnosticError(
            "framework.configuration-invalid",
            ...)));
    throw;  // ← 关键：抛回去，让 VContainer 也报告失败
}
```

**两层失败处理**：
1. 自己的诊断（`Critical` + `ApplicationStartFailed`）
2. 重新抛出（让 VContainer 把整个装配标记为失败 → 启动 Unity 错误面板）

**`throw` 而非 swallow**：spec 第 1 节说 "build a stable, versioned platform"——配置错误必须让开发者**当时**看到，而不是 silent fallback 到"默认版本"。

---

## 3. UnityMainThreadGuard — 守门核心

**文件**：`UnityMainThreadGuard.cs`（77 行）

### 3.1 接口设计

```csharp
internal interface IUnityMainThreadGuard
{
    bool IsMainThread { get; }
    void ThrowIfNotMainThread(string operation);
    InvalidOperationException CreateViolation(string operation);  // 不抛，只构造
}
```

**两个不同的拒绝方式**：

| 方法 | 何时用 |
|---|---|
| `ThrowIfNotMainThread` | 同步方法（如 `SessionFactory.CreateSession`） |
| `CreateViolation` | `Task`-返回方法——构造异常返回 faulted Task，**而不是抛出同步异常** |

**为什么 `Task`-返回方法不直接抛？** 因为调用者往往 `await`，sync throw 在 `Task.FromException` 之前的栈上会让 awaiter 看到 **异常路径与 lifecycle 失败路径不同**。统一为 faulted Task 让 rejection 与 lifecycle 失败**走同一条诊断渠道**——"caller that only awaits" 也不会错过。

### 3.2 三个关键注释

```csharp
/// Internal to Game.Bootstrap. It is never exposed through Game.ModApi or the
/// distributed Mod SDK, and it deliberately does not live in Game.Core.Primitives:
/// it exists only because this assembly creates and disposes Unity and VContainer objects.
```

**为什么不在 Primitives 里？** 因为 Primitives 是**纯 C#**（不依赖 Unity）——Unity 线程模型是 Unity-specific 的。把它放进 Primitives 会让契约污染。

```csharp
/// The main thread identity is captured during App composition — AppLifetimeScope runs
/// Configure on the Unity main thread — and never guessed from a static initializer,
/// which could latch whichever thread happened to touch the type first.
```

**避免静态初始化"第一个 touch 决定"**——Unity test runner 可能让 background thread 先 touch type。

```csharp
/// Each App root receives a fresh instance, so the policy stays correct when Domain Reload
/// is disabled.
```

**Domain Reload 关闭时**——static 字段会跨测试/会话保持。**每次都 new 一个 guard** 强制重置。

### 3.3 拒绝消息的内容

```csharp
return new InvalidOperationException(
    $"{operation} must be initiated on the Unity main thread. Application and Session " +
    "lifecycle mutation creates and disposes Unity and VContainer objects, so it is " +
    "main-thread-only and is never dispatched through Task.Run or a thread-pool continuation.");
```

**消息含 3 部分**：
1. **哪个操作被拒绝**（如 `SessionFactory.CreateSession`）—— 让调用者知道"我做了哪个调用错了"
2. **为什么**（`creates and disposes Unity and VContainer objects`）
3. **不能用什么绕过**（`Task.Run or thread-pool continuation`）

这是教科书级别的错误消息——**包含 self-explaining context**，让你 grep 一行就找到规则来源。

---

## 4. Session — 状态机 + 锁 + 副作用归属

**文件**：`Session.cs`（420 行，最复杂的文件）

### 4.1 状态机

```csharp
public enum SessionState
{
    Created = 0,
    Starting = 1,
    Running = 2,
    Stopping = 3,
    Stopped = 4,
    Failed = 5,
}
```

```
                  StartAsync
        Created ──────────────→ Starting ────────→ Running
            │                   (建立 scope)        │
            │ StopAsync        │                  StopAsync
            ├─────────────────→ ┤ Stopping ←────── ┤
            │                  ↓                   │
            │                 [清理]               │
            ↓                  ↓                   ↓
          Failed (各种失败路径)               Stopped
```

**关键约束**：
- `Starting → Running` 之前必须建立 scope
- `Stopping` 之后 `state == Starting` 再次判定为 false（`adopted = state == SessionState.Starting`）
- `Stopped` / `Failed` 是终态，不可重启

### 4.2 锁持有时间

```csharp
public Task StopAsync(CancellationToken cancellationToken)
{
    if (!mainThread.IsMainThread)                              // ← 不在锁里
        return Task.FromException(...);

    TaskCompletionSource<bool> completion;
    lock (sync)                                                // ← 锁内只做状态变更 + memoization
    {
        if (stopTask != null) return stopTask;
        if (state == SessionState.Failed || state == SessionState.Stopped)
        {
            isDisposed = true;
            return stopTask = Task.CompletedTask;
        }
        state = SessionState.Stopping;
        completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        stopTask = completion.Task;
    }

    RunStop(completion);                                       // ← 锁外做 cancel + dispose + release
    return stopTask;
}
```

**锁内**做 3 件事：
1. 判 idempotency（返回 memoized stopTask）
2. 检查终态
3. 设置 Stopping + memoize TaskCompletionSource

**锁外**做 4 件事（`RunStop`）：
1. `lifetimeCancellation.Cancel()` — 通知 owned work
2. `scope.Dispose()` — 销毁 VContainer child scope
3. `release(this)` — SessionFactory 释放引用
4. 发诊断

**为什么这样分？** 因为 `scope.Dispose()` 会销毁 Unity 对象，**可能执行 Unity 回调**，如果回调 reentrant 调用 Session API，**不能**死锁。

### 4.3 重复 stop 的幂等性

```csharp
const int callers = 16;
var results = new Task[callers];
for (var index = 0; index < callers; index++)
    results[index] = session.StopAsync(CancellationToken.None);
await Task.WhenAll(results);

Assert.That(results.Distinct().Count(), Is.EqualTo(1), "Every caller must observe the same operation.");
```

**16 个 StopAsync 调用共享同一个 Task 对象**。这是经典的 **memoization 模式**：

```csharp
lock (sync)
{
    if (stopTask != null) return stopTask;  // ← 第二个 caller 拿到第一个的 Task
    // ...
    stopTask = completion.Task;             // ← 第一个 caller memoize
}
```

**为什么这样？** 16 个 caller 等同一个 Task，**scope 只 dispose 一次**（测试断言 `DisposeCount == 1`），**诊断事件只发一次**。

### 4.4 StartAsync 的 "superseded start" 处理

```csharp
public Task StartAsync(CancellationToken cancellationToken)
{
    // ...
    lock (sync)
    {
        if (isDisposed) return Task.FromException(new ObjectDisposedException(nameof(Session)));
        if (state != SessionState.Created)
            return Task.FromException(new InvalidOperationException(...));
        state = SessionState.Starting;
    }

    Emit(SessionStarting);
    try
    {
        cancellationToken.ThrowIfCancellationRequested();
        var created = scopeFactory.Create(lifetime);

        // ★ 关键：scope 已建好，但还需要 re-check state
        bool adopted;
        lock (sync)
        {
            adopted = state == SessionState.Starting;
            if (adopted) scope = created;
        }

        if (!adopted)
        {
            DisposeSupersededScope(created);        // ← 有人在我们建 scope 时 stop 了
            return Task.FromCanceled(new CancellationToken(true));
        }
        // ...
    }
}
```

**为什么要在 `scopeFactory.Create` 之后再 re-check state？**

考虑竞态：
1. 主线程 A 调用 `StartAsync()` → 进入 `state = Starting`
2. scopeFactory.OnCreating 回调里（A 线程内 reentrant）调用 `StopAsync()` → `state = Stopping`，memoize stopTask
3. A 继续：scopeFactory.Create 返回了 scope
4. **如果直接 `scope = created`**，会持有 scope 不放；但 `Stopping` 已经发生 → 资源泄漏
5. **re-check `state == Starting`**，发现已经是 Stopping → dispose 这个 orphan scope

**测试 `Stop_requested_while_starting_reaches_one_terminal_state_without_leaking_a_scope`** 断言了这一点。

### 4.5 FailStart — "原失败 + 清理失败" 双错误模型

```csharp
void FailStart(Exception primary)
{
    Exception cleanupFailure = null;
    try
    {
        try { lifetimeCancellation.Cancel(); }
        catch (Exception exception) { cleanupFailure = exception; }

        ISessionScope ownedScope;
        lock (sync)
        {
            ownedScope = scope;
            scope = null;
        }

        try { ownedScope?.Dispose(); }
        catch (Exception exception) { cleanupFailure = cleanupFailure ?? exception; }

        try { release(this); }
        catch (Exception exception) { cleanupFailure = cleanupFailure ?? exception; }
    }
    finally
    {
        lock (sync)
        {
            state = SessionState.Failed;
            isDisposed = true;
            if (stopTask == null) stopTask = Task.CompletedTask;
        }
        DisposeCancellationOnce();
    }

    Emit(Severity.Error, SessionFailed, BuildError("framework.session-start-failed", primary, cleanupFailure));
}
```

**两个原则**：

#### (a) cleanup 失败**永远不能替换原失败**

```csharp
catch (Exception exception)
{
    cleanupFailure = cleanupFailure ?? exception;  // ← 用 ?? 而不是 =
}
```

如果 `lifetimeCancellation.Cancel()` 已经失败了（`cleanupFailure != null`），后续的 cleanup exception **不覆盖**——只追加。

#### (b) finally 保证状态变更

```csharp
finally
{
    lock (sync)
    {
        state = SessionState.Failed;        // ← 无论 throw 没 throw 都跑
        isDisposed = true;
        if (stopTask == null) stopTask = Task.CompletedTask;
    }
    DisposeCancellationOnce();
}
```

**即使 cleanup 全炸了**，Session 状态仍然 `Failed`，`stopTask` 仍然 memoized——调用者 `await session.StartAsync(...)` 不会卡住。

### 4.6 BuildError 的智能消息

```csharp
static DiagnosticError BuildError(string code, Exception primary, Exception cleanupFailure)
{
    var message = Describe(primary);
    if (cleanupFailure != null)
        message = $"{message} (cleanup also failed: {cleanupFailure.GetType().FullName}: {Describe(cleanupFailure)})";
    return new DiagnosticError(code, message, primary.GetType().FullName);
}

static string Describe(Exception exception) =>
    string.IsNullOrWhiteSpace(exception.Message) ? exception.GetType().Name : exception.Message;
```

**消息示例**：
- 单失败：`"Module 'auth.mod-x' failed to load: file not found"`
- 双失败：`"Module 'auth.mod-x' failed to load: file not found (cleanup also failed: System.ObjectDisposedException: Cannot access a disposed object. Object name: 'XContainer'.")`

**为什么 `Describe` 用 fallback？** 因为有些异常（如某些 NRE）的 `Message` 是空串，直接打印会显示"原始类型名 + 冒号 + 空串"很难看。

### 4.7 DisposeCancellationOnce

```csharp
void DisposeCancellationOnce()
{
    lock (sync)
    {
        if (cancellationDisposed) return;
        cancellationDisposed = true;
    }
    lifetimeCancellation.Dispose();
}
```

**为什么"once"？** 因为 `FailStart` 和 `RunStop` 都会调它。多次 dispose `CancellationTokenSource` 会抛 `ObjectDisposedException` 的奇怪变种——**用 latch 保证 dispose 恰好一次**。

---

## 5. SessionFactory — 单 Session + 主线程守门

**文件**：`SessionFactory.cs`（89 行）

### 5.1 "exactly one active session" 模型

```csharp
public ISession CreateSession()
{
    mainThread.ThrowIfNotMainThread(...);
    lock (sync)
    {
        if (creationPrevented)
            throw new InvalidOperationException("The application is shutting down; no new Session may be created.");
        if (activeSession != null)
            throw new InvalidOperationException("Only one Session may be active at a time.");
        activeSession = new Session(...);
        return activeSession;
    }
}
```

**两个 latch**：
1. `creationPrevented` — App 关闭后不能再 create
2. `activeSession != null` — 一次只有一个 active

**为什么不允许多个并发 Session？** spec 没明确禁止，但 Bootstrap README 写的是 "permits one active Session"——简化清理语义：**一个 App root 一条清理链**。

### 5.2 Latch 的不可逆

```csharp
internal void PreventNewSessions()
{
    mainThread.ThrowIfNotMainThread(...);
    lock (sync) creationPrevented = true;
}
```

**没有 un-latch**——`creationPrevented` 一旦置 true 就永远是 true。这是**单稳态触发器**模式：永远向前。

**为什么这样设计？** App 关闭时调用 `PreventNewSessions()` → 等现有 Session 清理完 → 进程退出。**绝不会"再打开 create 通道"**——避免 race。

### 5.3 Release 回调

```csharp
public ISession CreateSession()
{
    // ...
    activeSession = new Session(..., Release);
    // ...
}

void Release(Session session)
{
    lock (sync)
    {
        if (ReferenceEquals(activeSession, session)) activeSession = null;
    }
}
```

**Release 是 Session.Stop 时调用的回调**——让 factory 清空引用。

**`ReferenceEquals(activeSession, session)`** 而不是 `==`——避免 `==` 操作符被重载带来的奇怪行为（struct/class 区分），且**确保是同一个引用**而不是重载的相等。

---

## 6. SessionLifetime — 不可变视图

**文件**：`SessionLifetime.cs`（46 行）

### 6.1 "不是 service locator"

```csharp
internal interface ISessionLifetime
{
    SessionId SessionId { get; }
    CancellationToken Token { get; }
}

sealed class SessionLifetime : ISessionLifetime
{
    internal SessionLifetime(SessionId sessionId, CancellationToken token)
    {
        if (!sessionId.IsValid) throw new ArgumentException(...);
        SessionId = sessionId;
        Token = token;
    }

    public SessionId SessionId { get; }
    public CancellationToken Token { get; }
}
```

**只有 2 个属性**——`SessionId` 和 `Token`。

**故意没暴露**：
- ❌ Session 实例本身（会导致循环引用 + service locator 反模式）
- ❌ DiagnosticRouter（跨层耦合）
- ❌ SessionFactory（不安全）

### 6.2 Token 是一次性 snapshot

```csharp
internal SessionLifetime(SessionId sessionId, CancellationToken token)
{
    // ...
    Token = token;
}
```

**`CancellationToken` 是 struct，capture by value**——`Token` 持有的是 source 的引用。`source.Cancel()` 之后，`Token.IsCancellationRequested` 立即返回 true（即使 source 已被 dispose）。

**为什么 capture 一次？** 因为 source 会被 dispose（`DisposeCancellationOnce`），但 token 仍要可观察——所以"在 source 还活着时"capture token，之后即使 source dispose，token 仍可读。

### 6.3 注册到 child scope

```csharp
public ISessionScope Create(ISessionLifetime lifetime)
{
    // ...
    var child = appScope.CreateChild(
        builder =>
        {
            builder.RegisterInstance(sessionId);
            builder.RegisterInstance<ISessionLifetime>(lifetime);
        },
        $"Session {sessionId}");
    return new VContainerSessionScope(child, mainThread);
}
```

**`sessionId` 和 `lifetime` 都注册到 child scope**——所以 Session-owned services 可以：
```csharp
public class MyService
{
    public MyService(SessionId sessionId, ISessionLifetime lifetime)
    {
        _sessionId = sessionId;
        _token = lifetime.Token;  // 用来观察 Session 是否要停了
    }
}
```

---

## 7. VContainerSessionScopeFactory — 真正建 scope

**文件**：`VContainerSessionScopeFactory.cs`（73 行）

### 7.1 三层守门

```csharp
public ISessionScope Create(ISessionLifetime lifetime)
{
    mainThread.ThrowIfNotMainThread(nameof(VContainerSessionScopeFactory) + "." + nameof(Create));
    // ...
    var child = appScope.CreateChild(...);
    return new VContainerSessionScope(child, mainThread);
}

sealed class VContainerSessionScope : ISessionScope
{
    public void Dispose()
    {
        mainThread.ThrowIfNotMainThread("Session child scope disposal");
        // ...
    }
}
```

**为什么 factory 里也守门？** README 解释：

> Defense in depth: the Session already rejects off-main lifecycle calls, but this is the
> last point before real Unity and VContainer objects are touched, so it re-checks.

**纵深防御**——即使有人绕过 `Session` 直接调 `ISessionScopeFactory.Create`（不应该发生），仍然会被 guard 拒掉。

### 7.2 Scope 包装的额外价值

```csharp
sealed class VContainerSessionScope : ISessionScope
{
    public bool IsDisposed => scope == null;

    public void Dispose()
    {
        mainThread.ThrowIfNotMainThread("Session child scope disposal");
        var owned = scope;
        scope = null;
        owned?.Dispose();
    }
}
```

**额外提供的**：
- `IsDisposed` 属性（VContainer `LifetimeScope` 没有原生暴露）
- **idempotent dispose**（scope = null 之后再调 Dispose 是 no-op）
- **clear reference before disposing**——避免 disposed scope 的引用泄漏

**最后一点关键**：`scope = null; owned?.Dispose();` 是**两步走**——先把字段清掉，再 dispose owned 引用。这样如果 dispose 抛了异常重入 scope，**看到的是 null 而不是 disposed 对象**。

---

## 8. ApplicationLifecycleCoordinator — 应用级

**文件**：`ApplicationLifecycleCoordinator.cs`（247 行）

### 8.1 双重身份

```csharp
public sealed class ApplicationLifecycleCoordinator : IStartable, IDisposable
```

- `IStartable`（VContainer 接口）— VContainer 启动时调 `Start()`
- `IDisposable` — VContainer 关闭时调 `Dispose()`（如果 root 没显式 shutdown）

**注意**：`IStartable.Start()` 是同步方法——VContainer 期望它**立即完成**。所以 `ApplicationLifecycleCoordinator.Start()` 本身**不**做重活，只是发两个诊断事件 + 设 `started = true`。

### 8.2 ShutdownAsync 的"原子"行为

```csharp
public Task ShutdownAsync(CancellationToken cancellationToken)
{
    if (!mainThread.IsMainThread)
        return Task.FromException(...);

    TaskCompletionSource<bool> completion;
    lock (sync)
    {
        if (shutdownTask != null) return shutdownTask;        // ← 幂等
        completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        shutdownTask = completion.Task;
    }

    RunShutdown(completion);
    return shutdownTask;
}
```

**同 Session.StopAsync 一致的模式**：
- **idempotent**（多次调用返回同一个 Task）
- **`TaskCreationOptions.RunContinuationsAsynchronously`**——continuation 不会 inline 在 completion thread，避免 stack dive

### 8.3 Shutdown 序列

```csharp
void RunShutdown(TaskCompletionSource<bool> completion)
{
    Emit(ApplicationStopping);

    SessionFactory factory;
    lock (sync) factory = sessionFactory;       // ← 锁外 snapshot 引用

    ISession active = null;
    try
    {
        if (factory != null)
        {
            factory.PreventNewSessions();        // ① 锁新 Session
            active = factory.ActiveSession;      // ② 取现有 Session
        }
    }
    catch (Exception exception)
    {
        CompleteShutdown(completion, exception);
        return;
    }

    if (active == null)
    {
        CompleteShutdown(completion, null);
        return;
    }

    Task stop;
    try
    {
        stop = active.StopAsync(CancellationToken.None);   // ③ 停止 Session
    }
    catch (Exception exception)
    {
        CompleteShutdown(completion, exception);
        return;
    }

    if (stop.IsCompleted)                                       // ④ sync 完成
    {
        CompleteShutdown(completion, Failure(stop));
        return;
    }

    stop.ContinueWith(                                          // ⑤ async 完成
        completed => CompleteShutdown(completion, Failure(completed)),
        CancellationToken.None,
        TaskContinuationOptions.ExecuteSynchronously,
        TaskScheduler.Default);                                 // ← 显式线程池！
}
```

**5 个步骤 + 4 个错误路径**，每一步都有 try/catch + CompleteShutdown 兜底。

**最后的 `TaskScheduler.Default`** 是关键：

> A future Session with genuinely asynchronous cleanup: never block the caller, and never
> resume Unity or VContainer work off the main thread. The continuation only emits
> diagnostics and releases references.

**为什么显式 `TaskScheduler.Default`？** 默认情况下，await continuation 会在调用者的 synchronization context 上跑——但 `StopAsync` 的调用者在主线程。**ShutdownAsync 立即返回（不 await）**，所以 continuation 在主线程跑没问题，但 README **主动要求**只用 `TaskScheduler.Default`：

- 避免主线程被 continuation 阻塞
- **继续 confirmation**：continuation 只发诊断 + 释放引用，不触碰 Unity 对象

### 8.4 Dispose() 的"不全阻塞"原则

```csharp
public void Dispose()
{
    mainThread.ThrowIfNotMainThread(...);

    Task pending;
    lock (sync) pending = shutdownTask;
    pending = pending ?? ShutdownAsync(CancellationToken.None);    // ← 触发 shutdown 如果还没

    if (pending.IsCompleted)
    {
        if (pending.IsFaulted) _ = pending.Exception;             // ← observe 故障
        return;
    }

    Emit(Warning, ApplicationStopped,
        new DiagnosticError("framework.application-shutdown-incomplete",
            "The application root was disposed before asynchronous Session shutdown completed; call ShutdownAsync and await it before disposing the root."));
}
```

**关键**：**绝不 `.Wait()` 或 `.Result`**！理由：

> VContainer disposal is synchronous and does not await arbitrary IAsyncDisposable, so this
> method never blocks on a task whose continuation would need the Unity PlayerLoop: it starts
> shutdown if it has not run, and if the operation has not already completed it records that
> fact as a Warning diagnostic and returns.

**为什么？** 因为：

1. VContainer `Dispose()` 是同步的——它要立刻清理容器
2. 但如果 Session 清理是 async 的（要等某个 await），等就意味着**阻塞主线程**
3. 阻塞主线程 = PlayerLoop 卡住 = 渲染/输入/物理全部冻结

**正确的失败模式**是发 Warning，**让开发者从日志发现问题**——而不是让程序"看起来工作"实际挂了。

### 8.5 Observe Fault 的细节

```csharp
if (pending.IsFaulted) _ = pending.Exception;
```

`_ = pending.Exception` —— **读取 Exception 属性会"observe"异常**，防止其变成"unobserved task exception"飘到进程层（Unity 会 LogError 污染日志，但更重要的是 TaskScheduler 可能 unobserved exception 触发 `TaskScheduler.UnobservedTaskException`）。

**这是 .NET Task 的一个隐藏陷阱**——faulted Task 不读取 `.Exception`，CLR 会在 finalize 时尝试触发 unobserved exception event。

---

## 9. 诊断路由 — sink 异常隔离

**文件**：`DiagnosticRouter.cs`（45 行）

```csharp
public void Emit(DiagnosticEvent diagnosticEvent)
{
    foreach (var sink in sinks)
    {
        try
        {
            sink.Write(diagnosticEvent);
        }
        catch (Exception exception)
        {
            try
            {
                sinkFailureHandler(exception);
            }
            catch (Exception handlerException)
            {
                UnityEngine.Debug.LogException(handlerException);
            }
        }
    }
}
```

**3 层 try/catch**：

1. **sink 抛异常** → 调 `sinkFailureHandler`（默认 `Debug.LogException`）
2. **handler 自己抛异常** → `Debug.LogException`（最坏兜底）
3. **永远不会让一个坏 sink 把整个 Emit 弄崩**

**为什么？** 诊断是"侧通道"——**绝不能因为 sink 坏了让应用代码走不下去**。

**`sinkFailureHandler` 默认值**：

```csharp
this.sinkFailureHandler = sinkFailureHandler ?? UnityEngine.Debug.LogException;
```

默认就是 Unity 的 LogException——简单但足够。

---

## 10. SessionStateMachineTests — 状态机约束

**文件**：`SessionStateMachineTests.cs`（239 行）

**覆盖的关键不变量**：

| 测试 | 断言 |
|---|---|
| `New_session_is_in_Created_state` | 构造后 `state == Created` |
| `Start_transitions_to_Running_and_registers_scope` | StartAsync 完 → Running + scope 持有 |
| `Stop_transitions_to_Stopped_and_disposes_scope` | StopAsync 完 → Stopped + scope disposed |
| `Failed_start_emits_start_failed_event` | 启动失败 → Critical event + `state == Failed` |
| `Cancel_during_start_transitions_to_Stopped` | 启动时被 cancel → `state == Stopped`，不是 Failed |
| `Restart_after_stop_is_rejected` | `state == Stopped` 后再 Start → `ObjectDisposedException` |
| `State_is_immutable_after_terminal_transition` | 终态后 State 不再变 |

**最微妙的一个**：Cancel during start → `Stopped` 不是 `Failed`。

```csharp
var tokenSource = new CancellationTokenSource();
harness.ScopeFactory.OnCreating = _ => tokenSource.Cancel();
var start = session.StartAsync(tokenSource.Token);
```

**为什么 cancel 不算 Failed？** 因为 cancel 是**用户的正常操作**（"算了不启动了"）——不是"启动出错了"。区分 Failed 和 Canceled 让诊断信号清晰。

---

## 11. SessionCleanupFailureTests — 清理失败的语义

**文件**：`SessionCleanupFailureTests.cs`（145 行）

**核心断言**：

| 场景 | 原失败 | cleanup 失败 | 期望行为 |
|---|---|---|---|
| Normal start, normal stop | 无 | 无 | `Stopped` |
| Failed start | `InvalidOperationException` | `scope.Dispose throws` | `Failed`，**原异常**传播，cleanup 异常**附在 message 里** |
| Failed start, 但 release() 也炸 | `InvalidOperationException` | `scope.Dispose + release throws` | `Failed`，**只第一个 cleanup 异常**追加 |
| Normal stop, cleanup throws | 无 | `scope.Dispose throws` | `Failed`，`framework.session-cleanup-failed`，`await StopAsync` throws |

**关键测试**：

```csharp
[Test]
public async Task Cleanup_failure_during_normal_stop_keeps_original_completion_and_reports_failure()
{
    var harness = new SessionTestHarness();
    harness.ScopeFactory.OnDispose = _ => throw new InvalidOperationException("cleanup boom");
    var session = harness.Factory.CreateSession();
    await session.StartAsync(CancellationToken.None);

    var stop = session.StopAsync(CancellationToken.None);

    Assert.That(() => stop, Throws.InstanceOf<InvalidOperationException>().With.Message.Contains("cleanup boom"));
    Assert.That(session.State, Is.EqualTo(SessionState.Failed));
}
```

**`await StopAsync` throws 符合预期**——但 Task 是 faulted，调用者可以选择 `await` 或 `ContinueWith`。两种姿势都得到一致的"cleanup failed"信息。

---

## 12. LifecycleMainThreadTests — 守门测试

**文件**：`LifecycleMainThreadTests.cs`（301 行）

**测试模式**：

```csharp
static T OnWorkerThread<T>(Func<T> function)
{
    var result = default(T);
    var failure = OnWorkerThread(() => { result = function(); });
    Assert.That(failure, Is.Null, "This lifecycle method must fault its operation rather than throw synchronously.");
    return result;
}
```

**关键**：Task-returning 方法**应该 fault 而不是 throw**——所以 worker 线程上调用时，`OnWorkerThread` 期望 `failure == null`（worker 自己没抛），然后 `result` 是 faulted Task。

### 12.1 8 个守门测试覆盖

| 测试 | 验证 |
|---|---|
| `Guard_recognizes_only_the_thread_it_captured` | guard 只认识 capture 时的线程 |
| `Off_main_CreateSession_is_rejected_and_creates_no_session_or_id` | 拒绝 → 无 Session、无 ID、factory 不 latch、diagnostic 不发 |
| `Off_main_StartAsync_is_rejected_without_creating_a_scope_or_mutating_state` | 拒绝 → state 不变、scope 不建、token 不 cancel、factory 不释放 |
| `Off_main_StopAsync_is_rejected_and_leaves_the_running_session_intact` | 拒绝 → Running session 完好、token 不 cancel、scope 不 dispose |
| `Off_main_DisposeAsync_is_rejected_and_memoizes_no_terminal_operation` | 拒绝 → memoize 不发生、IsDisposed 不变 |
| `Off_main_application_Start_is_rejected_before_any_state_or_diagnostic_change` | 拒绝 → IsStarted 不变 |
| `Off_main_ShutdownAsync_is_rejected_before_latching_the_factory_or_stopping_the_session` | 拒绝 → factory 不 latch、session 不 stop |
| `Off_main_application_Dispose_is_rejected_and_starts_no_shutdown` | 拒绝 → shutdown 不开始 |

**每个测试都断言了"拒绝的副作用是 0"** —— 不是"部分应用"。

### 12.2 "拒绝后可重试"

```csharp
// The factory is neither poisoned nor latched: the main thread still works.
Assert.That(() => harness.Factory.CreateSession(), Throws.Nothing);
```

**这是关键不变量**：off-main 拒绝**不能破坏 main-thread 路径**。

### 12.3 并发 worker 拒绝

```csharp
const int callers = 16;
var ready = new ManualResetEventSlim(false);
var rejected = new Task[callers];
var threads = new Thread[callers];
for (var index = 0; index < callers; index++)
{
    var slot = index;
    threads[slot] = new Thread(() =>
    {
        ready.Wait();
        rejected[slot] = session.StopAsync(CancellationToken.None);
    }) { IsBackground = true };
    threads[slot].Start();
}
ready.Set();
foreach (var thread in threads)
    Assert.That(thread.Join(TimeSpan.FromSeconds(10)), Is.True, "Rejection must not deadlock.");
```

**16 个 worker 线程同时调 StopAsync**——全部被拒绝，**没有死锁**，session 完好无损。然后主线程的合法 stop 正常工作。

---

## 13. SessionLifecycleConcurrencyTests — 锁不泄漏

**文件**：`SessionLifecycleConcurrencyTests.cs`（207 行）

### 13.1 Reentrant diagnostics 不死锁

```csharp
var reentrantSink = new DelegateDiagnosticSink(recorded =>
{
    if (session == null) return;
    observed.Add(session.State);                // ← 从 sink 里读 Session
    observedIds.Add(session.Id);

    var probe = new Thread(() =>                // ← 跨线程读
    {
        var _ = session.State;
        var __ = session.Id;
    }) { IsBackground = true, Name = "diagnostic-lock-probe" };
    probe.Start();
    if (probe.Join(TimeSpan.FromSeconds(5))) crossThreadReads++;
    else crossThreadTimeouts++;
});

var harness = new SessionTestHarness(reentrantSink);
session = harness.Factory.CreateSession();

await session.StartAsync(CancellationToken.None);
await session.StopAsync(CancellationToken.None);

Assert.That(crossThreadTimeouts, Is.Zero, "No lifecycle lock may be held while a diagnostic sink runs.");
```

**测试设计**：
- `reentrantSink` 在被调时**启动一个跨线程 reader**
- 如果 lifecycle 锁在 sink 运行时被持有，reader 进不去 → timeout
- **断言 `crossThreadTimeouts == 0`** 即"锁从未跨 sink 持有"

### 13.2 20 轮循环不泄漏

```csharp
for (var index = 0; index < 20; index++)
{
    var session = harness.Factory.CreateSession();
    await session.StartAsync(CancellationToken.None);
    await session.StopAsync(CancellationToken.None);
    // ...
}

Assert.That(harness.ScopeFactory.Created, Has.Count.EqualTo(20));
Assert.That(harness.ScopeFactory.Created.All(scope => scope.IsDisposed), Is.True);
Assert.That(harness.ScopeFactory.Created.All(scope => scope.DisposeCount == 1), Is.True);
```

**20 个 session × 1 个 scope = 20 个 scope 全部 dispose 恰好 1 次**——**没有泄漏，没有重复清理**。

---

## 14. 关键设计模式总结

读完整个 Bootstrap 我提炼出 **7 个核心模式**：

### 模式 1：状态机 + Memoization

`SessionState` 枚举 + 锁内 memoize stopTask。

```csharp
lock (sync)
{
    if (stopTask != null) return stopTask;   // ← 第二个 caller 拿第一个的 Task
    // ...
}
```

### 模式 2：锁持有时间最小化

锁内只做状态变更；sink、cancel、dispose 全部锁外。

### 模式 3：双层失败模型

```csharp
catch (Exception exception)
{
    cleanupFailure = cleanupFailure ?? exception;  // ← 不覆盖
}
```

主失败传播，cleanup 失败追加（不替换）。

### 模式 4：状态终态不可逆

`state` 进入 `Stopped` / `Failed` 后**不再变化**——`Start` 在终态下被拒（`ObjectDisposedException`）。

### 模式 5：纵深防御（Defense in Depth）

三层主线程守门：`SessionFactory` → `Session` → `VContainerSessionScopeFactory`。

### 模式 6：Cleanup in `finally`

```csharp
try { /* cleanup */ }
finally { state = ...; isDisposed = true; }
```

无论 cleanup 怎么炸，状态机终态都能进入。

### 模式 7：构造时验证 + 默认值无效

`CancellationTokenSource` 用 `cancellationDisposed` latch 保证 dispose 恰好一次。

---

## 15. 与 spec 对照

| spec 章节 | Bootstrap 实现 |
|---|---|
| 9.1 Runtime Scopes（App/Session/Module 三层） | `AppLifetimeScope` + `VContainerSessionScope` |
| 10.3 Lifecycle States（Inactive → Loading → Active → Unloading） | `SessionState.Created → Starting → Running → Stopping → Stopped/Failed` |
| 10.4 Effect Ownership | `lifetimeCancellation` + `scope` + `release` 三个 owned 引用 |
| 6.3 Provider-before-consumer 启停 | `PreventNewSessions()` 先于 `active.StopAsync` |
| 6.5 Logical unload 强制 | `RunStop` 完整序列：cancel → dispose → release → emit |

**当前实现对应 Phase 1**——AOT kernel 启动 + 单 Session 生命周期。**Module fiber**（spec 10.2）的实现还在后续 plan 中。

---

## 16. 我对 Bootstrap 实现的整体评价

### 优点

1. **教科书级别的状态机实现**——memoization + 终态不可逆 + cleanup 在 finally
2. **主线程守门是真"守"，不是"建议"**——纵深防御 + 拒绝在 mutation 前
3. **双层失败模型**——`primary vs cleanupFailure` 的设计很成熟
4. **TaskCompletionSource + RunContinuationsAsynchronously**——避免 continuation stack dive
5. **测试密度高**——8 个守门 + 8 个状态机 + 7 个 concurrency + 5 个 cleanup = ~30 个测试覆盖一个 ~700 行的核心
6. **诊断信号清晰**——start-failed vs stop-failed vs cleanup-failed vs application-shutdown-incomplete 都有独立 code
7. **公开 API 受控**——`IUnityMainThreadGuard` / `SessionLifetime` 都是 `internal`，不暴露到 Mod SDK

### 可借鉴的设计模式

| 模式 | 适用 | 学习难度 |
|---|---|---|
| 状态机 + memoized terminal Task | 长生命周期对象的优雅 stop | 🟡 中等 |
| 锁持有时间最小化（state vs effect split） | 任何需要 reentrant 的锁 | 🟡 中等 |
| 纵深防御（多层 guard） | 涉及线程安全的代码 | 🟢 简单 |
| 主失败 + cleanup 失败双错误 | 资源清理代码 | 🟢 简单 |
| `TaskCreationOptions.RunContinuationsAsynchronously` | 防止 stack dive | 🟢 简单 |
| `ObjectDisposedException` 而不是自定义异常 | 实现 IDisposable 的标准实践 | 🟢 简单 |

### 局限与可改进点

1. **每个 Session 单独的 factory 引用**——`SessionFactory.Release` 内部已经检查 `ReferenceEquals`，但**没有引用计数**。如果未来允许多 Session，需要改成 list + 引用计数。
2. **`TaskCreationOptions.RunContinuationsAsynchronously` 仅在 continuation path 用**——`FailStart` 的某些路径可能 inline await。需要测试覆盖。
3. **`preventNewSessions` 没有 backoff**——频繁错误的代码（比如搞坏 Unity 句柄）会持续抛异常。可以加 limiter。
4. **诊断没有 buffer**——如果 sink 慢，主线程会被 `Emit` 阻塞。可考虑 async emit queue。

---

## 17. 与 Unity 生态的整合点

虽然 Bootstrap 大量使用 Unity API（`MonoBehaviour`、`ScriptableObject`、`[SerializeField]`），但**主线程守门让 Unity API 调用安全**：

- `Debug.Log/LogWarning/LogError` 必须在主线程——守门保证
- VContainer `LifetimeScope.CreateChild` 必须在主线程——守门保证
- `LifetimeScope.Dispose` 销毁 Unity 对象——守门保证

**Bootstrap 是 Unity 集成与 .NET 并发模型的"翻译层"**——把 Unity 的"主线程文化"翻译成 .NET 的"线程安全语言"。

---

## 18. 关键 takeaway

读完整个 Bootstrap，最大的认知收获：

> **长生命周期对象的状态管理 = 状态机 + 锁持有时间最小化 + memoization + 双层失败处理**

具体到这个项目：
- **ApplicationLifecycleCoordinator** = 应用级状态机（Started → ShutdownRequested）
- **Session** = 会话级状态机（Created → Starting → Running → Stopping → Stopped/Failed）
- **memoization** 让 stop/dispose 幂等，让多 caller 等同一个 Task
- **锁持有时间最小化** 让 reentrant 不死锁（test 显式验证）
- **双层失败** 让原异常永远不被清理异常吞掉

这套模式可以应用到：
- **数据库 connection pool**（连接 = Session）
- **WebSocket 会话**（连接 = Session）
- **分布式任务调度**（任务 = Session）
- **任何 IDisposable 长生命周期对象**

---

## 参考链接

- [VContainer 文档](https://vcontainer.hadotakanobu.com/)
- [.NET TaskCreationOptions.RunContinuationsAsynchronously](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.taskcreationoptions)
- [TaskScheduler.Default](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.taskscheduler.default)
- [Unity Domain Reload](https://docs.unity3d.com/Manual/ConfigurableEnterPlayMode.html)
- [CancellationToken 生命周期](https://learn.microsoft.com/en-us/dotnet/standard/threading/cancellation-in-managed-threads)

---

**下一步**：读 [ModApi 契约笔记](./04-ModApi-Contract-Surface.md)，看 Mod 作者能接触到的接口——`IModule`、`IModuleContext`、`CapabilityContracts` 是怎么设计的。