# Phase 1 学习笔记：网络层基础

  
## 这一阶段做了什么

  

把原来一个函数搞定所有事的 `main.go`，重构成了四个各司其职的模块：

  

```

codec.go   — 帧的读写（字节层面）

router.go  — 消息ID → 处理函数的分发

session.go — 单个连接的完整生命周期管理

server.go  — 监听端口，创建并管理所有 Session

```

  

---

  

## 核心概念 1：为什么游戏服务器用 TCP 长连接，不用 HTTP？

  

HTTP 是"请求-响应"模型，客户端问，服务端答。

游戏有大量**服务端主动推送**的场景：

- 对手出了一张牌，服务端要主动通知你

- 心跳超时，服务端要主动断开你

- 场地效果触发，服务端要同时通知双方

  

HTTP 要做到这些需要轮询或 Server-Sent Events，不如 TCP 长连接直接。

TCP 保持连接，双方都可以随时向对方发数据，这才是游戏服务器的正确模型。

  

---

  

## 核心概念 2：协议帧格式（防粘包）

  

TCP 是**字节流**协议，没有"消息边界"的概念。

你发两条消息 `[A][B]`，对方可能一次读到 `[AB]`（粘包），也可能分两次读到 `[A]` 和 `[B]`（拆包）。

  

解决方案：**固定头部长度字段**（Length-Prefixed Protocol）

  

```

[ 4字节: 消息体长度 ][ 2字节: 消息ID ][ N字节: 消息体 ]

```

  

读帧时：

1. 先固定读 6 字节头部，取出消息体长度 N

2. 再读 N 字节，拿到完整消息体

  

`io.ReadFull` 的作用：保证即使 TCP 把数据拆成多个包，也能凑齐指定字节数。

不要用普通 `conn.Read`，它可能只读到部分数据就返回。

  

---

  

## 核心概念 3：为什么 writeLoop 要单独一个 goroutine？

  

### 问题

  

`net.Conn.Write` **不是并发安全的**。

  

假设没有 writeLoop，三个地方同时想给客户端发消息：

- 心跳 goroutine 发 Ping

- 游戏逻辑 goroutine 发状态更新

- 匹配模块 goroutine 发匹配成功通知

  

三个 goroutine 同时调用 `conn.Write`，数据会**交叉写入**，客户端收到的是损坏的乱序数据。

  

### 解决方案：单写者模式（Single Writer Pattern）

  

```

[心跳goroutine]  ─┐

[游戏goroutine]  ─┼──> sendCh (channel) ──> [writeLoop goroutine] ──> conn.Write

[匹配goroutine]  ─┘

```

  

只有 writeLoop 一个 goroutine 碰 `conn.Write`，其他人只是往 channel 里塞数据。

channel 本身是并发安全的，Go 的 channel 内部有锁。

  

### 为什么 sendCh 要有缓冲区？

  

`make(chan []byte, 64)` 的 64 是缓冲大小。

- **无缓冲 channel**：发送方必须等接收方准备好才能塞入，如果 writeLoop 正在写慢速连接，业务逻辑会被阻塞

- **有缓冲 channel**：发送方塞入就立刻返回，允许短暂的消费滞后

- **缓冲满了怎么办**：说明客户端积压严重，此时应该断开它（见 `Send` 方法中的 `default` 分支），而不是让服务端无限等待

  

---

  

## 核心概念 4：context.Context 的作用

  

Session 关闭时，我们需要通知三个 goroutine（readLoop、writeLoop、heartbeatLoop）都退出。

如果不通知，这三个 goroutine 会泄漏，永远在内存中挂着。

  

`context.WithCancel` 创建一个可取消的 context：

```go

ctx, cancel := context.WithCancel(context.Background())

```

  

调用 `cancel()` 后，`ctx.Done()` 这个 channel 会被关闭。

所有监听 `ctx.Done()` 的 goroutine 都会收到信号，从 `select` 的对应分支退出。

  

**goroutine 泄漏**是游戏服务器的常见 Bug：

- 每个连接创建若干 goroutine

- 连接断开后没有正确退出

- 长时间运行后内存占用持续上涨

- 面试经常问：你的服务器有没有 goroutine 泄漏，怎么检测？（答：`runtime.NumGoroutine()` + pprof）

  

---

  

## 核心概念 5：sync.Once 保证幂等关闭

  

`Session.Close()` 可能从多个地方被调用：

- readLoop 读到错误时

- writeLoop 写入失败时

- heartbeat 超时时

- 外部业务逻辑主动踢人时

  

如果没有 `sync.Once`，`cancel()` 被调多次没问题，但 `conn.Close()` 被调多次会产生多余的错误日志。

`sync.Once` 保证内部逻辑只执行一次，无论外部调用多少次。

  

---

  

## 核心概念 6：sync.Map vs map + Mutex

  

Server 的 sessions 用了 `sync.Map` 而不是 `map[string]*Session + sync.RWMutex`。

  

选择依据：

- 注册（写）：每次新连接 1 次

- 注销（写）：每次断开 1 次

- 查找（读）：每次消息路由都可能需要

- 遍历（读）：广播时

  

这是典型的**读多写少**场景，`sync.Map` 对此有优化（无锁读）。

  

但如果你的场景是**写多读少**，`sync.Map` 反而比 `map + RWMutex` 慢，需要根据实际情况选择。

  

---

  

## 当前消息 ID 规划

  

| 消息ID | 方向 | 含义 | 状态 |

|--------|------|------|------|

| 1 | S→C | Ping（心跳探测） | 已实现 |

| 2 | C→S | Pong（心跳响应） | 已实现 |

| 1001 | C→S | 临时 Echo 测试 | 临时，Phase 2 替换 |

| 1002 | S→C | Echo 响应 | 临时，Phase 2 替换 |

  

Phase 2 起将定义完整的消息 ID 体系。

  

---

  

## 面试会问什么

  

**Q：你的游戏服务器如何管理数千长连接？**

  

A：每个连接对应一个 Session，每个 Session 有 3 个 goroutine（读/写/心跳）。

Go 的 goroutine 轻量（初始 2KB 栈），1 万连接约需 3 万 goroutine，内存约 60MB，完全可行。

Session 通过 sync.Map 统一管理，连接断开时从 Map 移除，防止内存泄漏。

  

**Q：如何防止一个慢客户端拖垮整个服务器？**

  

A：写队列（sendCh）有固定大小（64）。如果客户端消费太慢，队列满后服务端直接断开该连接，

不会因为一个慢客户端阻塞其他会话的业务逻辑 goroutine。

  

**Q：怎么检测 goroutine 泄漏？**

  

A：用 `runtime.NumGoroutine()` 观察连接建立/断开时 goroutine 数量的变化；

用 `go tool pprof` 的 goroutine profile 查看哪些 goroutine 在等什么。

本项目可以用 `-race` flag 编译，运行时检测数据竞争。

  

---

  

## 下一步：Phase 2 协议层

  

Phase 1 给了我们一个可以收发任意字节的框架。

Phase 2 要定义游戏的**消息体结构**：登录、匹配、出牌、技能、状态同步等。

最重要的问题是：**如何给两个玩家发送同一局游戏的不同视图**（信息遮蔽）。