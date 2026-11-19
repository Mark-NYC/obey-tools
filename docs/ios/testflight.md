# TestFlight: from GitHub to your iPhone (no Mac)

**How it works.** `.github/workflows/testflight.yml` builds a signed Release on
GitHub's macOS runner and uploads it to TestFlight. Apple's Xcode Cloud isn't
used because its first-time setup has to be done in Xcode on a Mac.

**Signing.** The only credential is an **App Store Connect API key**, stored in
GitHub's encrypted secrets. Each run makes a temporary signing certificate on the
build machine, uses it, and revokes it. You never handle certificates, `.p12`
files or provisioning profiles.

**Safety.** Builds are uploaded as **TestFlight internal testing only**, so they
can't be sent to App Review or released. The workflow doesn't touch the
website, Supabase or anyone's data.

**Versioning.** The version comes from `app/package.json` (1.0.0). The build
number is the workflow's run number, so it goes up on every upload. After setup,
every push to the iOS branch that changes the app uploads a new build
automatically. You can also run it by hand: Actions → TestFlight → Run workflow.

---

## One-time setup (about 15 minutes, any browser)

### 1. Register the bundle ID and create the app record

1. Go to **developer.apple.com/account** → **Certificates, IDs & Profiles** → **Identifiers** → **+**
2. **App IDs** → Continue → **App** → Continue
3. Description `OBEY TOOLS`. Bundle ID **Explicit**: `tools.obey.app`. Leave all capabilities unticked. Continue → **Register**.
4. Go to **appstoreconnect.apple.com** → **Apps** → **+** → **New App**:
   - Platforms: **iOS**
   - Name: `OBEY.TOOLS` (if taken, try `OBEY.TOOLS Disciple Tools`; the name can change later)
   - Primary language: English (U.S.)
   - Bundle ID: **tools.obey.app**
   - SKU: `obey-tools-ios`
   - User access: Full Access
   - **Create**

### 2. Create the API key

1. App Store Connect → **Users and Access** → **Integrations** tab → **App Store Connect API** → **Team Keys**
   (first time only: click **Request Access** and accept the terms)
2. **+** (Generate API Key). Name `GitHub TestFlight`, Access **Admin** → **Generate**.
   Admin is needed so the workflow can create and revoke its temporary certificate.
3. Copy the **Issuer ID** (above the list) and the key's **Key ID**.
4. **Download API Key** gives you `AuthKey_XXXXXXXXXX.p8`. Apple only lets you download it **once**. Don't paste it into chat or email.

### 3. Store it in GitHub (encrypted)

github.com/Mark-NYC/obey-tools → **Settings** → **Secrets and variables** →
**Actions** → **New repository secret**. Add four secrets:

| Name | Value |
|---|---|
| `ASC_KEY_ID` | Key ID from step 2 |
| `ASC_ISSUER_ID` | Issuer ID from step 2 |
| `ASC_KEY_P8` | Open the `.p8` file in a text editor and paste **everything**, including the `BEGIN`/`END` lines |
| `APPLE_TEAM_ID` | developer.apple.com/account → **Membership details** → Team ID (10 characters) |

Then delete the `.p8` file from your Downloads folder. To revoke it later:
App Store Connect → Integrations → Revoke.

### 4. Build

GitHub → **Actions** → **TestFlight** → **Run workflow** → branch
`claude/keen-heisenberg-czraan` → **Run workflow**. It takes about 20 minutes. The run
summary says "Uploaded to TestFlight". Apple then processes the build (5–30
minutes) and emails you.

### 5. Install on your iPhone

1. App Store Connect → your app → **TestFlight** → **Internal Testing** → **+**,
   create a group called `Me`, add yourself, and turn on automatic distribution.
2. On the iPhone, install **TestFlight** from the App Store and sign in with the
   same Apple ID. OBEY.TOOLS appears → **Install**.

Later builds arrive in TestFlight automatically. Internal TestFlight builds
expire after 90 days.

## If the run fails

| Message | Fix |
|---|---|
| "TestFlight upload skipped. Missing GitHub secrets" | Add the secrets from step 3 |
| "rejected the API key" | Re-check the three key secrets. `ASC_KEY_P8` must include the BEGIN/END lines. |
| "does not have enough access" | Create the key with the **Admin** role |
| "No app with bundle ID tools.obey.app" | Do step 1 |
| "limit on distribution certificates" | developer.apple.com → Certificates: revoke unused "Apple Distribution" certificates |
| Upload rejected for the build number | Re-run. Each run gets a higher number. |

The failing run's logs are attached as the `testflight-logs` artifact.
