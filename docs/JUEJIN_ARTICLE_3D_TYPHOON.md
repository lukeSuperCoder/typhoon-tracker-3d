# 我把开源台风路径项目升级成了 3D 地球：Blender 云系模型、Mapbox Globe 与多视角运镜实践

> GitHub：[lukeSuperCoder/typhoon-tracker-3d](https://github.com/lukeSuperCoder/typhoon-tracker-3d)  
> 在线体验：[typhoon-tracker-3d.lc970820.workers.dev](https://typhoon-tracker-3d.lc970820.workers.dev/)  
> 访问提示：项目暂未注册独立域名，目前使用 Cloudflare Workers 默认域名，中国大陆网络可能无法直连，可能需要使用网络代理。

## 写在前面：项目来源与致谢

这个项目并不是从零开始的。

它的灵感和业务基础来自掘金文章：
- 原作者: HiSt
- [原掘金文章](https://juejin.cn/post/7659393583027896330)
- [原项目仓库：Trade-Offf/typhoon-bavi-tracker](https://github.com/Trade-Offf/typhoon-bavi-tracker)

原项目已经实现了非常完整的台风信息产品能力，包括实时台风路径、多机构预报对比、7/10/12 级风圈、城市波及倒计时、应急指南、新闻聚合、PWA，以及 Cloudflare Workers 数据代理、缓存和双数据源容灾。

我在学习原文章和代码后，产生了一个新的想法：能不能换一种更直观、更有空间感的视角，让人们更直观感受到台风的尺度、力量与潜在危险？

传统二维平面地图非常适合准确展示路径、风圈和城市位置，但它很难传达台风云系覆盖范围、移动趋势以及逼近陆地时所带来的压迫感。对普通用户来说，地图上的一条线和几个圆圈有时只是抽象的数据，很难立即建立起对灾害规模的感知。

> 如果把台风放到一颗可以旋转、倾斜和跟随观察的三维地球上，让云团沿真实路径向前移动，人们是否能更直观地理解它有多大、正在往哪里去，以及为什么需要提前做好防范？

这正是我开发 3D 升级版本的主要动机。三维化并不只是为了让页面看起来更炫，而是希望借助更强烈的空间层次和视觉表达，把抽象的路径数据转化为更容易理解的灾害过程，让用户在查看信息时对台风保持足够的重视和警觉(ps: 也有一定炫技成分在)。

项目保留原仓库的核心业务能力，重点改造地图渲染层，并新增：

- Mapbox GL JS Globe 三维地球
- 星空、大气层和可选 DEM 地形
- Blender 加工后的 GLB 台风云系模型
- 模型沿台风路径同步移动
- 自由、跟随、演示三种镜头模式
- 历史路径、预报路径、风圈、模型和 HUD 的统一时间轴
- 高画质、均衡、省电三级性能策略
- 模型加载失败时的二维风眼降级

本文不会重复原文章已经介绍过的业务功能，而是重点复盘这次三维化过程中最值得分享的部分：**如何准备一个适合 WebGIS 的 Blender 模型，如何把 GLB 放到 Mapbox Globe 上，以及如何实现模型、路径和多视角镜头的同步。**

---

## 一、为什么从二维地图升级到三维地球

二维地图非常适合准确读取经纬度、风圈和城市距离，但台风本身是一种具有明显空间尺度和运动方向的天气系统。

在二维俯视图里，用户能看到“它在哪里”；切换到三维视角后，还能进一步感受到：

- 台风云团相对于地球曲面的尺度
- 历史路径和预测路径的空间方向
- 镜头从后方跟随时的移动趋势
- 低俯角观察时云层、地形和风圈之间的层次

所以这次升级并不是简单地给地图加一个 `pitch`，而是对渲染层进行了重新划分：

```text
Cloudflare Worker / 台风数据
              │
              ▼
        标准 TyphoonData
              │
              ▼
        PlaybackEngine
              │
              ▼
          TrackState
              │
      ┌───────┼─────────┐
      ▼       ▼         ▼
     HUD    三维模型    镜头控制
              │
      ┌───────┼─────────┐
      ▼       ▼         ▼
    路径     风圈      预报图层
```

关键原则只有一句话：

> 模型、路径、风圈、信息面板和镜头不允许各自计时，它们必须消费同一个 `TrackState`。

如果模型使用自己的 `requestAnimationFrame`，镜头再使用另一个计时器，运行一段时间后一定会发生位置、风圈和 HUD 不同步的问题。

---

## 二、技术选型：为什么使用 Mapbox 原生 model 图层

三维地图中加载 GLB，常见方案有两类：

1. Three.js + Mapbox Custom Layer
2. Mapbox GL JS 原生 `model` Layer

Three.js 的自由度更高，适合骨骼动画、粒子和复杂材质；但这个项目使用的是 Globe 投影，并且需要兼顾移动端、图层生命周期和快速部署。为了减少两套三维坐标系统的转换成本，我最终优先选择 Mapbox 原生 `model` 图层。

这样做的好处是：

- 模型位置直接使用 GeoJSON 经纬度
- 模型天然跟随 Globe 投影
- 不需要维护额外的 Three.js 相机
- 样式、图层显隐和地图生命周期可以统一管理
- GLB 由 Mapbox Worker 加载和解析

需要接受的限制也很明确：

- 不适合复杂的模型内部动画
- 材质和光照调节能力不如完整 Three.js 场景
- 模型原点、尺寸和轴向必须在 Blender 阶段处理好

因此这个项目采用的是“**Blender 负责资产合成，Mapbox 负责整体空间运动**”的分工。

---

## 三、最费时间的部分：把普通 GLB 加工成适合地图的台风模型

### 3.1 模型来源

模型素材通过 [Sketchfab Feed](https://sketchfab.com/feed) 浏览和下载 GLB 文件，再导入 Blender 进行二次加工、组合与导出。

这里必须特别提醒：Sketchfab 上不同模型的授权协议并不相同。下载和使用前，应在具体模型详情页确认是否允许下载、修改和公开展示，并按照对应许可证保留作者署名。本文只介绍技术流程，不代表任意 Sketchfab 模型都可以直接用于项目。

我的目标并不是制作气象意义上的真实云体模拟，而是得到一个在地图缩放、旋转和低俯角观察时仍然容易识别的“台风视觉符号”。

最终模型由多种视觉元素组合而成：

- 主体云团
- 环绕的雨滴
- 局部闪电或高亮结构
- 中心区域的视觉留白

### 3.2 导入 Blender 后先不要急着导出

下载到的 GLB 往往是为模型展示器准备的，并不一定适合直接放进 WebGIS。常见问题包括：

- 模型中心点不在几何中心
- 对象离世界原点很远
- 每个子对象拥有不同的缩放和旋转
- 模型实际尺寸跨度过大
- 材质数量多、纹理过大
- 雨滴或闪电向下延伸，放到地表后被地形遮住
- 从顶视角看很好，但倾斜地图后层次混乱

我的处理顺序是：

#### 第一步：清理场景

删除与最终展示无关的相机、灯光、地面、背景和隐藏对象，只保留云团、雨滴、闪电等需要导出的部分。

对象命名也在这一步整理。名称不会直接影响 Mapbox 渲染，但清晰的名称能让后续排查材质、包围盒和异常节点轻松很多。

#### 第二步：统一轴向与变换

在 Blender 中确认模型的竖直方向，并对需要保留的对象执行：

```text
Object > Apply > Rotation & Scale
```

应用变换的意义是让导出的 GLB 把当前视觉状态当作模型的基础状态。否则网页端再使用 `model-scale` 或 `model-rotation` 时，很容易叠加出意外结果。

#### 第三步：围绕台风中心重新组织构图

WebGIS 中的模型定位点只有一个经纬度，因此模型原点必须对应台风中心。

具体做法是：

1. 选中主体云团，确定风眼或云团视觉中心。
2. 把 3D Cursor 移到这个位置。
3. 将组合对象的 Origin 设置到 3D Cursor。
4. 把整体移动到 Blender 世界原点 `(0, 0, 0)`。
5. 从顶视、正视和透视三个角度检查雨滴、闪电与云层的相对位置。

这一点非常关键。原点偏移在 Blender 里可能不明显，但放到地图上旋转或缩放时，模型会围绕错误的位置打转，看起来像台风在路径旁边“漂移”。

#### 第四步：处理垂直结构

地图上的台风云系需要从倾斜镜头观察。如果所有元素都压在同一个平面里，低角度看过去会像一张贴纸。

所以我在 Blender 中给云团、雨滴和闪电保留了一定的高度差。但高度差也不能过大，否则地图近景会像一座云柱。

这里采用的是视觉比例而非真实气象比例：

- 横向尺度用于表达台风云系范围
- 纵向尺度只负责建立层次
- 真正具有地理意义的影响范围仍由 7/10/12 级风圈表达

换句话说，**GLB 是视觉符号，风圈才是空间数据。**

#### 第五步：材质合并与颜色检查

浏览器地图里的光照环境和 Sketchfab 模型查看器不同。材质导入后，需要重点检查：

- Base Color 是否过白
- Roughness 是否导致云层发黑
- Emissive 是否过强
- Alpha Blend 是否产生排序问题
- 多材质是否可以合并

当前项目保留了 GLB 内部的暖灰色材质，并在 Mapbox 中设置：

```ts
"model-color-mix-intensity": 0
```

如果用地图图层颜色强行覆盖模型，云团很容易重新变成没有层次的纯白色块。

#### 第六步：控制体积并导出

Web 页面中的模型不能只看画质，还要考虑首次加载和移动端解析时间。

我给模型设定的目标是：

- GLB 尽量小于 3 MB
- 最多不超过 5 MB
- 纹理不超过 2048×2048
- 尽量减少材质和独立对象
- 不依赖骨骼动画
- 启用 Draco 网格压缩

最终项目中的 `cloud.glb` 约为 1.4 MB，导出器为 Blender 的 Khronos glTF 2.0 导出插件，并使用了 Draco 压缩。

Blender 导出时选择：

```text
File
  └─ Export
      └─ glTF 2.0
          ├─ Format: glTF Binary (.glb)
          ├─ Include: Selected Objects
          ├─ Transform: +Y Up
          ├─ Apply Modifiers
          └─ Compression: Draco
```

导出后还要做一次最小验证：

1. 文件能否被独立 glTF Viewer 打开。
2. 模型原点是否仍在云团中心。
3. 材质和透明度是否正确。
4. 文件是否包含外链纹理。
5. 在 Mapbox 中低俯角观察时是否穿入地表。

---

## 四、把 GLB 放到 Mapbox Globe 上

### 4.1 用 GeoJSON Point 表示模型位置

Mapbox 原生 model 图层仍然需要一个 Source。这里使用单点 GeoJSON，并把模型地址放到 Feature 属性中：

```ts
const SOURCE_ID = "storm-model-source";
const LAYER_ID = "storm-model-layer";
const MODEL_URL = new URL(
  "models/cloud.glb?v=cloud-effects-centered-v5",
  document.baseURI,
).href;

function modelData(modelUri: string, lng = 0, lat = 0) {
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { modelUri },
      geometry: {
        type: "Point",
        coordinates: [lng, lat],
      },
    }],
  };
}
```

这里没有使用 Blob URL，而是让 Mapbox Worker 直接请求同源 GLB。实际测试中，同源 URL 在 Worker 解析、浏览器缓存和 Service Worker 环境下更稳定。

URL 后的版本号用于绕过三层缓存：

- 浏览器 HTTP 缓存
- Service Worker 缓存
- Mapbox Worker 内部模型缓存

如果你替换了模型但页面看起来完全没有变化，第一件事就是修改这个版本号。

### 4.2 创建原生 model 图层

核心图层代码如下：

```ts
map.addSource(SOURCE_ID, {
  type: "geojson",
  data: modelData(MODEL_URL, lng, lat),
});

map.addLayer({
  id: LAYER_ID,
  type: "model",
  slot: "middle",
  source: SOURCE_ID,
  layout: {
    "model-id": ["get", "modelUri"],
    visibility: "visible",
  },
  paint: {
    "model-type": "common-3d",
    "model-scale": [28_000, 28_000, 18_000],
    "model-translation": [0, 0, 120_000],
    "model-rotation": [0, 0, 0],
    "model-color-mix-intensity": 0,
    "model-opacity": 1,
    "model-emissive-strength": 0,
    "model-cast-shadows": false,
    "model-receive-shadows": false,
  },
});
```

几个参数值得单独解释。

### 4.3 为什么模型需要放大到数万倍

Blender 模型的单位尺度和地球上的米不是一回事。当前模型横向尺寸只有十几个模型单位，如果直接放到地图上几乎不可见。

所以这里使用：

```ts
"model-scale": [28_000, 28_000, 18_000]
```

让模型横向视觉尺寸接近数百公里。Z 轴缩放更小，是为了避免云团过厚。

这不是物理模拟，而是信息可视化中的视觉映射。真实影响半径依然由按公里计算的风圈承担。

### 4.4 为什么要抬高 120 公里

模型中有向下延伸的雨滴和闪电。如果模型原点直接贴在地表，它们会进入地球内部或被 DEM 地形遮挡。

因此使用：

```ts
"model-translation": [0, 0, 120_000]
```

整体抬高模型。这个参数需要和 Blender 中模型原点、最低点以及网页端 pitch 一起调，不能只在顶视图中判断。

### 4.5 模型加载失败必须能降级

三维模型可能因为网络、浏览器能力、GLB 解析或缓存问题加载失败，但台风路径和防灾信息不能因此消失。

项目监听地图错误，只处理与 GLB 相关的异常：

```ts
private readonly handleMapError = (
  event: { error?: Error },
): void => {
  const message = event.error?.message ?? "";
  if (!/cloud\.glb|gltf|model/i.test(message)) return;

  this.failed = true;
  this.available = false;
  this.onAvailabilityChange(false);
};
```

当模型不可用时，地图继续显示原来的 DOM 风眼 Marker。三维模型是增强层，不是业务功能的单点故障。

---

## 五、让模型沿路径平滑移动

模型移动本身并不复杂：每一帧更新 GeoJSON Point 即可。

```ts
update(state: TrackState): void {
  this.lng = state.lng;
  this.lat = state.lat;

  const source = this.map.getSource(
    SOURCE_ID,
  ) as mapboxgl.GeoJSONSource | undefined;

  source?.setData(
    modelData(MODEL_URL, state.lng, state.lat),
  );
}
```

真正困难的是 `state.lng` 和 `state.lat` 从哪里来。

台风接口给出的是离散观测点。如果直接从一个点跳到下一个点，模型会明显瞬移。因此需要根据当前播放时间找到前后两个节点，再按时间比例插值：

```ts
const ratio = (currentTime - pointA.time) /
  (pointB.time - pointA.time);

const lng = interpolateLongitude(
  pointA.lng,
  pointB.lng,
  ratio,
);

const lat = pointA.lat +
  (pointB.lat - pointA.lat) * ratio;
```

经度不能永远普通线性插值，因为路径可能跨越 `180°/-180°` 日期变更线。需要选择最短方向：

```ts
function interpolateLongitude(
  from: number,
  to: number,
  ratio: number,
): number {
  let delta = to - from;

  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;

  const value = from + delta * ratio;
  return ((value + 540) % 360) - 180;
}
```

这个统一状态还会同时交给：

- `StormModelLayer`
- 历史路径进度
- 7/10/12 级风圈
- 台风强度和气压 HUD
- `CameraController`

于是无论暂停、拖动时间轴还是改变倍速，所有视觉元素都能停在同一时刻。

---

## 六、多视角切换：自由、跟随与演示镜头

如果只是让模型移动，用户仍然需要不断手动拖地图。三维展示真正有“镜头感”的关键，是让相机理解台风运动状态。

项目把镜头收敛成三个模式：

```ts
export type CameraMode =
  | "free"
  | "follow"
  | "presentation";
```

### 6.1 自由模式

自由模式最简单：

```ts
if (this.mode === "free") return;
```

播放引擎继续推进，但程序不再修改地图相机。用户可以自由旋转、缩放和倾斜地球。

### 6.2 跟随模式：采用第三人称视角让镜头朝向台风前进方向

跟随模式不是简单地把台风放在屏幕中心。

首先，根据前后两个位置计算运动方位角；如果位移太小，则退回接口提供的“东北、偏北”等移动方向：

```ts
const measuredBearing =
  lastState &&
  haversineKm(
    lastState.lng,
    lastState.lat,
    state.lng,
    state.lat,
  ) > 0.02
    ? bearingBetween(
        lastState.lng,
        lastState.lat,
        state.lng,
        state.lat,
      )
    : bearingFromMoveDirection(state.moveDir);
```

接下来不能直接把 bearing 从 `359°` 插值到 `1°`，否则相机会反向旋转 358°。需要沿最短角度插值：

```ts
function lerpBearing(
  from: number,
  to: number,
  amount: number,
): number {
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * amount + 360) % 360;
}
```

最后使用 `easeTo` 更新镜头：

```ts
map.easeTo({
  center: [state.lng, state.lat],
  zoom: Math.max(map.getZoom(), 6.2),
  pitch: 68,
  bearing: followBearing ?? map.getBearing(),
  offset: [0, Math.round(height * 0.15)],
  duration: force ? 900 : 360,
  essential: false,
});
```

这里还有一个容易忽略的小设计：

```ts
offset: [0, height * 0.15]
```

它会把台风云团放到屏幕下方一些，为前进方向留出更多视野。这样用户看到的不是一个永远被锁死在正中央的图标，而是“前方还有路”的跟随镜头。

### 6.3 演示模式：按进度切换景别

演示模式适合自动播放或录制展示视频。它根据播放进度把完整过程分成四段：

```ts
const step = Math.min(
  3,
  Math.floor(progress * 4),
);

const shots = [
  { zoom: 3.8, pitch: 28, bearing: -12 },
  { zoom: 5.2, pitch: 48, bearing: 18 },
  { zoom: 6.2, pitch: 60, bearing: -28 },
  { zoom: 4.6, pitch: 42, bearing: 8 },
];

map.easeTo({
  center: [state.lng, state.lat],
  ...shots[step],
  duration: force ? 1000 : 1400,
  essential: false,
});
```

四个阶段分别承担不同作用：

1. 全球或区域视角：交代台风所在位置。
2. 中景：展示路径方向和周边城市。
3. 近景：突出云系模型、风圈和地形。
4. 拉远：重新展示整体路径与预测趋势。

这种方案没有引入复杂的关键帧系统，却能得到比较自然的景别变化。

### 6.4 为什么镜头更新要节流

播放可能接近 60 FPS，但没有必要每一帧都调用 `easeTo`。频繁启动相机动画会产生抖动，还会增加主线程和 GPU 压力。

项目将镜头更新限制为约 220ms 一次：

```ts
const now = performance.now();
if (!force && now - this.lastMove < 220) return;
this.lastMove = now;
```

模型可以高频移动，镜头只需要平滑追随。两者更新频率不同，但使用同一个状态源。

---

## 七、Globe 场景：大气层、卫星底图和地形

地图初始化使用 Globe 投影：

```ts
const map = new mapboxgl.Map({
  container,
  style: AMAP_SATELLITE_STYLE,
  projection: "globe",
  center: [138, 18],
  zoom: 3.5,
  pitch: 35,
  fadeDuration: 0,
  refreshExpiredTiles: false,
});
```

底图继续采用高德卫星影像和中文注记，Mapbox 负责 Globe、大气层、图层渲染和可选 DEM 地形。

大气层配置如下：

```ts
map.setFog({
  color: "rgb(18, 29, 54)",
  "high-color": "rgb(25, 54, 108)",
  "horizon-blend": 0.035,
  "space-color": "rgb(4, 7, 15)",
  "star-intensity": 0.55,
});
```

在桌面高性能设备上，如果存在 Mapbox Token，可以继续开启 DEM：

```ts
map.addSource("mapbox-dem", {
  type: "raster-dem",
  url: "mapbox://mapbox.mapbox-terrain-dem-v1",
  tileSize: 512,
  maxzoom: 14,
});

map.setTerrain({
  source: "mapbox-dem",
  exaggeration: 1.12,
});
```

地形不是必需项。低性能设备、移动端或没有 Token 时，项目仍然可以使用基础 Globe、卫星影像、路径和 GLB 模型。

---

## 八、性能优化：不要让三维效果拖垮业务

三维升级后，性能预算主要消耗在：

- Globe 投影
- 卫星瓦片
- DEM 地形
- GLB 解析
- 模型和风圈持续更新
- 镜头动画

项目采用了分层更新策略：

| 内容 | 更新策略 |
|---|---|
| 模型位置 | 跟随有效动画帧 |
| HUD | 当前状态变化时更新 |
| 风圈 | 节流到约 10～15 FPS |
| 历史路径 | 跨越节点或阈值后重建 |
| 跟随镜头 | 约 220ms 更新一次 |
| DEM 地形 | 低性能设备关闭 |
| 页面不可见 | 暂停动画推进 |

同时提供高画质、均衡和省电三个档位。省电模式可以关闭地形和部分动态效果，并保留二维风眼作为模型替代。

这里的经验是：

> 三维展示不能成为业务正确性的前置条件。

即使 GLB、地形或光效全部加载失败，路径、风圈、预报、倒计时和防灾指南也应该正常工作。

---

## 九、迁移中遇到的几个坑

### 9.1 Blender 里居中，不代表 Mapbox 里真的居中

需要同时检查：

- 组合对象 Origin
- 所有子对象的局部变换
- 导出后的 glTF 节点 Transform
- Mapbox 的 `model-translation`

只移动可见几何而没有调整 Origin，网页端仍然会偏移。

### 9.2 模型太真实，反而可能不好用

真实台风尺度非常大，垂直尺度相对很小。完全按真实比例建模，在全球视角下可能看不到，在近景下又可能遮挡地图。

最终选择是：

- GLB 使用视觉比例
- 风圈使用真实公里半径
- HUD 显示真实气象数据

三者职责分开，画面更清晰。

### 9.3 `style.load` 会清空自定义图层

地图样式重新加载后，自定义 Source 和 Layer 需要重新注册。因此模型图层的 `add()` 必须具备幂等性：

```ts
if (map.getLayer(LAYER_ID)) return;
```

场景层还需要根据缓存的数据和当前状态恢复路径、风圈和模型位置。

### 9.4 缓存会让你怀疑 Blender 没有导出成功

GLB 可能同时被浏览器、Service Worker 和 Mapbox Worker 缓存。替换同名文件后，页面仍可能显示旧模型。

最简单的处理方式是给模型 URL 加版本参数：

```ts
models/cloud.glb?v=cloud-effects-centered-v5
```

### 9.5 模型加载成功不代表用户看得见

模型可能已经加载，只是：

- 尺寸太小
- 高度在地表以下
- 材质接近透明
- 图层被其他图层遮挡
- 坐标还停留在 `[0, 0]`
- 当前缩放级别不合适

调试时建议先使用夸张的缩放和高度确认模型存在，再逐步回调到合适比例。

---

## 十、项目当前结构

与三维地图相关的核心文件：

```text
src/
├── animation/
│   ├── PlaybackEngine.ts      # 统一播放时间轴
│   └── playbackTypes.ts
├── map/
│   ├── CameraController.ts    # 自由/跟随/演示镜头
│   ├── PerformanceController.ts
│   ├── StormModelLayer.ts     # Mapbox 原生 GLB 模型图层
│   └── contracts.ts
├── geo.ts                     # 插值、距离、方位角和风圈
└── map.ts                     # Globe 场景与业务图层

public/
└── models/
    └── cloud.glb              # Blender 加工后的云系模型
```

本地运行：

```bash
git clone https://github.com/lukeSuperCoder/typhoon-tracker-3d.git
cd typhoon-tracker-3d
npm install
npm run dev
```

构建和部署：

```bash
npm run typecheck
npm run test
npm run build
npm run deploy
```

---

## 十一、后续计划

目前的三维模型仍以整体模型运动为主，下一步准备继续尝试：

- 根据台风强度动态调整模型尺寸
- 将云团旋转与路径移动进一步解耦
- 增加更自然的镜头关键帧和过渡曲线
- 为移动端提供更轻量的低多边形模型
- 增加多台风切换与同时对比
- 探索粒子风场和卫星云图时间序列
- 注册独立域名并改善国内访问

如果未来 Mapbox Globe 与自定义三维渲染的兼容性更加成熟，也可以进一步尝试 Three.js 粒子云层。但在当前版本中，原生 `model` 图层已经很好地平衡了效果、复杂度和稳定性。

---

## 总结

这次升级最重要的收获不是“把一个 GLB 放到了地图上”，而是理解了三维 WebGIS 中几类状态的边界：

- Blender 决定模型的原点、轴向、层次、材质和资产体积
- Mapbox 决定模型在地球上的位置、缩放、高度和场景关系
- PlaybackEngine 决定所有业务元素处于哪个时间点
- CameraController 决定用户从什么角度理解这段运动
- 风圈和路径负责表达真实空间数据，GLB 负责增强视觉认知

当这些职责分开后，三维模型不再是叠在地图上的装饰，而会真正成为台风路径叙事的一部分。

最后再次感谢原文章和原项目作者提供的灵感与开源基础：

- [原掘金文章](https://juejin.cn/post/7659393583027896330)
- [Trade-Offf/typhoon-bavi-tracker](https://github.com/Trade-Offf/typhoon-bavi-tracker)

我的三维升级版本：

- [GitHub：lukeSuperCoder/typhoon-tracker-3d](https://github.com/lukeSuperCoder/typhoon-tracker-3d)
- [在线体验](https://typhoon-tracker-3d.lc970820.workers.dev/)

如果这篇文章对你有帮助，欢迎 Star、Issue 或一起交流 WebGIS、Mapbox、Blender 与气象可视化。

> 免责声明：项目展示的数据来自公开气象服务接口，城市影响时间为算法估算，不构成官方预报或预警。一切防灾决策请以中央气象台及当地政府发布的信息为准。
