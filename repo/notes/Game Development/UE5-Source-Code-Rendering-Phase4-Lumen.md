# UE5 渲染源码学习 — Phase 4：Lumen — 即时全局光照

> 前置知识：Phase 1（渲染器架构）+ Phase 2（GBuffer 延迟光照）  
> 对应笔记：[Phase3-Nanite](./UE5-Source-Code-Rendering-Phase3-Nanite.md)  
> UE 版本：Unreal Engine 5.3+

---

## 4.1 Lumen 是什么

Lumen 是 UE5 引入的 **即时全局光照（Real-Time Global Illumination）** 系统，目标是解决「光线追踪 GI 太慢、预烘焙 GI 无法实时更新」的问题。

### 核心矛盾

| 方案 | 优点 | 缺点 |
|---|---|---|
| 预烘焙 Lightmap | 质量高、性能好 | 场景改变必须重新烘焙 |
| 硬件光线追踪（DXR） | 质量高、可动态 | 需要 RTX GPU，帧率低 |
| **Lumen（UE5）** | **可动态、质量可接受、RTX 可用** | **显存占用大、屏幕空间有限制** |

### Lumen 的核心思路

```
传统 GI：在 3D 空间追踪光线（慢）
Lumen GI：在 2D 屏幕空间追踪光线（快，但有限制）

核心数据结构：
- Irradiance Field（光照场）：预烘焙的光照探针网格
- Surface Cache（表面缓存）：动态更新的光照数据
- Screen Space Trace：屏幕空间光线步进（主要路径）
```

---

## 4.2 Lumen 的两套渲染路径

Lumen 根据硬件能力选择两条路径：

### 路径 1：Hardware Ray Tracing（需要 RTX GPU）

```cpp
// LumenHardwareRayTracing.cpp
// 硬件光线追踪路径，用 DXR API 追踪光线
void FLumenHardwareRayTracingRenderer::TraceRays() {
    // 1. 创建 Raytracing Pipeline（State Object）
    BuildRaytracingPipeline();

    // 2. 生成光线（每个像素一条）
    // Shader 里：
    //   RayGenShader → 对每个屏幕像素发射一条光线
    //   HitShader → 光线击中表面 → 读取 Irradiance Field
    //   MissShader → 光线未击中 → 返回天空光

    // 3. 输出到 Surface Cache
    WriteToSurfaceCache();
}
```

### 路径 2：Screen Space Ray Marching（无需 RTX，所有 DX12/Vulkan GPU 可用）

这是更通用的路径，核心思想是 **在屏幕空间做光线步进**：

```hlsl
// LumenScreenSpaceTracing.usf
float3 Lumen_ScreenSpace_GI(float3 WorldPos, float3 Normal) {
    // 1. 把世界坐标投影到屏幕空间
    float4 ScreenPos = mul(float4(WorldPos, 1), ViewProj);
    float2 UV = ScreenPos.xy / ScreenPos.w * 0.5 + 0.5;

    // 2. 重建屏幕空间的 3D 位置（从 Depth Buffer）
    float3 RayOrigin = WorldPos;
    float3 RayDir = reflect(-normalize(RayOrigin - CameraPos), Normal);

    // 3. Screen Space Ray Marching（光线步进）
    float3 AccumulatedLight = 0;
    float t = 0.01;  // 起始步进距离
    for (int i = 0; i < 64; i++) {  // 最多 64 步
        float3 SamplePos = RayOrigin + RayDir * t;

        // 重建 SamplePos 的屏幕 UV
        float4 SampleScreen = mul(float4(SamplePos, 1), ViewProj);
        float2 SampleUV = SampleScreen.xy / SampleScreen.w * 0.5 + 0.5;

        // 检查 SampleUV 是否在屏幕内
        if (SampleUV.x < 0 || SampleUV.x > 1 ||
            SampleUV.y < 0 || SampleUV.y > 1) {
            break;  // 出屏幕，终止
        }

        // 读取深度图，看是否击中物体
        float SceneDepth = SceneDepthTexture.SampleLevel(SampleUV, 0).r;
        float SampleDeviceZ = SceneDepthTexture.SampleLevel(SampleUV, 0).r;
        float3 SampleWorldPos = uv_ConvertFromDeviceZ(SampleDeviceZ);

        float Distance = length(SamplePos - SampleWorldPos);
        if (Distance < 0.1) {
            // 命中：读取命中点的光照
            AccumulatedLight += SceneColorTexture.SampleLevel(SampleUV, 0).rgb * 0.1;
        }

        t += 0.5;  // 步进
        if (t > 50.0) break;  // 最大距离限制
    }

    return AccumulatedLight;
}
```

### 两条路径的适用场景

| 路径 | 适用场景 | 质量 |
|---|---|---|
| Hardware Ray Tracing | 有 RTX 的 GPU（RTX 3060+） | 高（光线追踪反射+光照） |
| Screen Space Ray Marching | 所有 DX12/Vulkan GPU | 中（受屏幕空间限制，无屏幕外间接光照） |

---

## 4.3 Surface Cache：Lumen 的核心数据结构

Surface Cache 是 Lumen 的核心创新——它是一个 **全场景级别的光照探针网格**，动态更新。

### Surface Cache 的结构

```cpp
// LumenSurfaceCache.h
class FLumenSurfaceCache {
    // Surface Cache 组织成 Tile Grid（全屏 2D 网格）
    // 每个 Tile 存储：World Position / Normal / Albedo / Indirect Irradiance

    // 一帧内只更新屏幕可见区域的 Tile（流式）
    TArray<FLumenCard> Cards;  // 每个大型物体一张 Card

    // Card 映射到屏幕空间
    // Card 的 UV 坐标根据物体在屏幕上的投影动态计算
};
```

### Card 的概念

Lumen 把场景里的主要几何体（大型地板、墙壁）映射成 **Card**（光照探针平面）：

```
场景几何体 → 投影到 2D 平面（Card）
    ↓
Card 存储：间接光照辐照度（Indirect Irruchte）
    ↓
渲染时：光线步进命中的 Card → 插值获取间接光照
```

### Card 的更新策略

```cpp
void FLumenSurfaceCache::UpdateCards(FRDGBuilder& GraphBuilder) {
    // 1. 选择屏幕投影面积最大的 N 张 Card
    // （只更新近处的、重要的 Card）

    // 2. 对选中的 Card 执行 Screen Space Trace
    // → 计算每个 Texel 的间接光照

    // 3. 写入 Surface Cache Texture（FP16 HDR）
    // → SurfaceCacheTexture[CardIndex][UV] = IndirectIrradiance
}
```

---

## 4.4 Lumen 在 UE 渲染管线中的位置

### FSceneRenderer::Render() 中的 Lumen

```cpp
void FSceneRenderer::Render() {
    InitViews();
    RenderShadowDepths();
    RenderBasePass();        // GBuffer（不包含间接光照）

    // ========== Lumen ==========
    RenderLumenScene();       // ← Lumen 主入口
    // 1. 选择要更新的 Card
    // 2. Screen Space Trace（计算间接光照）
    // 3. 更新 Surface Cache
    // 4. 上采样（Temporal Reprojection + TAA）
    // ========== Lumen ==========

    RenderLights();           // 直接光照（此时 GBuffer 已包含间接光照）
    RenderFog();
    RenderTranslucency();
    RenderFinish();
}
```

### Lumen 的 Temporal Reprojection

Lumen 大量依赖 **时序重投影（Temporal Reprojection）** 来隐藏噪声：

```cpp
void FLumenTemporal Reprojection:: Reproject() {
    // 1. 读取上一帧的 Surface Cache
    // 2. 根据 Camera Motion（相机运动向量）重映射
    // 3. 和当前帧新 Trace 的结果混合（通常 50%-80% 来自上一帧）

    // 关键：上一帧的 Tile 是否仍然有效（物体移动后要重新计算）
    // 用 Hi-Z Buffer 做可见性测试
}
```

---

## 4.5 Lumen + Nanite 协作

Lumen 和 Nanite 是 UE5 的两个核心新功能，它们有协作也有独立：

### 协作方式

```
Nanite → 提供高精度几何（LOD + Cluster BVH）
    ↓
Nanite 渲染的深度 → Lumen 用于 Screen Space Trace 的深度输入
    ↓
Lumen 计算间接光照 → 写回 Surface Cache → 叠加到直接光照
```

### Nanite 对 Lumen 的特殊处理

Nanite 物体表面精度极高，Lumen 在 Trace 时需要对 Nanite 做特殊处理：

```cpp
// NaniteLumenIntegration.cpp
// Lumen 使用 Nanite 的 Cluster BVH 做更精确的光线求交
void IntegrateNaniteWithLumen() {
    // 1. Lumen 的 Screen Space Trace 在 Hi-Z Buffer 上做
    // 2. Hi-Z Buffer 来自 Nanite 的深度输出
    // 3. 所以 Nanite 的 Cluster 精度直接传递给 Lumen
}
```

### 两者的独立部分

| 方面 | Nanite | Lumen |
|---|---|---|
| 解决的问题 | 亿级几何体的光栅化 | 动态全局光照 |
| 数据流方向 | CPU → GPU（单向） | GPU 内部（Screen Space Trace） |
| 支持透明物体 | ❌ | ❌（两者都不支持） |

---

## 4.6 Lumen 的局限性

| 局限 | 说明 |
|---|---|
| **屏幕空间限制** | Screen Space GI 只能追踪屏幕内的物体，屏幕外的间接光照丢失 |
| **透明物体** | Lumen 不计算透明物体的间接光照 |
| **镜面反射** | Lumen 的反射是 diffuse GI，不适合做镜面反射（需配合 Screen Space Reflection） |
| **远距离 GI** | Lumen 主要处理近距离（50 米以内），远距离用天空光近似 |
| **显存占用** | Surface Cache + Card Texture 可达数百 MB |
| **噪点** | 低质量模式下噪声明显，需要强 TAA 和 Temporal Reprojection 来掩盖 |

---

## 4.7 Lumen 源码文件导航

| 文件 | 作用 |
|---|---|
| `LumenSceneRenderer.cpp` | Lumen 主入口（RenderLumenScene） |
| `LumenHardwareRayTracing.cpp` | 硬件光线追踪路径（DXR） |
| `LumenScreenSpaceTracing.cpp` | 屏幕空间光线步进（通用路径） |
| `LumenSurfaceCache.cpp` | Surface Cache 数据结构管理 |
| `LumenCard.cpp` | Card 的生成、更新、淘汰 |
| `LumenTemporalReprojection.cpp` | 时序重投影 |
| `NaniteLumenIntegration.cpp` | Nanite 和 Lumen 的协作 |

### Shader 文件

```
Engine/Shaders/Private/Lumen/
├── LumenScreenSpaceTracing.usf    ← Screen Space Ray Marching
├── LumenHardwareRayTracing.usf  ← DXR 路径
├── LumenSurfaceCache.usf        ← Surface Cache 读写
├── LumenCardRender.usf          ← Card 更新
├── LumenGlobalSDF.usf           ← 全场景 SDF（用于远距离）
├── LumenProbeTracing.usf        ← 光照探针追踪
├── LumenIndirectLighting.usf    ← 间接光照计算
```

---

## 4.8 本阶段产出目标

- [ ] 能解释 Lumen Screen Space Trace 的原理（在屏幕上做光线步进）
- [ ] 能说出 Surface Cache + Card 的作用
- [ ] 能区分 Hardware Ray Tracing 和 Screen Space Marching 的适用场景
- [ ] 理解 Lumen 和 Nanite 的协作方式（Nanite 提供深度 → Lumen 做 Trace）
- [ ] 能在 RenderDoc 里找到 Lumen Pass（Screenshot / CardUpdate / ProbeTrace）

---

## 4.9 下一步预告

> **Phase 5：体积云 — Volumetric Fog Rendering**
> - 体积渲染方程（Volume Rendering Equation）
> - Ray Marching 实现（均匀步进 vs 重要性采样）
> - 多重散射近似（Approximate Multiple Scattering）
> - UE 的 FHeightFogScattering 实现

---

## 附录：相关笔记

- [Phase3-Nanite](./UE5-Source-Code-Rendering-Phase3-Nanite.md) — Nanite GPU-Driven 渲染
- [Phase2-GBuffer-And-Deferred-Lighting](./UE5-Source-Code-Rendering-Phase2-GBuffer-And-Deferred-Lighting.md) — GBuffer 与延迟光照
- [Phase1-Renderer-Architecture](./UE5-Source-Code-Rendering-Phase1-Renderer-Architecture.md) — 渲染器总览
