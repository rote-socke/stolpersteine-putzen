// UI language: German or English, chosen automatically and switchable in the group dialog.
// Stone data, group names and the manifest are not translated.
//
// Values are strings with {name} placeholders, or { one, other } objects for plurals
// (the plural form is picked with params.count).

const KEY = 'stolpersteine-putzen.lang';
export const LANGS = ['de', 'en'];

const de = {
  'meta.title': 'Stolpersteine putzen',
  'meta.description': 'Gemeinsam Stolpersteine in Stuttgart putzen: Karte, nächste offene Steine, wer wohin unterwegs ist.',
  'meta.appTitle': 'Steine putzen',
  'map.aria': 'Karte der Stolpersteine',
  'group.none': 'Keiner Gruppe beigetreten',
  'group.fallbackName': 'Eine Gruppe',
  'group.otherName': 'Eine andere Gruppe',
  'group.dialogTitle': 'Gruppe',
  'common.close': 'Schließen',
  'common.back': '‹ Zurück',
  'legend.toggle': 'Legende',
  'legend.open': 'Offen',
  'legend.own': 'Ihr seid unterwegs',
  'legend.other': 'Andere Gruppe unterwegs',
  'legend.cleaned': 'Geputzt',
  'legend.note': 'Mit Notiz',
  'legend.me': 'Dein Standort',
  'legend.mate': 'Mitglied deiner Gruppe',
  'legend.peer': 'Andere Gruppe',
  'locate.label': 'Mein Standort',

  'toast.searching': 'Standort wird gesucht …',
  'toast.denied': 'Standort nicht erlaubt. Du kannst ihn in den Browser-Einstellungen freigeben.',
  'toast.noGeolocation': 'Dein Gerät kann den Standort nicht bestimmen.',
  'toast.groupGone': 'Deine Gruppe ist nicht mehr gültig (gelöscht oder neuer Link erzeugt). Bitte den aktuellen QR-Code deiner Gruppe scannen.',
  'toast.reconnected': 'Wieder verbunden.',
  'toast.offline': 'Keine Verbindung. Du siehst den letzten bekannten Stand.',
  'toast.wrong': 'Etwas ist schiefgegangen. Bitte nochmal versuchen.',
  'toast.network': 'Keine Verbindung. Bitte gleich nochmal versuchen.',
  'toast.taken': '{name} ist schon unterwegs dorthin.',
  'toast.alreadyCleaned': 'Schon geputzt.',
  'toast.nameTaken': 'Diesen Gruppennamen gibt es schon.',
  'toast.forbidden': 'Das darf nur die Gruppe, die dorthin unterwegs ist.',
  'toast.notFound': 'Diesen Ort kennt der Server nicht.',
  'toast.badInput': 'Die Eingabe passt nicht. Bitte prüfen.',
  'toast.serverError': 'Fehler beim Server ({status}). Bitte nochmal versuchen.',
  'toast.noteSaved': 'Notiz gespeichert.',
  'toast.copied': 'Link kopiert.',
  'toast.copyManually': 'Bitte den Link markieren und kopieren.',
  'toast.shareFailed': 'Teilen hat nicht geklappt. Nutze „Link kopieren“.',
  'toast.left': 'Du hast die Gruppe verlassen.',
  'toast.nowNamed': 'Eure Gruppe heißt jetzt „{name}“.',
  'toast.alreadyNamed': 'Eure Gruppe heißt schon „{name}“.',
  'toast.orgaCodeWrong': 'Der Orga-Code stimmt nicht (mehr). Bitte neu eingeben.',
  'toast.orgaOn': 'Orga-Modus ist an.',
  'toast.orgaOff': 'Orga-Modus beendet.',
  'toast.groupCreated': 'Gruppe „{name}“ angelegt.',
  'toast.joined': 'Du bist jetzt in der Gruppe „{name}“.',
  'toast.renamed': 'Gruppe umbenannt.',
  'toast.newLink': 'Neuer Link erzeugt.',
  'toast.groupDeleted': 'Gruppe „{name}“ gelöscht.',
  'toast.joinOffline': 'Beitreten hat nicht geklappt: keine Verbindung. Lade die Seite gleich neu.',
  'toast.joinInvalid': 'Dieser Einladungslink ist nicht gültig. Bitte den QR-Code deiner Gruppe neu scannen.',
  'toast.loadFailed': 'Die Liste der Stolpersteine konnte nicht geladen werden. Bitte Seite neu laden.',
  'success.reserve': 'Eingetragen: Ihr seid unterwegs.',
  'success.release': 'Reservierung aufgehoben.',
  'success.clean': 'Als geputzt eingetragen. Danke!',
  'success.reopen': 'Wieder als offen eingetragen.',

  'confirm.switch': 'Ihr seid schon unterwegs zu {address}. Stattdessen hierhin gehen?',
  'confirm.reopen': 'Diesen Ort wieder als offen eintragen?',
  'confirm.leave': 'Gruppe „{name}“ auf diesem Handy verlassen? Du kannst nur über den QR-Code bzw. Einladungslink wieder beitreten.',
  'confirm.rotate': 'Neuen Link für „{name}“ erzeugen? Alte QR-Codes funktionieren dann nicht mehr.',
  'confirm.delete': 'Gruppe „{name}“ löschen? Geputzte Steine bleiben markiert.',
  'confirm.deleteWay': ' Eine laufende Reservierung wird freigegeben.',
  'prompt.rename': 'Neuer Name der Gruppe',

  'btn.navigation': 'Navigation',
  'btn.cleaned': 'Geputzt',
  'btn.cancel': 'Abbrechen',
  'btn.going': 'Wir gehen hin',
  'btn.undo': 'Rückgängig',
  'btn.useLocation': 'Meinen Standort nutzen',
  'btn.share': 'Teilen',
  'btn.dontShare': 'Nicht teilen',
  'btn.saveNote': 'Speichern',
  'btn.discardNote': 'Verwerfen',
  'btn.editNote': 'Notiz bearbeiten',
  'btn.addNote': 'Notiz hinzufügen',

  'sheet.toggleAria': 'Liste ein-/ausklappen: {title}',
  'share.askAria': 'Standort teilen',
  'share.askTitle': 'Standort mit den Gruppen teilen?',
  'share.askText': 'Andere Gruppen sehen, wo ihr seid – nur solange die App offen ist.',
  'home.onTheWay': 'Ihr seid unterwegs',
  'home.to': 'Zu ',
  'home.next': 'Nächste offene Steine',
  'home.joinHint': 'Zum Mitmachen den QR-Code deiner Gruppe scannen.',
  'home.originCenter': 'Nach Entfernung zur Kartenmitte',
  'home.originStale': 'Nach Entfernung zum letzten bekannten Standort',
  'home.originYou': 'Nach Entfernung zu dir',
  'home.none': 'Keine offenen Steine mehr. Danke für eure Arbeit.',
  'stones.summary': { one: '{count} Stein · {names}', other: '{count} Steine · {names}' },
  'status.own': 'Ihr seid unterwegs',
  'status.other': '{name} ist unterwegs',
  'status.cleaned': 'Geputzt von {name} am {when}',
  'status.open': 'Offen',
  'note.label': 'Notiz: ',
  'note.aria': 'Notiz',

  'invite.text': 'Andere scannen diesen Code mit der Handykamera und sind dann in eurer Gruppe.',
  'invite.qrAlt': 'QR-Code zum Beitreten',
  'invite.shareTitle': 'Stolpersteine putzen: {name}',
  'invite.shareText': 'Tritt der Gruppe {name} bei:',
  'invite.linkAria': 'Einladungslink',
  'invite.share': 'Link teilen',
  'invite.copy': 'Link kopieren',
  'share.switch': 'Meinen Standort teilen',
  'share.note': 'Deine Position ist nur für Mitglieder von Gruppen und die Orga sichtbar, solange die App geöffnet ist. Es wird nur die letzte Position gespeichert, höchstens 10 Minuten lang, ohne Verlauf.',
  'install.button': 'App installieren',
  'install.stepsIosSafari': 'Tippe in Safari auf das Teilen-Symbol (Quadrat mit Pfeil nach oben, evtl. im „…“-Menü) und dann auf „Zum Home-Bildschirm“.',
  'install.stepsIosOther': 'Tippe auf das Teilen-Symbol (in der Adressleiste oder im Menü) und dann auf „Zum Home-Bildschirm“. Fehlt der Eintrag, öffne die Seite in Safari.',
  'install.stepsOther': 'Öffne das Browser-Menü und wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“.',
  'dialog.member': 'Du bist in dieser Gruppe.',
  'dialog.setName': 'Gruppennamen festlegen',
  'dialog.leave': 'Gruppe verlassen',
  'dialog.viewOnly': 'Ohne Gruppe kannst du die Karte nur ansehen. Den Code hat jemand aus deiner Gruppe oder die Orga.',
  'lang.label': 'Sprache',

  'naming.title': 'Wie soll eure Gruppe heißen?',
  'naming.placeholder': 'z. B. Neckarputzer',
  'naming.taken': 'Den Namen gibt es schon.',
  'naming.label': 'Gruppenname',
  'naming.warning': 'Der Name kann danach nicht mehr geändert werden – nur noch von der Orga.',
  'naming.submit': 'Namen festlegen',
  'naming.later': 'Später',

  'orga.title': 'Organisation',
  'orga.code': 'Orga-Code',
  'orga.intro': 'Mit dem Orga-Code legst du Gruppen an und verwaltest ihre Einladungen.',
  'orga.continue': 'Weiter',
  'orga.progressCannstatt': 'Cannstatter Adressen geputzt',
  'orga.progressAll': 'Adressen insgesamt geputzt',
  'orga.progressCount': '{done} von {total}',
  'orga.noGroups': 'Noch keine Gruppen.',
  'orga.newGroup': 'Neue Gruppe anlegen',
  'orga.groupName': 'Name der Gruppe (optional)',
  'orga.groupPlaceholder': 'z. B. Gruppe A',
  'orga.nameHint': 'Leer lassen: die Gruppe gibt sich beim Beitreten selbst einen Namen.',
  'orga.createGroup': 'Gruppe anlegen',
  'orga.end': 'Orga-Modus beenden',
  'orga.cleanedCount': '{count} geputzt',
  'orga.wayTo': 'unterwegs zu {address}',
  'orga.invite': 'Einladen',
  'orga.join': 'Beitreten',
  'orga.rename': 'Umbenennen',
  'orga.rotate': 'Neuen Link erzeugen',
  'orga.delete': 'Löschen',
  'orga.backToOrga': '‹ Zurück zur Organisation',
  'help.button': 'Putzanleitung',
  'help.title': 'So putzt ihr Stolpersteine',
  'help.bring': 'Mitnehmen',
  'help.bring.1': 'Abwaschschwamm mit rauer Seite',
  'help.bring.2': 'Messingputzmittel aus dem Drogeriemarkt',
  'help.bring.3': 'Küchenpapier oder ein Tuch',
  'help.bring.4': 'Eine Flasche Wasser',
  'help.steps': 'So geht\'s',
  'help.step.1': 'Groben Schmutz mit einem feuchten (nicht nassen) Lappen entfernen.',
  'help.step.2': 'Putzmittel mit dem Schwamm einreiben. Milchige Mittel sparsam auf den Lappen geben, nicht direkt auf den Stein – sonst bleiben weiße Ränder im Pflaster.',
  'help.step.3': 'Kurz einwirken lassen.',
  'help.step.4': 'Nach ein paar Minuten kräftig polieren, dann alle Reste gründlich mit Wasser abspülen.',
  'help.step.5': 'Abtrocknen und prüfen, dass kein Putzmittel im Pflaster zurückbleibt.',
  'help.dark': 'Sehr dunkle Steine',
  'help.dark.text': '½ l Essigessenz, ½ l Wasser und 2 TL Salz mischen, einreiben und gut mit Wasser nachwischen. Glänzt der Stein dann noch nicht, mit normalem Messingputzmittel weitermachen.',
  'help.warnTitle': 'Wichtig',
  'help.warn': 'Keine Drahtbürsten oder anderen harten Gegenstände – sie zerkratzen das Messing.',
  'help.source': 'Quelle: Putzanleitung der Stiftung Spuren – Gunter Demnig',
  'help.pdf': 'Vollständige Anleitung (PDF)',
  'help.web': 'Mehr auf stolpersteine.eu',
};

const en = {
  'meta.title': 'Cleaning Stolpersteine',
  'meta.description': 'Clean Stolpersteine in Stuttgart together: map, nearest open stones, who is heading where.',
  'meta.appTitle': 'Cleaning stones',
  'map.aria': 'Map of the Stolpersteine',
  'group.none': 'Not in a group',
  'group.fallbackName': 'A group',
  'group.otherName': 'Another group',
  'group.dialogTitle': 'Group',
  'common.close': 'Close',
  'common.back': '‹ Back',
  'legend.toggle': 'Legend',
  'legend.open': 'Open',
  'legend.own': "You're on your way",
  'legend.other': 'Another group on its way',
  'legend.cleaned': 'Cleaned',
  'legend.note': 'With note',
  'legend.me': 'Your location',
  'legend.mate': 'Member of your group',
  'legend.peer': 'Another group',
  'locate.label': 'My location',

  'toast.searching': 'Finding your location …',
  'toast.denied': 'Location not allowed. You can allow it in your browser settings.',
  'toast.noGeolocation': "Your device can't determine its location.",
  'toast.groupGone': 'Your group is no longer valid (deleted or a new link was created). Please scan your group’s current QR code.',
  'toast.reconnected': 'Back online.',
  'toast.offline': "No connection. You're seeing the last known state.",
  'toast.wrong': 'Something went wrong. Please try again.',
  'toast.network': 'No connection. Please try again in a moment.',
  'toast.taken': '{name} is already on its way there.',
  'toast.alreadyCleaned': 'Already cleaned.',
  'toast.nameTaken': 'That group name already exists.',
  'toast.forbidden': 'Only the group that is on its way there can do this.',
  'toast.notFound': "The server doesn't know this place.",
  'toast.badInput': "That input doesn't fit. Please check it.",
  'toast.serverError': 'Server error ({status}). Please try again.',
  'toast.noteSaved': 'Note saved.',
  'toast.copied': 'Link copied.',
  'toast.copyManually': 'Please select the link and copy it.',
  'toast.shareFailed': 'Sharing failed. Use “Copy link”.',
  'toast.left': 'You left the group.',
  'toast.nowNamed': 'Your group is now called “{name}”.',
  'toast.alreadyNamed': 'Your group is already called “{name}”.',
  'toast.orgaCodeWrong': 'The organizer code is wrong (or no longer valid). Please enter it again.',
  'toast.orgaOn': 'Organizer mode is on.',
  'toast.orgaOff': 'Organizer mode ended.',
  'toast.groupCreated': 'Group “{name}” created.',
  'toast.joined': "You're now in the group “{name}”.",
  'toast.renamed': 'Group renamed.',
  'toast.newLink': 'New link created.',
  'toast.groupDeleted': 'Group “{name}” deleted.',
  'toast.joinOffline': "Couldn't join: no connection. Reload the page in a moment.",
  'toast.joinInvalid': 'This invite link is not valid. Please scan your group’s QR code again.',
  'toast.loadFailed': "Couldn't load the list of Stolpersteine. Please reload the page.",
  'success.reserve': "Saved: you're on your way.",
  'success.release': 'Reservation cancelled.',
  'success.clean': 'Marked as cleaned. Thank you!',
  'success.reopen': 'Marked as open again.',

  'confirm.switch': "You're already on your way to {address}. Go here instead?",
  'confirm.reopen': 'Mark this place as open again?',
  'confirm.leave': 'Leave the group “{name}” on this phone? You can only rejoin via the QR code or invite link.',
  'confirm.rotate': 'Create a new link for “{name}”? Old QR codes will stop working.',
  'confirm.delete': 'Delete the group “{name}”? Cleaned stones stay marked.',
  'confirm.deleteWay': ' A current reservation will be released.',
  'prompt.rename': 'New name of the group',

  'btn.navigation': 'Navigation',
  'btn.cleaned': 'Cleaned',
  'btn.cancel': 'Cancel',
  'btn.going': "We're going",
  'btn.undo': 'Undo',
  'btn.useLocation': 'Use my location',
  'btn.share': 'Share',
  'btn.dontShare': "Don't share",
  'btn.saveNote': 'Save',
  'btn.discardNote': 'Discard',
  'btn.editNote': 'Edit note',
  'btn.addNote': 'Add note',

  'sheet.toggleAria': 'Expand/collapse list: {title}',
  'share.askAria': 'Share location',
  'share.askTitle': 'Share your location with the groups?',
  'share.askText': 'Other groups see where you are – only while the app is open.',
  'home.onTheWay': "You're on your way",
  'home.to': 'To ',
  'home.next': 'Nearest open stones',
  'home.joinHint': "To take part, scan your group's QR code.",
  'home.originCenter': 'By distance to the map centre',
  'home.originStale': 'By distance to your last known location',
  'home.originYou': 'By distance to you',
  'home.none': 'No open stones left. Thank you for your work.',
  'stones.summary': { one: '{count} stone · {names}', other: '{count} stones · {names}' },
  'status.own': "You're on your way",
  'status.other': '{name} is on its way',
  'status.cleaned': 'Cleaned by {name} on {when}',
  'status.open': 'Open',
  'note.label': 'Note: ',
  'note.aria': 'Note',

  'invite.text': 'Others scan this code with their phone camera and are then in your group.',
  'invite.qrAlt': 'QR code to join',
  'invite.shareTitle': 'Cleaning Stolpersteine: {name}',
  'invite.shareText': 'Join the group {name}:',
  'invite.linkAria': 'Invite link',
  'invite.share': 'Share link',
  'invite.copy': 'Copy link',
  'share.switch': 'Share my location',
  'share.note': 'Your position is only visible to group members and the organizers, while the app is open. Only the latest position is stored, for 10 minutes at most, with no history.',
  'install.button': 'Install app',
  'install.stepsIosSafari': 'In Safari, tap the Share icon (square with an arrow pointing up, possibly in the “…” menu), then “Add to Home Screen”.',
  'install.stepsIosOther': 'Tap the Share icon (in the address bar or the menu), then “Add to Home Screen”. If it is missing, open the page in Safari.',
  'install.stepsOther': 'Open the browser menu and choose “Install app” or “Add to Home screen”.',
  'dialog.member': "You're in this group.",
  'dialog.setName': 'Choose group name',
  'dialog.leave': 'Leave group',
  'dialog.viewOnly': 'Without a group you can only view the map. Someone in your group or the organizers have the code.',
  'lang.label': 'Language',

  'naming.title': 'What should your group be called?',
  'naming.placeholder': 'e.g. Neckar Cleaners',
  'naming.taken': 'That name already exists.',
  'naming.label': 'Group name',
  'naming.warning': "The name can't be changed afterwards – only by the organizers.",
  'naming.submit': 'Set name',
  'naming.later': 'Later',

  'orga.title': 'Organizers',
  'orga.code': 'Organizer code',
  'orga.intro': 'With the organizer code you create groups and manage their invitations.',
  'orga.continue': 'Continue',
  'orga.progressCannstatt': 'Cannstatt addresses cleaned',
  'orga.progressAll': 'addresses cleaned in total',
  'orga.progressCount': '{done} of {total}',
  'orga.noGroups': 'No groups yet.',
  'orga.newGroup': 'Create new group',
  'orga.groupName': 'Group name (optional)',
  'orga.groupPlaceholder': 'e.g. Group A',
  'orga.nameHint': 'Leave empty: the group picks its own name when it joins.',
  'orga.createGroup': 'Create group',
  'orga.end': 'End organizer mode',
  'orga.cleanedCount': '{count} cleaned',
  'orga.wayTo': 'on the way to {address}',
  'orga.invite': 'Invite',
  'orga.join': 'Join',
  'orga.rename': 'Rename',
  'orga.rotate': 'Create new link',
  'orga.delete': 'Delete',
  'orga.backToOrga': '‹ Back to organizers',
  'help.button': 'Cleaning guide',
  'help.title': 'How to clean Stolpersteine',
  'help.bring': 'What to bring',
  'help.bring.1': 'A dish sponge with a rough side',
  'help.bring.2': 'Brass polish from a drugstore',
  'help.bring.3': 'Paper towels or a cloth',
  'help.bring.4': 'A bottle of water',
  'help.steps': 'How it works',
  'help.step.1': 'Remove coarse dirt with a damp (not wet) cloth.',
  'help.step.2': 'Rub in the polish with the sponge. Put milky polishes sparingly on the cloth, not directly on the stone – otherwise white marks stay in the paving.',
  'help.step.3': 'Let it work briefly.',
  'help.step.4': 'After a few minutes, polish vigorously, then rinse off all residue thoroughly with water.',
  'help.step.5': 'Dry the stone and check that no polish is left in the paving.',
  'help.dark': 'Very dark stones',
  'help.dark.text': 'Mix ½ l vinegar essence, ½ l water and 2 teaspoons of salt, rub it in and wipe thoroughly with water. If the stone still doesn\'t shine, continue with regular brass polish.',
  'help.warnTitle': 'Important',
  'help.warn': 'No wire brushes or other hard tools – they scratch the brass.',
  'help.source': 'Source: cleaning guide by Stiftung Spuren – Gunter Demnig',
  'help.pdf': 'Full guide (PDF, German)',
  'help.web': 'More on stolpersteine.eu (German)',
};

export const dictionaries = { de, en };

/** Pure: 'de' if any entry has primary subtag de, else 'en'. */
export function detectLang(languages) {
  for (const tag of languages ?? []) {
    if (typeof tag === 'string' && tag.split(/[-_]/)[0].toLowerCase() === 'de') return 'de';
  }
  return 'en';
}

function storedLang() {
  try {
    const v = localStorage.getItem(KEY);
    return LANGS.includes(v) ? v : null;
  } catch {
    return null; // storage blocked: automatic choice
  }
}

let current = null;
const listeners = new Set();

export function getLang() {
  if (current) return current;
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const languages = nav?.languages?.length ? nav.languages : [nav?.language];
  current = storedLang() ?? detectLang(languages);
  return current;
}

export function setLang(lang) {
  if (!LANGS.includes(lang)) return;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* private mode: the choice lasts only for this page view */
  }
  if (lang === current) return;
  current = lang;
  applyStatic();
  for (const fn of listeners) fn(lang);
}

/** Calls fn(lang) after every language change; returns a function that removes it. */
export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** BCP 47 tag for Intl formatting. */
export const intlLocale = () => (getLang() === 'de' ? 'de-DE' : 'en-GB');

const rules = {};

export function t(key, params = {}) {
  const lang = getLang();
  let msg = dictionaries[lang][key] ?? dictionaries.en[key] ?? key;
  if (typeof msg === 'object') {
    rules[lang] ??= new Intl.PluralRules(lang);
    msg = msg[rules[lang].select(params.count ?? 0)] ?? msg.other;
  }
  return msg.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

/** Applies data-i18n, data-i18n-aria-label, data-i18n-title and data-i18n-content to the page. */
export function applyStatic(root) {
  if (typeof document === 'undefined') return;
  root ??= document;
  document.documentElement.lang = getLang();
  document.title = t('meta.title');
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const attr of ['aria-label', 'title', 'content']) {
    const data = `i18n-${attr}`;
    for (const el of root.querySelectorAll(`[data-${data}]`)) {
      el.setAttribute(attr, t(el.getAttribute(`data-${data}`)));
    }
  }
}

applyStatic();
