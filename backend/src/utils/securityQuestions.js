// The fixed list of security questions a citizen can choose from at registration (exactly two,
// see auth.controller.js). Only the `key` is ever sent to or stored by the backend — the actual
// question wording lives in the frontend's locale files (frontend/src/locales/en.json and
// st.json, under auth.securityQuestions.<key>) so it can be shown in the citizen's own language,
// the same pattern already used elsewhere in this project for fixed option lists (e.g. the
// special-reason choices that used to exist on Special Marriage Licence). Keep this list and the
// locale keys in sync — add/remove a question in both places together.
const SECURITY_QUESTION_KEYS = [
  'mothersMaidenName',
  'firstSchool',
  'childhoodNickname',
  'firstPetName',
  'birthVillage',
  'favoriteTeacher',
];

module.exports = { SECURITY_QUESTION_KEYS };
