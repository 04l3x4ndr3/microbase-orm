import Connection from './database/Connection.js';
import QueryBuilder from './QueryBuilder.js';
import AutoDatabaseManager from './database/AutoDatabaseManager.js';
import TransactionManager from './database/TransactionManager.js';

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

            // ✅ Novas configurações para auto gerenciamento
            autoConnect: true,
            poolEnabled: true,
            transactionEnabled: true,
            healthCheck: true,
            healthCheckInterval: 30000,
            retryAttempts: 3,
            retryDelay: 1000,
            maxConnectionAge: 3600000, // 1 hora

            // ✅ Configurações avançadas de pool
            min: 2,
            queueLimit: 50,
            acquireTimeout: 30000,
            createTimeoutMillis: 30000,
            destroyTimeoutMillis: 5000,
            reapIntervalMillis: 1000,

            ...config
        };

        // Modo legado (compatibilidade)
        this.connection = null;
        this.queryBuilder = null;
        this.connectionManager = null;

        // ✅ Novo sistema de auto gerenciamento
        this.autoManager = null;
        this.transactionManager = null;
        this.useAutoMode = this.config.autoConnect;
        this.isShuttingDown = false;
        this.lastActivity = Date.now();

        // ✅ Métricas e monitoramento
        this.metrics = {
            queriesExecuted: 0,
            transactionsCommitted: 0,
            transactionsRolledBack: 0,
            errorsCount: 0,
            lastError: null,
            uptime: Date.now()
        };

        // Inicializar auto gerenciamento se habilitado
        if (this.useAutoMode) {
            this.autoManager = new AutoDatabaseManager(this.config);
            this._setupAutoCleanup();
        }
    }

    // ===============================
    // SISTEMA DE AUTO CLEANUP
    // ===============================

    _setupAutoCleanup() {
        // Cleanup automático em caso de exit do processo
        process.on('SIGINT', () => this._gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => this._gracefulShutdown('SIGTERM'));
        process.on('beforeExit', () => this._gracefulShutdown('beforeExit'));

        // Cleanup de conexões inativas
        this.cleanupInterval = setInterval(() => {
            this._performMaintenanceTasks();
        }, 60000); // A cada minuto
    }

    async _gracefulShutdown(signal) {
        if (this.isShuttingDown) return;

        console.log(`🛑 Iniciando shutdown graceful (${signal})...`);
        this.isShuttingDown = true;

        try {
            await this.disconnect();
            console.log('✅ Shutdown concluído com sucesso');
        } catch (error) {
            console.error('❌ Erro durante shutdown:', error.message);
        }

        process.exit(0);
    }

    _performMaintenanceTasks() {
        if (this.isShuttingDown) return;

        // Atualizar última atividade
        this.lastActivity = Date.now();

        // Log de estatísticas periodicamente
        if (this.config.debug) {
            console.log('📊 Database Stats:', this.getStats());
        }
    }

    // ===============================
    // MÉTODOS DE AUTO GERENCIAMENTO MELHORADOS
    // ===============================

    async autoQuery(sql, params = []) {
        this._updateMetrics('query');

        try {
            if (!this.autoManager) {
                this.autoManager = new AutoDatabaseManager(this.config);
            }

            const result = await this.autoManager.query(sql, params);
            this.metrics.queriesExecuted++;
            return result;

        } catch (error) {
            this._handleError(error);
            throw error;
        }
    }

    autoSelect(fields = '*') {
        if (!this.autoManager) {
            this.autoManager = new AutoDatabaseManager(this.config);
        }
        return this.autoManager.select(fields);
    }

    autoFrom(table) {
        if (!this.autoManager) {
            this.autoManager = new AutoDatabaseManager(this.config);
        }
        return this.autoManager.from(table);
    }

    autoWhere(field, value = null, operator = '=') {
        if (!this.autoManager) {
            this.autoManager = new AutoDatabaseManager(this.config);
        }
        return this.autoManager.where(field, value, operator);
    }

    async autoInsert(table, data) {
        this._updateMetrics('insert');

        try {
            if (!this.autoManager) {
                this.autoManager = new AutoDatabaseManager(this.config);
            }

            const result = await this.autoManager.insert(table, data);
            this.metrics.queriesExecuted++;
            return result;

        } catch (error) {
            this._handleError(error);
            throw error;
        }
    }

    async autoUpdate(table, data, where = null) {
        this._updateMetrics('update');

        try {
            if (!this.autoManager) {
                this.autoManager = new AutoDatabaseManager(this.config);
            }

            const result = await this.autoManager.update(table, data, where);
            this.metrics.queriesExecuted++;
            return result;

        } catch (error) {
            this._handleError(error);
            throw error;
        }
    }

    async autoDelete(table, where = null) {
        this._updateMetrics('delete');

        try {
            if (!this.autoManager) {
                this.autoManager = new AutoDatabaseManager(this.config);
            }

            const result = await this.autoManager.delete(table, where);
            this.metrics.queriesExecuted++;
            return result;

        } catch (error) {
            this._handleError(error);
            throw error;
        }
    }

    // ===============================
    // MÉTODOS DE TRANSAÇÃO MELHORADOS
    // ===============================

    async beginTransaction() {
        this._updateMetrics('transaction_begin');

        try {
            if (this.useAutoMode) {
                if (!this.autoManager) {
                    this.autoManager = new AutoDatabaseManager(this.config);
                }
                return await this.autoManager.beginTransaction();
            } else {
                // Modo legado
                if (!this.transactionManager) {
                    this.transactionManager = new TransactionManager(this.config);
                }
                return await this.transactionManager.beginTransaction();
            }
        } catch (error) {
            this._handleError(error);
            throw error;
        }
    }

    async executeInTransaction(callback) {
        this._updateMetrics('transaction_execute');

        try {
            let result;

            if (this.useAutoMode) {
                if (!this.autoManager) {
                    this.autoManager = new AutoDatabaseManager(this.config);
                }
                result = await this.autoManager.executeInTransaction(callback);
            } else {
                // Modo legado
                if (!this.transactionManager) {
                    this.transactionManager = new TransactionManager(this.config);
                }
                result = await this.transactionManager.executeInTransaction(callback);
            }

            this.metrics.transactionsCommitted++;
            return result;

        } catch (error) {
            this.metrics.transactionsRolledBack++;
            this._handleError(error);
            throw error;
        }
    }

    // ✅ Novo método para transações em lote
    async transaction(operations) {
        return await this.executeInTransaction(async (tx) => {
            const results = [];

            for (const operation of operations) {
                if (typeof operation === 'function') {
                    results.push(await operation(tx));
                } else if (operation.type) {
                    // Operação estruturada
                    switch (operation.type) {
                        case 'query':
                            results.push(await this.autoQuery(operation.sql, operation.params || []));
                            break;
                        case 'insert':
                            results.push(await this.autoInsert(operation.table, operation.data));
                            break;
                        case 'update':
                            results.push(await this.autoUpdate(operation.table, operation.data, operation.where));
                            break;
                        case 'delete':
                            results.push(await this.autoDelete(operation.table, operation.where));
                            break;
                        default:
                            throw new Error(`Tipo de operação não suportado: ${operation.type}`);
                    }
                }
            }

            return results;
        });
    }

    // ✅ Novo método para retry automático
    async executeWithRetry(operation, maxRetries = null) {
        const retries = maxRetries || this.config.retryAttempts;
        let lastError;

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;

                // Verificar se vale a pena tentar novamente
                if (this._shouldRetry(error) && attempt < retries) {
                    const delay = this.config.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
                    console.log(`⚠️ Tentativa ${attempt} falhou, tentando novamente em ${delay}ms...`);
                    await this._sleep(delay);
                    continue;
                }

                break;
            }
        }

        throw lastError;
    }

    _shouldRetry(error) {
        const retryableErrors = [
            'ECONNRESET',
            'ECONNREFUSED',
            'PROTOCOL_CONNECTION_LOST',
            'ER_LOCK_WAIT_TIMEOUT',
            'ER_LOCK_DEADLOCK'
        ];

        return retryableErrors.some(code =>
            error.code === code || error.message.includes(code)
        );
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ===============================
    // MÉTODOS LEGADOS MELHORADOS (COMPATIBILIDADE)
    // ===============================

    async connect() {
        if (this.useAutoMode) {
            console.warn('⚠️ Usando modo auto - connect() não é necessário');
            return;
        }

        try {
            if (!this.connection) {
                this.connectionManager = new Connection(this.config);
                this.connection = await this.connectionManager.connect();
                this.queryBuilder = new QueryBuilder(this.connection, this.config.driver, this.config);

                console.log('✅ Conexão estabelecida com sucesso (modo legado)');
            }
            return this.connection;
        } catch (error) {
            this._handleError(error);
            throw error;
        }
    }

    async disconnect() {
        try {
            if (this.useAutoMode) {
                if (this.autoManager) {
                    await this.autoManager.destroy();
                    this.autoManager = null;
                }
            } else {
                if (this.connectionManager) {
                    await this.connectionManager.disconnect();
                    this.connection = null;
                    this.queryBuilder = null;
                    this.connectionManager = null;
                }
            }

            if (this.transactionManager) {
                await this.transactionManager.cleanup();
                this.transactionManager = null;
            }

            // Limpar intervalos
            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
                this.cleanupInterval = null;
            }

            console.log('👋 Desconexão realizada com sucesso');

        } catch (error) {
            console.error('❌ Erro durante desconexão:', error.message);
            throw error;
        }
    }

    // Métodos de conveniência que funcionam nos dois modos
    select(fields = '*') {
        if (this.useAutoMode) {
            return this.autoSelect(fields);
        } else {
            this.ensureConnected();
            return new QueryBuilder(this.connection, this.config.driver, this.config).select(fields);
        }
    }

    from(table) {
        if (this.useAutoMode) {
            return this.autoFrom(table);
        } else {
            this.ensureConnected();
            return new QueryBuilder(this.connection, this.config.driver, this.config).from(table);
        }
    }

    where(field, value = null, operator = '=') {
        if (this.useAutoMode) {
            return this.autoWhere(field, value, operator);
        } else {
            this.ensureConnected();
            return new QueryBuilder(this.connection, this.config.driver, this.config).where(field, value, operator);
        }
    }

    async insert(table, data) {
        if (this.useAutoMode) {
            return await this.autoInsert(table, data);
        } else {
            this.ensureConnected();
            return await new QueryBuilder(this.connection, this.config.driver, this.config).insert(table, data);
        }
    }

    async update(table, data, where = null) {
        if (this.useAutoMode) {
            return await this.autoUpdate(table, data, where);
        } else {
            this.ensureConnected();
            return await new QueryBuilder(this.connection, this.config.driver, this.config).update(table, data, where);
        }
    }

    async delete(table, where = null) {
        if (this.useAutoMode) {
            return await this.autoDelete(table, where);
        } else {
            this.ensureConnected();
            return await new QueryBuilder(this.connection, this.config.driver, this.config).delete(table, where);
        }
    }

    async query(sql, params = []) {
        if (this.useAutoMode) {
            return await this.autoQuery(sql, params);
        } else {
            this.ensureConnected();
            return await new QueryBuilder(this.connection, this.config.driver, this.config).query(sql, params);
        }
    }

    ensureConnected() {
        if (!this.connection) {
            throw new Error('Conexão com banco não estabelecida. Chame connect() primeiro ou habilite autoConnect.');
        }
    }

    // Método para obter uma instância limpa do QueryBuilder
    builder() {
        if (this.useAutoMode && this.autoManager) {
            return this.autoManager.newQuery();
        } else {
            // Modo legado
            if (!this.connection) {
                throw new Error('Conexão não estabelecida. Execute connect() primeiro.');
            }

            return new QueryBuilder(this.connection, this.config.driver, this.config);
        }
    }


    // ===============================
    // MÉTODOS DE INFORMAÇÃO E STATS MELHORADOS
    // ===============================

    getStats() {
        const baseStats = {
            mode: this.useAutoMode ? 'auto' : 'legacy',
            uptime: Date.now() - this.metrics.uptime,
            lastActivity: this.lastActivity,
            metrics: { ...this.metrics }
        };

        if (this.useAutoMode && this.autoManager) {
            return {
                ...baseStats,
                auto: this.autoManager.getStats()
            };
        }

        return {
            ...baseStats,
            connected: !!this.connection
        };
    }

    getConnectionInfo() {
        const baseInfo = {
            driver: this.config.driver,
            host: this.config.host,
            port: this.config.port,
            database: this.config.database,
            schema: this.config.driver === 'postgres' ?
                this.config.options?.match(/--search_path=([^,\s]+)/)?.[1] || 'public' :
                null,
            poolSize: this.config.max,
            ssl: this.config.ssl,
            autoMode: this.useAutoMode,
            poolEnabled: this.config.poolEnabled,
            transactionEnabled: this.config.transactionEnabled,
            healthCheck: this.config.healthCheck
        };

        if (this.useAutoMode && this.autoManager) {
            return {
                ...baseInfo,
                stats: this.autoManager.getStats()
            };
        }

        return baseInfo;
    }

    // ✅ Novos métodos de controle
    setAutoMode(enabled) {
        this.useAutoMode = enabled;
        if (enabled && !this.autoManager) {
            this.autoManager = new AutoDatabaseManager(this.config);
            this._setupAutoCleanup();
        }
    }

    async healthCheck() {
        try {
            if (this.useAutoMode && this.autoManager) {
                await this.autoManager.performHealthCheck();
                return this.autoManager.lastHealthCheck;
            } else {
                const startTime = Date.now();
                await this.query('SELECT 1 as health_check');
                const duration = Date.now() - startTime;

                return {
                    timestamp: Date.now(),
                    status: 'healthy',
                    duration,
                    mode: 'legacy'
                };
            }
        } catch (error) {
            return {
                timestamp: Date.now(),
                status: 'unhealthy',
                error: error.message,
                mode: this.useAutoMode ? 'auto' : 'legacy'
            };
        }
    }

    _updateMetrics(operation) {
        this.lastActivity = Date.now();

        if (this.config.debug) {
            console.log(`🔄 Database operation: ${operation}`);
        }
    }

    _handleError(error) {
        this.metrics.errorsCount++;
        this.metrics.lastError = {
            message: error.message,
            timestamp: Date.now(),
            code: error.code
        };

        if (this.config.debug) {
            console.error('❌ Database error:', error.message);
        }
    }

    // ===============================
    // MÉTODOS EXISTENTES MELHORADOS
    // ===============================

    async tableExists(tableName) {
        try {
            if (this.useAutoMode) {
                if (this.config.driver === 'postgres') {
                    const result = await this.autoQuery(`
                        SELECT COUNT(*) as count 
                        FROM information_schema.tables 
                        WHERE table_schema = CURRENT_SCHEMA() 
                        AND table_name = $1
                    `, [tableName]);
                    return result[0].count > 0;
                } else {
                    const result = await this.autoQuery(`
                        SELECT COUNT(*) as count 
                        FROM information_schema.tables 
                        WHERE table_schema = DATABASE() 
                        AND table_name = ?
                    `, [tableName]);
                    return result[0].count > 0;
                }
            } else {
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
        } catch (error) {
            this._handleError(error);
            return false;
        }
    }

    async listTables() {
        try {
            if (this.useAutoMode) {
                if (this.config.driver === 'postgres') {
                    const result = await this.autoQuery(`
                        SELECT table_name 
                        FROM information_schema.tables 
                        WHERE table_schema = CURRENT_SCHEMA()
                        ORDER BY table_name
                    `);
                    return result.map(row => row.table_name);
                } else {
                    const result = await this.autoQuery(`
                        SELECT table_name 
                        FROM information_schema.tables 
                        WHERE table_schema = DATABASE()
                        ORDER BY table_name
                    `);
                    return result.map(row => row.table_name || row.TABLE_NAME);
                }
            } else {
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
        } catch (error) {
            this._handleError(error);
            throw error;
        }
    }

    async describeTable(tableName) {
        try {
            if (this.useAutoMode) {
                if (this.config.driver === 'postgres') {
                    return await this.autoQuery(`
                        SELECT column_name, data_type, is_nullable, column_default
                        FROM information_schema.columns
                        WHERE table_schema = CURRENT_SCHEMA()
                        AND table_name = $1
                        ORDER BY ordinal_position
                    `, [tableName]);
                } else {
                    return await this.autoQuery(`DESCRIBE ${tableName}`);
                }
            } else {
                this.ensureConnected();
                const builder = new QueryBuilder(this.connection, this.config.driver, this.config);

                if (this.config.driver === 'postgres') {
                    return await builder.driver.describeTable(tableName);
                } else if (this.config.driver === 'mysql') {
                    return await this.query(`DESCRIBE ${tableName}`);
                }
                return [];
            }
        } catch (error) {
            this._handleError(error);
            throw error;
        }
    }

    async testConnection() {
        try {
            if (this.useAutoMode) {
                await this.autoQuery('SELECT 1 as test');
            } else {
                await this.connect();
                await this.query('SELECT 1 as test');
            }
            return true;
        } catch (error) {
            this._handleError(error);
            console.error('Erro no teste de conexão:', error.message);
            return false;
        }
    }

    // ✅ Novos métodos utilitários
    async executeScript(script) {
        const queries = script.split(';').filter(q => q.trim());
        const results = [];

        return await this.executeInTransaction(async () => {
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
        });
    }

    // Métodos para compatibilidade com código existente
    getLastQuery() {
        if (this.queryBuilder) {
            return this.queryBuilder.getLastQuery();
        }
        return null;
    }

    getCompiledSelect() {
        if (this.queryBuilder) {
            return this.queryBuilder.getCompiledSelect();
        }
        return null;
    }

    // ===============================
    // MÉTODOS DE SCHEMA (POSTGRES)
    // ===============================

    async schemaExists() {
        if (this.config.driver === 'postgres') {
            try {
                if (this.useAutoMode) {
                    const schema = this.config.options?.match(/--search_path=([^,\s]+)/)?.[1] || 'public';
                    const result = await this.autoQuery(`
                        SELECT COUNT(*) as count 
                        FROM information_schema.schemata 
                        WHERE schema_name = $1
                    `, [schema]);
                    return result[0].count > 0;
                } else {
                    this.ensureConnected();
                    const builder = new QueryBuilder(this.connection, this.config.driver, this.config);
                    return await builder.driver.schemaExists();
                }
            } catch (error) {
                this._handleError(error);
                return false;
            }
        }
        return true; // MySQL não tem schemas separados
    }

    async createSchemaIfNotExists() {
        if (this.config.driver === 'postgres') {
            try {
                if (this.useAutoMode) {
                    const schema = this.config.options?.match(/--search_path=([^,\s]+)/)?.[1] || 'public';
                    if (schema !== 'public') {
                        await this.autoQuery(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
                    }
                    return true;
                } else {
                    this.ensureConnected();
                    const builder = new QueryBuilder(this.connection, this.config.driver, this.config);
                    return await builder.driver.createSchemaIfNotExists();
                }
            } catch (error) {
                this._handleError(error);
                throw error;
            }
        }
        return true; // MySQL não precisa criar schema
    }
}

export default Database;
