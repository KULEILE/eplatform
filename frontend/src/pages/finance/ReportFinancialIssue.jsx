import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import FormField from '../../components/ui/FormField';

const DEPARTMENTS = ['home_affairs', 'traffic', 'finance', 'pensions', 'police', 'passport'];

/**
 * ONE shared "Report a Financial Issue" page covering every department (settled design — "to
 * avoid many change", a single page with a department dropdown rather than a new tile added to
 * every department's hub). A Department Finance Administrator switched to the chosen department
 * picks this up first; if it lacks the authority to resolve it, it escalates to Finance — see
 * DeptFinanceIssues.jsx. Submissions are indexed into the existing "My Applications" tracker
 * (reference "FI-..."), so no separate tracking page was needed here either.
 */
export default function ReportFinancialIssue() {
  const { t } = useLanguage();
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({ departmentKey: '', subject: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(null);

  useEffect(() => { api.get('/departments').then((d) => setDepartments(d.departments)); }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await api.post('/financial-issues', form);
      setSubmitted(result);
      setForm({ departmentKey: '', subject: '', description: '' });
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('finance.reportIssue.title')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('finance.reportIssue.intro')}</p>

      {submitted && (
        <div className="card mb-6 border-2 border-emerald-200 bg-emerald-50">
          <p className="text-sm font-semibold text-emerald-800">{t('finance.reportIssue.submittedTitle')}</p>
          <p className="mt-1 text-sm text-emerald-700">{t('finance.reportIssue.submittedHelp', { reference: submitted.reference })}</p>
          <Link to="/applications" className="mt-3 inline-block text-sm font-medium text-gov-navy hover:underline">{t('dashboard.trackApplication')} →</Link>
        </div>
      )}

      <form onSubmit={submit} className="card">
        {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

        <FormField label={t('admin.department')} htmlFor="departmentKey" required help={t('finance.reportIssue.departmentHelp')}>
          <select id="departmentKey" required className="form-input" value={form.departmentKey} onChange={(e) => setForm((f) => ({ ...f, departmentKey: e.target.value }))}>
            <option value="">{t('admin.selectDepartment')}</option>
            {departments.filter((d) => DEPARTMENTS.includes(d.department_key)).map((d) => (
              <option key={d.department_key} value={d.department_key}>{d.name}</option>
            ))}
          </select>
        </FormField>

        <FormField label={t('finance.reportIssue.subjectLabel')} htmlFor="subject" required>
          <input id="subject" required maxLength={160} className="form-input" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
        </FormField>

        <FormField label={t('finance.reportIssue.descriptionLabel')} htmlFor="description" required help={t('finance.reportIssue.descriptionHelp')}>
          <textarea id="description" required rows={5} className="form-input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </FormField>

        <button type="submit" disabled={busy} className="btn-primary">{busy ? t('common.loading') : t('finance.reportIssue.submit')}</button>
      </form>
    </div>
  );
}
