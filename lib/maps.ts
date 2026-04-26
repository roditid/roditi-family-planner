/**
 * Cities the household considers implicit — they're omitted from the
 * displayed address since every address sits inside this city anyway.
 * The household_id-aware version could be promoted later; for now Paula's
 * household is entirely in Tel Aviv.
 */
const IMPLICIT_CITIES = new Set(['tel aviv', 'tel-aviv', 'tlv']);

/**
 * Address as shown on chips, modals, and share text. Drops the implicit
 * city so the line reads "Neve Shalom St 15" instead of "Neve Shalom St
 * 15, Tel Aviv". Returns null when the location has no street info.
 */
export function formatAddress(loc: { street?: string | null; city?: string | null } | null | undefined): string | null {
  if (!loc) return null;
  const city = (loc.city ?? '').trim();
  const cityKey = city.toLowerCase();
  const showCity = city && !IMPLICIT_CITIES.has(cityKey);
  const parts = [loc.street, showCity ? city : null].filter(Boolean);
  return parts.join(', ') || null;
}

export function mapsHref(loc: { lat?: number | null; lng?: number | null; label?: string; street?: string | null; city?: string | null } | null) {
  if (!loc) return null;
  if (loc.lat && loc.lng) return `https://maps.google.com/?q=${loc.lat},${loc.lng}`;
  // Maps query KEEPS the city since Google may need it to disambiguate the
  // address; only the on-screen line drops the implicit city.
  const q = encodeURIComponent([loc.label, loc.street, loc.city].filter(Boolean).join(', '));
  return q ? `https://maps.google.com/?q=${q}` : null;
}
