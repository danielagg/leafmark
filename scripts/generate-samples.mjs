import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import JSZip from 'jszip';
import { mkdir, writeFile } from 'node:fs/promises';

const chapters = [
  { title: 'Begin where you are', paragraphs: [
    'There is a particular pleasure in opening a book without a plan. No list to complete, no useful fact to extract. Just a page, a little time, and the possibility of being surprised. Reading can begin that simply.',
    'Find a comfortable place. A chair near a window is enough, although a crowded train will do just as well. The place matters less than the small decision to give your attention to one thing for a while.',
    'At first, the mind will probably wander. It remembers an unanswered message, an errand, a conversation from yesterday. This is ordinary. Bring it back to the sentence. The sentence has been waiting patiently.',
    'A book asks for a different kind of time. It does not refresh itself while you look away. It does not insist that the next page is more urgent than the one you are reading. You set the pace.',
    'Some days a chapter is exactly the right amount. Other days a paragraph is enough. There is no minimum distance you must travel before a walk counts as a walk. The same is true of reading.',
    'So begin where you are. Let the room settle around you. There will be other things to do later. For the moment, there is this page.'
  ] },
  { title: 'The things we pass by', paragraphs: [
    'On a familiar street, there are things we stop seeing. A blue door. A tree that has grown around an old fence. The light in an upstairs window at the same hour each evening. Familiarity makes them disappear.',
    'Walk a little more slowly and the street changes. The buildings have textures. A shopkeeper is arranging oranges in a shallow wooden box. Somewhere behind a wall, someone is practicing the piano.',
    'Attention does not require a remarkable subject. It makes a subject remarkable by staying with it. A page of description can reveal an entire room, if we give the words enough space to work.',
    'This is one of the quiet gifts of books. They lend us another way of noticing. After a good story, an ordinary afternoon can feel a little less ordinary. Nothing outside has changed, but something in the looking has.',
    'Try carrying one small detail from a book into the rest of your day. A turn of phrase, a color, an observation about the weather. See what it finds in the world around you.',
    'There is no need to write it down or turn it into a practice. Simply notice it. Sometimes that is the whole thing.'
  ] },
  { title: 'A little room', paragraphs: [
    'A shelf does not need to be full to be useful. A few books you want to return to can make a better library than a hundred you feel you ought to read. Leave a little room for whatever comes next.',
    'The same is true of a day. Every unclaimed minute does not need a task. A short interval between two appointments can be a place to breathe, look out of a window, or read a few pages.',
    'We often imagine that a good habit must be a large arrangement. A new schedule, a dedicated desk, an early alarm. Sometimes it is only a book that is easy to reach and a place that is easy to return to.',
    'Make the beginning small. Open the book. Read until something else needs your attention. When you return, the story will still be there. You do not have to earn your place in it again.',
    'It helps when the tools step aside. A bookmark that stays put. A lamp that gives enough light. A reader that remembers the page. Small things can remove an entire layer of effort.',
    'The point is not to build a perfect reading life. It is to make a little room for reading in the life you already have.'
  ] },
  { title: 'Picking up the thread', paragraphs: [
    'Returning to a book is different from starting one. The first few sentences are a small reunion. A voice becomes familiar again. A scene begins to take shape. The thread is still there, waiting to be picked up.',
    'Sometimes you need to turn back a page. Sometimes you remember more than you expected. Both are fine. Reading is not an examination, and memory is not a filing cabinet.',
    'A story can accompany you through many different places. You begin it at a kitchen table and find yourself halfway through on a train. A later chapter belongs to a rainy afternoon in another city.',
    'The book becomes connected to those places. Years later, a sentence can bring back the light in a room or the sound of rain against a window. We remember with more than words.',
    'When you reach the last page, pause for a moment. There is no need to move immediately to another book. Let the ending have its own small space.',
    'Then close the book, or open another. The library will be here whenever you are ready.'
  ] }
];

await mkdir('public/samples', { recursive: true });
const pdf = await PDFDocument.create();
const serif = await pdf.embedFont(StandardFonts.TimesRoman);
const sans = await pdf.embedFont(StandardFonts.Helvetica);
const ink = rgb(.16, .20, .17), green = rgb(.17, .35, .28);
function wrap(text, font, size, width) {
  const lines = []; let line = '';
  for (const word of text.split(' ')) {
    if (font.widthOfTextAtSize(line ? `${line} ${word}` : word, size) > width && line) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}
for (let i = 0; i < chapters.length; i++) {
  const page = pdf.addPage([595, 842]);
  page.drawText('LEAFMARK / A SHORT READ', { x: 62, y: 780, size: 9, font: sans, color: green });
  page.drawText(i === 0 ? 'The art of noticing' : chapters[i].title, { x: 62, y: 720, size: 30, font: serif, color: ink });
  let y = 675;
  if (i === 0) { page.drawText(chapters[i].title, { x: 62, y, size: 15, font: serif, color: green }); y -= 38; }
  for (const paragraph of chapters[i].paragraphs) {
    for (const line of wrap(paragraph, serif, 12.5, 471)) {
      page.drawText(line, { x: 62, y, size: 12.5, font: serif, color: ink }); y -= 19;
    }
    y -= 14;
  }
  page.drawText(String(i + 1).padStart(2, '0'), { x: 62, y: 43, size: 10, font: sans, color: green });
  page.drawText('A little space for a good book.', { x: 345, y: 43, size: 9, font: sans, color: green });
}
pdf.setTitle('The art of noticing');
pdf.setAuthor('Leafmark');
await writeFile('public/samples/The art of noticing.pdf', await pdf.save());

const zip = new JSZip();
zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
const xml = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?><package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:uuid:leafmark-sample-epub</dc:identifier><dc:title>A little room to read</dc:title><dc:language>en</dc:language><dc:creator>Leafmark</dc:creator><meta property="dcterms:modified">2026-10-30T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters.map((_, i) => `<item id="ch${i}" href="chapter${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${chapters.map((_, i) => `<itemref idref="ch${i}"/>`).join('')}</spine></package>`);
zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><h1>Contents</h1><ol>${chapters.map((ch, i) => `<li><a href="chapter${i}.xhtml">${xml(ch.title)}</a></li>`).join('')}</ol></nav></body></html>`);
chapters.forEach((chapter, i) => zip.file(`OEBPS/chapter${i}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xml(chapter.title)}</title><style>body{font-family:Georgia,serif;line-height:1.85;color:#26312b}h1{font-weight:normal;font-size:1.8em;line-height:1.3;margin:1.5em 0 1em}p{margin:0 0 1.2em}small{font-family:sans-serif;letter-spacing:.13em;font-size:.65em;color:#628170}</style></head><body><small>A LITTLE ROOM TO READ / ${String(i + 1).padStart(2, '0')}</small><h1>${xml(chapter.title)}</h1>${chapter.paragraphs.map(p => `<p>${xml(p)}</p>`).join('')}</body></html>`));
await writeFile('public/samples/A little room to read.epub', await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log('Generated PDF and EPUB sample books.');
