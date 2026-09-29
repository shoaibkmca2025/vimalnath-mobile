import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { withTimeout } from '@/lib/pdf-html';

const PDF_MIME = 'application/pdf';
// A4 at 72 PPI.
const A4 = { width: 595, height: 842 };

/** "1+0 Sliding System" → "1+0-Sliding-System". Keeps the file name readable in WhatsApp and file managers. */
export function pdfFileName(title: string): string {
  const base = title
    .replace(/[^a-zA-Z0-9+\-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${base || 'Vimalnath'}.pdf`;
}

/**
 * Renders the HTML to a PDF and copies it to a file with a readable name (expo-print gives it a random
 * UUID name, which is what WhatsApp would otherwise show). Native only.
 */
async function renderPdf(html: string, fileName: string): Promise<File> {
  const { uri } = await withTimeout(Print.printToFileAsync({ html, ...A4 }), 20000, 'Generating PDF');
  const rendered = new File(uri);
  const named = new File(Paths.cache, fileName);
  if (named.exists) named.delete();
  rendered.copySync(named);
  return named;
}

/** On web there is no file to hand over, so open the browser print dialog, where "Save as PDF" is available. */
async function printOnWeb(html: string) {
  // printToFileAsync (not printAsync) is used here because on web it prints the given HTML rather than the page.
  await withTimeout(Print.printToFileAsync({ html, ...A4 }), 20000, 'Opening print dialog');
}

/** Opens the system share sheet (WhatsApp, Gmail, Drive, Bluetooth, …) with the PDF attached. */
export async function sharePdf(html: string, fileName: string, dialogTitle: string): Promise<void> {
  if (Platform.OS === 'web') return printOnWeb(html);

  const file = await renderPdf(html, fileName);
  if (!(await withTimeout(Sharing.isAvailableAsync(), 5000, 'Checking sharing availability'))) {
    throw new Error('Sharing is not available on this device');
  }
  // Not timed: the share sheet stays open until the person picks an app or cancels.
  await Sharing.shareAsync(file.uri, { mimeType: PDF_MIME, dialogTitle, UTI: 'com.adobe.pdf' });
}

export type SavePdfOutcome = { saved: true; location: string } | { saved: false };

/**
 * Saves the PDF to the phone's storage.
 * - Android: the person picks a folder (e.g. Download or Documents) and the PDF is written there.
 * - iOS: apps can't write to shared storage directly, so the share sheet opens; "Save to Files" is in it.
 * - Web: the print dialog opens, where "Save as PDF" is available.
 */
export async function savePdf(html: string, fileName: string): Promise<SavePdfOutcome> {
  if (Platform.OS === 'web') {
    await printOnWeb(html);
    return { saved: false };
  }

  const file = await renderPdf(html, fileName);

  if (Platform.OS === 'android') {
    let folder: Directory;
    try {
      folder = await Directory.pickDirectoryAsync();
    } catch {
      // The person closed the folder picker without choosing one.
      return { saved: false };
    }
    const target = folder.createFile(fileName, PDF_MIME);
    target.write(await file.bytes());
    return { saved: true, location: folder.name || 'the selected folder' };
  }

  await Sharing.shareAsync(file.uri, { mimeType: PDF_MIME, dialogTitle: 'Save PDF', UTI: 'com.adobe.pdf' });
  return { saved: false };
}
