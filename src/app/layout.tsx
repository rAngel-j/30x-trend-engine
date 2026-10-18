import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  title: "30X Radar de tendencias",
  description: "Qué está despegando en LinkedIn, Instagram, TikTok y YouTube, por qué funcionó y el guion listo para tu marca.",
};

/**
 * Aplica el tema guardado (o el del sistema) antes de pintar, para evitar el destello claro al cargar.
 * Es un script estático propio, sin datos del usuario.
 */
const THEME_BOOT = `(function(){try{var t=localStorage.getItem("30x.theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={archivo.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
