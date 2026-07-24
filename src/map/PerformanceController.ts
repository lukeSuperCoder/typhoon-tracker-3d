import type { PerformanceTier } from "./contracts";

export interface PerformanceProfile {
  windUpdateMs: number;
  pathUpdateMs: number;
  pulseEnabled: boolean;
  modelEnabled: boolean;
  terrainEnabled: boolean;
}

const PROFILES: Record<PerformanceTier, PerformanceProfile> = {
  high: { windUpdateMs: 50, pathUpdateMs: 50, pulseEnabled: true, modelEnabled: true, terrainEnabled: true },
  balanced: { windUpdateMs: 100, pathUpdateMs: 100, pulseEnabled: true, modelEnabled: true, terrainEnabled: true },
  low: { windUpdateMs: 250, pathUpdateMs: 200, pulseEnabled: false, modelEnabled: false, terrainEnabled: false },
};

export function detectPerformanceTier(): PerformanceTier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = navigator.hardwareConcurrency || 4;
  const memory = nav.deviceMemory ?? 8;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || memory <= 4 || cores <= 4) return "low";
  if (memory >= 8 && cores >= 8 && window.devicePixelRatio <= 2) return "high";
  return "balanced";
}

export class PerformanceController {
  private current: PerformanceTier;

  constructor(initial: PerformanceTier | "auto" = "auto") {
    this.current = initial === "auto" ? detectPerformanceTier() : initial;
  }

  get tier(): PerformanceTier {
    return this.current;
  }

  get profile(): PerformanceProfile {
    return PROFILES[this.current];
  }

  setTier(tier: PerformanceTier): void {
    this.current = tier;
  }
}
