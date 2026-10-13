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
    // In the app this runs on the server (geo_reverse in
    // supabase/geo-places/06_private_reads.sql), so the geocoder never sees a
    // user's phone. Direct lookups are for Node scripts, and for the app only
    // until that function exists. Only ~100 m precision is ever sent.
    // `headers` lets Node callers send the User-Agent Nominatim's policy requires.
    async function reverseGeocode(lat, lon, headers) {
        if (lat == null || lon == null) return null
        const sb = root && root.supabase
        if (sb && sb.rpc) {
            const { data, error } = await sb.rpc('geo_reverse', { lat: +lat, lon: +lon })
            if (!error) return data || null
            if (error.code !== 'PGRST202') {   // anything but "function not deployed yet"
                console.error('[geo:reverseGeocode]', error.message)
                return null
            }
        }
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

    // '🇰🇪 Kenya' — name in the viewer's language via Intl, flag from the code.
    const namers = {}
    function countryLabel(cc, lang) {
        if (!/^[A-Z]{2}$/.test(cc || '')) return cc || ''
        const flag = String.fromCodePoint(...[...cc].map(ch => 0x1F1A5 + ch.charCodeAt(0)))
        let name = cc
        try {
            lang = lang || 'en'
            namers[lang] = namers[lang] || new Intl.DisplayNames([lang, 'en'], { type: 'region' })
            name = namers[lang].of(cc) || cc
        } catch {}
        return flag + ' ' + name
    }

    // Time zones of the restricted countries, for an offline, request-free
    // guess at "is this phone in a high-risk country?" before any location
    // exists. Misses phones set to a home time zone (e.g. a visitor abroad).
    const RESTRICTED_TIME_ZONES = {
        'Asia/Pyongyang': 'KP', 'Africa/Mogadishu': 'SO', 'Asia/Aden': 'YE', 'Africa/Tripoli': 'LY',
        'Africa/Khartoum': 'SD', 'Africa/Asmara': 'ER', 'Africa/Lagos': 'NG', 'Asia/Karachi': 'PK',
        'Asia/Tehran': 'IR', 'Asia/Kabul': 'AF', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN',
        'Asia/Riyadh': 'SA', 'Asia/Yangon': 'MM', 'Asia/Rangoon': 'MM', 'Africa/Bamako': 'ML',
        'Asia/Shanghai': 'CN', 'Asia/Urumqi': 'CN', 'Asia/Chongqing': 'CN', 'Asia/Harbin': 'CN',
        'Indian/Maldives': 'MV', 'Asia/Baghdad': 'IQ', 'Asia/Damascus': 'SY', 'Africa/Algiers': 'DZ',
        'Africa/Ouagadougou': 'BF', 'Africa/Casablanca': 'MA', 'Africa/El_Aaiun': 'MA', 'Asia/Vientiane': 'LA',
        'Africa/Nouakchott': 'MR', 'Asia/Tashkent': 'UZ', 'Asia/Samarkand': 'UZ', 'Asia/Dhaka': 'BD',
        'Asia/Muscat': 'OM', 'Africa/Bangui': 'CF', 'America/Havana': 'CU', 'Africa/Niamey': 'NE',
        'Asia/Ashgabat': 'TM', 'America/Bogota': 'CO', 'Africa/Cairo': 'EG', 'Africa/Kinshasa': 'CD',
        'Africa/Lubumbashi': 'CD', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN',
        'America/Mexico_City': 'MX', 'America/Cancun': 'MX', 'America/Merida': 'MX', 'America/Monterrey': 'MX',
        'America/Matamoros': 'MX', 'America/Chihuahua': 'MX', 'America/Ciudad_Juarez': 'MX',
        'America/Ojinaga': 'MX', 'America/Mazatlan': 'MX', 'America/Bahia_Banderas': 'MX',
        'America/Hermosillo': 'MX', 'America/Tijuana': 'MX', 'Africa/Maputo': 'MZ', 'Africa/Douala': 'CM',
        'Asia/Dushanbe': 'TJ', 'Asia/Brunei': 'BN', 'Asia/Qatar': 'QA', 'Asia/Almaty': 'KZ',
        'Asia/Qostanay': 'KZ', 'Asia/Aqtobe': 'KZ', 'Asia/Aqtau': 'KZ', 'Asia/Atyrau': 'KZ', 'Asia/Oral': 'KZ',
        'Asia/Qyzylorda': 'KZ', 'Africa/Addis_Ababa': 'ET', 'Africa/Tunis': 'TN', 'Europe/Istanbul': 'TR',
        'Asia/Istanbul': 'TR', 'Asia/Thimphu': 'BT', 'Asia/Bishkek': 'KG', 'America/Managua': 'NI',
        'Asia/Amman': 'JO', 'Asia/Gaza': 'PS', 'Asia/Hebron': 'PS', 'Indian/Comoro': 'KM',
        'Asia/Kuala_Lumpur': 'MY', 'Asia/Kuching': 'MY', 'Asia/Kuwait': 'KW', 'Asia/Baku': 'AZ',
        'Africa/Ndjamena': 'TD', 'Asia/Dubai': 'AE', 'Asia/Bahrain': 'BH', 'Africa/Djibouti': 'DJ'
    }
    function inRestrictedTimeZone() {
        try {
            const cc = RESTRICTED_TIME_ZONES[Intl.DateTimeFormat().resolvedOptions().timeZone]
            return !!cc && isRestricted(cc)
        } catch { return false }
    }

    // Initials for share images: 'Maria Lopez' → 'M. L.'
    function initials(name) {
        return String(name || '').trim().split(/\s+/).filter(Boolean)
            .map(w => Array.from(w)[0].toUpperCase() + '.').join(' ')
    }

    const api = { reverseGeocode, placeFromAddress, coarsen, isRestricted, countryLabel,
                  inRestrictedTimeZone, initials }
    if (typeof module !== 'undefined' && module.exports) module.exports = api
    else root.obeyGeo = api
})(typeof self !== 'undefined' ? self : this)
