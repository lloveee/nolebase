---
title: Pitaya Component 系统
description: Handler 与 Remote 组件注册
publishDate: 2026-04-16
tags:
  - game-server
  - pitaya
  - component
---

# Component 系统 (Handler/Remote)

## 位置
`pkg/component/`, `pkg/interfaces/`

## Component 是什么

类似 Java Spring 的注解 controller：
```go
type Room struct {
    component.Base
    timer *timer.Timer
    app   pitaya.Pitaya
}

// 声明为 Handler Component
func (r *Room) Join(ctx context.Context, msg []byte) (*JoinResponse, error) {
    s := r.app.GetSessionFromCtx(ctx)
    s.Bind(ctx, "uid")
    // ...
}
```

注册到全局:
```go
app.Register(
    component.New(Room{}),
    component.WithName("room"),           // 默认 handler 名
    component.WithNameFunc(strings.ToLower), // 方法名转小写
)
```

## Handler vs Remote

| 类型 | 用途 | 调用方 |
|------|------|--------|
| **Handler** | 处理客户端请求 | Client → Server |
| **Remote** | 处理服务端间 RPC | Server → Server |

```go
// Remote 注册
app.RegisterRemote(
    component.New(NewRemoteService()),
    component.WithName("myremote"),
)

// Remote 方法必须用 proto.Message
func (r *Remote) RemoteMethod(ctx context.Context, req *protos.Req) (*protos.Res, error)
```

## 生命周期

| 钩子 | 时机 |
|------|------|
| `Init()` | 组件注册时 |
| `AfterInit()` | 所有组件 Init 后 |
| `BeforeShutdown()` | 关闭前 |
| `Shutdown()` | 关闭时 |

## 路由解析

```
Client 请求: "room.room.join"
  → module: "room"
  → handler: "room"
  → method: "join"
  → 对应 Room.Join()
```

注意 pitaya 默认 handler 名取自 struct 名（本例是 `Room`），路由是 `room.room.join`。

## Pitaya vs rts-server-golang

rts-server-golang 用的是**消息ID → Handler函数**的直接映射:
```go
type Room struct { ... }
func (r *Room) OnCmd(ctx context.Context, cmd *wire.Cmd) { ... }
```

Pitaya 用字符串路由，更灵活但有反射开销。rts-server-golang 的固定ID映射更快，适合高频帧同步场景。
