/**
 * Minimización de datos personales (restricción 08 del reto, docs/ARCHITECTURE.md §7b-ter).
 * El motor analiza piezas, no personas: se quitan correos, teléfonos, enlaces (suelen apuntar a perfiles),
 * menciones de cuentas y los prefijos con el nombre del autor que añaden los buscadores.
 */

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)[^\s)>\]]+/gi;
// Teléfonos: 9+ dígitos con separadores opcionales y prefijo internacional opcional.
const PHONE = /(?<![\w])\+?\d(?:[\s().-]*\d){8,}(?![\w])/g;
const HANDLE = /@[\w.]{2,30}/g;
const AUTHOR_PREFIX = /^(.{2,80}?)\s+(?:on|en|no)\s+(?:LinkedIn|Instagram|TikTok)\s*[:|•-]\s*/i;
const AUTHOR_PARENTHESIS = /^[^()]{2,80}\s*\(@[\w.]+\)\s*[•|:-]?\s*/;
const NETWORK_SUFFIX = /\s*[|•-]\s*(?:LinkedIn|Instagram|TikTok)\b.*$/i;
const PIPE_AUTHOR_SUFFIX = /\s*\|\s*[^|]{2,60}$/;
const BARE_NETWORK = /^(?:LinkedIn|Instagram|TikTok|YouTube)(?:\s+(?:reel|post|video|photo))?$/i;

/** Reemplaza menciones @cuenta (también pegadas al texto) por "@cuenta" genérico. */
export function scrubHandles(text: string): string {
  return text.replace(HANDLE, "@cuenta");
}

/** Quita correos, teléfonos, enlaces y menciones. El orden importa: los correos antes que las menciones. */
export function scrubContacts(text: string): string {
  return scrubHandles(text.replace(EMAIL, "[correo]").replace(URL_IN_TEXT, "[enlace]").replace(PHONE, "[teléfono]"));
}

/** Limpia un título indexado: sin prefijo de autor, sin sufijo de red y sin datos de contacto. */
export function scrubIndexedTitle(title: string): string {
  // Primero el sufijo de la red ("• Instagram reel"), para que el patrón "Nombre (@cuenta)" quede al final y se elimine entero.
  const cleaned = title.replace(NETWORK_SUFFIX, "").replace(AUTHOR_PARENTHESIS, "").replace(AUTHOR_PREFIX, "").replace(PIPE_AUTHOR_SUFFIX, "");
  const result = scrubContacts(cleaned).trim();
  // Un título que solo dice "Instagram" no describe la pieza: mejor vacío, para usar el texto.
  return BARE_NETWORK.test(result) ? "" : result;
}

/** Limpia un texto público (extracto, descripción, texto pegado). */
export function scrubText(text: string): string {
  return scrubContacts(text.replace(AUTHOR_PREFIX, "")).trim();
}
