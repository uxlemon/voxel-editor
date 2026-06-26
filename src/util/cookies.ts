/**
 * Tiny cookie helpers + consent-gated author-name storage. The player's name is
 * only written to a cookie once they've accepted the cookie notice; otherwise
 * it's kept in memory for the current session only.
 */

const CONSENT = "voxel-cookie-consent";
const AUTHOR = "voxel-author";

export function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

export function setCookie(name: string, value: string, days = 365): void {
  const exp = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax`;
}

/** Whether the user has answered the cookie notice at all. */
export function cookieConsentAnswered(): boolean {
  return getCookie(CONSENT) !== null;
}
/** Whether the user accepted cookies. */
export function hasCookieConsent(): boolean {
  return getCookie(CONSENT) === "yes";
}
export function setCookieConsent(accepted: boolean): void {
  setCookie(CONSENT, accepted ? "yes" : "no");
}

// In-memory fallback name when the user declined cookies.
let sessionAuthor = "";

export function getAuthorName(): string {
  return hasCookieConsent() ? getCookie(AUTHOR) ?? "" : sessionAuthor;
}

export function setAuthorName(name: string): void {
  if (hasCookieConsent()) setCookie(AUTHOR, name);
  else sessionAuthor = name;
}
