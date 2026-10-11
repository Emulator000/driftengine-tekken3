/** The types of `certificate.mjs`, for the Vite config that imports it. */
export declare const CERTIFICATE_DAYS: number;
export declare function makeCertificate(options: {
  readonly common: string;
  readonly names: readonly string[];
  readonly addresses: readonly string[];
  readonly now?: Date;
}): { key: string; cert: string };
