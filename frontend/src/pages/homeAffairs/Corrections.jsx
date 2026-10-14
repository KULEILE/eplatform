import React from 'react';
import CorrectionsPanel from '../../components/CorrectionsPanel';

const FIELDS = ['first_name', 'middle_name', 'last_name', 'place_of_birth', 'sex'];

export default function Corrections() {
  return (
    <CorrectionsPanel
      departmentKey="home_affairs"
      officerRoleKey="home_affairs_officer"
      titleKey="homeAffairs.correction"
      fields={FIELDS.map((f) => ({ name: f, label: f.replace(/_/g, ' ') }))}
    />
  );
}
