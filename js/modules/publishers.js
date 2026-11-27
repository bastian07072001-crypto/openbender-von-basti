/**
 * Herausgeber, deren Modul-Lizenzen OpenBender anerkennt.
 *
 * Pro Herausgeber nur der ÖFFENTLICHE Schlüssel (JWK, ECDSA P-256). Der
 * private Schlüssel bleibt beim Herausgeber und gehört nie in die App.
 * Eintragen: Lizenz-Werkzeug → „Neues Schlüsselpaar“ → angezeigten
 * öffentlichen Schlüssel hier einfügen. Siehe docs/module.md, „Lizenzen“.
 *
 * Beispiel:
 *   'bau-blech': {
 *       name: 'Bau-Blech Bühler GmbH',
 *       publicKey: { kty: 'EC', crv: 'P-256', x: '…', y: '…' }
 *   }
 */
export const PUBLISHERS = {
};
