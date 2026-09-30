import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import Loading from '../components/ui/Loading';
import EmptyState from '../components/ui/EmptyState';

const TYPE_ICON = {
  'Application Submitted': '📨', 'Verification': '🔎', 'Missing Information': '⚠',
  'Status Change': '🔄', 'Approval': '✅', 'Rejection': '✕', 'Ready for Collection': '📦',
  'Collection Reminder': '⏰', 'Processing Delay': '⏳', 'System': 'ℹ',
};

export default function Notifications() {
  const { t } = useLanguage();
  const [notifications, setNotifications] = useState(null);

  async function load() {
    const data = await api.get('/notifications');
    setNotifications(data.notifications);
  }
  useEffect(() => { load(); }, []);

  async function markRead(id) {
    await api.post(`/notifications/${id}/read`);
    load();
  }
  async function markAllRead() {
    await api.post('/notifications/read-all');
    load();
  }

  if (!notifications) return <Loading />;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{t('notifications.title')}</h1>
        {notifications.length > 0 && (
          <button type="button" onClick={markAllRead} className="btn-secondary text-sm">{t('notifications.markAllRead')}</button>
        )}
      </div>

      {notifications.length === 0 ? (
        <EmptyState icon="🔔" title={t('notifications.empty')} />
      ) : (
        <ul className="space-y-3">
          {notifications.map((n) => (
            <li key={n.notification_id} className={`card flex items-start gap-3 ${!n.is_read ? 'border-l-4 border-l-gov-navy' : ''}`}>
              <span className="text-xl" aria-hidden="true">{TYPE_ICON[n.notification_type] || 'ℹ'}</span>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-slate-900">{n.title}</p>
                  <time className="whitespace-nowrap text-xs text-slate-400">{new Date(n.created_at).toLocaleString()}</time>
                </div>
                <p className="mt-1 text-sm text-slate-600">{n.message}</p>
                <div className="mt-2 flex items-center gap-3">
                  {n.related_application_id && (
                    <Link to={`/applications/${n.related_application_id}`} className="text-xs font-medium text-gov-navy hover:underline">{t('common.viewDetails')}</Link>
                  )}
                  {!n.is_read && (
                    <button type="button" onClick={() => markRead(n.notification_id)} className="text-xs font-medium text-slate-500 hover:underline">Mark as read</button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
