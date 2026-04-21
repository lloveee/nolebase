# UE5 渲染源码学习 — Phase 6：Virtual Shadow Map — 超大场景阴影映射

> 前置知识：Phase 1（渲染器架构）+ Phase 2（GBuffer/ShadowPass）+ Phase 3（Nanite）  
> 对应笔记：[Phase5-Volumetric-Fog](./UE5-Source-Code-Rendering-Phase5-Volumetric-Fog.md)  
> UE 版本：Unreal Engine 5.3+

---

## 6.1 传统阴影贴图的问题

### 经典级联阴影（CSM - Cascaded Shadow Maps）

UE4 使用级联阴影贴图（CSM）处理方向光阴影，把视锥体分成 N 个层级（N 通常为 4）：

```
视锥体（Camera Frustum）
├── Cascade 0: 近处，高分辨率（2048×2048，覆盖 50 米）
├── Cascade 1: 中间，中分辨率（2048×2048，覆盖 200 米）
├── Cascade 2: 远处，低分辨率（2048×2048，覆盖 1000 米）
└── Cascade 3: 更远（接天空光）

问题 1：近处和远处精度必须取舍
→ Cascade 0 覆盖 50 米，Cascade 3 覆盖 1000 米
→ 50-200 米之间没有阴影精度

问题 2：物体超出 Cascade 范围 → 无阴影（PSSProfile 的 Fallback）
```

### 阴影贴图分辨率的矛盾

| 场景 | 视锥体范围 | 需要的阴影贴图 |
|---|---|---|
| 室内 | 10 米 | 4K 贴图 ✅ 精度极高 |
| 城市 | 500 米 | 4K 贴图 → 每像素 = 0.125 米（块状阴影） |
| 开放世界 | 5000 米 | 4K 贴图 → 每像素 = 1.25 米（完全无法看） |

---

## 6.2 Virtual Shadow Map 的核心思想

VSM 借鉴了虚拟内存的思想——把阴影贴图当作 GPU 显存上的「虚拟地址空间」，按需分配。

### 核心比喻：虚拟内存 vs Virtual Shadow Map

```
虚拟内存：
- 程序认为有连续的大内存（4GB）
- 实际物理内存只有 16GB
- CPU 按 Page Table 把虚拟页映射到物理页框
- 不活跃的页在磁盘 Swap 区

Virtual Shadow Map：
- 渲染器认为有覆盖整个世界的连续阴影贴图（65536×65536）
- 实际 GPU 显存只需要 8192×8192（可配置）
- GPU 按 Page Table 把虚拟阴影页映射到物理阴影页
- 远处的页不渲染（类似 Swap Out）
```

### VSM 的关键参数

```cpp
// VirtualShadowMap.h
struct FVirtualShadowMap {
    // 虚拟地址空间：固定 65536 × 65536（64K × 64K）
    static constexpr uint32 VIRTUAL_SIZE = 65536;

    // 物理存储：8192 × 8192（可配置，显存允许可加大）
    static constexpr uint32 PHYSICAL_SIZE = 8192;

    // Page 大小：固定 128 × 128 像素
    static constexpr uint32 PAGE_SIZE = 128;

    // Page 数量：65536 / 128 = 512 × 512 = 262,144 个 Page
};
```

### Page Table 的工作方式

```
场景中有一个重要物体（W：100米）
→ 在虚拟阴影贴图上分配 Page（128×128 像素）
→ 把该物体的阴影渲染到这 128×128 物理像素上
→ 远处不重要的地方不分配物理 Page（省显存）

Page Table 本质：虚拟坐标 → 物理坐标的映射表
[VirtualPageX, VirtualPageY] → [PhysicalPageX, PhysicalPageY] or INVALID
```

---

## 6.3 VSM 在 UE 渲染管线中的位置

### 和 Nanite 的深度配合

VSM 和 Nanite 深度 Pass 紧密配合——Nanite 的 Cluster BVH 精度直接传给 VSM：

```cpp
void FSceneRenderer::RenderVirtualShadowDepths() {
    // 1. 对每个阴影光源（通常是方向光 + 部分点光源）
    for (FLightSceneProxy* Light : VirtualShadowCastingLights) {
        // 2. 计算该光源的视锥体
        FConvex ShadowVolume = ComputeShadowFrustum(Light);

        // 3. 用 Nanite Cluster BVH 做 GPU 侧裁剪
        // → 只渲染 ShadowVolume 内可见的 Nanite Cluster
        // → 减少物理 Page 分配
        TArray<uint32> VisibleClusters = Nanite::GPUCull(ShadowVolume);

        // 4. 对可见 Cluster 执行光栅化，写入 VSM
        RasterizeNaniteToVirtualShadowMap(VisibleClusters, ShadowVolume);

        // 5. 生成 Page Table（物理 Page 映射）
        GeneratePageTable();
    }
}
```

### Page Table 的 GPU 生成

```hlsl
// VirtualShadowMapPageManagement.usf
[numthreads(128, 1, 1)]
void GeneratePageTableCS(uint3 GroupId : SV_DispatchThreadID) {
    uint VirtualPageX = GroupId.x;
    uint VirtualPageY = GroupId.y;

    // 检查该虚拟 Page 是否被任何三角形覆盖
    bool bHasCoverage = CheckPageCoverage(VirtualPageX, VirtualPageY);

    if (bHasCoverage) {
        // 分配物理 Page（原子操作）
        uint PhysicalPageIndex = AtomicAllocPage();
        PageTable[VirtualPageX][VirtualPageY] = PhysicalPageIndex;
    } else {
        PageTable[VirtualPageX][VirtualPageY] = INVALID_PAGE;
    }
}
```

---

## 6.4 Clipmap：多层精度管理

VSM 使用 **Clipmap** 思想管理多层精度——每个 Clipmap 层覆盖不同距离范围。

### Clipmap 的层级结构

```
Clipmap Level 0：覆盖 0-50 米   → 每 Page = 128 像素 / 50米 = 2.56米/像素
Clipmap Level 1：覆盖 0-200米   → 每 Page = 128 像素 / 200米 = 0.64米/像素
Clipmap Level 2：覆盖 0-1000米 → 每 Page = 128 像素 / 1000米 = 0.128米/像素
Clipmap Level 3：覆盖 0-5000米 → 每 Page = 128 像素 / 5000米 = 0.0256米/像素
```

### Clipmap 的滚动更新

Clipmap 跟随相机滚动——只有相机移动时才更新 Page Table：

```
相机向+X 移动 10 米：
→ Clipmap Level 0-2 整体偏移 -X 10米（更新边缘的 Page）
→ 中间的 Page 不变（节省计算）

（类似 DoM（Domain of Definition）管理，避免全量更新）
```

---

## 6.5 VSM 的阴影采样

### 渲染时如何使用 VSM

当 BasePass/Lighting Pass 需要采样阴影时：

```hlsl
// VirtualShadowMapSampling.usf
float SampleVSMShadow(float3 WorldPos) {
    // 1. 找到该世界坐标在哪个 Clipmap Level
    uint ClipmapLevel = SelectClipmapLevel(WorldPos);

    // 2. 把世界坐标映射到虚拟阴影贴图坐标
    float2 ShadowUV = WorldToShadowUV(WorldPos, ClipmapLevel);

    // 3. 查询 Page Table
    uint2 VirtualPage = ShadowUV / PAGE_SIZE;
    uint PhysicalPage = PageTable[VirtualPage];

    if (PhysicalPage == INVALID_PAGE) {
        return 1.0;  // 未分配 Page → 认为在光中（无阴影）
    }

    // 4. 计算在物理 Page 内的偏移
    float2 PageOffset = ShadowUV - VirtualPage * PAGE_SIZE;
    float2 PhysicalUV = (float2(PhysicalPage % PHYSICAL_SIZE,
                               PhysicalPage / PHYSICAL_SIZE) + PageOffset) / PHYSICAL_SIZE;

    // 5. PCF 采样阴影深度
    float ShadowDepth = VirtualShadowMapTexture.SampleLevel(PhysicalUV, 0);
    float CurrentDepth = GetShadowDepth(WorldPos);

    return (CurrentDepth > ShadowDepth + EPSILON) ? 0.0 : 1.0;  // 1=光, 0=影
}
```

---

## 6.6 VSM 的局限性

| 局限 | 说明 |
|---|---|
| **Page Table 开销** | 512×512 的 Page Table 需要额外存储和查询 |
| **远处物体精度** | Clipmap Level 3 每像素精度仍然有限（开放世界超远距离） |
| **Nanite 强依赖** | VSM 的 GPU 裁剪依赖 Nanite Cluster，不支持非 Nanite 物体 |
| **透明物体** | 半透明物体的阴影暂不支持（需要独立处理） |
| **带宽占用** | 高精度 VSM（8192×8192）每帧写入带宽消耗可观 |

---

## 6.7 VSM 源码文件导航

| 文件 | 作用 |
|---|---|
| `VirtualShadowMap.cpp` | VSM 数据结构和核心逻辑 |
| `VirtualShadowMapCache.cpp` | Page Table 管理（缓存和淘汰策略） |
| `VirtualShadowMapPageManagement.cpp` | Page 分配/释放（原子操作） |
| `VirtualShadowMapRender.cpp` | VSM 渲染入口 |
| `NaniteShadowRendering.cpp` | Nanite 阴影渲染集成 |

### Shader 文件

```
Engine/Shaders/Private/
├── VirtualShadowMapPageManagement.usf   ← Page Table 生成
├── VirtualShadowMapSampling.usf         ← 阴影采样（PCF）
├── VirtualShadowMapCompression.usf    ← 阴影贴图压缩（可选）
├── NaniteShadowDepth.usf               ← Nanite 阴影深度
```

---

## 6.8 本阶段产出目标

- [ ] 能解释 Virtual Shadow Map 和传统 CSM 的本质区别（虚拟内存思想）
- [ ] 能说出 Page Table 的工作机制（虚拟坐标 → 物理坐标映射）
- [ ] 能解释 Clipmap 的层级精度管理方式
- [ ] 理解 VSM 和 Nanite 的协作（Nanite Cluster BVH 做 GPU 裁剪）
- [ ] 能在 RenderDoc 里找到 VSM Pass（PageTable / Clipmap / ShadowDepth）

---

## 6.9 全部 Phase 汇总

| Phase | 主题 | 核心概念 |
|---|---|---|
| Phase 1 ✅ | 渲染器架构总览 | FSceneRenderer::Render() + InitViews + FRenderGraph |
| Phase 2 ✅ | GBuffer 与延迟光照 | GBuffer 布局 + BasePass + Deferred Lighting + PCF Shadow |
| Phase 3 ✅ | Nanite | Cluster BVH + Hardware/Software Rasterizer |
| Phase 4 ✅ | Lumen | Screen Space GI + Surface Cache + Card + Temporal Reprojection |
| Phase 5 ✅ | 体积云 | Volume Rendering Equation + Ray Marching + FBM/Worley Noise |
| Phase 6 ✅ | Virtual Shadow Map | Page Table + Clipmap + GPU-Driven 阴影 |

---

## 附录：相关笔记

- [Phase5-Volumetric-Fog](./UE5-Source-Code-Rendering-Phase5-Volumetric-Fog.md) — 体积云
- [Phase4-Lumen](./UE5-Source-Code-Rendering-Phase4-Lumen.md) — Lumen
- [Phase3-Nanite](./UE5-Source-Code-Rendering-Phase3-Nanite.md) — Nanite
- [Phase2-GBuffer-And-Deferred-Lighting](./UE5-Source-Code-Rendering-Phase2-GBuffer-And-Deferred-Lighting.md) — GBuffer
- [Phase1-Renderer-Architecture](./UE5-Source-Code-Rendering-Phase1-Renderer-Architecture.md) — 渲染器总览
- [DirectX12-Learning-Plan](./DirectX12-Learning-Plan.md) — DX12 基础
