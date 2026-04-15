---
title: Pitaya Session 与 Agent
description: 会话管理与 Agent 桥梁
publishDate: 2026-04-16
tags:
  - game-server
  - pitaya
  - session
---

# Session 和 Agent (`pkg/session/`, `pkg/agent/`)

## Session

Session 是**客户端连接**在服务端的抽象。

```go
type Session interface {
    ID() int64           // 连接唯一ID
    UID() string         // 绑定后的用户ID
    Bind(ctx context.Context, uid string) error   // 绑定UID
    Set(key string, val interface{})              // 存数据
    Get(key string) interface{}                   // 取数据
    Push(route string, v interface{}) error      // 主动推送
    Close() error
}
```

关键设计:
- `sessionsByUID sync.Map` — 全局按 UID 查 Session
- `sessionsByID sync.Map` — 全局按连接 ID 查 Session
- `SessionCount atomic.Int64` — 在线计数
- 支持**全局回调**: Bind前/后回调、Close回调

## Agent

Agent 是 **Session ↔ Handler** 之间的桥梁。

```
Client 连接
    ↓
Acceptor (TCP粘包/WS握手)
    ↓
Agent (Serialize/Deserialize, 路由分发)
    ↓
Handler (业务逻辑)
    ↓
Session.Push (响应)
```

核心逻辑:
```go
type agentImpl struct {
    Session     session.Session   // 关联的会话
    conn        net.Conn          // 原始连接
    decoder     codec.PacketDecoder // 包解码器
    chSend      chan pendingWrite  // 写队列 (非阻塞)
    serializer  serialize.Serializer // JSON/Protobuf
}
```

**非阻塞发送**: `chSend` channel 缓冲，goroutine 异步消费，避免阻塞业务逻辑。

## 生命周期

```
连接建立 → Agent创建 → Handshake → 业务Handler处理
                              ↓
                         Session.Bind(uid)
                              ↓
                         断开连接 → Session.Close → 全局回调
```

## Pitaya vs rts-server-golang

| 维度 | Pitaya Session | rts-server-golang Conn |
|------|----------------|----------------------|
| 单位 | 每个连接一个 | 每个连接一个 |
| UID绑定 | 需要手动Bind | 无 (纯连接管理) |
| 数据存储 | Session.Set/Get | Conn 内部map |
| 推送 | Session.Push (chSend) | Conn.SendRaw (非阻塞) |
| 关闭 | 全局回调 | CloseNotify |
