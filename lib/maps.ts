/**
 * Address as shown on chips, modals, and share text. Always includes the
 * city — Paula found that "Neve Shalom St 15" alone reads like a snippet,
 * whereas "Neve Shalom St 15, Tel Aviv" is unmistakably an address. Returns
 * null when the location has no street info.
 */
export function formatAddress(loc: { street?: string | null; city?: string | null } | null | undefined): string | null {
  if (!loc) return null;
  const parts = [loc.street, loc.city].filter(Boolean);
  return parts.join(', ') || null;
}

export function mapsHref(loc: { lat?: number | null; lng?: number | null; label?: string; street?: string | null; city?: string | null } | null) {
  if (!loc) return null;
  if (loc.lat && loc.lng) return `https://maps.google.com/?q=${loc.lat},${loc.lng}`;
  // The on-screen label ("Gan Adam", "Drahi Community Center") confuses
  // Google's geocoder — it searches for those as place names and often
  // lands on the wrong pin. Build the query from street + city only.
  const q = encodeURIComponent([loc.street, loc.city].filter(Boolean).join(', '));
  return q ? `https://maps.google.com/?q=${q}` : null;
}
