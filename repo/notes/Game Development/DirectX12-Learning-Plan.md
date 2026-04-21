# DirectX 12 计算机图形与渲染学习计划

> 学习路线：传统图形 API 基础 → 现代游戏引擎（UE5）进阶  
> 制定日期：2026-04-21  
> 学习顺序：DX12 最小闭环 → UE5 渲染系统源码

---

## 一、两条路线的对比分析

### 传统路线（D3D12 / Vulkan / OpenGL）

| 维度 | 评价 |
|---|---|
| **底层理解** | ✅ 深入硬件抽象层，理解 GPU 如何接收指令 |
| **学习曲线** | 极陡，300 行代码只能画个三角形 |
| **产出速度** | 慢（6-12 个月才能渲染完整 3D 场景） |
| **适合人群** | 图形学研究者、想彻底打扎实基础的人 |
| **就业面** | 相对窄（但稀缺性高） |

### UE5 源码路线

| 维度 | 评价 |
|---|---|
| **底层理解** | ⚠️ 容易浮在 API 层，依赖引擎封装 |
| **学习曲线** | 较平缓，能快速看到炫酷效果 |
| **产出速度** | 快（2-3 个月能做完整场景） |
| **适合人群** | 想进游戏行业、目标明确的求职者 |
| **就业面** | ✅ 国内游戏厂需求大（腾讯/网易/米哈游等） |

### 推荐方案：混合路线

- **Phase 1**：DX12 最小闭环 + 图形学基础（2-3 个月）
- **Phase 2**：UE5 渲染系统源码深攻（3-4 个月）
- **Phase 3**：按方向（TA / 引擎 / 渲染研究）选一个死磕

---

## 二、学习工具链

| 用途 | 工具 |
|---|---|
| **GPU** | GTX 1000 系列以上（不需要专业卡，DX12 兼容即可） |
| **IDE** | Visual Studio 2022 |
| **SDK** | Windows SDK（随 VS2022 内置） |
| **官方示例** | [directx-sdk-samples](https://github.com/walbourn/directx-sdk-samples) |
| **调试工具** | RenderDoc + Visual Studio Graphics Debugger |
| **参考文档** | [Microsoft DirectX 12 官方文档](https://learn.microsoft.com/en-us/windows/win32/direct3d12/directx-12-programming) |

### 环境验证命令

```powershell
# 检查 Windows 版本（需要 Win10 1809+）
winver

# 检查显卡支持 DX12 等级
dxdiag -direct
```

### 下载官方示例集备用

```bash
git clone https://github.com/walbourn/directx-sdk-samples.git
```

---

## 三、推荐教材

### 必买书籍

| 书名 | 用途 | 优先级 |
|---|---|---|
| 《Introduction to 3D Game Programming with DirectX 12》— Frank Luna | 主教材，从环境搭建到完整渲染器，代码可跑通 | ⭐⭐⭐⭐⭐ |
| 《Real-Time Rendering 4th Edition》 | 图形学百科全书，前 12 章打底基础 | ⭐⭐⭐⭐⭐ |
| 《Computer Graphics Principles and Practice》— Foley & van Dam | 经典教材，数学和理论部分写得极清楚 | ⭐⭐⭐⭐ |
| 《Advanced Graphics Programming Using OpenGL》 | 老但核心概念扎实，可当补充 | ⭐⭐⭐ |

### 免费课程

| 课程 | 来源 | 用途 |
|---|---|---|
| GAMES101 / GAMES104 / GAMES201 | 闫令琪 / 刘利刚团队，B站 | 投影/光栅化/纹理映射核心概念 + 高级渲染 |
| TU Wien Rendering Lectures | YouTube | SIGGRAPH 强度训练 |

### UE 源码导航

```
UnrealEngine/Engine/Shaders/Private/     ← Shader 源码
UnrealEngine/Engine/Source/Runtime/RenderCore/  ← 渲染核心
UnrealEngine/Engine/Source/Developer/DeviceManager/  ← Profiling 工具
```

---

## 四、详细学习计划（16 周）

### Phase 1：DX12 最小闭环 + 图形学基础（Week 1-8）

---

#### Week 1-2：环境搭建 + 理解 DXGI

**目标**：跑通第一个 DX12 程序，理解 DXGI 核心对象

**学习内容**：
- 安装 VS2022 + Windows SDK
- 跑通 Frank Luna 第 1 章：Frame Loop
- 理解核心对象三角关系：

```
DXGI Factory → Adapter → Device → CommandQueue
              → CommandList → CommandAllocator → Fence
```

**产出**：`HelloDX12.exe` — 能展示一个纯色窗口的 DX12 程序

**环境检查**：
```powershell
# 确认 DirectX 版本
dxdiag -direct
# 输出应包含 "DirectX Version: 12"
```

---

#### Week 3-4：渲染管线基础

**目标**：理解 DX12 渲染管线的每个阶段

**学习内容**：
- CommandList / CommandAllocator / Fence 三角关系
- 创建第一个 Pipeline State Object（PSO）
- 顶点缓冲（Vertex Buffer）+ 索引缓冲（Index Buffer）
- Viewport + ScissorRect
- 管线状态切换（Pipeline State Switching）

**核心概念**：
```
输入汇编器（IA）
  → 顶点着色器（VS）
  → 图元装配（Primitive Assembly）
  → 栅格化（RS）
  → 像素着色器（PS）
  → 输出合并（OM）
      → Render Target View (RTV)
      → Depth Stencil View (DSV)
```

**产出**：渲染一个彩色三角形（RGB 渐变）

---

#### Week 5-6：纹理 + 着色器基础

**目标**：掌握 HLSL 语法和资源绑定机制

**学习内容**：
- HLSL 语法：Semantic、Register、ConstantBuffer、cbuffer/tbuffer
- SamplerState：线性/点采样、地址模式（Wrap/Clamp）
- 资源视图：SRV（Shader Resource View）、UAV（Unordered Access View）
- Descriptor Heap：CBV/SRV/UAV Heap 布局管理
- 加载 DDS 纹理（DirectXTex 库）
- 渲染纹理贴图的 2D Quad（Fullscreen Triangle 优化）

**产出**：渲染一张纹理贴图的 2D 场景

---

#### Week 7-8：3D 变换 + 摄像机

**目标**：建立真正的 3D 世界

**学习内容**：
- 矩阵变换三件套：World / View / Projection
- 右手坐标系摄像机构建
- 常量缓冲区（Constant Buffer）更新机制
- Dynamic Buffer（CPU 侧-upload heap） vs Static Buffer（GPU 侧-default heap）
- CPU-GPU 同步：Fence / Event

**产出**：带旋转动画的 3D Cube

---

#### Week 9-10：光照 + PBR 基础

**目标**：理解真实感渲染的核心算法

**学习内容**：
- Lambert 漫反射模型
- Blinn-Phong 高光模型
- 纹理法线采样（Normal Map / Tangent Space）
- 深度缓冲（Z-Buffer）测试原理
- MSAA 多重采样抗锯齿
- 纹理混合（Alpha Blending / 混合状态）

**产出**：带光照和法线贴图的 Cube 场景 + 地板

---

#### Week 11-12：延迟渲染入门（Deferred Rendering）

**目标**：理解现代游戏引擎的渲染架构

**学习内容**：
- GBuffer 结构设计：
  ```
  GBuffer A: Albedo (RGB) + Roughness (A)
  GBuffer B: Normal (RGB)
  GBuffer C: Metallic (R) + Height (G)
  GBuffer D: Depth (R)
  ```
- 延迟光照 Pass（Fullscreen Quad）
- Descriptor Table 布局管理
- 帧间资源回收（Resource State Barriers）
- SRV Descriptor Heap 和 RTV/DSV Descriptor Heap 分离

**产出**：完整 GBuffer + Deferred Lighting 渲染器

---

#### Week 13-16：进阶主题（选 1-2 个深入）

**方向 A — 光线追踪（DXR 1.0）**

- DXR API 四层结构：State Object / Raytracing Pipeline / Shader Table / Bottom-Level AS
- 基础光线求交（Ray-Sphere / Ray-Triangle）
- 阴影射线（Shadow Ray）+ 反射射线（Reflection Ray）
- BVH 加速结构
- 产出：支持光线追踪反射和阴影的 Demo

**方向 B — 计算着色器（Compute Shader）**

- UAV 随机写入 + Append/Consume Buffer
- GPU Particle System（万级粒子）
- Parallel Reduction（归约算法）
- 产出：基于 GPU 计算的粒子系统 Demo

**方向 C — Tiled Rendering + PBR**

- Forward+ / Tiled Lighting 原理
- 物理材质（PBR）：Cook-Torrance BRDF
- Image-Based Lighting（IBL）：环境贴图采样
- 产出：支持 PBR + IBL 的 Demo

---

## 五、UE5 渲染系统源码阅读路径

> 前提：已完成 Phase 1，能跑通 UE5 完整场景（Nanite + Lumen）

### Level 1：理解渲染器架构

```
FSceneRenderer / FDeferredShadingSceneRenderer
  → UE 如何组织一帧的渲染流程
  → 入口函数：Render()
```

**工具**：RenderDoc 抓帧 Lyra 官方案例，逐 Pass 对照源码

```
FVisualizeTexture
  → 看到每个 Pass 实际输出了什么
```

### Level 2：核心渲染 Pass

#### 2.1 延迟光照管线

```
FDeferredShadingRenderer::Render()
  → GBuffer 怎么拼
  → 深度怎么复用
  → 光怎么叠（BasePass → LightingPass → ShadowPass）
```

#### 2.2 Nanite（GPU-Driven 渲染）

```
UNaniteApproxMask / NaniteRasterizer
  → Cluster BVH 构建
  → Hardware Rasterizer 使用
  → Fallback Rasterizer（不支持硬件光栅时的软件路径）
```

#### 2.3 Lumen（即时全局光照）

```
FLumenSceneRenderer / LumenHardwareRayTracing
  → Screen Space GI
  → Surface Cache
  → Hardware Ray Tracing vs Software Ray Tracing
```

### Level 3：高级主题（按需选一个深入）

#### Volumetric Cloud（体积云）

```
FHeightFogScattering / RenderHyperscan
  → 体积渲染方程
  → 光线步进（Ray Marching）
  → 多重散射近似
```

#### Virtual Shadow Map（虚拟阴影图）

```
FVirtualShadowMapCache
  → 超大场景阴影映射
  → Page Table 管理
  → Clipmap 层级
```

#### Hair / Groom（毛发渲染）

```
FHairStrandsRasterize
  → AMD TressFX 原版 vs UE 实现差异
  → 纤维渲染物理模型
```

### UE 源码阅读方法

1. **从入口追踪**：找到 `FSceneRenderer::Render()` 入口，顺着数据流往下追
2. **RenderDoc 配合**：先抓帧官方案例，看到每个 Pass 实际干了什么，再回去读源码
3. **不要从头读**：UE 源码量级极大，找到入口函数后顺着调用的函数名猜意图
4. **写文档沉淀**：每搞懂一个系统，用自己的话写文档（存入 nolebase 知识库）

---

## 六、学习时间总览

```
Month 1:   Week 1-4（DX12 环境 → 彩色三角形 → 纹理 Quad）
Month 2:   Week 5-8（3D Cube → 光照 → PBR 基础）
Month 3:   Week 9-12（Deferred Rendering → GBuffer）
Month 4:   Week 13-16（选一个方向深入 + 开始 UE 源码）
Month 5-6: UE 源码 Level 1-2（渲染器架构 + 核心 Pass）
Month 7+:  按方向深耕（TA / 引擎 / 渲染研究）
```

---

## 七、产出目标

| 阶段 | 产出物 |
|---|---|
| Week 4 | DX12 彩色三角形 + 纹理 Quad |
| Week 8 | 带光照的 3D Cube 场景 |
| Week 12 | 完整 Deferred Rendering 渲染器 |
| Week 16 | 选型方向完整 Demo（如 GPU Particle System 或 DXR Demo） |
| Month 5-6 | UE 渲染系统架构文档（存入 nolebase） |

---

## 八、常见坑与解决方案

### DX12 编译报错：LNK2019 / LNK1120

- **原因**：lib 链接顺序错误，或缺少 `d3d12.lib` + `dxgi.lib`
- **解决**：`#pragma comment(lib, "d3d12.lib")` + `#pragma comment(lib, "dxgi.lib")`

### DXGI ERROR: IDXGIFactory::CreateSwapChain

- **原因**：CommandQueue 和 SwapChain 创建顺序问题，或 HR 功能等级不匹配
- **解决**：先创建 Device，再创建 CommandQueue，最后创建 SwapChain

### RenderDoc 无法捕获 DX12 应用

- **原因**：RenderDoc 默认不 Hook 启动的进程
- **解决**：在 RenderDoc UI 中手动 Inject，或用 `vkEnumerateInstanceVersion` 确认捕获状态

### RTV/DSV DescriptorHeap 满了

- **原因**：每帧创建了新的 Descriptor，导致累积
- **解决**：使用 `Reset()` 复用，或增大 Heap Size（通常 256-1024 足够）

### Fence 同步失效（GPU 指令发出但 CPU 等待失败）

- **原因**：`Signal()` 和 `Wait()` 用的 Fence 值不匹配
- **解决**：`Wait()` 的值必须 >= `Signal()` 的值，否则立刻返回

---

## 九、附录

### 相关笔记

- [Go Game Server](../Go%20Game%20Server/) — 游戏服务端参考
- [CMU 15-445 BusTub](../Database/CMU%2015-445%20BusTub/) — 数据库系统（辅助理解显存管理）

### 参考链接

- [DirectX-SDK-Samples](https://github.com/walbourn/directx-sdk-samples)
- [Microsoft DirectX 12 官方文档](https://learn.microsoft.com/en-us/windows/win32/direct3d12/directx-12-programming)
- [Frank Luna DX12 书籍配套资源](http://www.d3dcoder.net/)
- [RenderDoc](https://renderdoc.org/)
- [GAMES 课程](https://games-cn.org/)
