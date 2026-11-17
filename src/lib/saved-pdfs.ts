import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { renderPdfToFile } from '@/lib/pdf-export';

/**
 * Every PDF made from the Cutlist calculator or the Bar Optimizer is kept here: as a PDF file in the
 * app's own storage (opened in the app's PDF viewer), plus its HTML, which the web version prints and
 * which rebuilds the file if it's ever missing.
 */
export type SavedPdfSource = 'cutlist' | 'optimizer';

export type SavedPdf = {
  id: string;
  source: SavedPdfSource;
  title: string;
  /** A line under the title, e.g. the opening size or the site name. */
  detail: string;
  fileName: string;
  createdAt: string;
  html: string;
  /** The stored PDF file (native only). */
  file?: string;
};

const KEY = 'vimalnath:saved-pdfs';
/** The newest PDFs kept; older ones drop off and their files are deleted. */
const LIMIT = 100;

const folder = () => new Directory(Paths.document, 'saved-pdfs');

export async function listSavedPdfs(): Promise<SavedPdf[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedPdf[]) : [];
  } catch {
    return [];
  }
}

export async function getSavedPdf(id: string): Promise<SavedPdf | undefined> {
  return (await listSavedPdfs()).find((pdf) => pdf.id === id);
}

function deleteFile(pdf: SavedPdf) {
  if (!pdf.file) return;
  try {
    const file = new File(pdf.file);
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
}

/** Writes the PDF file for this entry into the app's storage and returns its URI (native only). */
async function storeFile(id: string, html: string): Promise<string> {
  const dir = folder();
  if (!dir.exists) dir.create({ intermediates: true });
  const rendered = await renderPdfToFile(html);
  const target = new File(dir, `${id}.pdf`);
  if (target.exists) target.delete();
  await rendered.move(target);
  return target.uri;
}

export async function rememberPdf(pdf: Omit<SavedPdf, 'id' | 'createdAt' | 'file'>): Promise<void> {
  const now = new Date();
  const id = `${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`;
  let file: string | undefined;
  if (Platform.OS !== 'web') {
    try {
      file = await storeFile(id, pdf.html);
    } catch {
      // Kept without a file; the viewer rebuilds it from the HTML when it's opened.
    }
  }
  const entry: SavedPdf = { ...pdf, id, createdAt: now.toISOString(), file };
  const list = await listSavedPdfs();
  const kept = [entry, ...list];
  kept.slice(LIMIT).forEach(deleteFile);
  await AsyncStorage.setItem(KEY, JSON.stringify(kept.slice(0, LIMIT)));
}

/** The URI of the entry's PDF file, rebuilding the file from its HTML if it's missing (native only). */
export async function ensurePdfFile(pdf: SavedPdf): Promise<string> {
  if (pdf.file && new File(pdf.file).exists) return pdf.file;
  const uri = await storeFile(pdf.id, pdf.html);
  const list = await listSavedPdfs();
  await AsyncStorage.setItem(KEY, JSON.stringify(list.map((item) => (item.id === pdf.id ? { ...item, file: uri } : item))));
  return uri;
}

export async function deleteSavedPdf(id: string): Promise<SavedPdf[]> {
  const all = await listSavedPdfs();
  const target = all.find((pdf) => pdf.id === id);
  if (target) deleteFile(target);
  const list = all.filter((pdf) => pdf.id !== id);
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  return list;
}
