# UE5 渲染源码学习 — 完整路径索引

> UE 版本：Unreal Engine 5.3+   |   前置：DirectX12 基础（见 [DirectX12-Learning-Plan](./DirectX12-Learning-Plan.md)）
> 学习顺序：Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6（按顺序推进，不要跳步）

---

## 学习路径总览

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 ──► Phase 6
渲染器架构    GBuffer    Nanite      Lumen       体积云       VSM
   │          延迟光照   GPU驱动      即时GI      RayMarch   虚拟阴影
   │            │         │           │           │           │
   └────────────┴─────────┴───────────┴───────────┴───────────┘
                              ↓
                    理解 UE5 渲染全貌
```

---

## Phase 1：渲染器架构总览

**文件**：[UE5-Source-Code-Rendering-Phase1-Renderer-Architecture](./UE5-Source-Code-Rendering-Phase1-Renderer-Architecture.md)

**核心目标**：理解 UE 怎么组织一帧的渲染

**关键概念**：
- `FSceneRenderer::Render()` 完整 9 步 Pass 顺序
- `InitViews()`：Frustum Culling / Occlusion Culling / LOD
- `FRenderGraph`：Lambda 写法，资源生命周期自动管理
- RenderDoc 抓帧使用方法

**产出**：
- [ ] 能说出 `FSceneRenderer::Render()` 的 8-10 个主要 Pass
- [ ] 能在 RenderDoc 里看懂 Pass 列表

---

## Phase 2：GBuffer 与延迟光照管线

**文件**：[UE5-Source-Code-Rendering-Phase2-GBuffer-And-Deferred-Lighting](./UE5-Source-Code-Rendering-Phase2-GBuffer-And-Deferred-Lighting.md)

**前置**：Phase 1 渲染器架构

**核心目标**：理解 UE 的几何/光照分离架构

**关键概念**：
- GBuffer 5 个 RT（A/B/C/D/Depth）各自存储什么
- BasePass：把几何信息（位置/法线/材质）写入 GBuffer
- Deferred Lighting：全屏 Pass，光源叠加
- PCF 软阴影
- `PF_A2B10G10R10` 格式选择原因（10bit 法线压缩）

**产出**：
- [ ] 能画出 BasePass → LightingPass → ShadowPass 数据流
- [ ] 能解释半透明物体无法用延迟渲染的原因

---

## Phase 3：Nanite — GPU-Driven 渲染系统

**文件**：[UE5-Source-Code-Rendering-Phase3-Nanite](./UE5-Source-Code-Rendering-Phase3-Nanite.md)

**前置**：Phase 2 GBuffer/ShadowPass

**核心目标**：理解 UE 如何用 GPU 替代 CPU 做几何处理

**关键概念**：
- Cluster（簇）：Nanite 的基本处理单元，128-256 三角/个
- Cluster BVH：GPU 侧层级包围体结构
- Hardware Rasterizer（SM6+）vs Software Fallback
- Nanite 的 4 大局限（不支持透明/动画/程序化）

**产出**：
- [ ] 能区分 Cluster LOD 和传统离散 LOD 的本质区别
- [ ] 能在 RenderDoc 里找到 Nanite Pass

---

## Phase 4：Lumen — 即时全局光照

**文件**：[UE5-Source-Code-Rendering-Phase4-Lumen](./UE5-Source-Code-Rendering-Phase4-Lumen.md)

**前置**：Phase 2 GBuffer + Phase 3 Nanite

**核心目标**：理解 UE 如何在无硬件光追条件下实现动态 GI

**关键概念**：
- Screen Space Ray Marching（通用路径，无需 RTX）
- Hardware Ray Tracing（需要 RTX GPU）
- Surface Cache + Card：间接光照数据结构
- Temporal Reprojection：时序重投影降噪
- Lumen + Nanite 协作（Nanite 提供深度 → Lumen 做 Trace）

**产出**：
- [ ] 能解释 Screen Space Trace 的原理和局限
- [ ] 能说出 Surface Cache 的作用

---

## Phase 5：体积云与大气渲染

**文件**：[UE5-Source-Code-Rendering-Phase5-Volumetric-Fog](./UE5-Source-Code-Rendering-Phase5-Volumetric-Fog.md)

**前置**：Phase 2 GBuffer + Phase 4 Lumen

**核心目标**：理解体积介质的光照计算

**关键概念**：
- 体积渲染方程（连续形式 + 离散 Ray Marching）
- Beer-Lambert 定律：光线穿过体积的衰减
- UE 的 3D Grid 结构（128×128×64 Voxel）
- FBM / Worley 噪声构建密度场
- 单次散射 vs 多次散射（Dipole Approximation）
- VSM 在体积雾光照中的作用

**产出**：
- [ ] 能写出体积渲染方程的离散形式
- [ ] 能解释 Beer-Lambert 和 transmittance 的含义

---

## Phase 6：Virtual Shadow Map — 超大场景阴影映射

**文件**：[UE5-Source-Code-Rendering-Phase6-Virtual-Shadow-Map](./UE5-Source-Code-Rendering-Phase6-Virtual-Shadow-Map.md)

**前置**：Phase 2 ShadowPass + Phase 3 Nanite

**核心目标**：理解 UE 如何用虚拟内存思想解决大场景阴影问题

**关键概念**：
- 传统 CSM 的问题（近远精度取舍）
- Virtual Shadow Map = 虚拟内存思想（Page Table 映射）
- Page Table：虚拟坐标 → 物理坐标映射
- Clipmap：多层精度管理（跟随相机滚动更新）
- VSM + Nanite 协作（GPU 侧 Cluster 裁剪）

**产出**：
- [ ] 能解释 VSM 和传统 CSM 的本质区别
- [ ] 能在 RenderDoc 里找到 VSM Pass

---

## 源码导航速查

| 系统 | 核心文件 | Shader 文件 |
|---|---|---|
| 渲染器架构 | `SceneRenderer.cpp` `SceneRendering.cpp` | — |
| GBuffer | `DeferredShadingRenderer.cpp` | `BasePass.usf` `DeferredShading.usf` |
| Nanite | `NaniteClusterCulling.cpp` `NaniteRasterizer.cpp` | `NaniteClusterCulling.usf` |
| Lumen | `LumenSceneRenderer.cpp` `LumenSurfaceCache.cpp` | `LumenScreenSpaceTracing.usf` |
| 体积云 | `VolumetricFog.cpp` | `VolumetricFogShaders.usf` |
| VSM | `VirtualShadowMap.cpp` `VirtualShadowMapCache.cpp` | `VirtualShadowMapSampling.usf` |

---

## 通用调试工具

| 工具 | 用途 |
|---|---|
| **RenderDoc** | 抓帧分析每个 Pass 的输入/输出/RT |
| **UE FVisualizeTexture** | 控制台输入 `VisualizeTexture` 查看中间 RT |
| **UE Prof文科** | `Stat UNIT` 显示帧时间分解 |
| **PIX** | Windows 官方 GPU 调试工具（DX12 专用） |
| **NVIDIA Nsight Graphics** | 逐帧 GPU 性能分析 |

---

## 后续深入方向建议

完成全部 6 个 Phase 后，可以按兴趣选择深入方向：

### 方向 A：TA（技术美术）
- Niagara（粒子系统）源码阅读
- Material Editor 节点编译原理
- Custom HLSL 节点写法

### 方向 B：引擎程序
- RenderCore 模块深度
- RHI（渲染硬件接口）抽象层
- AssetRegistry 与异步加载

### 方向 C：渲染研究
- SIGGRAPH 论文 + UE 实现对照
- 毛发渲染（Hair / Groom）
- 水面渲染（Ocean / Water System）

---

## 附录：相关笔记

- [DirectX12-Learning-Plan](./DirectX12-Learning-Plan.md) — DX12 基础
- [CMU 15-445 BusTub](../Database/CMU%2015-445%20BusTub/) — 数据库（辅助理解显存管理）
