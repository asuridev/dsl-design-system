'use strict';

const en = require('../locales/en.json');
const es = require('../locales/es.json');

const DEFAULT_LOCALE = 'es';
const SUPPORTED_LOCALES = new Set(['es', 'en']);
const CATALOGS = { en, es };

function normalizeLocale(locale) {
  const value = String(locale || DEFAULT_LOCALE).toLowerCase();
  return SUPPORTED_LOCALES.has(value) ? value : DEFAULT_LOCALE;
}

function t(locale, key, params = {}) {
  const lang = normalizeLocale(locale);
  let text = (CATALOGS[lang] && CATALOGS[lang][key]) || en[key] || key;
  for (const [name, value] of Object.entries(params)) {
    text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
  }
  return text;
}

function clientI18nScript(locale) {
  return `
    <script>
      window.DSL_I18N = ${JSON.stringify({ locale: normalizeLocale(locale), catalogs: CATALOGS })};
      (function () {
        const state = window.DSL_I18N || { locale: 'es', catalogs: {} };
        const stored = localStorage.getItem('dsl-preview-locale');
        let current = state.catalogs[stored] ? stored : state.locale;
        function translate() {
          const catalog = state.catalogs[current] || state.catalogs.es || state.catalogs.en || {};
          document.documentElement.lang = current;
          document.querySelectorAll('[data-i18n]').forEach((el) => {
            const key = el.getAttribute('data-i18n');
            if (catalog[key]) el.textContent = catalog[key];
          });
          document.querySelectorAll('[data-i18n-title]').forEach((el) => {
            const key = el.getAttribute('data-i18n-title');
            if (catalog[key]) el.setAttribute('title', catalog[key]);
          });
          document.querySelectorAll('[data-locale]').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-locale') === current);
            btn.setAttribute('aria-pressed', btn.getAttribute('data-locale') === current ? 'true' : 'false');
          });
        }
        window.dslSetLocale = function (locale) {
          if (!state.catalogs[locale]) return;
          current = locale;
          localStorage.setItem('dsl-preview-locale', locale);
          translate();
        };
        window.dslT = function (key) {
          const catalog = state.catalogs[current] || state.catalogs.es || state.catalogs.en || {};
          return catalog[key] || key;
        };
        window.addEventListener('DOMContentLoaded', translate);
      })();
    <\/script>`;
}

function localeSwitcher(locale) {
  const lang = normalizeLocale(locale);
  return `
    <div class="btn-group btn-group-sm" role="group" aria-label="Language">
      <button type="button" class="btn btn-outline-light${lang === 'es' ? ' active' : ''}" data-locale="es" onclick="dslSetLocale('es')">ES</button>
      <button type="button" class="btn btn-outline-light${lang === 'en' ? ' active' : ''}" data-locale="en" onclick="dslSetLocale('en')">EN</button>
    </div>`;
}

// Inline <head> script that applies the persisted (or OS-preferred) theme to
// <html data-bs-theme> *before first paint* to avoid a flash of light theme,
// and exposes window.__dslPreviewTheme so Mermaid can initialize with the
// matching light/dark theme. Must be placed in <head>, after the Bootstrap CSS.
function themeBootScript() {
  return `
    <script>
      (function () {
        try {
          var stored = localStorage.getItem('dsl-preview-theme');
          var theme = (stored === 'dark' || stored === 'light')
            ? stored
            : ((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
          window.__dslPreviewTheme = theme;
          document.documentElement.setAttribute('data-bs-theme', theme);
        } catch (e) { window.__dslPreviewTheme = 'light'; }
      })();
    <\/script>`;
}

// Theme toggle button (light/dark). Mirrors localeSwitcher styling so it sits
// next to it in the dark navbars. The icon reflects the action: a moon in light
// mode (click → dark) and a sun in dark mode (click → light).
function themeSwitcher(locale) {
  const lang = normalizeLocale(locale);
  const title = t(lang, 'theme.toggle');
  return `
    <button type="button" class="btn btn-sm btn-outline-light" data-theme-toggle
      title="${title}" data-i18n-title="theme.toggle" aria-label="${title}" aria-pressed="false"
      onclick="dslToggleTheme()"><span data-theme-icon aria-hidden="true">&#127769;</span></button>`;
}

// Client runtime for the theme toggle: applies data-bs-theme instantly (Bootstrap
// recolors via CSS variables) and persists the choice. Pages with Mermaid reload
// so the diagrams re-render with the matching Mermaid theme (SVGs are themed at
// render time, not via CSS variables).
function clientThemeScript() {
  return `
    <script>
      (function () {
        var KEY = 'dsl-preview-theme';
        function resolve() {
          var s = localStorage.getItem(KEY);
          if (s === 'dark' || s === 'light') return s;
          return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
        }
        var current = window.__dslPreviewTheme || resolve();
        function syncButtons() {
          document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
            btn.setAttribute('aria-pressed', current === 'dark' ? 'true' : 'false');
            var icon = btn.querySelector('[data-theme-icon]');
            if (icon) icon.textContent = current === 'dark' ? '☀️' : '🌙';
          });
        }
        function applyTheme(theme) {
          current = theme;
          window.__dslPreviewTheme = theme;
          document.documentElement.setAttribute('data-bs-theme', theme);
          syncButtons();
        }
        window.dslToggleTheme = function () {
          var next = current === 'dark' ? 'light' : 'dark';
          localStorage.setItem(KEY, next);
          applyTheme(next);
          if (typeof mermaid !== 'undefined' && document.querySelector('.mermaid')) {
            location.reload();
          }
        };
        syncButtons();
        window.addEventListener('DOMContentLoaded', syncButtons);
      })();
    <\/script>`;
}

module.exports = {
  DEFAULT_LOCALE,
  normalizeLocale,
  t,
  clientI18nScript,
  localeSwitcher,
  themeBootScript,
  themeSwitcher,
  clientThemeScript,
};
