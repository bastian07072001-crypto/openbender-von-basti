import { PUBLISHERS } from './publishers.js';

/**
 * Lizenzschlüssel für kostenpflichtige Module.
 *
 * Aufbau:  OB1.<Daten>.<Signatur>   (beide Teile base64url)
 *
 *   Daten     JSON { v: 1, publisher, product, licensee, issued, expires }
 *             publisher = Herausgeber-ID (siehe publishers.js)
 *             product   = Modul-ID, für das die Lizenz gilt
 *             licensee  = Lizenznehmer (Firma / Name), wird angezeigt
 *             issued    = Ausstellungsdatum 'JJJJ-MM-TT'
 *             expires   = Ablaufdatum 'JJJJ-MM-TT' oder null (unbefristet)
 *   Signatur  ECDSA P-256 / SHA-256 über den Text des Daten-Teils
 *             (base64url-Zeichen), 64 Bytes r‖s wie von WebCrypto geliefert
 *
 * Erstellt werden Schlüssel mit dem Lizenz-Werkzeug ausserhalb der App
 * (privater Schlüssel des Herausgebers). Die App kennt nur die öffentlichen
 * Schlüssel der Herausgeber (publishers.js) und prüft offline.
 *
 * Wichtig: Im Browser lässt sich jede Prüfung durch Ändern des Codes
 * umgehen. Die Lizenz ist eine Hürde gegen einfaches Weitergeben, kein
 * Kopierschutz. Der Lizenznehmer wird sichtbar angezeigt (Module-Dialog,
 * auf Wunsch des Moduls auch im PDF).
 */
export const LICENSE_PREFIX = 'OB1';

const keyCache = new Map();

export function base64UrlToBytes(text) {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
    const bin = atob(b64);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
}

export function bytesToBase64Url(bytes) {
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function publicKeyFor(publisherId) {
    const publisher = PUBLISHERS[publisherId];
    if (!publisher) return null;
    if (!keyCache.has(publisherId)) {
        keyCache.set(publisherId, crypto.subtle.importKey(
            'jwk', publisher.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']));
    }
    return keyCache.get(publisherId);
}

/** Datum 'JJJJ-MM-TT' von heute (lokale Zeit). */
function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Prüft einen Lizenzschlüssel für ein Modul.
 * required = { publisher, product } aus dem Modul (manifest.license)
 * Ergebnis: { valid, reason, licensee, expires, publisherName }
 */
export async function verifyLicense(key, required) {
    const fail = (reason) => ({ valid: false, reason, licensee: '', expires: null, publisherName: '' });
    const text = String(key || '').trim().replace(/\s+/g, '');
    if (!text) return fail('Kein Lizenzschlüssel eingegeben');

    const parts = text.split('.');
    if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) return fail('Kein gültiger Lizenzschlüssel (Format)');

    let data;
    try {
        data = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
    } catch (e) {
        return fail('Lizenzschlüssel ist beschädigt');
    }

    if (data.publisher !== required.publisher) return fail('Lizenz stammt von einem anderen Herausgeber');
    if (data.product !== required.product) return fail(`Lizenz gilt für ein anderes Modul („${data.product}“)`);

    const publicKey = await publicKeyFor(data.publisher);
    if (!publicKey) return fail(`Herausgeber „${data.publisher}“ ist in dieser OpenBender-Version nicht hinterlegt`);

    let ok = false;
    try {
        ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await publicKey,
            base64UrlToBytes(parts[2]), new TextEncoder().encode(parts[1]));
    } catch (e) {
        ok = false;
    }
    if (!ok) return fail('Signatur ungültig – Schlüssel wurde verändert oder ist falsch');

    if (data.expires && data.expires < todayIso()) {
        return { ...fail(`Lizenz ist am ${data.expires} abgelaufen`), licensee: String(data.licensee || ''), expires: data.expires };
    }

    return {
        valid: true,
        reason: '',
        licensee: String(data.licensee || ''),
        expires: data.expires || null,
        publisherName: PUBLISHERS[data.publisher].name
    };
}
