import type { ColumnSchema } from '../../types';

export interface RagTableSchemaRow {
  schemaName?: string;
  tableId: string;
  /** BigQuery dataset id (optional; some callers use dataset field on response) */
  datasetId?: string;
  database?: string;
  schema: ColumnSchema[];
  rowCount?: number;
}

export interface BigQueryRagTableSchemaRow extends RagTableSchemaRow {
  datasetId: string;
}

export interface AirtableSchemaConfig {
  apiKey?: string;
  baseId?: string;
}

export interface AirtableSchemaTable {
  name: string;
  columns: ColumnSchema[];
}

export interface BigQueryRagConfig {
  projectId: string;
  serviceAccountKey: string;
}
