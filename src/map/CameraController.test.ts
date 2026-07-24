import { describe, expect, it, vi } from "vitest";
import type { TrackState } from "../geo";
import { CameraController } from "./CameraController";

const state: TrackState = {
  lng: 135,
  lat: 22,
  speed: 40,
  pressure: 955,
  strong: "强台风级",
  power: 14,
  moveSpeed: 20,
  moveDir: "北",
  r7: null,
  r10: null,
  r12: null,
  time: "2026-07-23 12:00",
  index: 2,
  frac: 0.5,
};

describe("CameraController", () => {
  it("自由模式不抢夺用户镜头", () => {
    const map = { easeTo: vi.fn(), getZoom: () => 4, getBearing: () => 0 };
    const controller = new CameraController(map as never);
    controller.setMode("free");
    controller.update(state, 0.5, true);
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it("默认采用后上方第三人称跟随视角", () => {
    const map = {
      easeTo: vi.fn(),
      getZoom: () => 4,
      getBearing: () => 12,
      getContainer: () => ({ clientHeight: 800 }),
    };
    const controller = new CameraController(map as never);
    controller.update(state, 0.5, true);
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [135, 22],
      bearing: 0,
      pitch: 68,
      zoom: 6.2,
      offset: [0, 120],
    }));
  });

  it("播报模式按进度切换预设镜头", () => {
    const map = { easeTo: vi.fn(), getZoom: () => 4, getBearing: () => 0 };
    const controller = new CameraController(map as never);
    controller.setMode("presentation", state);
    controller.update(state, 0.7, true);
    expect(map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({
      center: [135, 22],
      zoom: 6.2,
      pitch: 60,
    }));
  });
});
