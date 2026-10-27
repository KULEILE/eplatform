import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import Modal from '../../components/ui/Modal';

const STATUS_KIND = { Pending: 'warning', Approved: 'positive', Rejected: 'negative' };

/** Administrator-only approval queue for sentence correction requests (Batch 34 — "once the
 *  magistrate give suspect sentence and after officer record that sentence must not be updated
 *  by officer must require the administrator approval first"). An officer creates these from
 *  PoliceCaseDetail.jsx's "Request correction" button; nothing here ever lets an officer approve
 *  their own or anyone else's request — see the route guards in policeCase.controller.js's
 *  approveSentenceAmendment/rejectSentenceAmendment, which this page's buttons call. Approving
 *  applies the proposed change to the actual police_sentences row; rejecting leaves it exactly
 *  as it was, with a reason recorded for the requesting officer to see. */
export default function PoliceSentenceAmendments() {
  const { t } = useLanguage();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('Pending');
  const [busyId, setBusyId] = useState(null);
  const [modal, setModal] = useState(null); // { kind: 'approve' | 'reject', request }
  const [reviewNote, setReviewNote] = useState('');

  function load(status) {
    api.get(`/police/sentence-amendment-requests${status ? `?status=${status}` : ''}`)
      .then((d) => setRows(d.amendmentRequests))
      .catch((err) => setError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { setRows(null); load(statusFilter); }, [statusFilter]);

  async function runAction(request, action) {
    setBusyId(request.amendment_id);
    setError('');
    try {
      await api.post(`/police/sentence-amendment-requests/${request.amendment_id}/${action}`, { reviewNote: reviewNote.trim() || undefined });
      setModal(null); setReviewNote('');
      load(statusFilter);
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusyId(null);
    }
  }

  if (!rows) return <Loading />;

  return (
    <div>
      <Link to="/police" className="mb-4 inline-block text-sm font-medium text-gov-navy hover:underline">← {t('departments.police')}</Link>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('police.amendments.title')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('police.amendments.intro')}</p>

      <div className="mb-4 flex overflow-hidden rounded-md border border-slate-300 text-sm w-fit">
        {['Pending', 'Approved', 'Rejected', ''].map((s) => (
          <button key={s || 'all'} type="button" onClick={() => setStatusFilter(s)} className={`px-3 py-2 ${statusFilter === s ? 'bg-gov-navy text-white' : 'bg-white'}`}>
            {s ? t(`status.${s}`) : t('police.amendments.allStatuses')}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      <DataTable
        rowKey="amendment_id"
        rows={rows}
        emptyTitle={t('police.amendments.noRequests')}
        columns={[
          { key: 'case_reference', header: t('police.cases.caseReference'), render: (r) => <span className="font-mono text-xs">{r.case_reference}</span> },
          {
            key: 'current', header: t('police.amendments.currentValue'),
            render: (r) => <span>{t(`status.${r.current_outcome}`)}{r.current_sentence_details ? ` — ${r.current_sentence_details}` : ''}</span>,
          },
          {
            key: 'proposed', header: t('police.amendments.proposedValue'),
            render: (r) => <span>{t(`status.${r.proposed_outcome}`)}{r.proposed_sentence_details ? ` — ${r.proposed_sentence_details}` : ''}</span>,
          },
          { key: 'reason', header: t('police.amendments.reason'), render: (r) => <span className="text-xs text-slate-600">{r.reason}</span> },
          { key: 'requested_by', header: t('police.amendments.requestedBy'), render: (r) => r.requested_by_email || '—' },
          { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} kind={STATUS_KIND[r.status]} /> },
          {
            key: 'actions', header: t('common.actions'),
            render: (r) => r.status !== 'Pending' ? (
              <span className="text-xs text-slate-500">{r.review_note || '—'}</span>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busyId === r.amendment_id} className="btn-row-primary" onClick={() => { setModal({ kind: 'approve', request: r }); setReviewNote(''); setError(''); }}>
                  {t('police.amendments.approve')}
                </button>
                <button type="button" disabled={busyId === r.amendment_id} className="btn-row-danger" onClick={() => { setModal({ kind: 'reject', request: r }); setReviewNote(''); setError(''); }}>
                  {t('police.amendments.reject')}
                </button>
              </div>
            ),
          },
        ]}
      />

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.kind === 'approve' ? t('police.amendments.approve') : t('police.amendments.reject')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('common.cancel')}</button>
          <button
            type="button"
            className={modal?.kind === 'reject' ? 'btn-danger' : 'btn-primary'}
            disabled={busyId === modal?.request?.amendment_id || (modal?.kind === 'reject' && !reviewNote.trim())}
            onClick={() => runAction(modal.request, modal.kind)}
          >
            {t('common.confirm')}
          </button>
        </>}
      >
        {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
        <label htmlFor="reviewNote" className="form-label">{t('police.amendments.reviewNoteLabel')}</label>
        <p className="mb-1 text-xs text-slate-500">{modal?.kind === 'reject' ? t('police.amendments.reviewNoteRequiredHelp') : t('common.optional')}</p>
        <textarea id="reviewNote" className="form-input" rows={3} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
      </Modal>
    </div>
  );
}
