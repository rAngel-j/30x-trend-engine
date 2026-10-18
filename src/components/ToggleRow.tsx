"use client";

import type { KeyboardEvent, ReactNode } from "react";

/**
 * Cabecera de una fila desplegable. Es un div con role="button" (no un <button>) para poder
 * contener botones de ayuda sin anidar botones; responde a Enter y Espacio igual que un botón.
 */
export default function ToggleRow({
  expanded,
  controls,
  onToggle,
  className,
  children,
}: {
  expanded: boolean;
  controls: string;
  onToggle: () => void;
  className: string;
  children: ReactNode;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };
  return (
    <div role="button" tabIndex={0} aria-expanded={expanded} aria-controls={controls} onClick={onToggle} onKeyDown={onKeyDown} className={`cursor-pointer ${className}`}>
      {children}
    </div>
  );
}
