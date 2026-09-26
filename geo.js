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
// Privacy: coordinates are coarsened before they are stored or shared —
// ~1 km everywhere, ~11 km and city-only names where following Jesus is
// dangerous. supabase/geo-places/02_privacy.sql enforces the same rules in the
// database; keep RESTRICTED in sync with geo_is_restricted() there.
//
// Swapping geocoding providers later means changing this file only.
;(function (root) {
    const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse'

    // Open Doors World Watch List top 50 plus other high-risk countries.
    // Review yearly. ISO 3166-1 alpha-2.
    const RESTRICTED = new Set([
        'KP', 'SO', 'YE', 'LY', 'SD', 'ER', 'NG', 'PK', 'IR', 'AF', 'IN', 'SA', 'MM',
        'ML', 'CN', 'MV', 'IQ', 'SY', 'DZ', 'BF', 'MA', 'LA', 'MR', 'UZ', 'BD', 'OM',
        'CF', 'CU', 'NE', 'TM', 'CO', 'EG', 'CD', 'VN', 'MX', 'MZ', 'CM', 'TJ', 'BN',
        'QA', 'KZ', 'ET', 'TN', 'TR', 'BT', 'KG', 'NI', 'JO', 'PS', 'KM', 'MY', 'KW',
        'AZ', 'TD', 'AE', 'BH', 'DJ'
    ])
    function isRestricted(countryCode) {
        return RESTRICTED.has(String(countryCode || '').toUpperCase())
    }

    // Coordinates as stored and shared: 2 decimals (~1 km), or 1 decimal
    // (~11 km) in restricted countries — and when the country is unknown,
    // so a failed lookup fails safe.
    function coarsen(lat, lon, countryCode) {
        if (lat == null || lon == null) return { lat: null, lon: null }
        const f = (!countryCode || isRestricted(countryCode)) ? 10 : 100
        return { lat: Math.round(lat * f) / f, lon: Math.round(lon * f) / f }
    }

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
            // No neighbourhood names in restricted countries.
            location_text: [isRestricted(cc) ? '' : hood, city].filter(Boolean).join(', ') || region || null,
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
    // Only ~100 m precision is sent to the geocoder — enough to get the city right.
    // `headers` lets Node callers send the User-Agent Nominatim's policy requires.
    async function reverseGeocode(lat, lon, headers) {
        if (lat == null || lon == null) return null
        try {
            const url = NOMINATIM + '?format=jsonv2&addressdetails=1&zoom=18&accept-language=en' +
                        '&lat=' + (+lat).toFixed(3) + '&lon=' + (+lon).toFixed(3)
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

    const api = { reverseGeocode, placeFromIP, placeFromAddress, coarsen, isRestricted }
    if (typeof module !== 'undefined' && module.exports) module.exports = api
    else root.obeyGeo = api
})(typeof self !== 'undefined' ? self : this)
