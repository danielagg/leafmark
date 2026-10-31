export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export async function validateFile(file: File): Promise<'pdf' | 'epub'> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension !== 'pdf' && extension !== 'epub')
    throw new Error(`“${file.name}” isn't a PDF or EPUB. Choose a .pdf or .epub file.`);
  if (!file.size) throw new Error(`“${file.name}” is empty.`);
  if (file.size > MAX_FILE_BYTES)
    throw new Error(`“${file.name}” is too large. Choose a file under 50 MB.`);
  const header = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if (extension === 'pdf' && !new TextDecoder('latin1').decode(header).includes('%PDF-')) {
    throw new Error(`“${file.name}” doesn't appear to be a PDF. Try another file.`);
  }
  if (
    extension === 'epub' &&
    !(header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04)
  ) {
    throw new Error(`“${file.name}” doesn't appear to be an EPUB. Try another file.`);
  }
  return extension;
}
