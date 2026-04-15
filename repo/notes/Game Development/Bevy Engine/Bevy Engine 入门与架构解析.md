# Bevy Engine 入门与架构解析

> Bevy 是一个用 Rust 编写的轻量级、数据驱动的开源游戏引擎，基于 ECS（Entity Component System）架构模式。本笔记涵盖 Bevy 的核心概念、ECS 内部原理、应用构建最佳实践，以及关键参考资料。
>
> **版本**: Bevy 0.18+ | **官方文档**: [bevyengine.org](https://bevyengine.org) | **源码**: [github.com/bevyengine/bevy](https://github.com/bevyengine/bevy)

---

## 目录

- [1. Bevy 概述与设计理念](#1-bevy-概述与设计理念)
- [2. ECS 核心概念](#2-ecs-核心概念)
- [3. Bevy ECS 内部原理（源码级解析）](#3-bevy-ecs-内部原理源码级解析)
- [4. 系统与调度器（深入）](#4-系统与调度器深入)
- [5. 资源 (Resources)](#5-资源-resources)
- [6. 命令队列 (Commands)](#6-命令队列-commands)
- [7. 变化检测 (Change Detection)](#7-变化检测-change-detection)
- [8. 应用生命周期与调度阶段](#8-应用生命周期与调度阶段)
- [9. 插件系统](#9-插件系统)
- [10. 渲染架构](#10-渲染架构)
- [11. 状态机 (bevy_state)](#11-状态机-bevy_state)
- [12. 反射与动态 ECS (bevy_reflect)](#12-反射与动态-ecs-bevy_reflect)
- [13. 快速上手：最小应用](#13-快速上手最小应用)
- [14. 最佳实践与设计模式](#14-最佳实践与设计模式)
- [15. 性能优化](#15-性能优化)
- [16. 常见陷阱与错误规避](#16-常见陷阱与错误规避)
- [17. 0.14+ 版本迁移指南](#17-014-版本迁移指南)
- [18. 实践项目参考](#18-实践项目参考)
- [19. 命名规范与代码组织](#19-命名规范与代码组织)
- [20. 参考资料](#20-参考资料)

---

## 1. Bevy 概述与设计理念

Bevy 是一个**数据驱动**的游戏引擎，所有游戏逻辑都通过 ECS 模式实现。与 Unity/Godot 等引擎不同，Bevy 不使用传统的 OOP 模式，而是将数据和行为完全分离。

### 核心设计目标

| 目标 | 含义 |
|------|------|
| **Capable** | 提供完整的 2D/3D 功能集 |
| **Simple** | 对新手友好，对高级用户无限灵活 |
| **Data Focused** | ECS 范式，数据与行为彻底分离 |
| **Modular** | 按需使用，可替换不喜欢的部分 |
| **Fast** | 应用逻辑快速执行，尽可能并行 |
| **Productive** | 快速编译，频繁迭代 |

### Bevy 的独特之处

- **完全自举**: ECS、渲染器、UI 等核心系统全部用 Rust 从零实现
- **零成本抽象**: 利用 Rust 类型系统，系统参数类型自动推断数据访问需求
- **活跃的开发**: 每 3 个月发布一次大版本，持续演进
- **完全开源**: MIT/Apache 2.0，双许可证，无商业限制

### 代码组织结构

Bevy 源码按功能拆分为多个 crate（部分列表）：

```
bevyengine/bevy
├── bevy_ecs          # ECS 核心实现（可独立使用）
├── bevy_app          # App 与插件框架
├── bevy_render       # 渲染管线
├── bevy_window       # 窗口管理
├── bevy_asset        # 资源管理
├── bevy_scene        # 场景系统
├── bevy_input        # 输入处理
├── bevy_ui           # UI 系统
├── bevy_text         # 文本渲染
├── bevy_audio        # 音频播放
├── bevy_gltf         # GLTF 模型加载
├── bevy_pbr          # PBR 渲染
├── bevy_sprite       # 2D 精灵渲染
├── bevy_animation    # 动画系统
├── bevy_transform    # 变换系统
├── bevy_state        # 状态机
├── bevy_reflect      # 运行时反射
├── bevy_time         # 时间管理
├── bevy_tasks        # 多线程任务池
└── bevy_diagnostic   # 诊断工具
```

---

## 2. ECS 核心概念

ECS 将程序分解为三个核心概念：**Entity（实体）**、**Component（组件）**、**System（系统）**。

### 2.1 Entity（实体）

Entity 是一个**唯一的 ID**（`Entity(u32, u32)`，包含 index 和 generation），本身不存储任何数据，也不包含任何行为。它只是一个"标识符"，用来将一组 Component 组合在一起。

```rust
use bevy_ecs::prelude::*;

let mut world = World::new();

// spawn 返回 EntityCommands，可以链式添加组件
let entity = world.spawn(
    (Position { x: 0.0, y: 0.0 }, Velocity { x: 1.0, y: 0.0 })
).id();

// 通过 Entity 获取引用
let entity_ref = world.entity(entity);
let pos = entity_ref.get::<Position>().unwrap();
```

### 2.2 Component（组件）

Component 是**纯数据**——普通的 Rust struct，不包含任何行为方法。只要实现 `Component` trait，就是一个 Bevy 组件。

```rust
use bevy_ecs::prelude::*;

// 普通组件
#[derive(Component)]
struct Position {
    x: f32,
    y: f32,
}

// 元组组件（适合简单数据）
#[derive(Component)]
struct Velocity(f32);  // x 分量

#[derive(Component)]
struct Velocity(f32, f32);  // x, y 分量

// 派生 Default
#[derive(Component, Default)]
struct Health {
    current: f32,
    max: f32,
}
```

### 2.3 System（系统）

System 是**普通的 Rust 函数**，每个 frame 执行一次，负责读写组件数据并实现游戏逻辑。Bevy 根据系统参数类型自动推断需要访问哪些组件。

```rust
use bevy_ecs::prelude::*;

// 最简单的系统：只读
fn print_positions(query: Query<&Position>) {
    for position in &query {
        println!("x={}, y={}", position.x, position.y);
    }
}

// 读写组件
fn move_players(
    time: Res<Time>,
    mut query: Query<(&Velocity, &mut Position)>,
) {
    for (velocity, mut pos) in &mut query {
        pos.x += velocity.x * time.delta_seconds();
        pos.y += velocity.y * time.delta_seconds();
    }
}
```

### 2.4 World（世界）

World 是存放所有 Entities、Components 和 Resources 的容器。所有数据最终都存储在 World 中。

```rust
use bevy_ecs::world::World;

let mut world = World::new();

// spawn 一个实体
let entity = world.spawn(Position { x: 0.0, y: 0.0 }).id();

// 查询
let position = world.entity(entity).get::<Position>().unwrap();

// 直接操作（不推荐在系统内使用）
world.insert(entity, Velocity(1.0, 0.0));
world.remove::<Velocity>(entity);
```

### 2.5 Query（查询）

Query 是 ECS 中最常用的工具，用于迭代具有特定组件组合的实体。

```rust
// 只读查询
fn sys1(query: Query<&Transform>) { ... }

// 读写查询
fn sys2(mut query: Query<&mut Transform>) { ... }

// 获取 Entity ID
fn sys3(query: Query<Entity>) { ... }

// 同时获取多个组件
fn sys4(query: Query<(&Velocity, &mut Position, &Health)>) { ... }

// 过滤器
fn sys5(query: Query<&Transform, With<Player>>) { ... }  // 只有 Player 的才处理
fn sys6(query: Query<&Transform, Without<Dead>>) { ... } // 排除 Dead 的
fn sys7(query: Query<&Transform, Or<(With<Player>, With<Enemy>)>>) { ... }

// 带过滤的变更检测
fn sys8(query: Query<&Transform, Changed<Player>>) { ... } // Player Transform 改变了的
```

---

## 3. Bevy ECS 内部原理（源码级解析）

> 本节深入 Bevy ECS 的存储实现，理解这些细节对于写出高性能代码至关重要。

### 3.1 整体存储架构

Bevy ECS 采用**Archetype（原型）+ Table（表）+ Chunk（数据块）** 三层存储结构：

```
World
 ├── Entities        # Entity → EntityLocation 映射表
 ├── Archetypes      # ArchetypeId → Archetype 映射
 │    └── Archetype
 │         ├── id: ArchetypeId
 │         ├── table_id: TableId
 │         ├── components: SmallVec<[ComponentId; 6]>
 │         └── chunks: Vec<Chunk>
 ├── ComponentStorages  # ComponentId → ComponentStorage
 │    ├── Table Storage  # 大多数组件
 │    └── Sparse Set     # 稀疏组件
 └── RemovedComponents  # 删除跟踪
```

### 3.2 Archetype（原型）

当一个 Entity 拥有一组特定的组件时，它属于一个 **Archetype**。Archetype 是 Bevy ECS 存储组织的核心单位。

```rust
// 简化后的 Archetype 结构（源码路径: crates/bevy_ecs/src/archetable.rs）
pub struct Archetype {
    pub(crate) id: ArchetypeId,
    pub(crate) table_id: TableId,
    pub(crate) components: SmallVec<[ComponentId; 6]>,  // 该 Archetype 包含的组件类型
    pub(crate) entities: Vec<Entity>,                      // 该 Archetype 中的实体
    pub(crate) edges: ArchetypeEdges,                      // 插入/删除时的跳转边
    // 实际存储在 Table 中，这里只做索引
}
```

**Archetype 的划分示例**：

```
Archetype A: [Position, Velocity, Sprite]     → entities: [E1, E5, E8]
Archetype B: [Position, Velocity]               → entities: [E3, E7]
Archetype C: [Position, Sprite, Health]        → entities: [E2]
Archetype D: [Position, UI]                    → entities: [E4]
```

**为什么这样设计**：

1. **缓存友好**: 同一 Archetype 的实体，所有组件数据在内存中连续存储
2. **查询高效**: 只需遍历匹配的 Archetype，而非所有实体
3. **插入代价**: 添加/删除组件会触发 Archetype 迁移（数据复制）

### 3.3 Table（表存储）

每个 Archetype 对应一个 Table，Table 以列为单位存储每种组件的数据：

```
Table for Archetype A [Position, Velocity, Sprite]

Column: Position
┌─────────────────────────────────────────────┐
│ Entity 1: Position { x=0.0, y=0.0 }         │
│ Entity 5: Position { x=1.0, y=2.0 }         │
│ Entity 8: Position { x=3.0, y=4.0 }         │
└─────────────────────────────────────────────┘

Column: Velocity
┌─────────────────────────────────────────────┐
│ Entity 1: Velocity { x=1.0, y=0.0 }         │
│ Entity 5: Velocity { x=0.5, y=1.0 }         │
│ Entity 8: Velocity { x=2.0, y=1.5 }         │
└─────────────────────────────────────────────┘
```

**Table 的优势**：

- 同一种组件的所有数据在内存中连续排列
- CPU 预取（prefetch）效果极佳
- SIMD 向量化操作友好

### 3.4 Chunk（数据块）

每个 Table 按固定大小（16KB）划分为多个 Chunk：

```rust
// 简化结构
pub struct Chunk {
    // 每个组件一列，列内数据连续
    components: Vec<NonNull<u8>>,  // 指针数组，每列一个
    entity_mask: u128,               // 该 Chunk 中哪些 slot 有实体
    len: u32,                        // 当前实体数量
}
```

**Chunk 大小的设计考量**：

- 16KB 正好是 L1 cache 的大小（或其倍数）
- 保证一次遍历就能把整个 Chunk 放入 cache
- 避免 cache miss 导致的性能损失

### 3.5 Sparse Set（稀疏集存储）

部分组件使用 Sparse Set 存储，适用于**实体 ID 与组件数据呈稀疏映射**的场景：

```rust
// 稀疏集示意图
Entity 0 ─┐
Entity 50 ─┼──► Vec<Entity> ──► 查找 Entity 50 → 数组下标 50 → O(1)
Entity 999─┘
```

**适用场景**：

- 绝大多数实体都没有的组件（如"稀有道具"）
- 需要频繁通过 Entity ID 随机访问的组件
- 组件经常被添加/删除（如 Buff/Debuff）

### 3.6 Entity 查找机制

Entity 的结构是 `(u32 index, u32 generation)`：

```rust
pub struct Entity {
    pub index: u32,      // 在 entities 数组中的索引
    pub generation: u32,  // 生命周期版本号
}
```

**EntityLocation** 存储实体的物理位置：

```rust
pub struct EntityLocation {
    pub archetype_id: ArchetypeId,  // 属于哪个 Archetype
    pub index: u32,                  // 在 Archetype.entities 中的索引
    pub table_row: u32,              // 在 Table 中的行号
}
```

**查找过程**：

```
Entity(E) → World.entities[E.index] → EntityLocation → Archetype[arch_id] → Table[table_row]
```

### 3.7 Bundle（捆绑）

Bundle 是一组同时添加的组件，用于减少 Archetype 碎片：

```rust
#[derive(Bundle)]
pub struct PlayerBundle {
    pub player: Player,
    pub health: Health,
    pub position: Position,
    pub velocity: Velocity,
    pub sprite: SpriteBundle,
}

// 使用
commands.spawn(PlayerBundle {
    player: Player,
    health: Health { current: 100.0, max: 100.0 },
    position: Position { x: 0.0, y: 0.0 },
    velocity: Velocity(0.0, 0.0),
    sprite: SpriteBundle::default(),
});
```

**Bundle 的意义**：始终一起使用的组件应该放在同一个 Bundle 中，这样只会产生一个 Archetype，而不是多个中间状态。

### 3.8 Archetype 迁移代价

当给 Entity 添加/删除组件时，可能需要迁移到新的 Archetype：

```rust
// 添加组件导致 Archetype 迁移
Entity(E) currently in Archetype A [Position, Velocity]
   │
   ├─► Insert Health
   │
   ▼
Archetype B [Position, Velocity, Health]  ← 数据需要复制到这里
   │
   ▼
Entity(E) now in Archetype B
```

**性能影响**：

- 小型组件（几个字节）：迁移成本可忽略
- 大型组件（Mesh, Texture）：迁移成本显著
- 频繁添加/删除大组件 = 性能瓶颈

**优化策略**：

```rust
// 策略1：预先设计好组件组合，避免运行时迁移
// 策略2：用 Option<T> 而非添加/删除来模拟"可选"组件
#[derive(Component)]
struct OptionalHealth(Option<Health>);  // 始终在 Archetype 中

// 策略3：对大组件使用 Sparse Set 存储
#[derive(Component)]
#[component(storage = "SparseSet")]
struct HeavyComponent(BigData);
```

---

## 4. 系统与调度器（深入）

### 4.1 Query 状态缓存

Query 在首次使用时会在 World 中缓存匹配的 Archetype 列表：

```rust
pub struct QueryState<Q: QueryData, F: QueryFilter = ()> {
    pub(crate) world_id: WorldId,
    pub(crate) matched_archetypes: ArchetypeIdMap<QueryArchetype>,
    pub(crate) fetch_state: Q::State,
    pub(crate) filter_state: F::State,
}
```

**工作原理**：

1. 第一次调用 `iter()` 时，扫描 World 中所有 Archetype
2. 筛选出组件匹配 Query 描述的 Archetype
3. 缓存结果，后续迭代直接使用
4. Archetype 变化（实体添加/删除组件）时自动失效

### 4.2 自动并行化原理

Bevy 的调度器分析系统声明的数据访问需求，构建**有向无环图（DAG）**，决定哪些系统可以并行执行：

```
System A (reads Position) ──┐
                           ├──► 不可并行（都写 Transform）
System B (writes Transform)─┘

System A (reads Position) ──┐
                           ├──► 可以并行（一个读 A，一个读 B）
System C (reads Position) ──┘

System A (reads Position) ──┐
                           ├──► 不可并行（都写 Velocity）
System B (writes Velocity) ──┘
```

**依赖分析通过 SystemParam 类型自动完成**：

```rust
// 读 Position → 无冲突
fn sys_a(query: Query<&Position>) { }

// 写 Position → 与读 Position 冲突
fn sys_b(mut query: Query<&mut Position>) { }
```

### 4.3 调度阶段详解

```
Schedule
 ├── StartupSchedule (启动时执行一次)
 │    └── StartupStage
 │         ├── setup_world
 │         └── spawn_initial_entities
 │
 ├── UpdateSchedule (每帧)
 │    ├── FirstStage          # 帧开始处理
 │    ├── PreUpdateStage      # 预处理（输入、Physics 准备）
 │    │    ├── process_input
 │    │    └── physics_prepare
 │    ├── StateTransitionStage # 状态转换
 │    ├── UpdateStage         # 主逻辑（大多数系统）
 │    │    ├── player_input
 │    │    ├── enemy_ai
 │    │    ├── physics_step    ← 屏障（barrier）
 │    │    └── ...
 │    ├── PostUpdateStage     # 后处理
 │    │    ├── sync_transform
 │    │    └── cleanup_dead
 │    └── LastStage           # 帧结束处理
 │
 └── RenderSchedule (渲染前)
      └── RenderStage
```

### 4.4 屏障系统（Barrier）

屏障系统强制其在之前的所有系统完成后执行，用于解决写依赖：

```rust
// physics_step 是屏障，必须等它完成后渲染才能读 Transform
app.add_systems(Update, physics_step.exclusive_system());
app.add_systems(
    PostUpdate,
    render_system.after(physics_step)
);
```

### 4.5 并行迭代器

对于 CPU 密集型系统，可以使用并行迭代：

```rust
fn heavy_computation(
    mut query: Query<(&mut Transform, &Velocity, &Mass)>,
) {
    // par_iter() 使用 Rayon 并行处理
    query.par_iter().for_each(|(mut transform, velocity, mass)| {
        // 这里可以并行执行
        let force = velocity.0 * mass.0;
        transform.translation.x += force;
    });
}
```

### 4.6 独占系统（Exclusive System）

独占系统拥有完整的 World 访问权限，但无法与其他系统并行：

```rust
// 独占系统签名
fn exclusive_physics(world: &mut World) {
    // 可以做任何事，但不能并行
}

// 注册
app.add_systems(Update, exclusive_physics.exclusive_system());
```

**适用场景**：

- 确定性物理步进
- 场景保存/加载（需要一致性视图）
- 大量实体的批量操作

### 4.7 系统排序

```rust
// 方式1: 元组隐式链式（从上到下执行）
app.add_systems(Update, (sys_a, sys_b, sys_c));

// 方式2: 显式 .after() / .before()
app.add_systems(Update,
    sys_c.after(sys_b).after(sys_a)
);

// 方式3: SystemSet 命名分组
#[derive(SystemSet, Hash, Eq, PartialEq)]
struct Physics;
app.configure_set(Update, Physics.in_set(CoreSet::Update));
app.add_systems(Physics, (gravity, collision, integrate).chain());
```

### 4.8 系统条件（run_if）

```rust
use bevy::ecs::schedule::Condition;

// 布尔条件
app.add_systems(Update, update_ui.run_if(paused));

// 闭包条件
app.add_systems(Update, debug_stats.run_if(|w: &World| {
    w.query::<&DebugMode>().iter().next().is_some()
}));

// 内置条件
use bevy::ecs::schedule::CommonConditions;
app.add_systems(Update, save_game.run_if(resource_exists::<SaveData>));
```

---

## 5. 资源 (Resources)

Resources 是**全局单例数据**，不隶属于任何 Entity，用于存储游戏状态、全局配置等。

### 5.1 定义资源

```rust
use bevy_ecs::prelude::*;

// 派生 Default
#[derive(Resource, Default)]
struct Score {
    value: i32,
}

// 自定义默认值
#[derive(Resource)]
struct GameConfig {
    difficulty: f32,
    max_players: usize,
}

impl Default for GameConfig {
    fn default() -> Self {
        Self {
            difficulty: 1.0,
            max_players: 4,
        }
    }
}
```

### 5.2 使用资源

```rust
// 只读资源
fn print_score(score: Res<Score>) {
    println!("Score: {}", score.value);
}

// 可写资源
fn add_score(mut score: ResMut<Score>) {
    score.value += 10;
}
```

### 5.3 非 Send 资源

如果资源实现了 `!Send`，它将在主线程执行：

```rust
#[derive(Resource)]
struct ThreadLocalResource {
    data: std::cell::RefCell<Vec<u8>>,
}

// 访问时确保在主线程
fn access_thread_local(res: Res<ThreadLocalResource>) {
    // 安全访问
    res.data.borrow_mut().push(1);
}
```

### 5.4 常用内置资源

| 资源 | 说明 |
|------|------|
| `Time` | 时间管理（delta_seconds, elapsed） |
| `AssetServer` | 资源加载 |
| `Input<T>` | 输入状态（键盘、鼠标、手柄） |
| `State<T>` | 当前状态值 |
| `NextState<T>` | 下一帧要切换到的状态 |

### 5.5 初始化时机

```rust
// 启动时初始化
fn setup(mut commands: Commands) {
    commands.insert_resource(Score { value: 0 });
    commands.insert_resource(GameConfig::default());
}

// 或用 init_resource（使用 Default）
fn setup(mut commands: Commands) {
    commands.init_resource::<Score>();
    // Score::default() 被调用
}
```

---

## 6. 命令队列 (Commands)

由于并行调度的影响，系统不能直接修改 World 结构（如添加/删除实体）。Bevy 使用**命令队列**解决这个问题——所有修改 World 的操作被推迟到当前帧末尾串行执行。

### 6.1 常用命令

```rust
fn spawn_entities(mut commands: Commands) {
    // 生成单个实体
    commands.spawn((Position { x: 0.0, y: 0.0 }, Velocity(1.0, 0.0)));

    // 批量生成（高效）
    commands.spawn_batch(vec![
        (Position { x: 0.0, y: 0.0 },),
        (Position { x: 1.0, y: 1.0 },),
        (Position { x: 2.0, y: 2.0 },),
    ]);
}
```

### 6.2 EntityCommands（实体命令）

```rust
fn setup_player(mut commands: Commands) {
    commands.spawn((
        Player,
        Position::default(),
    ))
    .insert(Velocity(0.0, 0.0))  // 链式添加组件
    .insert(Sprite {
        color: Color::BLUE,
        ..default()
    })
    .with_child(|parent| {        // 添加子实体
        parent.spawn((Camera,));
    });
}
```

### 6.3 延迟执行

Commands 中的操作在当前帧末尾的同步阶段执行：

```rust
fn system_a(mut commands: Commands, mut query: Query<Entity>) {
    let new_entity = commands.spawn((Position { x: 0.0, y: 0.0 },)).id();
    // 此时 query 还查不到 new_entity！
    // 要到下一帧才能看到
}

// 正确做法：在其他系统中查询
fn system_b(query: Query<Entity, Added<JustSpawned>>) {
    for entity in &query {
        // 处理刚 spawn 的实体
    }
}
```

### 6.4 手动刷新命令

在系统中间强制刷新命令队列：

```rust
fn mid_frame_spawn(mut commands: Commands) {
    commands.spawn((BufferA,));
    commands.flush();  // 立即执行，BufferA 现在已存在
    // 可以立即操作刚 spawn 的实体
    let entities: Vec<_> = commands.world().query::<With<BufferA>>().iter().collect();
}
```

---

## 7. 变化检测 (Change Detection)

Bevy 跟踪每个组件的变化，允许系统只在数据改变时才执行逻辑。

### 7.1 过滤器

| 过滤器 | 含义 |
|--------|------|
| `Added<T>` | T 在当前帧被添加到实体 |
| `Changed<T>` | T 在当前或上一帧被修改 |
| `Mutated<T>` | T 被 mutable 访问过（即使值没变） |

### 7.2 ComponentTicks 机制

```rust
// 每次 World 有一个 change_tick（u32，每帧递增）
pub struct World {
    pub(crate) change_tick: u32,
}

// ComponentTicks 存储在每个组件旁边
pub struct ComponentTicks {
    ticks: [u32; 2],  // [change_tick, last_change_tick]
}

// Changed 检查：(current_tick - component_ticks.ticks[0]) < CACHE_SIZE
```

### 7.3 使用示例

```rust
// 玩家刚出生时的初始化
fn on_player_spawn(
    query: Query<Entity, Added<Player>>,
    mut commands: Commands,
) {
    for entity in &query {
        commands.entity(entity).insert(Health { value: 100.0 });
    }
}

// 只处理位置改变了的实体
fn on_position_change(
    query: Query<&Position, Changed<Position>>,
) {
    for position in &query {
        // 只处理位置确实改变了的实体
    }
}
```

### 7.4 移除检测（RemovedComponents）

```rust
// 实体被删除时触发
fn on_player_dead(
    mut removed: RemovedComponents<Player>,
    mut commands: Commands,
) {
    for entity in removed.read() {
        commands.spawn((DeathEffect, ImpactAt(entity)));
    }
}
```

### 7.5 手动标记变化

```rust
fn force_update(mut query: Query<&mut Position>) {
    for mut pos in &mut query {
        pos.set_changed();  // 强制标记为已变化
    }
}
```

---

## 8. 应用生命周期与调度阶段

### 8.1 App 结构

```rust
use bevy::prelude::*;

App::new()
    .add_plugins(DefaultPlugins)        // 添加所有默认插件
    .init_resource::<Score>()            // 初始化资源
    .add_event::<GameEvent>()           // 添加事件类型
    .add_state::<GameState>()           // 添加状态机
    .add_systems(Startup, setup)        // 启动系统
    .add_systems(
        Update,
        (
            player_input,
            update_velocity
                .after(player_input),
            apply_velocity
                .after(update_velocity),
        ).chain()
    )
    .add_systems(PostUpdate, sync_transform)
    .run();
```

### 8.2 DefaultPlugins 包含内容

```rust
// 实际是这些插件的组合
WindowPlugin         // 窗口创建/管理
RenderPlugin         // 渲染管线
ImagePlugin          // 图像处理
TimePlugin           // 时间管理
InputPlugin          // 输入处理
AssetPlugin          // 资源管理
ScenePlugin          // 场景系统
```

### 8.3 自定义阶段

```rust
// 添加自定义阶段
app.add_system_set_to_stage(
    CoreStage::PreUpdate,
    SystemSet::new()
        .with(run_ai)
        .with(run_navigation)
);

// 在特定阶段之间插入
app.configure_set(
    MySet
        .after(CoreSet::Update)
        .before(CoreSet::PostUpdate)
);
```

---

## 9. 插件系统

Bevy 的插件系统是组织代码的核心方式，提供了模块化、可复用的代码封装。

### 9.1 创建插件

```rust
use bevy::prelude::*;

pub struct MyGamePlugin;

impl Plugin for MyGamePlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Update, my_system)
           .init_resource::<MyResource>()
           .register_type::<MyComponent>();
    }
}

// 使用插件
App::new()
    .add_plugins(DefaultPlugins)
    .add_plugin(MyGamePlugin)
    .run();
```

### 9.2 插件分组

```rust
pub struct GamePlugins;

impl PluginGroup for GamePlugins {
    fn build(self) -> PluginGroupBuilder {
        PluginGroupBuilder::start::<Self>()
            .add(PhysicsPlugin)
            .add(CombatPlugin)
            .add(UiPlugin)
    }
}

App::new()
    .add_plugins(GamePlugins)
    .run();
```

### 9.3 使用 DefaultPlugins 的子集

```rust
App::new()
    .add_plugins((
        WindowPlugin::default(),
        RenderPlugin::default(),
        ImagePlugin::default(),
        TimePlugin::default(),
        InputPlugin::default(),
        AssetPlugin::default(),
    ))
    // 不包含 ScenePlugin、UiPlugin 等
    .run();
```

### 9.4 插件生命周期

1. `app.add_plugin()` 注册插件
2. `build()` 在注册时立即调用
3. 系统在每帧按调度顺序执行
4. 插件**无法**被移除（设计决策）

---

## 10. 渲染架构

Bevy 的渲染是**数据驱动**的——向实体添加渲染相关组件，该实体就会被渲染。

### 10.1 相机

```rust
// 2D 相机
fn spawn_2d_camera(mut commands: Commands) {
    commands.spawn(Camera2dBundle::default());
}

// 3D 相机
fn spawn_3d_camera(mut commands: Commands) {
    commands.spawn(Camera3dBundle {
        projection: Projection::Perspective(PerspectiveProjection {
            fov: 60.0,
            ..default()
        }),
        transform: Transform::from_xyz(0.0, 5.0, 10.0)
            .looking_at(Vec3::ZERO, Vec3::Y),
        ..default()
    });
}
```

### 10.2 2D 渲染

```rust
// 精灵
fn spawn_sprite(mut commands: Commands, asset_server: Res<AssetServer>) {
    commands.spawn(SpriteBundle {
        texture: asset_server.load("player.png"),
        transform: Transform::from_xyz(0.0, 0.0, 0.0),
        sprite: Sprite {
            custom_size: Some(Vec2::new(64.0, 64.0)),
            ..default()
        },
        ..default()
    });
}

// 精灵动画
fn animate_sprite(
    time: Res<Time>,
    mut query: Query<(&mut TextureAtlasSprite, &mut TextureAtlas)>,
) {
    for (mut sprite, atlas) in &mut query {
        sprite.index = ((time.elapsed_seconds() * 10.0) as usize) % atlas.textures.len();
    }
}
```

### 10.3 3D 渲染

```rust
// 3D 物体 + 光照
fn spawn_3d_scene(mut commands: Commands, asset_server: Res<AssetServer>) {
    // 环境光
    commands.spawn(PointLightBundle {
        point_light: PointLight {
            intensity: 1500.0,
            shadows_enabled: true,
            ..default()
        },
        transform: Transform::from_xyz(4.0, 8.0, 4.0),
        ..default()
    });

    // 3D 物体
    commands.spawn(PbrBundle {
        mesh: asset_server.load("model.gltf#Mesh0"),
        material: asset_server.load("material.standard"),
        transform: Transform::from_xyz(0.0, 0.0, 0.0),
        ..default()
    });
}
```

### 10.4 Render Graph

```
Render Graph
 ├── Vertex着色器处理
 ├── 光照 Pass
 ├── 阴影 Pass
 ├── 后处理 Pass (Bloom, FXAA)
 └── 输出到屏幕
```

### 10.5 资源加载

```rust
// 加载 GLTF 场景
fn load_gltf(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
) {
    let handle: Handle<Gltf> = asset_server.load("scene.gltf");

    // 使用 SceneSpawner 异步生成实体
    commands.spawn(SceneBundle {
        scene: asset_server.load("scene.gltf#Scene0"),
        ..default()
    });
}
```

---

## 11. 状态机 (bevy_state)

### 11.1 定义状态

```rust
use bevy::prelude::*;

// 主状态机
#[derive(States, Default, Clone, Eq, PartialEq, Hash, Debug)]
enum AppState {
    #[default]
    MainMenu,
    Playing,
    Paused,
    GameOver,
}

// Playing 内的子状态
#[derive(States, Default, Clone, Eq, PartialEq, Hash, Debug)]
enum PlayingState {
    #[default]
    AwaitingInput,
    Moving,
    Attacking,
}
```

### 11.2 状态切换

```rust
// 进入 Playing 状态
fn start_game(mut next_state: ResMut<NextState<AppState>>) {
    next_state.set(AppState::Playing);
}

// 暂停
fn pause_game(
    keyboard: Res<Input<KeyCode>>,
    mut next_state: ResMut<NextState<AppState>>,
    state: Res<State<AppState>>,
) {
    if keyboard.just_pressed(KeyCode::Escape) {
        if state == &State<AppState>::Playing {
            next_state.set(AppState::Paused);
        }
    }
}
```

### 11.3 状态驱动的系统

```rust
// 只在 Playing 状态运行的系统
app.add_systems(
    Update,
    player_movement
        .run_if(in_state(AppState::Playing))
);

// 只在 Playing 的子状态运行
app.add_systems(
    Update,
    attack_system
        .run_if(in_state(PlayingState::Attacking))
);

// OnEnter / OnExit 钩子
app.add_systems(
    OnEnter(AppState::Playing),
    (spawn_player, setup_camera)
);

app.add_systems(
    OnExit(AppState::Playing),
    (cleanup_level, save_score)
);
```

### 11.4 状态转换时机

状态切换发生在**帧末的 StateTransitionStage**，所以：

```rust
// 在同一帧内，多次 set() 以最后那次为准
fn rapid_state_change(mut next: ResMut<NextState<AppState>>) {
    next.set(AppState::GameOver);  // 只有这个会生效
    next.set(AppState::Playing);   // 被覆盖
}
```

---

## 12. 反射与动态 ECS (bevy_reflect)

### 12.1 何时使用反射

- 编辑器工具（Inspector）
- 脚本绑定
- 序列化/反序列化
- 调试/检查工具
- Mod 支持

### 12.2 注册反射类型

```rust
use bevy_reflect::{Reflect, ReflectDeserialize};

#[derive(Component, Reflect, Default)]
#[reflect(Component, Deserialize)]
struct MyComponent {
    value: i32,
    #[reflect(ignore)]  // 序列化时跳过
    cached: f32,
}
```

### 12.3 动态组件访问

```rust
fn dynamic_inspect(world: &World, entity: Entity) {
    let archetype = world.archetype(entity);
    for &component_id in archetype.components() {
        let info = world.components().get_info(component_id).unwrap();
        eprintln!("  - {} ({:?})", info.type_name(), component_id);
    }
}
```

### 12.4 序列化场景

```rust
use bevy::scene::DynamicSceneLoader;
use bevy_reflect::Reflect;

fn save_game(world: &World) {
    let scene = DynamicScene::from_world(world);
    let json = scene.serialize_ron("game.save").unwrap();
    std::fs::write("game.save", json).unwrap();
}

fn load_game(mut world: World, asset_server: Res<AssetServer>) {
    let saved = std::fs::read_to_string("game.save").unwrap();
    let scene = DynamicSceneLoader::加载(&saved);
    scene.clone_into_world(&mut world);
}
```

---

## 13. 快速上手：最小应用

### 13.1 安装

```toml
# Cargo.toml
[dependencies]
bevy = "0.18"
```

### 13.2 最小代码

```rust
use bevy::prelude::*;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .run();
}
```

### 13.3 带游戏循环的完整示例

```rust
use bevy::prelude::*;

// ─── 组件 ───────────────────────────────────────────────
#[derive(Component)]
struct Player;

#[derive(Component)]
struct Speed(f32);

#[derive(Component)]
struct Position {
    x: f32,
    y: f32,
}

// ─── 系统 ─────────────────────────────────────────────────
fn spawn_player(mut commands: Commands) {
    commands.spawn((
        Player,
        Speed(200.0),
        Position { x: 0.0, y: 0.0 },
        SpriteBundle {
            sprite: Sprite { color: Color::BLUE, ..default() },
            transform: Transform::from_scale(Vec3::splat(0.5)),
            ..default()
        },
    ));
}

fn player_input(
    input: Res<Input<KeyCode>>,
    mut query: Query<(&Speed, &mut Position), With<Player>>,
    time: Res<Time>,
) {
    let (speed, mut pos) = query.single_mut();

    if input.pressed(KeyCode::Left)  { pos.x -= speed.0 * time.delta_seconds(); }
    if input.pressed(KeyCode::Right) { pos.x += speed.0 * time.delta_seconds(); }
    if input.pressed(KeyCode::Up)    { pos.y += speed.0 * time.delta_seconds(); }
    if input.pressed(KeyCode::Down)  { pos.y -= speed.0 * time.delta_seconds(); }
}

fn sync_transform(mut query: Query<(&Position, &mut Transform), With<Player>>) {
    for (pos, mut transform) in &mut query {
        transform.translation.x = pos.x;
        transform.translation.y = pos.y;
    }
}

// ─── 入口 ───────────────────────────────────────────────
fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .add_systems(Startup, spawn_player)
        .add_systems(Update, player_input)
        .add_systems(PostUpdate, sync_transform)
        .run();
}
```

---

## 14. 最佳实践与设计模式

### 14.1 项目结构

```
src/
├── main.rs
├── lib.rs                    // re-export plugins
├── plugins/
│   ├── mod.rs
│   ├── player.rs             // PlayerPlugin
│   ├── enemies.rs            // EnemyPlugin
│   ├── combat.rs             // CombatPlugin
│   ├── ui.rs                 // UiPlugin
│   └── audio.rs              // AudioPlugin
├── components/
│   ├── mod.rs
│   ├── player.rs
│   ├── health.rs
│   └── collision.rs
├── resources/
│   ├── mod.rs
│   ├── game_state.rs
│   └── score.rs
├── systems/
│   ├── mod.rs
│   ├── movement.rs
│   ├── combat.rs
│   └── cleanup.rs
├── states/
│   ├── mod.rs
│   └── game_states.rs
└── utils/
    ├── mod.rs
    └── math.rs
```

### 14.2 插件隔离原则

每个插件应该是**自包含**的：

```rust
pub struct PlayerPlugin;

impl Plugin for PlayerPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Update, player_systems)
           .init_resource::<PlayerStats>()
           .register_type::<PlayerData>();
    }
}
```

### 14.3 系统设计原则

1. **单一职责**：每个系统只做一件事
2. **使用 SystemSet 分组相关系统**
3. **用 `.chain()` 保证执行顺序**
4. **用 `Changed<T>` 避免不必要的计算**
5. **优先使用 `&T` 而非 `&mut T`**：允许更多系统并行

### 14.4 组件分组

始终一起使用的组件应该放在同一个 Bundle 中：

```rust
// ❌ 分散添加，触发多次 Archetype 迁移
commands.spawn(Position::default());
commands.entity(e).insert(Velocity::default());
commands.entity(e).insert(Sprite::default());

// ✅ 一次添加，只有一次 Archetype
commands.spawn(PlayerBundle {
    position: Position::default(),
    velocity: Velocity::default(),
    sprite: Sprite::default(),
    player: Player,
});
```

### 14.5 避免跨帧状态泄露

```rust
// ❌ 在一帧内多次操作
fn bad_system(mut commands: Commands, query: Query<Entity>) {
    commands.spawn(Buffer);
    // 下一行找不到刚 spawn 的 Buffer
    let buf = query.filter_component::<Buffer>().single();
}

// ✅ 用 Added<T> 在下一帧处理
fn good_system(
    mut commands: Commands,
    newly_added: Query<Entity, Added<Buffer>>,
) {
    commands.spawn(Buffer);
}

fn process_buffer(
    newly_added: Query<Entity, Added<Buffer>>,
    other: Query<&Buffer>,
) {
    for entity in newly_added.iter() {
        let buf = other.get(entity);
        // ...
    }
}
```

---

## 15. 性能优化

### 15.1 组件存储选择

```rust
// 默认 Table 存储（适合大多数组件）
#[derive(Component)]
struct Position(f32);

// 稀疏集存储（适合稀疏/稀有组件）
#[derive(Component)]
#[component(storage = "SparseSet")]
struct RareBuff {
    effect_type: BuffType,
    remaining_time: f32,
}
```

### 15.2 Query 过滤优化

```rust
// ❌ 使用 Option 来模拟可选组件
fn bad(query: Query<(&Transform, Option<&Velocity>)>) {
    for (transform, velocity) in &query {
        if let Some(v) = velocity {
            // ...
        }
    }
}

// ✅ 使用 With/Without 过滤器
fn good(query: Query<(&Transform, &Velocity), With<Mobile>>) {
    // 只处理有 Velocity 的实体
}
```

### 15.3 批量操作

```rust
// ❌ 循环单个 spawn
for pos in positions {
    commands.spawn((pos,));
}

// ✅ 批量 spawn
commands.spawn_batch(positions.iter().map(|pos| (pos,)));
```

### 15.4 稀疏集 vs Table 的选择

| 场景 | 推荐存储 |
|------|----------|
| >50% 实体都有 | Table（默认） |
| <10% 实体有 | Sparse Set |
| 经常按 Entity ID 访问 | Sparse Set |
| 批量遍历所有实例 | Table |
| 频繁添加/删除 | Sparse Set |

### 15.5 避免 Archetype 抖动

```rust
// ❌ 频繁改变 Archetype
fn unstable(mut commands: Commands, query: Query<Entity, With<NeedsMerge>>) {
    for entity in &query {
        if condition {
            commands.entity(entity).insert(TempState);  // 触发迁移
        } else {
            commands.entity(entity).remove::<TempState>();  // 又迁移回去
        }
    }
}

// ✅ 预分配或使用状态机
#[derive(Component)]
struct TempState;  // 始终存在，用内部状态控制

fn stable(mut query: Query<(&mut TempState, &Position), With<NeedsMerge>>) {
    for (temp, pos) in &mut query {
        if condition {
            temp.0 = true;
        } else {
            temp.0 = false;
        }
        // 不改变组件组合，Archetype 不变
    }
}
```

### 15.6 性能分析工具

```rust
use bevy::diagnostic::{FrameTimeDiagnosticsPlugin, LogDiagnosticsPlugin};

App::new()
    .add_plugins((
        LogDiagnosticsPlugin::default(),
        FrameTimeDiagnosticsPlugin,
    ))
    .run();
```

### 15.7 并行系统使用

```rust
fn parallel_movement(
    time: Res<Time>,
    mut query: Query<(&Velocity, &mut Position)>,
) {
    // par_iter 自动分片并行
    query.par_iter().for_each(|(velocity, mut pos)| {
        pos.x += velocity.x * time.delta_seconds();
        pos.y += velocity.y * time.delta_seconds();
    });
}
```

---

## 16. 常见陷阱与错误规避

### 陷阱 1: 迭代中修改结构

```rust
// ❌ 迭代中 despawn 会导致未定义行为
fn bad_system(mut query: Query<Entity, With<Dead>>, mut commands: Commands) {
    for entity in &query {
        commands.entity(entity).despawn();  // 可能 panic
    }
}

// ✅ 收集后再操作
fn good_system(mut query: Query<Entity, With<Dead>>, mut commands: Commands) {
    let dead_entities: Vec<_> = query.iter().collect();
    for entity in dead_entities {
        commands.entity(entity).despawn();
    }
}
```

### 陷阱 2: 重复的 Mutable Query

```rust
// ❌ 两个系统都可变查询 Transform
fn sys_a(mut query: Query<&mut Transform>) { }
fn sys_b(mut query: Query<&mut Transform>) { }
// 如果没有明确排序，Bevy 会 panic

// ✅ 明确排序
app.add_systems(Update, (sys_a, sys_b).chain());

// ✅ 或者拆分读写
fn sys_a(query: Query<&Transform>) { }  // 只读
fn sys_b(mut query: Query<&mut Transform>) { }
```

### 陷阱 3: 事件消费

```rust
// ❌ 每次 iter() 都消费所有事件
fn bad_system(mut events: EventReader<GameEvent>) {
    for event in events.iter() {  // 第一次 ok
        // ...
    }
    // 下次调用 iter() 已经没有事件了！
}

// ✅ 保存 EventReader 为 Resource 持久化状态
struct GameEventListener;

fn setup(mut commands: Commands) {
    commands.insert_resource(GameEventListener);
}

fn good_system(
    mut listener: ResMut<GameEventListener>,
    mut events: EventReader<GameEvent>,
) {
    for event in events.iter() {
        listener.events.push(event.clone());
    }
    // 或者使用 DistinctiableEventReader
}
```

### 陷阱 4: World 直接修改

```rust
// ❌ 在系统内直接 World mutation
fn bad_system(world: &mut World) {
    world.spawn(Player);  // 危险！
}

// ✅ 使用 Commands
fn good_system(mut commands: Commands) {
    commands.spawn(Player);
}
```

### 陷阱 5: 忘记组件派生

```rust
// ❌ 忘记派生 Component
struct Position {
    x: f32,
    y: f32,
}

// 编译错误！Position 没有实现 Component trait

// ✅ 正确派生
#[derive(Component)]
struct Position {
    x: f32,
    y: f32,
}
```

### 陷阱 6: 资源未初始化

```rust
// ❌ 直接访问未初始化的资源
fn system(score: Res<Score>) {  // 如果 Score 没初始化会 panic
    println!("{}", score.value);
}

// ✅ 用 init_resource 或确保 setup 时初始化
fn setup(mut commands: Commands) {
    commands.init_resource::<Score>();
}
```

### 陷阱 7: Change Detection 的 Tick 环绕

```rust
// ❌ 长时间暂停后，tick 环绕导致 Changed 误报
// (current_tick - component_ticks) < CACHE_SIZE
// 当 tick 环绕时（u32::MAX → 0），差值会很大，导致误判

// ✅ 使用 Added<T> 而非 Changed<T> 来检测"新增"
fn detect_new_players(query: Query<Entity, Added<Player>>) {
    // Added 只在第一次插入时触发，不受 tick 环绕影响
}
```

### 陷阱 8: 组件 Clone vs Copy

```rust
// ❌ 大型组件频繁 Clone
#[derive(Component)]
struct LargeData([u8; 1024]);

fn system(mut query: Query<&mut LargeData>) {
    for mut data in &mut query {
        let clone = data.clone();  // 性能差
        // ...
    }
}

// ✅ 设计上避免频繁复制，或使用引用
fn system(query: Query<&LargeData>) {
    for data in &query {
        // 只读访问，无需 Clone
    }
}
```

---

## 17. 0.14+ 版本迁移指南

### 17.1 主要变化概览

| 版本 | 主要变化 |
|------|----------|
| 0.14 | bevy_ecs 完全重写，新的 Archetype 存储 |
| 0.15 | Renderer 大改，RenderWorld 重构 |
| 0.16 | bevy_state 稳定化 |
| 0.17+ | 细节 API 调整，参考最新迁移指南 |

### 17.2 状态机变化（0.16+）

```rust
// 旧写法 (0.13)
fn on_enter_playing(mut state: ResMut<State<GameState>>) {
    state.set(GameState::Playing);  // 直接 set
}

// 新写法 (0.14+)
fn on_enter_playing(mut next_state: ResMut<NextState<GameState>>) {
    next_state.set(GameState::Playing);  // 通过 NextState 队列切换
}
```

### 17.3 系统调度变化

```rust
// 旧写法
app.add_stage("game", SystemStage::parallel());
app.add_system_to_stage("game", my_system);

// 新写法
app.add_systems(Update, my_system);
app.configure_set(GameSet.in_set(CoreSet::Update));
```

### 17.4 spawn_batch 变化

```rust
// 旧写法
world.spawn_batch(components);

// 新写法 (0.14+)
world.insert_or_spawn_batch(components);
```

### 17.5 组件生命周期钩子

```rust
// 新增的组件钩子
#[derive(Component)]
struct MyComponent;

impl Component for MyComponent {
    const STORAGE_TYPE: StorageType = StorageType::Table;

    type Intercepted = ();
}
```

---

## 18. 实践项目参考

### 18.1 知名开源 Bevy 游戏

| 项目 | 类型 | 特点 |
|------|------|------|
| **Megaphone** | 音乐/节奏游戏 | WebGPU 渲染 |
| **Hypnoscope** | 益智游戏 | 程序生成 |
| **Icarus** | 采矿/建造 | 物理系统 |
| **SNKRX** | 街机射击 | 弹幕系统 |
| **Veloren** | 体素 RPG | 多玩家 |
| **Rusty Snail** | RTS | 路径寻找 |

### 18.2 生态核心库

| Crate | 用途 |
|-------|------|
| `bevy_rapier2d/3d` | 物理引擎 (Rapier) |
| `bevy_xpbd` | 物理引擎 (XPBD) |
| `bevy_egui` | Egui 调试 UI |
| `bevy_inspector_egui` | 属性编辑器 |
| `bevy_editor_pls` | 编辑器支持 |
| `bevy_lyon` | 2D 矢量图形 |
| `bevy_hanabi` | GPU 粒子 |
| `bevy_framepace` | 帧率平滑 |
| `bevy_ecs_ldtk` | LDTK 瓦片地图 |
| `leafwing_input` | 高级输入 |
| `bevy_mod_picking` | 鼠标拾取 |
| `bevy_pbr` | PBR 渲染 |
| `bevy_sprite_animation` | 精灵动画 |

### 18.3 学习参考项目

| 项目 | 说明 |
|------|------|
| [bevy_game_jam_template](https://github.com/NikolaiVaranovich/bevy-game-jam-template) | Game Jam 起始模板 |
| [bevy_cool_template](https://github.com/aevyrie/bevy_cool_template) | 完整项目模板 |
| [bevy-jakob](https://github.com/jakobhellermann/bevy-jakob) | 进阶教程 |
| [bevy_roll_a_ball](https://github.com/hendri80/bevy_roll_a_ball) | 入门实战 |
| [bevy_multiplayer_template](https://github.com/H3nateM/bevy_multiplayer_template) | 网络游戏模板 |

### 18.4 游戏类型模板

```rust
// 2D 平台游戏模板结构
src/
├── main.rs
├── plugins/
│   ├── camera.rs     // 2D 相机跟随
│   ├── platform.rs   // 平台碰撞
│   ├── player.rs     // 玩家控制
│   ├── spawner.rs   // 敌人生成
│   └── ui.rs         // HUD
└── states.rs         // Menu/Playing/Paused

// 3D 游戏模板结构
src/
├── main.rs
├── plugins/
│   ├── player.rs     // 第一人称/第三人称控制
│   ├── physics.rs    // Rapier 物理
│   ├── inventory.rs  // 物品系统
│   ├── ai.rs         // 敌人 AI
│   └── world.rs      // 关卡加载
└── states.rs
```

---

## 19. 命名规范与代码组织

### 19.1 官方命名约定

| 类别 | 约定 | 示例 |
|------|------|------|
| 文件/模块 | `snake_case` | `player_input.rs`, `audio_manager` |
| 类型（struct, enum） | `PascalCase` | `struct PlayerBundle` |
| Trait | `PascalCase` | `trait Component` |
| 函数/方法 | `snake_case` | `fn player_movement()` |
| 枚举成员 | `PascalCase` | `enum Direction { Up, Down }` |
| 常量 | `SCREAMING_SNAKE_CASE` | `const MAX_SPEED: f32 = 100.0;` |
| 组件 | `PascalCase` | `#[derive(Component)] struct Health` |
| 资源 | `PascalCase` | `#[derive(Resource)] struct Time` |
| 系统（函数） | `snake_case` | `fn update_player_position()` |

### 19.2 系统参数命名

```rust
fn system(
    time: Res<Time>,                          // 资源: 名词
    input: Res<Input<KeyCode>>,               // 资源: 名词
    mut transform: Query<&mut Transform>,     // Query: 描述性
    player_query: Query<&Transform, With<Player>>,  // 带泛型: 描述性
    mut commands: Commands,                   // Commands: commands
) { }
```

### 19.3 组件命名模式

```rust
// 标记组件（无数据）
#[derive(Component)]
struct Player;

// 数值组件
#[derive(Component)]
struct Health(f32);

#[derive(Component)]
struct Health {
    current: f32,
    max: f32,
}

// 组合组件
#[derive(Component)]
struct Velocity {
    x: f32,
    y: f32,
}

// Bundle 命名
#[derive(Bundle)]
struct PlayerBundle {
    pub player: Player,
    pub health: Health,
    pub velocity: Velocity,
    pub sprite: SpriteBundle,
}
```

### 19.4 SystemSet 命名

```rust
#[derive(SystemSet, Debug, Clone, PartialEq, Eq, Hash)]
struct Physics;

#[derive(SystemSet, Debug, Clone, PartialEq, Eq, Hash)]
struct Movement;

#[derive(SystemSet, Debug, Clone, PartialEq, Eq, Hash)]
struct Combat;
```

### 19.5 事件命名

```rust
#[derive(Event)]
struct PlayerDiedEvent {
    entity: Entity,
    final_score: u32,
}

#[derive(Event)]
struct LevelCompletedEvent {
    level: u32,
    time_elapsed: f32,
}

#[derive(Event)]
struct DamageEvent {
    target: Entity,
    amount: f32,
    source: Entity,
}
```

---

## 20. 参考资料

### 官方资源

| 资源 | 链接 |
|------|------|
| 官方网站 | https://bevyengine.org |
| 官方文档 | https://bevyengine.org/learn/ |
| 快速入门 | https://bevyengine.org/learn/quick-start/ |
| 官方示例 | https://bevyengine.org/examples/ |
| Rustdocs | https://docs.rs/bevy/latest/bevy/ |
| GitHub 仓库 | https://github.com/bevyengine/bevy |
| 官方博客 | https://bevyengine.org/news/ |
| 迁移指南 | https://bevyengine.org/learn/book/migration-guides/ |
| Release Changelog | https://github.com/bevyengine/bevy/releases |

### 学习资料

| 资源 | 说明 |
|------|------|
| [Bevy Cheat Book](https://bevy-cheatbook.github.io/) | 实用速查手册 |
| [Bevy 官方 Examples](https://github.com/bevyengine/bevy/tree/main/examples) | 覆盖 2D/3D/UI/Audio |
| [Bevy Unofficial Book](https://github.com/T信息的/bevybook) | 社区维护的书籍 |
| [Bevy by Example (rust-cad)](https://github.com/rust-cad/bevy-by-example) | 示例驱动教程 |

### 社区资源

| 资源 | 链接 |
|------|------|
| Discord | https://discord.gg/bevy |
| Reddit | https://www.reddit.com/r/bevy/ |
| 官方 Discussions | https://github.com/bevyengine/bevy/discussions |
| Show & Tell | https://github.com/bevyengine/bevy/discussions/categories/show-and-tell |
| Bevy 资产商店 | https://itch.io/games/tag-bevy |
| crates.io 生态 | https://crates.io/keywords/bevy |

### 源码阅读路径

如果想深入理解 Bevy，推荐按以下顺序阅读源码：

```
1. crates/bevy_ecs/src/lib.rs
   → 了解 ECS 整体设计

2. crates/bevy_ecs/src/world/mod.rs
   → World 的结构，Entity/Component 存储

3. crates/bevy_ecs/src/archetable.rs
   → Archetype 的实现

4. crates/bevy_ecs/src/query/mod.rs
   → Query 的执行和缓存

5. crates/bevy_ecs/src/system/
   → System 的定义和调度

6. crates/bevy_app/src/app.rs
   → App 的构建和运行

7. crates/bevy_render/src/
   → 渲染管线实现

8. crates/bevy_tasks/src/
   → 多线程任务池
```

---

## 附录 A: 快速命令参考

```rust
// 新建项目
cargo new my_bevy_game --name my_bevy_game

// 添加依赖
cargo add bevy

// 开发模式（更快的编译）
cargo build --features bevy/dynamic

// 发布模式
cargo build --release
```

## 附录 B: Cargo Feature 参考

```toml
[dependencies]
bevy = { version = "0.18", features = [
    "animation",      # 动画系统
    "asset_logger",   # 资源加载日志
    "bevy_gltf",      # GLTF 加载
    "bevy_winit",     # Winit 窗口
    "default_font",    # 默认字体
    "hdr",            # HDR 渲染
    "multi_threaded", # 多线程渲染
    "png",            # PNG 支持
    "vorbis",         # OGG/Vorbis 音频
    "webp",           # WebP 支持
    "zstd",           # Zstd 压缩
    "android4",       # Android 支持
    "ios4",           # iOS 支持
] }
```

## 附录 C: 有趣的 Bevy 实验项目

- **Bevy Voxel** — 体素渲染实验
- **Bevy Shadertoy** — ShaderToy 着色器移植
- **Bevy Ray Marching** — 射线步进渲染
- **Bevy WebGPU** — WebGPU 后端实验
- **BevyECS Benchmarks** — 性能基准测试

---

*本笔记由 AI 辅助整理，基于 Bevy 0.18+ 官方文档、源码分析（crates/bevy_ecs、crates/bevy_app、crates/bevy_render 等）及社区最佳实践。如有疏漏敬请指正，欢迎提交 PR 完善。*
