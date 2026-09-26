/**
 * BuyerDashboard — the buyer console landing page. Two headline concerns:
 *   1. Escrow tracking — money the buyer has locked against live orders and
 *      where each hold sits (HELD / RELEASED / REFUNDED).
 *   2. Market analytics — spend, active orders, and mandi trend snapshots.
 * Data-dense, scannable, desktop-first. Numbers here are placeholders wired to
 * GET /api/v1/escrow/:orderId and the analytics endpoints in the real build.
 */
const KPIS = [
  { label: 'Funds in escrow', value: '₹4,82,000', hint: '7 active holds', tone: 'brand' },
  { label: 'Released this month', value: '₹11,20,000', hint: '+18% vs last', tone: 'up' },
  { label: 'Active orders', value: '23', hint: '4 out for delivery', tone: 'buyer' },
  { label: 'Open disputes', value: '1', hint: 'awaiting evidence', tone: 'down' },
] as const;

const ESCROW_ROWS = [
  { order: 'KR-10231', farmer: 'Bashir A.', amount: '₹1,45,000', status: 'HELD' },
  { order: 'KR-10228', farmer: 'Ghulam N.', amount: '₹86,500', status: 'RELEASED' },
  { order: 'KR-10225', farmer: 'Fayaz M.', amount: '₹52,000', status: 'REFUNDED' },
] as const;

const STATUS_STYLES: Record<string, string> = {
  HELD: 'bg-saffron-100 text-saffron-600',
  RELEASED: 'bg-brand-100 text-brand-700',
  REFUNDED: 'bg-slate-200 text-slate-600',
};

export function BuyerDashboard() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-slate-900">Procurement overview</h1>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {KPIS.map((kpi) => (
          <div key={kpi.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-card">
            <div className="text-sm text-slate-500">{kpi.label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{kpi.value}</div>
            <div className="mt-1 text-xs text-slate-400">{kpi.hint}</div>
          </div>
        ))}
      </div>

      {/* Escrow tracking table */}
      <section className="rounded-lg border border-slate-200 bg-white shadow-card">
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="font-semibold text-slate-800">Escrow tracking</h2>
          <a href="/buyer/orders" className="text-sm font-medium text-buyer-600 hover:underline">
            View all
          </a>
        </header>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-2">Order</th>
              <th className="px-4 py-2">Farmer</th>
              <th className="px-4 py-2">Amount</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ESCROW_ROWS.map((row) => (
              <tr key={row.order} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-slate-700">{row.order}</td>
                <td className="px-4 py-3 text-slate-700">{row.farmer}</td>
                <td className="px-4 py-3 font-semibold text-slate-900">{row.amount}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[row.status]}`}>
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
