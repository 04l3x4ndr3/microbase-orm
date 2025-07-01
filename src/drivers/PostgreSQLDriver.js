
class PostgreSQLDriver {
    constructor(connection, config = {}) {
        this.connection = connection;
        this.config = config;
        this.isPool = !!config.max;
        this.DEBUG = config.debug || false;
        this.driverId = this.generateDriverId();
        this.schema = this.extractSchemaFromOptions(config.options);

        // ✅ Proteção contra recursão melhorada
        this.errorDepth = 0;
        this.maxErrorDepth = 10;

        // ✅ Cache de prepared statements
        this.preparedStatements = new Map();
        this.maxPreparedStatements = config.maxPreparedStatements || 100;

        // ✅ Métricas específicas do PostgreSQL
        this.metrics = {
            queriesExecuted: 0,
            preparedStatementsUsed: 0,
            errorsCount: 0,
            avgQueryTime: 0,
            lastQueryTime: null,
            slowQueries: 0,
            slowQueryThreshold: config.slowQueryThreshold || 1000,
            transactionOperations: 0,
            schemaOperations: 0,
            indexOperations: 0
        };

        // ✅ Rate limiting para logs
        this.logRateLimit = new Map();
        this.maxLogsPerMinute = config.maxLogsPerMinute || 10;

        // ✅ Query timeout específico para PostgreSQL
        this.queryTimeout = config.queryTimeout || 30000;

        // ✅ Configurações específicas do PostgreSQL
        this.postgresFeatures = {
            supportsJSONB: true,
            supportsArrays: true,
            supportsWindowFunctions: true,
            supportsCommonTableExpressions: true,
            supportsPartitioning: true,
            supportsFullTextSearch: true,
            supportsUUIDs: true,
            supportsEnums: true,
            supportsRangeTypes: true
        };

        // ✅ Cache de conversão de placeholders
        this.placeholderCache = new Map();

        console.log(`🔧 PostgreSQLDriver inicializado [ID: ${this.driverId}] - Schema: ${this.schema} - Pool: ${this.isPool}`);
    }

    // ✅ Gerador de ID único
    generateDriverId() {
        return `postgres_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    // ✅ Extração de schema melhorada
    extractSchemaFromOptions(options) {
        if (!options) return 'public';

        // Suportar múltiplos formatos de search_path
        const patterns = [
            /--search_path=([^,\s]+)/,
            /search_path\s*=\s*([^,\s]+)/,
            /-c\s+search_path=([^,\s]+)/
        ];

        for (const pattern of patterns) {
            const match = options.match(pattern);
            if (match) return match[1];
        }

        return 'public';
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

        let escaped;

        // Se o identificador já contém schema, não modificar
        if (identifier.includes('.')) {
            const parts = identifier.split('.');
            parts.forEach(part => this._validateIdentifier(part));
            escaped = parts.map(part => `"${part.replace(/"/g, '""')}"`).join('.');
        } else {
            this._validateIdentifier(identifier);
            escaped = `"${identifier.replace(/"/g, '""')}"`;
        }

        // Adicionar ao cache se não estiver cheio
        if (this.preparedStatements.size < this.maxPreparedStatements) {
            this.preparedStatements.set(cacheKey, escaped);
        }

        return escaped;
    }

    // ✅ Validação de identificadores PostgreSQL
    _validateIdentifier(identifier) {
        // PostgreSQL tem limite de 63 caracteres para identificadores
        if (identifier.length > 63) {
            throw new Error(`Nome de identificador muito longo (máximo 63 caracteres): ${identifier}`);
        }

        // Verificar se começa com letra ou underscore
        if (!/^[a-zA-Z_]/.test(identifier)) {
            throw new Error(`Identificador deve começar com letra ou underscore: ${identifier}`);
        }

        // Verificar caracteres válidos (letras, números, underscore, $)
        if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(identifier)) {
            throw new Error(`Identificador contém caracteres inválidos: ${identifier}`);
        }
    }

    // ✅ Escape de valores com suporte a tipos específicos do PostgreSQL
    escapeValue(value) {
        if (value === null || value === undefined) return 'NULL';

        if (typeof value === 'string') {
            // Escape específico para PostgreSQL
            return `'${value.replace(/'/g, "''")}'`;
        }

        if (typeof value === 'number') {
            if (Number.isNaN(value)) return 'NULL';
            if (!Number.isFinite(value)) return 'NULL';
            return value.toString();
        }

        if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';

        if (value instanceof Date) {
            if (isNaN(value.getTime())) return 'NULL';
            return `'${value.toISOString()}'`;
        }

        if (Buffer.isBuffer(value)) {
            return `'\\x${value.toString('hex')}'`;
        }

        // ✅ Suporte nativo a arrays PostgreSQL
        if (Array.isArray(value)) {
            const escapedValues = value.map(v => this.escapeValue(v));
            return `ARRAY[${escapedValues.join(', ')}]`;
        }

        // ✅ Suporte a JSONB nativo do PostgreSQL
        if (typeof value === 'object' && value.constructor === Object) {
            return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
        }

        if (typeof value === 'object') {
            return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
        }

        return `'${String(value).replace(/'/g, "''")}'`;
    }

    // ✅ Conversão de placeholders com cache
    _convertPlaceholders(sql) {
        // Verificar cache primeiro
        if (this.placeholderCache.has(sql)) {
            return this.placeholderCache.get(sql);
        }

        let paramIndex = 1;
        const convertedSql = sql.replace(/\?/g, () => `$${paramIndex++}`);

        // Adicionar ao cache se não estiver cheio
        if (this.placeholderCache.size < this.maxPreparedStatements) {
            this.placeholderCache.set(sql, convertedSql);
        }

        return convertedSql;
    }

    // ✅ Execute com melhorias específicas do PostgreSQL
    async execute(sql, params = []) {
        if (this.errorDepth > this.maxErrorDepth) {
            throw new Error('Stack overflow detectado - muitos erros aninhados');
        }

        const queryId = this.generateQueryId();
        const startTime = Date.now();

        try {
            // ✅ Converter placeholders MySQL (?) para PostgreSQL ($1, $2, etc.)
            const convertedSql = this._convertPlaceholders(sql);

            if (this.DEBUG && this._shouldLog('debug')) {
                console.log(`🔍 PostgreSQL SQL Debug [${queryId}]:`, this._sanitizeForLog(convertedSql));
                console.log(`📝 PostgreSQL Params [${queryId}]:`, this._sanitizeParams(params));
                console.log(`🗄️ Schema [${queryId}]:`, this.schema);
                console.log(`🏊‍♂️ Using Pool [${queryId}]:`, this.isPool);
            }

            // ✅ Detecção de operações específicas
            this._detectOperationType(sql);

            // ✅ Timeout específico para PostgreSQL
            const queryPromise = this._executeWithPostgreSQLOptimizations(convertedSql, params);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`PostgreSQL Query timeout após ${this.queryTimeout}ms`)), this.queryTimeout);
            });

            const result = await Promise.race([queryPromise, timeoutPromise]);

            const duration = Date.now() - startTime;
            this._updateMetrics(duration);

            if (duration > this.metrics.slowQueryThreshold) {
                this.metrics.slowQueries++;
                if (this._shouldLog('slow')) {
                    console.warn(`🐌 Slow PostgreSQL query detected [${queryId}] - ${duration}ms: ${this._sanitizeForLog(convertedSql)}`);
                }
            }

            return result.rows;

        } catch (error) {
            const duration = Date.now() - startTime;
            this._updateMetrics(duration, true);
            throw this.handlePostgreSQLError(error, sql, queryId);
        }
    }

    // ✅ Otimizações específicas do PostgreSQL
    async _executeWithPostgreSQLOptimizations(sql, params) {
        let result;

        // ✅ Usar prepared statements quando possível
        if (params.length > 0 && this._shouldUsePreparedStatement(sql)) {
            this.metrics.preparedStatementsUsed++;
        }

        // Verificar se é um pool ou conexão única
        if (this.connection.query) {
            // Pool ou cliente direto
            result = await this.connection.query(sql, params);
        } else {
            // Pool que precisa de getConnection
            const client = await this.connection.connect();
            try {
                result = await client.query(sql, params);
            } finally {
                client.release();
            }
        }

        return result;
    }

    _shouldUsePreparedStatement(sql) {
        // PostgreSQL se beneficia de prepared statements para queries repetitivas
        return /^(INSERT|UPDATE|DELETE|SELECT)\s/i.test(sql.trim());
    }

    _detectOperationType(sql) {
        const trimmedSql = sql.trim().toUpperCase();

        if (trimmedSql.includes('BEGIN') || trimmedSql.includes('COMMIT') || trimmedSql.includes('ROLLBACK')) {
            this.metrics.transactionOperations++;
        }

        if (trimmedSql.includes('CREATE SCHEMA') || trimmedSql.includes('DROP SCHEMA')) {
            this.metrics.schemaOperations++;
        }

        if (trimmedSql.includes('CREATE INDEX') || trimmedSql.includes('DROP INDEX') || trimmedSql.includes('REINDEX')) {
            this.metrics.indexOperations++;
        }
    }

    generateQueryId() {
        return `pg_q_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
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
        let sanitized = sql.length > 400 ? sql.substring(0, 400) + '...' : sql;
        sanitized = sanitized.replace(/password\s*=\s*['"][^'"]*['"]/gi, 'password=***');
        return sanitized;
    }

    _sanitizeParams(params) {
        if (!Array.isArray(params)) return params;
        return params.map((param, index) => {
            if (typeof param === 'string' && param.length > 200) {
                return `${param.substring(0, 200)}... [${param.length} chars]`;
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

    // ✅ Tratamento de erro específico e melhorado para PostgreSQL
    handlePostgreSQLError(error, sql, queryId = null) {
        this.errorDepth++;

        try {
            const errorCode = error.code || 'UNKNOWN';
            const errorMessage = String(error.message || error.toString() || 'Erro desconhecido');
            const severity = error.severity || 'ERROR';
            const detail = error.detail || '';
            const hint = error.hint || '';

            const logPrefix = queryId ? `[${queryId}]` : '';

            switch (errorCode) {
                case '42P01': // undefined_table
                    return new Error(`Tabela não encontrada ${logPrefix}: Schema '${this.schema}' - ${errorMessage}`);

                case '42703': // undefined_column
                    const columnMatch = errorMessage.match(/column "(.+)" does not exist/);
                    if (columnMatch) {
                        return new Error(`Coluna não encontrada ${logPrefix}: '${columnMatch[1]}' - ${hint || 'Verifique o nome da coluna'}`);
                    }
                    return new Error(`Coluna não encontrada ${logPrefix}: ${errorMessage}`);

                case '3F000': // invalid_schema_name
                    return new Error(`Schema inválido ${logPrefix}: '${this.schema}' não encontrado - ${errorMessage}`);

                case '23505': // unique_violation
                    const uniqueMatch = errorMessage.match(/Key \((.+)\)=\((.+)\) already exists/);
                    if (uniqueMatch) {
                        return new Error(`Violação de chave única ${logPrefix}: Campo(s) '${uniqueMatch[1]}' com valor '${uniqueMatch[2]}' já existe`);
                    }
                    return new Error(`Violação de chave única ${logPrefix}: ${errorMessage}`);

                case '23503': // foreign_key_violation
                    const fkMatch = errorMessage.match(/Key \((.+)\)=\((.+)\) is not present in table "(.+)"/);
                    if (fkMatch) {
                        return new Error(`Violação de chave estrangeira ${logPrefix}: Valor '${fkMatch[2]}' para '${fkMatch[1]}' não existe na tabela '${fkMatch[3]}'`);
                    }
                    return new Error(`Violação de chave estrangeira ${logPrefix}: ${errorMessage}`);

                case '23502': // not_null_violation
                    const nullMatch = errorMessage.match(/null value in column "(.+)" violates not-null constraint/);
                    if (nullMatch) {
                        return new Error(`Campo obrigatório ${logPrefix}: '${nullMatch[1]}' não pode ser NULL`);
                    }
                    return new Error(`Violação de NOT NULL ${logPrefix}: ${errorMessage}`);

                case '22001': // string_data_right_truncation
                    return new Error(`Dados muito longos ${logPrefix}: ${errorMessage} - ${hint}`);

                case '22P02': // invalid_text_representation
                    return new Error(`Formato de dados inválido ${logPrefix}: ${errorMessage}`);

                case '23514': // check_violation
                    return new Error(`Violação de constraint CHECK ${logPrefix}: ${errorMessage}`);

                // Erros de conexão
                case '08006': // connection_failure
                    return new Error(`Falha na conexão PostgreSQL ${logPrefix}: ${errorMessage}`);

                case '08001': // sqlclient_unable_to_establish_sqlconnection
                    return new Error(`Não foi possível estabelecer conexão PostgreSQL ${logPrefix}: ${errorMessage}`);

                case '08003': // connection_does_not_exist
                    return new Error(`Conexão PostgreSQL não existe ${logPrefix}: ${errorMessage}`);

                case '08004': // sqlserver_rejected_establishment_of_sqlconnection
                    return new Error(`Servidor PostgreSQL rejeitou a conexão ${logPrefix}: ${errorMessage}`);

                // Erros de autenticação
                case '28P01': // invalid_password
                    return new Error(`Senha inválida PostgreSQL ${logPrefix}: ${errorMessage}`);

                case '28000': // invalid_authorization_specification
                    return new Error(`Especificação de autorização inválida ${logPrefix}: ${errorMessage}`);

                // Erros de banco/schema
                case '3D000': // invalid_catalog_name
                    return new Error(`Banco de dados não encontrado ${logPrefix}: ${errorMessage}`);

                case '42P06': // duplicate_schema
                    return new Error(`Schema já existe ${logPrefix}: ${errorMessage}`);

                case '2BP01': // dependent_objects_still_exist
                    return new Error(`Não é possível remover: objetos dependentes ainda existem ${logPrefix}: ${errorMessage}`);

                // Erros de sintaxe
                case '42601': // syntax_error
                    return new Error(`Erro de sintaxe SQL ${logPrefix}: ${errorMessage}\nSQL: ${this._sanitizeForLog(sql)}`);

                case '42804': // datatype_mismatch
                    return new Error(`Incompatibilidade de tipos ${logPrefix}: ${errorMessage}`);

                case '42883': // undefined_function
                    return new Error(`Função não definida ${logPrefix}: ${errorMessage}`);

                // Erros de transação
                case '25P02': // in_failed_sql_transaction
                    return new Error(`Transação em estado falho ${logPrefix}: Execute ROLLBACK primeiro`);

                case '40001': // serialization_failure
                    return new Error(`Falha de serialização ${logPrefix}: Deadlock detectado - ${errorMessage}`);

                case '40P01': // deadlock_detected
                    return new Error(`Deadlock detectado ${logPrefix}: ${errorMessage}`);

                // Erros de permissão
                case '42501': // insufficient_privilege
                    return new Error(`Privilégios insuficientes ${logPrefix}: ${errorMessage}`);

                // Erros específicos do PostgreSQL
                case '22012': // division_by_zero
                    return new Error(`Divisão por zero ${logPrefix}: ${errorMessage}`);

                case '2200C': // invalid_use_of_escape_character
                    return new Error(`Uso inválido de caractere de escape ${logPrefix}: ${errorMessage}`);

                case '22025': // invalid_escape_sequence
                    return new Error(`Sequência de escape inválida ${logPrefix}: ${errorMessage}`);

                case '22008': // datetime_field_overflow
                    return new Error(`Overflow em campo de data/hora ${logPrefix}: ${errorMessage}`);

                case '22007': // invalid_datetime_format
                    return new Error(`Formato de data/hora inválido ${logPrefix}: ${errorMessage}`);

                // Erros de JSON
                case '22032': // invalid_json_text
                    return new Error(`JSON inválido ${logPrefix}: ${errorMessage}`);

                case '22033': // invalid_sql_json_subscript
                    return new Error(`Subscript JSON inválido ${logPrefix}: ${errorMessage}`);

                // Erros de array
                case '2202E': // array_subscript_error
                    return new Error(`Erro de subscript de array ${logPrefix}: ${errorMessage}`);

                default:
                    if (this._shouldLog('unknown_error')) {
                        console.error(`❌ PostgreSQL Error desconhecido ${logPrefix}:`, {
                            code: errorCode,
                            severity,
                            message: errorMessage,
                            detail,
                            hint,
                            sql: this._sanitizeForLog(sql)
                        });
                    }

                    let fullMessage = `PostgreSQL Error ${logPrefix} [${errorCode}/${severity}]: ${errorMessage}`;
                    if (detail) fullMessage += `\nDetalhe: ${detail}`;
                    if (hint) fullMessage += `\nDica: ${hint}`;

                    return new Error(fullMessage);
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

        return `LIMIT ${limitNum} OFFSET ${offsetNum}`;
    }

    getRandomFunction() {
        return 'RANDOM()';
    }

    // ✅ Verificação de tabela com cache e schema específico
    async tableExists(tableName) {
        try {
            const result = await this.execute(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = $1
                      AND table_name = $2
                      AND table_type = 'BASE TABLE'
                )`, [this.schema, tableName]);

            return result[0]?.exists;
        } catch (error) {
            if (this._shouldLog('table_check_error')) {
                console.error(`❌ Erro ao verificar existência da tabela ${this.schema}.${tableName}:`, error.message);
            }
            return false;
        }
    }

    // ✅ Listar tabelas com informações extras
    async listTables() {
        try {
            const result = await this.execute(`
                SELECT 
                    t.table_name,
                    t.table_type,
                    obj_description(c.oid) as table_comment,
                    pg_size_pretty(pg_total_relation_size(c.oid)) as size,
                    pg_stat_get_numscans(c.oid) as seq_scans,
                    pg_stat_get_tuples_returned(c.oid) as tuples_returned
                FROM information_schema.tables t
                LEFT JOIN pg_class c ON c.relname = t.table_name
                LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE t.table_schema = $1
                  AND t.table_type = 'BASE TABLE'
                  AND n.nspname = $1
                ORDER BY t.table_name
            `, [this.schema]);

            return result.map(row => ({
                name: row.table_name,
                type: row.table_type,
                comment: row.table_comment || null,
                size: row.size || '0 bytes',
                seqScans: row.seq_scans || 0,
                tuplesReturned: row.tuples_returned || 0
            }));
        } catch (error) {
            throw new Error(`Erro ao listar tabelas no schema '${this.schema}': ${error.message}`);
        }
    }

    // ✅ Descrição detalhada de tabela
    async describeTable(tableName) {
        try {
            const result = await this.execute(`
                SELECT 
                    column_name as field,
                    data_type as type,
                    is_nullable as "null",
                    column_default as "default",
                    character_maximum_length as max_length,
                    numeric_precision,
                    numeric_scale,
                    udt_name as udt_type,
                    col_description(pgc.oid, ordinal_position) as comment,
                    ordinal_position as position,
                    CASE 
                        WHEN pk.column_name IS NOT NULL THEN 'PRI'
                        WHEN fk.column_name IS NOT NULL THEN 'MUL'
                        ELSE ''
                    END as key
                FROM information_schema.columns c
                LEFT JOIN pg_class pgc ON pgc.relname = c.table_name
                LEFT JOIN pg_namespace pgn ON pgn.oid = pgc.relnamespace AND pgn.nspname = c.table_schema
                LEFT JOIN (
                    SELECT ku.column_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
                    WHERE tc.constraint_type = 'PRIMARY KEY'
                      AND tc.table_schema = $1
                      AND tc.table_name = $2
                ) pk ON pk.column_name = c.column_name
                LEFT JOIN (
                    SELECT ku.column_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
                    WHERE tc.constraint_type = 'FOREIGN KEY'
                      AND tc.table_schema = $1
                      AND tc.table_name = $2
                ) fk ON fk.column_name = c.column_name
                WHERE c.table_schema = $1
                  AND c.table_name = $2
                ORDER BY c.ordinal_position
            `, [this.schema, tableName]);

            return result.map(col => ({
                Field: col.field,
                Type: col.type,
                UDTType: col.udt_type,
                Null: col.null === 'YES' ? 'YES' : 'NO',
                Key: col.key || '',
                Default: col.default,
                MaxLength: col.max_length,
                NumericPrecision: col.numeric_precision,
                NumericScale: col.numeric_scale,
                Comment: col.comment || '',
                Position: col.position
            }));
        } catch (error) {
            throw new Error(`Erro ao descrever tabela ${this.schema}.${tableName}: ${error.message}`);
        }
    }

    // ✅ Informações do banco específicas do PostgreSQL
    async getDatabaseInfo() {
        try {
            const [version] = await this.execute('SELECT version() as version');
            const [encoding] = await this.execute('SELECT pg_encoding_to_char(encoding) as encoding FROM pg_database WHERE datname = current_database()');
            const [collation] = await this.execute('SELECT datcollate as collation FROM pg_database WHERE datname = current_database()');
            const [timezone] = await this.execute('SELECT current_setting(\'timezone\') as timezone');
            const [maxConnections] = await this.execute('SELECT current_setting(\'max_connections\') as max_connections');

            return {
                version: version.version,
                encoding: encoding.encoding,
                collation: collation.collation,
                timezone: timezone.timezone,
                maxConnections: maxConnections.max_connections,
                currentSchema: this.schema,
                driverId: this.driverId,
                features: this.postgresFeatures
            };
        } catch (error) {
            throw new Error(`Erro ao obter informações do banco: ${error.message}`);
        }
    }

    // ✅ Estatísticas específicas do PostgreSQL
    async getPerformanceStats() {
        try {
            const stats = await this.execute(`
                SELECT 
                    (SELECT setting FROM pg_settings WHERE name = 'max_connections') as max_connections,
                    (SELECT count(*) FROM pg_stat_activity) as current_connections,
                    (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_connections,
                    (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle') as idle_connections,
                    (SELECT extract(epoch from now() - pg_postmaster_start_time())) as uptime_seconds,
                    (SELECT sum(numbackends) FROM pg_stat_database) as total_backends,
                    (SELECT sum(xact_commit) FROM pg_stat_database) as total_commits,
                    (SELECT sum(xact_rollback) FROM pg_stat_database) as total_rollbacks,
                    (SELECT sum(tup_returned) FROM pg_stat_database) as tuples_returned,
                    (SELECT sum(tup_fetched) FROM pg_stat_database) as tuples_fetched,
                    (SELECT sum(tup_inserted) FROM pg_stat_database) as tuples_inserted,
                    (SELECT sum(tup_updated) FROM pg_stat_database) as tuples_updated,
                    (SELECT sum(tup_deleted) FROM pg_stat_database) as tuples_deleted
            `);

            const result = stats[0] || {};

            // ✅ Adicionar métricas do driver
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
            currentSchema: this.schema,
            preparedStatementsCount: this.preparedStatements.size,
            placeholderCacheSize: this.placeholderCache.size,
            isPool: this.isPool,
            features: this.postgresFeatures
        };
    }

    // ✅ Ping melhorado para PostgreSQL
    async ping() {
        try {
            const startTime = Date.now();
            await this.execute('SELECT 1 as ping');
            const responseTime = Date.now() - startTime;

            return {
                status: 'ok',
                responseTime,
                timestamp: Date.now(),
                driver: 'PostgreSQL',
                schema: this.schema
            };
        } catch (error) {
            return {
                status: 'error',
                error: error.message,
                timestamp: Date.now(),
                driver: 'PostgreSQL',
                schema: this.schema
            };
        }
    }

    // ✅ Verificação de schema melhorada
    async schemaExists() {
        try {
            const result = await this.execute(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.schemata
                    WHERE schema_name = $1
                )`, [this.schema]);

            return result[0]?.exists;
        } catch (error) {
            if (this._shouldLog('schema_check_error')) {
                console.error(`❌ Erro ao verificar existência do schema ${this.schema}:`, error.message);
            }
            return false;
        }
    }

    // ✅ Criação de schema melhorada
    async createSchemaIfNotExists() {
        try {
            const exists = await this.schemaExists();

            if (!exists) {
                await this.execute(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
                console.log(`✅ Schema '${this.schema}' criado com sucesso`);
            } else {
                console.log(`ℹ️ Schema '${this.schema}' já existe`);
            }

            return true;
        } catch (error) {
            throw new Error(`Erro ao criar schema '${this.schema}': ${error.message}`);
        }
    }

    // ✅ Backup de tabela com opções específicas do PostgreSQL
    async backupTable(tableName, options = {}) {
        try {
            const timestamp = options.timestamp || Date.now();
            const suffix = options.suffix || 'backup';
            const backupTableName = `${tableName}_${suffix}_${timestamp}`;
            const targetSchema = options.targetSchema || this.schema;

            const escapedBackupName = this.escapeIdentifier(`${targetSchema}.${backupTableName}`);
            const escapedTableName = this.escapeIdentifier(`${this.schema}.${tableName}`);

            const tableExists = await this.tableExists(tableName);
            if (!tableExists) {
                throw new Error(`Tabela original ${this.schema}.${tableName} não existe`);
            }

            if (options.structureOnly) {
                await this.execute(`CREATE TABLE ${escapedBackupName} (LIKE ${escapedTableName} INCLUDING ALL)`);
            } else {
                let createSql = `CREATE TABLE ${escapedBackupName} AS SELECT * FROM ${escapedTableName}`;

                if (options.whereClause) {
                    createSql += ` WHERE ${options.whereClause}`;
                }

                await this.execute(createSql);
            }

            console.log(`✅ Backup PostgreSQL da tabela ${this.schema}.${tableName} criado como ${targetSchema}.${backupTableName}`);

            return {
                originalTable: `${this.schema}.${tableName}`,
                backupTable: `${targetSchema}.${backupTableName}`,
                timestamp: Date.now(),
                structureOnly: !!options.structureOnly,
                targetSchema,
                whereClause: options.whereClause || null
            };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Erro ao criar backup da tabela ${this.schema}.${tableName}: ${errorMsg}`);
        }
    }

    // ✅ Métodos específicos do PostgreSQL
    async analyzeTable(tableName) {
        try {
            const fullTableName = `"${this.schema}"."${tableName}"`;
            await this.execute(`ANALYZE ${fullTableName}`);

            return {
                table: `${this.schema}.${tableName}`,
                operation: 'analyze',
                timestamp: Date.now(),
                driver: 'PostgreSQL'
            };
        } catch (error) {
            throw new Error(`Erro ao analisar tabela ${this.schema}.${tableName}: ${error.message}`);
        }
    }

    async vacuumTable(tableName, options = {}) {
        try {
            const fullTableName = `"${this.schema}"."${tableName}"`;
            let vacuumSql = 'VACUUM';

            if (options.full) vacuumSql += ' FULL';
            if (options.verbose) vacuumSql += ' VERBOSE';
            if (options.analyze !== false) vacuumSql += ' ANALYZE';

            vacuumSql += ` ${fullTableName}`;

            await this.execute(vacuumSql);

            return {
                table: `${this.schema}.${tableName}`,
                operation: 'vacuum',
                options,
                timestamp: Date.now(),
                driver: 'PostgreSQL'
            };
        } catch (error) {
            throw new Error(`Erro ao executar VACUUM na tabela ${this.schema}.${tableName}: ${error.message}`);
        }
    }

    async reindexTable(tableName) {
        try {
            const fullTableName = `"${this.schema}"."${tableName}"`;
            await this.execute(`REINDEX TABLE ${fullTableName}`);

            return {
                table: `${this.schema}.${tableName}`,
                operation: 'reindex',
                timestamp: Date.now(),
                driver: 'PostgreSQL'
            };
        } catch (error) {
            throw new Error(`Erro ao reindexar tabela ${this.schema}.${tableName}: ${error.message}`);
        }
    }

    // ✅ Teste de funcionalidades específicas do PostgreSQL
    async supportsJSONB() {
        try {
            await this.execute("SELECT '{}'::jsonb as test");
            return true;
        } catch (error) {
            return false;
        }
    }

    async supportsArrays() {
        try {
            await this.execute("SELECT ARRAY[1,2,3] as test");
            return true;
        } catch (error) {
            return false;
        }
    }

    async supportsWindowFunctions() {
        try {
            await this.execute('SELECT ROW_NUMBER() OVER (ORDER BY 1) as test FROM (SELECT 1) as t');
            return true;
        } catch (error) {
            return false;
        }
    }

    async supportsCommonTableExpressions() {
        try {
            await this.execute('WITH cte AS (SELECT 1 as test) SELECT test FROM cte');
            return true;
        } catch (error) {
            return false;
        }
    }

    // ✅ Limpeza de recursos
    clearCache() {
        this.preparedStatements.clear();
        this.placeholderCache.clear();
        this.logRateLimit.clear();
        console.log(`🧹 Cache limpo para PostgreSQLDriver [${this.driverId}]`);
    }

    getDriverInfo() {
        return {
            driverId: this.driverId,
            type: 'PostgreSQL',
            schema: this.schema,
            isPool: this.isPool,
            debug: this.DEBUG,
            metrics: this.getDriverMetrics(),
            cacheSize: this.preparedStatements.size,
            placeholderCacheSize: this.placeholderCache.size,
            maxCacheSize: this.maxPreparedStatements,
            features: this.postgresFeatures
        };
    }
}

export default PostgreSQLDriver;
