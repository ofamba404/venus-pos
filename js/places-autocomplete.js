import { GOOGLE_MAPS_API_KEY } from './config.js';
import { animateDropdown } from './animations.js';
import { highlightClientName } from './clients.js';
import { logDebug } from './debug.js';
import { escapeHtml, showToast } from './utils.js';

const PLACE_PIN_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.2s7.2-6.8 7.2-12.4a7.2 7.2 0 1 0-14.4 0c0 5.6 7.2 12.4 7.2 12.4z"></path><circle cx="12" cy="8.8" r="2.4"></circle></svg>`;
const MIN_QUERY_LEN = 2;
const FETCH_DEBOUNCE_MS = 160;
const SUGGESTION_CACHE_TTL_MS = 5 * 60 * 1000;
const SUGGESTION_CACHE_MAX = 48;
const MAX_SUGGESTIONS = 8;
/** Greater Kampala — bias autocomplete/text search toward local POIs (SafeBoda-style). */
const KAMPALA_CENTER = { lat: 0.3476, lng: 32.5825 };
const KAMPALA_BIAS_RADIUS_M = 40000;
const GPS_BIAS_RADIUS_M = 15000;
/** When query looks like "place + suburb", search the place near that suburb. */
const AREA_BIAS_RADIUS_M = 12000;
const MAX_AREA_FROM_KAMPALA_M = 55000;
/** Prefer named places within this distance of the GPS fix. */
const NEARBY_POI_RADIUS_M = 90;
const NEARBY_POI_MAX_M = 140;

/** Geocode types that mean a neighborhood / suburb, not a street or building. */
const AREA_GEOCODE_TYPES = new Set([
  'locality',
  'sublocality',
  'sublocality_level_1',
  'sublocality_level_2',
  'sublocality_level_3',
  'neighborhood',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'administrative_area_level_4',
]);

/**
 * Legal / corporate suffixes only. Do NOT strip landmark words like
 * "University" — SafeBoda keeps those in POI names (e.g. Makerere University Main Gate).
 */
const OPTIONAL_NAME_FILLERS = new Set([
  'limited',
  'ltd',
  'plc',
  'company',
  'co',
  'the',
]);

/**
 * Words that often mean "find this kind of place near an area" (SafeBoda
 * returns nearby parks/malls/gates even when the exact compound name is missing).
 */
const PLACE_HINT_RE =
  /\b(mall|market|park|gate|hostel|hotel|lodge|church|mosque|cathedral|university|campus|school|hospital|clinic|stage|taxi|terminal|complex|plaza|centre|center|junction|roundabout|estate|towers?|arcade|supermarket|shops?|restaurant|cafe|stadium|pitch)\b/i;

let gmapsLoaded = false;
let gmapsLoading = false;

/** @type {Promise<Record<string, unknown>> | null} */
let placesLibPromise = null;

/** @type {{ lat: number, lng: number } | null} */
let placesSearchOrigin = null;

/** @type {Map<string, { at: number, predictions: unknown[] }>} */
const suggestionCache = new Map();

/** @type {Array<{ cleanup: () => void }>} */
const activeWidgets = [];
let wireGeneration = 0;

function getPlacesLibrary() {
  if (!placesLibPromise) {
    placesLibPromise = google.maps.importLibrary('places').catch((err) => {
      placesLibPromise = null;
      throw err;
    });
  }
  return placesLibPromise;
}

function prefetchPlacesLibrary() {
  if (window.google?.maps) void getPlacesLibrary();
}

/** Remember GPS / last pin so autocomplete ranks nearby Kampala POIs first. */
export function setPlacesSearchOrigin(latLng) {
  const lat = Number(latLng?.lat);
  const lng = Number(latLng?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  placesSearchOrigin = { lat, lng };
}

function biasCenter() {
  return placesSearchOrigin || KAMPALA_CENTER;
}

function biasRadiusM() {
  return placesSearchOrigin ? GPS_BIAS_RADIUS_M : KAMPALA_BIAS_RADIUS_M;
}

function suggestionCacheKey(query, regionCodes) {
  const c = biasCenter();
  const cell = `${c.lat.toFixed(2)},${c.lng.toFixed(2)}`;
  return `${(regionCodes || []).join(',')}\0${cell}\0${query}`;
}

function toLatLngLiteral(loc) {
  if (!loc) return null;
  const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
  const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function tokenizeQuery(query) {
  return String(query || '')
    .trim()
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.replace(/[^\p{L}\p{N}']+/gu, ''))
    .filter((t) => t.length >= 2);
}

function stripTrailingCountry(addr) {
  return String(addr || '')
    .replace(/,\s*Uganda\s*$/i, '')
    .replace(/,\s*UG\s*$/i, '')
    .trim();
}

/**
 * SafeBoda-like parts: short place name + road/suburb secondary (no country,
 * and without repeating the place name inside the address).
 */
function formatPlaceParts(place, fallbackMain = '', fallbackSecondary = '') {
  const name = (place?.displayName || fallbackMain || '').trim();
  let addr = stripTrailingCountry(place?.formattedAddress || fallbackSecondary || '');
  if (name && addr) {
    const nameLc = name.toLowerCase();
    const addrLc = addr.toLowerCase();
    if (addrLc === nameLc) addr = '';
    else if (addrLc.startsWith(nameLc)) {
      addr = addr.slice(name.length).replace(/^[\s,]+/, '');
    }
  }
  return {
    main: name || addr,
    secondary: name && addr ? addr : '',
  };
}

/** Ride-app style single-line label for inputs / stored trips. */
function formatPlaceLabel(place, fallbackMain = '', fallbackSecondary = '') {
  const { main, secondary } = formatPlaceParts(place, fallbackMain, fallbackSecondary);
  if (main && secondary) return `${main}, ${secondary}`;
  return main || secondary || '';
}

/**
 * Prefer the official POI displayName (what SafeBoda / Google list as the place),
 * with a cleaned road/suburb secondary — not a shortened colloquial form.
 */
function labelFromSelection(prediction, place, query = '') {
  const predMain = (prediction?.mainText?.text || '').trim();
  const predSecondary = stripTrailingCountry(prediction?.secondaryText?.text || '');
  const official = (place?.displayName || '').trim();

  // Official place name wins (e.g. "Makerere University Main Gate").
  let main = official || predMain;
  main = colloquializeAgainstQuery(main, query);
  const { secondary } = formatPlaceParts(
    { displayName: main, formattedAddress: place?.formattedAddress || predSecondary },
    main,
    predSecondary,
  );
  if (main && secondary) return `${main}, ${secondary}`;
  return main || secondary || formatPlaceLabel(place);
}

/** Drop Google institutional fillers the user didn't type (e.g. "University"). */
function colloquializeAgainstQuery(name, query) {
  const queryTokens = tokenizeQuery(query);
  if (!queryTokens.length) return name;
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2) return name;

  const kept = [];
  let dropped = false;
  for (const part of parts) {
    const t = part.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');
    if (OPTIONAL_NAME_FILLERS.has(t) && !queryTokens.includes(t)) {
      dropped = true;
      continue;
    }
    kept.push(part);
  }
  if (!dropped || !kept.length) return name;
  if (tokenCoverage(kept.join(' '), queryTokens) + 0.05 < tokenCoverage(name, queryTokens)) {
    return name;
  }
  return kept.join(' ');
}

function tokenCoverage(haystack, tokens) {
  if (!tokens.length) return 0;
  const h = String(haystack || '').toLowerCase();
  let hit = 0;
  for (const t of tokens) {
    if (h.includes(t)) hit += 1;
  }
  return hit / tokens.length;
}

function surplusNamePenalty(name, queryTokens) {
  const nameTokens = tokenizeQuery(name);
  if (!nameTokens.length) return 0;
  let extra = 0;
  for (const t of nameTokens) {
    // Landmark fillers that are part of the real POI name shouldn't lose rank
    // when the user omits them (query "makerere main gate" → still rank
    // "Makerere University Main Gate" highly).
    if (OPTIONAL_NAME_FILLERS.has(t)) continue;
    if (
      t === 'university' ||
      t === 'international' ||
      t === 'campus'
    ) {
      continue;
    }
    if (!queryTokens.includes(t)) extra += 1;
  }
  return nameTokens.length ? extra / nameTokens.length : 0;
}

function isAreaGeocodeResult(result) {
  const types = result?.types || [];
  return types.some((t) => AREA_GEOCODE_TYPES.has(t));
}

/**
 * Kampala-style queries are often "place + area" or "area + place".
 * Propose a few split candidates without hardcoding suburb names.
 */
function areaPlaceSplitCandidates(query) {
  const raw = String(query || '').trim().replace(/\s+/g, ' ');
  const parts = raw.split(' ').filter(Boolean);
  if (parts.length < 2) return [];

  /** @type {Array<{ area: string, place: string }>} */
  const out = [];
  const push = (area, place) => {
    const a = area.trim();
    const p = place.trim();
    if (a.length < 2 || p.length < 2) return;
    if (out.some((c) => c.area === a && c.place === p)) return;
    out.push({ area: a, place: p });
  };

  // Area as prefix (Kawempe Taxi Park) — first 1–2 tokens.
  push(parts[0], parts.slice(1).join(' '));
  if (parts.length >= 4) push(parts.slice(0, 2).join(' '), parts.slice(2).join(' '));

  // Area as suffix (Village Mall Bugolobi) — last 1–2 tokens.
  push(parts[parts.length - 1], parts.slice(0, -1).join(' '));
  if (parts.length >= 3) {
    push(parts.slice(-2).join(' '), parts.slice(0, -2).join(' '));
  }

  // Prefer splits where the "place" side looks landmark-ish.
  out.sort((a, b) => {
    const aHint = PLACE_HINT_RE.test(a.place) ? 1 : 0;
    const bHint = PLACE_HINT_RE.test(b.place) ? 1 : 0;
    return bHint - aHint;
  });

  return out.slice(0, 4);
}

function geocodeAreaQuery(areaText, regionCodes) {
  return new Promise((resolve) => {
    try {
      new google.maps.Geocoder().geocode(
        {
          address: `${areaText}, Kampala, Uganda`,
          componentRestrictions: { country: regionCodes?.[0] || 'ug' },
        },
        (results, status) => {
          if (status !== 'OK' || !results?.length) {
            resolve(null);
            return;
          }

          const areaTokens = tokenizeQuery(areaText);
          const scoreResult = (result) => {
            const loc = toLatLngLiteral(result.geometry?.location);
            if (!loc) return -1;
            if (haversineMeters(loc, KAMPALA_CENTER) > MAX_AREA_FROM_KAMPALA_M) return -1;
            const label = result.formatted_address || '';
            const cov = tokenCoverage(label, areaTokens);
            if (cov < 0.5) return -1;
            // Prefer true suburb/locality hits over buildings.
            return (isAreaGeocodeResult(result) ? 20 : 8) + cov * 10;
          };

          let best = null;
          let bestScore = 0;
          for (const result of results) {
            const score = scoreResult(result);
            if (score > bestScore) {
              bestScore = score;
              best = result;
            }
          }
          if (!best) {
            resolve(null);
            return;
          }
          resolve({
            center: toLatLngLiteral(best.geometry.location),
            label: best.formatted_address || areaText,
            types: best.types || [],
          });
        },
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * Resolve the best suburb/area bias from split candidates (parallel, capped).
 * @returns {Promise<{ center: {lat:number,lng:number}, area: string, place: string } | null>}
 */
async function resolveQueryAreaBias(query, regionCodes) {
  const candidates = areaPlaceSplitCandidates(query);
  if (!candidates.length) return null;

  const resolved = await Promise.all(
    candidates.map(async (c) => {
      const area = await geocodeAreaQuery(c.area, regionCodes);
      if (!area) return null;
      return { ...c, center: area.center, areaLabel: area.label };
    }),
  );

  const hits = resolved.filter(Boolean);
  if (!hits.length) return null;

  // Prefer landmark-ish place side, then closest area geocode to Kampala center
  // only as a tie-break (already filtered to metro).
  hits.sort((a, b) => {
    const aHint = PLACE_HINT_RE.test(a.place) ? 1 : 0;
    const bHint = PLACE_HINT_RE.test(b.place) ? 1 : 0;
    if (bHint !== aHint) return bHint - aHint;
    // Prefer shorter area strings that still geocoded (more likely a suburb name).
    return a.area.length - b.area.length;
  });

  return hits[0];
}

function predictionDedupKey(prediction) {
  const main = (prediction?.mainText?.text || '').trim().toLowerCase();
  const secondary = (prediction?.secondaryText?.text || '').trim().toLowerCase();
  if (main || secondary) return `${main}\0${secondary}`;
  return (prediction?.text?.toString?.() || '').trim().toLowerCase();
}

function scorePrediction(prediction, query, areaBias) {
  const queryTokens = tokenizeQuery(query);
  const main = prediction?.mainText?.text || '';
  const secondary = prediction?.secondaryText?.text || '';
  const full = prediction?.text?.toString?.() || `${main} ${secondary}`;
  const mainCov = tokenCoverage(main, queryTokens);
  const fullCov = tokenCoverage(full, queryTokens);
  const areaTokens = areaBias ? tokenizeQuery(areaBias.area) : [];
  const placeTokens = areaBias ? tokenizeQuery(areaBias.place) : queryTokens;

  let score = fullCov * 40 + mainCov * 35;
  score += tokenCoverage(main, placeTokens) * 25;
  score -= surplusNamePenalty(main, placeTokens) * 18;

  if (areaBias) {
    const areaHit =
      tokenCoverage(secondary, areaTokens) * 20 + tokenCoverage(full, areaTokens) * 10;
    score += areaHit;
    const loc = prediction?.location || null;
    if (loc && areaBias.center) {
      const dist = haversineMeters(loc, areaBias.center);
      // Prefer results inside ~12km of the area; soft falloff after.
      score += Math.max(0, 22 - dist / 600);
    }
  }

  if (PLACE_HINT_RE.test(query) && PLACE_HINT_RE.test(main)) score += 6;
  if (prediction?.kind === 'place') score += 2;
  return score;
}

function rankPredictions(predictions, query, areaBias) {
  return [...predictions].sort(
    (a, b) => scorePrediction(b, query, areaBias) - scorePrediction(a, query, areaBias),
  );
}

function mergePredictions(lists, query, areaBias, limit = MAX_SUGGESTIONS) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const item of list || []) {
      const key = predictionDedupKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return rankPredictions(merged, query, areaBias).slice(0, limit);
}

function getCachedSuggestions(key) {
  const hit = suggestionCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SUGGESTION_CACHE_TTL_MS) {
    suggestionCache.delete(key);
    return null;
  }
  // LRU touch
  suggestionCache.delete(key);
  suggestionCache.set(key, hit);
  return hit.predictions;
}

function setCachedSuggestions(key, predictions) {
  if (suggestionCache.has(key)) suggestionCache.delete(key);
  suggestionCache.set(key, { at: Date.now(), predictions });
  while (suggestionCache.size > SUGGESTION_CACHE_MAX) {
    const oldest = suggestionCache.keys().next().value;
    suggestionCache.delete(oldest);
  }
}

export function loadGoogleMaps(cb) {
  if (gmapsLoaded && window.google?.maps) {
    prefetchPlacesLibrary();
    Promise.resolve().then(() => cb());
    return;
  }
  window.__venusGmapsQueue = window.__venusGmapsQueue || [];
  window.__venusGmapsQueue.push(cb);
  if (gmapsLoading) return;
  gmapsLoading = true;
  window.__venusGmapsReady = () => {
    gmapsLoaded = true;
    gmapsLoading = false;
    prefetchPlacesLibrary();
    const queue = window.__venusGmapsQueue || [];
    window.__venusGmapsQueue = [];
    queue.reduce(
      (chain, fn) => chain.then(() => Promise.resolve(fn())),
      Promise.resolve(),
    );
  };
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&loading=async&callback=__venusGmapsReady`;
  script.async = true;
  script.onerror = () => {
    gmapsLoading = false;
    logDebug('Google Maps script failed to load.');
    showToast('Could not load Google Maps — check the API key', true);
  };
  document.head.appendChild(script);
}

export function deliveryPlaceFieldMarkup({
  inputId,
  dropdownId,
  value = '',
  placeholder = '',
  icon = '',
}) {
  return `
    <div class="delivery-place-field">
      <div class="delivery-place-input-row">
        ${icon ? `<span class="di-icon">${icon}</span>` : ''}
        <input type="text" class="client-input" id="${inputId}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" value="${escapeHtml(value)}" aria-autocomplete="list" aria-controls="${dropdownId}" aria-expanded="false" />
      </div>
      <div class="suggest-menu delivery-place-dropdown" id="${dropdownId}" role="listbox"></div>
    </div>`;
}

export function clearPlaceAutocompleteWidgets() {
  activeWidgets.forEach((widget) => widget.cleanup());
  activeWidgets.length = 0;
}

const GEOCODE_LOCATION_RANK = {
  ROOFTOP: 0,
  RANGE_INTERPOLATED: 1,
  GEOMETRIC_CENTER: 2,
  APPROXIMATE: 3,
};

const GEOCODE_TYPE_RANK = [
  'premise',
  'subpremise',
  'point_of_interest',
  'establishment',
  'street_address',
  'intersection',
  'route',
  'plus_code',
  'neighborhood',
  'sublocality_level_1',
  'sublocality',
  'locality',
];

function geocodeTypeRank(result) {
  const types = result?.types || [];
  let best = GEOCODE_TYPE_RANK.length;
  for (const type of types) {
    const idx = GEOCODE_TYPE_RANK.indexOf(type);
    if (idx !== -1 && idx < best) best = idx;
  }
  return best;
}

function pickBestGeocodeResult(results) {
  if (!results?.length) return null;
  let best = results[0];
  let bestLoc = GEOCODE_LOCATION_RANK[best.geometry?.location_type] ?? 9;
  let bestType = geocodeTypeRank(best);
  for (let i = 1; i < results.length; i++) {
    const result = results[i];
    const loc = GEOCODE_LOCATION_RANK[result.geometry?.location_type] ?? 9;
    if (loc > bestLoc) continue;
    const type = geocodeTypeRank(result);
    if (loc < bestLoc || type < bestType) {
      best = result;
      bestLoc = loc;
      bestType = type;
    }
  }
  return best;
}

function isCoarseGeocodeResult(result) {
  if (!result) return true;
  if (result.geometry?.location_type === 'APPROXIMATE') {
    const types = result.types || [];
    return !types.some((t) =>
      [
        'street_address',
        'premise',
        'subpremise',
        'point_of_interest',
        'establishment',
        'route',
        'intersection',
        'plus_code',
      ].includes(t),
    );
  }
  return false;
}

function plusCodeLabel(results) {
  const plus = results?.find((r) => (r.types || []).includes('plus_code'));
  return plus?.formatted_address || '';
}

function geocodeAddress(latLng) {
  return new Promise((resolve) => {
    try {
      new google.maps.Geocoder().geocode({ location: latLng }, (results, status) => {
        if (status !== 'OK' || !results?.length) {
          resolve({ label: '', results: [] });
          return;
        }
        const best = pickBestGeocodeResult(results);
        const plus = plusCodeLabel(results);
        if (isCoarseGeocodeResult(best) && plus) {
          resolve({ label: plus, results });
          return;
        }
        resolve({ label: best?.formatted_address || plus || '', results });
      });
    } catch {
      resolve({ label: '', results: [] });
    }
  });
}

/**
 * Closest named place near the pin — ride apps surface these over bare street numbers.
 */
async function findNearbyPoiLabel(latLng) {
  try {
    const { Place, SearchNearbyRankPreference } = await getPlacesLibrary();
    const center = { lat: Number(latLng.lat), lng: Number(latLng.lng) };
    const { places } = await Place.searchNearby({
      fields: ['displayName', 'formattedAddress', 'location', 'types'],
      locationRestriction: { center, radius: NEARBY_POI_RADIUS_M },
      maxResultCount: 5,
      rankPreference: SearchNearbyRankPreference.DISTANCE,
    });
    if (!places?.length) return '';

    let best = null;
    let bestDist = Infinity;
    for (const place of places) {
      const loc = toLatLngLiteral(place.location);
      if (!loc) continue;
      const dist = haversineMeters(center, loc);
      if (dist > NEARBY_POI_MAX_M) continue;
      const types = place.types || [];
      // Skip generic political/admin areas — we want hostels, shops, landmarks.
      if (
        types.includes('locality') ||
        types.includes('political') ||
        types.includes('administrative_area_level_1') ||
        types.includes('administrative_area_level_2') ||
        types.includes('country') ||
        types.includes('route')
      ) {
        continue;
      }
      if (dist < bestDist) {
        best = place;
        bestDist = dist;
      }
    }
    return best ? formatPlaceLabel(best) : '';
  } catch (err) {
    logDebug(`Nearby POI lookup failed: ${err?.message || err}`);
    return '';
  }
}

/**
 * Reverse-geocode coords → human label. Prefers nearby POI names (SafeBoda-like)
 * over bare street numbers when Google has a place within ~90m.
 */
export function reverseGeocodeLabel(latLng, cb) {
  setPlacesSearchOrigin(latLng);
  loadGoogleMaps(() => {
    const fallback = `${Number(latLng.lat).toFixed(5)}, ${Number(latLng.lng).toFixed(5)}`;
    void (async () => {
      try {
        const [{ label: streetLabel }, poiLabel] = await Promise.all([
          geocodeAddress(latLng),
          findNearbyPoiLabel(latLng),
        ]);
        cb(poiLabel || streetLabel || fallback);
      } catch (err) {
        logDebug(`Reverse geocode failed: ${err?.message || err}`);
        cb(fallback);
      }
    })();
  });
}

function resolveDeliveryInput(id) {
  const el = document.getElementById(id);
  if (!el || el.tagName !== 'INPUT') return null;
  return el;
}

function highlightFormattableText(formattable) {
  const text = formattable?.text || '';
  const matches = formattable?.matches || [];
  if (!text) return '';
  if (!matches.length) return escapeHtml(text);

  let needsSort = false;
  for (let i = 1; i < matches.length; i++) {
    if (matches[i].startOffset < matches[i - 1].startOffset) {
      needsSort = true;
      break;
    }
  }
  const ordered = needsSort
    ? [...matches].sort((a, b) => a.startOffset - b.startOffset)
    : matches;

  let html = '';
  let last = 0;
  for (const match of ordered) {
    html += escapeHtml(text.slice(last, match.startOffset));
    html += `<mark class="client-match">${escapeHtml(text.slice(match.startOffset, match.endOffset))}</mark>`;
    last = match.endOffset;
  }
  html += escapeHtml(text.slice(last));
  return html;
}

function wrapAutocompletePrediction(placePrediction) {
  return {
    kind: 'autocomplete',
    placePrediction,
    location: null,
    mainText: placePrediction.mainText,
    secondaryText: placePrediction.secondaryText,
    text: placePrediction.text,
  };
}

function wrapTextSearchPlace(place) {
  const { main, secondary } = formatPlaceParts(place);
  return {
    kind: 'place',
    place,
    location: toLatLngLiteral(place.location),
    mainText: { text: main, matches: [] },
    secondaryText: secondary ? { text: secondary, matches: [] } : null,
    text: { toString: () => formatPlaceLabel(place) },
  };
}

function renderPredictionLabel(prediction, query) {
  if (prediction.mainText?.text) {
    // Keep official POI wording in the list (SafeBoda parity) — only strip
    // corporate suffixes, never landmark words like "University".
    const colloquialMain = colloquializeAgainstQuery(prediction.mainText.text, query);
    const mainChanged = colloquialMain && colloquialMain !== prediction.mainText.text;
    const main = highlightFormattableText(
      mainChanged
        ? { text: colloquialMain, matches: [] }
        : prediction.mainText,
    );
    const secondaryRaw = stripTrailingCountry(prediction.secondaryText?.text || '');
    const secondaryChanged = secondaryRaw !== (prediction.secondaryText?.text || '');
    const secondary = secondaryRaw
      ? `<span class="delivery-place-row-secondary">${highlightFormattableText({
          text: secondaryRaw,
          matches: secondaryChanged ? [] : prediction.secondaryText?.matches || [],
        })}</span>`
      : '';
    return `${main}${secondary}`;
  }

  const full = prediction.text?.toString?.() || '';
  return highlightClientName(full, query);
}

async function searchPlacesByText(query, regionCodes, { center: bias = null, radiusM = null } = {}) {
  const { Place } = await getPlacesLibrary();
  const center = bias || biasCenter();
  const radius = radiusM ?? (bias ? AREA_BIAS_RADIUS_M : biasRadiusM());
  const { places } = await Place.searchByText({
    textQuery: query,
    fields: ['displayName', 'formattedAddress', 'location'],
    locationBias: { center, radius },
    region: regionCodes?.[0] || 'ug',
    maxResultCount: MAX_SUGGESTIONS,
  });
  return (places || []).map(wrapTextSearchPlace);
}

const BLUR_HIDE_MS = 140;

function attachPlaceAutocomplete(
  input,
  dropdown,
  { onSelect, onInput, onFocus, onActivate, regionCodes = ['ug'] },
) {
  let sessionToken = null;
  let debounceTimer = null;
  let hideTimer = null;
  let requestGen = 0;
  let selecting = false;
  let activeQuery = '';
  /** @type {unknown[]} */
  let visiblePredictions = [];

  const setExpanded = (open) => {
    input.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  const hide = () => {
    clearTimeout(hideTimer);
    hideTimer = null;
    animateDropdown(dropdown, false);
    setExpanded(false);
  };

  const hideSoon = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!selecting) hide();
    }, BLUR_HIDE_MS);
  };

  const cancelHide = () => {
    clearTimeout(hideTimer);
    hideTimer = null;
  };

  const showResults = (html, { contentUpdate = false } = {}) => {
    dropdown.innerHTML = html;
    animateDropdown(dropdown, true, { contentUpdate });
    setExpanded(true);
  };

  const renderPredictions = (predictions, trimmed, { contentUpdate = false } = {}) => {
    visiblePredictions = predictions;
    if (!predictions.length) {
      showResults('<div class="suggest-empty delivery-place-empty">No matches</div>', { contentUpdate });
      return;
    }

    const html = predictions
      .map(
        (prediction, index) => `
        <button class="suggest-row delivery-place-row" type="button" role="option" data-prediction="${index}">
          <span class="delivery-place-row-icon" aria-hidden="true">${PLACE_PIN_ICON}</span>
          <span class="delivery-place-row-text">${renderPredictionLabel(prediction, trimmed)}</span>
        </button>`,
      )
      .join('');

    showResults(html, { contentUpdate });
  };

  const scheduleFetch = (query) => {
    clearTimeout(debounceTimer);
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LEN) {
      void fetchSuggestions(query);
      return;
    }

    const cacheKey = suggestionCacheKey(trimmed.toLowerCase(), regionCodes);
    if (getCachedSuggestions(cacheKey)) {
      void fetchSuggestions(query);
      return;
    }

    const wasOpen = dropdown.classList.contains('open');
    if (!wasOpen) {
      showResults(`
        <div class="delivery-place-loading" role="status" aria-live="polite" aria-label="Searching locations">
          ${[0, 1, 2]
            .map(
              (i) => `
            <div class="delivery-place-loading-row" style="animation-delay:${i * 80}ms">
              <span class="delivery-place-loading-pin" aria-hidden="true"></span>
              <span class="delivery-place-loading-lines" aria-hidden="true">
                <span class="sk-line wide"></span>
                <span class="sk-line short"></span>
              </span>
            </div>`,
            )
            .join('')}
        </div>`);
    }

    debounceTimer = setTimeout(() => {
      void fetchSuggestions(query);
    }, FETCH_DEBOUNCE_MS);
  };

  const fetchSuggestions = async (query) => {
    const trimmed = query.trim();
    activeQuery = trimmed;

    if (trimmed.length < MIN_QUERY_LEN) {
      visiblePredictions = [];
      dropdown.innerHTML = '';
      hide();
      return;
    }

    const normalized = trimmed.toLowerCase();
    const cacheKey = suggestionCacheKey(normalized, regionCodes);
    const cached = getCachedSuggestions(cacheKey);
    if (cached) {
      renderPredictions(cached, trimmed, {
        contentUpdate: dropdown.classList.contains('open'),
      });
      return;
    }

    const reqId = ++requestGen;
    const wasOpen = dropdown.classList.contains('open');

    try {
      const { AutocompleteSessionToken, AutocompleteSuggestion } = await getPlacesLibrary();
      if (!sessionToken) sessionToken = new AutocompleteSessionToken();

      const center = biasCenter();
      const areaBiasPromise =
        trimmed.split(/\s+/).filter(Boolean).length >= 2
          ? resolveQueryAreaBias(trimmed, regionCodes)
          : Promise.resolve(null);

      const [suggestResult, areaBias] = await Promise.all([
        AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: trimmed,
          sessionToken,
          includedRegionCodes: regionCodes,
          region: regionCodes?.[0] || 'ug',
          language: 'en',
          locationBias: { center, radius: biasRadiusM() },
          origin: center,
        }),
        areaBiasPromise,
      ]);
      if (reqId !== requestGen || activeQuery !== trimmed) return;

      let predictions = (suggestResult.suggestions || [])
        .map((suggestion) => suggestion.placePrediction)
        .filter(Boolean)
        .map(wrapAutocompletePrediction);

      /** @type {unknown[][]} */
      const extraLists = [];

      // Autocomplete alone often misses Kampala POIs; text search fills gaps.
      const wantsTextFallback =
        trimmed.length >= 3 &&
        (predictions.length < 4 || /\s/.test(trimmed) || PLACE_HINT_RE.test(trimmed));

      const textJobs = [];
      if (wantsTextFallback) {
        textJobs.push(
          searchPlacesByText(trimmed, regionCodes).then((hits) => {
            extraLists.push(hits);
          }),
        );
      }

      // SafeBoda-like: "Kawempe Taxi Park" / "Village Mall Bugolobi" →
      // search the place side near the area side when the compound name is missing.
      if (areaBias?.place && areaBias?.center) {
        textJobs.push(
          searchPlacesByText(areaBias.place, regionCodes, {
            center: areaBias.center,
            radiusM: AREA_BIAS_RADIUS_M,
          }).then((hits) => {
            extraLists.push(hits);
          }),
        );
        // Also try the full query biased to that area (helps "Makerere main gate").
        if (areaBias.place.toLowerCase() !== trimmed.toLowerCase()) {
          textJobs.push(
            searchPlacesByText(trimmed, regionCodes, {
              center: areaBias.center,
              radiusM: AREA_BIAS_RADIUS_M,
            }).then((hits) => {
              extraLists.push(hits);
            }),
          );
        }
      }

      if (textJobs.length) {
        try {
          await Promise.all(textJobs);
        } catch (textErr) {
          logDebug(`Place text search failed: ${textErr?.message || textErr}`);
        }
        if (reqId !== requestGen || activeQuery !== trimmed) return;
      }

      predictions = mergePredictions([predictions, ...extraLists], trimmed, areaBias);
      setCachedSuggestions(cacheKey, predictions);
      renderPredictions(predictions, trimmed, { contentUpdate: wasOpen });
    } catch (err) {
      if (reqId !== requestGen) return;
      logDebug(`Place suggestions failed: ${err?.message || err}`);
      // Last resort: text search only (still Kampala-biased).
      try {
        const textHits = await searchPlacesByText(trimmed, regionCodes);
        if (reqId !== requestGen || activeQuery !== trimmed) return;
        const ranked = mergePredictions([textHits], trimmed, null);
        setCachedSuggestions(cacheKey, ranked);
        renderPredictions(ranked, trimmed, { contentUpdate: wasOpen });
      } catch {
        hide();
      }
    }
  };

  const selectPrediction = async (prediction) => {
    selecting = true;
    cancelHide();
    try {
      let place;
      if (prediction?.kind === 'place' && prediction.place) {
        place = prediction.place;
        if (!place.location || !place.formattedAddress) {
          await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
        }
      } else {
        const placePrediction = prediction?.placePrediction || prediction;
        place = placePrediction.toPlace();
        await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
      }

      const coords = toLatLngLiteral(place.location);
      if (!coords) return;
      const label =
        labelFromSelection(prediction, place, activeQuery) ||
        prediction?.text?.toString?.() ||
        '';
      input.value = label;
      sessionToken = null;
      setPlacesSearchOrigin(coords);
      hide();
      onSelect({
        lat: coords.lat,
        lng: coords.lng,
        label,
      });
    } catch (err) {
      logDebug(`Place select failed: ${err?.message || err}`);
    } finally {
      selecting = false;
    }
  };

  const onInputHandler = () => {
    onInput?.(input.value);
    scheduleFetch(input.value);
  };

  const onFocusHandler = () => {
    cancelHide();
    prefetchPlacesLibrary();
    onFocus?.();
    onActivate?.();
    if (input.value.trim().length >= MIN_QUERY_LEN) scheduleFetch(input.value);
  };

  const onBlurHandler = () => {
    if (!selecting) hideSoon();
  };

  const onKeyDown = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    hide();
    input.blur();
  };

  const preventRowBlur = (e) => {
    if (e.target.closest?.('.suggest-row, .delivery-place-row')) e.preventDefault();
  };

  const onDropdownClick = (e) => {
    const row = e.target.closest?.('.delivery-place-row');
    if (!row) return;
    const prediction = visiblePredictions[Number(row.dataset.prediction)];
    if (prediction) void selectPrediction(prediction);
  };

  input.addEventListener('input', onInputHandler);
  input.addEventListener('focus', onFocusHandler);
  input.addEventListener('blur', onBlurHandler);
  input.addEventListener('keydown', onKeyDown);
  dropdown.addEventListener('mousedown', preventRowBlur);
  dropdown.addEventListener('pointerdown', preventRowBlur);
  dropdown.addEventListener('click', onDropdownClick);

  return {
    cleanup: () => {
      clearTimeout(debounceTimer);
      clearTimeout(hideTimer);
      input.removeEventListener('input', onInputHandler);
      input.removeEventListener('focus', onFocusHandler);
      input.removeEventListener('blur', onBlurHandler);
      input.removeEventListener('keydown', onKeyDown);
      dropdown.removeEventListener('mousedown', preventRowBlur);
      dropdown.removeEventListener('pointerdown', preventRowBlur);
      dropdown.removeEventListener('click', onDropdownClick);
      visiblePredictions = [];
      dropdown.innerHTML = '';
      hide();
    },
  };
}

/**
 * Wire pickup + drop-off Places autocompletes. Resolves inputs inside the Maps
 * callback so re-renders cannot leave widgets bound to detached nodes.
 */
export function wireDeliveryPlacesInputs(
  pickupId,
  pickupDropdownId,
  destId,
  destDropdownId,
  {
    onPickupSelect,
    onDestSelect,
    onPickupInput,
    onDestInput,
    onPickupFocus,
    onDestFocus,
    regionCodes = ['ug'],
  } = {},
) {
  if (!pickupId || !pickupDropdownId || !destId || !destDropdownId) return;
  const gen = ++wireGeneration;
  loadGoogleMaps(() => {
    if (gen !== wireGeneration) return;
    prefetchPlacesLibrary();
    clearPlaceAutocompleteWidgets();

    const pickupInput = resolveDeliveryInput(pickupId);
    const pickupDropdown = document.getElementById(pickupDropdownId);
    const destInput = resolveDeliveryInput(destId);
    const destDropdown = document.getElementById(destDropdownId);
    if (!pickupInput || !pickupDropdown || !destInput || !destDropdown) return;

    const closePickupSiblings = () => animateDropdown(destDropdown, false);
    const closeDestSiblings = () => animateDropdown(pickupDropdown, false);

    const pickupWidget = attachPlaceAutocomplete(pickupInput, pickupDropdown, {
      onSelect: onPickupSelect,
      onInput: onPickupInput,
      onFocus: onPickupFocus,
      onActivate: closePickupSiblings,
      regionCodes,
    });
    if (gen !== wireGeneration) {
      pickupWidget.cleanup();
      return;
    }
    activeWidgets.push(pickupWidget);

    const destWidget = attachPlaceAutocomplete(destInput, destDropdown, {
      onSelect: onDestSelect,
      onInput: onDestInput,
      onFocus: onDestFocus,
      onActivate: closeDestSiblings,
      regionCodes,
    });
    if (gen !== wireGeneration) {
      destWidget.cleanup();
      return;
    }
    activeWidgets.push(destWidget);
  });
}

export function setDeliveryFieldValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value;
}
