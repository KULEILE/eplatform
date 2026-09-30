import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BellIcon, ChevronDownIcon, UserCircleIcon, AdjustmentsHorizontalIcon,
  ArrowRightOnRectangleIcon, Cog6ToothIcon, BuildingLibraryIcon, Squares2X2Icon, DocumentTextIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useAccessibility } from '../../context/AccessibilityContext';
import { useSystemSettings } from '../../context/SystemSettingsContext';
import { api } from '../../api/client';
import LesothoFlag from '../ui/LesothoFlag';

function useClickOutside(onOutside) {
  const ref = useRef(null);
  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onOutside(); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onOutside]);
  return ref;
}

function NavItem({ to, icon: Icon, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-white/15 text-white' : 'text-white/85 hover:bg-white/10 hover:text-white'}`
      }
    >
      {Icon && <Icon className="h-4 w-4" strokeWidth={1.75} />}
      {children}
    </NavLink>
  );
}

export default function Header() {
  const { user, logout } = useAuth();
  const { t, language, setLanguage } = useLanguage();
  const { fontSize, setFontSize, fontSizes, contrast, setContrast, brightness, setBrightness } = useAccessibility();
  const { settings, logoUrl } = useSystemSettings();
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [a11yOpen, setA11yOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const menuRef = useClickOutside(() => setMenuOpen(false));
  const a11yRef = useClickOutside(() => setA11yOpen(false));

  useEffect(() => {
    let cancelled = false;
    if (user) {
      api.get('/notifications').then((d) => { if (!cancelled) setUnread(d.unreadCount || 0); }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [user, location.pathname]);

  const fontStep = (delta) => {
    const idx = fontSizes.indexOf(fontSize);
    const next = fontSizes[Math.min(fontSizes.length - 1, Math.max(0, idx + delta))];
    setFontSize(next);
  };

  return (
    <header className="shadow-header">
      <a href="#main-content" className="skip-link">Skip to main content</a>

      {/* Top utility bar */}
      <div className="border-b border-white/10 bg-gov-navyDark text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-xs">
          <div className="flex items-center gap-2 font-medium">
            <LesothoFlag className="h-3.5 w-6 rounded-sm ring-1 ring-white/20" />
            <span>{t('common.kingdomOfLesotho')}</span>
          </div>
          <div className="flex items-center gap-4 text-white/80">
            <a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white hover:underline">{t('common.help')}</a>
            <a href="#" onClick={(e) => e.preventDefault()} className="hidden hover:text-white hover:underline sm:inline">{t('common.aboutUs')}</a>
            <a href="#" onClick={(e) => e.preventDefault()} className="hidden hover:text-white hover:underline sm:inline">{t('common.contact')}</a>
            <div className="flex overflow-hidden rounded border border-white/25">
              {['en', 'st'].map((lng) => (
                <button
                  key={lng}
                  type="button"
                  onClick={() => setLanguage(lng)}
                  aria-pressed={language === lng}
                  className={`px-2 py-0.5 font-semibold ${language === lng ? 'bg-white text-gov-navy' : 'text-white hover:bg-white/10'}`}
                >
                  {lng === 'en' ? t('common.englishLabel') : t('common.sesothoLabel')}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main bar */}
      <div className="bg-hero-gradient bg-gov-navy text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to={user ? '/dashboard' : '/'} className="flex items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="h-10 w-10 rounded-md bg-white object-contain p-1" />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-white text-gov-navy" aria-hidden="true">
                <BuildingLibraryIcon className="h-6 w-6" strokeWidth={1.75} />
              </span>
            )}
            <span className="leading-tight">
              <span className="block text-base font-bold sm:text-lg">{settings.system_name || t('common.appNameFallback')}</span>
              <span className="hidden text-[11px] font-medium tracking-wide text-white/70 sm:block">{t('common.systemTagline')}</span>
            </span>
          </Link>

          {user && (
            <nav className="order-3 flex w-full flex-wrap gap-1 border-t border-white/10 pt-2 sm:order-none sm:w-auto sm:border-0 sm:pt-0" aria-label="Primary">
              <NavItem to="/dashboard" icon={Squares2X2Icon}>{t('nav.dashboard')}</NavItem>
              <NavItem to="/departments" icon={BuildingLibraryIcon}>{t('nav.departments')}</NavItem>
              <NavItem to="/applications" icon={DocumentTextIcon}>{t('nav.applications')}</NavItem>
              <NavItem to="/appointments" icon={CalendarDaysIcon}>{t('nav.appointments')}</NavItem>
              <NavItem to="/notifications" icon={BellIcon}>
                {t('nav.notifications')}
                {unread > 0 && <span className="ml-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-gov-red px-1 text-[10px] font-bold text-white">{unread}</span>}
              </NavItem>
            </nav>
          )}

          <div className="flex items-center gap-2">
            {/* Accessibility dropdown */}
            <div className="relative" ref={a11yRef}>
              <button
                type="button"
                onClick={() => setA11yOpen((o) => !o)}
                aria-expanded={a11yOpen}
                className="flex items-center gap-1.5 rounded-md border border-white/25 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
              >
                <AdjustmentsHorizontalIcon className="h-4 w-4" strokeWidth={1.75} />
                <span className="hidden sm:inline">{t('accessibility.title')}</span>
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </button>
              {a11yOpen && (
                <div className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-3 text-slate-800 shadow-lg">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('accessibility.textSize')}</p>
                  <div className="mb-3 flex items-center overflow-hidden rounded-md border border-slate-300">
                    <button type="button" onClick={() => fontStep(-1)} aria-label="Decrease text size" className="flex-1 px-2 py-1.5 text-sm font-bold hover:bg-slate-50">A−</button>
                    <span className="px-2 text-xs text-slate-500">{fontSize}</span>
                    <button type="button" onClick={() => fontStep(1)} aria-label="Increase text size" className="flex-1 px-2 py-1.5 text-sm font-bold hover:bg-slate-50">A+</button>
                  </div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('accessibility.contrast')}</p>
                  <button
                    type="button"
                    onClick={() => setContrast(contrast === 'Normal' ? 'High' : 'Normal')}
                    aria-pressed={contrast === 'High'}
                    className="mb-3 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-left text-sm font-medium hover:bg-slate-50"
                  >
                    ◐ {t(`accessibility.${contrast.toLowerCase()}`)}
                  </button>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('accessibility.brightness')}</p>
                  <select
                    aria-label={t('accessibility.brightness')}
                    value={brightness}
                    onChange={(e) => setBrightness(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-medium"
                  >
                    <option value="Low">☀ {t('accessibility.low')}</option>
                    <option value="Normal">☀ {t('accessibility.normal')}</option>
                    <option value="High">☀ {t('accessibility.high')}</option>
                  </select>

                  <Link
                    to="/appointments/apply"
                    onClick={() => setA11yOpen(false)}
                    className="mt-3 block rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-medium text-gov-navy hover:bg-slate-100"
                  >
                    {t('accessibility.bookInterpreterAppointment')}
                  </Link>
                </div>
              )}
            </div>

            {user ? (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-expanded={menuOpen}
                  className="flex items-center gap-1.5 rounded-full border border-white/25 bg-white/5 py-1 pl-1.5 pr-2.5 text-sm font-medium text-white hover:bg-white/10"
                >
                  <UserCircleIcon className="h-6 w-6" strokeWidth={1.5} />
                  <span className="hidden sm:inline">{user.email.split('@')[0]}</span>
                  <ChevronDownIcon className="h-3.5 w-3.5" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 z-20 mt-2 w-52 rounded-lg border border-slate-200 bg-white py-1 text-slate-800 shadow-lg">
                    <Link to="/profile" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm hover:bg-slate-50">{t('nav.profile')}</Link>
                    <Link to="/settings" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-50">
                      <Cog6ToothIcon className="h-4 w-4" strokeWidth={1.75} />{t('nav.settings')}
                    </Link>
                    {user.roleKey === 'system_administrator' && (
                      <Link to="/admin" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm hover:bg-slate-50">{t('nav.admin')}</Link>
                    )}
                    {user.roleKey === 'branch_admin' && (
                      <Link to="/branch/users" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm hover:bg-slate-50">{t('nav.manageEmployees')}</Link>
                    )}
                    <button
                      type="button"
                      onClick={async () => { setMenuOpen(false); await logout(); navigate('/login'); }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gov-red hover:bg-slate-50"
                    >
                      <ArrowRightOnRectangleIcon className="h-4 w-4" strokeWidth={1.75} />{t('nav.logout')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link to="/login" className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-gov-navy shadow-sm hover:bg-slate-100">
                <UserCircleIcon className="h-4 w-4" strokeWidth={1.75} />
                {t('nav.loginRegister')}
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
