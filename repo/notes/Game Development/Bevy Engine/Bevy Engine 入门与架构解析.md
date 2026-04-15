# Bevy Engine 入门与架构解析

> Bevy 是一个用 Rust 编写的轻量级、数据驱动的开源游戏引擎，基于 ECS（Entity Component System）架构模式。本笔记涵盖 Bevy 的核心概念、ECS 内部原理、应用构建最佳实践，以及关键参考资料。
>
> **版本**: Bevy 0.18+ | **官方文档**: [bevyengine.org](https://bevyengine.org) | **源码**: [github.com/bevyengine/bevy](https://github.com/bevyengine/bevy)

---

## 目录

- [1. Bevy 概述与设计理念](#1-bevy-概述与设计理念)
- [2. ECS 核心概念](#2-ecs-核心概念)
- [3. Bevy ECS 内部原理](#3-bevy-ecs-内部原理)
- [4. 系统与调度器](#4-系统与调度器)
- [5. 资源 (Resources)](#5-资源-resources)
- [6. 命令队列 (Commands)](#6-命令队列-commands)
- [7. 变化检测 (Change Detection)](#7-变化检测-change-detection)
- [8. 应用生命周期与调度阶段](#8-应用生命周期与调度阶段)
- [9. 插件系统](#9-插件系统)
- [10. 渲染架构](#10-渲染架构)
- [11. 快速上手：最小应用](#11-快速上手最小应用)
- [12. 最佳实践](#12-最佳实践)
- [13. 参考资料](#13-参考资料)

---

## 1. Bevy 概述与设计理念

Bevy 是一个**数据驱动**的游戏引擎，所有游戏逻辑都通过 ECS 模式实现。其核心设计目标：

| 目标 | 含义 |
|------|------|
| **Capable** | 提供完整的 2D/3D 功能集 |
| **Simple** | 对新手友好，对高级用户无限灵活 |
| **Data Focused** | 采用 ECS 范式，数据与行为分离 |
| **Modular** | 按需使用，可替换不喜欢的部分 |
| **Fast** | 应用逻辑快速执行，尽可能并行 |
| **Productive** | 快速编译，频繁迭代 |

### 代码组织结构

Bevy 源码按功能拆分为多个 crate：

```
bevyengine/bevy
├── bevy_ecs          # ECS 核心实现
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
└── bevy_state        # 状态机
```

### 与其他引擎的对比

- **vs Unity/Godot**: 更轻量，完全开源，Rust 的内存安全+高性能
- **vs 其他 Rust ECS (Spec, Legion)**: Bevy ECS 是专门为 Bevy 需求定制，与渲染、UI 等子系统深度集成
- **每 3 个月发布一次大版本**，有迁移指南但可能不轻松

---

## 2. ECS 核心概念

ECS 将程序分解为三个核心概念：**Entity（实体）**、**Component（组件）**、**System（系统）**。

### 2.1 Entity（实体）

Entity 是一个**唯一的 ID**，本身不存储任何数据，也不包含任何行为。它只是一个"标识符"，用来将一组 Component 组合在一起。

```rust
use bevy_ecs::prelude::*;

// 创建一个拥有 Position 和 Velocity 组件的实体
let entity = world.spawn((Position { x: 0.0, y: 0.0 }, Velocity { x: 1.0, y: 0.0 })).id();
```

### 2.2 Component（组件）

Component 是**纯数据**——普通的 Rust struct，不包含任何行为方法。只要实现 `Component` trait，就是一个 Bevy 组件。

```rust
use bevy_ecs::prelude::*;

#[derive(Component)]
struct Position {
    x: f32,
    y: f32,
}

#[derive(Component)]
struct Velocity {
    x: f32,
    y: f32,
}

#[derive(Component)]
struct Health {
    value: f32,
}
```

### 2.3 System（系统）

System 是**普通的 Rust 函数**，每个 frame 执行一次，负责读写组件数据并实现游戏逻辑。Bevy 根据系统参数类型自动推断需要访问哪些组件。

```rust
use bevy_ecs::prelude::*;

fn player_movement(
    mut query: Query<(&Velocity, &mut Position)>,
    time: Res<Time>,
) {
    for (velocity, mut position) in query.iter_mut() {
        position.x += velocity.x * time.delta_seconds();
        position.y += velocity.y * time.delta_seconds();
    }
}
```

### 2.4 World（世界）

World 是存放所有 Entities、Components 和 Resources 的容器。

```rust
use bevy_ecs::world::World;

let mut world = World::new();
let entity = world.spawn((Position { x: 0.0, y: 0.0 },)).id();
let position = world.entity(entity).get::<Position>().unwrap();
```

### 2.5 Query（查询）

Query 是 ECS 中最常用的工具，用于迭代具有特定组件组合的实体。

```rust
// 不可变访问
fn print_positions(query: Query<&Position>) {
    for position in &query {
        println!("{:?}", position);
    }
}

// 可变访问
fn update_positions(mut query: Query<&mut Position>) {
    for mut position in &mut query {
        position.x += 1.0;
    }
}

// 同时获取多个组件
fn move_players(mut query: Query<(&Velocity, &mut Position)>) {
    for (velocity, mut pos) in &mut query {
        pos.x += velocity.x;
    }
}
```

---

## 3. Bevy ECS 内部原理

### 3.1 Archetype（原型）

当一个 Entity 拥有一组特定的组件时，它属于一个 **Archetype**。Archetype 是 Bevy ECS 存储组织的核心单位。

```
Archetype A: [Position, Velocity, Sprite]
  └── Chunk 1: Entity 1, Entity 2, Entity 5
  └── Chunk 2: Entity 8, Entity 12

Archetype B: [Position, Velocity]
  └── Chunk 1: Entity 3, Entity 7
```

**Archetype 的关键特性**：

- 相同 Archetype 的实体，其组件数据在内存中是**连续存储**的（cache-friendly）
- 当给 Entity 添加/删除组件时，该 Entity 会移动到新的 Archetype
- Archetype 间移动有成本（组件数据需要复制到新的位置）

### 3.2 Chunk（数据块）

每个 Archetype 被划分为多个 Chunk，每个 Chunk 固定存储**一定数量的实体**（通常是 128~4096 个可配置）。同一 Chunk 内的组件数据按列存储：

```
Chunk (最多 128 个实体)
┌─────────────┬─────────────┬─────────────┐
│ Position.x │ Position.y │  ...        │  ← 同一组件的连续内存
├─────────────┼─────────────┼─────────────┤
│ Entity 1   │ Entity 2    │  ...        │
└─────────────┴─────────────┴─────────────┘
```

这种 **SoA (Structure of Arrays)** 布局使得遍历同类组件时具有极佳的缓存命中。

### 3.3 Storage（存储方式）

Bevy 提供两种组件存储方式：

| 存储类型 | 特点 | 适用场景 |
|----------|------|----------|
| **Table**（表存储） | 密集存储，组件存在才分配 | 大多数组件 |
| **Sparse Set**（稀疏集） | 实体 ID → 组件的映射 | 频繁按 Entity ID 单独访问的组件 |

大部分组件默认使用 Table 存储；少量特殊组件（如 `Changed<T>`）使用 Sparse Set。

### 3.4 存储选择策略

```rust
// 默认使用 Table 存储
#[derive(Component)]
struct Position(f32);

// 标记使用 Sparse Set 存储（通过组件类型）
// Bevy 内部会根据组件特性自动选择
```

---

## 4. 系统与调度器

### 4.1 自动并行化

Bevy 的调度器根据系统声明的**数据访问需求**自动决定哪些系统可以并行执行。

```rust
// 系统 A 只读 Position
fn system_a(query: Query<&Position>) { ... }

// 系统 B 只写 Position
fn system_b(mut query: Query<&mut Position>) { ... }

// → system_a 和 system_b 不能并行（存在读写冲突）
// → system_a 可以和只读其他组件的系统并行
```

### 4.2 系统参数类型

| 参数类型 | 含义 |
|----------|------|
| `Query<&T>` | 不可变访问 T |
| `Query<&mut T>` | 可变访问 T |
| `Query<(Entity, &T, &U)>` | 同时获取多个组件 |
| `With<T>` | 过滤器：包含组件 T |
| `Without<T>` | 过滤器：不包含组件 T |
| `Changed<T>` | 过滤器：T 在上一帧被修改 |
| `Added<T>` | 过滤器：T 在当前帧被添加 |
| `Res<T>` | 不可变访问资源 T |
| `ResMut<T>` | 可变访问资源 T |
| `Commands` | 命令队列 |

### 4.3 调度阶段

系统被组织到不同的调度阶段（Schedule）中：

| 阶段 | 说明 |
|------|------|
| `Startup` | 应用启动时执行一次 |
| `Update` | 每帧执行（主循环） |
| `PostUpdate` | Update 之后执行 |
| `Render` | 渲染前执行 |
| `Last` | 每帧最后执行 |

每个阶段内部又分为多个子阶段，按顺序执行：

```
StartupSchedule
  └─ StartupStage
      ├─ System 1
      ├─ System 2
      └─ ...

UpdateSchedule (每帧)
  └─ UpdateStage
      ├─ System 1 (可并行组 A)
      ├─ System 2 (可并行组 A)
      ├─ System 3 (同步屏障)
      └─ System 4
```

### 4.4 独占系统

有些系统需要独占 World 访问（如 spawn/despawn 大量实体），使用 `SystemId` 手动调度：

```rust
fn exclusive_system(world: &mut World) {
    // 直接操作 World
}

app.add_systems(Update, exclusive_system.exclusive_system());
```

---

## 5. 资源 (Resources)

Resources 是**全局单例数据**，不隶属于任何 Entity，用于存储游戏状态、全局配置等。

### 5.1 定义资源

```rust
use bevy_ecs::prelude::*;

#[derive(Resource, Default)]
struct Score {
    value: i32,
}

#[derive(Resource)]
struct GameConfig {
    difficulty: f32,
    max_players: usize,
}
```

### 5.2 使用资源

```rust
fn add_score(mut score: ResMut<Score>) {
    score.value += 10;
}

fn print_score(score: Res<Score>) {
    println!("Score: {}", score.value);
}
```

### 5.3 常用内置资源

- `Time` — 时间管理（delta_seconds, elapsed 等）
- `AssetServer` — 资源加载
- `Input<T>` — 输入状态
- `State<T>` — 状态机状态

### 5.4 非可发送资源

如果资源实现了 `!Send`，它将在主线程执行：

```rust
// ThreadLocal ресурс
#[derive(Resource)]
struct NonSendResource {
    // ...
}
```

---

## 6. 命令队列 (Commands)

由于并行调度的影响，系统不能直接修改 World 结构（如添加/删除实体）。Bevy 使用**命令队列**解决这个问题——所有修改 World 的操作被推迟到当前帧末尾串行执行。

### 6.1 常用命令

```rust
fn spawn_entities(mut commands: Commands) {
    // 生成实体
    commands.spawn((Position { x: 0.0, y: 0.0 }, Velocity { x: 1.0, y: 0.0 }));

    // 批量生成
    commands.spawn_batch(vec![
        (Position { x: 0.0, y: 0.0 },),
        (Position { x: 1.0, y: 1.0 },),
    ]);

    // 给已有实体添加组件
    commands.entity(entity).insert(Sprite::default());

    // 删除实体
    commands.entity(entity).despawn();
}
```

### 6.2 延迟执行

Commands 中的操作在当前帧末尾的同步阶段执行，因此在一个系统中添加实体后，不能立即在同一帧中查询到它：

```rust
fn system_a(mut commands: Commands, mut query: Query<Entity>) {
    commands.spawn((Position { x: 0.0, y: 0.0 },));
    // 此时还查询不到刚才 spawn 的实体！
    // 要到下一帧才能看到
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
| `Mutated<T>` | T 被 mutable 访问过（无论是否真的改变） |

### 7.2 使用示例

```rust
fn on_player_spawn(
    query: Query<Entity, Added<Player>>,
    mut commands: Commands,
) {
    for entity in &query {
        // 新玩家加入时的初始化逻辑
        commands.entity(entity).insert(Health { value: 100.0 });
    }
}

fn on_position_change(
    query: Query<&Position, Changed<Position>>,
) {
    for position in &query {
        // 只处理位置确实改变了的实体
    }
}
```

### 7.3 手动标记变化

```rust
fn mark_dirty(mut query: Query<&mut Position>, time: Res<Time>) {
    for mut pos in &mut query {
        // 强制标记为已变化（即使值相同）
        pos.set_changed();
    }
}
```

---

## 8. 应用生命周期与调度阶段

### 8.1 App 结构

```rust
use bevy::prelude::*;

App::new()
    .add_plugins(DefaultPlugins)  // 添加默认插件组
    .init_resource::<Score>()      // 初始化资源
    .add_systems(Startup, setup)   // 启动系统
    .add_systems(Update, (player_input, update_velocity, apply_velocity))
    .add_systems(PostUpdate, check_collisions)
    .run();
```

### 8.2 默认插件 (DefaultPlugins)

`DefaultPlugins` 包含一组核心插件：

- `WindowPlugin` — 窗口创建和管理
- `RenderPlugin` — 渲染管线
- `ImagePlugin` — 图像处理
- `TimePlugin` — 时间管理
- `InputPlugin` — 输入处理
- `AssetPlugin` — 资源管理

### 8.3 启动系统

启动系统（Startup Systems）在游戏开始时执行一次，用于初始化游戏世界：

```rust
use bevy::app::Startup;

fn setup(mut commands: Commands) {
    commands.spawn(Camera2dBundle::default());
    commands.spawn((Player, Position::default(), Velocity::default()));
}

app.add_systems(Startup, setup);
```

---

## 9. 插件系统

Bevy 的插件系统是组织代码的核心方式，提供了模块化、可复用的代码封装。

### 9.1 创建插件

```rust
use bevy::prelude::*;

pub struct MyPlugin;

impl Plugin for MyPlugin {
    fn build(&self, app: &mut App) {
        // 在这里添加系统、资源、组件
        app.add_systems(Update, my_system)
           .init_resource::<MyResource>();
    }
}
```

### 9.2 使用插件

```rust
App::new()
    .add_plugins(DefaultPlugins)
    .add_plugin(MyPlugin)
    .run();
```

### 9.3 插件组

多个相关插件可以组合成一个 `PluginGroup`：

```rust
// 使用 DefaultPlugins 的子集
app.add_plugins((
    WindowPlugin::default(),
    RenderPlugin::default(),
    ImagePlugin::default(),
));
```

### 9.4 插件生命周期

1. `app.add_plugin()` 注册插件
2. `build()` 在注册时立即调用
3. 系统在每帧按调度顺序执行
4. 插件无法被移除（设计决策）

---

## 10. 渲染架构

Bevy 的渲染是**数据驱动**的——向实体添加渲染相关组件，该实体就会被渲染。

### 10.1 2D 渲染

```rust
use bevy::prelude::*;
use bevy::sprite::SpriteBundle;

// 2D 场景设置
fn setup_2d(mut commands: Commands, asset_server: Res<AssetServer>) {
    commands.spawn(Camera2dBundle::default());
    commands.spawn(SpriteBundle {
        texture: asset_server.load("player.png"),
        transform: Transform::from_xyz(0.0, 0.0, 0.0),
        ..default()
    });
}
```

### 10.2 3D 渲染

```rust
use bevy::prelude::*;
use bevy::pbr::PbrBundle;

// 3D 场景设置
fn setup_3d(mut commands: Commands, asset_server: Res<AssetServer>) {
    commands.spawn(Camera3dBundle::default());
    commands.spawn(PbrBundle {
        mesh: asset_server.load("model.gltf#Mesh0"),
        material: asset_server.load("material.standard"),
        transform: Transform::from_xyz(0.0, 0.0, 5.0),
        ..default()
    });
    commands.spawn(PointLightBundle {
        point_light: PointLight {
            intensity: 1000.0,
            ..default()
        },
        transform: Transform::from_xyz(4.0, 8.0, 4.0),
        ..default()
    });
}
```

### 10.3 渲染管线

Bevy 使用**Render Graph** 组合渲染流程：

```
Render Graph
  └─ Render Pass 1 (Mesh)
  └─ Render Pass 2 (Lighting)
  └─ Render Pass 3 (Post-processing)
  └─ Render Pass N (Custom)
```

- Render Graph 节点自动并行执行
- 支持自定义 Shader、Material、Render Pipeline
- 支持热重载（Shader 修改即时生效）

### 10.4 资源加载

```rust
use bevy::asset::LoadState;

fn load_assets(asset_server: Res<AssetServer>, mut app_exit: EventWriter<AppExit>) {
    let handle = asset_server.load("player.png");

    // 异步加载完成后再使用
    if asset_server.get_load_state(handle.id()) == LoadState::Loaded {
        // 使用资源
    }
}
```

---

## 11. 快速上手：最小应用

### 安装

```toml
# Cargo.toml
[dependencies]
bevy = "0.18"
```

### 最小代码

```rust
use bevy::prelude::*;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .run();
}
```

### 带游戏循环的完整示例

```rust
use bevy::prelude::*;

// === 组件定义 ===
#[derive(Component)]
struct Player;

#[derive(Component)]
struct Speed(f32);

#[derive(Component)]
struct Position {
    x: f32,
    y: f32,
}

// === 系统 ===
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

fn player_movement(
    input: Res<Input<KeyCode>>,
    mut query: Query<(&Speed, &mut Position), With<Player>>,
    time: Res<Time>,
) {
    let (speed, mut pos) = query.single_mut();

    if input.pressed(KeyCode::Left) {
        pos.x -= speed.0 * time.delta_seconds();
    }
    if input.pressed(KeyCode::Right) {
        pos.x += speed.0 * time.delta_seconds();
    }
    if input.pressed(KeyCode::Up) {
        pos.y += speed.0 * time.delta_seconds();
    }
    if input.pressed(KeyCode::Down) {
        pos.y -= speed.0 * time.delta_seconds();
    }
}

fn sync_transform(mut query: Query<(&Position, &mut Transform), With<Player>>) {
    for (pos, mut transform) in &mut query {
        transform.translation.x = pos.x;
        transform.translation.y = pos.y;
    }
}

// === 入口 ===
fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .add_systems(Startup, spawn_player)
        .add_systems(Update, player_movement)
        .add_systems(PostUpdate, sync_transform)
        .run();
}
```

---

## 12. 最佳实践

### 12.1 项目结构

```
src/
├── main.rs           # App 入口，添加插件
├── plugins/
│   ├── mod.rs
│   ├── player.rs     # 玩家相关系统+组件
│   ├── enemies.rs    # 敌人系统
│   ├── ui.rs         # UI 组件
│   └── audio.rs      # 音频系统
└── resources/
    ├── mod.rs
    └── game_state.rs  # 游戏状态资源
```

### 12.2 系统设计原则

1. **单一职责**：每个系统只做一件事
2. **避免跨帧依赖**：一帧内 Commands 添加的实体，下一帧才能使用
3. **合理使用 Query 过滤**：`Changed<T>` 避免不必要的计算
4. **批量操作**：大量 spawn 用 `spawn_batch`
5. **优先使用 `&T` 而非 `&mut T`**：允许更多系统并行

### 12.3 性能优化

| 优化手段 | 说明 |
|----------|------|
| 使用 `Changed<T>` | 只处理真正变化的实体 |
| 批量 spawn | 减少 archetype 碎片 |
| 合理拆分系统 | 让更多系统可以并行 |
| 避免频繁 archetype 移动 | 组合组件时考虑稳定性 |
| 使用 `Commands::spawn_batch` | 大批量生成时性能更好 |

### 12.4 常见陷阱

- **一帧内多次访问同一组件**：Bevy 只跟踪第一次 mutable 访问的变化
- **资源未初始化就用**：`app.init_resource::<T>()` 或 `#[derive(Resource, Default)]`
- **过度使用 `Changed<T>`**：`Changed<T>` 每帧都会重置，需要理解其语义

### 12.5 Rust 类型系统与 Bevy

Bevy 利用 Rust 的类型系统实现了零成本的 ECS：

- `Query<&T>` vs `Query<&mut T>` → 自动区分读写权限
- `With<T>` / `Without<T>` → 编译期过滤条件
- `Changed<T>` → 利用 `MutatedTicks` 实现变化跟踪
- `SystemId` → 类型安全的系统标识

---

## 13. 参考资料

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

### 学习资料

| 资源 | 说明 |
|------|------|
| [Bevy 官方 Examples](https://github.com/bevyengine/bevy/tree/main/examples) | 覆盖 2D/3D/UI/Audio/游戏功能 |
| [Bevy 官方 Book](https://bevyengine.org/learn/book/) | 概念讲解（持续完善中） |
| [Bevy Jumanji](https://github.com/jakobhellermann/bevy-jakob) | 进阶教程项目 |
| [Bevy Cheat Book](https://bevy-cheatbook.github.io/) | 实用速查手册 |
| [Tiny Roll a Ball Tutorial](https://github.com/hendri80/bevy_roll_a_ball) | 入门实战项目 |

### 社区与生态

| 资源 | 链接 |
|------|------|
| Discord | https://discord.gg/bevy |
| Reddit | https://www.reddit.com/r/bevy/ |
| 官方 Discussions | https://github.com/bevyengine/bevy/discussions |
| Bevy 资产商店 (itch.io) | https://itch.io/games/tag-bevy |
| crates.io 生态 | https://crates.io/keywords/bevy |

### 关键 crates 生态

| Crate | 用途 |
|-------|------|
| `bevy` | 核心引擎 |
| `bevy_ecs` | 独立 ECS 库 |
| `bevy_prototype` | 快速原型开发 |
| `bevy_inspector_egui` | Egui 调试面板 |
| `bevy_editor_pls` | 内置编辑器支持 |
| `bevy_lyon` | 2D 矢量图形 |
| `bevy_hanabi` | GPU 粒子系统 |
| `bevy_xpbd` | 物理引擎 |
| `bevy_nesticle` | NES 模拟器 |

### 源码阅读推荐

Bevy 源码结构清晰，适合学习。如果想深入理解 ECS 内部：

1. 从 `crates/bevy_ecs/src/lib.rs` 开始
2. 重点阅读 `World`、`Entity`、`System` 的实现
3. 查看 `Schedule` 如何实现并行调度
4. `crates/bevy_ecs/src/query` 目录下的查询实现

---

*本文档由 AI 辅助整理，基于 Bevy 0.18+ 官方文档和源码。如有疏漏敬请指正。*
