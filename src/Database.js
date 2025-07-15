import Connection from './database/Connection.js';
import QueryBuilder from './QueryBuilder.js';

class Database {
    constructor(config) {
        this.config = {
            driver: 'mysql',
            host: 'localhost',
            username: 'root',
            password: '',
            database: '',
            port: null,
            ssl: false,
            connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 30000,
            max: null, // Pool size
            options: null, // Opções específicas do driver
            ...config
        };
        this.connection = null;
        this.queryBuilder = null;
        this.connectionManager = null;
    }

    async connect() {
        if (!this.connection) {
            this.connectionManager = new Connection(this.config);
            this.connection = await this.connectionManager.connect();
            this.queryBuilder = new QueryBuilder(this.connection, this.config.driver, this.config);
        }
        return this.connection;
    }

    async disconnect() {
        if (this.connectionManager) {
            await this.connectionManager.disconnect();
            this.connection = null;
            this.queryBuilder = null;
            this.connectionManager = null;
        }
    }


    select(fields = '*') {
        this.ensureConnected();
        return new QueryBuilder(this.connection, this.config.driver, this.config).select(fields);
    }

    from(table) {
        this.ensureConnected();
        return new QueryBuilder(this.connection, this.config.driver, this.config).from(table);
    }

    where(field, value = null, operator = '=') {
        this.ensureConnected();
        return new QueryBuilder(this.connection, this.config.driver, this.config).where(field, value, operator);
    }


    async insert(table, data) {
        this.ensureConnected();
        return await new QueryBuilder(this.connection, this.config.driver, this.config).insert(table, data);
    }

    async update(table, data, where = null) {
        this.ensureConnected();
        return await new QueryBuilder(this.connection, this.config.driver, this.config).update(table, data, where);
    }

    async delete(table, where = null) {
        this.ensureConnected();
        return await new QueryBuilder(this.connection, this.config.driver, this.config).delete(table, where);
    }

    async query(sql, params = []) {
        this.ensureConnected();
        return await new QueryBuilder(this.connection, this.config.driver, this.config).query(sql, params);
    }


    ensureConnected() {
        if (!this.connection) {
            throw new Error('Conexão com banco não estabelecida. Chame connect() primeiro.');
        }
    }

    // Método para obter uma instância limpa do QueryBuilder
    builder() {
        this.ensureConnected();
        return new QueryBuilder(this.connection, this.config.driver, this.config);
    }

    // Verificar se uma tabela existe
    async tableExists(tableName) {
        this.ensureConnected();
        const builder = new QueryBuilder(this.connection, this.config.driver, this.config);

        if (this.config.driver === 'postgres') {
            return await builder.driver.tableExists(tableName);
        } else if (this.config.driver === 'mysql') {
            try {
                const result = await this.query(`
                    SELECT COUNT(*) as count 
                    FROM information_schema.tables 
                    WHERE table_schema = DATABASE() 
                    AND table_name = ?
                `, [tableName]);
                return result[0].count > 0;
            } catch (error) {
                return false;
            }
        }
        return false;
    }

    // Listar todas as tabelas
    async listTables() {
        this.ensureConnected();
        const builder = new QueryBuilder(this.connection, this.config.driver, this.config);

        if (this.config.driver === 'postgres') {
            return await builder.driver.listTables();
        } else if (this.config.driver === 'mysql') {
            const result = await this.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = DATABASE()
                ORDER BY table_name
            `);
            return result.map(row => row.table_name || row.TABLE_NAME);
        }
        return [];
    }

    // Descrever estrutura de uma tabela
    async describeTable(tableName) {
        this.ensureConnected();
        const builder = new QueryBuilder(this.connection, this.config.driver, this.config);

        if (this.config.driver === 'postgres') {
            return await builder.driver.describeTable(tableName);
        } else if (this.config.driver === 'mysql') {
            return await this.query(`DESCRIBE ${tableName}`);
        }
        return [];
    }

    // Verificar se o schema existe (PostgreSQL)
    async schemaExists() {
        if (this.config.driver === 'postgres') {
            this.ensureConnected();
            const builder = new QueryBuilder(this.connection, this.config.driver, this.config);
            return await builder.driver.schemaExists();
        }
        return true; // MySQL não tem schemas separados
    }

    // Executar script SQL (múltiplas queries)
    async executeScript(script) {
        this.ensureConnected();
        const queries = script.split(';').filter(q => q.trim());
        const results = [];

        for (const query of queries) {
            if (query.trim()) {
                try {
                    const result = await this.query(query.trim());
                    results.push(result);
                } catch (error) {
                    console.error(`Erro ao executar query: ${query}`);
                    throw error;
                }
            }
        }

        return results;
    }


    // Método para debug - mostrar último SQL executado
    getLastQuery() {
        if (this.queryBuilder) return this.queryBuilder.getLastQuery();
        return null;
    }

    // Método para testar conexão
    async testConnection() {
        try {
            await this.connect();
            await this.query('SELECT 1 as test');
            return true;
        } catch (error) {
            console.error('Erro no teste de conexão:', error.message);
            return false;
        }
    }

    // Método para obter informações da conexão
    getConnectionInfo() {
        return {
            driver: this.config.driver,
            host: this.config.host,
            port: this.config.port,
            database: this.config.database,
            schema: this.config.driver === 'postgres' ?
                this.config.options?.match(/--search_path=([^,\s]+)/)?.[1] || 'public' :
                null,
            poolSize: this.config.max,
            ssl: this.config.ssl
        };
    }
}

export default Database;
