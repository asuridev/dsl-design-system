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

module.exports = {
  DEFAULT_LOCALE,
  normalizeLocale,
  t,
  clientI18nScript,
  localeSwitcher,
};
