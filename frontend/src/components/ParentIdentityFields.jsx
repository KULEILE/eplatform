import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import FormField from './ui/FormField';
import DocumentCapture from './DocumentCapture';

/**
 * One parent's identity details on a birth certificate application (see migration 061 and
 * homeAffairs.controller.js's processBirthCertificateApplication/resolveParentDetails). A parent
 * is either fully "Present" — a Lesotho citizen (their permanent identity number is typed and
 * checked automatically against the citizens register) or a non-citizen (a passport number and
 * photo recorded instead) — or carries one of four declared statuses instead, each asking for
 * less:
 *   - Unknown  — nothing at all; the applicant genuinely does not know who this parent is.
 *   - Absent   — just a name, if known; nothing verified.
 *   - Inactive — this parent IS a real citizen, they just have no portal account to reach — name
 *                + identity number are still required and checked, same as "Present".
 *   - Deceased — name required; identity number optional (if given, it's checked against our
 *                deceased records).
 * At least one parent on the application must end up a matched citizen — this component doesn't
 * enforce that itself (the two parent blocks don't know about each other), the backend does.
 *
 * Shared by BirthRegistrationApply.jsx (a logged-in parent registering their child) and
 * BirthCertificateApplication.jsx (the public, no-login self-application, where these fields
 * describe the applicant's OWN parents) so both stay consistent.
 *
 * Controlled: `value` = { name, nationality, isCitizen, identityNumber, passportNumber,
 * passportImageReference, declaredStatus }. onChange(nextValue).
 */
export default function ParentIdentityFields({ role, value, onChange, idPrefix }) {
  const { t } = useLanguage();
  const v = value || { name: '', nationality: 'Mosotho', isCitizen: true, identityNumber: '', passportNumber: '', passportImageReference: '', declaredStatus: '' };
  const declaredStatus = v.declaredStatus || '';

  function set(patch) { onChange({ ...v, ...patch }); }

  function handleStatusChange(nextStatus) {
    // Switching to a declared status clears the fields that no longer apply, so a stale value
    // from "Present" never gets silently submitted alongside a status that ignores it.
    if (nextStatus === 'Unknown') {
      set({ declaredStatus: nextStatus, name: '', identityNumber: '', passportNumber: '', passportImageReference: '' });
    } else if (nextStatus === 'Absent') {
      set({ declaredStatus: nextStatus, identityNumber: '', passportNumber: '', passportImageReference: '' });
    } else if (nextStatus === 'Inactive' || nextStatus === 'Deceased') {
      set({ declaredStatus: nextStatus, passportNumber: '', passportImageReference: '' });
    } else {
      set({ declaredStatus: '' });
    }
  }

  return (
    <div>
      <FormField label={t('homeAffairs.birthRegistrationForm.parentStatus')} htmlFor={`${idPrefix}-status`}>
        <select id={`${idPrefix}-status`} className="form-input" value={declaredStatus} onChange={(e) => handleStatusChange(e.target.value)}>
          <option value="">{t('homeAffairs.birthRegistrationForm.parentStatusPresent')}</option>
          <option value="Unknown">{t('homeAffairs.birthRegistrationForm.parentStatusUnknown')}</option>
          <option value="Absent">{t('homeAffairs.birthRegistrationForm.parentStatusAbsent')}</option>
          <option value="Inactive">{t('homeAffairs.birthRegistrationForm.parentStatusInactive')}</option>
          <option value="Deceased">{t('homeAffairs.birthRegistrationForm.parentStatusDeceased')}</option>
        </select>
      </FormField>

      {declaredStatus === 'Unknown' && (
        <p className="mb-4 text-sm text-slate-500">{t('homeAffairs.birthRegistrationForm.parentStatusUnknownHelp')}</p>
      )}

      {declaredStatus === 'Absent' && (
        <FormField label={t(`homeAffairs.birthRegistrationForm.${role}Name`)} htmlFor={`${idPrefix}-name`} help={t('homeAffairs.birthRegistrationForm.parentStatusAbsentHelp')}>
          <input id={`${idPrefix}-name`} className="form-input" value={v.name} onChange={(e) => set({ name: e.target.value })} />
        </FormField>
      )}

      {(declaredStatus === 'Inactive' || declaredStatus === 'Deceased') && (
        <>
          <FormField label={t(`homeAffairs.birthRegistrationForm.${role}Name`)} htmlFor={`${idPrefix}-name`} required>
            <input id={`${idPrefix}-name`} required className="form-input" value={v.name} onChange={(e) => set({ name: e.target.value })} />
          </FormField>
          <FormField
            label={t('homeAffairs.birthRegistrationForm.identityNumber')}
            htmlFor={`${idPrefix}-identityNumber`}
            required={declaredStatus === 'Inactive'}
            help={declaredStatus === 'Deceased' ? t('homeAffairs.birthRegistrationForm.parentStatusDeceasedHelp') : t('homeAffairs.birthRegistrationForm.identityNumberHelp')}
          >
            <input id={`${idPrefix}-identityNumber`} required={declaredStatus === 'Inactive'} className="form-input" value={v.identityNumber} onChange={(e) => set({ identityNumber: e.target.value })} />
          </FormField>
        </>
      )}

      {!declaredStatus && (
        <>
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
        </>
      )}
    </div>
  );
}
