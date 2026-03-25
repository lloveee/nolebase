# Phase 7 学习笔记：角色系统

  

## 本阶段完成了什么

  

- `internal/game/character/def.go` — 类型体系：SkillTier, SkillResult, PassiveTraits, CharDef, Registry

- `internal/game/character/chars.go` — 6 个角色定义（力裁者/镜换者/空手者/噬渊者/灼血者/殉道者）

- `internal/game/character/instance.go` — 运行时实例：UseSkill / TriggerLiberation / 被动钩子

- `internal/game/card/hand.go` — 新增 `DrawIntoHand(deck, n)` 方法（技能抽牌效果）

- `internal/game/state.go` — PlayerState 新增 `Char *character.CharInstance`

- `internal/game/engine.go` — 实装 handleUseSkill / handleTriggerLiberate / applySkillResult，被动集成

  

---

  

## 6 个角色总览

  

| 角色 | HP | 解放门槛 | 被动 | 特点 |

|------|-----|---------|------|------|

| 力裁者 (licai) | 100 | 80 | 攻击+1 | 直接伤害型，解放爆发高 |

| 镜换者 (jinghuan) | 90 | 80 | 受伤-1 | 防守反击，摸牌+技能 |

| 空手者 (kongshou) | 95 | 60 | 无 | 能量积攒流，低门槛解放 |

| 噬渊者 (shiyuan) | 95 | 80 | 无 | 每次技能都汲取生命 |

| 灼血者 (zhuoxue) | 85 | 80 | 攻击+2 | 最高攻击加成，最低 HP |

| 殉道者 (xundao) | 110 | — | 拦截二次死亡 | 被动自动触发解放 |

  

---

  

## 核心架构：数据与行为分离

  

### 为什么 CharDef 是纯数据？

  

```

internal/game/character/   ← 不 import game 包

    CharDef { ... }        ← 纯数据

    SkillResult { ... }    ← 纯数据

  

internal/game/engine.go    ← import character 包

    applySkillResult(seat, *SkillResult)  ← 行为在这里

```

  

如果在 `CharDef` 上写 `ApplyToCombat(state *GameState)` 方法，character 包就需要 import game 包，而 game 包已经 import character 包——**循环依赖**。

  

**解决方案**：角色只"描述效果"，engine 负责"执行效果"。

这是游戏服务器里的标准模式，和 Phase 6 场地效果的处理方式完全一致。

  

### `SkillResult` 的扁平结构

  

```go

type SkillResult struct {

    Tier             SkillTier

    DealDirectDamage int  // 直接伤害

    HealSelf         int  // 自身回血

    GainEnergy       int  // 获得能量

    DrawCards        int  // 抽牌数

    Desc             string

}

```

  

用扁平字段而不是 `[]Effect` 接口切片，原因：

- 零值即"无此效果"，不需要 nil 检查

- Engine 里用 `if result.HealSelf > 0 { ... }` 清晰表达"有此效果才执行"

- 对于只有 4-5 种效果类型的游戏，这比 interface 反射更直接

  

> 如果效果类型增长到 20+，才值得考虑接口/策略模式。"简单够用"优先。

  

---

  

## 技能牌点数决定档位

  

```

客户端 UseSkillReq{SkillCardSlot: 3}

    ↓

engine.handleUseSkill() 取出槽位3的牌

    ↓

c.CardType == TypeSkill（验证）

    ↓

c.Points ≤ 2 → TierNormal → Normal SkillDef

c.Points ≥ 3 → TierEnhanced → Enhanced SkillDef

    ↓

检查能量 >= EnergyCost → 扣能量 → 技能牌消耗

    ↓

applySkillResult(seat, result)

```

  

**为什么用牌的点数决定档位，而不是让玩家指定？**

  

这是游戏设计的精妙之处：

- 你想要强化技能，就需要先**合成**出高点数的技能牌

- 这意味着合成行动和技能使用之间有策略取舍

- 服务端是权威——不相信客户端传来的"我要用2级技能"，而是看牌的实际点数

  

---

  

## 殉道者：自动解放的特殊机制

  

殉道者的 `ManualLib = false`，它不用 `TriggerLibrateReq`，而是在 `handleHPZero` 里触发：

  

```go

// engine.go handleHPZero()

} else {

    // 二次归零：检查殉道者被动拦截

    if p.Char != nil && p.Char.InterceptSecondDeath() {

        p.HP = 60

        // 广播 LiberationEv，应用解放效果

        e.applySkillResult(seat, &p.Char.Def.Lib.Result)

        p.CharRevealed = true

    } else {

        p.HP = 0

        e.triggerDeath(seat)

    }

}

```

  

`InterceptSecondDeath()` 内部：

```go

func (ci *CharInstance) InterceptSecondDeath() bool {

    if !ci.Def.Passive.InterceptNearDeath { return false }

    if ci.InterceptUsed { return false }  // 每局只能用一次

    ci.InterceptUsed = true

    ci.LibUsed = true  // 自动解放，标记已用

    return true

}

```

  

**关键设计**：拦截逻辑在 `CharInstance` 里，状态管理（是否已用）也在里面。

Engine 只需调用一个方法并检查返回值——不需要知道"殉道者"的具体实现。

  

---

  

## applySkillResult：统一入口

  

```go

func (e *Engine) applySkillResult(seat int, result *character.SkillResult) {

    p  := e.state.Players[seat]

    opp := e.state.Players[1-seat]

  

    if result.HealSelf > 0   { p.HP = min(p.HP+result.HealSelf, p.MaxHP) }

    if result.GainEnergy > 0 { p.Energy = min(p.Energy+result.GainEnergy, p.MaxEnergy) }

    if result.DrawCards > 0  { p.Hand.DrawIntoHand(p.Deck, result.DrawCards) }

    if result.DealDirectDamage > 0 {

        // 直接伤害仍然经过受击方被动减免

        dmg := opp.Char.ModifyIncoming(result.DealDirectDamage)

        opp.HP -= dmg

        // 广播 DamageEv

        if opp.HP <= 0 { e.handleHPZero(1-seat) }

    }

}

```

  

所有技能和解放技能都走这一个函数。好处：

1. **一处修改，所有技能受益**：以后加"技能伤害格挡"只改这一个函数

2. **可测试性高**：单独测 applySkillResult，不需要模拟网络连接

  

---

  

## 被动钩子的两个位置

  

被动效果在两处注入：

  

**攻击方加成（BonusOutgoing）** → `runCombat` 里，在 `applyDamage` 之前：

```go

if p0.Char != nil { atk0 = p0.Char.ModifyOutgoing(atk0) }

if p1.Char != nil { atk1 = p1.Char.ModifyOutgoing(atk1) }

```

  

**受击方减免（IncomingReduction）** → `applyDamage` 里，伤害发生时：

```go

if p.Char != nil { finalDamage = p.Char.ModifyIncoming(finalDamage) }

```

  

**为什么分两处而不合并？**

  

攻击方加成：在计算"发出多少伤害"时应用，自然属于战斗阶段

受击方减免：在"受到多少伤害"时应用，每次伤害都要经过（包括技能直接伤害）

  

把减免放在 `applyDamage` 里保证了"**任何伤害来源都能被减免**"——无论是攻击牌、技能直接伤害还是濒死扣血，都经过同一个点。

  

---

  

## 角色公开：服务端权威原则

  

使用技能后 `CharRevealed = true`，对手才能看到你的角色身份。

BuildView 已经实现这个逻辑（`buildOpponentView` 中 `CharRevealed` 控制显示 "???" 还是真实名称）。

  

广播 `SkillUsedEv` 时携带 `Character` 字段——客户端不需要等待下一个 GameState 推送，

直接在 SkillUsedEv 里就能知道对手角色并更新 UI。

  

这是游戏服务器里的**事件驱动 UI 更新**模式：

- 完整状态快照（GameStateEv）：用于首次加载和重连

- 增量事件（SkillUsedEv, DamageEv, PhaseChangeEv）：用于实时动画/交互

  

---

  

## 面试要点总结

  

1. **角色包为什么不 import game 包？**

   避免循环依赖。CharDef 是纯数据，Engine 是数据的解释器（执行者）。

  

2. **技能档位怎么决定？**

   不是客户端声明，而是服务端读取技能牌的实际点数（点数≤2普通，≥3强化）。服务端权威原则。

  

3. **殉道者的自动解放为什么放在 CharInstance 而不是 Engine？**

   状态（是否已触发）属于角色的生命周期，不属于游戏流程。Engine 只问"能不能拦截"，具体条件判断由角色自己管理。

  

4. **applySkillResult 为什么是统一入口？**

   单一职责：所有技能效果在一处执行，便于添加全局修改（格挡、反弹等），不需要修改每个技能处理函数。