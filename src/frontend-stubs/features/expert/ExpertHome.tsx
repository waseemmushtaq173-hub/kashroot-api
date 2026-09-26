/**
 * ExpertHome — the expert's dashboard landing. Surfaces their KYC/verification
 * standing (from ExpertProfile.verificationStatus) and upcoming appointments.
 * A supporting stub for the ExpertLayout persona; wire to the appointments and
 * expert-kyc endpoints in the real build.
 */
import { useAuth } from '../../auth/AuthContext';

const APPOINTMENTS = [
  { time: '10:00', farmer: 'Bashir A.', topic: 'Apple scab management' },
  { time: '12:30', farmer: 'Fayaz M.', topic: 'Walnut grading advice' },
] as const;

export function ExpertHome() {
  const { user } = useAuth();
  // Placeholder — real value comes from GET the expert's profile.
  const verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED' = 'VERIFIED';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Welcome back, {user?.displayName ?? 'Doctor'}
        </h1>
        <p className="text-sm text-slate-500">Your advisory dashboard</p>
      </div>

      {/* Verification standing */}
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-card">
        <span aria-hidden className="text-2xl">
          {verificationStatus === 'VERIFIED' ? '✅' : verificationStatus === 'PENDING' ? '⏳' : '⚠️'}
        </span>
        <div>
          <div className="font-medium text-slate-800">KYC status: {verificationStatus}</div>
          <div className="text-sm text-slate-500">
            {verificationStatus === 'VERIFIED'
              ? 'You are verified and visible to farmers.'
              : 'Your credentials are under review.'}
          </div>
        </div>
        <a href="/expert/kyc" className="ml-auto text-sm font-medium text-saffron-600 hover:underline">
          Manage
        </a>
      </div>

      {/* Today's appointments */}
      <section className="rounded-lg border border-slate-200 bg-white shadow-card">
        <header className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-800">
          Today&apos;s appointments
        </header>
        <ul className="divide-y divide-slate-100">
          {APPOINTMENTS.map((a) => (
            <li key={a.time} className="flex items-center gap-4 px-4 py-3">
              <span className="w-14 font-mono text-sm text-slate-500">{a.time}</span>
              <span className="font-medium text-slate-800">{a.farmer}</span>
              <span className="text-sm text-slate-500">· {a.topic}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
