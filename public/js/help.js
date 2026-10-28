// The "how to clean" guide shown in the help dialog. All text comes from i18n.
import { h, setChildren } from './dom.js';
import { t } from './i18n.js';

const PDF_URL = 'https://www.stolpersteine.eu/assets/Putzanleitung_STOLPERSTEINE_2019.pdf';
const WEB_URL = 'https://www.stolpersteine.eu/wissenwertes/stolpersteine-reinigen';

const numbered = (prefix, count) => Array.from({ length: count }, (_, i) => h('li', {}, t(`${prefix}.${i + 1}`)));
const externalLink = (href, label) => h('a', { href, target: '_blank', rel: 'noopener' }, label);

export function renderHelp(body) {
  setChildren(body,
    h('div', { class: 'help' },
      h('h3', {}, t('help.bring')),
      h('ul', {}, numbered('help.bring', 4)),
      h('h3', {}, t('help.steps')),
      h('ol', {}, numbered('help.step', 5)),
      h('h3', {}, t('help.dark')),
      h('p', {}, t('help.dark.text')),
      h('div', { class: 'help-warn', role: 'note' },
        h('strong', {}, t('help.warnTitle')),
        h('p', {}, t('help.warn'))),
      h('p', { class: 'help-source muted' }, t('help.source')),
      h('ul', { class: 'help-links' },
        h('li', {}, externalLink(PDF_URL, t('help.pdf'))),
        h('li', {}, externalLink(WEB_URL, t('help.web'))))));
}
