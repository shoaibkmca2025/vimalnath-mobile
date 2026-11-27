import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { withTimeout } from '@/lib/pdf-html';
import { shareHtmlAsPdf } from '@/lib/web-pdf';

const PDF_MIME = 'application/pdf';
// A4 at 72 PPI.
const A4 = { width: 595, height: 842 };

/**
 * A PDF named as the person typed it, e.g. a customer or site name ("Sundaram Residence.pdf"): spaces and any
 * script (Marathi, Hindi) kept, only the characters a file name can't hold taken out.
 */
export function pdfNamed(name: string): string {
  const base = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  return `${base || 'Vimalnath'}.pdf`;
}

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
  return namedCopy(uri, fileName);
}

/** Renders the HTML to a PDF file at a temporary path (native only); the caller moves or copies it. */
export async function renderPdfToFile(html: string): Promise<File> {
  const { uri } = await withTimeout(Print.printToFileAsync({ html, ...A4 }), 20000, 'Generating PDF');
  return new File(uri);
}

/** A copy of the file in the cache under a readable name, which is what the share sheet shows. */
function namedCopy(uri: string, fileName: string): File {
  const named = new File(Paths.cache, fileName);
  if (named.exists) named.delete();
  new File(uri).copySync(named);
  return named;
}

/** Shares a PDF that is already a file on this phone (e.g. one kept in Saved PDFs). */
export async function sharePdfFile(uri: string, fileName: string, dialogTitle: string): Promise<void> {
  const file = namedCopy(uri, fileName);
  if (!(await withTimeout(Sharing.isAvailableAsync(), 5000, 'Checking sharing availability'))) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(file.uri, { mimeType: PDF_MIME, dialogTitle, UTI: 'com.adobe.pdf' });
}

/** Saves a PDF that is already a file on this phone to a folder the person picks (Android) or via Files (iOS). */
export async function savePdfFile(uri: string, fileName: string): Promise<SavePdfOutcome> {
  return saveFile(namedCopy(uri, fileName), fileName);
}

/** Opens the system share sheet (WhatsApp, Gmail, Drive, Bluetooth, …) with the PDF attached. */
export async function sharePdf(html: string, fileName: string, dialogTitle: string): Promise<void> {
  // Web (incl. the home-screen app): expo-print can't make a file there, so the PDF is built in the browser.
  if (Platform.OS === 'web') return shareHtmlAsPdf(html, fileName);

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
 * - Web: the share sheet opens with the PDF ("Save to Files" on iPhone); a computer downloads it.
 */
export async function savePdf(html: string, fileName: string): Promise<SavePdfOutcome> {
  if (Platform.OS === 'web') {
    await shareHtmlAsPdf(html, fileName);
    return { saved: false };
  }

  return saveFile(await renderPdf(html, fileName), fileName);
}

async function saveFile(file: File, fileName: string): Promise<SavePdfOutcome> {
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
