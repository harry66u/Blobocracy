/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute public address of the site, e.g. https://blobocracy.com (from SITE_URL at build time). */
  readonly VITE_SITE_URL: string;
}
