# Kashroot Frontend Architecture (reference stubs)

Role-adaptive client for the Kashroot agri-marketplace. The app serves **four
completely different shells** off a single authenticated identity, so each
persona gets a purpose-built experience rather than a one-size UI.

> These files are **reference scaffolding**, excluded from the NestJS backend
> `tsconfig` build (`src/frontend-stubs` is in `exclude`). They target a
> Next.js (App Router) + Tailwind + Shadcn web client, with React Native notes
> inline where the mobile mapping differs. Lift them into a dedicated frontend
> repo/workspace to run.

## Stack

| Concern      | Web (primary)                        | Mobile (farmer app)            |
| ------------ | ------------------------------------ | ------------------------------ |
| Framework    | Next.js 14 App Router (React)        | React Native / Expo            |
| Styling      | Tailwind CSS + **Shadcn UI**         | React Native Paper + tokens    |
| Icons        | lucide-react                         | @expo/vector-icons             |
| Design tokens| `theme/theme.ts` (single source)     | same file feeds Paper theme    |

**Why Tailwind + Shadcn:** Shadcn gives accessible, unstyled primitives
(Dialog, Table, Sheet, DropdownMenu) we own and skin with our tokens — perfect
for the data-dense buyer/admin consoles — while Tailwind keeps the farmer
surfaces fast to build with a huge, consistent type/spacing scale.

## Folder map

```
src/frontend-stubs/
  theme/
    theme.ts            # palette + tokens — the single source of truth
    tailwind.config.ts  # Tailwind theme wired to tokens (+ Shadcn aliases)
    globals.css         # CSS vars mirror + kr-pulse/kr-spin keyframes
  auth/
    AuthContext.tsx     # UserRole, AuthProvider, useAuth, personaForRole
  navigation/
    RoleLayoutRouter.tsx# reads role -> mounts the persona shell
    nav-config.ts       # per-persona nav manifests
  layouts/
    FarmerLayout.tsx    # mobile-first, bottom nav, floating Voice FAB
    BuyerLayout.tsx     # B2B console, left sidebar, data-dense
    ExpertLayout.tsx    # clean pro dashboard, saffron accent
    AdminLayout.tsx     # dark institutional back-office
    TesterLayout.tsx    # AgroGuard QC suite: camera HUD + audit toolbar
  features/
    farmer/FarmerHome.tsx        # mandi listic cards
    farmer/FarmingKnowledgeFeed.tsx # spoken agronomy advisories (listic cards)
    buyer/BuyerDashboard.tsx     # escrow tracking + market KPIs
    expert/ExpertHome.tsx        # KYC standing + appointments
    admin/KycModerationQueue.tsx # approve/reject pending expert KYC
    tester/TesterDashboard.tsx   # agency-sample vs golden-reference verdict
  VoiceAssistantButton.tsx   # (existing) the farmer's hero control
  MandiPriceCard.tsx         # picture-driven price card + "Listen" (spoken audio)
  EscrowPaymentModal.tsx     # payment drawer; auto-plays localized escrow audit
  LanguageSelector.tsx       # farmer-profile spoken-language toggle (4 languages)
  lib/
    spoken-audio.ts          # pickSpokenClip fallback chain (preferred→hi→en→any)
  api.ts / types.ts          # (existing) API client + backend contract mirrors
  AppShellExample.tsx        # how AuthProvider + RoleLayoutRouter compose
```

## Color palette

Defined once in `theme/theme.ts`, consumed by Tailwind and Paper.

| Token          | Hex       | Use                                            |
| -------------- | --------- | ---------------------------------------------- |
| `brand.500`    | `#1f7a3d` | **Kashroot Green** — primary actions, trust    |
| `saffron.400`  | `#e8a33d` | Kashmir saffron — secondary / expert premium   |
| `trend.up`     | `#1b8a3a` | Mandi price rose ▲ (high-contrast, + glyph)    |
| `trend.down`   | `#d32f2f` | Mandi price fell ▼ (high-contrast, + glyph)    |
| `trend.stable` | `#9e9e9e` | Unchanged —                                    |
| `buyer.500`    | `#0d47a1` | B2B console accent                             |
| `slate.900`    | `#0f172a` | Admin back-office chrome                       |
| `slate.50–200` | greys     | Neutral data tables (buyer + admin)            |

> Accessibility: mandi trend **never relies on colour alone** — the arrow glyph
> and an audio clip carry the same meaning for colour-blind and low-literacy
> farmers (see `MandiPriceCard.tsx`).

## Role-based routing

`RoleLayoutRouter` reads `UserRole` from `useAuth()` and, via `personaForRole`,
mounts one of four shells:

| Role(s)                                         | Persona | Shell          |
| ----------------------------------------------- | ------- | -------------- |
| `FARMER`                                        | farmer  | `FarmerLayout` |
| `BUYER`                                          | buyer   | `BuyerLayout`  |
| `EXPERT`                                         | expert  | `ExpertLayout` |
| `TESTER`                                         | tester  | `TesterLayout` |
| `PLATFORM_ADMIN` / `REGIONAL_ADMIN` / `SUPPORT_MODERATOR` | admin | `AdminLayout` |

In Next.js this lives in a `(protected)` group layout wrapping `{children}`;
route segments render inside the chosen shell's `<main>`. On React Native it
maps to a role-switched root navigator. See `AppShellExample.tsx`.

> ⚠️ **Backend gap:** the backend `UserRole` enum has no `EXPERT` member yet
> (experts are modelled via `ExpertProfile` + the expert-kyc module). Add
> `EXPERT` to the enum, or map the expert persona onto an existing role, before
> wiring real auth. Flagged in `auth/AuthContext.tsx`.

## Wired backend endpoints

- `FarmerHome` → `GET /api/v1/mandi-prices` (public listic feed)
- `VoiceAssistantButton` → `POST /api/v1/assistant/voice` (via `api.ts`)
- `KycModerationQueue` → `GET /api/v1/admin/experts/kyc/pending`,
  `PATCH /api/v1/admin/experts/kyc/:id/review`
- `BuyerDashboard` escrow rows → `GET /api/v1/escrow/:orderId` (placeholder data)
- `TesterDashboard` → `POST /api/v1/tester/inspect`, `GET /api/v1/tester/history`
  (AgroGuard counterfeit detection; TESTER role)
- `FarmingKnowledgeFeed` → `GET /api/v1/advisories` (public agronomy knowledge feed);
  authoring via `POST /api/v1/admin/advisories` (PLATFORM_ADMIN / REGIONAL_ADMIN / EXPERT)
  and `POST /api/v1/admin/advisories/seed`

## English UI + 4-Language Spoken Audio

The core farmer-UX contract. **Two layers are kept strictly separate:**

**1. Visual layer — always English.** Every screen, label, commodity name,
mandi board, and price stays in English (`Apple - Delicious`, `₹1,450 / box`,
`Sopore Fruit Mandi`). We do **NOT** machine-translate UI chrome — it keeps the
interface stable, avoids garbled RTL/script layout, and means one visual design
serves everyone.

**2. Spoken layer — four languages.** The farmer's `preferredLanguage`
(`KASHMIRI | URDU | HINDI | ENGLISH`, from `AuthUser`) drives every *audio*
surface. Non-readers operate the app by listening and speaking; sighted/literate
users still get the English text.

**Fallback chain (single source of truth: `lib/spoken-audio.ts`).** Clips may
not be synthesized in every language yet, so callers never index
`audioPrompts[lang]` directly — they call `pickSpokenClip(prompts, lang)`, which
resolves **preferred → Hindi → English → any available**, returning the URL and
the language actually used (so the UI can show a small "(in Hindi)" hint).
`isFallbackLanguage` and `LANGUAGE_LABELS` support that hint.

| Surface | Audio behaviour |
| ------- | --------------- |
| `MandiPriceCard` | Prominent **labelled** "🔊 Listen" button; on tap plays the price clip via the fallback chain. |
| `EscrowPaymentModal` | **Auto-plays** the localized spoken audit clip on open / whenever the escrow event changes; "Play again" repeats it. |
| `VoiceAssistantButton` | Push-to-talk; converses purely by voice, replying in the selected language (server-side TTS). |
| `LanguageSelector` | Farmer-profile toggle for the four spoken languages; each option shows English + native script. Updates `AuthContext.setPreferredLanguage`. |

> The escrow audit clips are produced by the backend
> `EscrowVoiceNotificationService`; surface its per-language TTS URLs on the
> `EscrowUpdate.audioPrompts` contract (`types.ts`) to wire the drawer for real.


