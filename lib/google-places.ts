// MENU MADE — Google Places API + Static Maps client.
//
// Uses Places API (New) v1 + Maps Static API.
// Free tier: $200/mo credit covers most testing/beta usage.
//
// Field-mask billing: every Place Details call we make is billed at the
// "Pro" SKU because we request rating + businessStatus. ~$0.017 / call.
// Static Maps: ~$0.002 / image. Both are cached aggressively (see places-cache.ts).

const PLACES_BASE = 'https://places.googleapis.com/v1';
const STATIC_MAPS_BASE = 'https://maps.googleapis.com/maps/api/staticmap';

function apiKey(): string {
  const k = process.env.GOOGLE_MAPS_API_KEY;
  if (!k) throw new Error('GOOGLE_MAPS_API_KEY is not set');
  return k;
}

export function isGoogleMapsConfigured(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

export interface PlaceDetails {
  placeId: string;
  name: string;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  userRatingCount: number | null;
  websiteUri: string | null;
  googleMapsUri: string | null;
  businessStatus: string | null; // OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
  phoneNumber: string | null;
  primaryType: string | null;
}

// Fields we ask for on a full Place Details fetch.
// Includes Pro-tier fields (rating, businessStatus, websiteUri).
const FULL_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.businessStatus',
  'places.internationalPhoneNumber',
  'places.primaryTypeDisplayName',
].join(',');

const STATUS_FIELD_MASK = 'id,businessStatus';

interface PlacesApiPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  googleMapsUri?: string;
  businessStatus?: string;
  internationalPhoneNumber?: string;
  primaryTypeDisplayName?: { text?: string };
}

function placeToDetails(p: PlacesApiPlace): PlaceDetails {
  return {
    placeId: p.id ?? '',
    name: p.displayName?.text ?? '',
    formattedAddress: p.formattedAddress ?? null,
    latitude: p.location?.latitude ?? null,
    longitude: p.location?.longitude ?? null,
    rating: typeof p.rating === 'number' ? p.rating : null,
    userRatingCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
    websiteUri: p.websiteUri ?? null,
    googleMapsUri: p.googleMapsUri ?? null,
    businessStatus: p.businessStatus ?? null,
    phoneNumber: p.internationalPhoneNumber ?? null,
    primaryType: p.primaryTypeDisplayName?.text ?? null,
  };
}

/**
 * Search for a restaurant by name + city via Places API "searchText".
 * Returns the top match with full details, or null if no match.
 */
export async function searchPlace(
  name: string,
  city?: string
): Promise<PlaceDetails | null> {
  const textQuery = city ? `${name} ${city}` : name;
  const r = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': FULL_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery,
      languageCode: 'en',
      maxResultCount: 1,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!r.ok) {
    const errText = await r.text();
    throw new Error(
      `Places searchText failed (${r.status}): ${errText.slice(0, 300)}`
    );
  }

  const data = (await r.json()) as { places?: PlacesApiPlace[] };
  const place = data.places?.[0];
  if (!place) return null;

  return placeToDetails(place);
}

/**
 * Tier B refresh — fetch only business_status for an already-known place_id.
 * Same Pro SKU pricing as full call (businessStatus is Pro-tier),
 * but the response is tiny so it's faster.
 */
export async function checkBusinessStatus(
  placeId: string
): Promise<string | null> {
  try {
    const r = await fetch(`${PLACES_BASE}/places/${placeId}`, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey(),
        'X-Goog-FieldMask': STATUS_FIELD_MASK,
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { businessStatus?: string };
    return data.businessStatus ?? null;
  } catch {
    return null;
  }
}

/**
 * Generate a Google Static Maps API URL.
 * The API key is embedded — restrict it by HTTP referrer in Cloud Console
 * to avoid abuse (https://menu-made.vercel.app/*).
 */
export interface MapOpts {
  lat: number;
  lng: number;
  zoom?: number;
  width?: number;
  height?: number;
  marker?: boolean;
}

export function getStaticMapUrl(opts: MapOpts): string {
  const {
    lat,
    lng,
    zoom = 17,
    width = 600,
    height = 400,
    marker = true,
  } = opts;
  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: String(zoom),
    size: `${width}x${height}`,
    scale: '2', // retina
    maptype: 'roadmap',
    key: apiKey(),
  });
  if (marker) {
    params.append('markers', `color:0x8b2a2a|size:mid|${lat},${lng}`);
  }
  return `${STATIC_MAPS_BASE}?${params.toString()}`;
}

/**
 * Build an OpenTable search URL for the restaurant. No API needed —
 * just deeplinks the user into OpenTable's search results.
 * If they have a listing, the user can book directly from there.
 */
export function bookingUrl(name: string, city?: string): string {
  const term = city ? `${name} ${city}` : name;
  return `https://www.opentable.com/s?term=${encodeURIComponent(term)}`;
}
