import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  title: "30X Radar de tendencias",
  description: "Qué está despegando en LinkedIn, Instagram, TikTok y YouTube, por qué funcionó y el guion listo para @30x y @andresbilbao.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={archivo.variable}>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
