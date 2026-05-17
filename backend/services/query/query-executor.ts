import { validateAndExecuteSQL as validateAndExecuteBigQuerySQL } from '../data_sources/bigquery.service';
import { executeAirtableQuery } from '../data_sources/airtable.service';
import { validateAndExecuteSQL as validateAndExecuteRedshiftSQL } from '../data_sources/redshift.service';
import { validateAndExecuteSQL as validateAndExecuteSQLServerSQL } from '../data_sources/azuresql.service';
import { validateAndExecuteSQL as validateAndExecuteSnowflakeSQL } from '../data_sources/snowflake.service';
import { validateAndExecuteSQL as validateAndExecuteMySQLSQL } from '../data_sources/mysql.service';
import { validateAndExecuteSQL as validateAndExecutePostgreSQLSQL } from '../data_sources/postgresql.service';
import { validateAndExecuteSQL as validateAndExecuteDatabricksSQL } from '../data_sources/databricks.service';

export type DataSourceType = 'bigquery' | 'airtable' | 'redshift' | 'azure' | 'snowflake' | 'mysql' | 'postgres' | 'databricks';

export interface QueryResult {
    [key: string]: any;
}

export interface DataSourceConfig {
    type: DataSourceType;
    bigquery?: {
        projectId: string;
        serviceAccountKey: string;
    };
    airtable?: {
        apiKey: string;
        baseId: string;
    };
    redshift?: {
        host?: string;
        port?: number;
        database: string;
        username: string;
        password: string;
        schema?: string;
    };
    azure?: {
        server?: string;
        host?: string;
        database: string;
        username: string;
        password: string;
        schema?: string;
        port?: number;
    };
    snowflake?: {
        account: string;
        warehouse: string;
        database: string;
        schema: string;
        username: string;
        password: string;
    };
    mysql?: {
        host?: string;
        port?: number;
        database: string;
        username: string;
        password: string;
        schema?: string;
    };
    postgres?: {
        host?: string;
        port?: number;
        database: string;
        username: string;
        password: string;
        schema?: string;
    };
    databricks?: {
        serverHostname?: string;
        host?: string;
        server?: string;
        httpPath?: string;
        accessToken?: string;
        token?: string;
        database?: string;
        schema?: string;
        connectionMethod?: 'host' | 'url';
        jdbcUrl?: string;
        tokenName?: string;
        clientId?: string;
        clientSecret?: string;
    };
}

/**
 * Unified query executor that routes queries to the appropriate data source
 */
export class QueryExecutor {
    /**
     * Execute a query based on the data source type
     */
    static async executeQuery(
        query: string,
        dataSourceConfig: DataSourceConfig
    ): Promise<QueryResult[]> {
        switch (dataSourceConfig.type) {
            case 'bigquery':
                if (!dataSourceConfig.bigquery) {
                    throw new Error('BigQuery configuration is required');
                }
                return await validateAndExecuteBigQuerySQL(
                    query,
                    dataSourceConfig.bigquery
                );

            case 'airtable':
                if (!dataSourceConfig.airtable) {
                    throw new Error('Airtable configuration is required');
                }
                return (await executeAirtableQuery(query, dataSourceConfig.airtable)).rows as QueryResult[];

            case 'azure':
                if (!dataSourceConfig.azure) {
                    throw new Error('Azure SQL configuration is required');
                }
                return await validateAndExecuteSQLServerSQL(query, dataSourceConfig.azure);

            case 'redshift':
                if (!dataSourceConfig.redshift) {
                    throw new Error('Redshift configuration is required');
                }
                return await validateAndExecuteRedshiftSQL(query, dataSourceConfig.redshift);

            case 'mysql':
                if (!dataSourceConfig.mysql) {
                    throw new Error('MySQL configuration is required');
                }
                return await validateAndExecuteMySQLSQL(query, dataSourceConfig.mysql);

            case 'postgres':
                if (!dataSourceConfig.postgres) {
                    throw new Error('PostgreSQL configuration is required');
                }
                return await validateAndExecutePostgreSQLSQL(query, dataSourceConfig.postgres);

            case 'databricks':
                if (!dataSourceConfig.databricks) {
                    throw new Error('Databricks configuration is required');
                }
                return await validateAndExecuteDatabricksSQL(query, dataSourceConfig.databricks);

            case 'snowflake':
                if (!dataSourceConfig.snowflake) {
                    throw new Error('Snowflake configuration is required');
                }
                return await validateAndExecuteSnowflakeSQL(query, dataSourceConfig.snowflake);

            default:
                throw new Error(`Unsupported data source type: ${dataSourceConfig.type}`);
        }
    }
}
    /**
     * Get schema information for a data source
     */
//     static async getSchema(
//         dataSourceConfig: DataSourceConfig,
//         tableName?: string
//     ): Promise<any> {
//         switch (dataSourceConfig.type) {
//             case 'airtable':
//                 if (!dataSourceConfig.airtable) {
//                     throw new Error('Airtable configuration is required');
//                 }
//                 if (!tableName) {
//                     throw new Error('Table name is required for Airtable schema');
//                 }
//                 const airtableClient = createAirtableClient(dataSourceConfig.airtable);
//                 return await airtableClient.getTableSchema(tableName);

//             case 'bigquery':
//                 // BigQuery schema is provided in the LLM helper
//                 return null;

//             default:
//                 throw new Error(`Unsupported data source type: ${dataSourceConfig.type}`);
//         }
//     }
// }