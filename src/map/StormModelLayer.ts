import type { FeatureCollection, Point } from "geojson";
import type { TrackState } from "../geo";

const SOURCE_ID = "storm-model-source";
const LAYER_ID = "storm-model-layer";
// 修改版本号可绕过浏览器、Service Worker 与 Mapbox worker 的模型缓存。
const MODEL_URL = new URL("models/cloud.glb?v=cloud-effects-centered-v5", document.baseURI).href;
const FIXED_MODEL_ROTATION: [number, number, number] = [0, 0, 0];
const MODEL_ALTITUDE_METERS = 120_000;

type ModelData = FeatureCollection<Point, { modelUri: string }>;

function modelData(modelUri: string, lng = 0, lat = 0): ModelData {
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { modelUri },
      geometry: { type: "Point", coordinates: [lng, lat] },
    }],
  };
}

/** Mapbox 原生 GLB 模型图层，失败时由场景保留 DOM 风眼。 */
export class StormModelLayer {
  private available = false;
  private visible = true;
  private failed = false;
  private lng = 0;
  private lat = 0;
  private readonly handleMapError = (event: { error?: Error }): void => {
    const message = event.error?.message ?? "";
    if (!/cloud\.glb|gltf|model/i.test(message)) return;
    this.failed = true;
    this.available = false;
    this.onAvailabilityChange(false);
    console.warn("GLB 云系模型解析失败，已保留 DOM 风眼", event.error);
  };

  constructor(
    private readonly map: mapboxgl.Map,
    private readonly onAvailabilityChange: (available: boolean) => void,
  ) {}

  get isAvailable(): boolean {
    return this.available && this.visible;
  }

  add(): void {
    // style.load 可能重建样式；以当前图层是否存在为准。
    if (this.map.getLayer(LAYER_ID)) return;
    this.failed = false;
    try {
      if (!this.map.getSource(SOURCE_ID)) {
        this.map.addSource(SOURCE_ID, { type: "geojson", data: modelData(MODEL_URL, this.lng, this.lat) });
      }
      if (!this.map.getLayer(LAYER_ID)) {
        this.map.addLayer({
          id: LAYER_ID,
          type: "model",
          slot: "middle",
          source: SOURCE_ID,
          // 由 Mapbox worker 直接请求同源 GLB；blob URL 在 worker 中兼容性不可靠。
          layout: { "model-id": ["get", "modelUri"], visibility: this.visible ? "visible" : "none" },
          paint: {
            "model-type": "common-3d",
            // 原模型横向约 11 个单位；缩放后约 300 km，匹配台风云系而非建筑物尺度。
            "model-scale": [28_000, 28_000, 18_000],
            // 将模型整体抬离地表，让云底向下延伸的雨滴和闪电不被地形遮挡。
            "model-translation": [0, 0, MODEL_ALTITUDE_METERS],
            // 云团的枢轴已在 GLB 中归中；保持固定朝向，只随台风中心平移。
            "model-rotation": FIXED_MODEL_ROTATION,
            // 使用 GLB 内置的暖灰材质，避免颜色覆盖使云团重新变成纯白。
            "model-color-mix-intensity": 0,
            "model-opacity": 1,
            "model-emissive-strength": 0,
            "model-cast-shadows": false,
            "model-receive-shadows": false,
          },
        });
      }
      this.map.off("error", this.handleMapError);
      this.map.on("error", this.handleMapError);
      // model 图层没有独立 load 事件；优先等 idle，持续加载瓦片时用短延时结束过渡态。
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        if (this.failed || !this.map.getLayer(LAYER_ID)) return;
        this.available = true;
        this.onAvailabilityChange(this.visible);
      };
      this.map.once("idle", settle);
      window.setTimeout(settle, 5000);
    } catch (error) {
      console.warn("GLB 风眼模型不可用，已降级为 DOM 风眼", error);
      this.available = false;
      this.onAvailabilityChange(false);
    }
  }

  update(state: TrackState): void {
    this.lng = state.lng;
    this.lat = state.lat;
    (this.map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined)
      ?.setData(modelData(MODEL_URL, state.lng, state.lat));
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.map.getLayer(LAYER_ID)) {
      this.map.setLayoutProperty(LAYER_ID, "visibility", visible ? "visible" : "none");
    }
    this.onAvailabilityChange(this.available && visible);
  }

  remove(): void {
    if (this.map.getLayer(LAYER_ID)) this.map.removeLayer(LAYER_ID);
    if (this.map.getSource(SOURCE_ID)) this.map.removeSource(SOURCE_ID);
    this.map.off("error", this.handleMapError);
    this.available = false;
  }
}
