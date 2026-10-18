/**
 * Minimización de datos personales (restricción 08 del reto, docs/ARCHITECTURE.md §7b-ter).
 * El motor analiza piezas, no personas: se quitan menciones de cuentas y los prefijos
 * con el nombre del autor que añaden los buscadores ("Ana Pérez en LinkedIn: …").
 */

const HANDLE = /(^|[\s(])@[\w.]{2,30}/g;
const AUTHOR_PREFIX = /^(.{2,80}?)\s+(?:on|en|no)\s+(?:LinkedIn|Instagram|TikTok)\s*[:|•-]\s*/i;
const AUTHOR_PARENTHESIS = /^[^()]{2,80}\s*\(@[\w.]+\)\s*[•|:-]?\s*/;
const NETWORK_SUFFIX = /\s*[|•-]\s*(?:LinkedIn|Instagram|TikTok)\b.*$/i;
const PIPE_AUTHOR_SUFFIX = /\s*\|\s*[^|]{2,60}$/;

/** Reemplaza menciones @cuenta por "@cuenta" genérico. */
export function scrubHandles(text: string): string {
  return text.replace(HANDLE, "$1@cuenta");
}

/** Limpia un título indexado: sin prefijo de autor, sin sufijo de red y sin menciones. */
export function scrubIndexedTitle(title: string): string {
  // Primero el sufijo de la red ("• Instagram reel"), para que el patrón "Nombre (@cuenta)" quede al final y se elimine entero.
  const cleaned = title.replace(NETWORK_SUFFIX, "").replace(AUTHOR_PARENTHESIS, "").replace(AUTHOR_PREFIX, "").replace(PIPE_AUTHOR_SUFFIX, "");
  return scrubHandles(cleaned).trim();
}

/** Limpia un texto público (extracto, descripción, texto pegado) de menciones a cuentas. */
export function scrubText(text: string): string {
  return scrubHandles(text.replace(AUTHOR_PREFIX, "")).trim();
}
