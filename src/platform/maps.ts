import { GOOGLE_MAPS_API_KEY } from '../data/env';
import type { LatLng } from '../domain/geo';

type GmapsReady = () => void | Promise<void>;

type MatrixElement = {
  status?: string;
  distance?: { value?: number };
  duration?: { value?: number };
};

type DistanceMatrixResponse = {
  rows?: Array<{ elements?: MatrixElement[] }>;
};

declare global {
  interface Window {
    google?: {
      maps?: {
        importLibrary?: (name: string) => Promise<Record<string, unknown>>;
        TravelMode?: { DRIVING?: string };
        DistanceMatrixService?: new () => {
          getDistanceMatrix: (
            req: {
              origins: LatLng[];
              destinations: LatLng[];
              travelMode?: string;
            },
            cb: (res: DistanceMatrixResponse | null, status: string) => void,
          ) => void;
        };
        Geocoder?: new () => {
          geocode: (
            req: { address?: string; location?: { lat: number; lng: number } },
            cb: (results: unknown[], status: string) => void,
          ) => void;
        };
      };
    };
    __venusGmapsReady?: () => void;
    __venusGmapsQueue?: GmapsReady[];
  }
}

let loading = false;
let loaded = false;

export function loadGoogleMaps(): Promise<void> {
  if (loaded && window.google?.maps) return Promise.resolve();
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));

  return new Promise((resolve, reject) => {
    const finish = () => {
      loaded = true;
      resolve();
    };

    if (window.google?.maps) {
      finish();
      return;
    }

    window.__venusGmapsQueue = window.__venusGmapsQueue || [];
    window.__venusGmapsQueue.push(finish);

    if (loading) return;
    loading = true;

    window.__venusGmapsReady = () => {
      loaded = true;
      loading = false;
      const queue = window.__venusGmapsQueue || [];
      window.__venusGmapsQueue = [];
      void queue.reduce(
        (chain, fn) => chain.then(() => Promise.resolve(fn())),
        Promise.resolve(),
      );
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&loading=async&callback=__venusGmapsReady`;
    script.async = true;
    script.onerror = () => {
      loading = false;
      reject(new Error('Google Maps failed to load'));
    };
    document.head.appendChild(script);
  });
}

export type PlaceSuggestion = {
  id: string;
  label: string;
  secondary?: string;
  placeId?: string;
  lat?: number;
  lng?: number;
};

export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  await loadGoogleMaps();
  const maps = window.google?.maps;
  if (!maps?.importLibrary) return [];

  try {
    const lib = (await maps.importLibrary('places')) as {
      AutocompleteSuggestion?: {
        fetchAutocompleteSuggestions: (req: Record<string, unknown>) => Promise<{
          suggestions?: Array<{
            placePrediction?: {
              placeId?: string;
              text?: { text?: string };
              mainText?: { text?: string };
              secondaryText?: { text?: string };
              toPlace?: () => { fetchFields: (opts: { fields: string[] }) => Promise<void>; location?: { lat: () => number; lng: () => number } };
            };
          }>;
        }>;
      };
      AutocompleteSessionToken?: new () => unknown;
    };
    if (!lib.AutocompleteSuggestion) return [];
    const token = lib.AutocompleteSessionToken ? new lib.AutocompleteSessionToken() : undefined;
    const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: q,
      includedRegionCodes: ['ug'],
      language: 'en',
      sessionToken: token,
    });
    return (suggestions || [])
      .map((s, i) => {
        const p = s.placePrediction;
        if (!p) return null;
        return {
          id: p.placeId || `s-${i}`,
          placeId: p.placeId,
          label: p.mainText?.text || p.text?.text || '',
          secondary: p.secondaryText?.text || '',
        } as PlaceSuggestion;
      })
      .filter(Boolean) as PlaceSuggestion[];
  } catch {
    return [];
  }
}

export type DrivingRoute = { km: number; durationMin: number | null };

/** Road distance via Distance Matrix. Null when Maps is unavailable or the route fails. */
export async function drivingRoute(origin: LatLng, dest: LatLng): Promise<DrivingRoute | null> {
  try {
    await loadGoogleMaps();
  } catch {
    return null;
  }
  const maps = window.google?.maps;
  const Matrix = maps?.DistanceMatrixService;
  if (!maps || !Matrix) return null;
  return new Promise((resolve) => {
    try {
      const service = new Matrix();
      service.getDistanceMatrix(
        {
          origins: [origin],
          destinations: [dest],
          travelMode: maps.TravelMode?.DRIVING || 'DRIVING',
        },
        (res, status) => {
          const el = res?.rows?.[0]?.elements?.[0];
          if (status === 'OK' && el?.status === 'OK' && el.distance?.value != null) {
            const mins = el.duration?.value != null ? el.duration.value / 60 : null;
            resolve({ km: el.distance.value / 1000, durationMin: mins });
            return;
          }
          resolve(null);
        },
      );
    } catch {
      resolve(null);
    }
  });
}

export async function resolvePlace(suggestion: PlaceSuggestion): Promise<PlaceSuggestion> {
  await loadGoogleMaps();
  const maps = window.google?.maps;
  if (!maps?.importLibrary || !suggestion.placeId) return suggestion;

  try {
    const lib = (await maps.importLibrary('places')) as {
      Place?: new (opts: { id: string }) => {
        fetchFields: (opts: { fields: string[] }) => Promise<void>;
        displayName?: string;
        formattedAddress?: string;
        location?: { lat: () => number; lng: () => number };
      };
    };
    if (!lib.Place) return suggestion;
    const place = new lib.Place({ id: suggestion.placeId });
    await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
    const loc = place.location;
    return {
      ...suggestion,
      label: place.formattedAddress || place.displayName || suggestion.label,
      lat: loc ? loc.lat() : suggestion.lat,
      lng: loc ? loc.lng() : suggestion.lng,
    };
  } catch {
    return suggestion;
  }
}
