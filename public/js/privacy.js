// The privacy note shown in the info dialog. All text comes from i18n.
import { h, setChildren } from './dom.js';
import { t } from './i18n.js';

const CONTACT = 'rote-socke@posteo.de';
const OSMF_URL = 'https://osmfoundation.org/wiki/Privacy_Policy';
const CLOUDFLARE_URL = 'https://www.cloudflare.com/privacypolicy/';

const items = (prefix, count) => Array.from({ length: count }, (_, i) => h('li', {}, t(`${prefix}.${i + 1}`)));
const externalLink = (href, label) => h('a', { href, target: '_blank', rel: 'noopener' }, label);

export function renderPrivacy(body) {
  setChildren(body,
    h('div', { class: 'help' },
      h('p', {}, t('privacy.intro')),
      h('h3', {}, t('privacy.server')),
      h('ul', {}, items('privacy.server', 3)),
      h('h3', {}, t('privacy.location')),
      h('ul', {}, items('privacy.location', 3)),
      h('h3', {}, t('privacy.device')),
      h('p', {}, t('privacy.device.text')),
      h('h3', {}, t('privacy.services')),
      h('ul', {}, items('privacy.services', 3)),
      h('h3', {}, t('privacy.rights')),
      h('p', {}, t('privacy.rights.text')),
      h('p', { class: 'help-source' }, t('privacy.contact'), ' ', h('a', { href: `mailto:${CONTACT}` }, CONTACT)),
      h('ul', { class: 'help-links' },
        h('li', {}, externalLink(OSMF_URL, t('privacy.osmfLink'))),
        h('li', {}, externalLink(CLOUDFLARE_URL, t('privacy.cloudflareLink'))))));
}
