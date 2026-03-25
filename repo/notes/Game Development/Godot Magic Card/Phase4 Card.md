# Phase 4 学习笔记：卡牌系统与手牌区

  

## 这一阶段做了什么

  

从"两个玩家进入房间"推进到了"这局游戏用什么牌、牌怎么管理"。

  

新增 `internal/game/card/` 包，包含四个文件：

  

```

card.go        — 牌的数据模型（SubFaction, CardType, Card 结构体）

deck.go        — 无限随机牌堆

synthesis.go   — 合成算法（同系乘/异系加/场地效果修正）

hand.go        — 手牌区 8 槽 + 合成区 4 槽的完整管理

```

  

---

  

## 核心概念 1：正交属性设计

  

每张牌同时具有两个**独立**的属性：

  

```

           攻击    技能    能耗

梦境    |  梦境攻 | 梦境技 | 梦境耗

虚幻    |  虚幻攻 | 虚幻技 | 虚幻耗

重组    |  重组攻 | 重组技 | 重组耗

轮回    |  轮回攻 | 轮回技 | 轮回耗

```

  

4 子系 × 3 功能 = 12 种牌型组合。

  

**正交性**的价值：

- 合成规则只看"大系是否相同"→ 乘或加

- 合成限制只看"功能牌型是否相同"→ 禁止

- 场地效果只针对特定子系（轮回之境只影响轮回牌，虚幻之境只影响虚幻牌）

- 角色技能可以指定"攻击牌"而不管它是什么系

  

这就是面向对象里"开放封闭原则"的体现：

新增角色技能只需用现有的 SubFaction 和 CardType 过滤，不需要改卡牌数据结构。

  

---

  

## 核心概念 2：为什么 Card 是值类型（struct），但 HandZone 用 *Card 存储？

  

```go

// Card 是值类型

type Card struct { ... }

  

// HandZone 内部用指针存储

type HandZone struct {

    hand  [8]*Card  // nil = 空槽

    synth [4]*Card

}

```

  

**Card 是值类型**：

- 合成操作 `Combine(base, ingredient)` 产生一张**新**牌，不修改原有两张

- 值语义让"合成不改变原牌"在类型系统层面就保证了，不需要注释说明

  

**HandZone 用 *Card 存储**：

- `nil` 自然表示"空槽"，无需额外的"isOccupied"标志位

- 如果用值类型 `[8]Card`，空槽的 Points=0 会被误当作有效的 0 点牌

  

**规律**：

- 用指针（`*T`）当值"存不存在"语义很重要时（空槽、可选字段）

- 用值（`T`）当数据是"不可变的快照"或"操作产生新值"时

  

---

  

## 核心概念 3：合成算法的纯函数设计

  

```go

func Combine(base, ingredient *Card, opts SynthesisOpts) (*Card, error)

```

  

这是一个**纯函数**（Pure Function）：

- 输入：两张牌 + 合成选项

- 输出：新的结果牌（或错误）

- **没有副作用**：不修改任何外部状态

  

为什么要这样设计？

1. **可测试**：`Combine(梦境攻3, 重组技2, DefaultOpts())` 必然返回 `梦境攻5` → 直接写断言

2. **场地效果解耦**：把"当前是什么场地"打包进 `SynthesisOpts` 传进来，

   不用全局变量，不用依赖注入，函数本身不知道游戏上下文

3. **可回放**：给定相同的牌和 opts，结果必定一致，支持日志回放和调试

  

**对比"不纯"的版本**（反面教材）：

```go

// ❌ 坏设计：依赖全局状态，无法独立测试

func Combine(base, ingredient *Card) *Card {

    if globalGame.CurrentFieldEffect == FieldEffectIllusionReal {

        // ...

    }

}

```

  

---

  

## 核心概念 4：合成操作的原子性回滚

  

```go

func (h *HandZone) SynthesizeCards(...) (*Card, error) {

    base, err := h.takeFromZone(zone1, slot1)

    // ...

  

    ingredient, err := h.takeFromZone(zone2, slot2)

    if err != nil {

        h.putBackToZone(zone1, slot1, base) // ← 回滚 base

        return nil, err

    }

  

    result, err := Combine(base, ingredient, opts)

    if err != nil {

        h.putBackToZone(zone1, slot1, base)      // ← 回滚两张

        h.putBackToZone(zone2, slot2, ingredient)

        return nil, err

    }

    // ...

}

```

  

这是**数据库事务**思想在游戏逻辑中的应用：

- 要么完全成功（两张牌消失，结果进合成区）

- 要么完全失败（所有牌回到原位，玩家看到错误信息）

- **绝不**出现"base 取出来了但 ingredient 取失败，base 凭空消失"的情况

  

面试常问：**如何保证操作的原子性？**

- 数据库：事务（BEGIN / COMMIT / ROLLBACK）

- 游戏逻辑：先"取出"再"验证再放回"的回滚模式

- 分布式系统：Saga 模式或两阶段提交

  

---

  

## 核心概念 5：槽位设计的两层含义

  

手牌区的 8 个槽位有两种区分：

  

```

槽位 1-4（安全区）：阶段结束后保留

槽位 5-8（弃牌区）：清场阶段强制清除

```

  

实现上这只是同一个 `[8]*Card` 数组的两段：

```go

// ClearDiscardZone 只清 index 4-7（槽位 5-8）

for i := SafeZoneSize; i < HandZoneSize; i++ {

    h.hand[i] = nil

}

```

  

这个设计有一个有趣的含义：

**玩家放牌时选择哪个槽位，决定了这张牌能不能跨阶段留存。**

这本身是游戏的一个策略决策点。

  

---

  

## 合成算法速查表

  

| base 子系 | ingredient 子系 | 场地效果 | 公式 |

|-----------|----------------|---------|------|

| 梦境(3) | 虚幻(2) | 无 | 同梦幻系 → 3×2=6，cap 5 |

| 梦境(3) | 重组(2) | 无 | 异大系 → 3+2=5 |

| 轮回(4) | 梦境(3) | 轮回之境·实 | 结果=轮回牌点数 → 4 |

| 轮回(4) | 梦境(3) | 轮回之境·虚 | 结果=非轮回点数 → 3 |

| 虚幻(3) | 重组(2) | 虚幻之境·实 | 异大系 → 3+2=5，若虚幻结果 cap 可升至 7 |

  

**注意**：虚幻之境·实只对"本阶段新抽到的虚幻牌"生效，且 cap=7 是针对该牌本身（Phase 6 场地效果实现时细化）。

  

---

  

## 下一步：Phase 5 游戏阶段状态机

  

有了牌的数据层，Phase 5 要把它们"运行起来"：

  

1. `PlayerState` — 玩家游戏内状态（HP、能量、HandZone）

2. `GameState` — 一局游戏的完整快照

3. 阶段状态机（场地抽取→补牌→行动→交战结算→清场）

4. 玩家行动的合法性验证（非行动阶段不能出牌、只能在自己回合行动等）

5. 将 GameState 转换为 protocol.GameStateView 发送给客户端

  

这一阶段之后，游戏才真正"转起来"——两个玩家能通过 Godot 看到自己的手牌，并互相出牌。