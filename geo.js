// geo.js — the one place that turns a location into a "place".
//
// A place is country-aware, so two cities with the same name never merge:
//   place_key    'US|Texas|Paris'   — stable grouping key (country|region|city)
//   place_label  'Paris, TX, US'    — what people see on the map
//   country_code 'US'  region 'Texas'  city 'Paris' (English names)
//
// Browser: <script src="/geo.js"></script> → window.obeyGeo
// Node:    require('./geo.js')          (used by scripts/backfill-places.mjs)
//
// Swapping geocoding providers later means changing this file only.
;(function (root) {
    const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse'

    // Countries where people expect a state/province abbreviation in a place name.
    const REGION_ABBREV_COUNTRIES = new Set(['US', 'CA', 'AU'])

    function first(obj, keys) {
        for (const k of keys) if (obj && obj[k]) return String(obj[k]).trim()
        return ''
    }

    function makePlace({ countryCode, region, regionCode, city, hood }) {
        const cc = (countryCode || '').toUpperCase()
        if (!cc && !city) return null
        const abbrev = REGION_ABBREV_COUNTRIES.has(cc) && /^[A-Z]{1,3}$/.test(regionCode || '') ? regionCode : ''
        return {
            country_code:  cc || null,
            region:        region || null,
            city:          city || null,
            location_text: [hood, city].filter(Boolean).join(', ') || region || null,
            place_key:     city ? [cc, region, city].join('|') : null,
            place_label:   city ? [city, abbrev, cc].filter(Boolean).join(', ') : null
        }
    }

    // Nominatim `address` object → place.
    function placeFromAddress(a) {
        if (!a) return null
        const iso = a['ISO3166-2-lvl4'] || a['ISO3166-2-lvl3'] || ''   // e.g. 'US-TX'
        return makePlace({
            countryCode: a.country_code,
            region:      first(a, ['state', 'province', 'region', 'state_district']),
            regionCode:  iso.split('-')[1] || '',
            city:        first(a, ['city', 'town', 'village', 'municipality', 'hamlet', 'county']),
            hood:        first(a, ['neighbourhood', 'suburb', 'quarter'])
        })
    }

    // Coordinates → place, names in English. Returns null on failure.
    // `headers` lets Node callers send the User-Agent Nominatim's policy requires.
    async function reverseGeocode(lat, lon, headers) {
        if (lat == null || lon == null) return null
        try {
            const url = NOMINATIM + '?format=jsonv2&addressdetails=1&zoom=18&accept-language=en' +
                        '&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon)
            const res = await fetch(url, headers ? { headers } : undefined)
            if (!res.ok) throw new Error('HTTP ' + res.status)
            const data = await res.json()
            return placeFromAddress(data && data.address)
        } catch (err) {
            console.error('[geo:reverseGeocode]', err)
            return null
        }
    }

    // Approximate place from the visitor's IP (no GPS). City-level at best,
    // so callers should not store its coordinates. Returns null on failure.
    async function placeFromIP() {
        try {
            const res = await fetch('https://ipapi.co/json/')
            const d = await res.json()
            if (!d || d.error) return null
            return makePlace({
                countryCode: d.country_code,
                region:      d.region,
                regionCode:  d.region_code,
                city:        d.city
            })
        } catch (err) {
            console.error('[geo:placeFromIP]', err)
            return null
        }
    }

    const api = { reverseGeocode, placeFromIP, placeFromAddress }
    if (typeof module !== 'undefined' && module.exports) module.exports = api
    else root.obeyGeo = api
})(typeof self !== 'undefined' ? self : this)
