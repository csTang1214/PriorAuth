import { invoke } from "@tauri-apps/api/core";

/**
 * Real document import (spec §4.1), replacing the Phase-1 stub. The stub's
 * original signature took a browser `File` object; Tauri's own file-open
 * dialog (`NewCase.tsx`'s import button) hands back a native filesystem
 * path directly, so this takes a path instead — no need to read the file
 * into JS memory just to hand it back to Rust.
 *
 * Extraction itself (Tesseract for images, direct PDF text-layer extraction
 * with an OCR fallback for scanned PDFs) happens entirely in the
 * `ocr_import_document` Rust command — see development.md's Phase 7 design
 * for why that stays native code rather than a frontend-invoked shell
 * command. The returned text is never saved automatically; it's meant to
 * populate the editable clinical-summary field for staff to review and
 * correct before Save, same as every other generated/extracted content in
 * this app.
 */
export async function importDocument(path: string): Promise<string> {
  return invoke<string>("ocr_import_document", { path });
}
