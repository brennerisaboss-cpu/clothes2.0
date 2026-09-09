/** The configured password, or null when there is none. */
export function gatePassword(): string | null;
/** Is this host name the machine itself? Says nothing about who sent a request. */
export function isLoopback(host: string | null | undefined): boolean;
/** Is this server bound to loopback, as far as we can know? Unset APP_BIND is unknown, not safe. */
export function boundToLoopback(bind?: string | null): boolean;
/** Did this request pass through a proxy, tunnel or port-forward? */
export function viaProxy(headers: Headers | null | undefined): boolean;
/** May this request be served with no password configured? */
export function localWithoutPassword(headers: Headers | null | undefined, bind?: string | null): boolean;
/** A signed token proving knowledge of the password, good for thirty days. */
export function issueToken(password: string, now?: number): string;
export function tokenValid(token: string | undefined, password: string, now?: number): boolean;
/** Constant-time password check for the unlock form. */
export function passwordMatches(given: string | undefined, password: string): boolean;
export const GATE_COOKIE: string;
export const GATE_MAX_AGE: number;

/** The one capability a capture credential may be used for. */
export type Capability = 'capture' | 'full';

/** May a bearer token satisfy this capability? Only ever for 'capture'. */
export function bearerAllowed(args: {
  capability: Capability;
  header: string | null;
  captureToken: string | null | undefined;
}): boolean;

/** Constant-time check of an Authorization header against the capture token. */
export function captureTokenAccepted(
  header: string | null,
  captureToken: string | null | undefined,
): boolean;
