/**
 * Shared author-name validation used by BOTH the UI (Keep-it popup) and the
 * simulated backend (galleryStore.put). The store re-runs this so it never
 * trusts the client. Keep the rules identical on both sides.
 */

export const NAME_MAX = 24;
export const NAME_MIN = 1;

/** Only letters, digits, spaces, and a few friendly punctuation marks. */
const ALLOWED = /^[\p{L}\p{N} ._'-]+$/u;

/**
 * A small starter blocklist of offensive/profane stems. Matched against a
 * normalized form so simple evasions (leet digits, spaces, repeats, accents)
 * still get caught. This is intentionally conservative and easy to extend — it
 * is not meant to be exhaustive.
 */
const BLOCKLIST = [
  "fuck", "shit", "bitch", "cunt", "asshole", "dick", "piss", "bastard",
  "slut", "whore", "nigger", "nigga", "faggot", "fag", "retard", "rape",
  "nazi", "cum", "pussy", "wank", "twat", "dildo", "boner", "jizz",
];

/** Map common leet substitutions to letters, then strip noise. */
function normalize(raw: string): string {
  let s = raw.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/gu, "");
  const leet: Record<string, string> = {
    "0": "o", "1": "i", "!": "i", "|": "i", "3": "e", "4": "a", "@": "a",
    "5": "s", "$": "s", "7": "t", "8": "b", "9": "g",
  };
  s = s.replace(/[01!|34@5$789]/g, (c) => leet[c] ?? c);
  // drop anything that isn't a letter, then collapse repeated letters so
  // "f u c k" and "fuuuck" both reduce toward the stem
  s = s.replace(/[^a-z]/g, "");
  s = s.replace(/(.)\1{2,}/g, "$1$1");
  return s;
}

export function containsProfanity(name: string): boolean {
  const norm = normalize(name);
  const collapsed = norm.replace(/(.)\1+/g, "$1"); // also catch single-letter spacing
  return BLOCKLIST.some((w) => norm.includes(w) || collapsed.includes(w));
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

/** Trim and collapse internal whitespace; does not change case. */
export function sanitize(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function validateAuthorName(raw: string): ValidationResult {
  const name = sanitize(raw ?? "");
  if (name.length < NAME_MIN) return { ok: false, reason: "Add a name first." };
  if (name.length > NAME_MAX)
    return { ok: false, reason: `Keep it under ${NAME_MAX} characters.` };
  if (!ALLOWED.test(name))
    return { ok: false, reason: "Letters, numbers, spaces, . _ ' - only." };
  if (containsProfanity(name))
    return { ok: false, reason: "Let's keep names friendly — try another." };
  return { ok: true };
}
