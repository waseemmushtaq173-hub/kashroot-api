'use client';

/**
 * The security gate: the "I am human" check runs FIRST, and the form inside
 * shows only once it has passed (lib/server/gate). Cloudflare's box is shown
 * (appearance "always"): people see it go "Verifying…" → "Success!", or ask
 * for a tap when Cloudflare is unsure. With the Super Admin's switch "Ask
 * everyone to tap the box" on (20261114000000_gate_tap.sql), everyone also
 * presses "Tap to confirm you're human" before the token is sent. The gate's token goes to KashRoot's server
 * (/api/gate), which checks it with Cloudflare and gives this browser the
 * kr_gate cookie for 30 minutes — the Supabase proxy refuses sign-in,
 * sign-up, reset and code emails without it. The form then gets its OWN
 * fresh token for Supabase in the background: `onPass` is where it starts.
 *
 * Fast and never stuck: Cloudflare's box starts as the page opens, alongside
 * the "already passed?" question, and the token is sent the moment Cloudflare
 * says "Success!" (useHumanCheck's onToken) — nothing waits on a timer that
 * may have given up. While Cloudflare waits for a tap, only its own line
 * shows ("One quick check…"): no error, no Retry, nothing timed out. KashRoot's
 * answer is awaited at most 8 s; a refusal shows "Security check failed:
 * <reason>" with Retry, and so does 8 s with no answer at all. Already passed
 * in this browser (cookie still valid) or the check is off: the form shows at
 * once. When it passes, the first field gets the focus, and the console says
 * how long the gate took (never the token).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { preconnect } from 'react-dom';
import { ArrowRight, Hand, Loader2, RotateCcw, ShieldCheck } from 'lucide-react';

import { isBrave, noteRetry, retriesSoFar, useHumanCheck, type HumanCheck } from '@/components/security/HumanCheck';
import { rememberedLang } from '@/lib/langDetect';

/** "Checking you're human…" in the person's language (Kashmiri readers get the Urdu wording). */
const TEXT = {
  en: { title: 'Checking you’re human…', why: 'One moment — this keeps bots and fake accounts out of KashRoot.', tap: 'Tap to confirm you’re human', slow: 'This is taking longer than usual.', dir: undefined },
  hi: { title: 'जाँच हो रही है कि आप इंसान हैं…', why: 'बस एक पल — इससे बॉट और नकली खाते KashRoot से दूर रहते हैं।', tap: 'पुष्टि करने के लिए टैप करें कि आप इंसान हैं', slow: 'इसमें सामान्य से अधिक समय लग रहा है।', dir: undefined },
  ur: { title: 'تصدیق ہو رہی ہے کہ آپ انسان ہیں…', why: 'بس ایک لمحہ — اس سے بوٹ اور جعلی اکاؤنٹ KashRoot سے دور رہتے ہیں۔', tap: 'تصدیق کے لیے ٹیپ کریں کہ آپ انسان ہیں', slow: 'اس میں معمول سے زیادہ وقت لگ رہا ہے۔', dir: 'rtl' as const },
};

/** KashRoot's answer to a token: at most this long. */
const ANSWER_MS = 8_000;
/** No token and no tap asked for after this long: offer Retry. */
const STALL_MS = 8_000;

type State = 'asking' | 'gate' | 'sending' | 'passed';

export function SecurityGate({ place, onPass, children }: { place: string; onPass?: () => void; children: ReactNode }) {
  preconnect('https://challenges.cloudflare.com');
  const [state, setState] = useState<State>('asking');
  const [error, setError] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const [round, setRound] = useState(0);
  const [awaitingTap, setAwaitingTap] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const passedOnce = useRef(false);
  // Read inside callbacks (never while rendering).
  const now = useRef<State>('asking');
  const pending = useRef<string | null>(null);
  const hold = useRef(false); // after a refusal: wait for Retry rather than resend on its own
  const tapNeeded = useRef(false);
  const confirmed = useRef(false);
  const human = useRef<HumanCheck | null>(null);
  const opened = useRef(0);
  const tokenAt = useRef(0);
  const [lang] = useState<'en' | 'hi' | 'ur'>(() => {
    const l = rememberedLang();
    return l === 'hi' ? 'hi' : l === 'ur' || l === 'ks' ? 'ur' : 'en';
  });
  const t = TEXT[lang];

  const go = useCallback((s: State) => {
    now.current = s;
    setState(s);
  }, []);

  const send = useCallback(
    async (tok: string) => {
      go('sending');
      setError(null);
      setStalled(false);
      const sent = performance.now();
      try {
        const res = await fetch('/api/gate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: tok, place, tapped: human.current?.wasTapped() ?? false, confirmed: tapNeeded.current, brave: isBrave(), retries: retriesSoFar() }),
          signal: AbortSignal.timeout(ANSWER_MS),
        });
        human.current?.used();
        if (res.ok) {
          const s = (ms: number) => (ms / 1000).toFixed(1);
          console.info(`[KashRoot] security gate passed: form open ${s(performance.now() - opened.current)} s after the page (Cloudflare ${s(tokenAt.current - opened.current)} s, KashRoot's check ${s(performance.now() - sent)} s).`);
          return go('passed');
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        hold.current = true;
        setError(body.error ?? `Security check failed: KashRoot answered ${res.status}. Tap Retry.`);
      } catch (e) {
        human.current?.used();
        hold.current = true;
        setError(e instanceof DOMException && e.name === 'TimeoutError' ? 'Security check failed: KashRoot’s server did not answer within 8 seconds. Tap Retry.' : 'Security check failed: no connection to KashRoot. Check your internet, then tap Retry.');
      }
      go('gate');
    },
    [go, place],
  );

  /** Send the token we hold, when the gate is open for it (and, with the switch on, after the person's own tap). */
  const trySend = useCallback(() => {
    if (now.current !== 'gate' || !pending.current || hold.current) return;
    if (tapNeeded.current && !confirmed.current) return setAwaitingTap(true);
    const tok = pending.current;
    pending.current = null;
    void send(tok);
  }, [send]);

  const onToken = useCallback(
    (tok: string) => {
      pending.current = tok;
      tokenAt.current = performance.now();
      setStalled(false);
      trySend();
    },
    [trySend],
  );
  const check = useHumanCheck(`gate-${place}`, { visible: true, onToken });
  useEffect(() => {
    human.current = check;
  });

  // Already passed in this browser in the last 30 minutes, or the check is off: straight to the form.
  // (Cloudflare's box is already working meanwhile.)
  useEffect(() => {
    opened.current = performance.now();
    let live = true;
    void fetch('/api/gate', { cache: 'no-store', signal: AbortSignal.timeout(5_000) })
      .then((r) => r.json())
      .then((g: { on?: boolean; passed?: boolean; tap?: boolean }) => {
        if (!live) return;
        tapNeeded.current = Boolean(g.tap);
        go(g.passed || g.on === false ? 'passed' : 'gate');
        trySend();
      })
      .catch(() => {
        if (!live) return;
        go('gate');
        trySend();
      });
    return () => {
      live = false;
    };
  }, [go, trySend]);

  // No token and no tap asked for after 8 s: offer Retry (never a spinner for ever). Not while Cloudflare waits for a tap.
  const waitingForTap = check.status === 'interactive';
  useEffect(() => {
    if (state !== 'gate' || waitingForTap || error) return;
    const timer = window.setTimeout(() => !pending.current && setStalled(true), STALL_MS);
    return () => window.clearTimeout(timer);
  }, [state, waitingForTap, error, round]);

  const retry = () => {
    setError(null);
    setStalled(false);
    hold.current = false;
    setRound((n) => n + 1);
    // A fresh token is usually ready already (the last one was used up); otherwise start Cloudflare's box again.
    if (pending.current) {
      noteRetry();
      trySend();
    } else check.retry();
  };

  // Passed: the form starts its own check in the background, and the first field gets the focus.
  useEffect(() => {
    if (state !== 'passed' || passedOnce.current) return;
    passedOnce.current = true;
    onPass?.();
    window.setTimeout(() => box.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([tabindex="-1"]), textarea, select')?.focus(), 50);
  }, [state, onPass]);

  if (state === 'passed') return <div ref={box}>{children}</div>;
  // While Cloudflare waits for a tap, only its own line shows: no error, no Retry.
  const problem = waitingForTap ? null : error ?? (stalled && check.status !== 'failed' ? t.slow : null);
  return (
    // Tall enough for Cloudflare's box from the start, so the page does not jump when the box appears.
    <div className="mt-6 min-h-[13rem] rounded-2xl bg-white p-3 shadow-sm ring-1 ring-[#E8A317]/30 sm:p-5" data-security-gate={state} role="status" aria-live="polite">
      <p dir={t.dir} className="flex items-center gap-2 text-base font-semibold text-slate-900">
        {problem || waitingForTap || check.status === 'failed' ? <ShieldCheck className="h-5 w-5 shrink-0 text-amber-700" aria-hidden /> : <Loader2 className="h-5 w-5 shrink-0 animate-spin text-emerald-700" aria-hidden />}
        {t.title}
      </p>
      <p dir={t.dir} className="mt-1 text-sm text-slate-600">{t.why}</p>
      <div className="mt-3">{check.element}</div>
      {awaitingTap && (
        <button
          type="button"
          onClick={() => {
            confirmed.current = true;
            setAwaitingTap(false);
            trySend();
          }}
          className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-chinar px-5 font-semibold text-white hover:bg-chinar-hover"
          data-gate-confirm
        >
          <Hand className="h-5 w-5" aria-hidden /> <span dir={t.dir}>{t.tap}</span>
        </button>
      )}
      {problem && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-200" data-gate-problem>
          <span className="min-w-0 flex-1" dir={error ? undefined : t.dir}>{problem}</span>
          <button type="button" onClick={retry} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-white px-3 font-semibold ring-1 ring-amber-300 hover:bg-amber-100">
            <RotateCcw className="h-4 w-4" aria-hidden /> Retry
          </button>
          <button type="button" onClick={() => go('passed')} className="mt-1 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 font-semibold text-white hover:bg-emerald-800" data-gate-skip>
            <ArrowRight className="h-4 w-4" aria-hidden /> Continue to sign-in
          </button>
        </div>
      )}
    </div>
  );
}
