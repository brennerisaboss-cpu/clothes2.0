export type PageviewPoint = {
  source: string;
  metric: string;
  value: number;
  period_start: Date;
  period_end: Date;
};

export declare const id: string;
export declare const MIN_INTERVAL_MS: number;

export declare function fetchPageviews(opts: {
  title: string | null | undefined;
  project?: string;
  days?: number;
  contact: string | null | undefined;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<
  | { ok: true; points: PageviewPoint[]; note?: string; error?: undefined }
  | { ok: false; error: string; points?: undefined; note?: undefined }
>;
