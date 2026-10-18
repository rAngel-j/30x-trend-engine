import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite (fallback local) y los SDKs de servidor no deben empaquetarse para el cliente.
  serverExternalPackages: ["@google/genai"],
  // El ADN de marca se lee en runtime (configuración viva): debe viajar con las rutas de IA.
  outputFileTracingIncludes: {
    "/api/discover": ["./docs/30X_BRAND_DNA.md"],
    "/api/analyze-url": ["./docs/30X_BRAND_DNA.md"],
    "/api/brand-dna": ["./docs/30X_BRAND_DNA.md"],
  },
};

export default nextConfig;
