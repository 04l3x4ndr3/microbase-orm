class PostgreSQLDriver {
    constructor(connection, config = {}) {
        this.connection = connection;
        this.config = config;
        this.schema = this.extractSchemaFromOptions(config.options);
    }

    extractSchemaFromOptions(options) {
        if (!options) return 'public';

        const match = options.match(/--search_path=([^,\s]+)/);
        return match ? match[1] : 'public';
    }

    escapeIdentifier(identifier) {
        // Se o identificador já contém schema, não modificar
        if (identifier.includes('.')) {
            return identifier.split('.').map(part => `"${part.replace(/"/g, '""')}"`).join('.');
        }
        return `"${identifier.replace(/"/g, '""')}"`;
    }

    escapeValue(value) {
        if (value === null) return 'NULL';
        if (typeof value === 'string') {
            return `'${value.replace(/'/g, "''")}'`;
        }
        if (typeof value === 'number') return value.toString();
        if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
        if (value instanceof Date) {
            return `'${value.toISOString()}'`;
        }
        return `'${String(value).replace(/'/g, "''")}'`;
    }

    async execute(sql, params = []) {
        try {
            // Converter placeholders MySQL (?) para PostgreSQL ($1, $2, etc.)
            let paramIndex = 1;
            const convertedSql = sql.replace(/\?/g, () => `$${paramIndex++}`);

            console.log('🔍 SQL Debug:', convertedSql);
            console.log('📝 Params:', params);
            console.log('🗄️  Schema:', this.schema);

            let result;

            // Verificar se é um pool ou conexão única
            if (this.connection.query) {
                // Pool ou cliente direto
                result = await this.connection.query(convertedSql, params);
            } else {
                // Pode ser um pool que precisa de getConnection
                const client = await this.connection.connect();
                try {
                    result = await client.query(convertedSql, params);
                } finally {
                    client.release();
                }
            }

            return result.rows;
        } catch (error) {
            const pgError = this.handlePostgreSQLError(error, sql);
            throw pgError;
        }
    }

    handlePostgreSQLError(error, sql) {
        const errorCode = error.code;
        const errorMessage = error.message;

        switch (errorCode) {
            case '42P01': // undefined_table
                return new Error(`Tabela não encontrada no schema '${this.schema}'. Verifique se a tabela existe: ${errorMessage}`);

            case '42703': // undefined_column
                return new Error(`Coluna não encontrada: ${errorMessage}`);

            case '3F000': // invalid_schema_name
                return new Error(`Schema '${this.schema}' não encontrado: ${errorMessage}`);

            case '23505': // unique_violation
                return new Error(`Violação de chave única: ${errorMessage}`);

            case '23503': // foreign_key_violation
                return new Error(`Violação de chave estrangeira: ${errorMessage}`);

            case '23502': // not_null_violation
                return new Error(`Violação de NOT NULL: ${errorMessage}`);

            case '08006': // connection_failure
                return new Error(`Falha na conexão com o banco: ${errorMessage}`);

            case '08001': // sqlclient_unable_to_establish_sqlconnection
                return new Error(`Não foi possível estabelecer conexão: ${errorMessage}`);

            case '28P01': // invalid_password
                return new Error(`Senha inválida para o banco de dados: ${errorMessage}`);

            case '3D000': // invalid_catalog_name
                return new Error(`Banco de dados não encontrado: ${errorMessage}`);

            case '42601': // syntax_error
                return new Error(`Erro de sintaxe SQL: ${errorMessage}\nSQL: ${sql}`);

            default:
                return new Error(`PostgreSQL Error [${errorCode}]: ${errorMessage}\nSQL: ${sql}`);
        }
    }

    getLimitSyntax(limit, offset = 0) {
        return `LIMIT ${limit} OFFSET ${offset}`;
    }

    getRandomFunction() {
        return 'RANDOM()';
    }

    // Método para verificar se uma tabela existe no schema específico
    async tableExists(tableName) {
        try {
            const result = await this.execute(
                `SELECT EXISTS (SELECT *
                                FROM information_schema.tables
                                WHERE table_schema = $1
                                  AND table_name = $2);`, [this.schema, tableName]);

            return result[0]?.exists;
        } catch (error) {
            return false;
        }
    }

    // Método para listar todas as tabelas do schema
    async listTables() {
        try {
            const result = await this.execute(`
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = $1
                  AND table_type = 'BASE TABLE'
                ORDER BY table_name;
            `, [this.schema]);

            return result.map(row => row.table_name);
        } catch (error) {
            throw new Error(`Erro ao listar tabelas no schema '${this.schema}': ${error.message}`);
        }
    }

    // Método para descrever uma tabela no schema específico
    async describeTable(tableName) {
        try {
            const result = await this.execute(`
                SELECT column_name,
                       data_type,
                       is_nullable,
                       column_default,
                       character_maximum_length
                FROM information_schema.columns
                WHERE table_schema = $1
                  AND table_name = $2
                ORDER BY ordinal_position;
            `, [this.schema, tableName]);

            return result;
        } catch (error) {
            throw new Error(`Erro ao descrever tabela ${this.schema}.${tableName}: ${error.message}`);
        }
    }

    // Método para verificar se o schema existe
    async schemaExists() {
        try {
            const result = await this.execute(`
                SELECT EXISTS (SELECT
                               FROM information_schema.schemata
                               WHERE schema_name = $1);
            `, [this.schema]);

            return result[0].exists;
        } catch (error) {
            return false;
        }
    }

    // Método para criar schema se não existir
    async createSchemaIfNotExists() {
        try {
            await this.execute(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
            return true;
        } catch (error) {
            throw new Error(`Erro ao criar schema '${this.schema}': ${error.message}`);
        }
    }
}

export default PostgreSQLDriver;
