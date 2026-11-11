/**
 * Minimal google.maps for Playwright. Fixtures are injected as
 * window.__VENUS_PLACE_FIXTURES before this script runs.
 * Driving minutes are a mock-only stand-in (4 min per km), not a product rule.
 */
(function () {
  const fixtures = window.__VENUS_PLACE_FIXTURES || { origin: null, places: [] };
  const places = Array.isArray(fixtures.places) ? fixtures.places : [];
  const shop = fixtures.origin || { lat: 0.3397125, lng: 32.5703906 };

  function norm(value) {
    return String(value || '').trim().toLowerCase();
  }

  function haystack(place) {
    return [place.label, place.shortLabel, place.searchAs, ...(place.aliases || [])]
      .map(norm)
      .filter(Boolean);
  }

  function matches(place, query) {
    const q = norm(query);
    if (q.length < 2) return false;
    return haystack(place).some((text) => text.includes(q) || q.includes(text));
  }

  function near(a, b, eps) {
    if (!a || !b) return false;
    const limit = eps == null ? 0.0015 : eps;
    return Math.abs(Number(a.lat) - Number(b.lat)) < limit && Math.abs(Number(a.lng) - Number(b.lng)) < limit;
  }

  function kmBetween(a, b) {
    const R = 6371;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function latLng(loc) {
    if (!loc) return null;
    const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
    const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
    return { lat: Number(lat), lng: Number(lng) };
  }

  function asPlace(hit) {
    return {
      id: hit.id,
      displayName: hit.shortLabel || hit.label,
      formattedAddress: hit.label,
      location: {
        lat: () => hit.lat,
        lng: () => hit.lng,
      },
    };
  }

  function suggest(query) {
    return places.filter((place) => matches(place, query)).slice(0, 8);
  }

  function routeFor(origin, dest) {
    const o = latLng(origin) || shop;
    const d = latLng(dest);
    if (!d) return null;
    const hit = places.find((place) => near(place, d));
    const fromShop = near(o, shop, 0.002);
    const km = hit && fromShop ? Number(hit.approxKm) : Math.max(0.1, kmBetween(o, d) * 1.35);
    const seconds = Math.round(km * 4 * 60);
    return {
      status: 'OK',
      distance: { value: Math.round(km * 1000), text: `${km.toFixed(1)} km` },
      duration: { value: seconds, text: `${Math.round(seconds / 60)} mins` },
    };
  }

  function Place(opts) {
    this.id = opts && opts.id;
  }
  Place.prototype.fetchFields = function () {
    const hit = places.find((place) => place.id === this.id);
    if (!hit) return Promise.resolve();
    const shaped = asPlace(hit);
    this.displayName = shaped.displayName;
    this.formattedAddress = shaped.formattedAddress;
    this.location = shaped.location;
    return Promise.resolve();
  };
  Place.searchByText = function (req) {
    const hits = suggest(req && (req.textQuery || req.input || ''));
    return Promise.resolve({ places: hits.map(asPlace) });
  };
  Place.searchNearby = function () {
    return Promise.resolve({ places: places.slice(0, 5).map(asPlace) });
  };

  function Geocoder() {}
  Geocoder.prototype.geocode = function (req, cb) {
    const query = req && req.address;
    const loc = latLng(req && req.location);
    let hit = null;
    if (query) hit = suggest(query)[0] || null;
    else if (loc) hit = places.find((place) => near(place, loc, 0.01)) || null;
    if (!hit) {
      cb([], 'ZERO_RESULTS');
      return;
    }
    cb(
      [
        {
          formatted_address: hit.label,
          types: ['point_of_interest'],
          geometry: {
            location_type: 'ROOFTOP',
            location: { lat: () => hit.lat, lng: () => hit.lng },
          },
        },
      ],
      'OK',
    );
  };

  function DistanceMatrixService() {}
  DistanceMatrixService.prototype.getDistanceMatrix = function (req, cb) {
    const origins = (req && req.origins) || [];
    const dests = (req && req.destinations) || [];
    const rows = origins.map((origin) => ({
      elements: dests.map((dest) => routeFor(origin, dest) || { status: 'ZERO_RESULTS' }),
    }));
    cb({ rows }, 'OK');
  };

  window.google = window.google || {};
  window.google.maps = {
    importLibrary: function (name) {
      if (name === 'places') {
        return Promise.resolve({
          AutocompleteSessionToken: function AutocompleteSessionToken() {},
          AutocompleteSuggestion: {
            fetchAutocompleteSuggestions: function (req) {
              const hits = suggest(req && req.input);
              return Promise.resolve({
                suggestions: hits.map((hit) => ({
                  placePrediction: {
                    placeId: hit.id,
                    text: { text: hit.label },
                    mainText: { text: hit.shortLabel || hit.label },
                    secondaryText: { text: hit.label },
                  },
                })),
              });
            },
          },
          Place: Place,
        });
      }
      return Promise.resolve({});
    },
    TravelMode: { DRIVING: 'DRIVING', WALKING: 'WALKING' },
    DistanceMatrixService: DistanceMatrixService,
    Geocoder: Geocoder,
  };

  if (typeof window.__venusGmapsReady === 'function') window.__venusGmapsReady();
})();
