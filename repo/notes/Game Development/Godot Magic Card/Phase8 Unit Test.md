# Phase 8 学习笔记：赐福系统与单元测试

  

## 本阶段完成了什么

  

- `protocol/msgid.go` — 新增 `MsgBlessingEv (5008)`

- `protocol/messages.go` — 新增 `BlessingEv` 结构体

- `engine.go` — 赐福系统完整实装（`assignBlessingChar`、叠加被动、广播事件）

- `engine.go` — 修复 TypeSkill 的 PlayCardReq 处理（正确放回原槽，不放合成区）

- `internal/game/card/synthesis_test.go` — 12 个表驱动单元测试，全部通过

  

---

  

## 赐福系统设计

  

### 触发条件与流程

  

```

runCleanup() 阶段，对每个玩家检查：

    HP < 40 && !BlessingUsed

        ↓

    assignBlessingChar(seat)  ← 随机选一个非主角色

        ↓

    p.SecondChar = inst

        ↓

    Broadcast(MsgBlessingEv, ...)

```

  

触发后 `BlessingUsed = true`，每局只触发一次（在 cleanup 末尾检查，而不是伤害时刻，避免一轮内多次触发）。

  

### 叠加被动的实现

  

```go

// applyOutgoing: 主角色 + 赐福角色的攻击加成叠加

func (e *Engine) applyOutgoing(p *PlayerState, dmg int) int {

    if p.Char != nil      { dmg = p.Char.ModifyOutgoing(dmg) }

    if p.SecondChar != nil { dmg = p.SecondChar.ModifyOutgoing(dmg) }

    return dmg

}

  

// applyDamage: 受击减免也叠加

if p.Char != nil      { finalDamage = p.Char.ModifyIncoming(finalDamage) }

if p.SecondChar != nil { finalDamage = p.SecondChar.ModifyIncoming(finalDamage) }

```

  

**为什么两个被动都叠加而不是取最大值？**

  

游戏设计意图：赐福是一个奖励机制（在 HP 低时给额外角色），叠加两套被动是对坚持到低血量的奖励。

从代码角度：`ModifyOutgoing(ModifyOutgoing(dmg))` 是自然的链式调用，不需要特殊逻辑。

  

### 为什么在 cleanup 而不是伤害结算时触发

  

```go

// runCleanup 末尾：

if p.HP < 40 && !p.BlessingUsed {

    p.BlessingUsed = true

    // 分配第二角色...

}

```

  

如果在 `applyDamage` 里触发，一次多段伤害（如同时收到攻击和濒死扣血）可能触发多次。

在 cleanup 统一检查，确保每轮最多触发一次。

  

---

  

## Go 单元测试：表驱动模式

  

### 为什么 `Combine` 最适合写单元测试？

  

```go

// 纯函数：相同输入 → 相同输出，零副作用

func Combine(base, ingredient *Card, opts SynthesisOpts) (*Card, error)

```

  

纯函数是单元测试的理想目标：

- 不需要 mock 任何依赖

- 不依赖时间、网络、数据库

- 测试代码与测试逻辑1:1对应

  

### 表驱动测试的标准写法

  

```go

func TestCombine_SameMajor_Multiplies(t *testing.T) {

    cases := []struct {

        name string

        base *card.Card

        ingr *card.Card

        want int

    }{

        {"梦境2×梦境3=6截断到5", atk(SubDream, 2), skl(SubDream, 3), 5},

        {"梦境2×梦境2=4",        atk(SubDream, 2), skl(SubDream, 2), 4},

    }

    for _, tc := range cases {

        tc := tc  // ← 重要：闭包捕获副本（Go 1.22 之前必须）

        t.Run(tc.name, func(t *testing.T) {

            result, err := card.Combine(tc.base, tc.ingr, card.DefaultOpts())

            if err != nil { t.Fatalf(...) }

            if result.Points != tc.want { t.Errorf(...) }

        })

    }

}

```

  

**`tc := tc` 这行为什么必要（Go 1.22 前）？**

  

`for _, tc := range cases` 里 `tc` 是循环变量，它的地址在整个循环中不变。

如果直接在 `t.Run` 的闭包里捕获 `tc`，所有子测试共享同一个 `tc`——循环结束后所有闭包读到的都是最后一个 `tc`。

`tc := tc` 在每次循环体内创建一个新的局部变量，让闭包各自捕获独立的副本。

  

Go 1.22 修复了这个行为（循环变量每次迭代创建新绑定），但显式写出更清晰。

  

### 测试 sentinel error

  

```go

// errors.Is 而不是 == 比较

if !errors.Is(err, card.ErrSameCardType) {

    t.Errorf("want ErrSameCardType, got %v", err)

}

```

  

`errors.Is` 能正确处理错误包装（`fmt.Errorf("...: %w", err)`）。

直接用 `err == ErrSameCardType` 在错误被包装后会失效。

  

### 辅助工厂函数

  

```go

// 减少测试代码噪音

func atk(sf card.SubFaction, pts int) *card.Card { return card.New(sf, card.TypeAttack, pts) }

func skl(sf card.SubFaction, pts int) *card.Card { return card.New(sf, card.TypeSkill, pts) }

func eng(sf card.SubFaction, pts int) *card.Card { return card.New(sf, card.TypeEnergy, pts) }

```

  

测试文件里的私有辅助函数让测试用例更可读：

```go

// 不用辅助：

card.New(card.SubDream, card.TypeAttack, 2), card.New(card.SubDream, card.TypeSkill, 3)

// 用辅助：

atk(SubDream, 2), skl(SubDream, 3)

```

  

---

  

## 运行测试

  

```bash

# 运行 card 包所有测试，显示详情

go test ./internal/game/card/... -v

  

# 运行全项目所有测试

go test ./...

  

# 带覆盖率报告

go test ./internal/game/card/... -cover

```

  

---

  

## 赐福后的战斗数值示例

  

假设 Seat0 = 力裁者（BonusOutgoing=1），赐福后获得灼血者（BonusOutgoing=2）：

  

```

攻击牌点数 3

→ applyOutgoing: 3 + 1(力裁者) + 2(灼血者) = 6

→ 场地效果 echo +1 (如果有) = 7

→ applyDamage(opponent, 7)

```

  

这展示了被动叠加的乘法效应——游戏平衡性问题，但架构层面是正确的。

  

---

  

## 面试要点总结

  

1. **为什么纯函数最适合单元测试？**

   零依赖，零副作用。`Combine(a, b, opts)` 就是测试单元测试的教科书案例。

  

2. **`errors.Is` vs `==` 的区别？**

   `errors.Is` 支持错误包装链，`==` 只比较顶层。生产代码应始终用 `errors.Is`。

  

3. **表驱动测试的好处？**

   新增测试用例只需加一行 struct，不需要复制整个测试函数。失败时报告会显示 `tc.name`，精确定位哪个 case 失败。

  

4. **`tc := tc` 为什么需要？**

   避免 Go 循环变量被闭包捕获的经典陷阱。Go 1.22 修复了此问题，但理解原理仍是面试常考点。