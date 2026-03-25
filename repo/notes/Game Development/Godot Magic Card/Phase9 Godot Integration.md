# Phase 9 学习笔记：Godot 客户端对接

  

## 本阶段完成了什么

  

- `client/Protocol.gd` — 消息 ID 常量、二进制帧编解码、便捷消息构建器

- `client/GameClient.gd` — TCP 连接管理、帧解析、信号分发（Autoload 单例）

- `client/GameScene.gd` — 游戏主场景状态驱动示例（信号处理 + UI 更新）

  

---

  

## 快速开始

  

### 1. 启动服务端

  

```bash

cd /home/ubuntu/echo-server

go run main.go

# 监听 0.0.0.0:8080

```

  

### 2. 配置 Godot Autoload

  

`Project → Project Settings → Autoload`，按顺序添加：

  

| 路径 | 名称 |

|------|------|

| `res://Protocol.gd` | `Protocol` |

| `res://GameClient.gd` | `GameClient` |

  

顺序重要：`GameClient` 依赖 `Protocol`，所以 Protocol 先加载。

  

### 3. 连接并登录（最小示例）

  

```gdscript

func _ready():

    GameClient.connected.connect(_on_connected)

    GameClient.login_result.connect(_on_login)

    GameClient.connect_to_server("127.0.0.1", 8080)

  

func _on_connected():

    GameClient.send(Protocol.login("玩家1"))

  

func _on_login(data):

    if data.get("success"):

        print("登录成功，ID: ", data.get("player_id"))

        GameClient.send(Protocol.join_queue())

```

  

---

  

## 二进制协议详解

  

### 帧格式

  

```

+──────────────+──────────────+──────────────────+

│ 4字节 body长度 │ 2字节 MsgID │  N字节 JSON载荷    │

│  (big-endian) │ (big-endian) │  (UTF-8 编码)     │

+──────────────+──────────────+──────────────────+

  

body长度 = 2 (MsgID) + N (JSON)

```

  

### 为什么这么设计？（面试常问）

  

**长度前缀帧（Length-Prefix Framing）**解决了 TCP 的粘包/拆包问题。

  

TCP 是字节流，不是消息流：

```

发送方：发送消息A(10字节) + 消息B(20字节)

接收方可能收到：[A的前5字节] 或 [A全部+B前3字节] 或 [AB合并30字节]

```

  

长度前缀让接收方知道"下一条消息有多长"，可以精确等待：

```gdscript

# GameClient._try_read_frames() 的核心逻辑：

var body_len := Protocol.decode_header(_recv_buf)  # 先读4字节

if _recv_buf.size() < 4 + body_len:

    break  # 等待更多数据到达

# body 完整了，才处理

```

  

### GDScript 字节序处理

  

Godot 4 的 `PackedByteArray` 不内置 big-endian 读取，需要手动移位：

  

```gdscript

# 读取 big-endian uint32

var val = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]

  

# 读取 big-endian uint16

var msg_id = (buf[0] << 8) | buf[1]

```

  

这和 Go 的 `binary.BigEndian.Uint32(b)` 完全等价。

  

---

  

## 完整的一局游戏消息时序

  

```

客户端                         服务端

  │──── LoginReq {name} ────────→ │

  │ ←── LoginResp {success,token} │

  │                               │

  │──── JoinQueueReq ───────────→ │

  │                               │ (等待匹配)

  │ ←── MatchFoundEv {game_id,    │

  │          your_seat,opp_name}  │

  │                               │

  │──── SelectCharacterReq ─────→ │ (双方都选好后)

  │ ←── GameStartEv {game_id}     │

  │ ←── PhaseChangeEv {phase:draw}│

  │ ←── GameStateEv {完整状态}    │

  │                               │

  │  ┌─── 每回合开始（第2轮起）──┐ │

  │  │←── PhaseChangeEv          │ │ (field_draw)

  │  │←── PhaseChangeEv          │ │ (draw)

  │  │←── GameStateEv            │ │

  │  │←── PhaseChangeEv          │ │ (action)

  │  │←── GameStateEv            │ │

  │  │                           │ │

  │  │──── PlayCardReq ─────────→│ │

  │  │──── MoveToSynthReq ──────→│ │

  │  │──── SynthesizeReq ───────→│ │

  │  │──── UseSkillReq ─────────→│ │ ← 触发 SkillUsedEv

  │  │──── TriggerLibrateReq ──→ │ │ ← 触发 LiberationEv

  │  │──── EndActionReq ────────→│ │

  │  │                           │ │

  │  │←── PhaseChangeEv          │ │ (combat)

  │  │←── DamageEv               │ │

  │  │←── PlayerStatusEv         │ │

  │  │←── GameStateEv            │ │

  │  │                           │ │

  │  │←── PhaseChangeEv          │ │ (cleanup)

  │  │←── BlessingEv（可能）     │ │

  │  │←── GameStateEv            │ │

  │  └───────────────────────────┘ │

  │                               │

  │ ←── GameOverEv {winner_seat}  │

```

  

---

  

## GameState 数据结构（对应 protocol/view.go）

  

服务端推送的 `GameStateEv` 是 `GameStateView` 结构体的 JSON 序列化：

  

```json

{

  "round": 3,

  "phase": "action",

  "active_seat": -1,

  "field_effect": "回响之地",

  "me": {

    "seat": 0,

    "hp": 75,

    "max_hp": 100,

    "energy": 30,

    "max_energy": 100,

    "character": "力裁者",

    "is_near_death": false,

    "hand": [

      {"slot": 1, "faction": "梦境", "card_type": "攻击", "points": 3},

      {"slot": 3, "faction": "虚幻", "card_type": "技能", "points": 2}

    ],

    "synth_zone": [

      {"slot": 1, "faction": "重组", "card_type": "攻击", "points": 4}

    ]

  },

  "opponent": {

    "seat": 1,

    "hp": 60,

    "max_hp": 100,

    "energy": 50,

    "max_energy": 100,

    "character": "???",

    "is_near_death": false,

    "hand_count": 5,

    "synth_count": 2

  }

}

```

  

**关键设计**：

- `me.hand` 包含完整内容（槽位、派系、牌型、点数）

- `opponent` 只有 `hand_count` 和 `synth_count`，无手牌内容——这是服务端信息遮蔽的体现

- 客户端永远渲染服务端告诉它的内容，不做任何猜测

  

---

  

## 信号驱动 vs 轮询

  

`GameClient.gd` 使用**信号（Signal）**而不是让场景直接调用网络读取：

  

```gdscript

# ✅ 正确：场景订阅信号

GameClient.game_state_updated.connect(_on_game_state)

GameClient.damage_received.connect(_on_damage)

  

# ❌ 错误：场景主动轮询网络

func _process(delta):

    var data = GameClient.poll_next_message()  # 不要这样做

```

  

**为什么用信号？**

  

1. **解耦**：`GameClient` 不知道有多少个场景订阅了它的信号；场景不关心数据从哪里来

2. **Godot 原生**：信号是 Godot 的核心机制，观察者模式的语言级支持

3. **与 Go 的 channel 类比**：Go 用 channel 传递 action → Engine；Godot 用 signal 传递事件 → UI。都是"生产者不知道消费者"的解耦模式

  

---

  

## 粘包处理：循环解帧

  

这是游戏网络编程的核心难点之一：

  

```gdscript

func _try_read_frames() -> void:

    # 把可用字节追加到缓冲

    var available := _tcp.get_available_bytes()

    if available > 0:

        var result := _tcp.get_data(available)

        _recv_buf.append_array(result[1])

  

    # 循环处理，直到缓冲里没有完整的帧

    while _recv_buf.size() >= 4:

        var body_len := Protocol.decode_header(_recv_buf)

        if _recv_buf.size() < 4 + body_len:

            break  # 等待更多数据

        var body := _recv_buf.slice(4, 4 + body_len)

        _recv_buf = _recv_buf.slice(4 + body_len)  # 消费掉这一帧

        _dispatch(Protocol.decode_msg_id(body), Protocol.decode_payload(body))

```

  

**为什么是 while 而不是 if？**

  

一次 `_process` 轮询可能收到多个帧（服务端连续发了 PhaseChangeEv + GameStateEv）。

用 while 确保一次 poll 能处理所有已到达的完整帧。

  

---

  

## 重连流程

  

服务端在 `LoginResp` 里附带了 `reconnect_token`（3分钟有效）：

  

```gdscript

# 断线时保存 token（GameClient 已自动存储）

var saved_token = GameClient.reconnect_token

  

# 重连时带 token 登录

GameClient.send(Protocol.login("玩家名", saved_token))

  

# LoginResp 的 in_game 字段为 true 时

# 服务端会立刻推送 GameStateEv 恢复当前局面

func _on_login(data):

    if data.get("in_game"):

        # 等待 GameStateEv 恢复 UI，不需要重新走匹配流程

        print("重连到进行中的游戏")

```

  

---

  

## 本地测试步骤

  

```

1. 启动服务端：

   cd /home/ubuntu/echo-server && go run main.go

  

2. 打开两个 Godot 编辑器（或一个编辑器 + 一个导出版本）

  

3. 客户端 A 登录 "玩家A" → 入队

   客户端 B 登录 "玩家B" → 入队

  

4. 双方收到 MatchFoundEv → 各自发送 SelectCharacterReq

  

5. 双方轮流操作行动阶段 → EndActionReq → 进入结算

  

6. 测试技能：确保手牌中有技能牌（TypeSkill），发 UseSkillReq{skill_card_slot}

  

7. 测试解放：能量 ≥ LibThreshold，发 TriggerLibrateReq

```

  

---

  

## 面试要点总结

  

1. **为什么需要长度前缀帧？**

   TCP 是字节流，不是消息流。长度前缀是解决粘包问题的最简单可靠方案。

  

2. **Godot 的 Signal 和 Go 的 channel 有什么共同点？**

   都实现了"生产者不知道消费者"的解耦。区别：channel 是同步阻塞的，Signal 是异步回调的。

  

3. **为什么客户端不能计算自己的 HP/手牌？**

   服务端权威原则（Server Authority）：客户端只渲染服务端告诉它的状态。

   如果客户端自己计算，作弊者只需修改本地计算逻辑即可。

  

4. **重连 token 为什么有 3 分钟有效期而不是永久？**

   安全考虑：如果 token 永不过期，攻击者获取到一个 token 就可以永远冒充该玩家。

   3 分钟足够覆盖正常网络抖动，同时限制了 token 泄露的影响范围。