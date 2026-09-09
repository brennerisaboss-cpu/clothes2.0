export type ParsedSize = {
  region: string;
  ordinal: number | null;
  label: string | null;
};

export declare const FLOOR_WEIGHT: number;
export declare function parseSize(raw: string | null | undefined): ParsedSize;
export declare function sizeWeight(target: ParsedSize | null, comp: ParsedSize | null): number;
export declare function weighBySize<T extends { size_raw?: string | null }>(
  observations: T[],
  targetRaw: string | null | undefined,
): { observations: T[]; target: ParsedSize; comparable: number; offSize: number };
