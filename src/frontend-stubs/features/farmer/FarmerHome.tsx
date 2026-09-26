/**
 * FarmerHome — the farmer's landing screen. Voice-first and picture-driven:
 *   - A short spoken greeting prompt.
 *   - A vertical stack of MandiPriceCard "listic" cards (huge price, colour
 *     arrow, speaker) for the farmer's region.
 * The floating VoiceAssistantButton lives in FarmerLayout, not here, so it
 * persists across every farmer screen.
 */
import { useEffect, useState } from 'react';

import { MandiPriceCard } from '../../MandiPriceCard';
import { useAuth } from '../../auth/AuthContext';
import { API_BASE_URL } from '../../api';
import type { MandiPrice, PreferredLanguage } from '../../types';

export function FarmerHome() {
  const { user } = useAuth();
  const language = user?.preferredLanguage ?? 'KASHMIRI';
  const [prices, setPrices] = useState<MandiPrice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    // GET /api/v1/mandi-prices — public listic feed. Falls back to a sample so
    // the screen is never blank in the reference build.
    fetch(`${API_BASE_URL}/mandi-prices`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: MandiPrice[]) => active && setPrices(data))
      .catch(() => active && setPrices(SAMPLE_PRICES))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-2xl font-bold text-brand-700">
        {greeting(language)} 👋
      </p>

      {/* Entry point to the Spoken Agronomy Knowledge Base. */}
      <a
        href="/farmer/knowledge"
        className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 hover:bg-brand-100"
      >
        <span aria-hidden className="text-2xl">
          🌱
        </span>
        <span className="flex flex-col">
          <span className="font-bold text-brand-700">Farming Knowledge</span>
          <span className="text-sm text-slate-600">
            Spray schedules, pest control &amp; orchard tips — listen in your language
          </span>
        </span>
      </a>

      <p className="text-lg text-slate-600">Today&apos;s mandi rates for your area:</p>

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          {prices.map((price) => (
            <MandiPriceCard key={price.id} price={price} preferredLanguage={language} />
          ))}
        </div>
      )}
    </div>
  );
}

function greeting(language: PreferredLanguage): string {
  switch (language) {
    case 'URDU':
      return 'Aadaab';
    case 'HINDI':
      return 'Namaste';
    case 'ENGLISH':
      return 'Welcome';
    default:
      return 'Aadaab'; // Kashmiri
  }
}

const SAMPLE_PRICES: MandiPrice[] = [
  {
    id: 'sample-1',
    mandiName: 'Sopore Fruit Mandi',
    commodity: 'Apple - Delicious',
    variety: 'Delicious',
    minPrice: '1100',
    maxPrice: '1800',
    modalPrice: '1450',
    unitOfSale: 'box',
    currency: 'INR',
    trendIndicator: 'UP',
    audioPrompts: { KASHMIRI: 'https://cdn.mock.local/mandi-audio/ks/sample-1.mp3' },
    recordedAt: new Date().toISOString(),
  },
  {
    id: 'sample-2',
    mandiName: 'Narwal Mandi',
    commodity: 'Walnut',
    variety: null,
    minPrice: '400',
    maxPrice: '750',
    modalPrice: '600',
    unitOfSale: 'kg',
    currency: 'INR',
    trendIndicator: 'DOWN',
    audioPrompts: null,
    recordedAt: new Date().toISOString(),
  },
];
