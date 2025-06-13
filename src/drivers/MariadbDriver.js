class MariaDBDriver {
    constructor(connection, config = {}) {
        this.connection = connection;
        this.config = config;
        this.isPool = !!config.max;
        this.DEBUG = config.debug || false;
    }

    escapeIdentifier(identifier) {
        return `\`${identifier.replace(/`/g, '``')}\``;
    }

    escapeValue(value) {
        if (value === null) return 'NULL';
        if (typeof value === 'string') {
            return `'${value.replace(/'/g, "\\'")}'`;
        }
        if (typeof value === 'number') return value.toString();
        if (typeof value === 'boolean') return value ? '1' : '0';
        if (value instanceof Date) {
            return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
        }
        return `'${String(value).replace(/'/g, "\\'")}'`;
    }

    async execute(sql, params = []) {
        try {
            if (this.DEBUG) {
                console.log('🔍 MariaDB SQL Debug:', sql);
                console.log('📝 MariaDB Params:', params);
                console.log('🏊‍♂️ Using Pool:', this.isPool);
            }
            const [rows] = await this.connection.execute(sql, params);
            return rows;
        } catch (error) {
            throw this.handleMariaDBError(error, sql);
        }
    }

    handleMariaDBError(error, sql) {
        const errorCode = error.code;
        const errno = error.errno;
        const errorMessage = error.message;

        switch (errorCode) {
            case 'ER_NO_SUCH_TABLE':
                return new Error(`Tabela não encontrada: ${errorMessage}`);
            case 'ER_BAD_FIELD_ERROR':
                return new Error(`Coluna não encontrada: ${errorMessage}`);
            case 'ER_DUP_ENTRY':
                return new Error(`Violação de chave única: ${errorMessage}`);
            case 'ER_NO_REFERENCED_ROW_2':
                return new Error(`Violação de chave estrangeira: ${errorMessage}`);
            case 'ER_BAD_NULL_ERROR':
                return new Error(`Violação de NOT NULL: ${errorMessage}`);
            case 'ER_ACCESS_DENIED_ERROR':
                return new Error(`Acesso negado: Verifique usuário e senha: ${errorMessage}`);
            case 'ER_BAD_DB_ERROR':
                return new Error(`Banco de dados não encontrado: ${errorMessage}`);
            case 'ER_PARSE_ERROR':
                return new Error(`Erro de sintaxe SQL: ${errorMessage}\nSQL: ${sql}`);
            case 'ECONNREFUSED':
                return new Error(`Conexão recusada: Verifique se o MariaDB está rodando: ${errorMessage}`);
            default:
                return new Error(`MariaDB Error (${errorCode}/${errno}): ${errorMessage}\nSQL: ${sql}`);
        }
    }

    getLimitSyntax(limit, offset = 0) {
        if (offset > 0) {
            return `LIMIT ${offset}, ${limit}`;
        }
        return `LIMIT ${limit}`;
    }

    getRandomFunction() {
        return 'RAND()';
    }

    async tableExists(tableName) {
        try {
            const result = await this.execute(`
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

    async listTables() {
        try {
            const result = await this.execute(`
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = DATABASE()
                ORDER BY table_name
            `);

            return result.map(row => row.table_name);
        } catch (error) {
            throw new Error(`Erro ao listar tabelas: ${error.message}`);
        }
    }

    async describeTable(tableName) {
        try {
            return await this.execute(`DESCRIBE ??`, [tableName]);
        } catch (error) {
            throw new Error(`Erro ao descrever tabela ${tableName}: ${error.message}`);
        }
    }

    async getDatabaseInfo() {
        try {
            const [version] = await this.execute('SELECT VERSION() as version');
            const [charset] = await this.execute('SELECT @@character_set_database as charset');
            const [collation] = await this.execute('SELECT @@collation_database as collation');

            return {
                version: version.version,
                charset: charset.charset,
                collation: collation.collation
            };
        } catch (error) {
            throw new Error(`Erro ao obter informações do banco: ${error.message}`);
        }
    }

    async getPerformanceStats() {
        try {
            const stats = await this.execute(`
                SHOW STATUS WHERE Variable_name IN (
                    'Connections',
                    'Threads_connected',
                    'Threads_running',
                    'Questions',
                    'Slow_queries',
                    'Uptime'
                )
            `);

            const result = {};
            stats.forEach(stat => {
                result[stat.Variable_name.toLowerCase()] = stat.Value;
            });

            return result;
        } catch (error) {
            throw new Error(`Erro ao obter estatísticas: ${error.message}`);
        }
    }

    async ping() {
        try {
            await this.execute('SELECT 1 as ping');
            return true;
        } catch (error) {
            return false;
        }
    }

    async backupTable(tableName) {
        try {
            const backupTableName = `${tableName}_backup_${Date.now()}`;
            await this.execute(`CREATE TABLE ?? AS SELECT * FROM ??`, [backupTableName, tableName]);
            return backupTableName;
        } catch (error) {
            throw new Error(`Erro ao criar backup da tabela ${tableName}: ${error.message}`);
        }
    }

    async optimizeTable(tableName) {
        try {
            const result = await this.execute(`OPTIMIZE TABLE ??`, [tableName]);
            return result[0];
        } catch (error) {
            throw new Error(`Erro ao otimizar tabela ${tableName}: ${error.message}`);
        }
    }

    async analyzeTable(tableName) {
        try {
            const result = await this.execute(`ANALYZE TABLE ??`, [tableName]);
            return result[0];
        } catch (error) {
            throw new Error(`Erro ao analisar tabela ${tableName}: ${error.message}`);
        }
    }
}

export default MariaDBDriver;
