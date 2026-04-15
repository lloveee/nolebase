---
title: Pitaya 协议层
description: Pomelo Packet 协议格式分析
publishDate: 2026-04-16
tags:
  - game-server
  - pitaya
  - protocol
---

# Pitaya 协议层: Pomelo Packet

## 位置
`pkg/conn/codec/`, `pkg/conn/message/`, `pkg/conn/packet/`

## Pomelo 协议格式

每条底层消息: `[type:1][length:2][data]`

```
  1 byte       2 bytes         N bytes
┌──────────┬─────────────┬────────────────┐
│  Type    │   Length    │     Data       │
│ (uint8)  │  (uint16BE) │                │
└──────────┴─────────────┴────────────────┘
```

**Type 枚举** (`pkg/conn/packet/`):
- `Handshake`   = 0  — 客户端发起握手
- `HandshakeAck` = 1 — 客户端确认握手
- `Heartbeat`   = 2  — 心跳
- `Data`        = 3  — 业务数据

## 消息编码 (Data type)

业务消息在 Data 里，格式: `[id:4][route_len:1][route:route_len][msg]`

```
  4 bytes        1 byte          N bytes        M bytes
┌──────────────┬─────────────┬────────────────┬─────────────┐
│  MessageID   │ RouteLen    │     Route      │   Payload   │
│  (uint32)    │  (uint8)    │  (string)     │  (bytes)   │
└──────────────┴─────────────┴────────────────┴─────────────┘
```

- MessageID: 请求唯一 ID，响应时带回
- Route: `"module.handler.method"` 路由字符串
- Payload: JSON 或 Protobuf 编码的业务数据

**注意**: Pitaya v3 用的是新版协议，老版本还有 `route_len:2` 的格式。

## 与 rts-server-golang 对比

| 维度 | Pitaya | rts-server-golang |
|------|--------|-------------------|
| 协议 | Pomelo (变长路由) | 自定义二进制 (定长Packet头) |
| 粘包 | Acceptor 层处理 | 包格式内置 |
| 序列化 | JSON/Protobuf | 手写二进制 |
| 可靠性 | TCP (可靠) | 可靠UDP + 重传 + 乱序 |

rts-server-golang 的 Packet 更紧凑，适合帧同步高频小包；Pitaya 的路由是字符串，更灵活但更重。
