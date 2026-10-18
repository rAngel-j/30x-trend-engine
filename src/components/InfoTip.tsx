"use client";

import { CircleHelp } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Ayuda contextual: un "?" que abre una explicación corta. Se cierra con Escape o al hacer clic fuera. */
export default function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={`¿Qué es ${label}?`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex text-ceniza hover:text-carbon"
      >
        <CircleHelp className="size-3.5" aria-hidden />
      </button>
      {open && (
        <span
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          className="absolute top-6 right-0 z-30 w-72 rounded-xl border border-arena bg-crema p-3 text-left text-xs leading-relaxed font-normal text-carbon shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  );
}

/** Textos de ayuda compartidos. */
export const HELP = {
  jev: (
    <>
      <strong className="font-semibold">Score JEV (0-100):</strong> qué tanto le sirve la pieza a la audiencia del perfil. Mientras más alto, mejor.
      Pondera <em>impacto en negocio</em> (40 %), <em>aplicable sin un gran equipo técnico</em> (35 %) y <em>claridad</em> (25 %). Desde 55 se generan guiones.
    </>
  ),
  outlier: (
    <>
      <strong className="font-semibold">Outlier:</strong> cuántas veces superó la pieza el promedio de vistas de su propio canal. ×1 = lo normal para esa cuenta;
      ×10 = el tema o el gancho multiplicó su rendimiento. Es un cálculo nuestro con datos de YouTube.
    </>
  ),
  stage: (
    <>
      <strong className="font-semibold">Etapa:</strong> 🌱 emergente (acelera en inglés, casi nada en español), 🚀 despegando (momento ideal para publicar),
      🔥 saturada (ya todos lo copiaron: solo con un ángulo contrarian).
    </>
  ),
  growth: (
    <>
      <strong className="font-semibold">Esta semana / anterior:</strong> piezas del tema publicadas en los últimos 7 días frente a los 7 previos. En LinkedIn,
      Instagram y TikTok se mide hasta la fecha que ya cubre el índice de búsqueda.
    </>
  ),
};
