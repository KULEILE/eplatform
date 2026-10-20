import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';

/** Police Information Requests (service #12): "Ask about procedures, requirements, office
 *  locations and service hours." Most of that is genuinely static reference content — this page
 *  carries it directly rather than routing every such question through an officer — plus the
 *  real, current list of Police offices (reusing the existing GET /offices?departmentKey=police
 *  endpoint every other department's office picker already uses) and a link to the Information
 *  Request form for anything this page doesn't answer. */
export default function PoliceInformation() {
  const { t } = useLanguage();
  const [offices, setOffices] = useState(null);

  useEffect(() => {
    api.get('/offices?departmentKey=police').then((d) => setOffices(d.offices)).catch(() => setOffices([]));
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('police.information.title')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('police.information.intro')}</p>

      <div className="card mb-6">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">{t('police.information.proceduresTitle')}</h2>
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-slate-800">{t('police.information.procedure1Title')}</h3>
            <p className="text-sm text-slate-600">{t('police.information.procedure1Body')}</p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">{t('police.information.procedure2Title')}</h3>
            <p className="text-sm text-slate-600">{t('police.information.procedure2Body')}</p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">{t('police.information.procedure3Title')}</h3>
            <p className="text-sm text-slate-600">{t('police.information.procedure3Body')}</p>
          </div>
        </div>
      </div>

      <div className="card mb-6">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">{t('police.information.officesTitle')}</h2>
        <p className="mb-3 text-sm text-slate-500">{t('police.information.officesIntro')}</p>
        {!offices ? (
          <Loading />
        ) : offices.length === 0 ? (
          <p className="text-sm text-slate-500">{t('police.information.noOffices')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {offices.map((o) => (
              <li key={o.office_id} className="py-2">
                <p className="font-medium text-slate-900">{o.name}{o.is_head_office ? ' ★' : ''}</p>
                <p className="text-sm text-slate-500">{o.district_name}{o.address ? ` · ${o.address}` : ''}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">{t('police.information.askTitle')}</h2>
        <p className="mb-3 text-sm text-slate-500">{t('police.information.askIntro')}</p>
        <Link to="/police/information-request" className="btn-primary">{t('police.reports.information.title')}</Link>
      </div>
    </div>
  );
}
