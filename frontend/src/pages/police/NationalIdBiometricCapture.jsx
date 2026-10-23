import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import EmptyState from '../../components/ui/EmptyState';
import HandScan from '../../components/HandScan';
import { formatDateOnly } from '../../utils/format';

/**
 * Police-officer-facing queue: every National ID application 'Awaiting Biometric Capture' at
 * this officer's own station (system_administrator sees every station). The officer scans the
 * citizen's two hands in person — the same real hand-geometry technology self-enrolment uses
 * (see HandScan.jsx / BiometricCapture.jsx) — and confirms, which enrols the citizen in
 * citizen_biometrics for good (reused by every future service) and auto-approves the card.
 */
export default function NationalIdBiometricCapture() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [leftTemplate, setLeftTemplate] = useState(null);
  const [rightTemplate, setRightTemplate] = useState(null);
  const [scanKey, setScanKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [justCaptured, setJustCaptured] = useState(null);

  function load() {
    setLoadError('');
    api.get('/home-affairs/national-id/pending-biometric-captures')
      .then((d) => setRows(d.nationalIdCards))
      .catch((err) => setLoadError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, []);

  function startCapture(id) {
    setActiveId(id);
    setLeftTemplate(null);
    setRightTemplate(null);
    setScanKey((k) => k + 1);
    setError('');
  }

  function cancelCapture() {
    setActiveId(null);
    setLeftTemplate(null);
    setRightTemplate(null);
  }

  async function confirmCapture() {
    setError('');
    setBusy(true);
    try {
      await api.post(`/home-affairs/national-id/${activeId}/capture-biometrics`, {
        leftHandTemplate: leftTemplate, rightHandTemplate: rightTemplate,
      });
      setJustCaptured(activeId);
      cancelCapture();
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState icon="⚠" title={t('common.somethingWentWrong')} message={loadError} />
      </div>
    );
  }
  if (!rows) return <Loading />;

  const active = rows.find((r) => r.national_id_card_id === activeId);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('police.nationalIdBiometrics.title')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('police.nationalIdBiometrics.intro')}</p>

      {justCaptured && !active && (
        <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green">✓ {t('police.nationalIdBiometrics.captureSuccess')}</p>
      )}

      {active ? (
        <div className="card">
          <h2 className="mb-1 font-semibold text-slate-800">{active.first_name} {active.last_name}</h2>
          <p className="mb-4 text-xs text-slate-500">{formatDateOnly(active.date_of_birth)} · <span className="font-mono">{active.permanent_identity_number}</span></p>

          {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">{t('biometricCapture.leftHandLabel')}</p>
              {leftTemplate ? (
                <p className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-gov-green">✓ {t('police.handScanCaptured')}</p>
              ) : (
                <HandScan key={`left-${scanKey}`} onCapture={setLeftTemplate} />
              )}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">{t('biometricCapture.rightHandLabel')}</p>
              {rightTemplate ? (
                <p className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-gov-green">✓ {t('police.handScanCaptured')}</p>
              ) : (
                <HandScan key={`right-${scanKey}`} onCapture={setRightTemplate} />
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <button type="button" disabled={!leftTemplate || !rightTemplate || busy} className="btn-primary" onClick={confirmCapture}>
              {busy ? t('common.loading') : t('police.nationalIdBiometrics.confirmCapture')}
            </button>
            <button type="button" className="btn-secondary" onClick={cancelCapture}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon="🖐️" title={t('police.nationalIdBiometrics.emptyTitle')} message={t('police.nationalIdBiometrics.emptyMessage')} />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.national_id_card_id} className="card flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-800">{r.first_name} {r.last_name}</p>
                <p className="text-xs text-slate-500">{formatDateOnly(r.date_of_birth)} · <span className="font-mono">{r.permanent_identity_number}</span></p>
                {user.roleKey === 'system_administrator' && r.office_name && <p className="text-xs text-slate-400">{r.office_name}</p>}
              </div>
              <button type="button" className="btn-primary !py-1.5 !text-xs" onClick={() => startCapture(r.national_id_card_id)}>
                {t('police.nationalIdBiometrics.startCapture')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
