import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite (fallback local) y los SDKs de servidor no deben empaquetarse para el cliente.
  serverExternalPackages: ["@google/genai"],
  // El perfil 30X por defecto se crea a partir de este documento la primera vez que una ruta lo necesita.
  outputFileTracingIncludes: {
    "/api/**/*": ["./docs/30X_BRAND_DNA.md"],
  },
};

export default nextConfig;
