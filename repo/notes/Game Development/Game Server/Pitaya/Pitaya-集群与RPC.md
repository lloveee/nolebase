---
title: Pitaya 集群与 RPC
description: 服务发现与跨服 RPC 架构
publishDate: 2026-04-16
tags:
  - game-server
  - pitaya
  - cluster
  - rpc
---

# Pitaya 集群与 RPC 架构

## 位置
`pkg/cluster/`, `pkg/router/`, `pkg/networkentity/`

## 三种 RPC 模式

### 1. gRPC RPC
```go
// pkg/cluster/grpc_rpc_client.go + grpc_rpc_server.go
```
- 用户端: `pitaya.RPC()` → gRPC 调用目标服务
- 需配合 etcd 服务发现

### 2. NATS RPC (默认推荐)
```go
// pkg/cluster/nats_rpc_client.go + nats_rpc_server.go
```
- 使用 NATS 作为消息总线（Pub/Sub）
- 跨服消息转发全走 NATS

### 3. 直接 RPC
- 同进程内直接函数调用（测试用）

## 服务发现 (etcd)
```go
// pkg/cluster/etcd_service_discovery.go
```
- 启动时注册: `"pitaya/servers/{type}/{id}"` → ServerInfo
- 心跳续约
- 跨节点自动发现

## 架构图

```
┌─────────────────────────────────────────┐
│              NATS 消息总线               │
│   (Pub/Sub: RPC请求/响应广播)            │
└─────────────────────────────────────────┘
         ↑                     ↑
┌────────────────┐   ┌────────────────┐
│  Connector     │   │   Room         │
│  (Frontend)    │   │   (Backend)    │
│                │   │                │
│  handler:      │   │  handler:      │
│  onJoin        │   │  onMove       │
│  onChat        │   │  onAttack     │
└────────────────┘   └────────────────┘
         ↑                     ↑
    Client 连接           RPC 跨服调用
```

## 消息路由

跨服时用**字符串路由**:
```go
ctx = router.With(ctx, router.New("room", "handler", "method"))
err = pitaya.RPC(ctx, "room.handler.method", &req, &resp)
```

`pkg/router/` 负责: `"module.handler.method"` → 目标服务器

## 与 rts-server-golang 对比

rts-server-golang 是**单进程帧同步**，根本没有跨服需求。

Pitaya 的设计适合: **MMO 分线服、MOBA 匹配服、休闲游戏房间服**。

如果你要做帧同步 RTS，可以参考 Pitaya 的 cluster 思路做**多房间服务器水平扩展**，但 RPC 层换成可靠 UDP。
