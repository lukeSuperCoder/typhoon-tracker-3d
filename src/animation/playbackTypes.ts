export type PlaybackStatus = "idle" | "playing" | "paused" | "ended";
export type PlaybackSpeed = 0.5 | 1 | 2 | 4;

export interface PlaybackSnapshot {
  status: PlaybackStatus;
  currentTime: number;
  startTime: number;
  endTime: number;
  progress: number;
  speed: PlaybackSpeed;
  loop: boolean;
}

export interface PlaybackFrame extends PlaybackSnapshot {
  deltaMs: number;
}
