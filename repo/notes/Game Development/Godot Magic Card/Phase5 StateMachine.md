# Phase 5 学习笔记：游戏引擎与状态机

  

## 本阶段完成了什么

  

实现了游戏的核心驱动引擎：

  

- `internal/game/engine.go` — Engine 状态机，驱动完整回合循环

- `internal/game/state.go` — GameState / PlayerState 数据模型

- `internal/game/view.go` — 信息遮蔽视图生成

- `internal/game/handler.go` — 网络层到引擎的消息路由

  

---

  

## 核心设计：单 goroutine 顺序状态机

  

### 问题

  

游戏状态是高度相关的：玩家A的行动可能影响玩家B行动的合法性（例如攻击牌互相影响），

如果两个玩家的消息被并发处理，就需要到处加锁——复杂且容易出 bug。

  

### 解法

  

```

网络 goroutine A  ──→  actionCh  ──→  run() goroutine（唯一消费者）

网络 goroutine B  ──→  actionCh  ─↗

```

  

`run()` 是游戏状态的**唯一所有者**，串行处理所有操作。

GameState 不需要任何锁。

  

**类比**：Redis 的单线程命令处理模型——不是因为单线程快，而是因为**消除竞态本身就是价值**。

  

### channel 作为"消息队列"

  

```go

type action struct {

    Seat    int

    MsgID   uint16

    Payload []byte

}

  

actionCh chan action  // 容量 32，异步不阻塞网络层

```

  

`SubmitAction` 用 `select + ctx.Done()` 确保引擎停止后投递的消息被安全丢弃：

  

```go

func (e *Engine) SubmitAction(seat int, msgID uint16, payload []byte) {

    select {

    case e.actionCh <- action{...}:

    case <-e.ctx.Done():  // 引擎已停止，丢弃

    }

}

```

  

---

  

## 有限状态机（FSM）的游戏流程

  

```

PhaseWaiting

    ↓  (双方均选好角色)

PhaseDraw  (初始8张)

    ↓

[主循环开始]

PhaseFieldDraw  → PhaseDraw → PhaseAction → PhaseCombat → PhaseCleanup

    ↓                                                          ↓

    └────────────────────── Round++ ──────────────────────────┘

                                           ↓ (某方 HP 归零)

                                       PhaseGameOver

```

  

FSM 的关键好处：**任何阶段收到不合法的操作，都可以直接 sendError 拒绝**，

不需要每个处理函数自己判断"现在是什么阶段"。

  

---

  

## 濒死机制的实现

  

这是本游戏的核心差异化设计，用一个字段 `IsNearDeath bool` + 双重死亡判断实现：

  

```go

func (e *Engine) handleHPZero(seat int) {

    p := e.state.Players[seat]

    if !p.IsNearDeath {

        // 第一次归零：复活到 60 HP，进入濒死

        p.HP = 60

        p.IsNearDeath = true

    } else {

        // 第二次归零：真正死亡

        p.HP = 0

        e.triggerDeath(seat)

    }

}

```

  

同时，清场阶段对濒死玩家持续扣血（每轮 -30），形成压力：

  

```go

if p.IsNearDeath {

    e.applyDamage(seat, 30, "濒死扣除")

}

```

  

---

  

## 广播 vs 定向发送

  

游戏引擎有两种发送模式，对应不同场景：

  

| 函数 | 用途 |

|------|------|

| `broadcastState(reason)` | 双方各自收到信息遮蔽后的视图 |

| `sendStateTo(seat, reason)` | 只给某玩家发（操作反馈，不需通知对手） |

| `broadcastPhaseChange()` | 阶段切换，双方相同 |

| `sendPlayerStatus(seat)` | HP/能量增量更新，双方可见 |

| `sendError(seat, code, msg)` | 操作被拒绝，只发给操作者 |

  

关键：`broadcastState` 调用了两次 `BuildView`——分别为 seat=0 和 seat=1 生成不同的视图。

**同一份 GameState，产生两份不同的 wire 数据**，这就是信息遮蔽的实现位置。

  

---

  

## 行动阶段的"双方独立"设计

  

行动阶段双方各自操作，**互不等待**，都宣告 EndAction 后才进入下一阶段：

  

```go

func (e *Engine) runAction() bool {

    for {

        if e.state.Players[0].ActionDone && e.state.Players[1].ActionDone {

            return true  // 双方都结束，进入交战

        }

        select {

        case act := <-e.actionCh:

            e.processAction(act)

        case <-e.ctx.Done():

            return false

        }

    }

}

```

  

已宣告结束的玩家继续发消息会收到错误：

  

```go

if p.ActionDone {

    e.sendError(act.Seat, protocol.ErrCodeInvalidPhase, "你已宣告行动结束")

    return

}

```

  

---

  

## 为什么 GameState 和 PlayerState 分离

  

`PlayerState` 不是 `player.Player`：

  

- `player.Player`（`internal/player` 包）管理**网络身份**——Session、Token、RoomID

- `PlayerState`（`internal/game` 包）管理**游戏状态**——HP、Hand、Deck、PlayedAttack

  

两者通过**座位编号**关联，`room.Room` 负责桥接（`room.SendTo(seat, ...)`）。

  

如果把两者合并，`player` 包就必须 import `game` 包，形成循环依赖。

**分层的本质是：职责边界清晰，依赖方向单向。**

  

---

  

## `sync.Once` 在引擎停止中的应用

  

```go

func (e *Engine) Stop() {

    e.stopOnce.Do(e.cancel)

}

```

  

`run()` 末尾执行 `defer e.Stop()`——无论正常结束还是提前退出，都保证 cancel 被调用一次。

外部调用 `Stop()` 也是安全的。`sync.Once` 保证 cancel 不会被重复调用。

  

---

  

## 本阶段遗留的"Phase 7 占位符"

  

引擎中有多处注释了 Phase 7 的插入点，当前是存根：

  

- 技能牌打出 → 返回错误（Phase 7 实现）

- `applyDamage` 里的效果系统（反弹、吸收、减免）

- `handleHPZero` 里的殉道者被动拦截

- `runCleanup` 里的赐福随机第二角色

  

这些占位符的作用是：**先把数据流走通，Phase 7 只需在固定位置插入逻辑，不需要重构整体结构。**

  

---

  

## 面试要点总结

  

1. **为什么游戏引擎用单 goroutine？**

   消除竞态，GameState 无需锁。channel 是 goroutine 间通信的正确工具，不是全局 Mutex。

  

2. **channel 满了怎么办？**

   `SubmitAction` 的 `select` 有 `ctx.Done()` 分支——引擎停止时丢弃。

   容量 32 对正常游戏节奏足够，若满说明引擎处理太慢，应先优化引擎逻辑。

  

3. **信息遮蔽在哪里实现？**

   `broadcastState` → `BuildView(gs, seat)` → 根据 seat 分别生成 `PlayerView`（完整）和 `OpponentView`（仅计数）。

   不是在存储层过滤，而是在**发送前**生成不同的序列化数据。

  

4. **濒死机制如何保证不会无限循环？**

   `IsNearDeath = true` 后第二次归零直接 `triggerDeath`，不再回血。状态转移是单向的。