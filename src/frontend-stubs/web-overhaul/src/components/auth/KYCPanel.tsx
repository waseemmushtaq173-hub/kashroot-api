'use client';

/**
 * KYCPanel — the three-step verification modal: role → identity → bank.
 *
 *   1. Role      Farmer, Buyer or Seller. Drives the copy of later steps.
 *   2. Identity  "Verify instantly with DigiLocker", or Aadhaar + OTP: the OTP
 *                field appears once UIDAI has (in simulation) sent the code. PAN
 *                is masked as typed and checked for its holder-type letter.
 *   3. Bank      IFSC is masked as typed and, the moment it is complete, looked
 *                up so Bank Name and Branch appear under it before submission.
 *
 * Built on the native <dialog>: showModal() supplies focus trapping, Escape to
 * close and an inert page behind it. Each step's state lives in a hook held by
 * the panel, so Back/Continue never loses what the user typed; remount the
 * panel (change its `key`) to start over.
 *
 * Privacy: the full Aadhaar number never leaves this component. The submission
 * carries the verifier's reference and the last four digits only — UIDAI rules
 * forbid storing Aadhaar numbers outside a licensed vault.
 *
 * Verification calls go through lib/kyc/kyc-service.ts; Aadhaar OTP and
 * DigiLocker are simulated there until the API has endpoints for them.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type Ref,
} from 'react';

import {
  AlertIcon,
  ArrowRightIcon,
  BankIcon,
  CheckIcon,
  FileCheckIcon,
  IdCardIcon,
  LeafIcon,
  LockIcon,
  ShoppingBagIcon,
  SmartphoneIcon,
  SpinnerIcon,
  StoreIcon,
  UsersIcon,
  XIcon,
} from '@/components/ui/icons';
import {
  IfscNotFoundError,
  lookupIfsc,
  OtpRejectedError,
  requestAadhaarOtp,
  verifyAadhaarOtp,
  verifyWithDigiLocker,
  type IdentityVerification,
  type IfscDetails,
} from '@/lib/kyc/kyc-service';
import {
  digitsOnly,
  formatAadhaar,
  formatAccountNumber,
  formatIfsc,
  formatPan,
  isValidAadhaar,
  isValidAccountNumber,
  isValidIfsc,
  isValidPan,
  maskAadhaar,
  panError,
  panHolderType,
} from '@/lib/kyc/validators';

export type KycRole = 'FARMER' | 'BUYER' | 'SELLER';

export interface KycSubmission {
  role: KycRole;
  identity: {
    method: 'DIGILOCKER' | 'AADHAAR_OTP';
    /** Verifier's reference — stored instead of the Aadhaar number. */
    referenceId: string;
    aadhaarLast4: string;
    pan: string;
  };
  bank: {
    ifsc: string;
    bankName: string;
    branch: string;
    accountNumber: string;
  };
}

interface KYCPanelProps {
  open: boolean;
  /** Called when the user dismisses the panel (×, Escape, backdrop, Done). */
  onClose: () => void;
  /** Persist the verified details. Throw to keep the panel open with the message. */
  onComplete?: (submission: KycSubmission) => void | Promise<void>;
  defaultRole?: KycRole;
}

type Step = 'role' | 'identity' | 'bank' | 'done';
type FormStep = Exclude<Step, 'done'>;

const STEPS: readonly { id: FormStep; label: string }[] = [
  { id: 'role', label: 'Role' },
  { id: 'identity', label: 'Identity' },
  { id: 'bank', label: 'Bank details' },
];

const RESEND_SECONDS = 30;

// --- shared class strings ----------------------------------------------------

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700';

const BTN_PRIMARY = `inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-700 to-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-700/20 transition hover:from-emerald-800 hover:to-teal-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none ${FOCUS}`;

const BTN_SECONDARY = `inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

const BTN_LINK = `cursor-pointer rounded font-semibold text-emerald-800 underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline ${FOCUS}`;

function inputClass(invalid: boolean, readOnly = false): string {
  return [
    'block w-full rounded-xl px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 shadow-sm ring-1 ring-inset transition focus:outline-none focus:ring-2',
    invalid ? 'ring-rose-300 focus:ring-rose-500' : 'ring-slate-200 focus:ring-emerald-500',
    readOnly ? 'bg-slate-50 text-slate-600' : 'bg-white/90',
  ].join(' ');
}

// =============================================================================
// Panel
// =============================================================================

export function KYCPanel({ open, onClose, onComplete, defaultRole }: KYCPanelProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const pressStartedOnBackdrop = useRef(false);
  const focusStepOnRender = useRef(false);

  const [step, setStep] = useState<Step>('role');
  const [role, setRole] = useState<KycRole | null>(defaultRole ?? null);
  const identity = useIdentityVerification();
  const bank = useBankDetails();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Mirror `open` onto the native dialog.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      stepHeadingRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // A modal dialog does not stop the page behind it from scrolling.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // After a step change, start the new step at the top and move focus to its
  // heading so screen readers announce where the user now is.
  useEffect(() => {
    if (!focusStepOnRender.current) return;
    focusStepOnRender.current = false;
    bodyRef.current?.scrollTo({ top: 0 });
    stepHeadingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const goTo = (next: Step) => {
    focusStepOnRender.current = true;
    setSubmitError(null);
    setStep(next);
  };

  const canContinue =
    (step === 'role' && role !== null) ||
    (step === 'identity' && identity.result !== null) ||
    (step === 'bank' && bank.result !== null);

  // One submit handler for every step, so Enter advances like the button does.
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canContinue || submitting) return;
    if (step === 'role') return goTo('identity');
    if (step === 'identity') return goTo('bank');
    if (!role || !identity.result || !bank.result) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await onComplete?.({ role, identity: identity.result, bank: bank.result });
      goTo('done');
    } catch (err) {
      setSubmitError(
        err instanceof Error && err.message ? err.message : 'We couldn’t submit your details. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const closeDialog = () => dialogRef.current?.close();

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      // Fires for ×, Escape, backdrop and our own close(); only report the
      // dismissals the parent has not already caused by setting open=false.
      onClose={() => {
        if (open) onClose();
      }}
      // Close on a click that both starts and ends on the backdrop — not when a
      // text selection dragged out of an input happens to end there.
      onMouseDown={(e) => {
        pressStartedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressStartedOnBackdrop.current && e.target === e.currentTarget) closeDialog();
      }}
      className="m-auto max-h-[calc(100svh-1.5rem)] w-[calc(100%-1.5rem)] max-w-2xl overflow-hidden rounded-[28px] bg-gradient-to-br from-white/95 via-white/90 to-emerald-50/90 p-0 text-slate-900 shadow-[0_30px_90px_rgba(15,23,42,0.25)] ring-1 ring-slate-900/5 backdrop-blur-2xl backdrop:bg-white/40 backdrop:backdrop-blur-md"
    >
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-emerald-200/50 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-amber-200/40 blur-3xl" />

      <div className="relative flex max-h-[calc(100svh-1.5rem)] flex-col">
        <header className="shrink-0 border-b border-slate-900/5 px-5 pb-4 pt-5 sm:px-8 sm:pt-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                <LockIcon className="h-3.5 w-3.5" />
                Kashroot verification
              </p>
              <h2 id={titleId} className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                Complete your KYC
              </h2>
            </div>
            <button
              type="button"
              onClick={closeDialog}
              aria-label="Close verification"
              className={`grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full bg-white/80 text-slate-600 ring-1 ring-slate-900/10 transition hover:bg-white hover:text-slate-900 ${FOCUS}`}
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>

          {step !== 'done' && <Stepper currentIndex={stepIndex} onSelect={goTo} />}
        </header>

        {step === 'done' ? (
          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-8">
            <DoneView
              headingRef={stepHeadingRef}
              role={role}
              identity={identity.result}
              bank={bank.result}
              onDone={closeDialog}
            />
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
              {step === 'role' && <RoleStep headingRef={stepHeadingRef} role={role} onSelect={setRole} />}
              {step === 'identity' && <IdentityStep headingRef={stepHeadingRef} model={identity} />}
              {step === 'bank' && <BankStep headingRef={stepHeadingRef} model={bank} role={role} />}
            </div>

            <footer className="shrink-0 space-y-3 border-t border-slate-900/5 bg-white/60 px-5 py-4 sm:px-8">
              {submitError && <InlineAlert announce>{submitError}</InlineAlert>}
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => goTo(STEPS[stepIndex - 1]?.id ?? 'role')}
                  className={`${BTN_SECONDARY} ${step === 'role' ? 'invisible' : ''}`}
                >
                  Back
                </button>
                <p className="hidden text-xs font-medium text-slate-500 sm:block">
                  Step {stepIndex + 1} of {STEPS.length}
                </p>
                <button type="submit" disabled={!canContinue || submitting} className={BTN_PRIMARY}>
                  {step !== 'bank' ? (
                    <>
                      Continue <ArrowRightIcon className="h-4 w-4" />
                    </>
                  ) : submitting ? (
                    <>
                      <SpinnerIcon className="h-4 w-4 animate-spin" /> Submitting…
                    </>
                  ) : (
                    <>
                      Submit for verification <CheckIcon className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </footer>
          </form>
        )}
      </div>
    </dialog>
  );
}

// =============================================================================
// Step 1 — role
// =============================================================================

const ROLE_OPTIONS: readonly {
  id: KycRole;
  title: string;
  description: string;
  Icon: typeof LeafIcon;
  tile: string;
  selected: string;
}[] = [
  {
    id: 'FARMER',
    title: 'Farmer',
    description: 'I grow apples, saffron, walnuts or other produce.',
    Icon: LeafIcon,
    tile: 'bg-gradient-to-br from-emerald-400 to-green-600',
    selected: 'peer-checked:bg-emerald-50/90 peer-checked:ring-emerald-500',
  },
  {
    id: 'BUYER',
    title: 'Buyer',
    description: 'I source produce for my business, store or exports.',
    Icon: ShoppingBagIcon,
    tile: 'bg-gradient-to-br from-sky-400 to-indigo-500',
    selected: 'peer-checked:bg-sky-50/90 peer-checked:ring-sky-500',
  },
  {
    id: 'SELLER',
    title: 'Seller',
    description: 'I trade, aggregate or list agri-products for sale.',
    Icon: StoreIcon,
    tile: 'bg-gradient-to-br from-amber-400 to-orange-500',
    selected: 'peer-checked:bg-amber-50/90 peer-checked:ring-amber-500',
  },
];

function RoleStep({
  headingRef,
  role,
  onSelect,
}: {
  headingRef: Ref<HTMLHeadingElement>;
  role: KycRole | null;
  onSelect: (role: KycRole) => void;
}) {
  const name = useId();
  return (
    <>
      <StepHeading
        headingRef={headingRef}
        Icon={UsersIcon}
        title="How will you use Kashroot?"
        description="This sets up your dashboard and decides what we verify next."
      />
      <fieldset>
        <legend className="sr-only">Your role</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {ROLE_OPTIONS.map(({ id, title, description, Icon, tile, selected }) => (
            <label key={id} className="relative block cursor-pointer">
              <input
                type="radio"
                name={name}
                value={id}
                checked={role === id}
                onChange={() => onSelect(id)}
                className="peer sr-only"
              />
              <span
                className={`flex h-full flex-col rounded-2xl bg-white/70 p-4 ring-1 ring-slate-900/10 transition hover:bg-white peer-checked:ring-2 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-emerald-700 ${selected}`}
              >
                <span className={`grid h-11 w-11 place-items-center rounded-xl text-white shadow-md ${tile}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="mt-3 font-semibold text-slate-900">{title}</span>
                <span className="mt-1 text-sm leading-snug text-slate-600">{description}</span>
              </span>
              <span
                aria-hidden
                className="absolute right-3 top-3 hidden h-6 w-6 place-items-center rounded-full bg-emerald-600 text-white shadow peer-checked:grid"
              >
                <CheckIcon className="h-3.5 w-3.5" />
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}

// =============================================================================
// Step 2 — identity (DigiLocker or Aadhaar OTP, plus PAN)
// =============================================================================

type OtpPhase = 'idle' | 'sending' | 'verifying';

function useIdentityVerification() {
  const [aadhaar, setAadhaarValue] = useState('');
  const [txnId, setTxnId] = useState<string | null>(null);
  const [otpPhase, setOtpPhase] = useState<OtpPhase>('idle');
  const [otp, setOtp] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [digiLocker, setDigiLocker] = useState<'idle' | 'connecting' | 'failed'>('idle');
  const [verified, setVerified] = useState<
    (IdentityVerification & { method: KycSubmission['identity']['method'] }) | null
  >(null);
  const [pan, setPanValue] = useState('');
  // Bumped on every reset, so a response for an abandoned attempt is ignored.
  const attempt = useRef(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const aadhaarDigits = digitsOnly(aadhaar);
  const aadhaarValid = isValidAadhaar(aadhaarDigits);
  const aadhaarError = /^[01]/.test(aadhaarDigits)
    ? 'Aadhaar numbers never start with 0 or 1.'
    : aadhaarDigits.length === 12 && !aadhaarValid
      ? 'This Aadhaar number doesn’t add up — please re-check the digits.'
      : null;

  const sendOtp = async () => {
    if (!aadhaarValid || otpPhase !== 'idle' || resendIn > 0) return;
    const current = ++attempt.current;
    setOtpPhase('sending');
    setSendError(null);
    setOtpError(null);
    setOtp('');
    try {
      const { txnId: id } = await requestAadhaarOtp(aadhaarDigits);
      if (current !== attempt.current) return;
      setTxnId(id);
      setResendIn(RESEND_SECONDS);
    } catch {
      if (current !== attempt.current) return;
      setSendError('We couldn’t send the OTP. Please try again.');
    } finally {
      if (current === attempt.current) setOtpPhase('idle');
    }
  };

  const verifyOtp = async (code: string) => {
    if (!txnId || code.length !== 6 || otpPhase !== 'idle') return;
    const current = attempt.current;
    setOtpPhase('verifying');
    setOtpError(null);
    try {
      const result = await verifyAadhaarOtp(txnId, code);
      if (current !== attempt.current) return;
      setVerified({ ...result, method: 'AADHAAR_OTP' });
      setTxnId(null);
      setOtp('');
    } catch (err) {
      if (current !== attempt.current) return;
      setOtpError(err instanceof OtpRejectedError ? err.message : 'Verification failed. Please try again.');
      setOtp('');
    } finally {
      if (current === attempt.current) setOtpPhase('idle');
    }
  };

  /** Verifies as soon as the sixth digit lands — no extra tap needed. */
  const handleOtpChange = (value: string) => {
    const code = digitsOnly(value).slice(0, 6);
    setOtp(code);
    setOtpError(null);
    if (code.length === 6) void verifyOtp(code);
  };

  const startDigiLocker = async () => {
    const current = ++attempt.current;
    setDigiLocker('connecting');
    try {
      const result = await verifyWithDigiLocker();
      if (current !== attempt.current) return;
      setVerified({ ...result, method: 'DIGILOCKER' });
      setDigiLocker('idle');
    } catch {
      if (current === attempt.current) setDigiLocker('failed');
    }
  };

  /** Back to an unverified Aadhaar, keeping the typed number for editing. */
  const resetAadhaar = () => {
    attempt.current++;
    setVerified(null);
    setTxnId(null);
    setOtpPhase('idle');
    setOtp('');
    setSendError(null);
    setOtpError(null);
    setResendIn(0);
    setDigiLocker('idle');
  };

  const result: KycSubmission['identity'] | null =
    verified && isValidPan(pan)
      ? { method: verified.method, referenceId: verified.referenceId, aadhaarLast4: verified.aadhaarLast4, pan }
      : null;

  return {
    aadhaar,
    setAadhaar: (value: string) => setAadhaarValue(formatAadhaar(value)),
    aadhaarValid,
    aadhaarError,
    aadhaarLast4: aadhaarDigits.slice(-4),
    otpRequested: txnId !== null,
    otpPhase,
    otp,
    handleOtpChange,
    verifyOtp,
    sendOtp,
    sendError,
    otpError,
    resendIn,
    digiLocker,
    startDigiLocker,
    verified,
    resetAadhaar,
    pan,
    setPan: (value: string) => setPanValue(formatPan(value)),
    result,
  };
}

function IdentityStep({
  headingRef,
  model,
}: {
  headingRef: Ref<HTMLHeadingElement>;
  model: ReturnType<typeof useIdentityVerification>;
}) {
  const aadhaarId = useId();
  const otpId = useId();
  const panId = useId();
  const busy = model.otpPhase !== 'idle' || model.digiLocker === 'connecting';
  const panProblem = panError(model.pan);
  const panOk = isValidPan(model.pan);

  return (
    <>
      <StepHeading
        headingRef={headingRef}
        Icon={IdCardIcon}
        title="Verify your identity"
        description="Use DigiLocker for an instant check, or verify your Aadhaar with a one-time password."
      />

      <div className="space-y-6">
        {model.verified ? (
          <div
            role="status"
            className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 p-4 ring-1 ring-emerald-200"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-600 text-white shadow-md shadow-emerald-600/30">
              <CheckIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900">Aadhaar verified</p>
              <p className="text-sm tabular-nums text-slate-600">
                {maskAadhaar(model.verified.aadhaarLast4)} · via{' '}
                {model.verified.method === 'DIGILOCKER' ? 'DigiLocker' : 'Aadhaar OTP'}
              </p>
            </div>
            <button type="button" onClick={model.resetAadhaar} className={`text-sm ${BTN_LINK}`}>
              Change
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={model.startDigiLocker}
              disabled={busy}
              className={`flex w-full cursor-pointer items-center gap-4 rounded-2xl bg-gradient-to-r from-indigo-700 via-blue-700 to-sky-700 p-4 text-left text-white shadow-lg shadow-blue-700/25 transition hover:shadow-xl hover:shadow-blue-700/30 disabled:cursor-not-allowed disabled:opacity-80 ${FOCUS}`}
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/15 ring-1 ring-white/30">
                <FileCheckIcon className="h-6 w-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {model.digiLocker === 'connecting' ? 'Connecting to DigiLocker…' : 'Verify instantly with DigiLocker'}
                </span>
                <span className="mt-0.5 block text-sm text-blue-50">
                  Share your Aadhaar-verified identity with consent — no OTP needed.
                </span>
              </span>
              {model.digiLocker === 'connecting' ? (
                <SpinnerIcon className="h-5 w-5 shrink-0 animate-spin" />
              ) : (
                <ArrowRightIcon className="h-5 w-5 shrink-0" />
              )}
            </button>

            {model.digiLocker === 'failed' && (
              <InlineAlert announce>DigiLocker didn’t respond. Try again, or verify with Aadhaar OTP below.</InlineAlert>
            )}

            <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <span className="h-px flex-1 bg-slate-200" />
              or verify with Aadhaar OTP
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <Field
              id={aadhaarId}
              label="Aadhaar number"
              hint="12 digits. Only the last 4 are kept after verification."
              error={model.aadhaarError ?? model.sendError}
            >
              <div className="flex gap-2">
                <input
                  id={aadhaarId}
                  value={model.aadhaar}
                  onChange={(e) => model.setAadhaar(e.target.value)}
                  readOnly={model.otpRequested}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="XXXX XXXX XXXX"
                  aria-invalid={model.aadhaarError ? true : undefined}
                  aria-describedby={describedBy(aadhaarId, model.aadhaarError ?? model.sendError)}
                  className={`${inputClass(!!model.aadhaarError, model.otpRequested)} tabular-nums tracking-[0.15em]`}
                />
                {model.otpRequested ? (
                  <button type="button" onClick={model.resetAadhaar} className={`${BTN_SECONDARY} shrink-0`}>
                    Change
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={model.sendOtp}
                    disabled={!model.aadhaarValid || busy}
                    className={`${BTN_PRIMARY} shrink-0`}
                  >
                    {model.otpPhase === 'sending' && <SpinnerIcon className="h-4 w-4 animate-spin" />}
                    Get OTP
                  </button>
                )}
              </div>
            </Field>

            {model.otpRequested && (
              <div className="rounded-2xl bg-emerald-50/70 p-4 ring-1 ring-emerald-200/80 sm:p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-emerald-700 ring-1 ring-emerald-200">
                    <SmartphoneIcon className="h-5 w-5" />
                  </span>
                  <div>
                    <label htmlFor={otpId} className="text-sm font-semibold text-slate-900">
                      Enter the 6-digit OTP
                    </label>
                    <p className="text-sm text-slate-600">
                      Sent by UIDAI to the mobile number linked with Aadhaar{' '}
                      <span className="tabular-nums">{maskAadhaar(model.aadhaarLast4)}</span>.
                    </p>
                  </div>
                </div>

                <OtpInput
                  id={otpId}
                  value={model.otp}
                  onChange={model.handleOtpChange}
                  disabled={model.otpPhase === 'verifying'}
                  invalid={!!model.otpError}
                  describedBy={model.otpError ? `${otpId}-error` : undefined}
                />

                {model.otpError && (
                  <p id={`${otpId}-error`} role="alert" className="mt-2 flex items-center gap-1.5 text-sm text-rose-700">
                    <AlertIcon className="h-4 w-4 shrink-0" />
                    {model.otpError}
                  </p>
                )}

                <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                  <button
                    type="button"
                    onClick={model.sendOtp}
                    disabled={model.resendIn > 0 || busy}
                    className={`tabular-nums ${BTN_LINK}`}
                  >
                    {model.resendIn > 0 ? `Resend OTP in ${model.resendIn}s` : 'Resend OTP'}
                  </button>
                  <button
                    type="button"
                    onClick={() => model.verifyOtp(model.otp)}
                    disabled={model.otp.length !== 6 || busy}
                    className={BTN_SECONDARY}
                  >
                    {model.otpPhase === 'verifying' && <SpinnerIcon className="h-4 w-4 animate-spin" />}
                    {model.otpPhase === 'verifying' ? 'Verifying…' : 'Verify OTP'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        <Field
          id={panId}
          label="PAN"
          hint={
            panOk ? (
              <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                <CheckIcon className="h-3.5 w-3.5" />
                {panHolderType(model.pan)} PAN
              </span>
            ) : (
              'Permanent Account Number, exactly as printed on your PAN card.'
            )
          }
          error={panProblem}
        >
          <div className="relative">
            <input
              id={panId}
              value={model.pan}
              onChange={(e) => model.setPan(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="ABCDE1234F"
              aria-invalid={panProblem ? true : undefined}
              aria-describedby={describedBy(panId, panProblem)}
              className={`${inputClass(!!panProblem)} pr-11 uppercase tracking-[0.2em]`}
            />
            {panOk && (
              <CheckIcon className="pointer-events-none absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-emerald-600" />
            )}
          </div>
        </Field>
      </div>
    </>
  );
}

/**
 * One real input behind six visual boxes: typing, deleting, pasting and SMS
 * autofill (autocomplete="one-time-code") all behave natively, which six
 * separate inputs only approximate.
 */
function OtpInput({
  id,
  value,
  onChange,
  disabled,
  invalid,
  describedBy: describedById,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  invalid: boolean;
  describedBy?: string;
}) {
  const [focused, setFocused] = useState(false);
  const caret = Math.min(value.length, 5);

  return (
    <div className="relative mt-4">
      <input
        id={id}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-invalid={invalid || undefined}
        aria-describedby={describedById}
        className="absolute inset-0 z-10 h-full w-full cursor-text text-base opacity-0 disabled:cursor-wait"
      />
      <div aria-hidden className="grid grid-cols-6 gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className={`grid h-12 place-items-center rounded-xl bg-white text-xl font-semibold tabular-nums text-slate-900 shadow-sm ring-inset transition sm:h-14 ${
              invalid
                ? 'ring-2 ring-rose-300'
                : focused && i === caret
                  ? 'ring-2 ring-emerald-500'
                  : 'ring-1 ring-slate-200'
            } ${disabled ? 'opacity-60' : ''}`}
          >
            {value[i] ?? ''}
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// Step 3 — bank details with live IFSC lookup
// =============================================================================

type IfscLookup =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; details: IfscDetails }
  | { status: 'not-found' }
  | { status: 'error' };

function useBankDetails() {
  const [ifsc, setIfsc] = useState('');
  const [lookup, setLookup] = useState<IfscLookup>({ status: 'idle' });
  const [account, setAccountValue] = useState('');
  const [confirm, setConfirmValue] = useState('');
  const [accountTouched, setAccountTouched] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const runLookup = (code: string) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLookup({ status: 'loading' });
    lookupIfsc(code, controller.signal).then(
      (details) => {
        if (!controller.signal.aborted) setLookup({ status: 'found', details });
      },
      (err: unknown) => {
        if (!controller.signal.aborted) {
          setLookup({ status: err instanceof IfscNotFoundError ? 'not-found' : 'error' });
        }
      },
    );
  };

  /**
   * Masks the IFSC as it is typed and, the moment it is a complete, well-formed
   * code, fetches its bank and branch. Any edit cancels the request in flight,
   * so a slow answer for an old code can never overwrite the current one.
   */
  const handleIfscChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = formatIfsc(event.target.value);
    if (next === ifsc) return;
    setIfsc(next);
    if (isValidIfsc(next)) {
      runLookup(next);
    } else {
      inFlight.current?.abort();
      setLookup({ status: 'idle' });
    }
  };

  const accountValid = isValidAccountNumber(account);
  const accountError =
    accountTouched && account.length > 0 && !accountValid ? 'Account numbers are 9 to 18 digits.' : null;
  // Flags the first wrong digit rather than waiting for the full number.
  const confirmError = confirm.length > 0 && !account.startsWith(confirm) ? 'Account numbers don’t match.' : null;

  const result: KycSubmission['bank'] | null =
    lookup.status === 'found' && accountValid && confirm === account
      ? { ifsc, bankName: lookup.details.bank, branch: lookup.details.branch, accountNumber: account }
      : null;

  return {
    ifsc,
    handleIfscChange,
    lookup,
    retryLookup: () => runLookup(ifsc),
    account,
    setAccount: (value: string) => setAccountValue(formatAccountNumber(value)),
    touchAccount: () => setAccountTouched(true),
    accountError,
    confirm,
    setConfirm: (value: string) => setConfirmValue(formatAccountNumber(value)),
    confirmError,
    confirmMatches: accountValid && confirm === account,
    result,
  };
}

function BankStep({
  headingRef,
  model,
  role,
}: {
  headingRef: Ref<HTMLHeadingElement>;
  model: ReturnType<typeof useBankDetails>;
  role: KycRole | null;
}) {
  const ifscId = useId();
  const accountId = useId();
  const confirmId = useId();
  const { lookup } = model;
  const isBuyer = role === 'BUYER';

  return (
    <>
      <StepHeading
        headingRef={headingRef}
        Icon={BankIcon}
        title={isBuyer ? 'Add your refund account' : 'Add your payout account'}
        description={
          isBuyer
            ? 'Escrow refunds and settlements are paid into this account.'
            : 'Payments released from escrow are sent to this account.'
        }
      />

      <div className="space-y-5">
        <Field id={ifscId} label="IFSC code" hint="11 characters, printed on your cheque book or passbook.">
          <div className="relative">
            <input
              id={ifscId}
              value={model.ifsc}
              onChange={model.handleIfscChange}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="ABCD0123456"
              aria-invalid={lookup.status === 'not-found' || undefined}
              aria-describedby={`${ifscId}-hint ${ifscId}-status`}
              className={`${inputClass(lookup.status === 'not-found')} pr-11 uppercase tracking-[0.2em]`}
            />
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2">
              {lookup.status === 'loading' && <SpinnerIcon className="h-5 w-5 animate-spin text-emerald-600" />}
              {lookup.status === 'found' && <CheckIcon className="h-5 w-5 text-emerald-600" />}
            </span>
          </div>
        </Field>

        <div id={`${ifscId}-status`} aria-live="polite">
          {lookup.status === 'loading' && <p className="text-sm text-slate-600">Looking up your branch…</p>}
          {lookup.status === 'found' && <BranchDetails details={lookup.details} />}
          {lookup.status === 'not-found' && (
            <InlineAlert>
              We couldn’t find a branch for <span className="font-semibold">{model.ifsc}</span>. Check the code on
              your cheque book or passbook.
            </InlineAlert>
          )}
          {lookup.status === 'error' && (
            <InlineAlert
              action={
                <button type="button" onClick={model.retryLookup} className={`shrink-0 ${BTN_LINK}`}>
                  Retry
                </button>
              }
            >
              We couldn’t reach the IFSC directory just now.
            </InlineAlert>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={accountId} label="Account number" hint="9 to 18 digits." error={model.accountError}>
            <input
              id={accountId}
              value={model.account}
              onChange={(e) => model.setAccount(e.target.value)}
              onBlur={model.touchAccount}
              inputMode="numeric"
              autoComplete="off"
              placeholder="Enter account number"
              aria-invalid={model.accountError ? true : undefined}
              aria-describedby={describedBy(accountId, model.accountError)}
              className={`${inputClass(!!model.accountError)} tabular-nums tracking-wider`}
            />
          </Field>
          <Field
            id={confirmId}
            label="Re-enter account number"
            hint={
              model.confirmMatches ? (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                  <CheckIcon className="h-3.5 w-3.5" /> Numbers match
                </span>
              ) : (
                'Typed twice, so a payout never goes astray.'
              )
            }
            error={model.confirmError}
          >
            <input
              id={confirmId}
              value={model.confirm}
              onChange={(e) => model.setConfirm(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              placeholder="Enter it again"
              aria-invalid={model.confirmError ? true : undefined}
              aria-describedby={describedBy(confirmId, model.confirmError)}
              className={`${inputClass(!!model.confirmError)} tabular-nums tracking-wider`}
            />
          </Field>
        </div>
      </div>
    </>
  );
}

function BranchDetails({ details }: { details: IfscDetails }) {
  const location = [details.city, details.state].filter(Boolean).join(', ');
  return (
    <div className="rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-emerald-200">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700">
        <CheckIcon className="h-3.5 w-3.5" /> Branch found
      </p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-slate-500">Bank name</dt>
          <dd className="mt-0.5 font-semibold text-slate-900">{details.bank}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">Branch</dt>
          <dd className="mt-0.5 font-semibold text-slate-900">{details.branch}</dd>
          {location && <dd className="text-sm text-slate-600">{location}</dd>}
        </div>
      </dl>
    </div>
  );
}

// =============================================================================
// Done
// =============================================================================

function DoneView({
  headingRef,
  role,
  identity,
  bank,
  onDone,
}: {
  headingRef: Ref<HTMLHeadingElement>;
  role: KycRole | null;
  identity: KycSubmission['identity'] | null;
  bank: KycSubmission['bank'] | null;
  onDone: () => void;
}) {
  const rows = [
    role && { label: 'Role', value: ROLE_OPTIONS.find((o) => o.id === role)?.title ?? role },
    identity && { label: 'Aadhaar', value: maskAadhaar(identity.aadhaarLast4) },
    identity && { label: 'PAN', value: `XXXXX${identity.pan.slice(5)}` },
    bank && { label: 'Bank', value: `${bank.bankName} · ••••${bank.accountNumber.slice(-4)}` },
  ].filter((row): row is { label: string; value: string } => Boolean(row));

  return (
    <div className="text-center">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-lg shadow-emerald-600/30">
        <CheckIcon className="h-8 w-8" />
      </span>
      <h3 ref={headingRef} tabIndex={-1} className="mt-5 text-2xl font-semibold tracking-tight text-slate-900 focus:outline-none">
        Verification submitted
      </h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-slate-600">
        Your details are with our team for review. You can keep using Kashroot in the meantime.
      </p>
      <dl className="mx-auto mt-6 max-w-sm divide-y divide-slate-900/5 rounded-2xl bg-white/80 text-left text-sm ring-1 ring-slate-900/5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-slate-500">{row.label}</dt>
            <dd className="text-right font-medium tabular-nums text-slate-900">{row.value}</dd>
          </div>
        ))}
      </dl>
      <button type="button" onClick={onDone} className={`${BTN_PRIMARY} mt-8 min-w-[10rem]`}>
        Done
      </button>
    </div>
  );
}

// =============================================================================
// Shared pieces
// =============================================================================

function Stepper({ currentIndex, onSelect }: { currentIndex: number; onSelect: (step: Step) => void }) {
  return (
    <ol className="mt-5 grid grid-cols-3 gap-3">
      {STEPS.map((s, i) => {
        const complete = i < currentIndex;
        const active = i === currentIndex;
        return (
          <li key={s.id}>
            {/* Completed steps are buttons back; the current and later ones are not. */}
            <button
              type="button"
              disabled={!complete}
              onClick={() => onSelect(s.id)}
              aria-current={active ? 'step' : undefined}
              className={`group flex w-full cursor-pointer flex-col gap-2 rounded text-left disabled:cursor-default ${FOCUS}`}
            >
              <span
                className={`h-1.5 rounded-full transition-colors ${
                  complete || active ? 'bg-gradient-to-r from-emerald-500 to-teal-500' : 'bg-slate-200'
                }`}
              />
              <span
                className={`flex items-center gap-1.5 text-xs font-semibold ${
                  active ? 'text-slate-900' : complete ? 'text-emerald-700 group-hover:underline' : 'text-slate-500'
                }`}
              >
                {complete ? <CheckIcon className="h-3.5 w-3.5" /> : <span className="tabular-nums">{i + 1}.</span>}
                <span className="sr-only">Step {i + 1}: </span>
                {s.label}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function StepHeading({
  headingRef,
  Icon,
  title,
  description,
}: {
  headingRef: Ref<HTMLHeadingElement>;
  Icon: typeof LeafIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-6 flex items-start gap-4">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-md shadow-emerald-600/25">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h3 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-slate-900 focus:outline-none">
          {title}
        </h3>
        <p className="mt-1 text-sm text-slate-600">{description}</p>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 flex items-start gap-1.5 text-sm text-rose-700">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Points an input at whichever of its error or hint Field is rendering. */
function describedBy(id: string, error: string | null | undefined): string {
  return error ? `${id}-error` : `${id}-hint`;
}

function InlineAlert({
  children,
  action,
  announce = false,
}: {
  children: ReactNode;
  action?: ReactNode;
  /** Use role="alert" — only when not already inside an aria-live region. */
  announce?: boolean;
}) {
  return (
    <div
      role={announce ? 'alert' : undefined}
      className="flex items-start gap-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200"
    >
      <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1">{children}</p>
      {action}
    </div>
  );
}
