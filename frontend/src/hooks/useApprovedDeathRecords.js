import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

/**
 * Shared by BurialOrder.jsx and DeathCertificateRequest.jsx: both services require the citizen
 * to identify an already-approved death registration, and both key on the internal numeric
 * death_record_id when they look it up (see homeAffairsServices2.controller.js —
 * requestBurialOrder and requestDeathCertificate both run `WHERE death_record_id = $1`).
 *
 * Previously both forms asked the citizen to type that internal ID number directly into a plain
 * number box. There was no way for them to actually know it: the only thing the citizen is ever
 * shown for a death registration is its human-readable reference (e.g. "DR-..."), on
 * DeathRegistration.jsx — the raw death_record_id is never displayed anywhere. The field's own
 * help text ("The reference number of the approved death registration") made this worse by
 * implying they should type the reference they DO have, which isn't a valid value either.
 *
 * This hook fetches the citizen's own death registrations (GET /home-affairs/death-registration,
 * which already scopes the list to records they reported) and keeps only the ones a burial order
 * or death certificate request can actually attach to — status 'Approved' — so the form can offer
 * a dropdown of real options instead of a blind text box.
 *
 * Returns { options, loading }. `options` is ready to hand to a `type: 'select'` field: value is
 * the real death_record_id (as a string, matching how every other text/number field already
 * round-trips through this form system — see FieldInputs in ServiceWorkflowPage.jsx), label is
 * the deceased's name plus their real reference number.
 *
 * Officers have no personal death registrations to request a burial order or certificate for —
 * and calling the same GET endpoint as an officer returns the full department queue, not a
 * personal list — so this hook simply skips fetching for officer roles.
 */
export function useApprovedDeathRecords() {
  const { user } = useAuth();
  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(!isOfficer);

  useEffect(() => {
    if (isOfficer) { setLoading(false); return; }
    let cancelled = false;
    api.get('/home-affairs/death-registration')
      .then((d) => {
        if (cancelled) return;
        setRecords((d.deathRegistrations || []).filter((r) => r.status === 'Approved'));
      })
      .catch(() => { if (!cancelled) setRecords([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOfficer]);

  const options = records.map((r) => ({
    value: String(r.death_record_id),
    label: `${r.first_name} ${r.last_name} — ${r.registration_reference}`,
  }));

  return { options, loading };
}
