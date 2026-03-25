# Phase 6 学习笔记：场地效果系统

  

## 本阶段完成了什么

  

- `internal/game/field/effect.go` — 8 种场地效果的数据定义与随机抽取

- `internal/game/card/synthesis.go` — 新增 `IllusionBonus`、`AllowSameType` 选项

- `internal/game/state.go` — `FieldEffectName string` 升级为 `FieldEffect *field.FieldEffect`

- `internal/game/engine.go` — `runFieldDraw` 实装，战斗/清场/补牌阶段接入效果逻辑

- `internal/protocol/messages.go` — `PhaseChangeEv` 新增 `FieldEffect` 字段

  

---

  

## 8 种场地效果总览

  

| ID | 名称 | 影响 |

|----|------|------|

| `clear` | 空旷之地 | 无效果（基准回合） |

| `illusion_real` | 虚幻之境·实 | 虚幻牌合成上限从 5 → 7 |

| `illusion_void` | 虚幻之境·虚 | 本回合补入的牌对对手隐藏 |

| `reinc_base` | 轮回之境·实 | 轮回牌参与合成时结果 = 轮回牌点数 |

| `reinc_other` | 轮回之境·虚 | 轮回牌参与合成时结果 = 另一张牌点数 |

| `chaos` | 混沌之域 | 允许同功能牌型合成 |

| `echo` | 回响之地 | 攻击伤害 +1 |

| `protect` | 守护之光 | 濒死扣血 30 → 15 |

  

---

  

## 核心设计决策

  

### 1. 为什么场地效果是"纯数据"，行为由 engine 解释？

  

```go

// field/effect.go — 纯数据，零行为

type FieldEffect struct {

    IllusionBonus  bool

    AllowSameType  bool

    BonusAttack    int

    NearDeathDrain int

    ...

}

  

// engine.go — 解释并执行

func (e *Engine) runCombat() {

    bonus := 0

    if e.state.FieldEffect != nil {

        bonus = e.state.FieldEffect.BonusAttack

    }

    ...

}

```

  

**为什么不直接在 `FieldEffect` 上写 `ApplyToCombat(state)` 方法？**

  

- `FieldEffect` 方法里就需要 import `GameState`，而 `GameState` 在 `game` 包——形成循环依赖

- 更重要：行为散落在数据里，追踪"哪里修改了战斗"变得困难；集中在 engine 里，一处查找即可

- 数据 / 行为分离是游戏服务器常用模式（ECS 架构的思想来源之一）

  

### 2. `field.ReincarnHint` 和 `card.ReincarnationRule` 的镜像设计

  

`field` 包如果直接 import `card` 包会怎样？没有循环，因为 `card` 不 import `field`。

但这产生了不必要的依赖——`field` 包变成了 `card` 包的"知情者"，未来重构 `card` 时 `field` 也要跟着改。

  

选择：在 `field` 包定义独立的 `ReincarnHint` 枚举，在 `engine.go` 做转换：

  

```go

// engine.go — 转换点只有一处

switch fe.ReincarnRule {

case field.ReincAsBase:

    opts.ReincarnationRule = card.ReincarnationAsBase

case field.ReincAsOther:

    opts.ReincarnationRule = card.ReincarnationAsOther

}

```

  

这个模式叫**防腐层（Anti-Corruption Layer）**，常见于领域驱动设计（DDD）：

在不同包/层之间保持类型独立，翻译由"协调层"（engine）完成。

  

### 3. `fieldSynthOpts()` — 将场地效果翻译为合成选项

  

```go

func (e *Engine) fieldSynthOpts() card.SynthesisOpts {

    opts := card.DefaultOpts()

    fe := e.state.FieldEffect

    if fe == nil {

        return opts

    }

    opts.IllusionBonus = fe.IllusionBonus

    opts.AllowSameType = fe.AllowSameType

    // ReincarnHint → card.ReincarnationRule

    ...

    return opts

}

```

  

`handleSynthesize` 现在只需一行 `opts := e.fieldSynthOpts()`，不感知任何具体场地效果——

**场地效果的"存在感"被收敛到这一个转换函数里**。

  

### 4. `IllusionBonus` 的"条件性上限"

  

```go

// card/synthesis.go

cap := opts.PointsCap

if opts.IllusionBonus && base.SubFaction == SubIllusion {

    cap = MaxPointsWithField  // 7

}

```

  

为什么不是"激活就全局上限 7"？因为游戏设计意图是"给虚幻策略的玩家奖励"，

不应惠及重组牌或轮回牌。**结合牌的属性判断上限**，让同一个 opts 在不同输入下有不同行为——

仍然是纯函数，便于单元测试。

  

### 5. `HideDrawnCards` — 虚幻之境·虚的实现

  

```go

// engine.go runDraw()

if e.state.FieldEffect != nil && e.state.FieldEffect.HideDrawnCards {

    for _, p := range e.state.Players {

        for _, sc := range p.Hand.HandSlottedCards() {

            sc.Card.IsHidden = true

        }

    }

}

```

  

补牌完成后统一标记 `IsHidden = true`。这影响的是后续 `BuildView` 中的对手视图：

（虽然当前 `OpponentView` 不包含手牌内容，IsHidden 为未来"窥牌技能"等机制预留了钩子。）

  

`buildSelfView` 永远显示真实点数（自己总能看到自己的牌），这是**服务端权威**的体现：

服务端决定哪些信息对哪个玩家可见，客户端只渲染服务端告诉它的内容。

  

---

  

## 每个回合的场地效果生命周期

  

```

回合开始

  └─ runFieldDraw()  ← 随机从 Pool 抽取，写入 state.FieldEffect

        └─ broadcastPhaseChange()  ← 告知客户端本回合效果名称

  

补牌阶段

  └─ runDraw()  ← 若 HideDrawnCards，标记新牌 IsHidden=true

  

行动阶段

  └─ handleSynthesize()  ← fieldSynthOpts() 注入当前效果

  

交战阶段

  └─ runCombat()  ← bonus = FieldEffect.BonusAttack

  

清场阶段

  └─ runCleanup()  ← drain = FieldEffect.ActualNearDeathDrain()

  

[下回合开始]

  └─ runFieldDraw()  ← 覆盖 state.FieldEffect（上一效果自动失效）

```

  

场地效果**不需要"清除"逻辑**——因为每回合开头直接覆盖，旧效果自动失效。

这是利用状态覆盖替代显式清理的简洁设计。

  

---

  

## 随机数独立性

  

```go

// engine.go

type Engine struct {

    rng *rand.Rand  // 每个引擎独立的随机数源

}

  

func NewEngine(r *room.Room) *Engine {

    return &Engine{

        rng: rand.New(rand.NewSource(time.Now().UnixNano())),

        ...

    }

}

```

  

**为什么不用 `math/rand` 的全局函数（`rand.Intn`）？**

  

- 全局 `rand` 是全局共享的——多个房间并发时，一个房间的 Draw 调用会影响另一个房间的随机序列

- 用独立的 `*rand.Rand` 实例，每个引擎的随机序列完全隔离

- 如果要实现"对局回放"（replaying a game），只需记录 seed，用相同 seed 重建引擎即可

  

---

  

## 面试要点总结

  

1. **场地效果如何影响合成？**

   通过 `fieldSynthOpts()` 将 `FieldEffect` 转换为 `card.SynthesisOpts`，

   `Combine(base, ingredient, opts)` 是纯函数，相同输入+相同opts=相同输出，便于测试。

  

2. **为什么 field 包不直接 import card 包？**

   防腐层模式：保持包间类型独立，翻译由协调层（engine）完成，降低耦合。

  

3. **场地效果怎么"清除"？**

   不需要显式清除——每回合开头 `runFieldDraw()` 直接覆盖 `state.FieldEffect`，旧效果自然失效。

  

4. **如何保证多房间随机独立？**

   每个 Engine 持有独立的 `*rand.Rand`，用 `time.Now().UnixNano()` 作为种子，避免全局状态共享。