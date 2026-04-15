---
title: Pitaya 游戏服务端框架
description: topfreegames/pitaya — Go 通用游戏服务端框架学习笔记
publishDate: 2026-04-16
tags:
  - game-server
  - go
  - pitaya
  - cluster
  - rpc
---

# Pitaya 游戏服务端框架

## 来源
- GitHub: https://github.com/topfreegames/pitaya
- TopFreeGames 公司开源，生产环境验证
- v3 版本（2026-04 仍在活跃更新）

## 核心定位

**通用游戏服务端框架**，支持：
- 多协议: TCP / WebSocket / gRPC / NATS
- 集群: etcd 服务发现 + NATS/gRPC RPC
- 客户端: libpitaya (C SDK) → Unity / iOS / Android / C#

对比 rts-server-golang 的帧同步专用架构，Pitaya 更像是一个**微服务框架**，适合 MMO/MOBA/休闲游戏。

## 架构图

```
NATS / etcd (服务发现 + 跨服 RPC 消息总线)
         ↑
    ┌─────────┐          ┌─────────┐
    │Frontend │ ←─ RPC ──→│ Backend │
    │Connector│          │  Room   │
    └─────────┘          └─────────┘
         ↑                      ↑
         └─────── Client ───────┘
```

## 核心模块

| 模块 | 路径 | 职责 |
|------|------|------|
| Acceptor | `pkg/acceptor/` | TCP粘包、WS协议、WebSocket |
| Conn/Codec | `pkg/conn/` | Pomelo协议编解码 |
| Session | `pkg/session/` | 会话管理、UID绑定、数据存取 |
| Agent | `pkg/agent/` | Session↔Handler 桥梁 |
| Component | `pkg/component/` | 业务处理器注册系统 |
| Cluster | `pkg/cluster/` | etcd服务发现、RPC |
| serialize | `pkg/serialize/` | JSON/Protobuf序列化 |

## Pomelo 协议

每条消息: `[type:1][length:2][data]`
- type: 0=handshake, 1=data, 2=kick, 3=heartbeat
- length: big-endian uint16
- data: JSON/Protobuf 编码的业务消息

路由格式: `"module.handler.method"`

## 和 rts-server-golang 的互补

rts-server-golang 擅长：**帧同步、确定性、可靠UDP**
Pitaya 擅长：**通用框架、集群RPC、多协议接入**

两者不是替代关系，是不同游戏类型的方案。

## 笔记目录

- [[Pitaya 协议层]]
- [[Pitaya Session 与 Agent]]
- [[Pitaya 集群与 RPC]]
- [[Pitaya Component 系统]]
- [[Pitaya 集群示例解析]]
