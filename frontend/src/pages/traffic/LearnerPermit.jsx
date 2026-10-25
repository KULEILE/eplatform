import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import DataTable from '../../components/ui/DataTable';
import { formatDateOnly } from '../../utils/format';

/**
 * Migration 067: a Learner's Permit is no longer something a citizen applies for directly — it
 * is produced automatically the moment an officer records a passed practical driving test (see
 * autoGenerateLearnerPermit() in trafficServices2.controller.js), reusing the citizen's National
 * ID photo/fingerprints. This page is therefore read-only status, not an application form: a
 * citizen sees whether they hold a current permit (and is pointed at the theory test if not); an
 * officer sees every permit issued, with no action to take on any of them — there is nothing to
 * approve, since they were never submitted for review in the first place.
 */
export default function LearnerPermit() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['traffic_officer', 'system_administrator'].includes(user.roleKey);
  const [records, setRecords] = useState(null);

  useEffect(() => {
    api.get('/traffic/').then((d) => setRecords((d.records || []).filter((r) => r.service_type === 'Learner Permit'))).catch(() => setRecords([]));
  }, []);

  if (!records) return <Loading />;

  if (isOfficer) {
    return (
      <div>
        <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('traffic.hub.learnerPermit')}</h1>
        <p className="mb-6 text-sm text-slate-600">{t('traffic.learnerPermitStatus.officerIntro')}</p>
        <DataTable
          rowKey="traffic_record_id"
          rows={records}
          emptyTitle={t('common.noResults')}
          columns={[
            { key: 'reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.application_reference}</span> },
            { key: 'citizen', header: t('common.citizen'), render: (r) => `${r.first_name} ${r.last_name}` },
            { key: 'licenceNumber', header: t('traffic.licenceNumber'), render: (r) => <span className="font-mono text-xs">{r.licence_number}</span> },
            { key: 'issueDate', header: t('traffic.drivingLicence.learnerPermitBox.issued'), render: (r) => formatDateOnly(r.issue_date) },
            { key: 'expiryDate', header: t('traffic.drivingLicence.learnerPermitBox.expiry'), render: (r) => formatDateOnly(r.expiry_date) },
          ]}
        />
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const current = [...records].sort((a, b) => new Date(b.expiry_date || 0) - new Date(a.expiry_date || 0))[0] || null;
  const isExpired = current && current.expiry_date && String(current.expiry_date).slice(0, 10) < today;

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('traffic.hub.learnerPermit')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t('traffic.learnerPermitStatus.intro')}</p>

      {!current ? (
        <div className="card">
          <p className="mb-3 text-sm text-slate-600">{t('traffic.learnerPermitStatus.noneYet')}</p>
          <Link to="/traffic/test-bookings" className="btn-primary inline-block">{t('traffic.learnerPermitStatus.bookTheoryLink')}</Link>
        </div>
      ) : (
        <div className="card">
          <p className="mb-3 text-xs uppercase tracking-wide text-slate-500">
            {isExpired ? t('traffic.learnerPermitStatus.expiredBadge') : t('traffic.learnerPermitStatus.approvedBadge')}
          </p>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><dt className="text-xs text-slate-500">{t('traffic.licenceNumber')}</dt><dd className="font-mono font-medium">{current.licence_number}</dd></div>
            <div><dt className="text-xs text-slate-500">{t('traffic.drivingLicence.learnerPermitBox.issued')}</dt><dd className="font-medium">{formatDateOnly(current.issue_date)}</dd></div>
            <div>
              <dt className="text-xs text-slate-500">{t('traffic.drivingLicence.learnerPermitBox.expiry')}</dt>
              <dd className={`font-medium ${isExpired ? 'text-gov-red' : 'text-gov-green'}`}>{formatDateOnly(current.expiry_date)}</dd>
            </div>
          </dl>
          {!isExpired && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-gov-amber">⚠ {t('traffic.drivingLicence.learnerPermitBox.surrenderNotice')}</p>
          )}
          {isExpired && (
            <Link to="/traffic/test-bookings" className="btn-primary mt-3 inline-block">{t('traffic.learnerPermitStatus.bookTheoryLink')}</Link>
          )}
        </div>
      )}
    </div>
  );
}
