# UE5 渲染源码学习 — Phase 5：体积云与大气渲染

> 前置知识：Phase 1（渲染器架构）+ Phase 2（GBuffer 延迟光照）  
> 对应笔记：[Phase4-Lumen](./UE5-Source-Code-Rendering-Phase4-Lumen.md)  
> UE 版本：Unreal Engine 5.3+

---

## 5.1 体积渲染的核心问题

### 传统大气渲染的局限

UE4 及以前的体积雾（Fog）是大气散射的近似，假设**雾是全屏覆盖的**，用后处理 Pass 叠加。问题是：

- 无法处理 **被物体遮挡** 的雾（雾在椅子下面，但椅子后面的雾看不见）
- 无法处理 **参与光照** 的雾（光源照射到雾上，雾要亮）
- 无法处理 **半透明几何体内部** 的雾

### 体积渲染的核心思想

体积渲染（Volumetric Rendering）把「空气中的粒子」当作可参与光照的介质：

```
体积 = 空间中无数小粒子（每个粒子吸收/散射光线）
    ↓
眼睛看到的光 = 背景光 × transmittance + 各粒子散射的累积光
    ↓
求解：体积渲染方程（Volume Rendering Equation）
```

---

## 5.2 体积渲染方程（Volume Rendering Equation）

### 连续形式

沿光线方向积分：

```
L(x, ω) = L_bg × T(x, x_s) + ∫[x_s → x] T(x', x) × σ_s(x') × L_scatter(x', ω) dx'

其中：
- L(x, ω)       = 沿方向 ω 到达点 x 的光
- L_bg          = 背景光（穿过体积后的光）
- T(x', x)      = 从 x' 到 x 的透射率（transmittance）
- σ_s(x')       = 散射系数（散射发生概率）
- L_scatter     = 散射光 = σ_s × 入射辐照度 × 相函数
```

### 离散化（Ray Marching）

```
L_final = L_bg
t = 0
for i in range(MAX_STEPS):
    SamplePos = RayOrigin + RayDir × t
    σ_s = GetDensity(SamplePos)          // 采样密度
    L_scatter = GetLighting(SamplePos)   // 该点的光照
    extinction = σ_s × step_size         // 消光系数
    L_final += L_scatter × (1 - extinction) × T  // 累积散射
    T *= (1 - extinction)                 // 透射率衰减
    t += step_size
```

---

## 5.3 UE 的体积雾实现：FHeightFogScattering

### 源码路径

```
UnrealEngine/Engine/Source/Runtime/Renderer/Private/VolumetricFog.cpp
UnrealEngine/Engine/Source/Runtime/Renderer/Private/HeightFog.cpp
UnrealEngine/Engine/Shaders/Private/HeightFogShaders.usf
UnrealEngine/Engine/Shaders/Private/VolumetricFogShaders.usf
```

### UE 的体积雾数据结构

```cpp
// VolumetricFog.h
struct FVolumetricFog {
    // 体积雾数据存储在 3D Texture 中（Voxel Grid）
    // 每个 Voxel = 一个立方体空间内的雾密度 + 光照累积

    FIntVector VolumetricFogGridSize;  // 通常是 128×128×64

    // 3D 体积雾纹理（存储每个 Voxel 的密度）
    FTexture3DResource* IntegratedLight = null;
    FTexture3DResource* ScatteredLight = null;
    FTexture3DResource* FogDensity = null;   // 密度场
    FTexture3DResource* FogHeight = null;      // 高度衰减
};
```

### UE 的 Ray Marching 实现

```hlsl
// VolumetricFogShaders.usf
float4 RayMarchVolumetricFog(float3 RayOrigin, float3 RayDir, float RayLength) {
    float4 AccumulatedColor = 0;
    float Transmittance = 1.0;

    // 128 步（可配置）
    for (int i = 0; i < VOLUMETRIC_STEPS; i++) {
        float t = (float)i / VOLUMETRIC_STEPS * RayLength;
        float3 SamplePos = RayOrigin + RayDir * t;

        // 1. 采样密度场（3D 噪声 + 高度衰减）
        float Density = SampleFogDensity(SamplePos);  // 3D Texture lookup

        // 2. 计算该点的光照（太阳方向光 + 环境光）
        float3 Lighting = ComputeVolumetricLighting(SamplePos);

        // 3. Beer-Lambert 衰减
        float Extinction = Density * FogExtinction;   // 消光系数
        float StepTransmittance = exp(-Extinction * StepSize);

        // 4. 累积
        float3 Scattering = Lighting * Density * StepSize;
        AccumulatedColor.rgb += Scattering * Transmittance;
        Transmittance *= StepTransmittance;

        if (Transmittance < 0.01) break;  // 早期退出
    }

    AccumulatedColor.a = 1.0 - Transmittance;  // alpha = 不透明度
    return AccumulatedColor;
}
```

---

## 5.4 密度场：噪声函数与高度衰减

### UE 使用多层级联噪声构建体积云

体积雾的密度场不是简单的固定值，而是用 **FBM（分形布朗运动）噪声** 构建：

```hlsl
// VolumetricFogShaders.usf
float GetCloudDensity(float3 WorldPos, float Time) {
    // 1. 基础噪声（FBM - 分形布朗运动）
    float3 NoiseCoord = WorldPos / NoiseScale + Time * 0.01;
    float Noise = SampleNoise3D(NoiseCoord);  // 3D Perlin/Worley 噪声

    // 2. 高度衰减（底部密，顶部稀）
    float HeightFalloff = exp(-WorldPos.z * HeightFade);

    // 3. 精细噪声叠加（增加细节）
    float DetailNoise = SampleNoise3D(WorldPos * 4.0) * DetailStrength;

    return saturate((Noise + DetailNoise) * HeightFalloff);
}
```

### UE 的三维噪声实现

UE 的体积雾使用 **Worley 噪声（细胞噪声）**，它比 Perlin 噪声更适合体积渲染（因为能产生「云团」状分布）：

```hlsl
// Worley 噪声：计算到最近细胞核的距离
float WorleyNoise(float3 P) {
    float3 Cell = floor(P);
    float MinDist = 1e10;

    // 检查周围 3×3×3 的细胞
    for (int z = -1; z <= 1; z++) {
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                float3 Neighbor = Cell + float3(x, y, z);
                float3 FeaturePoint = hash(Neighbor);  // 随机细胞核
                float Dist = length(P - (Cell + FeaturePoint));
                MinDist = min(MinDist, Dist);
            }
        }
    }
    return MinDist;  // 返回最近距离 → 云团形状
}
```

---

## 5.5 光照在体积雾中的散射

### 单次散射 vs 多次散射

| 类型 | 说明 | 性能 | 质量 |
|---|---|---|---|
| **单次散射（Single Scattering）** | 光线只散射一次到达眼睛 | 快（Ray Marching 一步算一次） | 一般 |
| **多次散射（Multiple Scattering）** | 光线在雾中散射多次 | 极慢（指数级计算量） | 真实 |

### UE 的近似多次散射

UE 使用 **Dipole Approximation** 近似多次散射：

```hlsl
// VolumetricFogShaders.usf
float3 ComputeMultiScattering(float3 LightDir, float3 ViewDir, float3 Normal) {
    // 双LOBES近似：用两个相函数的加权和模拟多次散射
    float PhaseForward = HenyeyGreensteinPhase(0.8, ViewDir, LightDir);   // 前向散射
    float PhaseBackward = HenyeyGreensteinPhase(-0.3, ViewDir, LightDir); // 后向散射

    // 多次散射修正（经验公式）
    float3 MultiScatter = (PhaseForward + 0.5 * PhaseBackward) * AmbientColor;

    return MultiScatter;
}
```

### Beer-Lambert 定律（消光）

光线穿过体积时的衰减：

```
T(distance) = exp(-σ_ext × distance)

其中 σ_ext = σ_absorption + σ_scattering（吸收 + 散射）
```

---

## 5.6 体积雾在渲染管线中的位置

### 在 FSceneRenderer::Render() 中

```cpp
void FSceneRenderer::Render() {
    InitViews();
    RenderShadowDepths();
    RenderBasePass();
    RenderLights();

    // ========== 体积雾 ==========
    RenderVolumetricFog();   // ← 体积雾 Pass（Fullscreen Ray Marching）
    // 1. 计算相机视锥体和体积雾的相交
    // 2. Ray Marching 累积散射光
    // 3. 输出到临时 RT（FP16 HDR）
    // 4. 和场景颜色混合（Alpha Compositing）
    // ========== 体积雾 ==========

    RenderFog();              // 传统高度雾（大气散射近似）
    RenderTranslucency();
    RenderFinish();
}
```

### 体积雾和延迟光照的关系

```
体积雾 Pass：
1. 读取 GBuffer（获取表面位置/法线）
2. 从表面位置发射 Ray Marching 光线
3. 累积雾中粒子的散射光
4. 输出：雾的散射光 × Transmittance（考虑了遮挡）
5. 和表面着色结果合成：SurfaceColor ×雾Transmittance + FogScattering
```

---

## 5.7 Virtual Shadow Map 与体积雾的协作

体积云需要知道光源在体积内部的光照分布——这就是 **Virtual Shadow Map（VSM）** 的作用：

```
体积雾内的光照计算：
1. Virtual Shadow Map → 判断体积内某点是否在阴影中
2. 有阴影 → 降低该点的散射光（暗）
3. 无阴影 → 完整接收太阳光（亮）
    ↓
结果：体积云有明暗变化（太阳光透过云层产生的体积光）
```

---

## 5.8 体积雾源码文件导航

| 文件 | 作用 |
|---|---|
| `VolumetricFog.cpp` | 体积雾数据管理（3D Grid 分配/RT 分配） |
| `HeightFog.cpp` | 传统高度雾实现（大气散射） |
| `VolumetricFogRender.cpp` | 体积雾渲染入口 |
| `FogRendering.cpp` | 雾和大气散射渲染通用代码 |

### Shader 文件

```
Engine/Shaders/Private/
├── VolumetricFogShaders.usf      ← 核心 Ray Marching
├── HeightFogShaders.usf         ← 传统大气散射
├── AtmosphericFogShaders.usf   ← 大气散射（行星大气模型）
├── CloudRayMarchingShaders.usf  ← 体积云（ UE5 天空系统）
```

---

## 5.9 本阶段产出目标

- [ ] 能写出体积渲染方程的离散形式（Ray Marching 积分）
- [ ] 能解释 Beer-Lambert 定律和 transmittance 的含义
- [ ] 能说出 UE 体积雾的 3D Grid 结构（128×128×64）
- [ ] 能解释 FBM/Worley 噪声在密度场中的作用
- [ ] 理解体积雾 Pass 在渲染管线中的位置（GBuffer 之后，直接光照之后）
- [ ] 理解体积雾和 VSM 的协作（阴影在体积中的投射）

---

## 5.10 下一步预告

> **Phase 6：Virtual Shadow Map — 超大场景阴影映射**
> - Page Table 管理（GPU 侧虚拟内存式管理）
> - Clipmap 层级（多层级联阴影）
> - 与 Nanite/Lumen 的协作

---

## 附录：相关笔记

- [Phase4-Lumen](./UE5-Source-Code-Rendering-Phase4-Lumen.md) — Lumen 即时全局光照
- [Phase3-Nanite](./UE5-Source-Code-Rendering-Phase3-Nanite.md) — Nanite GPU-Driven 渲染
- [Phase2-GBuffer-And-Deferred-Lighting](./UE5-Source-Code-Rendering-Phase2-GBuffer-And-Deferred-Lighting.md) — GBuffer 与延迟光照
- [Phase1-Renderer-Architecture](./UE5-Source-Code-Rendering-Phase1-Renderer-Architecture.md) — 渲染器总览
