import React, { useEffect, useState } from 'react';
import { MapPinIcon, BuildingOffice2Icon } from '@heroicons/react/24/outline';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import FormField from './ui/FormField';

/**
 * District -> branch office picker. Lesotho is organised into ten districts, each with branch
 * offices; the citizen chooses one here at application time so they know, from the moment they
 * apply, exactly where they will collect the finished document.
 *
 * Controlled component: value = officeId (number|''), onChange(officeId).
 */
export default function DistrictOfficeSelect({ departmentKey, value, onChange, required = true }) {
  const { t } = useLanguage();
  const [districts, setDistricts] = useState(null);
  const [districtId, setDistrictId] = useState('');
  const [offices, setOffices] = useState(null);

  useEffect(() => { api.get('/districts').then((d) => setDistricts(d.districts)).catch(() => setDistricts([])); }, []);

  useEffect(() => {
    setOffices(null);
    if (!districtId) return;
    api.get(`/offices?departmentKey=${departmentKey}&districtId=${districtId}`)
      .then((d) => setOffices(d.offices))
      .catch(() => setOffices([]));
  }, [districtId, departmentKey]);

  const selectedOffice = offices?.find((o) => String(o.office_id) === String(value));

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        <MapPinIcon className="h-4 w-4 text-gov-navy" strokeWidth={1.75} />
        {t('offices.chooseBranchTitle')}
      </p>
      <p className="mb-3 text-xs text-slate-500">{t('offices.chooseBranchHelp')}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label={t('offices.district')} htmlFor="districtId" required={required}>
          <select
            id="districtId"
            className="form-input"
            value={districtId}
            onChange={(e) => { setDistrictId(e.target.value); onChange(''); }}
            disabled={!districts}
          >
            <option value="">{districts ? t('offices.selectDistrict') : t('common.loading')}</option>
            {districts?.map((d) => <option key={d.district_id} value={d.district_id}>{d.name}</option>)}
          </select>
        </FormField>

        <FormField label={t('offices.branch')} htmlFor="officeId" required={required}>
          <select
            id="officeId"
            className="form-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={!districtId || !offices || offices.length === 0}
          >
            <option value="">
              {!districtId ? t('offices.selectDistrictFirst') : !offices ? t('common.loading') : offices.length === 0 ? t('offices.noBranchesInDistrict') : t('offices.selectBranch')}
            </option>
            {offices?.map((o) => (
              <option key={o.office_id} value={o.office_id}>{o.name}{o.is_head_office ? ` (${t('offices.headOffice')})` : ''}</option>
            ))}
          </select>
        </FormField>
      </div>

      {selectedOffice && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-white px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
          <BuildingOffice2Icon className="mt-0.5 h-4 w-4 shrink-0 text-gov-navy" strokeWidth={1.75} />
          {t('offices.collectionNotice', { office: selectedOffice.address ? `${selectedOffice.name} — ${selectedOffice.address}` : selectedOffice.name })}
        </p>
      )}
    </div>
  );
}
