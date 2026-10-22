import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import StatusBadge from '../../components/ui/StatusBadge';
import { formatDateOnly } from '../../utils/format';

const DECLARATION_TYPE = 'Government Employee Retirement Declaration';
const CLAIM_TYPE = 'Civil Service Pension Claim';

/**
 * Retirement Benefits Tracking — one place for a citizen to follow both halves of retiring from
 * government service: the Finance retirement declaration and the Pensions Civil Service Pension
 * claim. Read-only: it uses the existing GET /api/finance and GET /api/pensions lists.
 */
export default function RetirementTracking() {
  const { t } = useLanguage();
  const [declarations, setDeclarations] = useState(null);
  const [claims, setClaims] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get('/finance/'), api.get('/pensions/')])
      .then(([fin, pen]) => {
        setDeclarations(fin.records.filter((r) => r.service_type === DECLARATION_TYPE));
        setClaims(pen.records.filter((r) => r.service_type === CLAIM_TYPE));
      })
      .catch((err) => { setError(err.message); setDeclarations([]); setClaims([]); });
  }, []);

  if (!declarations || !claims) return <Loading />;

  return (
    <div>
      <p className="mb-4 text-sm">
        <Link to="/finance" className="font-medium text-gov-navy hover:underline">&larr; {t('finance.title')}</Link>
      </p>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('finance.retirementTracking.title')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t('finance.retirementTracking.intro')}</p>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        <TrackingCard
          title={t('finance.retirementTracking.declarationTitle')}
          records={declarations}
          emptyText={t('finance.retirementTracking.noDeclaration')}
          startLink="/finance/government-employment"
          startText={t('finance.retirementTracking.startDeclaration')}
          renderExtra={(r) => r.retirement_reason && (
            <p className="text-sm text-slate-700">
              {t('finance.retirementTracking.reasonLabel')}: {t(`finance.retirementReason.${r.retirement_reason}`)}
            </p>
          )}
          t={t}
        />
        <TrackingCard
          title={t('finance.retirementTracking.claimTitle')}
          records={claims}
          emptyText={t('finance.retirementTracking.noClaim')}
          startLink="/pensions"
          startText={t('finance.retirementTracking.startClaim')}
          t={t}
        />
      </div>
    </div>
  );
}

function TrackingCard({ title, records, emptyText, startLink, startText, renderExtra, t }) {
  return (
    <section className="card">
      <h2 className="mb-4 text-lg font-semibold text-slate-900">{title}</h2>
      {records.length === 0 ? (
        <div>
          <p className="mb-3 text-sm text-slate-600">{emptyText}</p>
          <Link to={startLink} className="btn-primary inline-block">{startText}</Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {records.map((r) => (
            <li key={r.application_reference} className="rounded-md border border-slate-200 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs text-slate-500">{r.application_reference}</span>
                <StatusBadge status={r.status} />
              </div>
              {(r.first_name || r.last_name) && <p className="text-sm font-medium text-slate-700">{r.first_name} {r.last_name}</p>}
              {renderExtra && renderExtra(r)}
              <p className="text-xs text-slate-500">{t('finance.retirementTracking.submittedOn')}: {formatDateOnly(r.created_at)}</p>
              {r.status === 'Rejected' && r.rejection_reason && (
                <p className="mt-1 text-sm text-gov-red">{t('common.reason')}: {r.rejection_reason}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
