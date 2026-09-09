export declare function describeGarment(title: string): {
  type: string | null;
  material: string | null;
  matchedType: string | null;
  matchedMaterial: string | null;
  identified: boolean;
};

export declare function garmentKey(input: {
  sublineId: string | null;
  adYear: number | null;
  type: string | null;
  material: string | null;
}): string;

export declare function garmentName(input: {
  sublineName: string | null;
  adYear: number | null;
  adYearStatus?: string | null;
  type: string | null;
  material: string | null;
}): string;
