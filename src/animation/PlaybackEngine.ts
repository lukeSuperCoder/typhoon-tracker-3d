import type { PlaybackFrame, PlaybackSnapshot, PlaybackSpeed, PlaybackStatus } from "./playbackTypes";

export interface PlaybackEngineOptions {
  onFrame: (frame: PlaybackFrame) => void;
  onPulse?: (phase: number) => void;
  loop?: boolean;
  speed?: PlaybackSpeed;
}

/**
 * 与地图引擎无关的统一播放时钟。
 * 地图、HUD、风圈与镜头均订阅同一个时间快照，避免各自动画产生漂移。
 */
export class PlaybackEngine {
  private status: PlaybackStatus = "idle";
  private currentTime = 0;
  private startTime = 0;
  private endTime = 0;
  private speed: PlaybackSpeed;
  private shouldLoop: boolean;
  private raf = 0;
  private lastFrame = 0;
  private pulsePhase = 0;
  private pulseAccum = 0;
  private readonly reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private readonly options: PlaybackEngineOptions) {
    this.speed = options.speed ?? 2;
    this.shouldLoop = options.loop ?? false;
  }

  get playing(): boolean {
    return this.status === "playing";
  }

  get t(): number {
    return this.currentTime;
  }

  get t0(): number {
    return this.startTime;
  }

  get t1(): number {
    return this.endTime;
  }

  /** 兼容现有 UI：旧值 3/6/12 小时每秒对应 1×/2×/4×。 */
  set hoursPerSec(value: number) {
    this.setSpeed((value <= 3 ? 1 : value <= 6 ? 2 : 4) as PlaybackSpeed);
  }

  get snapshot(): PlaybackSnapshot {
    const span = this.endTime - this.startTime;
    return {
      status: this.status,
      currentTime: this.currentTime,
      startTime: this.startTime,
      endTime: this.endTime,
      progress: span > 0 ? (this.currentTime - this.startTime) / span : 0,
      speed: this.speed,
      loop: this.shouldLoop,
    };
  }

  setRange(startTime: number, endTime: number): void {
    this.startTime = startTime;
    this.endTime = Math.max(startTime, endTime);
    this.currentTime = Math.min(Math.max(this.currentTime || startTime, startTime), this.endTime);
    if (this.status === "idle") this.status = "paused";
  }

  setSpeed(speed: PlaybackSpeed): void {
    this.speed = speed;
  }

  setLoop(loop: boolean): void {
    this.shouldLoop = loop;
  }

  seek(time: number): void {
    this.currentTime = Math.min(Math.max(time, this.startTime), this.endTime);
    if (!this.playing) this.status = this.currentTime >= this.endTime ? "ended" : "paused";
    this.emit(0);
  }

  play(): void {
    if (this.playing || this.endTime <= this.startTime) return;
    if (this.currentTime >= this.endTime - 1000) this.currentTime = this.startTime;
    this.status = "playing";
    this.lastFrame = performance.now();
    document.body.classList.add("is-playing");
  }

  pause(atEnd = false): void {
    if (atEnd) this.currentTime = this.endTime;
    this.status = atEnd ? "ended" : "paused";
    document.body.classList.remove("is-playing");
    this.emit(0);
  }

  toggle(): void {
    this.playing ? this.pause() : this.play();
  }

  start(): void {
    cancelAnimationFrame(this.raf);
    this.lastFrame = performance.now();
    document.addEventListener("visibilitychange", this.handleVisibility);
    this.tick();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    document.body.classList.remove("is-playing");
  }

  private readonly handleVisibility = (): void => {
    if (!document.hidden) this.lastFrame = performance.now();
  };

  private readonly tick = (): void => {
    this.raf = requestAnimationFrame(this.tick);
    if (document.hidden) return;

    const now = performance.now();
    const deltaMs = Math.min(100, now - this.lastFrame);
    this.lastFrame = now;

    if (this.playing) {
      // 1× = 3 台风小时/现实秒，与原项目的播放速度保持一致。
      this.currentTime += deltaMs * this.speed * 10_800;
      if (this.currentTime >= this.endTime) {
        if (this.shouldLoop) this.currentTime = this.startTime;
        else {
          this.pause(true);
          return;
        }
      }
      this.emit(deltaMs);
    }

    if (!this.reduceMotion && this.options.onPulse) {
      this.pulsePhase = (this.pulsePhase + deltaMs / 2600) % 1;
      this.pulseAccum += deltaMs;
      if (this.pulseAccum >= 33) {
        this.pulseAccum = 0;
        this.options.onPulse(this.pulsePhase);
      }
    }
  };

  private emit(deltaMs: number): void {
    this.options.onFrame({ ...this.snapshot, deltaMs });
  }
}
