class MariaDBDriver {
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

        // ✅ Métricas específicas do MariaDB
        this.metrics = {
            queriesExecuted: 0,
            preparedStatementsUsed: 0,
            errorsCount: 0,
            avgQueryTime: 0,
            lastQueryTime: null,
            slowQueries: 0,
            slowQueryThreshold: config.slowQueryThreshold || 1000,
            batchOperations: 0,
            transactionOperations: 0
        };

        // ✅ Rate limiting para logs
        this.logRateLimit = new Map();
        this.maxLogsPerMinute = config.maxLogsPerMinute || 10;

        // ✅ Query timeout específico para MariaDB
        this.queryTimeout = config.queryTimeout || 30000;

        // ✅ Configurações específicas do MariaDB
        this.mariadbFeatures = {
            supportsBulkInsert: true,
            supportsWindowFunctions: true,
            supportsCommonTableExpressions: true,
            supportsJSON: true
        };

        console.log(`🔧 MariaDBDriver inicializado [ID: ${this.driverId}] - Pool: ${this.isPool}`);
    }

    // ✅ Gerador de ID único
    generateDriverId() {
        return `mariadb_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    // ✅ Escape melhorado com validação
    escapeIdentifier(identifier) {
        if (!identifier) {
            throw new Error('Identifier não pode ser vazio');
        }

        // Cache para identifiers comuns
        const cacheKey = `ident_${identifier}`;
        if (this.preparedStatements.has(cacheKey)) {
            return this.preparedStatements.get(cacheKey);
        }

        const [table, field] = identifier.split('.');
        let escaped;

        if (table && field) {
            // Validar nomes de tabela e campo
            this._validateIdentifier(table);
            this._validateIdentifier(field);
            escaped = `\`${table.replace(/`/g, '``')}\`.\`${field.replace(/`/g, '``')}\``;
        } else {
            this._validateIdentifier(identifier);
            escaped = `\`${identifier.replace(/`/g, '``')}\``;
        }

        // Adicionar ao cache se não estiver cheio
        if (this.preparedStatements.size < this.maxPreparedStatements) {
            this.preparedStatements.set(cacheKey, escaped);
        }

        return escaped;
    }

    // ✅ Validação de identificadores
    _validateIdentifier(identifier) {
        // MariaDB tem limites específicos para nomes
        if (identifier.length > 64) {
            throw new Error(`Nome de identificador muito longo (máximo 64 caracteres): ${identifier}`);
        }

        // Verificar caracteres válidos
        if (!/^[a-zA-Z0-9_$]+$/.test(identifier)) {
            throw new Error(`Identificador contém caracteres inválidos: ${identifier}`);
        }
    }

    // ✅ Escape de valores com suporte a tipos específicos do MariaDB
    escapeValue(value) {
        if (value === null || value === undefined) return 'NULL';

        if (typeof value === 'string') {
            // Escape específico para MariaDB
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

        // ✅ Suporte a JSON nativo do MariaDB
        if (Array.isArray(value) || (typeof value === 'object' && value.constructor === Object)) {
            return `CAST('${JSON.stringify(value).replace(/'/g, "\\'")}' AS JSON)`;
        }

        if (typeof value === 'object') {
            return `'${JSON.stringify(value).replace(/'/g, "\\'")}'`;
        }

        return `'${String(value).replace(/'/g, "\\'")}'`;
    }

    // ✅ Execute com melhorias específicas do MariaDB
    async execute(sql, params = []) {
        if (this.errorDepth > this.maxErrorDepth) {
            throw new Error('Stack overflow detectado - muitos erros aninhados');
        }

        const queryId = this.generateQueryId();
        const startTime = Date.now();

        try {
            if (this.DEBUG && this._shouldLog('debug')) {
                console.log(`🔍 MariaDB SQL Debug [${queryId}]:`, this._sanitizeForLog(sql));
                console.log(`📝 MariaDB Params [${queryId}]:`, this._sanitizeParams(params));
                console.log(`🏊‍♂️ Using Pool [${queryId}]:`, this.isPool);
            }

            // ✅ Detecção de operações específicas
            this._detectOperationType(sql);

            // ✅ Timeout específico para MariaDB
            const queryPromise = this._executeWithMariaDBOptimizations(sql, params);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`MariaDB Query timeout após ${this.queryTimeout}ms`)), this.queryTimeout);
            });

            const result = await Promise.race([queryPromise, timeoutPromise]);

            const duration = Date.now() - startTime;
            this._updateMetrics(duration);

            if (duration > this.metrics.slowQueryThreshold) {
                this.metrics.slowQueries++;
                if (this._shouldLog('slow')) {
                    console.warn(`🐌 Slow MariaDB query detected [${queryId}] - ${duration}ms: ${this._sanitizeForLog(sql)}`);
                }
            }

            return result;

        } catch (error) {
            const duration = Date.now() - startTime;
            this._updateMetrics(duration, true);
            throw this.handleMariaDBError(error, sql, queryId);
        }
    }

    // ✅ Otimizações específicas do MariaDB
    async _executeWithMariaDBOptimizations(sql, params) {
        // ✅ Usar prepared statements quando possível
        if (params.length > 0 && this._shouldUsePreparedStatement(sql)) {
            this.metrics.preparedStatementsUsed++;
            return await this.connection.execute(sql, params);
        }

        // ✅ Para queries sem parâmetros ou casos especiais
        return await this.connection.query(sql, params);
    }

    _shouldUsePreparedStatement(sql) {
        // Usar prepared statements para INSERT, UPDATE, DELETE com parâmetros
        return /^(INSERT|UPDATE|DELETE|SELECT)\s/i.test(sql.trim());
    }

    _detectOperationType(sql) {
        const trimmedSql = sql.trim().toUpperCase();

        if (trimmedSql.startsWith('INSERT') && trimmedSql.includes('VALUES')) {
            // Detectar batch inserts
            const valuesCount = (sql.match(/\),\s*\(/g) || []).length + 1;
            if (valuesCount > 1) {
                this.metrics.batchOperations++;
            }
        }

        if (trimmedSql.includes('BEGIN') || trimmedSql.includes('COMMIT') || trimmedSql.includes('ROLLBACK')) {
            this.metrics.transactionOperations++;
        }
    }

    generateQueryId() {
        return `mdb_q_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    }

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

    _sanitizeForLog(sql) {
        if (!sql) return sql;
        let sanitized = sql.length > 300 ? sql.substring(0, 300) + '...' : sql;
        sanitized = sanitized.replace(/password\s*=\s*['"][^'"]*['"]/gi, 'password=***');
        return sanitized;
    }

    _sanitizeParams(params) {
        if (!Array.isArray(params)) return params;
        return params.map((param, index) => {
            if (typeof param === 'string' && param.length > 150) {
                return `${param.substring(0, 150)}... [${param.length} chars]`;
            }
            return param;
        });
    }

    _updateMetrics(duration, isError = false) {
        this.metrics.queriesExecuted++;
        this.metrics.lastQueryTime = duration;

        if (isError) {
            this.metrics.errorsCount++;
        } else {
            if (this.metrics.avgQueryTime === 0) {
                this.metrics.avgQueryTime = duration;
            } else {
                this.metrics.avgQueryTime = (this.metrics.avgQueryTime * 0.9) + (duration * 0.1);
            }
        }
    }

    // ✅ Tratamento de erro específico para MariaDB
    handleMariaDBError(error, sql, queryId = null) {
        this.errorDepth++;

        try {
            const errorCode = error.code || 'UNKNOWN';
            const errno = error.errno || 0;
            const sqlState = error.sqlState || 'UNKNOWN';
            const errorMessage = String(error.message || error.toString() || 'Erro desconhecido');

            const logPrefix = queryId ? `[${queryId}]` : '';

            switch (errorCode) {
                case 'ER_NO_SUCH_TABLE':
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
                    return new Error(`Não é possível deletar: registro referenciado ${logPrefix}: ${errorMessage}`);

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

                case 'ER_PARSE_ERROR':
                case 'ER_SYNTAX_ERROR':
                    return new Error(`Erro de sintaxe SQL ${logPrefix}: ${errorMessage}\nSQL: ${this._sanitizeForLog(sql)}`);

                case 'ER_DATA_TOO_LONG':
                    return new Error(`Dados muito longos ${logPrefix}: ${errorMessage}`);

                case 'ER_LOCK_WAIT_TIMEOUT':
                    return new Error(`Timeout de lock ${logPrefix}: ${errorMessage}`);

                case 'ER_LOCK_DEADLOCK':
                    return new Error(`Deadlock detectado ${logPrefix}: Transação foi revertida automaticamente`);

                // Erros específicos de conexão MariaDB
                case 'ECONNREFUSED':
                    return new Error(`Conexão recusada ${logPrefix}: Verifique se o MariaDB está rodando: ${errorMessage}`);

                case 'ENOTFOUND':
                    return new Error(`Host não encontrado ${logPrefix}: ${errorMessage}`);

                case 'ETIMEDOUT':
                    return new Error(`Timeout de conexão MariaDB ${logPrefix}: ${errorMessage}`);

                // Erros específicos do MariaDB
                case 'ER_INVALID_JSON_TEXT':
                    return new Error(`JSON inválido ${logPrefix}: ${errorMessage}`);

                case 'ER_JSON_DOCUMENT_TOO_DEEP':
                    return new Error(`Documento JSON muito profundo ${logPrefix}: ${errorMessage}`);

                case 'ER_WINDOW_FUNCTION_IN_WRONG_CONTEXT':
                    return new Error(`Window function em contexto incorreto ${logPrefix}: ${errorMessage}`);

                default:
                    if (this._shouldLog('unknown_error')) {
                        console.error(`❌ MariaDB Error desconhecido ${logPrefix}:`, {
                            code: errorCode,
                            errno,
                            sqlState,
                            message: errorMessage,
                            sql: this._sanitizeForLog(sql)
                        });
                    }

                    return new Error(`MariaDB Error ${logPrefix} [${errorCode}/${errno}/${sqlState}]: ${errorMessage}`);
            }
        } finally {
            this.errorDepth--;
        }
    }

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

    // ✅ Verificação de tabela com cache
    async tableExists(tableName) {
        try {
            const result = await this.execute(`
                SELECT COUNT(*) as count
                FROM information_schema.tables
                WHERE table_schema = DATABASE()
                  AND table_name = ?
                  AND table_type = 'BASE TABLE'`, [tableName]);

            return result[0]?.count > 0;
        } catch (error) {
            if (this._shouldLog('table_check_error')) {
                console.error(`❌ Erro ao verificar existência da tabela ${tableName}:`, error.message);
            }
            return false;
        }
    }

    // ✅ Listar tabelas com informações extras
    async listTables() {
        try {
            const result = await this.execute(`
                SELECT 
                    table_name,
                    table_comment,
                    table_rows,
                    data_length,
                    index_length,
                    engine,
                    table_collation,
                    create_time,
                    update_time
                FROM information_schema.tables
                WHERE table_schema = DATABASE()
                  AND table_type = 'BASE TABLE'
                ORDER BY table_name`);

            return result.map(row => ({
                name: row.table_name,
                comment: row.table_comment || null,
                rows: row.table_rows || 0,
                dataSize: row.data_length || 0,
                indexSize: row.index_length || 0,
                engine: row.engine,
                collation: row.table_collation,
                created: row.create_time,
                updated: row.update_time
            }));
        } catch (error) {
            throw new Error(`Erro ao listar tabelas: ${error.message}`);
        }
    }

    // ✅ Descrição detalhada de tabela
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
                    ordinal_position as Position,
                    data_type as DataType,
                    character_maximum_length as MaxLength,
                    numeric_precision as NumericPrecision,
                    numeric_scale as NumericScale
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
                Position: col.Position,
                DataType: col.DataType,
                MaxLength: col.MaxLength,
                NumericPrecision: col.NumericPrecision,
                NumericScale: col.NumericScale
            }));
        } catch (error) {
            throw new Error(`Erro ao descrever tabela ${tableName}: ${error.message}`);
        }
    }

    // ✅ Informações do banco específicas do MariaDB
    async getDatabaseInfo() {
        try {
            const [version] = await this.execute('SELECT VERSION() as version');
            const [charset] = await this.execute('SELECT @@character_set_database as charset');
            const [collation] = await this.execute('SELECT @@collation_database as collation');
            const [timezone] = await this.execute('SELECT @@time_zone as timezone');
            const [maxConnections] = await this.execute('SELECT @@max_connections as max_connections');
            const [innodbVersion] = await this.execute('SELECT @@innodb_version as innodb_version');

            return {
                version: version.version,
                charset: charset.charset,
                collation: collation.collation,
                timezone: timezone.timezone,
                maxConnections: maxConnections.max_connections,
                innodbVersion: innodbVersion.innodb_version,
                driverId: this.driverId,
                features: this.mariadbFeatures
            };
        } catch (error) {
            throw new Error(`Erro ao obter informações do banco: ${error.message}`);
        }
    }

    // ✅ Estatísticas específicas do MariaDB
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
                    'Innodb_buffer_pool_reads',
                    'Aria_pagecache_reads',
                    'Aria_pagecache_read_requests'
                )
            `);

            const result = {};
            stats.forEach(stat => {
                result[stat.Variable_name.toLowerCase()] = stat.Value;
            });

            result.driver_metrics = this.getDriverMetrics();
            return result;
        } catch (error) {
            throw new Error(`Erro ao obter estatísticas: ${error.message}`);
        }
    }

    getDriverMetrics() {
        return {
            ...this.metrics,
            driverId: this.driverId,
            preparedStatementsCount: this.preparedStatements.size,
            isPool: this.isPool,
            features: this.mariadbFeatures
        };
    }

    // ✅ Ping melhorado para MariaDB
    async ping() {
        try {
            const startTime = Date.now();
            await this.execute('SELECT 1 as ping');
            const responseTime = Date.now() - startTime;

            return {
                status: 'ok',
                responseTime,
                timestamp: Date.now(),
                driver: 'MariaDB'
            };
        } catch (error) {
            return {
                status: 'error',
                error: error.message,
                timestamp: Date.now(),
                driver: 'MariaDB'
            };
        }
    }

    // ✅ Backup melhorado com opções específicas do MariaDB
    async backupTable(tableName, options = {}) {
        try {
            const timestamp = options.timestamp || Date.now();
            const suffix = options.suffix || 'backup';
            const backupTableName = `${tableName}_${suffix}_${timestamp}`;

            const escapedBackupName = this.escapeIdentifier(backupTableName);
            const escapedTableName = this.escapeIdentifier(tableName);

            const tableExists = await this.tableExists(tableName);
            if (!tableExists) {
                throw new Error(`Tabela original ${tableName} não existe`);
            }

            if (options.structureOnly) {
                await this.execute(`CREATE TABLE ${escapedBackupName} LIKE ${escapedTableName}`);
            } else {
                // ✅ Para MariaDB, usar ENGINE específico se fornecido
                let createSql = `CREATE TABLE ${escapedBackupName}`;

                if (options.engine) {
                    createSql += ` ENGINE=${options.engine}`;
                }

                createSql += ` AS SELECT * FROM ${escapedTableName}`;

                if (options.whereClause) {
                    createSql += ` WHERE ${options.whereClause}`;
                }

                await this.execute(createSql);
            }

            const backupExists = await this.tableExists(backupTableName);
            if (!backupExists) {
                throw new Error(`Falha ao criar tabela de backup ${backupTableName}`);
            }

            console.log(`✅ Backup MariaDB da tabela ${tableName} criado como ${backupTableName}`);

            return {
                originalTable: tableName,
                backupTable: backupTableName,
                timestamp: Date.now(),
                structureOnly: !!options.structureOnly,
                engine: options.engine || null,
                whereClause: options.whereClause || null
            };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Erro ao criar backup da tabela ${tableName}: ${errorMsg}`);
        }
    }

    async optimizeTable(tableName) {
        try {
            const result = await this.execute(`OPTIMIZE TABLE ??`, [tableName]);

            return {
                table: tableName,
                operation: 'optimize',
                result: result[0],
                timestamp: Date.now(),
                driver: 'MariaDB'
            };
        } catch (error) {
            throw new Error(`Erro ao otimizar tabela ${tableName}: ${error.message}`);
        }
    }

    async analyzeTable(tableName) {
        try {
            const result = await this.execute(`ANALYZE TABLE ??`, [tableName]);

            return {
                table: tableName,
                operation: 'analyze',
                result: result[0],
                timestamp: Date.now(),
                driver: 'MariaDB'
            };
        } catch (error) {
            throw new Error(`Erro ao analisar tabela ${tableName}: ${error.message}`);
        }
    }

    // ✅ Métodos específicos do MariaDB
    async checkTable(tableName, options = {}) {
        try {
            const checkType = options.type || 'QUICK';
            const result = await this.execute(`CHECK TABLE ?? ${checkType}`, [tableName]);

            return {
                table: tableName,
                operation: 'check',
                type: checkType,
                result: result[0],
                timestamp: Date.now(),
                driver: 'MariaDB'
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
                timestamp: Date.now(),
                driver: 'MariaDB'
            };
        } catch (error) {
            throw new Error(`Erro ao reparar tabela ${tableName}: ${error.message}`);
        }
    }

    // ✅ Suporte a Window Functions (MariaDB 10.2+)
    async supportsWindowFunctions() {
        try {
            await this.execute('SELECT ROW_NUMBER() OVER (ORDER BY 1) as test_window FROM (SELECT 1) as t');
            return true;
        } catch (error) {
            return false;
        }
    }

    // ✅ Suporte a Common Table Expressions (MariaDB 10.2+)
    async supportsCommonTableExpressions() {
        try {
            await this.execute('WITH cte AS (SELECT 1 as test) SELECT test FROM cte');
            return true;
        } catch (error) {
            return false;
        }
    }

    // ✅ Teste de funcionalidades JSON (MariaDB 10.2+)
    async supportsJSON() {
        try {
            await this.execute("SELECT JSON_VALID('{}') as test");
            return true;
        } catch (error) {
            return false;
        }
    }

    // ✅ Limpeza de recursos
    clearCache() {
        this.preparedStatements.clear();
        this.logRateLimit.clear();
        console.log(`🧹 Cache limpo para MariaDBDriver [${this.driverId}]`);
    }

    getDriverInfo() {
        return {
            driverId: this.driverId,
            type: 'MariaDB',
            isPool: this.isPool,
            debug: this.DEBUG,
            metrics: this.getDriverMetrics(),
            cacheSize: this.preparedStatements.size,
            maxCacheSize: this.maxPreparedStatements,
            features: this.mariadbFeatures
        };
    }
}

export default MariaDBDriver;
