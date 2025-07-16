class PostgreSQLDriver {
    constructor(connection, config = {}) {
        this.connection = connection;
        this.config = config;
        this.isPool = !!config.max;
        this.DEBUG = config.debug || false;

        this.driverId = this.generateDriverId();
        this.schema = this.extractSchemaFromOptions(config.options);

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
    }

    escapeIdentifier(identifier) {
        if (!identifier) throw new Error('Identifier não pode ser vazio');

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

    escapeValue(value) {
        if (value === null || value === undefined) return 'NULL';
        if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
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
        if (Buffer.isBuffer(value)) return `'\\x${value.toString('hex')}'`;
        if (Array.isArray(value)) {
            const escapedValues = value.map(v => this.escapeValue(v));
            return `ARRAY[${escapedValues.join(', ')}]`;
        }
        if (typeof value === 'object' && value.constructor === Object) return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
        if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
        return `'${String(value).replace(/'/g, "''")}'`;
    }

    async beginTransaction() {
        try {
            await this.execute('BEGIN');
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
        try {
            const _sql = this._convertPlaceholders(sql);
            if (this.DEBUG) {
                console.log(`🔍 PostgreSQL SQL Debug:`, _sql);
                console.log(`📝 PostgreSQL Params:`, params);
                console.log(`🗄️ Schema:`, this.schema);
                console.log(`🏊‍♂️ Using Pool:`, this.isPool);
            }
            const result = await this.connection.execute(_sql, params);
            return result.rows;
        } catch (error) {
            throw this._handleDBError(error, sql);
        }
    }

    getLimitSyntax(limit, offset = 0) {
        const limitNum = parseInt(limit);
        const offsetNum = parseInt(offset);
        if (isNaN(limitNum) || limitNum < 0) throw new Error('LIMIT deve ser um número não negativo');
        if (isNaN(offsetNum) || offsetNum < 0) throw new Error('OFFSET deve ser um número não negativo');
        return `LIMIT ${limitNum} OFFSET ${offsetNum}`;
    }

    getRandomFunction() {
        return 'RANDOM()';
    }

    async schemaExists() {
        try {
            const result = await this.execute(`
                SELECT EXISTS (SELECT 1
                               FROM information_schema.schemata
                               WHERE schema_name = $1)`, [this.schema]);

            return result[0]?.exists;
        } catch (error) {
            return false;
        }
    }

    async tableExists(tableName) {
        try {
            const result = await this.execute(`SELECT EXISTS (SELECT 1
                                                              FROM information_schema.tables
                                                              WHERE table_schema = $1
                                                                AND table_name = $2
                                                                AND table_type = 'BASE TABLE')`, [this.schema, tableName]);
            return result[0]?.exists;
        } catch (error) {
            return false;
        }
    }

    async listTables() {
        try {
            const result = await this.execute(`SELECT t.table_name
                                               FROM information_schema.tables t
                                               WHERE t.table_schema = $1
                                                 AND t.table_type = 'BASE TABLE'
                                               ORDER BY t.table_name`, [this.schema]);
            return result.map(row => (row.table_name));
        } catch (error) {
            throw new Error(`Erro ao listar tabelas do schema '${this.schema}': ${error.message}`);
        }
    }

    async describeTable(tableName) {
        try {
            const result = await this.execute(`SELECT column_name,
                                                      data_type,
                                                      character_maximum_length,
                                                      is_nullable,
                                                      column_default
                                               FROM $1.columns
                                               WHERE table_name = $2;
            `, [this.schema, tableName]);

            return result.map(col => (col));
        } catch (error) {
            throw new Error(`Erro ao descrever tabela ${this.schema}.${tableName}: ${error.message}`);
        }
    }

    async getDatabaseInfo() {
        try {
            const [version, charset, collation] = await this.execute(`SELECT
            version() AS version,
            (SELECT current_setting('server_encoding')) AS charset,
            (SELECT current_setting('lc_collate')) AS collation;`);
            return {version, charset, collation};
        } catch (error) {
            throw new Error(`Erro ao obter informações do banco: ${error.message}`);
        }
    }

    _handleDBError(error, sql, queryId = null) {
        const errorCode = error.code || 'UNKNOWN';
        const errorMessage = String(error.message || error.toString() || 'Erro desconhecido');
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
                return new Error(`Erro de sintaxe SQL ${logPrefix}: ${errorMessage}\nSQL: ${sql}`);

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
                return new Error(errorMessage);
        }
    }

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
}

export default PostgreSQLDriver;
