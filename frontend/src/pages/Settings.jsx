import React from 'react';
import { Link } from 'react-router-dom';
import { KeyIcon } from '@heroicons/react/24/outline';
import { useLanguage } from '../context/LanguageContext';
import { useAccessibility } from '../context/AccessibilityContext';

function OptionGroup({ label, options, value, onChange, translate }) {
  return (
    <div className="mb-6">
      <p className="form-label">{label}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            aria-pressed={value === opt}
            onClick={() => onChange(opt)}
            className={`rounded-md border px-4 py-2 text-sm font-medium ${value === opt ? 'border-gov-navy bg-gov-navy text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            {translate ? translate(opt) : opt}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Settings() {
  const { t, language, setLanguage } = useLanguage();
  const { fontSize, setFontSize, fontSizes, contrast, setContrast, contrasts, brightness, setBrightness, brightnesses } = useAccessibility();

  const fontLabel = (v) => t(`accessibility.${v.toLowerCase().replace(' ', '')}`) !== `accessibility.${v.toLowerCase().replace(' ', '')}` ? t(`accessibility.${v.toLowerCase().replace(' ', '')}`) : v;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{t('nav.settings')}</h1>

      <div className="card mb-4">
        <OptionGroup
          label={t('accessibility.language')}
          options={['en', 'st']}
          value={language}
          onChange={setLanguage}
          translate={(v) => (v === 'en' ? t('common.englishLabel') : t('common.sesothoLabel'))}
        />
        <OptionGroup label={t('accessibility.textSize')} options={fontSizes} value={fontSize} onChange={setFontSize} translate={fontLabel} />
        <OptionGroup label={t('accessibility.contrast')} options={contrasts} value={contrast} onChange={setContrast} translate={(v) => t(`accessibility.${v.toLowerCase()}`)} />
        <OptionGroup label={t('accessibility.brightness')} options={brightnesses} value={brightness} onChange={setBrightness} translate={(v) => t(`accessibility.${v.toLowerCase()}`)} />
      </div>

      <p className="mb-6 text-sm text-slate-500">
        These same controls are also available at any time from the header at the top of every page.
      </p>

      <div className="card">
        <Link to="/change-password" className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-gov-navy"><KeyIcon className="h-5 w-5" strokeWidth={1.75} /></span>
          <span>
            <span className="block text-sm font-semibold text-slate-900">{t('auth.changePasswordTitle')}</span>
            <span className="block text-xs text-slate-500">{t('auth.changePasswordSubtitle')}</span>
          </span>
        </Link>
      </div>
    </div>
  );
}
