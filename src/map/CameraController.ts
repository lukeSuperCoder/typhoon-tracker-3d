import { bearingBetween, haversineKm, type TrackState } from "../geo";
import type { CameraMode } from "./contracts";

const FOLLOW_ZOOM = 6.2;
const FOLLOW_PITCH = 68;
const FOLLOW_SCREEN_OFFSET_RATIO = 0.15;

const MOVE_DIRECTION_BEARINGS: Array<[string, number]> = [
  ["北", 0],
  ["东北", 45],
  ["东", 90],
  ["东南", 135],
  ["南", 180],
  ["西南", 225],
  ["西", 270],
  ["西北", 315],
];

function bearingFromMoveDirection(direction: string | null): number | null {
  if (!direction) return null;
  // 先匹配双字方向，避免“西北”被提前识别为“北”。
  const match = [...MOVE_DIRECTION_BEARINGS]
    .sort(([a], [b]) => b.length - a.length)
    .find(([name]) => direction.includes(name));
  return match?.[1] ?? null;
}

/** 沿最短角度插值，避免方位角跨越 0° 时绕场一周。 */
function lerpBearing(from: number, to: number, amount: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * amount + 360) % 360;
}

/** 将自由浏览、跟随风眼和播报运镜收敛到一个控制器。 */
export class CameraController {
  private mode: CameraMode = "follow";
  private lastMove = 0;
  private presentationStep = -1;
  private lastFollowState: TrackState | null = null;
  private followBearing: number | null = null;

  constructor(private readonly map: mapboxgl.Map) {}

  get currentMode(): CameraMode {
    return this.mode;
  }

  setMode(mode: CameraMode, state?: TrackState): void {
    this.mode = mode;
    this.presentationStep = -1;
    if (mode !== "follow") {
      this.lastFollowState = null;
      this.followBearing = null;
    }
    if (mode !== "free" && state) this.update(state, 1, true);
  }

  update(state: TrackState, progress: number, force = false): void {
    if (this.mode === "free") return;
    const now = performance.now();
    if (!force && now - this.lastMove < 220) return;
    this.lastMove = now;

    if (this.mode === "follow") {
      const measuredBearing = this.lastFollowState &&
        haversineKm(this.lastFollowState.lng, this.lastFollowState.lat, state.lng, state.lat) > 0.02
        ? bearingBetween(this.lastFollowState.lng, this.lastFollowState.lat, state.lng, state.lat)
        : bearingFromMoveDirection(state.moveDir);
      if (measuredBearing != null) {
        this.followBearing = this.followBearing == null || force
          ? measuredBearing
          : lerpBearing(this.followBearing, measuredBearing, 0.24);
      }
      this.lastFollowState = state;

      const height = this.map.getContainer?.().clientHeight || window.innerHeight;
      this.map.easeTo({
        center: [state.lng, state.lat],
        zoom: Math.max(this.map.getZoom(), FOLLOW_ZOOM),
        pitch: FOLLOW_PITCH,
        // 地图顶部始终指向台风前进方向，相机由后方追随。
        bearing: this.followBearing ?? this.map.getBearing(),
        // 把云团放到屏幕下部，为前进方向留出更多可视空间。
        offset: [0, Math.round(height * FOLLOW_SCREEN_OFFSET_RATIO)],
        duration: force ? 900 : 360,
        essential: false,
      });
      return;
    }

    const step = Math.min(3, Math.floor(progress * 4));
    if (!force && step === this.presentationStep) return;
    this.presentationStep = step;
    const shots = [
      { zoom: 3.8, pitch: 28, bearing: -12 },
      { zoom: 5.2, pitch: 48, bearing: 18 },
      { zoom: 6.2, pitch: 60, bearing: -28 },
      { zoom: 4.6, pitch: 42, bearing: 8 },
    ];
    this.map.easeTo({
      center: [state.lng, state.lat],
      ...shots[step],
      duration: force ? 1000 : 1400,
      essential: false,
    });
  }
}
