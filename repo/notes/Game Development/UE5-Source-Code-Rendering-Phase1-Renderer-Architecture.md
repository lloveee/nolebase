# UE5 渲染源码学习 — Phase 1：渲染器架构总览

> 学习顺序：先看懂 UE 怎么组织一帧 → 再深入每个 Pass  
> 对应笔记：[DirectX12-Learning-Plan](./DirectX12-Learning-Plan.md)  
> UE 版本：Unreal Engine 5.3+  
> 目标：理解 UE 一帧的渲染流程是怎么串起来的

---

## 1.1 核心入口：FSceneRenderer

UE 所有渲染都从 `FSceneRenderer` 开始，它是场景渲染的核心类。

### 源码路径

```
UnrealEngine/Engine/Source/Runtime/RenderCore/Private/SceneRendering.cpp
UnrealEngine/Engine/Source/Runtime/Renderer/Private/SceneRenderer.cpp
UnrealEngine/Engine/Source/Runtime/Renderer/Private/SceneRenderer.h
```

### 关键方法

```cpp
// SceneRenderer.h
class FSceneRenderer : public FSceneInterface {
public:
    // 创建渲染器实例的工厂方法
    static FSceneRenderer* CreateSceneRenderer(...);

    // 一帧渲染的入口函数（最重要的函数）
    void Render();

    // 各子 Pass 的入口
    void RenderBasePass();          // GBuffer 生成
    void RenderLights();            // 光源渲染
    void RenderShadowDepths();      // 阴影深度
    void RenderVolumetricFog();      // 体积雾
    void RenderTranslucency();      // 半透明
    void RenderFog();               // 大气雾
    void RenderFinish();            // 输出合并，收尾
};
```

### 完整渲染顺序（简化版）

```cpp
void FSceneRenderer::Render() {
    // 1. 初始化
    InitViews();                    // 可见性计算，视锥体裁剪
    PreRenderSetup();               // 渲染前配置

    // 2. 阴影
    RenderShadowDepths();            // 阴影贴图渲染

    // 3. GBuffer / BasePass
    RenderBasePass();               // 几何信息写入 GBuffer

    // 4. 反射
    RenderReflectionCapture();       // 反射采集

    // 5. 光照（延迟光照）
    RenderLights();                  // 光源叠加

    // 6. 体积雾
    RenderVolumetricFog();           // 体积雾（Ray Marching）

    // 7. 大气雾
    RenderFog();                     // 大气散射

    // 8. 半透明（前向渲染）
    RenderTranslucency();            // 透明物体（Alpha Blending）

    // 9. 后期处理
    RenderFinish();                  // 后处理（Bloom/Tonemap/Anti-Aliasing）
}
```

> **理解要点**：UE 用一种 **多 Pass 串行** 的方式组织渲染，每个 Pass 专注一件事。RenderDoc 抓帧时看到的 Pass 列表，就是这个顺序的具体化。

---

## 1.2 可见性系统：InitViews

`InitViews()` 是渲染前最重要的一步——决定哪些物体可见、哪些被剔除。

### 源码路径

```
UnrealEngine/Engine/Source/Runtime/Renderer/Private/VisibilityUtils.cpp
UnrealEngine/Engine/Source/Runtime/Renderer/Private/SceneVisibility.h
```

### 核心概念

```
InitViews() 做的事：
1. 视锥体剔除（Frustum Culling）  — 视野外的物体整个跳过
2. 遮挡剔除（Occlusion Culling）  — 被其他物体挡住的跳过
3. 细节层次（LOD 选择）            — 根据距离选模型精度
4. 可见性实例化（Visibility Instancing）— 合并相同材质的可见物体
```

### GPU Driven 剔除（UE5 新增）

UE5 的 Nanite 和 Virtual Shadow Map 引入了更激进的 GPU 剔除：

```cpp
// FGPUSkinRenderBatch.cpp（Nanite 之前的传统 Skin）
// FVirtualShadowMapCache.cpp（VSM 使用的 Page Table 裁剪）
```

---

## 1.3 渲染帧同步机制

DX12 每帧需要 CPU-GPU 同步，UE 有完整的 `Fence` 机制。

### 核心对象

```cpp
// 在 FRHICommandList 层面
class FRHICommandList {
    FRenderResource*  RenderTarget;    // 当前渲染目标
    FDepthStencil*   DepthStencil;     // 深度模板
    uint32           FrameCounter;      // 帧计数器
};
```

### 一帧的同步流程

```
CPU 提交命令 → CommandQueue → GPU 执行 → Fence 标记完成 → CPU 等待 → 下一帧
```

---

## 1.4 使用 RenderDoc 分析 UE 渲染流程

### 步骤

1. **启动 UE 项目**（推荐 Lyra 或 ShooterGame）
2. **RenderDoc → Inject**：`Tools → Launch Application → Inject into process`
3. **在游戏里切换场景/角色** → 触发渲染
4. **RenderDoc 捕获帧** → 查看 Pass 列表

### 抓帧重点看什么

| Pass 名称 | 含义 |
|---|---|
| `ShadowDepths` | 阴影贴图渲染，每个光源一个 Pass |
| `BasePass` | GBuffer 生成 |
| `DirectionalLight` | 方向光叠加 |
| `PointLight / SpotLight` | 点光源/聚光灯叠加 |
| `Lumen` | 全局光照（Screen Space 或 Hardware RT） |
| `Translucency` | 半透明物体 |
| `Fog` | 体积雾/大气雾 |
| `PostProcessing` | 后期处理（Bloom/HDR/Tonemap） |

---

## 1.5 理解 FRenderGraph

UE5 引入了 `FRenderGraph`（渲染数据流图），让 Pass 之间的资源管理更安全。

### 核心概念

```cpp
// 旧方式（UE4）：
// 直接操作 Render Target，需要手动管理生命周期
UTexture* GBufferA;  // ❌ 容易踩坑：GBuffer 在哪里创建/释放？

// 新方式（UE5 RenderGraph）：
FRDGBuilder GraphBuilder(...);

// 在 Lambda 里声明 Pass，输入输出自动管理
GraphBuilder.AddPass(
    RDG_EVENT_NAME("BasePass"),
    ERDGPassFlags::Raster,
    [&](FRDGBuilder& GraphBuilder) {
        // 资源在 Lambda 内创建，Lambda 结束后自动释放
    }
);
```

### 为什么重要

- **内存安全**：FRenderGraph 自动追踪资源生命周期，避免 D3D12 常见错误（使用已释放的 Resource）
- **并行优化**：某些 Pass 如果没有数据依赖，可以并行执行
- **调试友好**：RenderDoc 里能看到 Pass 之间的数据流

---

## 1.6 关键源码文件清单

| 文件 | 作用 |
|---|---|
| `SceneRenderer.cpp` | FSceneRenderer::Render() 入口 |
| `SceneRendering.cpp` | 场景渲染基础（InitViews 等） |
| `VisibilityUtils.cpp` | 可见性计算（视锥体/遮挡剔除） |
| `RenderGraph.cpp` | FRenderGraph 实现 |
| `RenderGraphBuilder.cpp` | FRenderBuilder 使用方式 |
| `FVisualizeTexture.cpp` | UE 内置的渲染纹理查看器（debug 神器） |

### 快速定位技巧

```
在 Visual Studio 里全文搜索 "void FSceneRenderer::Render()"
→ 找到实现文件
→ 顺着调用函数名往下追
→ 每个函数名本身就是注释（如 RenderShadowDepths）
```

---

## 1.7 本阶段产出目标

- [ ] 能用 RenderDoc 抓帧 UE 官方案例，看懂 Pass 列表顺序
- [ ] 能说出 `FSceneRenderer::Render()` 的 8-10 个主要 Pass
- [ ] 理解 `FRenderGraph` 的作用（不需要会写，但要理解概念）
- [ ] 能在源码里找到 `InitViews()` 并说出它做了哪几件事

---

## 1.8 下一步预告

> **Phase 2：GBuffer 与延迟光照管线**
> - BasePass 详细分析（位置/法线/材质数据怎么编码）
> - Deferred Lighting Pass（光照怎么叠加）
> - GBuffer 布局设计思路

---

## 附录：相关笔记

- [DirectX12-Learning-Plan](./DirectX12-Learning-Plan.md) — DX12 基础（前置知识）
- [CMU 15-445 BusTub](../Database/CMU%2015-445%20BusTub/) — 辅助理解显存管理概念
