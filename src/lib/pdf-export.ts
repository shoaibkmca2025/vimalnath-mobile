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

/**
 * On web there is no file to hand over, so print the PDF's page: the print sheet has "Save as PDF", and on iPhone a Share button.
 * expo-print's web version can't be used: it ignores the HTML and prints the app screen.
 */
function printOnWeb(html: string, fileName: string): Promise<void> {
  // A new frame each time, so the same PDF twice still loads; the last one is done printing by now.
  document.getElementById('pdf-print')?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'pdf-print';
  frame.title = fileName;
  // Hidden but not display:none, which some browsers print as a blank page.
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
  const printed = new Promise<void>((resolve) => {
    frame.onload = () => {
      const page = frame.contentWindow!;
      page.document.title = fileName.replace(/\.pdf$/, ''); // The name "Save as PDF" suggests.
      page.focus();
      page.print();
      resolve();
    };
  });
  frame.srcdoc = html;
  document.body.appendChild(frame);
  return withTimeout(printed, 20000, 'Opening print dialog');
}

/** Opens the system share sheet (WhatsApp, Gmail, Drive, Bluetooth, …) with the PDF attached. */
export async function sharePdf(html: string, fileName: string, dialogTitle: string): Promise<void> {
  if (Platform.OS === 'web') return printOnWeb(html, fileName);

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
    await printOnWeb(html, fileName);
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
