#!/usr/bin/env node
// App Store Connect helper for the TestFlight workflow (.github/workflows/testflight.yml).
// No dependencies. Authenticates with an App Store Connect API key (JWT, ES256).
//
// Signing model: every CI run creates its OWN short-lived Apple Distribution
// certificate from a key generated on the runner, builds and uploads, then
// revokes it. No signing key or certificate is stored anywhere (not in GitHub,
// not in chat). Builds already uploaded to TestFlight are unaffected by the
// revocation (Apple re-signs them).
//
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (path to the .p8 file)
//
//   node asc.mjs check <bundleId>                    verify key + app record exist
//   node asc.mjs bundle-id <bundleId>                print bundle-id resource id (register if missing)
//   node asc.mjs create-cert <csr.pem> <out.cer>     prints certificate id
//   node asc.mjs create-profile <name> <bundleResId> <certId> <out.mobileprovision>   prints profile id
//   node asc.mjs prune-profiles <namePrefix>         delete leftover CI profiles
//   node asc.mjs cleanup <certId|-> <profileId|->    revoke cert, delete profile
//   node asc.mjs pbx-manual <project.pbxproj> <configId> <teamId> <profileName>
import crypto from 'node:crypto'
import fs from 'node:fs'

const API = 'https://api.appstoreconnect.apple.com/v1'
const b64url = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

export function makeJwt({ keyId, issuerId, privateKeyPem, now = Math.floor(Date.now() / 1000) }) {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' }))
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKeyPem, dsaEncoding: 'ieee-p1363' })
  return `${header}.${payload}.${b64url(sig)}`
}

function token() {
  const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH } = process.env
  if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_PATH) die('ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH must be set.')
  return makeJwt({ keyId: ASC_KEY_ID, issuerId: ASC_ISSUER_ID, privateKeyPem: fs.readFileSync(ASC_KEY_PATH, 'utf8') })
}

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return null
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = (json.errors || []).map((e) => `${e.title}: ${e.detail}`).join('; ') || res.statusText
    const err = new Error(`App Store Connect ${method} ${path.split('?')[0]} → ${res.status}: ${detail}`)
    err.status = res.status
    throw err
  }
  return json
}

function die(msg) { console.error(`::error::${msg}`); process.exit(1) }

const [cmd, ...args] = process.argv.slice(2)
const commands = {
  async check(bundleId) {
    let apps
    try { apps = await api('GET', `/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=name,bundleId`) }
    catch (e) {
      if (e.status === 401) die('App Store Connect rejected the API key. Check the ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_P8 secrets.')
      if (e.status === 403) die('The API key does not have enough access. Create it with the Admin role.')
      throw e
    }
    if (!apps.data.length) die(`No app with bundle ID ${bundleId} in App Store Connect yet. Create it: App Store Connect → Apps → + → New App.`)
    console.log(`App Store Connect OK: "${apps.data[0].attributes.name}" (${bundleId})`)
  },

  async 'bundle-id'(identifier) {
    const found = await api('GET', `/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&limit=200`)
    const exact = found.data.find((b) => b.attributes.identifier === identifier)
    if (exact) return console.log(exact.id)
    const created = await api('POST', '/bundleIds', { data: { type: 'bundleIds', attributes: { identifier, name: 'OBEY TOOLS', platform: 'IOS' } } })
    console.log(created.data.id)
  },

  async 'create-cert'(csrPath, outPath) {
    const csrContent = fs.readFileSync(csrPath, 'utf8').replace(/-----[^-]+-----|\s/g, '')
    let res
    try {
      res = await api('POST', '/certificates', { data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent } } })
    } catch (e) {
      if (/maximum|limit/i.test(e.message)) die('Apple’s limit on distribution certificates was reached. In Certificates, Identifiers & Profiles → Certificates, revoke old "Apple Distribution" certificates you no longer use, then re-run.')
      throw e
    }
    fs.writeFileSync(outPath, Buffer.from(res.data.attributes.certificateContent, 'base64'))
    console.log(res.data.id)
  },

  async 'create-profile'(name, bundleResId, certId, outPath) {
    const res = await api('POST', '/profiles', {
      data: {
        type: 'profiles',
        attributes: { name, profileType: 'IOS_APP_STORE' },
        relationships: {
          bundleId: { data: { type: 'bundleIds', id: bundleResId } },
          certificates: { data: [{ type: 'certificates', id: certId }] },
        },
      },
    })
    fs.writeFileSync(outPath, Buffer.from(res.data.attributes.profileContent, 'base64'))
    console.log(res.data.id)
  },

  async 'prune-profiles'(prefix) {
    const res = await api('GET', `/profiles?filter[profileType]=IOS_APP_STORE&limit=200&fields[profiles]=name`)
    for (const p of res.data.filter((p) => p.attributes.name.startsWith(prefix))) {
      await api('DELETE', `/profiles/${p.id}`).catch((e) => console.warn(e.message))
      console.log(`removed leftover profile ${p.attributes.name}`)
    }
  },

  async cleanup(certId, profileId) {
    if (profileId && profileId !== '-') await api('DELETE', `/profiles/${profileId}`).then(() => console.log('profile deleted')).catch((e) => console.warn(e.message))
    if (certId && certId !== '-') await api('DELETE', `/certificates/${certId}`).then(() => console.log('temporary certificate revoked')).catch((e) => console.warn(e.message))
  },

  // Switch ONLY the app target's Release configuration to manual signing for CI.
  // (Command-line overrides would also hit the Swift package targets and fail.)
  async 'pbx-manual'(pbxPath, configId, teamId, profileName) {
    let s = fs.readFileSync(pbxPath, 'utf8')
    const start = s.indexOf(`${configId} /* Release */ = {`)
    if (start < 0) die(`Build configuration ${configId} not found in ${pbxPath}`)
    const end = s.indexOf('name = Release;', start)
    let block = s.slice(start, end)
    if (!block.includes('CODE_SIGN_STYLE = Automatic;')) die('Expected CODE_SIGN_STYLE = Automatic in the App Release configuration.')
    block = block.replace('CODE_SIGN_STYLE = Automatic;', [
      'CODE_SIGN_STYLE = Manual;',
      'CODE_SIGN_IDENTITY = "Apple Distribution";',
      '"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Distribution";',
      `DEVELOPMENT_TEAM = ${teamId};`,
      `PROVISIONING_PROFILE_SPECIFIER = "${profileName}";`,
    ].join('\n\t\t\t\t'))
    fs.writeFileSync(pbxPath, s.slice(0, start) + block + s.slice(end))
    console.log('App target Release configuration set to manual signing')
  },
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!commands[cmd]) die(`Unknown command "${cmd}". See header of ${process.argv[1]}.`)
  commands[cmd](...args).catch((e) => die(e.message))
}
