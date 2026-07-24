import { describe, expect, it } from "vitest";
import { interpolateGreatCircle, stateAtTime, windCircleRing } from "./geo";
import type { TrackPoint } from "./types";

const point = (t: number, lng: number, lat: number): TrackPoint => ({
  t,
  time: new Date(t).toISOString().slice(0, 16).replace("T", " "),
  lng,
  lat,
  strong: "台风级",
  power: 12,
  speed: 33,
  pressure: 970,
  moveSpeed: 18,
  moveDir: "北",
  r7: [200, 180, 160, 190],
  r10: [90, 80, 70, 85],
  r12: null,
});

describe("台风轨迹几何", () => {
  it("跨日期变更线时沿最短方向插值", () => {
    const [lng] = interpolateGreatCircle(179, 10, -179, 10, 0.5);
    expect(Math.abs(lng)).toBeGreaterThan(179.5);
  });

  it("按时间生成稳定的中间状态", () => {
    const state = stateAtTime([point(0, 120, 15), point(3_600_000, 124, 19)], 1_800_000);
    expect(state.index).toBe(0);
    expect(state.frac).toBeCloseTo(0.5);
    expect(state.lng).toBeCloseTo(121.98, 1);
    expect(state.lat).toBeCloseTo(17.01, 1);
  });

  it("风圈闭合且包含全部象限采样", () => {
    const ring = windCircleRing(130, 20, [200, 180, 160, 190]);
    expect(ring.length).toBe(125);
    expect(ring[0]).toEqual(ring.at(-1));
  });
});
