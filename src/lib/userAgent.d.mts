export function usableContact(value: unknown): boolean;
export function userAgent(contact?: string | null): string | null;
export const NO_CONTACT: string;

export function collectingUserAgent(
  contact?: string | null,
): { ua: string; anonymous: boolean };

export const NO_CONTACT_WARNING: string;
