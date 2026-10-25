/** Type shims for subpath imports that ship without declarations. */

declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfResult {
    text: string;
    numpages?: number;
    info?: Record<string, unknown>;
  }
  function pdfParse(buffer: Buffer): Promise<PdfResult>;
  export default pdfParse;
}
