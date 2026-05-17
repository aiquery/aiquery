import axios from 'axios';
import path from 'path';
import * as XLSX from 'xlsx';

export interface SlackUploadedFile {
  name?: string;
  url_private_download?: string;
  url_private?: string;
}

interface TabularPreview {
  fileName: string;
  rowCount: number;
  columns: string[];
  sampleRows: Array<Record<string, string>>;
}

const MAX_COLUMNS = 20;
const MAX_ROWS = 40;

function isTabularFileName(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return ext === '.csv' || ext === '.xlsx' || ext === '.xls';
}

async function downloadSlackFileBuffer(file: SlackUploadedFile, slackToken: string): Promise<Buffer> {
  const url = file.url_private_download || file.url_private;
  if (!url) {
    throw new Error('Missing Slack file URL');
  }

  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    headers: {
      Authorization: `Bearer ${slackToken}`,
    },
    timeout: 30000,
  });

  return Buffer.from(response.data);
}

function valueToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseTabularPreview(fileName: string, fileBuffer: Buffer): TabularPreview {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('Workbook has no sheets');
  }

  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) {
    throw new Error('Could not read first sheet');
  }

  const allRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: false,
    defval: '',
  });

  const columns = (allRows[0] ? Object.keys(allRows[0]) : []).slice(0, MAX_COLUMNS);
  const sampleRows = allRows.slice(0, MAX_ROWS).map((row) => {
    const trimmed: Record<string, string> = {};
    for (const col of columns) {
      trimmed[col] = valueToText(row[col]);
    }
    return trimmed;
  });

  return {
    fileName,
    rowCount: allRows.length,
    columns,
    sampleRows,
  };
}

function buildContextBlock(preview: TabularPreview): string {
  const rowsJson = preview.sampleRows
    .map((r) => JSON.stringify(r))
    .join('\n');

  return [
    `Uploaded file: ${preview.fileName}`,
    `Detected columns (${preview.columns.length}): ${preview.columns.join(', ')}`,
    `Total parsed rows: ${preview.rowCount}`,
    `Sample rows (${preview.sampleRows.length}):`,
    rowsJson || '(no rows detected)',
  ].join('\n');
}

function wrapUploadedTabularBlocks(blocks: string[]): string {
  if (blocks.length === 0) {
    return '';
  }
  return [
    '--- Uploaded Tabular Data Context ---',
    'IMPORTANT: This file is NOT loaded into BigQuery. Do not reference any `project.dataset.table` like `uploaded.*` or invented datasets.',
    'In SQL, represent these rows as an inline CTE using UNNEST([STRUCT<...>(...), ...]) or equivalent — never as a physical BigQuery table.',
    'If the user asks about this file / upload / spreadsheet (e.g. "based on the uploaded file"), answer using ONLY that inline CTE. Do NOT query warehouse tables (e.g. `*.customer`) instead of the file — even if RAG lists similar tables.',
    'JOIN to warehouse tables in the schema/RAG only when the user explicitly asks to combine or enrich with database data.',
    ...blocks,
    '--- End Uploaded Tabular Data Context ---',
  ].join('\n\n');
}

/**
 * Web chat multipart uploads (same wrapped context as Slack) — parse in Node with xlsx.
 */
export function buildUploadedTabularContextFromWebBuffers(
  parts: Array<{ originalname: string; buffer: Buffer }>
): string {
  const supported = parts.filter((p) => isTabularFileName(p.originalname || 'upload.csv'));
  if (supported.length === 0) {
    return '';
  }
  const blocks: string[] = [];
  for (const file of supported.slice(0, 2)) {
    const fileName = file.originalname || 'upload.csv';
    try {
      const preview = parseTabularPreview(fileName, file.buffer);
      blocks.push(buildContextBlock(preview));
    } catch (error: any) {
      blocks.push(
        `Uploaded file: ${fileName}\nCould not parse this file: ${error?.message || 'Unknown error'}`
      );
    }
  }
  return wrapUploadedTabularBlocks(blocks);
}

export async function buildUploadedTabularContext(
  files: SlackUploadedFile[],
  slackToken: string
): Promise<string> {
  const supportedFiles = files.filter((file) => isTabularFileName(file.name || ''));
  if (supportedFiles.length === 0) {
    return '';
  }

  const blocks: string[] = [];
  const selectedFiles = supportedFiles.slice(0, 2);

  for (const file of selectedFiles) {
    const fileName = file.name || 'upload.csv';
    try {
      const buffer = await downloadSlackFileBuffer(file, slackToken);
      const preview = parseTabularPreview(fileName, buffer);
      blocks.push(buildContextBlock(preview));
    } catch (error: any) {
      blocks.push(`Uploaded file: ${fileName}\nCould not parse this file: ${error?.message || 'Unknown error'}`);
    }
  }

  return wrapUploadedTabularBlocks(blocks);
}
