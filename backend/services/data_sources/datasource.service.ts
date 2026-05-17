/**
 * datasource.service.ts
 * Unified data source router — delegates to the correct service
 * based on the DataSourceType.
 *
 * Supported sources:
 *   bigquery    → Google BigQuery
 *   azuresql    → Azure SQL (T-SQL)
 *   redshift    → Amazon Redshift
 *   mysql       → MySQL / MariaDB
 *   postgresql  → PostgreSQL
 *   snowflake   → Snowflake
 *   databricks  → Databricks SQL
 *   airtable    → Airtable
 */

import type { DataSourceType, TableSchema, QueryResult, AnyConnectionConfig } from '../../types';

import {
  getDatasetSchema as bqGetDatasetSchema,
  getTableSchema as bqGetTableSchema,
  executeQuery as bqExecuteQuery,
  listDatasets as bqListDatasets,
  validateConnection as bqValidateConnection,
} from './bigquery.service';

import {
  getAzureSQLDatabaseSchema,
  getAzureSQLTableSchema,
  executeAzureSQLQuery,
  listAzureSQLSchemas,
  validateAzureSQLConnection,
} from './azuresql.service';

import {
  getRedshiftDatabaseSchema,
  getRedshiftTableSchema,
  executeRedshiftQuery,
  listRedshiftSchemas,
  validateRedshiftConnection,
} from './redshift.service';

import {
  fetchMySQLSchema,
  executeMySQLQuery,
  listMySQLDatabases,
  validateMySQLConnection,
} from './mysql.service';

import {
  fetchPostgreSQLSchema,
  executePostgreSQLQuery,
  listPostgreSQLSchemas,
  validatePostgreSQLConnection,
} from './postgresql.service';

// Snowflake is lazy-loaded to avoid pulling in snowflake-sdk (and its lz4 native addon) at startup.
// The lz4 addon can fail on Windows with "not a valid Win32 application" when prebuilt for another arch.

import {
  fetchDatabricksSchema,
  executeDatabricksQuery,
  listDatabricksSchemas,
  validateDatabricksConnection,
} from './databricks.service';

import {
  fetchAirtableSchema,
  executeAirtableQuery,
  listAirtableTables,
  validateAirtableConnection,
} from './airtable.service';

// ─── Unified Interface ────────────────────────────────────────────────────────

interface FetchSchemaOptions {
  projectId?: string;
  datasetId?: string;
  database?: string;
  schemaName?: string;
  tableName?: string;
  config?: Partial<AnyConnectionConfig>;
}

interface ExecuteQueryOptions {
  projectId?: string;
  config?: Partial<AnyConnectionConfig>;
}

interface ValidateOptions {
  projectId?: string;
  config?: Partial<AnyConnectionConfig>;
}

interface ListNamespacesOptions {
  projectId?: string;
  config?: Partial<AnyConnectionConfig>;
}

// ─── fetchSchema ──────────────────────────────────────────────────────────────

export async function fetchSchema(
  dataSource: DataSourceType,
  options: FetchSchemaOptions = {}
): Promise<TableSchema[]> {
  const { projectId, datasetId, database, schemaName, tableName, config } = options;

  switch (dataSource) {
    case 'bigquery': {
      const pid = projectId || process.env.BIGQUERY_PROJECT_ID || '';
      const did = datasetId || '';
      if (tableName) return [await bqGetTableSchema(pid, did, tableName)];
      return bqGetDatasetSchema(pid, did);
    }

    case 'azuresql': {
      if (tableName && schemaName) {
        return [await getAzureSQLTableSchema(tableName, schemaName, config as Parameters<typeof getAzureSQLTableSchema>[2])];
      }
      return getAzureSQLDatabaseSchema(config as Parameters<typeof getAzureSQLDatabaseSchema>[0], schemaName);
    }

    case 'redshift': {
      const schema = schemaName || 'public';
      if (tableName) return [await getRedshiftTableSchema(tableName, schema, config as Parameters<typeof getRedshiftTableSchema>[2])];
      return getRedshiftDatabaseSchema(config as Parameters<typeof getRedshiftDatabaseSchema>[0], schema);
    }

    case 'mysql':
      return fetchMySQLSchema(database, tableName, config as Parameters<typeof fetchMySQLSchema>[2]);

    case 'postgresql':
      return fetchPostgreSQLSchema(schemaName, tableName, config as Parameters<typeof fetchPostgreSQLSchema>[2]);

    case 'snowflake': {
      const snowflake = await import('./snowflake.service');
      return snowflake.fetchSnowflakeSchema(schemaName, tableName, config as Parameters<typeof snowflake.fetchSnowflakeSchema>[2]);
    }

    case 'databricks':
      return fetchDatabricksSchema(schemaName, tableName, config as Parameters<typeof fetchDatabricksSchema>[2]);

    case 'airtable':
      return fetchAirtableSchema(tableName, config as Parameters<typeof fetchAirtableSchema>[1]);

    default:
      throw new Error(`Unsupported data source: ${dataSource}`);
  }
}

// ─── executeQuery ─────────────────────────────────────────────────────────────

export async function executeQuery(
  dataSource: DataSourceType,
  sql: string,
  options: ExecuteQueryOptions = {}
): Promise<QueryResult> {
  const { projectId, config } = options;

  switch (dataSource) {
    case 'bigquery':
      return bqExecuteQuery(sql, projectId || process.env.BIGQUERY_PROJECT_ID);

    case 'azuresql':
      return executeAzureSQLQuery(sql, config as Parameters<typeof executeAzureSQLQuery>[1]);

    case 'redshift':
      return executeRedshiftQuery(sql, config as Parameters<typeof executeRedshiftQuery>[1]);

    case 'mysql':
      return executeMySQLQuery(sql, config as Parameters<typeof executeMySQLQuery>[1]);

    case 'postgresql':
      return executePostgreSQLQuery(sql, config as Parameters<typeof executePostgreSQLQuery>[1]);

    case 'snowflake': {
      const snowflake = await import('./snowflake.service');
      return snowflake.executeSnowflakeQuery(sql, config as Parameters<typeof snowflake.executeSnowflakeQuery>[1]);
    }

    case 'databricks':
      return executeDatabricksQuery(sql, config as Parameters<typeof executeDatabricksQuery>[1]);

    case 'airtable':
      return executeAirtableQuery(sql, config as Parameters<typeof executeAirtableQuery>[1]);

    default:
      throw new Error(`Unsupported data source: ${dataSource}`);
  }
}

// ─── listNamespaces ───────────────────────────────────────────────────────────

export async function listNamespaces(
  dataSource: DataSourceType,
  options: ListNamespacesOptions = {}
): Promise<string[]> {
  const { projectId, config } = options;

  switch (dataSource) {
    case 'bigquery':
      return bqListDatasets(projectId || process.env.BIGQUERY_PROJECT_ID || '');

    case 'azuresql':
      return listAzureSQLSchemas(config as Parameters<typeof listAzureSQLSchemas>[0]);

    case 'redshift':
      return listRedshiftSchemas(config as Parameters<typeof listRedshiftSchemas>[0]);

    case 'mysql':
      return listMySQLDatabases(config as Parameters<typeof listMySQLDatabases>[0]);

    case 'postgresql':
      return listPostgreSQLSchemas(config as Parameters<typeof listPostgreSQLSchemas>[0]);

    case 'snowflake': {
      const snowflake = await import('./snowflake.service');
      return snowflake.listSnowflakeSchemas(config as Parameters<typeof snowflake.listSnowflakeSchemas>[0]);
    }

    case 'databricks':
      return listDatabricksSchemas(config as Parameters<typeof listDatabricksSchemas>[0]);

    case 'airtable':
      return listAirtableTables(config as Parameters<typeof listAirtableTables>[0]);

    default:
      throw new Error(`Unsupported data source: ${dataSource}`);
  }
}

// ─── validateConnection ───────────────────────────────────────────────────────

export async function validateConnection(
  dataSource: DataSourceType,
  options: ValidateOptions = {}
): Promise<boolean> {
  const { projectId, config } = options;

  switch (dataSource) {
    case 'bigquery':
      return bqValidateConnection(projectId || process.env.BIGQUERY_PROJECT_ID || '');

    case 'azuresql':
      return validateAzureSQLConnection(config as Parameters<typeof validateAzureSQLConnection>[0]);

    case 'redshift':
      return validateRedshiftConnection(config as Parameters<typeof validateRedshiftConnection>[0]);

    case 'mysql':
      return validateMySQLConnection(config as Parameters<typeof validateMySQLConnection>[0]);

    case 'postgresql':
      return validatePostgreSQLConnection(config as Parameters<typeof validatePostgreSQLConnection>[0]);

    case 'snowflake': {
      const snowflake = await import('./snowflake.service');
      return snowflake.validateSnowflakeConnection(config as Parameters<typeof snowflake.validateSnowflakeConnection>[0]);
    }

    case 'databricks':
      return validateDatabricksConnection(config as Parameters<typeof validateDatabricksConnection>[0]);

    case 'airtable':
      return validateAirtableConnection(config as Parameters<typeof validateAirtableConnection>[0]);

    default:
      return false;
  }
}
