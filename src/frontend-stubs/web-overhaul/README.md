# Kashroot web overhaul — bright glass UI, role logins, smart KYC

Drop-in files for the **kashroot-web** Next.js app. This folder mirrors the web
repo's root — `src/` for code, `public/` for the hero photographs — so copying is
one command:

```bash
# from the kashroot-web repo root
cp -R ../kashroot-api/src/frontend-stubs/web-overhaul/{src,public} .
```

File paths below are relative to `src/` unless they start with `public/`.

Like the other frontend stubs, these files are excluded from the API build
(`src/frontend-stubs` is in the API's tsconfig `exclude`).

## Requirements

| Needs | Notes |
| --- | --- |
| Next.js 14+ (App Router) with a `src/` folder | `@/*` must resolve to `src/*` (the create-next-app default) |
| React 18 or 19 | no `ref`-as-prop or other React 19-only APIs used |
| Tailwind CSS 3.4+ or 4.x, default colour palette | v3: `content` must include `./src/**/*.{ts,tsx}` (the theme classes live in `src/lib`) |
| `public/seasons/*.jpg` (included) | the five hero photographs |
| **No new npm packages** | icons are inline SVG (`components/ui/icons.tsx`) |

Environment variables (both optional):

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3001/api/v1` | where the role logins send `POST /auth/login` |
| `NEXT_PUBLIC_IFSC_MOCK` | unset | `true` answers IFSC lookups from a local bank-code table (offline/demo) |

## File map

| File | Task | What it is |
| --- | --- | --- |
| `components/layout/HeroShowcase.tsx` | 1 | Full-screen photo crossfade (7s) + small season badge, bottom-right |
| `app/page.tsx` | 1 | Landing page: headline + exactly three portal cards over the slideshow |
| `lib/seasons.ts` | 1 | The slides: photo, season, crop focus; `seasonForDate()` (IST) picks the opening slide |
| `public/seasons/*.jpg` | 1 | spring-meadow, summer-lake, autumn-garden, winter-road, winter-lake |
| `lib/portals.ts` | 2 | The three portals: routes, copy, icons and bright palettes (`GLASS` surfaces) |
| `components/layout/PortalShell.tsx` | 2 | Bright themed frame + light `PortalHeader` for inner portals |
| `components/price-comparison/PriceComparisonHeader.tsx` | 2 | **The header contrast fix** |
| `app/escrow/layout.tsx`, `app/mandi/layout.tsx`, `app/price-comparison/layout.tsx` | 2 | Apply each portal theme to every page under its route |
| `components/auth/FarmerLogin.tsx`, `BuyerLogin.tsx`, `SellerLogin.tsx` | 3 | The three role logins — each owns its copy and palette |
| `components/auth/RoleLoginForm.tsx` | 3 | Shared form engine: layout, `POST /auth/login`, MFA, role check, redirect |
| `app/login/[role]/page.tsx` | 3 | Routes `/login/farmer`, `/login/buyer`, `/login/seller` (anything else 404s) |
| `lib/auth/roles.ts` | 3 | Role ↔ backend-role mapping, `loginHref()`, open-redirect-safe `safeNextPath()` |
| `lib/auth/login-client.ts` | 3 | Login API client; phone normalisation to `+91…`; in-memory session |
| `components/auth/KYCPanel.tsx` | 4 | Three-step glass KYC modal |
| `lib/kyc/validators.ts` | 4 | Aadhaar (Verhoeff checksum), PAN, IFSC and account-number masks/validators |
| `lib/kyc/kyc-service.ts` | 4 | IFSC lookup + **simulated** Aadhaar OTP / DigiLocker — the one swap point |
| `app/api/ifsc/route.ts` | 4 | `GET /api/ifsc?code=…` — server proxy to the Razorpay IFSC directory, cached 1 day |
| `components/ui/icons.tsx` | — | Dependency-free stroke icons |

## Task 1 — Seasonal hero

- Photos crossfade every 7s; the incoming slide fades in **over** the outgoing one,
  so there is no see-through dip mid-fade. A slow zoom runs only under
  `motion-safe`.
- The badge shows only the season, in small lowercase letters ("spring",
  "winter") — no place names; the photographs speak for themselves. It also has
  slide dots with a progress fill and a pause button (auto-moving content over 5s
  must be pausable — WCAG 2.2.2). Rotation also stops while the tab is hidden.
- The page opens on the **current** season's first photo (`seasonForDate`, read in
  IST) and re-renders hourly (`revalidate = 3600`).
- Add, remove or reorder photos in `SEASON_SLIDES` (`lib/seasons.ts`); a season
  can have several. Each slide's `focus` (CSS `object-position`) picks the part of
  the photo kept when the screen crops it — portrait photos on a wide monitor
  keep only a horizontal band, so spring and winter-road are focused on their peaks.
- The supplied photos are 720–1280px wide. On large monitors they are upscaled
  and look soft; replacing them with ≥1920px-wide landscape versions (same file
  names) makes the hero crisp with no code change.

## Task 2 — Bright portals and the Price Comparison header fix

The three route layouts wrap every Escrow, Mandi and Price Comparison page in
`PortalShell`: Emerald Trust (teal/emerald), Saffron Gold (amber/orange) and
Lake Azure (sky/indigo). Your existing pages still carry their own dark
wrappers, so strip those as you go:

| Replace (dark) | With (bright glass) |
| --- | --- |
| `bg-black`, `bg-slate-900/950`, `bg-gray-900`, `bg-neutral-950` page wrappers | remove — the shell supplies the canvas |
| dark cards (`bg-slate-800`, `bg-white/5`, `bg-gray-900/50` …) | `GLASS.card` from `lib/portals.ts` |
| `text-white` headings | `text-slate-900` |
| `text-gray-300/400`, `text-slate-400` body text | `text-slate-600` |
| `border-white/10`, `border-slate-700` | `ring-1 ring-slate-900/5` or `border-slate-200` |

### CRITICAL FIX — Price Comparison header

The dark-blue header made "List your products" invisible. Replace it with
`<PriceComparisonHeader />` (the price-comparison layout already renders it, so
delete the old header from the page itself). The exact classes:

```tsx
// header surface: soft light premium gradient
<header className="sticky top-0 z-30 backdrop-blur-xl bg-gradient-to-r from-sky-50/90 via-white/80 to-amber-50/90 border-b border-sky-100">
  <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Price Comparison Engine</h1>   {/* ≈17:1 */}
  <p className="text-sm text-slate-600">…</p>                                                           {/* ≈7:1  */}
  <Link className="rounded-xl px-5 py-2.5 text-sm font-semibold bg-sky-700 text-white hover:bg-sky-800">
    List your products                                                                                  {/* ≈5.9:1, AA */}
  </Link>
</header>
```

Set `listProductsHref` to your existing listing route (default
`/price-comparison/list`).

## Task 3 — Dedicated role logins

`/login/farmer`, `/login/buyer` and `/login/seller` replace the shared "Welcome
Back" page. Each has its own story and palette:

| Component | Headline | Palette | Identifier |
| --- | --- | --- | --- |
| `<FarmerLogin />` | Manage your orchards | orchard green | mobile-first |
| `<BuyerLogin />` | Source authentic produce | lake azure | work email |
| `<SellerLogin />` | Grow your agri-business | saffron gold | business email |

### Routing the portal buttons

Every CTA is built with `loginHref(role, next)`, which yields
`/login/<role>?next=<portal>`; after sign-in the user lands exactly where they
clicked:

| Card | Primary CTA | Secondary CTA |
| --- | --- | --- |
| Escrow Protected Trade | Buy with escrow → `/login/buyer?next=/escrow` | Sell with escrow → `/login/seller?next=/escrow` |
| Live Mandi Rates | Open farmer portal → `/login/farmer?next=/mandi` | Preview today's rates → `/mandi` (public board) |
| Price Comparison Engine | Compare prices → `/login/buyer?next=/price-comparison` | List your products → `/login/seller?next=/price-comparison` |

To use it anywhere else: `<Link href={loginHref('farmer', '/mandi')}>`.

Retire the generic page so old links still work — e.g. replace its `page.tsx`
with `redirect('/')` (from `next/navigation`) so users pick a portal.

### How sign-in works

- `POST /auth/login` is role-agnostic, so after sign-in the returned `roles` are
  checked against the portal (`ACCEPTED_BACKEND_ROLES`). A buyer who signs in
  through the farmer page is told so and offered the buyer portal instead of
  landing in the wrong dashboard.
- `MFA_REQUIRED` reveals an authenticator-code field and retries with `totpCode`.
- `next` is validated with the browser's own URL parser: `//evil.com`,
  `/\evil.com` and `/<TAB>/evil.com` all fall back to the portal home.
- The access token is kept **in memory** (`getSession()`); the API's httpOnly
  refresh cookie restores it after a reload. If the app has an `AuthContext`,
  hand the session to its `signIn` in `RoleLoginForm`'s success branch.
- `AUTH_ROUTES` in `lib/auth/roles.ts` holds the register / forgot-password paths.

## Task 4 — Smart KYC panel

```tsx
'use client';
import { useState } from 'react';
import { KYCPanel, type KycSubmission } from '@/components/auth/KYCPanel';

export function VerifyAccountButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Complete KYC</button>
      <KYCPanel
        open={open}
        onClose={() => setOpen(false)}
        onComplete={async (submission: KycSubmission) => {
          // POST it to your API; throw to keep the panel open with the message.
        }}
      />
    </>
  );
}
```

1. **Role** — Farmer / Buyer / Seller cards (a real radio group).
2. **Identity** — "Verify instantly with DigiLocker", or Aadhaar → **Get OTP** →
   the 6-digit OTP field appears (auto-verifies on the 6th digit; paste and SMS
   autofill work; 30s resend timer). Aadhaar is masked `XXXX XXXX XXXX`, never
   starts with 0/1, and is checked with the Verhoeff checksum before any request,
   which catches every single-digit typo and adjacent swap. PAN is masked
   `ABCDE1234F`, upper-cased, and its 4th letter (holder type) validated —
   "Individual PAN" confirms it.
3. **Bank** — the IFSC `onChange` handler masks the code (a typed letter O in the
   5th slot becomes zero) and, the moment it is complete, looks it up and shows
   **Bank Name** and **Branch** under the field. Any edit cancels the request in
   flight. The account number is entered twice and a mismatch is flagged at the
   first wrong digit. Copy adapts: payouts for farmers/sellers, refunds for buyers.

**Privacy:** the submission carries the verifier's `referenceId` and the Aadhaar
**last four digits only** — the full number never leaves the component.

### What is simulated

| Piece | Status | To make it real |
| --- | --- | --- |
| IFSC lookup | **Real** via `/api/ifsc` → `ifsc.razorpay.com` | nothing (set `NEXT_PUBLIC_IFSC_MOCK=true` offline) |
| Aadhaar OTP | Simulated: any 6 digits pass, `000000` fails | replace `requestAadhaarOtp` / `verifyAadhaarOtp` in `kyc-service.ts` with calls to API routes backed by a UIDAI-licensed KUA |
| DigiLocker | Simulated consent | replace `verifyWithDigiLocker` with a redirect to a DigiLocker partner (API Setu) flow |

## Backend gaps (kashroot-api)

- **No `SELLER` role.** `UserRole` has FARMER and BUYER, not SELLER, and only
  those two may self-register. Until a seller role exists, the seller portal
  admits farmer accounts (`ACCEPTED_BACKEND_ROLES.seller`) and shows no sign-up
  link.
- **No KYC verification endpoints.** Farmers have `KycDocument` uploads only;
  there is nothing to send Aadhaar OTP, DigiLocker or bank details to yet.
  `onComplete` is where that call goes.

## Verified

Built in a scratch Next.js 16.4 + Tailwind 4.3 + React 19 app (strict
TypeScript): `next build` and ESLint (`eslint-config-next` core-web-vitals,
including the React Compiler hook rules) clean. Every class was also generated
by Tailwind 3.4. Unit tests covered the validators (500 random Verhoeff
typo/swap cases), `safeNextPath` and phone normalisation. A Playwright run drove
the slideshow (7s advance, pause, season jump, mobile scrolling), all KYC paths
(checksum error, wrong OTP, DigiLocker, PAN holder type, IFSC lookup and
not-found, account mismatch, submission payload) and the logins (wrong portal,
MFA, `next` redirect, open-redirect attempt, bad credentials, API down) against
a stubbed API. The live Razorpay call itself could not be exercised from the
build sandbox; its proxy's error paths (400, 502) were.
