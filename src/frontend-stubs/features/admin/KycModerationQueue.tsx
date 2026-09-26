/**
 * KycModerationQueue — the admin moderation surface for expert KYC. Lists
 * pending submissions (GET /api/v1/admin/experts/kyc/pending) and lets an admin
 * approve or reject each (PATCH /api/v1/admin/experts/kyc/:id/review). Built for
 * fast triage: one row per submission, document link, decisive action buttons.
 */
import { useEffect, useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { API_BASE_URL } from '../../api';

interface PendingKyc {
  id: string;
  documentType: string;
  documentUrl: string;
  uploadedAt: string;
  expertProfile: {
    id: string;
    displayName: string;
    specialization: string | null;
  };
}

export function KycModerationQueue() {
  const { user } = useAuth();
  const [rows, setRows] = useState<PendingKyc[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const authHeaders: HeadersInit = { Authorization: `Bearer ${user?.accessToken ?? ''}` };

  const load = () => {
    fetch(`${API_BASE_URL}/admin/experts/kyc/pending`, { headers: authHeaders })
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));
  };

  useEffect(load, []);

  const review = async (id: string, status: 'VERIFIED' | 'REJECTED') => {
    setBusyId(id);
    try {
      await fetch(`${API_BASE_URL}/admin/experts/kyc/${id}/review`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setRows((prev) => prev.filter((r) => r.id !== id)); // optimistic remove
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Expert KYC queue</h1>
        <span className="rounded-pill bg-saffron-100 px-3 py-1 text-sm font-semibold text-saffron-600">
          {rows.length} pending
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
          Queue is clear — no submissions awaiting review. 🎉
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3">Expert</th>
                <th className="px-4 py-3">Specialization</th>
                <th className="px-4 py-3">Document</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3 text-right">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {row.expertProfile.displayName}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.expertProfile.specialization ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={row.documentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-buyer-600 hover:underline"
                    >
                      {row.documentType}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(row.uploadedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        disabled={busyId === row.id}
                        onClick={() => review(row.id, 'VERIFIED')}
                        className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        disabled={busyId === row.id}
                        onClick={() => review(row.id, 'REJECTED')}
                        className="rounded-md border border-status-danger px-3 py-1.5 text-xs font-semibold text-status-danger hover:bg-red-50 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
