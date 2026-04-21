# UE5 渲染源码学习 — Phase 2：GBuffer 与延迟光照管线

> 前置知识：Phase 1 渲染器架构总览（已理解 Render() 入口 + Pass 顺序）  
> 对应笔记：[Phase1-Renderer-Architecture](./UE5-Source-Code-Rendering-Phase1-Renderer-Architecture.md)  
> UE 版本：Unreal Engine 5.3+

---

## 2.1 什么是 GBuffer

GBuffer（Geometric Buffer，几何缓冲区）是延迟渲染的核心数据结构——把几何信息（位置/法线/材质）和光照信息分开存储，从而实现 **N 个物体 × M 个光源 = N+M 次操作**（而不是 N×M）。

### 传统前向渲染的问题

```
前向渲染（Forward Rendering）：
对于每个物体 → 对于每个光源 → 着色一次

场景：1000 个物体，100 个光源
操作数：1000 × 100 = 100,000 次着色

延迟渲染（Deferred Rendering）：
GBuffer 生成：1000 个物体 × 1 次 = 1000 次
光照叠加：N 个光源 × 1 次（只渲染全屏 quad）= 100 次
总操作数：1100 次
```

### GBuffer 物理存储（UE5 默认布局）

UE 默认使用 5 个 Render Target 存储 GBuffer：

```
GBuffer A (RGBA = RGB + A)
  └── RGB: 法线（World Space Normal）
  └── A:   粗糙度（Roughness）

GBuffer B (RGBA = RGB + A)
  └── RGB: 基础反射率（Base Reflectivity / Metallic）
  └── A:   金属度（Metallic）

GBuffer C (RGBA = RGB + A)
  └── RGB: 高光度（Specular）
  └── A:   次表面散射近似（Subsurface）

GBuffer D (R = R)
  └── R:   逐像素速度（Velocity，用于 TAA）

GBuffer E (RGBA = RGB + A)  [仅 MSAA 模式]
  └── Stencil / 反射数据

Depth (D3D12 Texture2D)
  └── 深度缓冲（Z-Buffer）
```

### UE 源码实现

```cpp
// 源码路径：
// UnrealEngine/Engine/Source/Runtime/Renderer/Private/DeferredShadingRenderer.cpp

// GBuffer 创建（SceneRenderTargets.cpp）
class FSceneRenderTargets {
    // 分配 GBuffer 纹理
    void AllocateGBufferTargets() {
        // GBufferA: 法线 + 粗糙度
        GBufferA = RHICreateTexture2D(...)
            -> Format = PF_A2B10G10R10  // 10bit 每通道，存储法线

        // GBufferB: 基础反射 + 金属度
        GBufferB = RHICreateTexture2D(...)
            -> Format = PF_A2B10G10R10

        // GBufferC: 高光 + 次表面
        GBufferC = RHICreateTexture2D(...)
            -> Format = PF_R8G8B8A8
    }
};
```

---

## 2.2 BasePass：GBuffer 生成

BasePass 负责把所有几何信息写入 GBuffer，是渲染流程中 DrawCall 最密集的一个 Pass。

### 源码路径

```
UnrealEngine/Engine/Source/Runtime/Renderer/Private/BasePassRendering.cpp
UnrealEngine/Engine/Source/Runtime/Renderer/Private/BasePassRenderErrors.cpp
UnrealEngine/Engine/Shaders/Private/BasePass.usf
```

### BasePass 渲染顺序

```cpp
void FDeferredShadingSceneRenderer::RenderBasePass() {
    // 1. 设置渲染目标为 GBuffer A/B/C/D + Depth
    RHISetRenderTargets(GBufferA, GBufferB, GBufferC, GBufferD, Depth);

    // 2. 按材质排序，合并相同 Shader 的 DrawCall
    SortBasePassByPSO();

    // 3. 对每个可见物体执行 BasePass 着色器
    for (FPrimitiveSceneProxy* Proxy : VisiblePrimitives) {
        // 写入：位置（从 Depth 反推）、法线、材质属性
        DrawBasePass(Proxy);
    }
}
```

### BasePass 写入的数据（逐像素）

| 变量 | 来源 | GBuffer 位置 |
|---|---|---|
| `WorldPos` | 深度值 + 逆投影矩阵反推 | 隐式（Depth Buffer 反推） |
| `WorldNormal` | 顶点法线插值 | GBufferA RGB |
| `Roughness` | 材质参数 | GBufferA A |
| `BaseColor` | 材质漫反射颜色 | GBufferB RGB |
| `Metallic` | 材质参数 | GBufferB A |
| `Specular` | 材质参数 | GBufferC RGB |
| `Velocity` | 上一帧位置差值 | GBufferD |

### BasePass.usf 核心代码（伪代码）

```hlsl
void BasePass_Main(
    float4 SvPosition,
    float4 Position,
    float3 Normal,
    float2 TexCoord,
    FMaterialParameters Material
) {
    // 反推世界坐标位置
    float DeviceZ = Texture2D(DownsampleDepth).Load(int3(SvPosition.xy, 0)).r;
    float4 WorldPos = uv_ConvertFromDeviceZ(DeviceZ);

    // 编码法线到 GBuffer（球面映射压缩）
    float3 N = EncodeNormal(Normal);  // 压缩到 [0,1]
    OutGBufferA = float4(N, Material.Roughness);

    // 材质属性直接写入
    OutGBufferB = float4(Material.BaseColor, Material.Metallic);
    OutGBufferC = float4(Material.Specular, Material.Subsurface);
}
```

---

## 2.3 延迟光照（Deferred Lighting / Lighting Pass）

光照 Pass 是全屏 DrawCall——只渲染一个 Fullscreen Quad，遍历所有光源对 GBuffer 的每个像素叠加光照。

### 源码路径

```
UnrealEngine/Engine/Source/Runtime/Renderer/Private/DeferredShadingRenderer.cpp
UnrealEngine/Engine/Shaders/Private/DeferredShading.usf
UnrealEngine/Engine/Shaders/Private/LightRenderingCommon.ush
```

### 延迟光照流程

```cpp
void FDeferredShadingSceneRenderer::RenderLights() {
    // 1. 渲染所有方向光（Directional Light，全屏一次）
    RenderDirectionalLights();

    // 2. 渲染所有点光源（Point Light，用球体/立方体裁剪）
    for (FLightSceneProxy* Light : PointLights) {
        // 遮挡剔除：球体内无物体则跳过
        if (!IsLightVisible(Light)) continue;
        RenderPointLight(Light);
    }

    // 3. 渲染所有聚光灯（Spot Light，锥体裁剪）
    for (FLightSceneProxy* Light : SpotLights) {
        if (!IsLightVisible(Light)) continue;
        RenderSpotLight(Light);
    }
}
```

### 方向光全屏 Pass

方向光是最简单的延迟光照——因为是全局光（全屏受光），只渲染一次 Fullscreen Quad：

```cpp
// DeferredShading.usf
void DirectionalLight_Main(float4 SvPosition : SV_Position) {
    // 1. 解码 GBuffer
    float3 WorldPos = GetWorldPositionFromGBuffer(SvPosition);
    float3 Normal = DecodeNormalGBuffer(GBufferA);
    float Roughness = GBufferA.a;
    float3 BaseColor = GBufferB.rgb;
    float Metallic = GBufferB.a;

    // 2. 加载光源参数
    float3 LightColor = DirectionalLight.Color;
    float3 LightDir = DirectionalLight.Direction;

    // 3. 漫反射（Lambert）+ 高光（Cook-Torrance BRDF）
    float NdotL = saturate(dot(Normal, -LightDir));
    float3 Diffuse = NdotL * BaseColor * (1 - Metallic) * LightColor;

    float3 V = normalize(CameraPos - WorldPos);
    float3 H = normalize(-LightDir + V);
    float NdotH = saturate(dot(Normal, H));
    float3 F0 = lerp(0.04, BaseColor, Metallic);
    float3 F = FresnelSchlick(F0, H, V);
    float3 Specular = F * (Roughness * 0.9 + 0.1); // 分级粗糙度

    // 4. 输出到光照缓冲
    OutLighting = float4(Diffuse + Specular, 1);
}
```

### 点光源/聚光灯：GPU Culling

UE5 的改进之一是 **GPU 侧光源剔除**——在 Compute Shader 里做视锥体裁剪，而不是 CPU 侧提前算：

```cpp
// LightCulling.usf（UE5 新增）
[numthreads(64, 1, 1)]
void ComputeLightCulling(uint3 GroupId : SV_GroupID) {
    // 每个线程块处理一块 Tile（通常是 16x16 像素）
    // 判断该 Tile 内的光源可见性，输出到 LightGrid Buffer
}
```

---

## 2.4 光源分类与叠加方式

### UE 的光源类型

| 类型 | 光照 Pass 方式 | 特殊处理 |
|---|---|---|
| 方向光（Directional） | 全屏 1 次 | 最多 4 个（级联阴影） |
| 点光源（Point） | 球体裁剪后渲染 | 距离衰减（平方衰减） |
| 聚光灯（Spot） | 锥体裁剪后渲染 | 角度衰减（余弦锥） |
| 矩形光（Rect Light） | 光罩几何体渲染 | 专门 BRDF |
| 天空光（Sky Light） | IBL 环境采样 | 从 Cubemap 读取 |

### 光照缓冲（Lighting Buffer）

GBuffer 写入的是几何/材质属性，光照 Pass 写入光照缓冲：

```
Lighting Buffer = Ambient + Σ(Light_i × Visibility_i)

其中：
- Ambient = 环境光（Sky Light 或固定的 Hemisphere Light）
- Light_i = 第 i 个光源的贡献
- Visibility_i = 阴影遮蔽（Shadow Map 或 SDF）
```

---

## 2.5 阴影系统：Shadow Depth Pass

光照 Pass 里每个光源都需要 Shadow Map，Shadow Depth Pass 负责渲染阴影深度。

### 源码路径

```
UnrealEngine/Engine/Source/Runtime/Renderer/Private/ShadowRendering.cpp
UnrealEngine/Engine/Shaders/Private/ShadowDepths.usf
```

### Shadow Map 渲染流程

```cpp
void FSceneRenderer::RenderShadowDepths() {
    // 对每个光源：
    for (FLightSceneProxy* Light : ShadowCastingLights) {
        // 1. 设置正交投影（方向光）或透视投影（点/聚光）
        SetShadowProjection(Light);

        // 2. 渲染阴影级联（Directional Light 有多级级联）
        RenderShadowDepthPass(Light);

        // 3. PCF 软阴影滤波
        // 4. 存储到 ShadowDepthTexture
    }
}
```

### PCF（Percentage Closer Filtering）

UE 默认使用 PCF 软阴影：

```hlsl
// ShadowDepths.usf
float CalcShadowPCF(float3 WorldPos, float4 ShadowUVZ) {
    float ShadowTerm = 0.0;
    // 3x3 或 5x5 抖动采样
    for (int i = -1; i <= 1; i++) {
        for (int j = -1; j <= 1; j++) {
            float2 Offset = float2(i, j) / ShadowMapSize;
            float DepthInShadowMap = ShadowTexture.Sample(ShadowUVZ + Offset).r;
            ShadowTerm += (ShadowUVZ.z <= DepthInShadowMap) ? 1.0 : 0.0;
        }
    }
    return ShadowTerm / 9.0;  // 取平均实现软阴影
}
```

---

## 2.6 GBuffer 格式选择：PF_A2B10G10R10 的意义

GBufferA 和 GBufferB 使用 `PF_A2B10G10R10` 格式（10bit 每通道），这是 UE 的一个关键设计选择。

### 为什么不用 RGBA8 或 RGBA16？

| 格式 | 精度 | 问题 |
|---|---|---|
| RGBA8 | 8bit/通道（0-255） | 精度不够，法线方向需要连续梯度 |
| RGBA16F | 16bit/通道 | 显存翻倍（4 个 RT × 16bit = 64 byte/像素） |
| **A2B10G10R10** | 10bit/通道 + 2bit A | ✅ 平衡精度和带宽 |

### 法线编码：球面映射

法线是三维向量（x,y,z），压缩到 10bit×3 通道：

```hlsl
// BasePass.usf
float3 EncodeNormal(float3 N) {
    // 映射到 [0,1]，存储
    return N * 0.5 + 0.5;
}

float3 DecodeNormal(float3 EncodedN) {
    // 解码回 [-1,1]
    return EncodedN * 2.0 - 1.0;
}
```

---

## 2.7 常见坑与思考

### 坑 1：GBuffer 带宽爆炸

默认 5 个 Render Target = 160 bit/像素（32bit×5），4K 分辨率（3840×2160）下：
```
160 bit × 3840 × 2160 / 8 = 1.66 GB/帧（仅 GBuffer）
```
→ UE5 引入 Mobile Profile 压缩：GBuffer A/B 合并为 2 通道 RGBA8

### 坑 2：半透明物体无法写入 GBuffer

GBuffer 只存不透明物体（Opaque），半透明物体需要单独用 **前向渲染**（Translucency Pass）：
→ 这就是为什么透明物体不受后期处理影响（需要单独做 Screen Space Ray Marching）

### 思考：延迟渲染的局限

- **显存占用大**：多个 GBuffer RT 消耗显存
- **MSAA 难支持**：GBuffer 混合 MSAA 需要额外 RT（GBuffer E）
- **透明物体要单独处理**：无法用同一个 Pass

---

## 2.8 本阶段产出目标

- [ ] 能说出 GBuffer 的 5 个 RenderTarget 分别存什么
- [ ] 能画出 BasePass → LightingPass → ShadowPass 的数据流
- [ ] 能解释 `PF_A2B10G10R10` 格式选择的原因
- [ ] 能在 RenderDoc 里找到 BasePass 并数出写了几个 GBuffer
- [ ] 理解半透明物体无法用延迟渲染的原因

---

## 2.9 下一步预告

> **Phase 3：Nanite — GPU-Driven 渲染系统**
> - Cluster BVH 构建（替代传统 DrawCall）
> - Hardware Rasterizer vs Software Fallback
> - 万级物体渲染的并行化思路

---

## 附录：相关笔记

- [Phase1-Renderer-Architecture](./UE5-Source-Code-Rendering-Phase1-Renderer-Architecture.md) — 渲染器总览
- [DirectX12-Learning-Plan](./DirectX12-Learning-Plan.md) — DX12 基础（前置知识）
