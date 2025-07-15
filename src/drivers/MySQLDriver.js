class MySQLDriver {
    constructor(connection, config = {}) {
        this.connection = connection;
        this.config = config;
        this.isPool = !!config.max;
        this.DEBUG = config.debug || false;
        this.errorDepth = 0;
        this.maxErrorDepth = 10;
    }

    escapeIdentifier(identifier) {
        if (!identifier) throw new Error('Identifier não pode ser vazio');
        return `\`${identifier.replace(/`/g, '``')}\``;
    }

    escapeValue(value) {
        if (value === null || value === undefined) return 'NULL';
        if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`;
        if (typeof value === 'number') return value.toString();
        if (typeof value === 'boolean') return value ? '1' : '0';
        if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
        return `'${String(value).replace(/'/g, "\\'")}'`;
    }

    async beginTransaction() {
        try {
            await this.execute('START TRANSACTION');
            if (this.DEBUG) console.log('🔄 Transação iniciada');
        } catch (error) {
            throw new Error(`Não foi possível iniciar a transação: ${error.message}`);
        }
    }

    async commitTransaction() {
        try {
            await this.execute('COMMIT');
            if (this.DEBUG) console.log('✅ Transação confirmada');
        } catch (error) {
            throw new Error(`Não foi possível confirmar a transação: ${error.message}`);
        }
    }

    async rollbackTransaction() {
        try {
            await this.execute('ROLLBACK');
            if (this.DEBUG) console.log('⛔ Transação revertida');
        } catch (error) {
            throw new Error(`Não foi possível reverter a transação: ${error.message}`);
        }
    }

    async execute(sql, params = []) {
        if (this.errorDepth > this.maxErrorDepth) throw new Error('Stack overflow detectado - muitos erros aninhados');
        try {
            if (this.DEBUG) {
                console.log('🔍 MySQL SQL Debug:', sql);
                console.log('📝 MySQL Params:', params);
                console.log('🏊‍♂️ Using Pool:', this.isPool);
            }
            return await this.connection.execute(sql, params);
        } catch (error) {
            throw this._handleDBError(error, sql);
        }
    }

    getLimitSyntax(limit, offset = 0) {
        const limitNum = parseInt(limit);
        const offsetNum = parseInt(offset);
        if (isNaN(limitNum) || limitNum < 0) throw new Error('LIMIT deve ser um número não negativo');
        if (isNaN(offsetNum) || offsetNum < 0) throw new Error('OFFSET deve ser um número não negativo');
        if (offset > 0) return `LIMIT ${offset}, ${limit}`;
        return `LIMIT ${limit}`;
    }

    getRandomFunction() {
        return 'RAND()';
    }

    async tableExists(tableName) {
        try {
            const result = await this.execute(`SELECT 1
                                               FROM information_schema.tables
                                               WHERE table_schema = DATABASE()
                                                 AND table_name = ?`, [tableName]);
            return result.count > 0;
        } catch (error) {
            return false;
        }
    }

    async listTables() {
        try {
            const result = await this.execute(`SELECT table_name
                                               FROM information_schema.tables
                                               WHERE table_schema = DATABASE()
                                               ORDER BY table_name`);
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
            const [version, charset, collation] = await this.execute(`SELECT
            (SELECT VERSION()) as version,
            (SELECT @@character_set_database) as charset,
            (SELECT @@collation_database) as collation;`);
            return {version, charset, collation};
        } catch (error) {
            throw new Error(`Erro ao obter informações do banco: ${error.message}`);
        }
    }

    _handleDBError(error, sql) {
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
            case 'ER_POOL_CLOSED':
                return new Error(`Pool de conexões foi fechado: ${errorMessage}`);
            case 'ER_GET_CONNECTION_TIMEOUT':
                return new Error(`Timeout ao obter conexão do pool: ${errorMessage}`);
            default:
                return new Error(`MySQL Error [${errorCode}/${errno}]: ${errorMessage}\nSQL: ${sql}`);
        }
    }
}

export default MySQLDriver;
