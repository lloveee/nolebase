---
title: Pitaya 集群示例解析
description: examples/demo/cluster 案例分析
publishDate: 2026-04-16
tags:
  - game-server
  - pitaya
  - example
---

# Pitaya 集群示例解析

## 目录结构
```
examples/demo/cluster/
├── main.go              # 启动入口，通过 -type 区分 frontend/backend
└── services/
    ├── connector.go     # Frontend 服务 (连接管理、Session数据)
    └── room.go          # Backend 服务 (房间逻辑、Group广播)
```

## 启动模式

通过命令行参数区分：
```bash
# 启动 Frontend (Connector)
go run main.go -port 3250 -type connector -frontend true

# 启动 Backend (Room)
go run main.go -port 3251 -type room -frontend false
```

## Frontend (Connector) 服务

```go
type Connector struct {
    component.Base
    app pitaya.Pitaya
}

// Session 数据读写
func (c *Connector) GetSessionData(ctx context.Context) (*SessionData, error)
func (c *Connector) SetSessionData(ctx context.Context, data *SessionData) (*protos.Response, error)

// Remote: 供其他服务 RPC 调用
func (c *ConnectorRemote) RemoteFunc(ctx context.Context, msg *protos.RPCMsg) (*protos.RPCRes, error)
```

## Backend (Room) 服务

```go
type Room struct {
    component.Base
    timer *timer.Timer
    app   pitaya.Pitaya
}

// 核心方法
func (r *Room) Entry(ctx context.Context, msg []byte)     // 入口：绑定Session
func (r *Room) Join(ctx context.Context)                   // 加入Group
func (r *Room) Leave(ctx context.Context)                 // 离开Group
func (r *Room) Message(ctx context.Context, msg *protos.UserMessage)  // 群发消息

// 跨服 RPC
func (r *Room) SendRPC(ctx context.Context, msg *protos.SendRPCMsg) (*protos.RPCRes, error)
    → app.RPCTo(ctx, serverId, route, &ret, payload)
```

## 路由配置

```go
// 字符串路由 → 数字ID 压缩（省带宽）
app.SetDictionary(map[string]uint16{
    "connector.getsessiondata": 1,
    "room.room.getsessiondata": 3,
    "onMessage":                4,
})

// 自定义路由策略：room 请求 → 发到哪台 backend
app.AddRoute("room", func(ctx, route, payload, servers) (*Server, error) {
    for k := range servers { return servers[k], nil }  // 简单轮询
})
```

## Group 广播

```go
// 加入房间 Group
r.app.GroupAddMember(ctx, "room", s.UID())

// 广播给全组
r.app.GroupBroadcast(ctx, "connector", "room", "onMessage", msg)

// 推送给自己
s.Push("onMembers", &protos.AllMembers{Members: members})
```

## 关键设计亮点

1. **字符串路由字典压缩**: 常用路由映射成 uint16，节省 10x 带宽
2. **AddRoute 自定义路由**: 可按 UID hash、负载均衡选择 backend
3. **Group 简化房间**: 不需要自己管理成员列表，Group 封装好了
4. **Remote vs Handler**: 明确区分客户端请求和服务端间 RPC

## 对 rts-server-golang 的借鉴

rts-server-golang 的 Room 设计：
- 单进程单 goroutine，tick 驱动
- 无需跨服（因为是帧同步，延迟敏感）

**如果要做多房间水平扩展**，可以学习 Pitaya：
- Frontend: 只做连接+协议解析
- Backend: 每个 Room 是独立进程
- NATS/etcd: 服务发现 + 跨服 RPC
