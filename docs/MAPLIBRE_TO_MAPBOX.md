# MapLibre 至 Mapbox 三维地图替换技术方案

> 版本：V1.0  
> 项目：台风巴威路径查询与可视化系统  
> 目标：在保留现有业务、数据、页面布局和部署架构的前提下，将二维 MapLibre 地图替换为基于 Mapbox GL JS Globe 的三维台风场景。

## 1. 背景与目标

当前项目采用原生 TypeScript、Vite、MapLibre GL JS 和 Cloudflare Workers，已经具备实时台风数据、历史路径、机构预报路径、四象限风圈、路径回放、城市影响分析、资讯和移动端适配。

本次替换不重写整个前端，也不同时迁移 Vue。改造重点是将地图渲染层从 MapLibre GL JS 切换到 Mapbox GL JS 3.x，并增加：

- Globe 三维地球投影
- 星空、大气层和地平线效果
- Mapbox Standard Satellite 底图
- 可选三维地形
- GLB/glTF 台风模型
- 模型沿路径平滑运动、旋转和缩放
- 自由、跟随、演示三种镜头模式
- 三维场景下的路径、风圈、标签和交互

现有实时数据源、Cloudflare Worker、台风影响计算、资讯、应急指南、分享、海报和页面视觉体系原则上保持不变。

## 2. 改造原则

1. **地图引擎与业务解耦**：`app.ts` 不直接调用 Mapbox API。
2. **统一播放时间**：模型、风圈、路径、HUD 和镜头都使用同一个 `TrackState`。
3. **渐进替换**：先完成技术验证，再迁移生产地图。
4. **保留回退路径**：迁移完成前保留旧 MapLibre 实现。
5. **优先原生图层**：Globe 模式下优先使用 Mapbox `model` 图层，不以 Three.js Custom Layer 为核心方案。
6. **移动端主动降级**：低性能设备可关闭地形、阴影和部分光效。
7. **不改变数据语义**：风圈半径继续使用公里，经纬度继续使用 WGS84，时间继续使用时间戳和 ISO 字符串。

## 3. 改造范围

### 3.1 保留

- `worker/` 数据请求、标准化、缓存和定时任务
- `src/types.ts` 的主体数据结构
- `src/impact.ts` 城市影响计算
- `src/intensity.ts` 强度与颜色体系
- `src/guide.ts`、`src/news.ts`、`src/official.ts`
- `src/share.ts`、`src/poster.ts`
- `src/mobile.ts` 的页面布局逻辑
- `index.html` 的主体结构
- `src/style.css` 的整体视觉系统
- Cloudflare Workers + Assets 部署方式

### 3.2 重构

- `src/app.ts` 中的 `Playback`：抽成独立播放引擎
- `src/map.ts`：拆分为地图场景、图层和镜头模块
- `src/geo.ts`：增加球面插值、跨日期变更线处理和方位角
- 地图初始化、底图、图层顺序和样式生命周期
- 台风中心的 DOM Marker 实现
- 地图相关 CSS 类名

### 3.3 新增

- Mapbox 环境变量和 Token 校验
- 三维模型资源和加载失败降级
- 图层可见性控制
- 镜头模式控制器
- 地图能力检测和性能档位
- 地图引擎契约与可替换实现

## 4. 目标架构

```text
Cloudflare Worker / 静态数据
              │
              ▼
       TyphoonRepository
              │
              ▼
       标准 TyphoonData
              │
       ┌──────┴─────────┐
       ▼                ▼
 PlaybackEngine     业务功能
       │          影响/资讯/指南
       ▼
   TrackState
       │
  ┌────┼───────────────┐
  ▼    ▼               ▼
 HUD  TyphoonScene  Timeline
       │
       ├── TrackLayer
       ├── ForecastLayer
       ├── WindCircleLayer
       ├── TyphoonModelLayer
       ├── PulseLayer
       ├── LabelLayer
       └── CameraController
```

核心约束：

- `PlaybackEngine` 不导入 `mapbox-gl`。
- `TyphoonScene` 只接收标准业务数据和 `TrackState`。
- 每个地图图层模块只管理自己的 Source、Layer 和更新节奏。
- Mapbox 样式重新加载后，场景能够自动恢复业务图层。

## 5. 建议目录结构

```text
src/
├── animation/
│   ├── PlaybackEngine.ts
│   ├── AnimationScheduler.ts
│   └── playbackTypes.ts
├── geo/
│   ├── interpolation.ts
│   ├── bearing.ts
│   ├── windCircle.ts
│   └── longitude.ts
├── map/
│   ├── contracts.ts
│   ├── createTyphoonScene.ts
│   ├── mapbox/
│   │   ├── MapboxTyphoonScene.ts
│   │   ├── mapboxStyle.ts
│   │   ├── layerOrder.ts
│   │   ├── capability.ts
│   │   ├── camera/
│   │   │   └── CameraController.ts
│   │   └── layers/
│   │       ├── TrackLayer.ts
│   │       ├── ForecastLayer.ts
│   │       ├── WindCircleLayer.ts
│   │       ├── TyphoonModelLayer.ts
│   │       ├── PulseLayer.ts
│   │       └── LabelLayer.ts
│   └── maplibre/
│       └── LegacyMapLibreScene.ts
├── assets/
│   └── models/
│       └── typhoon.glb
└── app.ts
```

迁移期间可以将当前 `src/map.ts` 移入 `src/map/maplibre/LegacyMapLibreScene.ts`。最终是否删除旧实现，在 Mapbox 版本验收后决定。

## 6. 核心接口

### 6.1 地图场景接口

```ts
export type CameraMode = "free" | "follow" | "presentation";

export interface LayerVisibility {
  model: boolean;
  historyTrack: boolean;
  forecasts: boolean;
  points: boolean;
  wind7: boolean;
  wind10: boolean;
  wind12: boolean;
  labels: boolean;
  terrain: boolean;
}

export interface TyphoonScene {
  initialize(): Promise<void>;
  setData(data: TyphoonData): void;
  renderFrame(state: TrackState, frame: RenderFrame): void;
  setLayerVisibility(next: Partial<LayerVisibility>): void;
  setCameraMode(mode: CameraMode): void;
  fitToData(): void;
  focusCity(name: string): void;
  resize(): void;
  destroy(): void;
}

export interface RenderFrame {
  time: number;
  progress: number;
  playing: boolean;
  deltaMs: number;
}
```

### 6.2 图层接口

```ts
export interface SceneLayer {
  add(): void;
  setData(data: TyphoonData): void;
  update(state: TrackState, frame: RenderFrame): void;
  setVisible(visible: boolean): void;
  remove(): void;
}
```

图层可按自身需要实现更新节流，避免主循环了解每个图层的性能细节。

### 6.3 播放引擎

```ts
export interface PlaybackSnapshot {
  status: "idle" | "playing" | "paused" | "ended";
  currentTime: number;
  startTime: number;
  endTime: number;
  progress: number;
  speed: 0.5 | 1 | 2 | 4;
  loop: boolean;
}
```

播放引擎负责：

- 播放、暂停、拖动、倍速和循环
- 页面不可见时暂停推进
- 发布当前时间和帧间隔

播放引擎不负责：

- 更新地图 Source
- 控制镜头
- 更新 DOM
- 计算台风空间状态

`app.ts` 订阅播放状态，计算一次 `TrackState`，再同时交给 HUD 和 `TyphoonScene`。

## 7. Mapbox 场景设计

### 7.1 初始化

```ts
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const map = new mapboxgl.Map({
  container,
  style: import.meta.env.VITE_MAPBOX_STYLE
    ?? "mapbox://styles/mapbox/standard-satellite",
  projection: "globe",
  center: [138, 18],
  zoom: 3.5,
  pitch: 35,
  bearing: 0,
  antialias: true,
  attributionControl: true,
});
```

生产环境变量：

```env
VITE_MAPBOX_TOKEN=pk.xxxxx
VITE_MAPBOX_STYLE=mapbox://styles/mapbox/standard-satellite
```

Token 只使用公开读取权限，并配置生产域名限制。仓库中提供 `.env.example`，不提交真实 Token。

### 7.2 Globe 与大气层

在 `style.load` 后配置：

```ts
map.setFog({
  color: "rgb(18, 29, 54)",
  "high-color": "rgb(25, 54, 108)",
  "horizon-blend": 0.035,
  "space-color": "rgb(4, 7, 15)",
  "star-intensity": 0.55,
});
```

大气层颜色应与当前深海夜色 CSS 变量保持一致，避免地图和面板视觉割裂。

### 7.3 三维地形

地形作为可选能力：

- 桌面高性能档默认开启
- 移动端默认关闭
- 模型或图层出现兼容问题时自动关闭
- 用户可通过图层控制手动切换

地形启用后限制夸张系数，避免台风路径与海岸附近地形产生明显视觉冲突。

### 7.4 图层顺序

建议顺序：

1. Mapbox Standard Satellite
2. 地形和底图三维内容
3. 七级风圈
4. 十级风圈
5. 十二级风圈
6. 历史路径光晕
7. 历史路径主体
8. 预测路径
9. 路径节点
10. 台风模型
11. 中心脉冲
12. 台风名称标签
13. 城市影响标记
14. 交互高亮

使用 Mapbox Standard 时，业务图层通过公开 `slot` 插入，不依赖 Standard 内部图层 ID。

## 8. 台风三维模型

### 8.1 实现方式

使用一个 GeoJSON Point Source 表示台风中心，配合 Mapbox 原生 `model` Layer 加载 GLB/glTF。

模型状态来源：

- 坐标：`TrackState.lng/lat`
- 朝向：相邻路径点计算的球面方位角
- 尺寸：台风强度等级 + 当前缩放级别
- 颜色：统一复用 `intensity.ts`
- 自转：基于动画时间计算
- 高度：使用轻微离地偏移，避免与地表穿插

### 8.2 模型资源规范

- GLB 文件目标小于 3 MB，上限 5 MB
- 尽量使用少量材质和纹理
- 纹理建议不超过 2048×2048
- 模型原点位于台风中心
- 记录模型正前方轴和竖直轴
- 不依赖骨骼动画作为第一阶段必要能力
- 提供低多边形版本

### 8.3 模型降级

模型加载失败或设备能力不足时：

1. 隐藏 `model` Layer
2. 显示现有风眼图标或 Mapbox Symbol/Circle
3. 保留风圈、路径、HUD 和播放能力

任何模型错误都不能阻塞数据和信息面板。

## 9. 动画与空间计算

### 9.1 位置插值

当前线性经纬度插值升级为球面插值：

- 使用相邻节点按时间比例插值
- 经度采用最短跨越方向
- 正确处理 `180°/-180°`
- 根据相邻坐标计算方位角
- 对朝向进行角度最短路径插值
- 节点检索由线性扫描改为二分查找

### 9.2 更新频率

| 内容 | 目标频率 | 更新条件 |
|---|---:|---|
| 模型位置 | 30～60 FPS | 每个有效动画帧 |
| HUD 数值 | 20～30 FPS | 数值或时间变化 |
| 呼吸光圈 | 30 FPS | 减少动态偏好关闭 |
| 风圈 | 10～15 FPS | 节流更新 |
| 路径进度 | 节点/阈值触发 | 不每帧重建全部 Feature |
| 跟随镜头 | 15～30 FPS | 跟随模式开启 |
| 演示镜头 | 30 FPS | 演示模式开启 |

### 9.3 路径优化

不再每帧从第一个节点重新构造所有历史路径。

建议：

- 初始化时缓存所有完整分段 Feature
- 播放时只更新当前段坐标
- 跨过新节点时才扩展已完成路径
- 拖动时间轴时根据目标索引一次性重建
- 预测路径使用独立 Source，不随历史播放频繁更新

### 9.4 风圈优化

- 风圈半径继续在相邻节点间插值
- 风圈更新限制为 10～15 FPS
- 缓存节点对应的完整风圈
- 中间状态才实时生成球面多边形
- 移动端可将每象限采样步长从 3° 调整为 6°

## 10. 镜头系统

### 10.1 自由模式

- 用户完全控制旋转、缩放、倾斜
- 播放不修改镜头
- 当前台风继续正常运动

### 10.2 跟随模式

- 镜头中心平滑跟随台风
- 保持当前缩放、倾角和方位
- 用户主动拖动后暂时切回自由模式
- 可提供“恢复跟随”按钮

### 10.3 演示模式

- 根据台风移动方向调整 bearing
- 根据风圈尺寸和移动速度调整 zoom
- 保持适度 pitch
- 使用阻尼插值，禁止每帧直接 `flyTo`
- 用户交互立即退出演示模式

### 10.4 初始镜头

加载数据后：

1. 计算历史与预测路径范围
2. 估算面板遮挡对应的地图 padding
3. 使用区域视角展示完整路径
4. Globe 低缩放下避免过大的左右 padding
5. 动画开始时可平滑进入台风当前区域

## 11. UI 调整

保留当前 HUD、资讯抽屉和底部时间轴，在此基础上增加：

- 地图主题选择
- 图层控制
- 三维地形开关
- 镜头模式选择
- 模型显示开关
- 循环播放开关
- 上一个/下一个节点

移动端：

- 图层控制放入底部抽屉
- 默认关闭地形和模型阴影
- 保留自由/跟随两种镜头模式
- 演示模式可以隐藏或降级

## 12. 样式生命周期

Mapbox 切换主题会重新加载 Style，业务 Source 和 Layer 可能被清空。

`MapboxTyphoonScene` 必须：

- 监听 `style.load`
- 重新配置 Fog、Terrain 和 Standard 配置
- 重新添加业务 Source 和 Layer
- 恢复当前 `TyphoonData`
- 恢复图层可见性
- 恢复当前 `TrackState`
- 防止重复注册事件

地图未完成初始化时收到的数据更新，应先缓存，待场景就绪后统一应用。

## 13. 性能档位

```ts
type PerformanceTier = "high" | "balanced" | "low";
```

### High

- 模型、地形、阴影、完整光效
- 风圈 15 FPS
- 模型最高 60 FPS

### Balanced

- 模型开启、地形可选、阴影关闭
- 风圈 10 FPS
- 模型 30 FPS

### Low

- 使用二维风眼符号替代模型
- 地形关闭
- 光圈简化或关闭
- 风圈降低采样密度
- 地图像素比限制为 1～1.5

档位可综合判断：

- 屏幕尺寸
- `devicePixelRatio`
- `navigator.deviceMemory`（存在时）
- `prefers-reduced-motion`
- 运行时帧率

运行时连续低于目标帧率时只允许向下自动降级，不自动向上恢复，避免画面反复切换。

## 14. 错误处理与降级

| 故障 | 处理 |
|---|---|
| Token 缺失 | 显示明确配置错误，不初始化 Mapbox |
| Mapbox Style 加载失败 | 显示地图错误条，业务面板继续工作 |
| 卫星底图失败 | 尝试备用 Mapbox 样式 |
| GLB 加载失败 | 降级为二维风眼符号 |
| Terrain 加载失败 | 自动关闭地形 |
| WebGL 上下文丢失 | 提示并尝试恢复场景 |
| GeoJSON 更新异常 | 保留上一帧有效状态 |
| 移动端帧率过低 | 切换到 Low 档 |

## 15. 安全、费用与合规

### Token

- 仅使用 Mapbox 公开 Token
- 限制允许访问的域名
- 开发和生产使用不同 Token
- 不将秘密权限放入前端

### 费用

- 页面只创建一个 Map 实例
- 主题切换不重复创建实例
- 配置 Mapbox 用量提醒
- 记录地图加载量和异常增长

### 地图合规

正式面向中国大陆用户发布前，需要单独评估：

- Mapbox 服务可达性
- 底图数据和审图要求
- 坐标体系与境内标注合规
- 当前高德中文注记替换后的展示差异

此项属于上线前置审查，不应仅以技术可运行作为发布依据。

## 16. 测试方案

### 16.1 单元测试

- 跨 `180°` 经线插值
- 球面方位角
- 朝向角度插值
- 风圈四象限生成
- 播放时钟和循环
- 二分节点查找
- 图层节流器

### 16.2 集成测试

- Mapbox 初始化成功
- Style 重载后业务图层恢复
- 模型加载失败降级
- 播放、暂停、拖动和倍速
- 路径、风圈、模型和 HUD 同步
- 自由、跟随、演示模式切换
- 页面隐藏后停止动画
- WebGL 上下文恢复

### 16.3 视觉与浏览器测试

- Chrome、Edge、Safari、Firefox
- macOS、Windows、iOS、Android
- 桌面宽屏、平板、手机竖屏、手机横屏
- 深色卫星底图文字可读性
- 模型在全球、区域和近景缩放下的比例
- 地形开启和关闭时的图层遮挡

### 16.4 性能测试

- 普通桌面目标：45～60 FPS
- 中端手机目标：不低于 25～30 FPS
- 单轨迹 1,000 节点
- 连续播放 20 分钟无明显内存增长
- 切换主题 10 次无重复 Source、Layer 或事件
- 首屏可交互时间不超过 5 秒

## 17. 实施阶段

### 阶段 A：技术验证

交付：

- 独立 Mapbox Globe 场景
- 当前巴威数据路径
- 七级、十级、十二级风圈
- 一个 GLB 模型沿路径运动
- 基本跟随镜头
- 桌面和手机性能记录

退出条件：

- Globe、Model 和 GeoJSON 图层可共同工作
- 模型移动无明显抖动
- 中端手机具有可接受降级方案

### 阶段 B：架构解耦

交付：

- `PlaybackEngine`
- `TyphoonScene` 接口
- MapLibre 旧场景适配
- Mapbox 新场景实现
- 球面插值和二分检索

退出条件：

- 上层业务可在不修改业务逻辑的情况下切换地图实现
- 旧地图功能无明显回归

### 阶段 C：完整图层迁移

交付：

- 历史路径、预测路径、节点、风圈
- 台风模型、光圈、标签
- 城市标记和弹窗
- 图层控制和地图主题
- 三种镜头模式

退出条件：

- 现有地图能力全部覆盖
- 新增三维能力完成

### 阶段 D：性能与移动端

交付：

- 更新节流
- 性能档位
- 模型和地形降级
- 移动端交互优化
- 可访问性和减少动态适配

### 阶段 E：灰度与切换

交付：

- 默认使用 Mapbox
- 保留 MapLibre 回退开关
- 错误与性能监控
- Token 域名限制和用量提醒

稳定后再删除旧 MapLibre 依赖和代码。

## 18. 回滚策略

迁移期间支持构建时切换：

```env
VITE_MAP_ENGINE=maplibre
# 或
VITE_MAP_ENGINE=mapbox
```

工厂函数：

```ts
export function createTyphoonScene(container: string): TyphoonScene {
  return import.meta.env.VITE_MAP_ENGINE === "mapbox"
    ? new MapboxTyphoonScene(container)
    : new LegacyMapLibreScene(container);
}
```

如果生产环境出现以下情况，可立即切回 MapLibre：

- Mapbox 服务不可用
- Token 配置异常
- 关键移动设备大量崩溃
- 地图加载量或费用异常
- Globe/模型出现无法快速修复的渲染缺陷

回滚不影响 Worker、实时数据、业务面板和部署架构。

## 19. 验收标准

1. 页面显示可旋转的三维地球、大气层和星空。
2. 当前实时台风数据可以正常加载。
3. 历史和预测路径正确显示。
4. 三层四象限风圈随时间平滑变化。
5. GLB 模型沿路径运动，朝向和尺寸随状态变化。
6. 模型加载失败时可自动降级。
7. 时间轴、播放、暂停、倍速和拖动正常。
8. HUD、模型、路径和风圈使用同一时间状态。
9. 支持自由、跟随和演示镜头。
10. 用户操作时不会与自动镜头争夺控制权。
11. Style 重载后业务图层能够恢复。
12. 移动端有明确性能降级策略。
13. 连续播放无明显资源泄漏。
14. 地图异常不影响应急指南和台风数据面板。
15. 可通过环境变量切回旧 MapLibre 实现。

## 20. 结论

本项目适合采用“保留业务层、替换地图场景层”的渐进式迁移路线。

第一阶段不引入 Vue、Pinia、ECharts 或 Three.js，避免把地图框架替换扩大为全项目重写。Mapbox GL JS 负责 Globe、底图、地形和原生模型；现有 TypeScript 业务模块继续负责数据、播放、影响分析和 UI。

实施优先级为：

1. 验证 Globe + 原生 Model Layer。
2. 抽离播放引擎和地图场景接口。
3. 迁移现有路径、风圈和交互。
4. 增加镜头系统和性能降级。
5. 灰度切换并保留 MapLibre 回滚能力。

只有在模型能力和移动端性能验证通过后，才进入完整生产替换。
