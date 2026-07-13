import { GOOGLE_MAPS_API_KEY } from './config.js';
import { logDebug } from './debug.js';
import { showToast } from './utils.js';

let gmapsLoaded = false;
let gmapsLoading = false;

/** @type {Array<{ cleanup: () => void }>} */
const activeWidgets = [];
let wireGeneration = 0;

export function loadGoogleMaps(cb) {
  if (gmapsLoaded && window.google?.maps) {
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

export function clearPlaceAutocompleteWidgets() {
  document.querySelectorAll('.pac-container').forEach((el) => el.remove());
  activeWidgets.forEach((widget) => widget.cleanup());
  activeWidgets.length = 0;
}

function resolveDeliveryField(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  if (el.tagName === 'INPUT' || el.tagName === 'GMP-PLACE-AUTOCOMPLETE') return el;
  return null;
}

function wireFieldEvents(el, { onInput, onFocus }) {
  const cleanups = [];
  if (onFocus) {
    const focusFn = () => onFocus();
    el.addEventListener('focusin', focusFn);
    cleanups.push(() => el.removeEventListener('focusin', focusFn));
  }
  if (onInput) {
    const inputFn = () => onInput(el.value || '');
    el.addEventListener('input', inputFn);
    cleanups.push(() => el.removeEventListener('input', inputFn));
  }
  return () => cleanups.forEach((fn) => fn());
}

async function attachPlaceAutocomplete(
  input,
  { onSelect, onInput, onFocus, regionCodes = ['ug'] },
) {
  const placeholder = input.placeholder;
  const value = input.value;
  const id = input.id;

  try {
    const { PlaceAutocompleteElement } = await google.maps.importLibrary('places');
    if (!PlaceAutocompleteElement) throw new Error('PlaceAutocompleteElement unavailable');

    const pac = new PlaceAutocompleteElement({ includedRegionCodes: regionCodes });
    pac.noInputIcon = true;
    pac.noClearButton = true;
    if (id) pac.id = id;
    pac.placeholder = placeholder;
    if (value) pac.value = value;
    pac.classList.add('client-input', 'delivery-place-autocomplete');

    const onSelectHandler = async (event) => {
      const placePrediction = event.placePrediction;
      if (!placePrediction) return;
      try {
        const place = placePrediction.toPlace();
        await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
        const loc = place.location;
        if (!loc) return;
        const label = place.formattedAddress || place.displayName || pac.value || '';
        pac.value = label;
        onSelect({
          lat: typeof loc.lat === 'function' ? loc.lat() : loc.lat,
          lng: typeof loc.lng === 'function' ? loc.lng() : loc.lng,
          label,
        });
      } catch (err) {
        logDebug(`Place select failed: ${err?.message || err}`);
      }
    };

    pac.addEventListener('gmp-select', onSelectHandler);
    input.replaceWith(pac);

    const cleanupFieldEvents = wireFieldEvents(pac, { onInput, onFocus });

    return {
      cleanup: () => {
        pac.removeEventListener('gmp-select', onSelectHandler);
        cleanupFieldEvents();
      },
    };
  } catch (err) {
    logDebug(`PlaceAutocompleteElement unavailable, using legacy Autocomplete: ${err?.message || err}`);
  }

  const liveInput = id ? resolveDeliveryField(id) : input;
  if (!liveInput || liveInput.tagName !== 'INPUT') return null;

  if (!window.google?.maps?.places?.Autocomplete) {
    logDebug('Places library not loaded — enable Places API (New) on your Google Cloud project.');
    return null;
  }

  const autocomplete = new google.maps.places.Autocomplete(liveInput, {
    fields: ['geometry', 'formatted_address', 'name'],
    componentRestrictions: { country: regionCodes[0] || 'ug' },
  });
  const listener = autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (!place?.geometry?.location) return;
    const label = place.formatted_address || place.name || liveInput.value;
    liveInput.value = label;
    onSelect({
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng(),
      label,
    });
  });
  const cleanupFieldEvents = wireFieldEvents(liveInput, { onInput, onFocus });

  return {
    cleanup: () => {
      google.maps.event.removeListener(listener);
      cleanupFieldEvents();
    },
  };
}

/**
 * Wire pickup + drop-off Places autocompletes. Resolves inputs inside the Maps
 * callback so re-renders cannot leave widgets bound to detached nodes.
 */
export function wireDeliveryPlacesInputs(
  pickupId,
  destId,
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
  if (!pickupId || !destId) return;
  const gen = ++wireGeneration;
  loadGoogleMaps(async () => {
    if (gen !== wireGeneration) return;
    clearPlaceAutocompleteWidgets();
    const pickupInput = resolveDeliveryField(pickupId);
    const destInput = resolveDeliveryField(destId);
    if (!pickupInput || !destInput) return;

    const pickupWidget = await attachPlaceAutocomplete(pickupInput, {
      onSelect: onPickupSelect,
      onInput: onPickupInput,
      onFocus: onPickupFocus,
      regionCodes,
    });
    if (gen !== wireGeneration) {
      pickupWidget?.cleanup();
      return;
    }
    if (pickupWidget) activeWidgets.push(pickupWidget);

    const destField = resolveDeliveryField(destId);
    if (!destField) return;
    const destWidget = await attachPlaceAutocomplete(destField, {
      onSelect: onDestSelect,
      onInput: onDestInput,
      onFocus: onDestFocus,
      regionCodes,
    });
    if (gen !== wireGeneration) {
      destWidget?.cleanup();
      return;
    }
    if (destWidget) activeWidgets.push(destWidget);
  });
}

export function setDeliveryFieldValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value;
}
