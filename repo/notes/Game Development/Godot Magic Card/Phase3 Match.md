# Phase 3 学习笔记：匹配与房间系统

  

## 这一阶段做了什么

  

实现了从"玩家连入"到"一局游戏开始"的完整流程：

  

```

TCP 连接 → Session → 登录 → Player → 加入队列 → 匹配成功 → Room

```

  

新增了四个模块：

  

```

internal/player/manager.go      — 玩家实体 + 生命周期管理

internal/room/room.go           — 房间容器 + 房间管理器

internal/matchmaking/matchmaking.go — 匹配队列 + 消息处理器

main.go                         — 依赖注入 + 模块组装

```

  

---

  

## 核心概念 1：Player 和 Session 为什么要分开？

  

这是"有状态服务"最核心的设计问题。

  

```

        连接1         连接2（断线重连）

         ↓                ↓

     Session-A  →    Session-B

                        ↓

                    Player-X（一直存在）

                    roomID = "room-1"（对局信息保留）

```

  

如果把 Player 和 Session 合并，断线就意味着玩家消失，对局数据丢失。

分开之后：

- Session 断开 → 只是那根"网线"断了

- Player 继续存在（状态保留），等待重连

- 新 Session 连入 → Player 换了一根网线，游戏继续

  

**面试考点**：有状态服务（stateful service）和无状态服务（stateless service）的区别？

游戏服务器必须有状态（玩家在哪局、手牌是什么），而无状态服务（如 REST API）每个请求独立处理。

  

---

  

## 核心概念 2：断线重连的实现

  

整个流程：

  

```

1. 首次登录

   Client ──LoginReq("Alice")──→ Server

   Server 生成 Player + Token

   Client ←─LoginResp(token="abc123")── Server

   ★ 客户端必须把 "abc123" 存到本地（PlayerPrefs 等）

  

2. 断线发生（网络问题/应用切换后台）

   Session.Close() 被调用

   OnClose 回调 → PlayerManager.handleDisconnect()

   Player.session = nil（标记离线）

   Queue.Dequeue(player.ID)（从匹配队列移除，防止匹配到离线玩家）

  

3. 重连

   Client ──LoginReq(reconnect_token="abc123")──→ Server

   Server 找到 token 对应的 Player，绑定新 Session

   Client ←─LoginResp(in_game=true)── Server

   Client ←─MatchFoundEv(game_id, seat)── Server  ← 恢复游戏界面

   Phase 4 会在此处改为发送完整 GameStateView

```

  

**关键问题**：Token 有效期 3 分钟（`reconnectTTL`），超时后对局判负。

这个时间是游戏设计决策：太短玩家来不及重连，太长让对手等太久。

  

---

  

## 核心概念 3：并发安全的匹配队列

  

```go

type Queue struct {

    mu      sync.Mutex

    waiting []*player.Player

}

```

  

为什么用 `sync.Mutex` 而不是 `sync.Map`？

  

`sync.Map` 适合"读多写少、key 稳定"的场景（如 Session 池）。

匹配队列的操作：

- `Enqueue`：需要"查重 + 追加"两步，必须原子

- `Dequeue`：需要"按ID查找 + 按位置删除"两步，必须原子

- `tryMatch`：需要"判断长度 + 取出两个"两步，必须原子

  

这三个操作都需要跨多步的原子性，`sync.Mutex` 是正确选择。

  

**锁内只做内存操作**：

```go

func (q *Queue) tryMatch() {

    // ✅ 锁内：只做 slice 操作（内存）

    p0 := q.waiting[0]

    p1 := q.waiting[1]

    q.waiting = q.waiting[2:]

  

    // ✅ 锁外：网络 I/O（CreateRoom 内部发消息）

    go q.roomMgr.CreateRoom(p0, p1)

}

```

  

如果把 `CreateRoom`（内部会发网络消息）放在锁内，会：

1. 持锁时间变长，其他 goroutine 等待更久

2. 发消息期间锁被持有，若对方 handler 也想操作队列 → 死锁

  

---

  

## 核心概念 4：OnDisconnect 回调链（观察者模式）

  

```

PlayerManager                    Queue

    |                               |

    | OnDisconnect(fn) 注册 ────────>|

    |                               |

[玩家断线时]                         |

    | handleDisconnect()             |

    | → 调用所有 hooks ──────────────>|

    |                               | Dequeue(playerID)

```

  

`PlayerManager` 不知道 `Queue` 的存在（解耦），

`Queue` 通过回调注册的方式得到通知。

  

这是**观察者模式**（Observer Pattern）在 Go 中的实现：

不用接口，用函数类型 `func(*Player)` 作为回调，更简洁灵活。

  

同样的模式，Phase 4 的游戏引擎也会注册 `OnDisconnect`，

处理"玩家对局中断线"的逻辑（暂停计时器、等待重连等）。

  

---

  

## 核心概念 5：依赖注入（Dependency Injection）

  

`main.go` 是整个程序的"组装车间"：

  

```go

playerMgr := player.NewManager()           // 1. 创建各模块

roomMgr   := room.NewManager()

queue     := matchmaking.NewQueue(roomMgr) // 2. 注入依赖

  

playerMgr.OnDisconnect(...)               // 3. 注册跨模块回调

  

mmHandler := matchmaking.NewHandler(playerMgr, queue, roomMgr) // 4. 组装 Handler

mmHandler.RegisterAll(router)             // 5. 接入路由

```

  

每个模块只持有它需要的依赖，不知道其他模块的存在。

这让每个模块都可以单独测试（传入 mock 依赖）。

  

---

  

## 当前完整数据流

  

```

[Client A]                    [Server]                    [Client B]

    |                             |                             |

    |─── LoginReq("Alice") ──────>|                             |

    |<── LoginResp(token=T1) ─────|                             |

    |                             |                             |

    |─── JoinQueueReq ───────────>|                             |

    |<── JoinQueueResp(ok) ───────|                             |

    |                             |                             |

    |                             |<─── LoginReq("Bob") ────────|

    |                             |──── LoginResp(token=T2) ───>|

    |                             |                             |

    |                             |<─── JoinQueueReq ───────────|

    |                             |──── JoinQueueResp(ok) ─────>|

    |                             |                             |

    |                      [tryMatch 触发]                       |

    |                      [CreateRoom]                         |

    |<── MatchFoundEv(seat=0) ────|                             |

    |                             |──── MatchFoundEv(seat=1) ──>|

    |                             |                             |

         ← Phase 4 在此开始游戏引擎 →

```

  

---

  

## 面试会问什么

  

**Q：匹配系统如何扩展到多服务器（分布式匹配）？**

  

A：当前是单进程内存队列。分布式方案：

1. 用 Redis List 作为共享队列（`RPUSH` 入队，`BLPOP` 取出匹配）

2. 或者独立的匹配服务（Matchmaking Service），各游戏服务器订阅匹配结果

本项目的队列设计与 Redis 方案接口兼容，迁移时只需替换 Queue 实现。

  

**Q：两个玩家同时加入队列，会不会匹配到同一个人？**

  

A：`tryMatch` 在 `q.mu` 锁内执行，取出两个玩家是原子操作。

不可能出现"两个 goroutine 各取到同一个玩家"的情况。

  

**Q：断线重连 token 存在内存里，服务重启后失效怎么办？**

  

A：服务重启后所有对局状态丢失，这是单机架构的局限。

生产环境：用 Redis 存储 token + 房间状态，服务重启后仍可恢复。

本项目先实现内存方案，接口设计时已为 Redis 迁移预留空间。

  

---

  

## 下一步：Phase 4 卡牌系统与手牌区

  

Phase 3 建立了"两个玩家进入同一个 Room"的基础。

Phase 4 要给 Room 注入真正的游戏引擎，从"牌"开始：

  

1. 卡牌数据模型（大系/功能牌型/点数）

2. 手牌区 8 槽 + 合成区 4 槽的管理

3. 合成算法（同系×，异系+，同牌型禁止，上限 5/7）

4. 牌堆与补牌逻辑

  

这一阶段开始涉及游戏逻辑本身，是你游戏设计功力落地的地方。