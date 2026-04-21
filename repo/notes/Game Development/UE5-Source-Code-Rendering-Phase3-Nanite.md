# UE5 渲染源码学习 — Phase 3：Nanite — GPU-Driven 渲染系统

> 前置知识：Phase 1（渲染器架构）+ Phase 2（GBuffer 延迟光照）  
> 对应笔记：[Phase2-GBuffer-And-Deferred-Lighting](./UE5-Source-Code-Rendering-Phase2-GBuffer-And-Deferred-Lighting.md)  
> UE 版本：Unreal Engine 5.3+（Nanite 是 UE5 核心新功能）

---

## 3.1 Nanite 是什么

Nanite 是 UE5 引入的 **GPU-Driven 虚拟几何体系统**，目标是解决「亿级多边形场景」的性能问题——传统 DrawCall 模式下，每个物体一次 DrawCall，10000 个物体 = 10000 次 DrawCall（CPU 瓶颈）。Nanite 把几何处理（裁剪、LOD 选择、细分）全部推到 GPU，用 Compute Shader 替代 CPU 的视锥体剔除。

### 核心思想

```
传统渲染（UE4）：
CPU 遍历所有物体 → CPU 视锥体裁剪 → CPU LOD选择 → GPU 渲染
瓶颈：CPU 遍历 + DrawCall 提交

Nanite（UE5）：
所有静态几何 → 预烘焙成 Cluster BVH（GPU 侧）
渲染时：GPU Compute Shader → 并行裁剪 → 直接写入 Rasterizer
瓶颈：显存带宽 + Rasterizer 吞吐
```

### 数字对比（Epic 官方演示）

| 指标 | UE4 方式 | UE5 Nanite |
|---|---|---|
| 单场景多边形数 | 百万级 | **十亿级** |
| DrawCall 数量 | 万级 | **百级** |
| 显存占用（几何） | 高（每个 LOD 完整存储） | 低（Cluster 流式加载） |
| 适用场景 | 中小型场景 | 影视级场景（Zakville Demo） |

---

## 3.2 Cluster：Nanite 的基本处理单元

Nanite 不以「物体」为基本单位，而是 **Cluster**（簇）。

### Cluster 的定义

```
一个 Cluster = 一组三角形（通常是 128-256 个三角形）
每个 Cluster 有自己的：
  - 顶点数据（Position + Normal + UV）
  - LOD 层级（1-7 级，逐级细分）
  - Bounding Volume（球形/盒形包围盒）
```

### Cluster 的 LOD 策略

Nanite 使用 **连续 LOD（Continuous LOD）**，而非 UE4 的离散 LOD：

```cpp
// 每个 Cluster 有 7 级 LOD（LOD 0 最精细，LOD 6 最粗糙）
// 根据屏幕投影面积决定使用哪一级 LOD
float ComputeLODLevel(FCluster& Cluster, float4x4 ViewProj, uint2 ScreenPos) {
    float4 ClipPos = TransformWorldToClip(Cluster.Center);
    float ScreenArea = ClipPos.w / length(ClipPos.xyz);  // 投影面积
    // ScreenArea 越大 → LOD 越低（像素少，用低精度）
    return clamp(log2(ScreenArea / TargetPixelCount), 0, 6);
}
```

### Cluster 和传统 Mesh 的关系

```
传统 UE4：
StaticMesh → LOD0(10k三角) + LOD1(5k) + LOD2(2k) + LOD3(1k)
每个 LOD 都是完整的独立网格体，CPU 选择其中一个上传 GPU

Nanite：
StaticMesh → Cluster 0..N（每 128-256 三角一个 Cluster）
每个 Cluster 有 7 级嵌入式 LOD（不是独立网格，是顶点索引子集）
GPU 根据投影面积动态选择 LOD 级别
```

---

## 3.3 Cluster BVH：层级包围体结构

Cluster 的层级组织靠 **BVH（Bounding Volume Hierarchy）** 实现。

### BVH 结构

```cpp
struct FNaniteBVHNode {
    float3     BoundingBoxMin;   // 包围盒最小点
    float3     BoundingBoxMax;   // 包围盒最大点
    uint       ChildStart;       // 子节点起始索引（0 = 叶节点）
    uint       ChildCount;       // 子节点数量（0 = 叶节点）
    uint       ClusterIndex;     // 叶节点指向的 Cluster ID
};
```

### BVH 构建（预烘焙，Editor 阶段）

```
输入：原始三角网格
输出：Cluster BVH（.nanite 文件，写入到 UE Asset）

构建步骤：
1. Mesh Simplification（几何简化）
   → 输出一组不同精度的新网格（LOD 0-6）
2. Cluster Partition（聚类）
   → 将三角网格划分为 128-256 三角一组的 Cluster
3. BVH Construction（BVH 构建）
   → 递归二分，构建 BVH 树
4. Write .nanite Asset
   → 将顶点、Cluster、BVH 数据序列化
```

### GPU 侧 BVH 遍历（渲染时）

```hlsl
// NaniteClusterCulling.usf（Compute Shader）
[numthreads(64, 1, 1)]
void ClusterCullingMain(uint3 GroupId : SV_GroupID) {
    // 每个线程处理一个 BVH Node
    FNaniteBVHNode Node = BVHBuffer[GroupId.x];

    // 视锥体裁剪测试
    bool bInsideFrustum = FrustumTest(Node.BoundingBox);
    if (!bInsideFrustum) return;  // 不在视野内，跳过

    // 遮挡测试（可选，用 Hi-Z Buffer）
    if (OcclusionTest(Node.BoundingBox)) return;

    if (Node.IsLeaf) {
        // 叶节点：写入可见 Cluster 列表（AppendBuffer）
        uint OutIndex = ClusterList.IncrementCounter();
        ClusterList[OutIndex] = Node.ClusterIndex;
    } else {
        // 非叶节点：继续遍历子节点（WorkQueue）
        EnqueueChildren(Node.ChildStart, Node.ChildCount);
    }
}
```

---

## 3.4 光栅化：Hardware Rasterizer vs Software Fallback

Nanite 渲染有两种路径，取决于 GPU 是否支持硬件光栅化。

### 路径 1：Hardware Rasterizer（支持 SM6+ 的 GPU）

硬件光栅化是最高效的路径，Cluster 直接写入 GPU Rasterizer：

```cpp
// NaniteRasterizer.cpp
void FNaniteRasterizerState::RasterizeClusters() {
    // 1. 设置 Vertex Shader：Nanite 标准顶点着色器
    // → 从 VertexBuffer 读取 Cluster 顶点
    // → 输出 ClipPos（裁剪空间位置）

    // 2. 设置 Primitive Shader（SM6 新增）：
    // → 替代传统光栅器，自动处理背面剔除 + 视口裁剪
    RHISetPrimitiveShader(Cluster.PrimitiveID);

    // 3. 光栅化：
    // Hardware Rasterizer 自动处理
    // 输出：三角形的覆盖信息 → 写入深度缓冲
}
```

### 路径 2：Software Fallback Rasterizer（不支持 SM6 的 GPU）

SM5 及以下的 GPU 不支持硬件光栅化，UE 提供了软件光栅化路径（基于 Compute Shader）：

```hlsl
// NaniteSoftwareRasterizer.usf
[numthreads(8, 8, 1)]
void SoftwareRasterMain(uint3 DispatchThreadId : SV_DispatchThreadID) {
    uint2 PixelPos = DispatchThreadId.xy;

    // 对每个三角形执行原子操作（z-buffer 测试）
    for (uint TriIdx = 0; TriIdx < NumTriangles; TriIdx++) {
        float3 V0 = ClusterVertices[TriIdx * 3 + 0];
        float3 V1 = ClusterVertices[TriIdx * 3 + 1];
        float3 V2 = ClusterVertices[TriIdx * 3 + 2];

        // 重心坐标光栅化
        float3 Bary = ComputeBaryCentric(PixelPos, V0, V1, V2);

        if (IsInsideTriangle(Bary)) {
            float DeviceZ = InterpolateDepth(Bary, V0.z, V1.z, V2.z);

            // 原子比较深度（只写入最前面的像素）
            uint Old = atomicMin(DepthBuffer[PixelPos], floatBitsToUint(DeviceZ));
        }
    }
}
```

---

## 3.5 Nanite 和传统渲染管线的整合

Nanite 不是完全独立的系统，它需要和 UE 的其他渲染 Pass 配合。

### Nanite 在 FSceneRenderer::Render() 中的位置

```cpp
void FSceneRenderer::Render() {
    InitViews();          // 可见性计算（Nanite 在这里被调用）

    // Nanite 的特殊入口（替代了传统的 BasePass）
    RenderNanite();       // ← Nanite 专属 Pass，处理所有 Nanite 几何体

    // 后续 Pass 和传统几何体合并处理
    RenderShadowDepths(); // 阴影（包含 Nanite 阴影）
    RenderBasePass();     // 非 Nanite 几何的 BasePass
    RenderLights();
    // ...
}
```

### Nanite 的阴影处理

Nanite 物体也需要投射阴影，UE 的做法是 **把 Nanite 物体当作光源视锥体内的 Cluster 渲染到 ShadowDepth**：

```cpp
void FShadowSetup::RenderNaniteShadowDepth() {
    // ShadowDepth Pass 里专门有一个子 Pass 渲染 Nanite Cluster
    for (auto& ShadowView : ShadowViews) {
        // 对每个阴影级联：
        CullNaniteClustersForShadow(ShadowView);
        RasterizeNaniteClustersToShadowMap(ShadowView);
    }
}
```

---

## 3.6 Nanite 的局限性

| 局限 | 说明 |
|---|---|
| **不支持的程序化内容** | Procedural Mesh、Spline Mesh 暂不支持（需手动烘焙） |
| **不支持透明物体** | Translucency 仍走传统渲染路径 |
| **不支持 Morph Target** | 角色动画变形暂不支持 |
| **不支持 Vertex Animation** | 顶点动画（如 Vertex Noise）暂不支持 |
| **显存占用** | Cluster BVH + 多级 LOD 数据全部常驻显存（高精度场景可达数 GB） |
| **不支持 Skinned Mesh** | 骨骼动画物体走传统路径（UE5.1+ 开始部分支持） |

---

## 3.7 Nanite 源码文件导航

| 文件 | 作用 |
|---|---|
| `NaniteClusterCulling.cpp` | Cluster 剔除（Compute Shader 入口） |
| `NaniteRasterizer.cpp` | 光栅化状态管理 |
| `NaniteHardwareRasterizer.cpp` | 硬件光栅化路径 |
| `NaniteSoftwareRasterizer.cpp` | 软件光栅化 Fallback |
| `NaniteBVHNodes.cpp` | BVH 节点结构定义 |
| `NaniteShadows.cpp` | Nanite 阴影渲染 |
| `NaniteData.h/cpp` | Cluster / Vertex 数据结构 |
| `NaniteVisualization.cpp` | Nanite 调试可视化 |

### Shader 文件

```
Engine/Shaders/Private/Nanite/
├── NaniteClusterCulling.usf     ← Cluster 剔除 Compute Shader
├── NaniteDepthOnly.usf          ← Nanite 深度 Pass
├── NaniteHardwareRasterizer.usf ← 硬件光栅化 Shader
├── NaniteSoftwareRasterizer.usf ← 软件光栅化 Shader
├── NaniteShadows.usf            ← Nanite 阴影
├── NaniteVisBuffer.usf          ← 可视化缓冲（调试用）
```

---

## 3.8 本阶段产出目标

- [ ] 能解释 Cluster 和传统 Mesh/LOD 的本质区别
- [ ] 能画出 Nanite Cluster → BVH → Culling → Rasterizer 的数据流
- [ ] 能区分 Hardware Rasterizer 和 Software Fallback 的适用场景
- [ ] 能在 RenderDoc 里找到 Nanite Pass（ClusterCulling / Rasterizer）
- [ ] 理解 Nanite 的 4 个核心局限（不支持透明/程序化/动画）

---

## 3.9 下一步预告

> **Phase 4：Lumen — 即时全局光照**
> - Screen Space GI（屏幕空间全局光照）
> - Surface Cache（表面缓存）
> - Hardware Ray Tracing vs Software Ray Marching
> - Lumen 和 Nanite 的协作方式

---

## 附录：相关笔记

- [Phase2-GBuffer-And-Deferred-Lighting](./UE5-Source-Code-Rendering-Phase2-GBuffer-And-Deferred-Lighting.md) — GBuffer 与延迟光照
- [Phase1-Renderer-Architecture](./UE5-Source-Code-Rendering-Phase1-Renderer-Architecture.md) — 渲染器总览
- [DirectX12-Learning-Plan](./DirectX12-Learning-Plan.md) — DX12 基础（了解光栅化硬件原理）
