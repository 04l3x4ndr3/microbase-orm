class MySQLDriver {
    constructor(connection, config = {}) {
        this.connection = connection;
        this.config = config;
        this.isPool = !!config.max;
        this.DEBUG = config.debug || false;
        // ✅ Adicionar proteção contra recursão
        this.errorDepth = 0;
        this.maxErrorDepth = 10;
    }

    escapeIdentifier(identifier) {
        const [table, field] = identifier.split('.');
        if (table && field) return `\`${table.replace(/`/g, '``')}\`.\`${field.replace(/`/g, '``')}\``;
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
        // ✅ Proteção contra stack overflow
        if (this.errorDepth > this.maxErrorDepth) {
            throw new Error('Stack overflow detectado - muitos erros aninhados');
        }

        try {
            if (this.DEBUG) {
                console.log('🔍 MySQL SQL Debug:', sql);
                console.log('📝 MySQL Params:', params);
                console.log('🏊‍♂️ Using Pool:', this.isPool);
            }
            return await this.connection.execute(sql, params);
        } catch (error) {
            throw this.handleMySQLError(error, sql);
        }
    }

    handleMySQLError(error, sql) {
        const errorCode = error.code || 'UNKNOWN';
        const errno = error.errno || 0;
        const errorMessage = String(error.message || error.toString() || 'Erro desconhecido');

        switch (errorCode) {
            case 'ER_NO_SUCH_TABLE':
            case 'ER_BAD_TABLE_ERROR':
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

            case 'ER_CON_COUNT_ERROR':
                return new Error(`Muitas conexões ativas: ${errorMessage}`);

            case 'ER_PARSE_ERROR':
                return new Error(`Erro de sintaxe SQL: ${errorMessage}\nSQL: ${sql}`);

            case 'ECONNREFUSED':
                return new Error(`Conexão recusada: Verifique se o MySQL está rodando: ${errorMessage}`);

            case 'ENOTFOUND':
                return new Error(`Host não encontrado: ${errorMessage}`);

            case 'PROTOCOL_CONNECTION_LOST':
                return new Error(`Conexão perdida com o MySQL: ${errorMessage}`);

            case 'PROTOCOL_ENQUEUE_AFTER_QUIT':
                return new Error(`Tentativa de usar conexão após desconectar: ${errorMessage}`);

            case 'ER_LOCK_WAIT_TIMEOUT':
                return new Error(`Timeout de lock: ${errorMessage}`);

            case 'ER_LOCK_DEADLOCK':
                return new Error(`Deadlock detectado: ${errorMessage}`);

            // Erros específicos do Pool
            case 'ER_POOL_CLOSED':
                return new Error(`Pool de conexões foi fechado: ${errorMessage}`);

            case 'ER_GET_CONNECTION_TIMEOUT':
                return new Error(`Timeout ao obter conexão do pool: ${errorMessage}`);

            default:
                return new Error(`MySQL Error [${errorCode}/${errno}]: ${errorMessage}\nSQL: ${sql}`);
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

    // Método para verificar se uma tabela existe
    async tableExists(tableName) {
        try {
            const result = await this.execute(`
                SELECT COUNT(*) as count
                FROM information_schema.tables
                WHERE table_schema = DATABASE()
                  AND table_name = ?`, [tableName]);

            return result[0].count > 0;
        } catch (error) {
            return false;
        }
    }

    // Método para listar todas as tabelas
    async listTables() {
        try {
            const result = await this.execute(
                `SELECT table_name
                 FROM information_schema.tables
                 WHERE table_schema = DATABASE()
                 ORDER BY table_name`);

            return result.map(row => row.table_name);
        } catch (error) {
            throw new Error(`Erro ao listar tabelas: ${error.message}`);
        }
    }

    // Método para descrever uma tabela
    async describeTable(tableName) {
        try {
            return await this.execute(`DESCRIBE ??`, [tableName]);
        } catch (error) {
            throw new Error(`Erro ao descrever tabela ${tableName}: ${error.message}`);
        }
    }

    // Método para obter informações do banco
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

    // Método para obter estatísticas de performance
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

    // Método para verificar status da conexão
    async ping() {
        try {
            await this.execute('SELECT 1 as ping');
            return true;
        } catch (error) {
            return false;
        }
    }

    // Método para backup de tabela
    async backupTable(tableName) {
        try {
            const backupTableName = `${tableName}_backup_${Date.now()}`;

            // ✅ Usar escape manual em vez de placeholder para DDL
            const escapedBackupName = this.escapeIdentifier(backupTableName);
            const escapedTableName = this.escapeIdentifier(tableName);

            await this.execute(`CREATE TABLE ${escapedBackupName} AS
            SELECT *
            FROM ${escapedTableName}`);
            return backupTableName;
        } catch (error) {
            // ✅ Evitar recursão - não referenciar error.message diretamente
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Erro ao criar backup da tabela ${tableName}: ${errorMsg}`);
        }
    }

    // Método para otimizar tabela
    async optimizeTable(tableName) {
        try {
            const result = await this.execute(`OPTIMIZE TABLE ??`, [tableName]);
            return result[0];
        } catch (error) {
            throw new Error(`Erro ao otimizar tabela ${tableName}: ${error.message}`);
        }
    }

    // Método para analisar tabela
    async analyzeTable(tableName) {
        try {
            const result = await this.execute(`ANALYZE TABLE ??`, [tableName]);
            return result[0];
        } catch (error) {
            throw new Error(`Erro ao analisar tabela ${tableName}: ${error.message}`);
        }
    }
}

export default MySQLDriver;
