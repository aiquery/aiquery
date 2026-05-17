// ─── LLM Models ───────────────────────────────────────────────────────────────

export type LLMModel = 'claude-3-7-sonnet' | 'gemini-2-0-flash' | 'gpt-4o-mini';

// ─── Data Sources ─────────────────────────────────────────────────────────────

export type DataSourceType =
  | 'bigquery'
  | 'azuresql'
  | 'redshift'
  | 'mysql'
  | 'postgresql'
  | 'snowflake'
  | 'databricks'
  | 'airtable';

// ─── Column / Table Schema ────────────────────────────────────────────────────

export interface ColumnSchema {
  name: string;
  type: string;
  mode?: string;
  description?: string;
  nullable?: boolean;
  /** RAG-generated semantic description */
  ragDescription?: string;
}

export interface TableSchema {
  name: string;
  schema?: string;       // SQL Server / Redshift / Snowflake schema (e.g. "dbo", "public")
  description?: string;
  /** RAG-generated semantic description */
  ragDescription?: string;
  columns: ColumnSchema[];
}

// ─── Schema Context (sent to LLM) ────────────────────────────────────────────

export interface SchemaContext {
  dataSource: DataSourceType;
  // BigQuery fields
  projectId?: string;
  datasetId?: string;
  // Azure SQL / Redshift / MySQL / PostgreSQL / Snowflake / Databricks fields
  database?: string;
  schemaName?: string;
  // Airtable fields
  baseId?: string;
  tables: TableSchema[];
  /** Path to the RAG index file used for this context */
  ragIndexPath?: string;
}

// ─── Connection Configs ───────────────────────────────────────────────────────

export interface BigQueryConfig {
  projectId: string;
  datasetId?: string;
  keyFilename?: string;
}

export interface AzureSQLConfig {
  server: string;
  database: string;
  user: string;
  password: string;
  port?: number;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
}

export interface RedshiftConfig {
  host: string;
  database: string;
  user: string;
  password?: string;
  port?: number;
  ssl?: boolean;
  schema?: string;
}

export interface MySQLConfig {
  host: string;
  database: string;
  user: string;
  password: string;
  port?: number;
  ssl?: boolean;
}

export interface PostgreSQLConfig {
  host: string;
  database: string;
  user: string;
  password: string;
  port?: number;
  ssl?: boolean;
  schema?: string;
}

export interface SnowflakeConfig {
  account: string;       // e.g. "xy12345.us-east-1"
  username: string;
  password: string;
  database: string;
  warehouse: string;
  schema?: string;
  role?: string;
}

export interface DatabricksConfig {
  host: string;          // e.g. "adb-1234567890.1.azuredatabricks.net"
  token: string;         // Personal Access Token
  httpPath: string;      // e.g. "/sql/1.0/warehouses/abc123"
  catalog?: string;
  schema?: string;
}

export interface AirtableConfig {
  apiKey: string;        // Personal Access Token
  baseId: string;        // e.g. "appXXXXXXXXXXXXXX"
}

export type AnyConnectionConfig =
  | BigQueryConfig
  | AzureSQLConfig
  | RedshiftConfig
  | MySQLConfig
  | PostgreSQLConfig
  | SnowflakeConfig
  | DatabricksConfig
  | AirtableConfig;

// ─── Conversation ─────────────────────────────────────────────────────────────

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── AIquery Request / Response ──────────────────────────────────────────

export interface TextToSQLRequest {
  question: string;
  model: LLMModel;
  schemaContext?: SchemaContext;
  executeQuery?: boolean;
  conversationHistory?: ConversationMessage[];
  connectionConfig?: AnyConnectionConfig;
  /** If provided, use this RAG index file instead of schemaContext.tables */
  ragIndexPath?: string;
}

export interface TextToSQLResponse {
  sql: string;
  explanation: string;
  model: LLMModel;
  latencyMs: number;
  queryResults?: QueryResult;
  /** AI-generated data analysis summary of the query results */
  analysisSummary?: string;
  error?: string;
}

// ─── Query Result ─────────────────────────────────────────────────────────────

export interface QueryResult {
  rows: Record<string, unknown>[];
  totalRows: number;
  schema?: ColumnSchema[];
  jobId?: string;
  bytesProcessed?: number;
  latencyMs: number;
}

// ─── LLM Config ───────────────────────────────────────────────────────────────

export interface LLMConfig {
  model: LLMModel;
  maxTokens?: number;
  temperature?: number;
}

// ─── RAG Types ────────────────────────────────────────────────────────────────

export interface RagColumnEntry {
  name: string;
  type: string;
  description: string;
  examples?: string[];
}

export interface RagTableEntry {
  tableName: string;
  schemaName?: string;
  description: string;
  purpose: string;
  keyColumns: RagColumnEntry[];
  relationships?: string[];
  sampleQuestions?: string[];
}

export interface RagIndex {
  version: string;
  createdAt: string;
  dataSource: DataSourceType;
  database?: string;
  schemaName?: string;
  projectId?: string;
  datasetId?: string;
  model: LLMModel;
  tables: RagTableEntry[];
}

export interface RagGenerationRequest {
  dataSource: DataSourceType;
  tables: TableSchema[];
  model: LLMModel;
  database?: string;
  schemaName?: string;
  projectId?: string;
  datasetId?: string;
  indexName?: string;
}

export interface RagGenerationResult {
  indexPath: string;
  indexName: string;
  tablesProcessed: number;
  model: LLMModel;
  latencyMs: number;
}

// ─── Analysis Summary ─────────────────────────────────────────────────────────

export interface AnalysisSummaryRequest {
  question: string;
  sql: string;
  queryResult: QueryResult;
  model: LLMModel;
  dataSource: DataSourceType;
}
