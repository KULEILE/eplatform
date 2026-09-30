import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import FormField from '../components/ui/FormField';
import DistrictOfficeSelect from '../components/DistrictOfficeSelect';

const DEPARTMENTS = ['home_affairs', 'traffic', 'finance', 'pensions', 'police', 'passport'];
const PURPOSES = ['Identity Enrolment', 'Biometric Capture', 'Document Collection', 'Physical Verification'];

/**
 * Booking an in-person appointment — including, optionally, one with a sign-language
 * interpreter or another accommodation arranged ahead of time. This isn't a separate
 * "disability" pathway: any citizen can book any of these appointments for any reason, and
 * the accommodation fields are just optional extras any of them can add.
 */
export default function AppointmentApply() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [departmentKey, setDepartmentKey] = useState('home_affairs');
  const [officeId, setOfficeId] = useState('');
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('');
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [needsInterpreter, setNeedsInterpreter] = useState(false);
  const [interpreterLanguage, setInterpreterLanguage] = useState('');
  const [accommodationNotes, setAccommodationNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (!officeId) { setError(t('offices.chooseBranchRequired')); return; }
    setBusy(true);
    try {
      await api.post('/appointments', {
        departmentKey, officeId, appointmentDate, appointmentTime, purpose,
        needsInterpreter, interpreterLanguage: needsInterpreter ? interpreterLanguage : '', accommodationNotes,
      });
      navigate('/appointments');
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('appointments.applyTitle')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t('appointments.applyIntro')}</p>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      <form onSubmit={onSubmit} className="card" noValidate>
        <FormField label={t('appointments.department')} htmlFor="departmentKey" required>
          <select id="departmentKey" className="form-input" value={departmentKey} onChange={(e) => { setDepartmentKey(e.target.value); setOfficeId(''); }}>
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{t(`departments.${d}`)}</option>)}
          </select>
        </FormField>

        <FormField label={t('appointments.purpose')} htmlFor="purpose" required help={t('appointments.purposeHelp')}>
          <select id="purpose" className="form-input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {PURPOSES.map((p) => <option key={p} value={p}>{t(`appointments.purposeOption.${p}`)}</option>)}
          </select>
        </FormField>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={t('appointments.preferredDate')} htmlFor="appointmentDate" required>
            <input id="appointmentDate" type="date" required className="form-input" value={appointmentDate} onChange={(e) => setAppointmentDate(e.target.value)} />
          </FormField>
          <FormField label={t('appointments.preferredTime')} htmlFor="appointmentTime" required>
            <input id="appointmentTime" type="time" required className="form-input" value={appointmentTime} onChange={(e) => setAppointmentTime(e.target.value)} />
          </FormField>
        </div>

        <DistrictOfficeSelect departmentKey={departmentKey} value={officeId} onChange={setOfficeId} />

        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <label className="flex items-start gap-2 text-sm font-medium text-slate-800">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={needsInterpreter}
              onChange={(e) => setNeedsInterpreter(e.target.checked)}
            />
            {t('appointments.needsInterpreterLabel')}
          </label>
          <p className="mt-1 text-xs text-slate-500">{t('appointments.needsInterpreterHelp')}</p>

          {needsInterpreter && (
            <FormField label={t('appointments.interpreterLanguage')} htmlFor="interpreterLanguage" help={t('appointments.interpreterLanguageHelp')}>
              <input
                id="interpreterLanguage"
                className="form-input"
                placeholder={t('appointments.interpreterLanguagePlaceholder')}
                value={interpreterLanguage}
                onChange={(e) => setInterpreterLanguage(e.target.value)}
              />
            </FormField>
          )}

          <FormField label={t('appointments.accommodationNotes')} htmlFor="accommodationNotes" help={t('appointments.accommodationNotesHelp')}>
            <textarea
              id="accommodationNotes"
              rows={3}
              className="form-input"
              value={accommodationNotes}
              onChange={(e) => setAccommodationNotes(e.target.value)}
            />
          </FormField>
        </div>

        <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? t('common.loading') : t('appointments.submit')}</button>
      </form>
    </div>
  );
}
