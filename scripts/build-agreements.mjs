import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(repoRoot, 'examples', 'agreements');
const outputDir = path.join(sourceDir, 'dist');
const testVariantsDir = path.join(sourceDir, 'test-variants');
const iamTestDir = path.join(
  repoRoot,
  'docusign-iam',
  'renewal-risk',
  'agreement-manager',
  'files',
  'test',
);

const page = {
  margin: 54,
  width: 612,
  height: 792,
};

const styles = {
  title: { font: 'Helvetica-Bold', size: 18, gapBefore: 0, gapAfter: 16 },
  heading: { font: 'Helvetica-Bold', size: 13, gapBefore: 14, gapAfter: 8 },
  body: { font: 'Helvetica', size: 10.5, gapBefore: 0, gapAfter: 8 },
  bullet: { font: 'Helvetica', size: 10.5, gapBefore: 0, gapAfter: 5 },
  notice: { font: 'Helvetica-Oblique', size: 9.5, gapBefore: 0, gapAfter: 12 },
};

const main = async () => {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const sources = entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => name.endsWith('.md') && name !== 'README.md')
    .sort();

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.rm(iamTestDir, { recursive: true, force: true });
  await fs.mkdir(iamTestDir, { recursive: true });

  const generated = [];

  for (const sourceName of sources) {
    const sourcePath = path.join(sourceDir, sourceName);
    const outputName = `${path.basename(sourceName, '.md')}.pdf`;
    const outputPath = path.join(outputDir, outputName);
    const markdown = await fs.readFile(sourcePath, 'utf8');

    await renderAgreementPdf(markdown, outputPath);
    generated.push(path.relative(repoRoot, outputPath));
  }

  // IAM Toolkit rejects test-set ingestion as a duplicate whenever the
  // extracted content matches an already-ingested training document, so the
  // test set is a genuinely different (held-out) batch of fictional
  // agreements, not copies of the training set. See
  // examples/agreements/test-variants/README.md.
  const testEntries = await fs.readdir(testVariantsDir, { withFileTypes: true });
  const testSources = testEntries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => name.endsWith('.md') && name !== 'README.md')
    .sort();

  for (const sourceName of testSources) {
    const sourcePath = path.join(testVariantsDir, sourceName);
    const outputName = `${path.basename(sourceName, '.md')}.pdf`;
    const outputPath = path.join(iamTestDir, outputName);
    const markdown = await fs.readFile(sourcePath, 'utf8');

    await renderAgreementPdf(markdown, outputPath);
    generated.push(path.relative(repoRoot, outputPath));
  }

  if (generated.length === 0) {
    throw new Error(`No agreement Markdown files found in ${path.relative(repoRoot, sourceDir)}`);
  }

  console.log(`Generated ${generated.length} agreement PDF${generated.length === 1 ? '' : 's'}:`);
  for (const file of generated) {
    console.log(`- ${file}`);
  }
};

const renderAgreementPdf = (markdown, outputPath, infoOverrides = {}) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: page.margin,
      info: {
        Title: extractTitle(markdown),
        Subject: 'Fictional supplier agreement for Docusign sandbox upload',
        Author: 'Docusign Renewal Risk Agent demo',
        Keywords: 'fictional, supplier agreement, renewal risk',
        CreationDate: new Date('2026-07-01T00:00:00.000Z'),
        ModDate: new Date('2026-07-01T00:00:00.000Z'),
        ...infoOverrides,
      },
    });

    const stream = createWriteStream(outputPath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);

    doc.font(styles.body.font).fontSize(styles.body.size);

    const lines = markdown.split(/\r?\n/);
    let pendingParagraph = [];

    for (const line of lines) {
      if (line.trim() === '') {
        flushParagraph(doc, pendingParagraph);
        pendingParagraph = [];
        continue;
      }

      if (line.startsWith('# ')) {
        flushParagraph(doc, pendingParagraph);
        pendingParagraph = [];
        writeBlock(doc, cleanupInline(line.slice(2)), styles.title);
        continue;
      }

      if (line.startsWith('## ')) {
        flushParagraph(doc, pendingParagraph);
        pendingParagraph = [];
        writeBlock(doc, cleanupInline(line.slice(3)), styles.heading);
        continue;
      }

      if (line.startsWith('- ')) {
        flushParagraph(doc, pendingParagraph);
        pendingParagraph = [];
        writeBullet(doc, cleanupInline(line.slice(2)));
        continue;
      }

      pendingParagraph.push(line.trim());
    }

    flushParagraph(doc, pendingParagraph);
    doc.end();
  });

const flushParagraph = (doc, pendingParagraph) => {
  if (pendingParagraph.length === 0) {
    return;
  }

  const text = cleanupInline(pendingParagraph.join(' '));
  const style = text.startsWith('Fictional example') ? styles.notice : styles.body;
  writeBlock(doc, text, style);
};

const writeBlock = (doc, text, style) => {
  ensureSpace(doc, style.size * 2.4 + style.gapAfter);
  if (style.gapBefore > 0) {
    doc.moveDown(style.gapBefore / style.size);
  }

  doc
    .font(style.font)
    .fontSize(style.size)
    .fillColor('#111111')
    .text(text, {
      width: contentWidth(doc),
      lineGap: 2,
    });

  if (style.gapAfter > 0) {
    doc.moveDown(style.gapAfter / style.size);
  }
};

const writeBullet = (doc, text) => {
  ensureSpace(doc, styles.bullet.size * 1.8 + styles.bullet.gapAfter);
  const y = doc.y;
  doc
    .font(styles.bullet.font)
    .fontSize(styles.bullet.size)
    .fillColor('#111111')
    .text('-', page.margin, y, {
      width: 12,
      lineGap: 2,
      continued: false,
    });

  doc.text(text, page.margin + 18, y, {
    width: contentWidth(doc) - 18,
    lineGap: 2,
  });
  doc.moveDown(styles.bullet.gapAfter / styles.bullet.size);
};

const ensureSpace = (doc, height) => {
  if (doc.y + height > page.height - page.margin) {
    doc.addPage();
  }
};

const contentWidth = doc => doc.page.width - page.margin * 2;

const extractTitle = markdown => {
  const titleLine = markdown
    .split(/\r?\n/)
    .find(line => line.startsWith('# '));

  return titleLine ? cleanupInline(titleLine.slice(2)) : 'Supplier Agreement';
};

const cleanupInline = text =>
  text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

main().catch(error => {
  console.error(error);
  process.exit(1);
});
