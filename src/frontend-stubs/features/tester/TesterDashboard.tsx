/**
 * TesterDashboard — the live AgroGuard testing station. Puts the scanned
 * "Local Agency Sample" beside the "Factory Golden Reference" so the tester can
 * see the mismatch, then renders the verdict:
 *   - SUSPICIOUS_COUNTERFEIT -> red alert with the detected packaging flaws.
 *   - GENUINE_FACTORY        -> green authentic badge with the factory
 *     spray/dilution rules, playable aloud in the tester's language via
 *     lib/spoken-audio.ts.
 * UI text stays English; only the dosage playout localizes. This stub previews
 * both verdicts from SAMPLE data — wire to POST /api/v1/tester/inspect for real.
 */
import { useCallback, useRef, useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import type { AgencyInspectionResult, DiscrepancyReport } from '../../types';
import { LANGUAGE_LABELS, isFallbackLanguage, pickSpokenClip } from '../../lib/spoken-audio';

/** The authentic "Superstar" baseline, shown in the reference column. */
const GOLDEN_REFERENCE = {
  brand: 'Superstar',
  manufacturerName: 'FIL Industries',
  targetCrops: 'Apple',
  factoryBatchPrefix: 'FIL-SS-',
  factoryHologramPattern: 'FIL-HOLO-3D-STAR',
  goldenImageUrl: 'https://cdn.mock.local/agroguard/golden/superstar.png',
  dosageInstructions: 'Spray for leaf vigour and fruit finish/shininess, 1-1.5 ml/L of water.',
};

/** Two canned scan results so the station can preview each verdict. */
const SAMPLE_RESULTS: Record<'genuine' | 'counterfeit', AgencyInspectionResult> = {
  genuine: {
    inspectionId: 'demo-genuine',
    verdict: 'GENUINE_FACTORY',
    matchConfidence: 1,
    brand: 'Superstar',
    manufacturerName: 'FIL Industries',
    discrepancyReport: {
      logoMismatch: false,
      hologramMismatch: false,
      unlistedBatch: false,
      missingSeal: false,
      fontMismatches: [],
    },
    verifiedInstructions: {
      chemicalComposition: 'Gibberellic Acid (GA3) 1.8% + micronutrient blend',
      targetCrops: 'Apple',
      dosageInstructions: GOLDEN_REFERENCE.dosageInstructions,
      audioPrompts: {
        KASHMIRI: 'https://cdn.mock.local/tts/agroguard/kashmiri/superstar-k.mp3',
        URDU: 'https://cdn.mock.local/tts/agroguard/urdu/superstar-u.mp3',
        HINDI: 'https://cdn.mock.local/tts/agroguard/hindi/superstar-h.mp3',
        ENGLISH: 'https://cdn.mock.local/tts/agroguard/english/superstar-e.mp3',
      },
    },
  },
  counterfeit: {
    inspectionId: 'demo-fake',
    verdict: 'SUSPICIOUS_COUNTERFEIT',
    matchConfidence: 0.35,
    brand: 'Superstar',
    manufacturerName: 'FIL Industries',
    discrepancyReport: {
      logoMismatch: true,
      hologramMismatch: true,
      unlistedBatch: true,
      missingSeal: false,
      fontMismatches: ['brand kerning off', 'batch font weight'],
    },
    verifiedInstructions: {
      chemicalComposition: 'Gibberellic Acid (GA3) 1.8% + micronutrient blend',
      targetCrops: 'Apple',
      dosageInstructions: GOLDEN_REFERENCE.dosageInstructions,
      audioPrompts: {
        HINDI: 'https://cdn.mock.local/tts/agroguard/hindi/superstar-h.mp3',
        ENGLISH: 'https://cdn.mock.local/tts/agroguard/english/superstar-e.mp3',
      },
    },
  },
};

const SCANNED_SAMPLE = {
  genuine: { batchNo: 'FIL-SS-2024-0012', hologram: 'FIL-HOLO-3D-STAR', image: '🧴' },
  counterfeit: { batchNo: 'XYZ-999', hologram: 'BLURRY-STAR', image: '🧴' },
};

export function TesterDashboard() {
  const { user } = useAuth();
  const preferredLanguage = user?.preferredLanguage ?? 'KASHMIRI';
  const [mode, setMode] = useState<'genuine' | 'counterfeit'>('counterfeit');

  const result = SAMPLE_RESULTS[mode];
  const sample = SCANNED_SAMPLE[mode];
  const isCounterfeit = result.verdict === 'SUSPICIOUS_COUNTERFEIT';

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clip = pickSpokenClip(result.verifiedInstructions.audioPrompts, preferredLanguage);
  const usingFallback = isFallbackLanguage(clip, preferredLanguage);

  const playDosage = useCallback(() => {
    if (!clip) return;
    audioRef.current?.pause();
    const audio = new Audio(clip.url);
    audioRef.current = audio;
    void audio.play().catch(() => undefined);
  }, [clip]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Testing station</h1>
          <p className="text-sm text-slate-400">
            Scan a bottle, compare against the factory reference, get a verdict.
          </p>
        </div>
        {/* Demo toggle — replace with a live scan trigger in the real build. */}
        <div className="flex overflow-hidden rounded-lg border border-slate-700 text-sm">
          {(['counterfeit', 'genuine'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 font-medium ${
                mode === m ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {m === 'counterfeit' ? 'Fake sample' : 'Genuine sample'}
            </button>
          ))}
        </div>
      </div>

      {/* Side-by-side: local agency sample vs factory golden reference. */}
      <div className="grid gap-4 md:grid-cols-2">
        <SamplePanel
          title="Local Agency Sample"
          subtitle="Bottle scanned in the field"
          image={sample.image}
          rows={[
            { label: 'Brand', value: result.brand },
            { label: 'Batch no.', value: sample.batchNo },
            { label: 'Hologram', value: sample.hologram },
          ]}
          tone="sample"
        />
        <SamplePanel
          title="Factory Golden Reference"
          subtitle={`${GOLDEN_REFERENCE.manufacturerName} · verified baseline`}
          image="🏭"
          rows={[
            { label: 'Brand', value: GOLDEN_REFERENCE.brand },
            { label: 'Batch prefix', value: GOLDEN_REFERENCE.factoryBatchPrefix },
            { label: 'Hologram', value: GOLDEN_REFERENCE.factoryHologramPattern },
          ]}
          tone="reference"
        />
      </div>

      {/* Verdict */}
      {isCounterfeit ? (
        <CounterfeitAlert report={result.discrepancyReport} confidence={result.matchConfidence} />
      ) : (
        <AuthenticPanel
          confidence={result.matchConfidence}
          dosage={result.verifiedInstructions.dosageInstructions}
          onListen={playDosage}
          canListen={!!clip}
          fallbackLabel={usingFallback && clip ? LANGUAGE_LABELS[clip.language] : null}
        />
      )}
    </div>
  );
}

function SamplePanel({
  title,
  subtitle,
  image,
  rows,
  tone,
}: {
  title: string;
  subtitle: string;
  image: string;
  rows: { label: string; value: string }[];
  tone: 'sample' | 'reference';
}) {
  return (
    <section
      className={`rounded-xl border p-4 ${
        tone === 'reference'
          ? 'border-emerald-600/40 bg-emerald-500/5'
          : 'border-slate-700 bg-slate-800'
      }`}
    >
      <header className="mb-3">
        <h2 className="font-semibold text-white">{title}</h2>
        <p className="text-xs text-slate-400">{subtitle}</p>
      </header>
      <div className="mb-3 flex h-28 items-center justify-center rounded-lg bg-slate-900 text-5xl">
        <span aria-hidden>{image}</span>
      </div>
      <dl className="flex flex-col gap-1.5 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-3">
            <dt className="text-slate-400">{r.label}</dt>
            <dd className="font-mono text-slate-100">{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** English labels for each discrepancy flag. */
const DISCREPANCY_LABELS: Record<keyof Omit<DiscrepancyReport, 'fontMismatches'>, string> = {
  logoMismatch: 'Logo does not match factory artwork',
  hologramMismatch: 'Hologram pattern is wrong',
  unlistedBatch: 'Batch number is not a factory batch',
  missingSeal: 'Tamper/quality seal missing',
};

function CounterfeitAlert({
  report,
  confidence,
}: {
  report: DiscrepancyReport;
  confidence: number;
}) {
  const flags = (Object.keys(DISCREPANCY_LABELS) as (keyof typeof DISCREPANCY_LABELS)[]).filter(
    (k) => report[k],
  );

  return (
    <section className="rounded-xl border-2 border-red-500 bg-red-500/10 p-5">
      <div className="flex items-center gap-3">
        <span aria-hidden className="text-3xl">
          ⚠️
        </span>
        <div>
          <h2 className="text-lg font-bold text-red-300">Suspicious — likely counterfeit</h2>
          <p className="text-sm text-red-200/80">
            Match confidence {Math.round(confidence * 100)}% · do not recommend to farmers
          </p>
        </div>
      </div>
      <ul className="mt-4 flex flex-col gap-2 text-sm text-red-100">
        {flags.map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span aria-hidden>✗</span>
            {DISCREPANCY_LABELS[k]}
          </li>
        ))}
        {report.fontMismatches.map((f) => (
          <li key={f} className="flex items-center gap-2">
            <span aria-hidden>✗</span>
            Font anomaly: {f}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AuthenticPanel({
  confidence,
  dosage,
  onListen,
  canListen,
  fallbackLabel,
}: {
  confidence: number;
  dosage: string;
  onListen: () => void;
  canListen: boolean;
  fallbackLabel: string | null;
}) {
  return (
    <section className="rounded-xl border-2 border-emerald-500 bg-emerald-500/10 p-5">
      <div className="flex items-center gap-3">
        <span aria-hidden className="text-3xl">
          ✅
        </span>
        <div>
          <h2 className="text-lg font-bold text-emerald-300">Authentic factory product</h2>
          <p className="text-sm text-emerald-200/80">
            Match confidence {Math.round(confidence * 100)}%
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-slate-900 p-4">
        <div className="text-xs uppercase tracking-wide text-slate-400">
          Factory spray / dilution rule
        </div>
        <p className="mt-1 text-slate-100">{dosage}</p>

        <button
          type="button"
          onClick={onListen}
          disabled={!canListen}
          className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-40"
          aria-label={
            canListen
              ? `Listen to the spray instructions${fallbackLabel ? ` in ${fallbackLabel}` : ''}`
              : 'Spoken instructions not available yet'
          }
        >
          <span aria-hidden>🔊</span> Listen
          {fallbackLabel ? (
            <span className="text-xs font-medium opacity-85">(in {fallbackLabel})</span>
          ) : null}
        </button>
      </div>
    </section>
  );
}




