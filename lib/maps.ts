export function mapsHref(loc: { lat?: number | null; lng?: number | null; label?: string; street?: string | null; city?: string | null } | null) {
  if (!loc) return null;
  if (loc.lat && loc.lng) return `https://maps.google.com/?q=${loc.lat},${loc.lng}`;
  const q = encodeURIComponent([loc.label, loc.street, loc.city].filter(Boolean).join(', '));
  return q ? `https://maps.google.com/?q=${q}` : null;
}
