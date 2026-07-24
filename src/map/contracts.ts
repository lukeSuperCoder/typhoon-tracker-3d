import type { TrackState } from "../geo";
import type { TyphoonData } from "../types";

export type CameraMode = "free" | "follow" | "presentation";
export type PerformanceTier = "high" | "balanced" | "low";

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

export interface RenderFrame {
  time: number;
  progress: number;
  playing: boolean;
  deltaMs: number;
}

/** app.ts 面向的地图场景边界，隔离业务逻辑与 Mapbox API。 */
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

export interface SceneLayer {
  add(): void;
  setData(data: TyphoonData): void;
  update(state: TrackState, frame: RenderFrame): void;
  setVisible(visible: boolean): void;
  remove(): void;
}
