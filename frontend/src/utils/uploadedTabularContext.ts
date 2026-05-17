/**
 * Builds the same "--- Uploaded Tabular Data Context ---" block as Slack
 * (see backend/services/slack/uploaded-tabular-context.ts). Keep limits in sync.
 */
const MAX_COLUMNS = 20
const MAX_ROWS = 40

export interface TabularPreview {
  fileName: string
  rowCount: number
  columns: string[]
  sampleRows: Array<Record<string, string>>
}

function isTabularFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return lower.endsWith('.csv') || lower.endsWith('.xlsx') || lower.endsWith('.xls')
}

function valueToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function parseTabularPreview(
  xlsx: typeof import('xlsx'),
  fileName: string,
  fileBuffer: ArrayBuffer
): TabularPreview {
  const workbook = xlsx.read(fileBuffer, { type: 'array', cellDates: true })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    throw new Error('Workbook has no sheets')
  }

  const sheet = workbook.Sheets[firstSheetName]
  if (!sheet) {
    throw new Error('Could not read first sheet')
  }

  const allRows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: false,
    defval: '',
  })

  const columns = (allRows[0] ? Object.keys(allRows[0]) : []).slice(0, MAX_COLUMNS)
  const sampleRows = allRows.slice(0, MAX_ROWS).map((row) => {
    const trimmed: Record<string, string> = {}
    for (const col of columns) {
      trimmed[col] = valueToText(row[col])
    }
    return trimmed
  })

  return {
    fileName,
    rowCount: allRows.length,
    columns,
    sampleRows,
  }
}

function buildContextBlock(preview: TabularPreview): string {
  const rowsJson = preview.sampleRows.map((r) => JSON.stringify(r)).join('\n')

  return [
    `Uploaded file: ${preview.fileName}`,
    `Detected columns (${preview.columns.length}): ${preview.columns.join(', ')}`,
    `Total parsed rows: ${preview.rowCount}`,
    `Sample rows (${preview.sampleRows.length}):`,
    rowsJson || '(no rows detected)',
  ].join('\n')
}

/**
 * Parse up to 2 supported files and return the wrapped context string for /api/chat `question`,
 * or empty string if nothing valid was selected.
 */
export async function buildUploadedTabularContextFromFiles(files: FileList | File[]): Promise<string> {
  const xlsx = await import('xlsx')
  const list = Array.from(files)
  const supported = list.filter((f) => isTabularFileName(f.name)).slice(0, 2)
  if (supported.length === 0) {
    return ''
  }

  const blocks: string[] = []

  for (const file of supported) {
    const fileName = file.name || 'upload.csv'
    try {
      const buffer = await file.arrayBuffer()
      const preview = parseTabularPreview(xlsx, fileName, buffer)
      blocks.push(buildContextBlock(preview))
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      blocks.push(`Uploaded file: ${fileName}\nCould not parse this file: ${msg}`)
    }
  }

  if (blocks.length === 0) {
    return ''
  }

  return [
    '--- Uploaded Tabular Data Context ---',
    'IMPORTANT: This file is NOT loaded into BigQuery. Do not reference any `project.dataset.table` like `uploaded.*` or invented datasets.',
    'In SQL, represent these rows as an inline CTE using UNNEST([STRUCT<...>(...), ...]) or equivalent — never as a physical BigQuery table.',
    'If the user asks about this file / upload / spreadsheet (e.g. "based on the uploaded file"), answer using ONLY that inline CTE. Do NOT query warehouse tables (e.g. `*.customer`) instead of the file — even if RAG lists similar tables.',
    'JOIN to warehouse tables in the schema/RAG only when the user explicitly asks to combine or enrich with database data.',
    ...blocks,
    '--- End Uploaded Tabular Data Context ---',
  ].join('\n\n')
}

/**
 * Matches backend `questionReferencesUploadWithoutContext` — text asks about "the uploaded file"
 * but the client must still send tabular bytes in `uploadedTabularContext`.
 */
export function questionReferencesUploadWithoutAttachment(text: string): boolean {
  const q = text.trim().toLowerCase()
  if (!q) return false
  if (q.includes('--- uploaded tabular data context ---')) return false
  if (/\b(the|my|this)\s+uploaded\s+(file|sheet|spreadsheet|csv|data|table)\b/.test(q)) return true
  if (q.includes('based on the upload')) return true
  if (q.includes('from the upload')) return true
  if (q.includes('from my upload')) return true
  if (q.includes('from this upload')) return true
  if (q.includes('this spreadsheet') && (q.includes('upload') || q.includes('attach'))) return true
  if (q.includes('attached file') && (q.includes('based') || q.includes('from') || q.includes('analyze'))) return true
  return false
}

export { isTabularFileName }
