export declare const DEFAULT_MIN_INTERVAL_MS: number;
export declare const SHARED_PLATFORM_INTERVAL_MS: number;
export declare const SHARED_PLATFORMS: string[];
export declare function rateLimitHost(
  config?: Record<string, unknown>,
  adapterId?: string,
): string;
export declare function isSharedPlatform(key: string): boolean;
export declare class HostLimiter {
  constructor(minIntervalMs?: number);
  setCrawlDelay(seconds: number): void;
  setMinInterval(ms: number): void;
  backOff(): number;
  wait(): Promise<void>;
}
export declare class LimiterPool {
  for(key: string): HostLimiter;
}
