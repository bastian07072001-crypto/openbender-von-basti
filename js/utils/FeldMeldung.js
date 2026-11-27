/**
 * Fehlermeldung direkt beim betroffenen Eingabefeld statt oben am Rand:
 * Feld rot umrandet, darunter eine kleine Sprechblase. Verschwindet, sobald
 * im Feld weitergetippt wird, das Feld verlassen wird oder nach einigen Sekunden.
 *
 *   FeldMeldung.zeigen(inputEl, 'Länge muss mindestens 1 mm betragen.');
 */
export class FeldMeldung {
    static zeigen(feld, text, dauer = 5000) {
        if (!feld || !feld.isConnected) return;
        FeldMeldung.entfernen(feld);

        const blase = document.createElement('div');
        blase.className = 'feld-meldung';
        blase.setAttribute('role', 'alert');
        blase.textContent = text;
        document.body.appendChild(blase);

        // unter das Feld setzen, im Fenster halten
        const r = feld.getBoundingClientRect();
        const breite = blase.offsetWidth;
        const links = Math.max(8, Math.min(r.left, window.innerWidth - breite - 8));
        let oben = r.bottom + 6;
        if (oben + blase.offsetHeight > window.innerHeight - 8) {
            oben = r.top - blase.offsetHeight - 6;   // kein Platz unten: darüber
            blase.classList.add('oben');
        }
        blase.style.left = `${links}px`;
        blase.style.top = `${oben}px`;
        blase.style.setProperty('--pfeil-x', `${Math.max(10, Math.min(breite - 16, r.left + 14 - links))}px`);

        feld.classList.add('feld-fehler');
        feld.setAttribute('aria-invalid', 'true');

        const weg = () => FeldMeldung.entfernen(feld);
        const timer = setTimeout(weg, dauer);
        feld.addEventListener('input', weg, { once: true });
        feld.addEventListener('blur', weg, { once: true });
        feld._feldMeldung = { blase, timer, weg };
        requestAnimationFrame(() => blase.classList.add('sichtbar'));
    }

    static entfernen(feld) {
        const m = feld && feld._feldMeldung;
        if (!m) return;
        clearTimeout(m.timer);
        feld.removeEventListener('input', m.weg);
        feld.removeEventListener('blur', m.weg);
        m.blase.remove();
        feld.classList.remove('feld-fehler');
        feld.removeAttribute('aria-invalid');
        delete feld._feldMeldung;
    }
}
