class MySQLDriver {
    constructor(connection, config = {}) {
        this.connection = connection;
        this.config = config;
        this.isPool = !!config.max;
        this.DEBUG = config.debug || false;
        this.driverId = this.generateDriverId();

        // ✅ Proteção contra recursão melhorada
        this.errorDepth = 0;
        this.maxErrorDepth = 10;

        // ✅ Cache de prepared statements
        this.preparedStatements = new Map();
        this.maxPreparedStatements = config.maxPreparedStatements || 100;

        // ✅ Métricas do driver
        this.metrics = {
            queriesExecuted: 0,
            preparedStatementsUsed: 0,
            errorsCount: 0,
            avgQueryTime: 0,
            lastQueryTime: null,
            slowQueries: 0,
            slowQueryThreshold: config.slowQueryThreshold || 1000
        };

        // ✅ Rate limiting para logs
        this.logRateLimit = new Map();
        this.maxLogsPerMinute = config.maxLogsPerMinute || 10;

        // ✅ Query timeout
        this.queryTimeout = config.queryTimeout || 30000;

        console.log(`🔧 MySQLDriver inicializado [ID: ${this.driverId}] - Pool: ${this.isPool}`);
    }

    // ✅ Gerador de ID único
    generateDriverId() {
        return `mysql_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    // ✅ Escape melhorado com cache
    escapeIdentifier(identifier) {
        // Cache para identifiers comuns
        const cacheKey = `ident_${identifier}`;
        if (this.preparedStatements.has(cacheKey)) {
            return this.preparedStatements.get(cacheKey);
        }

        const [table, field] = identifier.split('.');
        let escaped;

        if (table && field) {
            escaped = `\`${table.replace(/`/g, '``')}\`.\`${field.replace(/`/g, '``')}\``;
        } else {
            escaped = `\`${identifier.replace(/`/g, '``')}\``;
        }

        // Adicionar ao cache se não estiver cheio
        if (this.preparedStatements.size < this.maxPreparedStatements) {
            this.preparedStatements.set(cacheKey, escaped);
        }

        return escaped;
    }

    // ✅ Escape de valores melhorado com tipos específicos
    escapeValue(value) {
        if (value === null || value === undefined) return 'NULL';

        if (typeof value === 'string') {
            return `'${value.replace(/[\x00\x1a\n\r"'\\]/g, (char) => {
                switch (char) {
                    case '\x00': return '\\0';
                    case '\x1a': return '\\Z';
                    case '\n': return '\\n';
                    case '\r': return '\\r';
                    case '"': return '\\"';
                    case "'": return "\\'";
                    case '\\': return '\\\\';
                    default: return char;
                }
            })}'`;
        }

        if (typeof value === 'number') {
            if (Number.isNaN(value)) return 'NULL';
            if (!Number.isFinite(value)) return 'NULL';
            return value.toString();
        }

        if (typeof value === 'boolean') return value ? '1' : '0';

        if (value instanceof Date) {
            if (isNaN(value.getTime())) return 'NULL';
            return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
        }

        if (Buffer.isBuffer(value)) {
            return `X'${value.toString('hex')}'`;
        }

        if (Array.isArray(value)) {
            return `'${JSON.stringify(value).replace(/'/g, "\\'")}'`;
        }

        if (typeof value === 'object') {
            return `'${JSON.stringify(value).replace(/'/g, "\\'")}'`;
        }

        return `'${String(value).replace(/'/g, "\\'")}'`;
    }

    // ✅ Execute com melhorias de performance e monitoramento
    async execute(sql, params = []) {
        // Proteção contra stack overflow
        if (this.errorDepth > this.maxErrorDepth) {
            throw new Error('Stack overflow detectado - muitos erros aninhados');
        }

        const queryId = this.generateQueryId();
        const startTime = Date.now();

        try {
            // ✅ Rate limiting para debug logs
            if (this.DEBUG && this._shouldLog('debug')) {
                console.log(`🔍 MySQL SQL Debug [${queryId}]:`, this._sanitizeForLog(sql));
                console.log(`📝 MySQL Params [${queryId}]:`, this._sanitizeParams(params));
                console.log(`🏊‍♂️ Using Pool [${queryId}]:`, this.isPool);
            }

            // ✅ Timeout da query
            const queryPromise = this.connection.execute(sql, params);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`Query timeout após ${this.queryTimeout}ms`)), this.queryTimeout);
            });

            const result = await Promise.race([queryPromise, timeoutPromise]);

            // ✅ Atualizar métricas
            const duration = Date.now() - startTime;
            this._updateMetrics(duration);

            // ✅ Log de queries lentas
            if (duration > this.metrics.slowQueryThreshold) {
                this.metrics.slowQueries++;
                if (this._shouldLog('slow')) {
                    console.warn(`🐌 Slow query detected [${queryId}] - ${duration}ms: ${this._sanitizeForLog(sql)}`);
                }
            }

            return result;

        } catch (error) {
            const duration = Date.now() - startTime;
            this._updateMetrics(duration, true);

            // ✅ Error handling melhorado
            throw this.handleMySQLError(error, sql, queryId);
        }
    }

    // ✅ Gerador de ID para queries
    generateQueryId() {
        return `q_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    }

    // ✅ Rate limiting para logs
    _shouldLog(type) {
        const now = Date.now();
        const minute = Math.floor(now / 60000);
        const key = `${type}_${minute}`;

        if (!this.logRateLimit.has(key)) {
            this.logRateLimit.set(key, 0);
        }

        const count = this.logRateLimit.get(key);
        if (count < this.maxLogsPerMinute) {
            this.logRateLimit.set(key, count + 1);
            return true;
        }

        return false;
    }

    // ✅ Sanitização para logs
    _sanitizeForLog(sql) {
        if (!sql) return sql;
        // Truncar queries muito longas e remover dados sensíveis
        let sanitized = sql.length > 200 ? sql.substring(0, 200) + '...' : sql;
        // Remover possíveis senhas ou dados sensíveis
        sanitized = sanitized.replace(/password\s*=\s*['"][^'"]*['"]/gi, 'password=***');
        return sanitized;
    }

    _sanitizeParams(params) {
        if (!Array.isArray(params)) return params;
        // Sanitizar parâmetros que podem conter dados sensíveis
        return params.map((param, index) => {
            if (typeof param === 'string' && param.length > 100) {
                return `${param.substring(0, 100)}... [${param.length} chars]`;
            }
            return param;
        });
    }

    // ✅ Atualização de métricas
    _updateMetrics(duration, isError = false) {
        this.metrics.queriesExecuted++;
        this.metrics.lastQueryTime = duration;

        if (isError) {
            this.metrics.errorsCount++;
        } else {
            // Atualizar média de tempo de query (moving average)
            if (this.metrics.avgQueryTime === 0) {
                this.metrics.avgQueryTime = duration;
            } else {
                this.metrics.avgQueryTime = (this.metrics.avgQueryTime * 0.9) + (duration * 0.1);
            }
        }
    }

    // ✅ Tratamento de erro melhorado e mais específico
    handleMySQLError(error, sql, queryId = null) {
        this.errorDepth++;

        try {
            const errorCode = error.code || 'UNKNOWN';
            const errno = error.errno || 0;
            const sqlState = error.sqlState || 'UNKNOWN';
            const errorMessage = String(error.message || error.toString() || 'Erro desconhecido');

            const logPrefix = queryId ? `[${queryId}]` : '';

            switch (errorCode) {
                case 'ER_NO_SUCH_TABLE':
                case 'ER_BAD_TABLE_ERROR':
                    return new Error(`Tabela não encontrada ${logPrefix}: ${errorMessage}`);

                case 'ER_BAD_FIELD_ERROR':
                    return new Error(`Coluna não encontrada ${logPrefix}: ${errorMessage}`);

                case 'ER_DUP_ENTRY':
                    const duplicateMatch = errorMessage.match(/Duplicate entry '(.+)' for key '(.+)'/);
                    if (duplicateMatch) {
                        return new Error(`Violação de chave única ${logPrefix}: Valor '${duplicateMatch[1]}' já existe para '${duplicateMatch[2]}'`);
                    }
                    return new Error(`Violação de chave única ${logPrefix}: ${errorMessage}`);

                case 'ER_NO_REFERENCED_ROW_2':
                    return new Error(`Violação de chave estrangeira ${logPrefix}: ${errorMessage}`);

                case 'ER_ROW_IS_REFERENCED_2':
                    return new Error(`Não é possível deletar: registro referenciado por chave estrangeira ${logPrefix}: ${errorMessage}`);

                case 'ER_BAD_NULL_ERROR':
                    const nullMatch = errorMessage.match(/Column '(.+)' cannot be null/);
                    if (nullMatch) {
                        return new Error(`Campo obrigatório ${logPrefix}: '${nullMatch[1]}' não pode ser NULL`);
                    }
                    return new Error(`Violação de NOT NULL ${logPrefix}: ${errorMessage}`);

                case 'ER_ACCESS_DENIED_ERROR':
                    return new Error(`Acesso negado ${logPrefix}: Verifique usuário e senha: ${errorMessage}`);

                case 'ER_BAD_DB_ERROR':
                    return new Error(`Banco de dados não encontrado ${logPrefix}: ${errorMessage}`);

                case 'ER_CON_COUNT_ERROR':
                    return new Error(`Muitas conexões ativas ${logPrefix}: ${errorMessage}`);

                case 'ER_PARSE_ERROR':
                case 'ER_SYNTAX_ERROR':
                    return new Error(`Erro de sintaxe SQL ${logPrefix}: ${errorMessage}\nSQL: ${this._sanitizeForLog(sql)}`);

                case 'ER_DATA_TOO_LONG':
                    const dataMatch = errorMessage.match(/Data too long for column '(.+)' at row (\d+)/);
                    if (dataMatch) {
                        return new Error(`Dados muito longos ${logPrefix}: Campo '${dataMatch[1]}' na linha ${dataMatch[2]}`);
                    }
                    return new Error(`Dados muito longos ${logPrefix}: ${errorMessage}`);

                case 'ER_TRUNCATED_WRONG_VALUE':
                    return new Error(`Valor inválido ${logPrefix}: ${errorMessage}`);

                case 'ER_OUT_OF_RANGE_VALUE':
                    return new Error(`Valor fora do intervalo permitido ${logPrefix}: ${errorMessage}`);

                // Erros de conexão
                case 'ECONNREFUSED':
                    return new Error(`Conexão recusada ${logPrefix}: Verifique se o MySQL está rodando: ${errorMessage}`);

                case 'ENOTFOUND':
                    return new Error(`Host não encontrado ${logPrefix}: ${errorMessage}`);

                case 'ETIMEDOUT':
                    return new Error(`Timeout de conexão ${logPrefix}: ${errorMessage}`);

                case 'ECONNRESET':
                    return new Error(`Conexão foi resetada ${logPrefix}: ${errorMessage}`);

                case 'PROTOCOL_CONNECTION_LOST':
                    return new Error(`Conexão perdida com o MySQL ${logPrefix}: ${errorMessage}`);

                case 'PROTOCOL_ENQUEUE_AFTER_QUIT':
                    return new Error(`Tentativa de usar conexão após desconectar ${logPrefix}: ${errorMessage}`);

                case 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR':
                    return new Error(`Tentativa de usar conexão após erro fatal ${logPrefix}: ${errorMessage}`);

                // Erros de transação e lock
                case 'ER_LOCK_WAIT_TIMEOUT':
                    return new Error(`Timeout de lock ${logPrefix}: ${errorMessage}`);

                case 'ER_LOCK_DEADLOCK':
                    return new Error(`Deadlock detectado ${logPrefix}: Transação foi revertida automaticamente`);

                case 'ER_LOCK_TABLE_FULL':
                    return new Error(`Tabela de locks cheia ${logPrefix}: ${errorMessage}`);

                // Erros específicos do Pool
                case 'ER_POOL_CLOSED':
                    return new Error(`Pool de conexões foi fechado ${logPrefix}: ${errorMessage}`);

                case 'ER_GET_CONNECTION_TIMEOUT':
                    return new Error(`Timeout ao obter conexão do pool ${logPrefix}: ${errorMessage}`);

                // Erros de permissão
                case 'ER_TABLEACCESS_DENIED_ERROR':
                    return new Error(`Acesso negado à tabela ${logPrefix}: ${errorMessage}`);

                case 'ER_COLUMNACCESS_DENIED_ERROR':
                    return new Error(`Acesso negado à coluna ${logPrefix}: ${errorMessage}`);

                // Erros de espaço
                case 'ER_DISK_FULL':
                    return new Error(`Disco cheio ${logPrefix}: ${errorMessage}`);

                case 'ER_OUT_OF_MEMORY':
                    return new Error(`Memória insuficiente ${logPrefix}: ${errorMessage}`);

                default:
                    // Log detalhado para erros desconhecidos
                    if (this._shouldLog('unknown_error')) {
                        console.error(`❌ MySQL Error desconhecido ${logPrefix}:`, {
                            code: errorCode,
                            errno,
                            sqlState,
                            message: errorMessage,
                            sql: this._sanitizeForLog(sql)
                        });
                    }

                    return new Error(`MySQL Error ${logPrefix} [${errorCode}/${errno}/${sqlState}]: ${errorMessage}`);
            }
        } finally {
            this.errorDepth--;
        }
    }

    // ✅ Métodos de sintaxe SQL melhorados
    getLimitSyntax(limit, offset = 0) {
        const limitNum = parseInt(limit);
        const offsetNum = parseInt(offset);

        if (isNaN(limitNum) || limitNum < 0) {
            throw new Error('LIMIT deve ser um número não negativo');
        }

        if (isNaN(offsetNum) || offsetNum < 0) {
            throw new Error('OFFSET deve ser um número não negativo');
        }

        if (offsetNum > 0) {
            return `LIMIT ${offsetNum}, ${limitNum}`;
        }
        return `LIMIT ${limitNum}`;
    }

    getRandomFunction() {
        return 'RAND()';
    }

    // ✅ Método para verificar se uma tabela existe com cache
    async tableExists(tableName) {
        const cacheKey = `table_exists_${tableName}`;

        try {
            const result = await this.execute(`
                SELECT COUNT(*) as count
                FROM information_schema.tables
                WHERE table_schema = DATABASE()
                  AND table_name = ?`, [tableName]);

            return result[0]?.count > 0;
        } catch (error) {
            if (this._shouldLog('table_check_error')) {
                console.error(`❌ Erro ao verificar existência da tabela ${tableName}:`, error.message);
            }
            return false;
        }
    }

    // ✅ Método para listar todas as tabelas com cache
    async listTables() {
        try {
            const result = await this.execute(`
                SELECT table_name, table_comment, table_rows, data_length
                FROM information_schema.tables
                WHERE table_schema = DATABASE()
                  AND table_type = 'BASE TABLE'
                ORDER BY table_name`);

            return result.map(row => ({
                name: row.table_name,
                comment: row.table_comment || null,
                rows: row.table_rows || 0,
                size: row.data_length || 0
            }));
        } catch (error) {
            throw new Error(`Erro ao listar tabelas: ${error.message}`);
        }
    }

    // ✅ Método para descrever uma tabela com informações detalhadas
    async describeTable(tableName) {
        try {
            const result = await this.execute(`
                SELECT 
                    column_name as Field,
                    column_type as Type,
                    is_nullable as \`Null\`,
                    column_key as \`Key\`,
                    column_default as \`Default\`,
                    extra as Extra,
                    column_comment as Comment,
                    ordinal_position as Position
                FROM information_schema.columns
                WHERE table_schema = DATABASE()
                  AND table_name = ?
                ORDER BY ordinal_position`, [tableName]);

            return result.map(col => ({
                Field: col.Field,
                Type: col.Type,
                Null: col.Null === 'YES' ? 'YES' : 'NO',
                Key: col.Key || '',
                Default: col.Default,
                Extra: col.Extra || '',
                Comment: col.Comment || '',
                Position: col.Position
            }));
        } catch (error) {
            throw new Error(`Erro ao descrever tabela ${tableName}: ${error.message}`);
        }
    }

    // ✅ Método para obter informações do banco melhorado
    async getDatabaseInfo() {
        try {
            const [version] = await this.execute('SELECT VERSION() as version');
            const [charset] = await this.execute('SELECT @@character_set_database as charset');
            const [collation] = await this.execute('SELECT @@collation_database as collation');
            const [timezone] = await this.execute('SELECT @@time_zone as timezone');
            const [maxConnections] = await this.execute('SELECT @@max_connections as max_connections');

            return {
                version: version.version,
                charset: charset.charset,
                collation: collation.collation,
                timezone: timezone.timezone,
                maxConnections: maxConnections.max_connections,
                driverId: this.driverId
            };
        } catch (error) {
            throw new Error(`Erro ao obter informações do banco: ${error.message}`);
        }
    }

    // ✅ Método para obter estatísticas de performance melhorado
    async getPerformanceStats() {
        try {
            const stats = await this.execute(`
                SHOW STATUS WHERE Variable_name IN (
                    'Connections',
                    'Threads_connected',
                    'Threads_running',
                    'Questions',
                    'Slow_queries',
                    'Uptime',
                    'Bytes_sent',
                    'Bytes_received',
                    'Com_select',
                    'Com_insert',
                    'Com_update',
                    'Com_delete',
                    'Innodb_buffer_pool_pages_data',
                    'Innodb_buffer_pool_pages_free',
                    'Innodb_buffer_pool_read_requests',
                    'Innodb_buffer_pool_reads'
                )
            `);

            const result = {};
            stats.forEach(stat => {
                result[stat.Variable_name.toLowerCase()] = stat.Value;
            });

            // ✅ Adicionar métricas do driver
            result.driver_metrics = this.getDriverMetrics();

            return result;
        } catch (error) {
            throw new Error(`Erro ao obter estatísticas: ${error.message}`);
        }
    }

    // ✅ Novo método para obter métricas do driver
    getDriverMetrics() {
        return {
            ...this.metrics,
            driverId: this.driverId,
            preparedStatementsCount: this.preparedStatements.size,
            isPool: this.isPool
        };
    }

    // ✅ Método para verificar status da conexão melhorado
    async ping() {
        try {
            const startTime = Date.now();
            await this.execute('SELECT 1 as ping');
            const responseTime = Date.now() - startTime;

            return {
                status: 'ok',
                responseTime,
                timestamp: Date.now()
            };
        } catch (error) {
            return {
                status: 'error',
                error: error.message,
                timestamp: Date.now()
            };
        }
    }

    // ✅ Método para backup de tabela melhorado
    async backupTable(tableName, options = {}) {
        try {
            const timestamp = options.timestamp || Date.now();
            const suffix = options.suffix || 'backup';
            const backupTableName = `${tableName}_${suffix}_${timestamp}`;

            const escapedBackupName = this.escapeIdentifier(backupTableName);
            const escapedTableName = this.escapeIdentifier(tableName);

            // ✅ Verificar se a tabela original existe
            const tableExists = await this.tableExists(tableName);
            if (!tableExists) {
                throw new Error(`Tabela original ${tableName} não existe`);
            }

            // ✅ Criar estrutura e copiar dados
            if (options.structureOnly) {
                await this.execute(`CREATE TABLE ${escapedBackupName} LIKE ${escapedTableName}`);
            } else {
                await this.execute(`CREATE TABLE ${escapedBackupName} AS SELECT * FROM ${escapedTableName}`);
            }

            // ✅ Verificar se o backup foi criado
            const backupExists = await this.tableExists(backupTableName);
            if (!backupExists) {
                throw new Error(`Falha ao criar tabela de backup ${backupTableName}`);
            }

            console.log(`✅ Backup da tabela ${tableName} criado como ${backupTableName}`);

            return {
                originalTable: tableName,
                backupTable: backupTableName,
                timestamp: Date.now(),
                structureOnly: !!options.structureOnly
            };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Erro ao criar backup da tabela ${tableName}: ${errorMsg}`);
        }
    }

    // ✅ Método para otimizar tabela melhorado
    async optimizeTable(tableName) {
        try {
            const result = await this.execute(`OPTIMIZE TABLE ??`, [tableName]);

            return {
                table: tableName,
                operation: 'optimize',
                result: result[0],
                timestamp: Date.now()
            };
        } catch (error) {
            throw new Error(`Erro ao otimizar tabela ${tableName}: ${error.message}`);
        }
    }

    // ✅ Método para analisar tabela melhorado
    async analyzeTable(tableName) {
        try {
            const result = await this.execute(`ANALYZE TABLE ??`, [tableName]);

            return {
                table: tableName,
                operation: 'analyze',
                result: result[0],
                timestamp: Date.now()
            };
        } catch (error) {
            throw new Error(`Erro ao analisar tabela ${tableName}: ${error.message}`);
        }
    }

    // ✅ Novo método para verificar e reparar tabela
    async checkTable(tableName, options = {}) {
        try {
            const checkType = options.type || 'QUICK'; // QUICK, FAST, MEDIUM, EXTENDED
            const result = await this.execute(`CHECK TABLE ?? ${checkType}`, [tableName]);

            return {
                table: tableName,
                operation: 'check',
                type: checkType,
                result: result[0],
                timestamp: Date.now()
            };
        } catch (error) {
            throw new Error(`Erro ao verificar tabela ${tableName}: ${error.message}`);
        }
    }

    async repairTable(tableName) {
        try {
            const result = await this.execute(`REPAIR TABLE ??`, [tableName]);

            return {
                table: tableName,
                operation: 'repair',
                result: result[0],
                timestamp: Date.now()
            };
        } catch (error) {
            throw new Error(`Erro ao reparar tabela ${tableName}: ${error.message}`);
        }
    }

    // ✅ Limpeza de cache e recursos
    clearCache() {
        this.preparedStatements.clear();
        this.logRateLimit.clear();
        console.log(`🧹 Cache limpo para MySQLDriver [${this.driverId}]`);
    }

    // ✅ Informações do driver
    getDriverInfo() {
        return {
            driverId: this.driverId,
            type: 'MySQL',
            isPool: this.isPool,
            debug: this.DEBUG,
            metrics: this.getDriverMetrics(),
            cacheSize: this.preparedStatements.size,
            maxCacheSize: this.maxPreparedStatements
        };
    }


}

export default MySQLDriver;
