import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import FormField from './ui/FormField';
import DocumentCapture from './DocumentCapture';

/**
 * One parent's identity details on a birth certificate application (see migration 059 and
 * homeAffairs.controller.js's processBirthCertificateApplication). Every parent is either:
 *   - a Lesotho citizen — their permanent identity number is typed and checked automatically
 *     against the citizens register (reject if it doesn't match), or
 *   - not a citizen — a passport number and a photo of the passport are recorded instead, since
 *     there is no register of foreign passports this system can check against.
 * At least one parent on the application must be a matched citizen — this component doesn't
 * enforce that itself (the two parent blocks don't know about each other), the backend does.
 *
 * Shared by BirthRegistrationApply.jsx (a logged-in parent registering their child) and
 * BirthCertificateApplication.jsx (the public, no-login application) so both stay consistent.
 *
 * Controlled: `value` = { name, nationality, isCitizen, identityNumber, passportNumber,
 * passportImageReference }. onChange(nextValue).
 */
export default function ParentIdentityFields({ role, value, onChange, idPrefix }) {
  const { t } = useLanguage();
  const v = value || { name: '', nationality: 'Mosotho', isCitizen: true, identityNumber: '', passportNumber: '', passportImageReference: '' };

  function set(patch) { onChange({ ...v, ...patch }); }

  return (
    <div>
      <FormField label={t(`homeAffairs.birthRegistrationForm.${role}Name`)} htmlFor={`${idPrefix}-name`} required>
        <input id={`${idPrefix}-name`} required className="form-input" value={v.name} onChange={(e) => set({ name: e.target.value })} />
      </FormField>
      <FormField label={t(`homeAffairs.birthRegistrationForm.${role}Nationality`)} htmlFor={`${idPrefix}-nationality`}>
        <input id={`${idPrefix}-nationality`} className="form-input" value={v.nationality} onChange={(e) => set({ nationality: e.target.value })} />
      </FormField>

      <FormField label={t('homeAffairs.birthRegistrationForm.isCitizen')} htmlFor={`${idPrefix}-isCitizen`}>
        <select
          id={`${idPrefix}-isCitizen`}
          className="form-input"
          value={v.isCitizen ? 'yes' : 'no'}
          onChange={(e) => set({ isCitizen: e.target.value === 'yes' })}
        >
          <option value="yes">{t('homeAffairs.birthRegistrationForm.isCitizenYes')}</option>
          <option value="no">{t('homeAffairs.birthRegistrationForm.isCitizenNo')}</option>
        </select>
      </FormField>

      {v.isCitizen ? (
        <FormField
          label={t('homeAffairs.birthRegistrationForm.identityNumber')}
          htmlFor={`${idPrefix}-identityNumber`}
          required
          help={t('homeAffairs.birthRegistrationForm.identityNumberHelp')}
        >
          <input id={`${idPrefix}-identityNumber`} required className="form-input" value={v.identityNumber} onChange={(e) => set({ identityNumber: e.target.value })} />
        </FormField>
      ) : (
        <>
          <FormField label={t('homeAffairs.birthRegistrationForm.passportNumber')} htmlFor={`${idPrefix}-passportNumber`} required>
            <input id={`${idPrefix}-passportNumber`} required className="form-input" value={v.passportNumber} onChange={(e) => set({ passportNumber: e.target.value })} />
          </FormField>
          <DocumentCapture
            label={t('homeAffairs.birthRegistrationForm.passportPhoto')}
            value={v.passportImageReference}
            onChange={(ref) => set({ passportImageReference: ref })}
            required
          />
        </>
      )}
    </div>
  );
}
