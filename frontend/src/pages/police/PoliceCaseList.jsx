import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import Modal from '../../components/ui/Modal';
import FormField from '../../components/ui/FormField';

const CASE_TYPES = ['Criminal Investigation', 'Traffic Offense', 'Domestic Violence', 'Cybercrime', 'Missing Person', 'Other'];

const STATUS_KIND = {
  'Open': 'warning',
  'Under Investigation': 'info',
  'Referred to Court': 'info',
  'Closed - Resolved': 'positive',
  'Closed - Unresolved': 'neutral',
};

/** Officer-only case management: open a case against a subject (looked up by permanent identity
 *  number if known, otherwise recorded by name only — see policeCase.controller.js's
 *  resolveSubject), then track it through to an arrest and/or sentence from the detail page.
 *  Deliberately a shared department-wide list (every officer sees every case), not a personal
 *  queue — this is investigative casework, not a per-officer inbox like the identity-verification
 *  lookup history. */
export default function PoliceCaseList() {
  const { t } = useLanguage();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ caseType: CASE_TYPES[0], offenseDescription: '', permanentIdentityNumber: '', subjectName: '' });

  function load() {
    api.get('/police/cases').then((d) => setRows(d.cases)).catch((err) => setError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, []);

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  function openModal() {
    setForm({ caseType: CASE_TYPES[0], offenseDescription: '', permanentIdentityNumber: '', subjectName: '' });
    setError('');
    setModalOpen(true);
  }

  async function submitCase() {
    setError('');
    setBusy(true);
    try {
      await api.post('/police/cases', form);
      setModalOpen(false);
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return <Loading />;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{t('police.cases.title')}</h1>
        <button type="button" className="btn-primary" onClick={openModal}>{t('police.cases.startCase')}</button>
      </div>
      {error && !modalOpen && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      <DataTable
        rowKey="case_id"
        rows={rows}
        emptyTitle={t('common.noResults')}
        columns={[
          { key: 'case_reference', header: t('police.cases.caseReference'), render: (r) => <span className="font-mono text-xs">{r.case_reference}</span> },
          { key: 'subject', header: t('police.cases.subject'), render: (r) => r.subject_name || '—' },
          { key: 'case_type', header: t('police.cases.caseType'), render: (r) => t(`police.cases.caseTypeOption.${r.case_type}`) },
          { key: 'status', header: t('police.cases.status'), render: (r) => <StatusBadge status={r.status} kind={STATUS_KIND[r.status]} /> },
          { key: 'arrests', header: t('police.cases.arrests'), render: (r) => r.arrest_count },
          { key: 'sentences', header: t('police.cases.sentences'), render: (r) => r.sentence_count },
          { key: 'actions', header: t('common.actions'), render: (r) => <Link to={`/police/cases/${r.case_id}`} className="text-sm font-medium text-gov-navy hover:underline">{t('common.view')}</Link> },
        ]}
      />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('police.cases.startCase')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>{t('common.cancel')}</button>
            <button type="button" disabled={busy || !form.offenseDescription.trim()} className="btn-primary" onClick={submitCase}>
              {busy ? t('common.loading') : t('police.cases.submitCase')}
            </button>
          </>
        }
      >
        {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
        <FormField label={t('police.cases.caseType')} htmlFor="caseType">
          <select id="caseType" className="form-input" value={form.caseType} onChange={(e) => update('caseType', e.target.value)}>
            {CASE_TYPES.map((ct) => <option key={ct} value={ct}>{t(`police.cases.caseTypeOption.${ct}`)}</option>)}
          </select>
        </FormField>
        <FormField label={t('police.cases.offenseDescription')} htmlFor="offenseDescription" required>
          <textarea id="offenseDescription" required rows={3} className="form-input" value={form.offenseDescription} onChange={(e) => update('offenseDescription', e.target.value)} />
        </FormField>
        <FormField label={t('police.cases.subjectIdentityNumber')} htmlFor="subjectPin" help={t('police.cases.subjectIdentityHelp')}>
          <input id="subjectPin" className="form-input" value={form.permanentIdentityNumber} onChange={(e) => update('permanentIdentityNumber', e.target.value)} />
        </FormField>
        <FormField label={t('police.cases.subjectName')} htmlFor="subjectName">
          <input id="subjectName" className="form-input" value={form.subjectName} onChange={(e) => update('subjectName', e.target.value)} />
        </FormField>
      </Modal>
    </div>
  );
}
