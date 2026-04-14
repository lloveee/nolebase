---
nolebase:
  gitChangelog: false
  pageProperties: false
---

# 可靠 UDP 传输层 — Packet / RTX / Reorder

> 基于 [rts-server-golang](https://github.com/lloveee/rts-server-golang) transport/ 模块解析
> 关键词: 可靠UDP, 选择性ACK, 重传队列, 乱序重排, Jacobson RTT

## 概述

游戏需要 UDP 的低延迟，但 UDP 本身不保证送达、不保证顺序。

本模块在 UDP 之上构建可靠传输层，核心三组件：

| 组件 | 职责 |
|------|------|
| `Packet` | 自定义包格式 |
| `retxQueue` | 重传队列 + RTT 估算 |
| `reorderBuffer` | 乱序重排 |
| `Conn` | 每连接一个，管理上述三者 |

---

## 包格式

### 二进制布局

```
| 魔数(2) | Flags(1) | ConnID(2) | Seq(4) | Ack(4) | AckBitmask(4) | PayloadLen(2) | Payload(N) |
| 0x52 0x31 |  bitmask  |   uint16   | uint32 | uint32 |    uint32     |    uint16      |  N字节     |
     2字节      1字节       2字节       4字节   4字节      4字节           2字节          变长
```

固定头 **19 字节**，Payload 最大 **1200 字节**（留余量给 MTU）。

### 字段详解

#### 魔数 `0x52 0x31` ("R1")

安全门。收到 UDP 包先检查魔数，不对则丢弃。防止无关流量进入解码器。

#### Flags (1字节 bitmask)

```
| PING | FIN | ACK | SYN | Reliable |
  bit4    bit2   bit1  bit0    bit3
```

| Flag | 位 | 含义 |
|------|-----|------|
| `FlagSYN` | 1<<0 | 连接建立 |
| `FlagACK` | 1<<1 | 包含 Ack 字段 |
| `FlagFIN` | 1<<2 | 连接断开 |
| `FlagReliable` | 1<<3 | 需要可靠传输（加入重传队列）|
| `FlagPING` | 1<<4 | 心跳保活 |

设计为 bitmask 可以灵活组合：一个包可同时是 Reliable + ACK。

#### ConnID (2字节)

同一 UDP 端口 (`:9000`) 上区分不同游戏会话。16位，最多 65535 并发连接。

#### Seq (4字节)

发送序列号，从 1 递增。接收方据此重新排序。

#### Ack + AckBitmask — 选择性 ACK

TCP 用累计 ACK，丢包只能等超时。本项目用 **bitmask SACK**：

```
Ack = 100           ← 收到的最高连续序列号
AckBitmask[32bit]   ← [99..68] 范围内各包的到达状态
```

Bit = 1 → 已到达；Bit = 0 → 丢了。

**示例：**
```
发送: 95, 96, 97, 98, 99, 100
收到: 95, 96, 98, 99, 100
          ↑   ✗   ↑
         97 丢了

返回: Ack=100, AckBitmask bit2=0 (seq=97丢了)
发送方精准重传 seq=97
```

---

## retxQueue — 重传队列

### 数据结构

```go
type pendingPacket struct {
    pkt       *Packet        // 包引用，重传时直接发这个
    sentAt    time.Time      // 首次发送时间（用于 RTT 采样）
    nextRetx  time.Time      // 下次重传时间
    rto       time.Duration  // 当前 RTO（会指数增长）
    retries   int            // 已重传次数
}

type retxQueue struct {
    pending map[uint32]*pendingPacket  // seq → pendingPacket
}
```

### 核心常量

```go
InitialRTO    = 200 * time.Millisecond   // 初始超时
MaxRTO        = 2 * time.Second          // RTO 上限
RTOMultiplier = 2                         // 指数退避倍数
MaxRetries    = 10                        // 超过则判定断开
```

### 退避时间线

```
第1次重传: RTO = 200ms
第2次重传: RTO = 400ms
第3次重传: RTO = 800ms
第4次重传: RTO = 1600ms
第5次重传: RTO = 2000ms (已达上限)
第11次:    超过 MaxRetries → seq 判定为 expired
```

### RTT 估算 — Jacobson 算法

每收到 ACK 时，用 `now.Sub(pp.sentAt)` 采样 RTT：

```go
// RFC 6298 Jacobson/Karels 算法
srtt   = (7*srtt + sample) / 8       // 平滑 RTT
rttvar = (3*rttvar + |srtt-sample|) / 4  // 平滑偏差
rto    = srtt + 4*rttvar             // 最终超时
```

不用简单平均：用 `7/8` 和 `1/8` 加权，变化更平滑；偏差项 `rttvar` 捕捉网络抖动。

---

## reorderBuffer — 乱序重排

### 核心思想

维护 `nextExpected`：我期待的下一个序列号。

```
情况A: seq == nextExpected
  → 正好是下一个，交付，并尝试 flush buffer 中连续的包

情况B: seq > nextExpected
  → 乱序，先存 buffer，等 gap 被填上
```

### 数据结构

```go
type reorderBuffer struct {
    nextExpected uint32              // 下一个期待的 seq
    buffer       map[uint32][]byte   // 乱序包暂存
    maxBuffered  int                 // 最多缓存多少乱序包
}
```

`maxBuffered` 防止内存爆炸：超过窗口的先头乱序包直接丢弃。

### Insert 流程

```
1. seq < nextExpected  → 旧包/重复包，return nil
2. seq - nextExpected > maxBuffered → 超窗口，return nil（丢弃）
3. seq == nextExpected → 交付，nextExpected++，flush 连续的缓存包
4. seq > nextExpected  → 存入 buffer，return nil
```

### uint32 回环处理

```go
func seqLT(a, b uint32) bool {
    return int32(a-b) < 0  // 差值转 int32 看符号位
}
```

---

## 三者配合的完整收发流程

```
发送方                              接收方
  │                                   │
  │  Send(cmd)                        │
  │  seq=5, Reliable+ACK, payload     │
  │  retx.Add(seq=5)                  │
  │  ──────────────────────────────→  │
  │                                   │  DecodePacket → Packet
  │                                   │  updateRecvAck(seq=5)
  │                                   |  reorderBuffer.Insert(seq=5)
  │                                   |  → Inbox <- payload
  │                                   |
  │  ←── ACK(seq=5, AckBitmask) ───  │
  │                                   |
  │  retx.Ack(5) → delete            │
  │  updateRTT(sample)                │

丢包场景:
  │  seq=3 ─ ─ ─ [丢] ─ ─ ─ ─ ─ ─→  │
  │  seq=4 ────────────────────────→  │
  │                                   |  收到 seq=4 → buffer[4]
  │  ←── ACK(seq=4, bitmask bit0=0) ──│  ← bit0=0 表示 seq=3 丢了
  │                                   |
  │  CollectRetransmissions → 重传 seq=3
  │  ──────────────────────────────→  │
  │                                   |  收到 seq=3 → Insert(3) 触发 flush
  │                                   |  → Inbox <- [3, 4]
```

---

## 设计取舍

| 选择 | 原因 |
|------|------|
| 自研可靠 UDP 而非 KCP | 学习目的；展示核心原理 |
| 无拥塞控制 | RTS 包小且规律，拥塞控制反而增加延迟 |
| bitmask SACK 而非累计 ACK | 精准重传，减少等待时间 |
| 20ms Tick 轮询 | Go 没有 timer wheel，用简单轮询足够 |

---

## 相关

- 项目源码: [rts-server-golang](https://github.com/lloveee/rts-server-golang) `/internal/transport/`
