// Who is making this request.
//
// Every outbound request in this project identifies itself, and four scripts
// built that string themselves with `process.env.PROBE_CONTACT ?? 'contact not
// set'`. A header that says "contact not set" is worse than no contact at all:
// it is a request that has been TOLD to identify itself, has been given a slot
// to do it in, and has written a placeholder into the slot. Wikimedia's User-
// Agent policy asks for a contactable address specifically so that a
// misbehaving client can be reached, and answers a request that declines to
// give one with 403 — which is the failure that sat unexplained, and which no
// amount of looking at the pageviews adapter would have found, because the
// adapter is fine and its caller was lying for it.
//
// So there is one builder, it validates, and it refuses rather than inventing.

/**
 * Does this look like something a person could actually be reached at?
 *
 * An email or a URL. Deliberately not a strict RFC 5322 parse — the job is to
 * reject "contact not set", "TODO", "none" and an empty string, not to
 * adjudicate exotic addresses.
 */
export function usableContact(value) {
  const contact = String(value ?? '').trim();
  if (!contact) return false;
  if (/^https?:\/\/\S+\.\S+/i.test(contact)) return true;
  const email = contact.replace(/^mailto:/i, '');
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/**
 * The User-Agent for every outbound request, or null if we may not make one.
 *
 * Null rather than a fallback string, so a caller has to decide what to do
 * about it. Every previous caller "decided" by substituting a placeholder,
 * which is how an unidentifiable request went out under a header claiming to
 * identify it.
 */
export function userAgent(contact = process.env.PROBE_CONTACT) {
  if (!usableContact(contact)) return null;
  const trimmed = String(contact).trim();
  // Wikimedia asks for a contact that can be acted on; an email is written as
  // a mailto: so it is unambiguously an address rather than a product name.
  const shown = /^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)
    ? trimmed
    : `mailto:${trimmed}`;
  return `resale-tracker/0.1 (personal price tracker; ${shown})`;
}

/**
 * The User-Agent for routine collection, which must not stop for want of a
 * contact — and must not invent one either.
 *
 * The distinction the first version of this got wrong. Turning the fabricated
 * contact into a hard exit fixed the lie and broke the pipeline: `npm run poll`
 * and `npm run discover` began refusing outright, so nothing was collected and
 * no shop was ever added, which reads exactly like every source disappearing.
 * That is a worse failure than the one being fixed, and it was mine.
 *
 * Three states, not two. A contact is best; no contact is acceptable for a shop
 * that does not ask for one; a FABRICATED contact is never acceptable, because
 * a header that claims to identify you and does not is worse than one that
 * makes no claim. So this falls back to a product string with no contact clause
 * — honest about having none — and tells the caller so it can say so.
 *
 * Wikimedia is the exception and keeps the hard requirement: its policy is a
 * real precondition there, enforced with a 403, not a courtesy.
 */
export function collectingUserAgent(contact = process.env.PROBE_CONTACT) {
  const identified = userAgent(contact);
  if (identified) return { ua: identified, anonymous: false };
  return { ua: 'resale-tracker/0.1 (personal price tracker)', anonymous: true };
}

/** Printed once per run when collecting without a contact. */
export const NO_CONTACT_WARNING = `  PROBE_CONTACT is not set, so these requests cannot say who is making them.
  A shop owner who notices them should be able to find you and ask you to stop.
  Set it to an email you read:  PROBE_CONTACT=you@example.com
`;

/** The message to print when there is no usable contact. */
export const NO_CONTACT = `
PROBE_CONTACT is not set to a usable contact.

  Every request this makes identifies itself, and one of the APIs it uses
  (Wikimedia's) answers 403 to a request that declines to say who is making
  it. The previous default wrote "contact not set" into that header, which is
  a request that was asked to identify itself and refused in words.

  Set it to an email or a URL you actually read:

    PROBE_CONTACT=you@example.com
`;
