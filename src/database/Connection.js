import mysql from 'mysql2/promise';
import mariadb from 'mariadb';
import pg from 'pg';

class Connection {
    constructor(config) {
        this.config = config;
        this.connection = null;
        this.pool = null;
        this.isConnected = false;
        this.connectionId = this.generateConnectionId();
        this.retryCount = 0;
        this.maxRetries = config.retryAttempts || 3;
        this.retryDelay = config.retryDelay || 1000;

        // ✅ Métricas de conexão
        this.metrics = {
            connectAttempts: 0,
            successfulConnections: 0,
            failedConnections: 0,
            reconnections: 0,
            lastConnected: null,
            totalUptime: 0,
            startTime: Date.now()
        };

        // ✅ Health monitoring
        this.healthCheckInterval = null;
        this.lastHealthCheck = null;

        // ✅ Event handlers
        this.eventHandlers = new Map();
    }

    // ✅ Sistema de eventos melhorado
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
    }

    emit(event, data) {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`Erro em event handler ${event}:`, error.message);
                }
            });
        }
    }

    async connect() {
        this.metrics.connectAttempts++;

        try {
            console.log(`🏁 Driver: ${this.config.driver.toUpperCase()} - Conectando ao banco de dados ${this.config.database}... [ID: ${this.connectionId}]`);

            await this._connectWithRetry();

            this.isConnected = true;
            this.metrics.successfulConnections++;
            this.metrics.lastConnected = Date.now();

            // ✅ Configurar health check se habilitado
            if (this.config.healthCheck) {
                this._startHealthCheck();
            }

            this.emit('connected', {
                connectionId: this.connectionId,
                driver: this.config.driver,
                timestamp: Date.now()
            });

            console.log(`✅ Conexão estabelecida com sucesso [ID: ${this.connectionId}]`);

            return this.connection;

        } catch (error) {
            this.metrics.failedConnections++;
            this.emit('connectionError', {
                connectionId: this.connectionId,
                error: error.message,
                timestamp: Date.now()
            });

            console.error(`❌ Falha na conexão [ID: ${this.connectionId}]:`, error.message);
            throw error;
        }
    }

    async _connectWithRetry() {
        let lastError;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                await this._performConnection();
                return;
            } catch (error) {
                lastError = error;

                if (attempt < this.maxRetries && this._shouldRetry(error)) {
                    const delay = this.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
                    console.log(`⚠️ Tentativa ${attempt} falhou, tentando novamente em ${delay}ms...`);
                    await this._sleep(delay);
                } else {
                    break;
                }
            }
        }

        throw lastError;
    }

    _shouldRetry(error) {
        const retryableErrors = [
            'ECONNREFUSED',
            'ENOTFOUND',
            'ETIMEDOUT',
            'ECONNRESET',
            'ER_ACCESS_DENIED_ERROR'
        ];

        return retryableErrors.some(code =>
            error.code === code || error.message.includes(code)
        );
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async _performConnection() {
        switch (this.config.driver.toLowerCase()) {
            case 'mysql':
                await this._connectMySQL();
                break;
            case 'mariadb':
                await this._connectMariaDB();
                break;
            case 'postgres':
                await this._connectPostgreSQL();
                break;
            default:
                throw new Error(`Driver não suportado: ${this.config.driver}`);
        }
    }

    // ✅ Conexão MySQL melhorada
    async _connectMySQL() {
        const mysqlConfig = {
            host: this.config.host,
            user: this.config.username,
            password: this.config.password,
            database: this.config.database,
            port: this.config.port || 3306,
            charset: this.config.charset || 'utf8mb4',
            timezone: this.config.timezone || 'local',
            dateStrings: this.config.dateStrings || false,
            debug: this.config.debug || false,
            trace: this.config.trace || true,
            multipleStatements: this.config.multipleStatements || false,
            reconnect: this.config.reconnect !== false,
            maxReconnects: this.config.maxReconnects || 3,
            reconnectDelay: this.config.reconnectDelay || 2000,
            ...(this.config.ssl && {ssl: this.config.ssl}),
            ...(this.config.connectionTimeoutMillis && {connectTimeout: this.config.connectionTimeoutMillis}),
            ...(this.config.acquireTimeout && {acquireTimeout: this.config.acquireTimeout}),
            typeCast: function (field, next) {
                if (field.type === 'TINY' && field.length === 1) {
                    const val = field.string();
                    return val === null ? null : val === '1';
                }
                return next();
            }
        };

        if (this.config.max) {
            const pool = mysql.createPool({
                ...mysqlConfig,
                connectionLimit: this.config.max || 10,
                queueLimit: this.config.queueLimit || 0,
                acquireTimeout: this.config.acquireTimeout || 60000,
                timeout: this.config.timeout || 60000,
                createConnection: mysql.createConnection,
                Promise: Promise
            });

            // ✅ Event handlers melhorados para pool
            pool.on('connection', (connection) => {
                console.log(`🔗 Nova conexão MySQL no pool:`, connection.threadId);
                this.emit('poolConnection', {threadId: connection.threadId});
            });

            pool.on('error', (err) => {
                console.error('❌ Erro no pool MySQL:', err.message);
                this.emit('poolError', {error: err.message});
                this._handleConnectionError(err);
            });

            pool.on('enqueue', () => {
                console.log('⏳ Requisição enfileirada no pool MySQL');
                this.emit('poolEnqueue', {timestamp: Date.now()});
            });

            // ✅ Testar pool antes de retornar
            await this._testPoolConnection(pool);

            this.pool = pool;
            this.connection = pool;
        } else {
            const connection = await mysql.createConnection(mysqlConfig);

            connection.on('error', (err) => {
                console.error(`❌ Erro na conexão MySQL:`, err.message);
                this.emit('connectionError', {error: err.message});

                if (err.code === 'PROTOCOL_CONNECTION_LOST') {
                    console.log('🔄 Tentando reconectar...');
                    this._handleDisconnect();
                }
            });

            // ✅ Testar conexão
            await connection.execute('SELECT 1');
            this.connection = connection;
        }
    }

    // ✅ Conexão MariaDB melhorada
    async _connectMariaDB() {
        const mariadbConfig = {
            host: this.config.host,
            user: this.config.username,
            password: this.config.password,
            database: this.config.database,
            port: this.config.port || 3306,
            multipleStatements: this.config.multipleStatements || false,
            allowUserPasswords: true,
            charset: this.config.charset || 'utf8mb4',
            timezone: this.config.timezone || 'local',
            bigIntAsNumber: true,
            insertIdAsNumber: true,
            decimalAsNumber: false,
            dateStrings: this.config.dateStrings || false,
            ...(this.config.ssl && {ssl: this.config.ssl}),
            ...(this.config.connectionTimeoutMillis && {connectTimeout: this.config.connectionTimeoutMillis}),
            socketPath: this.config.socketPath || null
        };

        if (this.config.max) {
            const pool = mariadb.createPool({
                ...mariadbConfig,
                connectionLimit: this.config.max || 10,
                acquireTimeout: this.config.acquireTimeout || 60000,
                idleTimeoutMillis: this.config.idleTimeoutMillis || 30000,
                removeNodeErrorCount: this.config.removeNodeErrorCount || 5,
                restoreNodeTimeout: this.config.restoreNodeTimeout || 0,
                resetAfterUse: true,
                validateConnection: true
            });

            // ✅ Event handlers para MariaDB pool
            pool.on('connection', (connection) => {
                console.log(`🔗 Nova conexão MariaDB no pool`);
                this.emit('poolConnection', {connectionId: connection.threadId});
            });

            pool.on('error', (err) => {
                console.error('❌ Erro no pool MariaDB:', err.message);
                this.emit('poolError', {error: err.message});
            });

            // ✅ Testar pool
            const testConnection = await pool.getConnection();
            await testConnection.query('SELECT 1');
            testConnection.release();

            this.pool = pool;
            this.connection = pool;
        } else {
            const connection = await mariadb.createConnection(mariadbConfig);

            connection.on('error', (err) => {
                console.error(`❌ Erro na conexão MariaDB:`, err.message);
                this.emit('connectionError', {error: err.message});
            });

            // ✅ Testar conexão
            await connection.query('SELECT 1');
            this.connection = connection;
        }
    }

    // ✅ Conexão PostgreSQL melhorada
    async _connectPostgreSQL() {
        const pgConfig = {
            host: this.config.host,
            user: this.config.username,
            password: this.config.password,
            database: this.config.database,
            port: this.config.port || 5432,
            application_name: `node_app_${this.connectionId}`,
            ...(this.config.ssl !== undefined && {ssl: this.config.ssl}),
            ...(this.config.connectionTimeoutMillis && {
                connectionTimeoutMillis: this.config.connectionTimeoutMillis
            }),
            ...(this.config.idleTimeoutMillis && {
                idleTimeoutMillis: this.config.idleTimeoutMillis
            })
        };

        if (this.config.options) {
            pgConfig.options = this.config.options;
        }

        if (this.config.max) {
            this.pool = new pg.Pool({
                ...pgConfig,
                max: this.config.max,
                min: this.config.min || 2,
                idleTimeoutMillis: this.config.idleTimeoutMillis || 30000,
                connectionTimeoutMillis: this.config.connectionTimeoutMillis || 5000,
                maxUses: this.config.maxUses || 7500,
                allowExitOnIdle: true
            });

            // ✅ Event handlers para PostgreSQL pool
            this.pool.on('connect', (client) => {
                console.log(`🔗 Nova conexão PostgreSQL no pool`);
                this.emit('poolConnection', {processID: client.processID});
            });

            this.pool.on('error', (err, client) => {
                console.error('❌ Erro no pool PostgreSQL:', err.message);
                this.emit('poolError', {error: err.message, processID: client?.processID});
            });

            this.pool.on('remove', (client) => {
                console.log(`🗑️ Conexão PostgreSQL removida do pool`);
                this.emit('poolRemove', {processID: client.processID});
            });

            // ✅ Testar pool
            const client = await this.pool.connect();
            await client.query('SELECT 1');
            client.release();

            this.connection = this.pool;
        } else {
            const client = new pg.Client(pgConfig);
            await client.connect();

            client.on('error', (err) => {
                console.error(`❌ Erro na conexão PostgreSQL:`, err.message);
                this.emit('connectionError', {error: err.message});
            });

            client.on('end', () => {
                console.log('🔌 Conexão PostgreSQL finalizada');
                this.emit('connectionEnd', {timestamp: Date.now()});
            });

            // ✅ Testar conexão
            await client.query('SELECT 1');
            this.connection = client;
        }
    }

    // ✅ Teste de conexão do pool
    async _testPoolConnection(pool) {
        try {
            const connection = await pool.getConnection();
            await connection.execute('SELECT 1');
            connection.release();
        } catch (error) {
            await pool.end();
            throw error;
        }
    }

    // ✅ Health check automático
    _startHealthCheck() {
        const interval = this.config.healthCheckInterval || 30000;

        this.healthCheckInterval = setInterval(async () => {
            await this._performHealthCheck();
        }, interval);
    }

    async _performHealthCheck() {
        try {
            const startTime = Date.now();

            if (this.pool) {
                if (['mysql', 'mariadb'].includes(this.config.driver)) {
                    const connection = await this.pool.getConnection();
                    await connection.execute('SELECT 1 as health');
                    connection.release();
                } else if (this.config.driver === 'postgres') {
                    const client = await this.pool.connect();
                    await client.query('SELECT 1 as health');
                    client.release();
                }
            } else {
                if (this.config.driver === 'postgres') {
                    await this.connection.query('SELECT 1 as health');
                } else {
                    await this.connection.execute('SELECT 1 as health');
                }
            }

            const duration = Date.now() - startTime;

            this.lastHealthCheck = {
                timestamp: Date.now(),
                status: 'healthy',
                duration,
                connectionId: this.connectionId
            };

            this.emit('healthCheck', this.lastHealthCheck);

        } catch (error) {
            this.lastHealthCheck = {
                timestamp: Date.now(),
                status: 'unhealthy',
                error: error.message,
                connectionId: this.connectionId
            };

            this.emit('healthCheckFailed', this.lastHealthCheck);
            console.error(`💔 Health check falhou [${this.connectionId}]:`, error.message);

            // Tentar reconectar se necessário
            if (this._shouldReconnect(error)) {
                await this._attemptReconnect();
            }
        }
    }

    _shouldReconnect(error) {
        const reconnectableErrors = [
            'PROTOCOL_CONNECTION_LOST',
            'ECONNRESET',
            'ECONNREFUSED',
            'ETIMEDOUT'
        ];

        return reconnectableErrors.some(code =>
            error.code === code || error.message.includes(code)
        );
    }

    async _attemptReconnect() {
        if (this.retryCount >= this.maxRetries) {
            console.error(`❌ Máximo de tentativas de reconexão atingido [${this.connectionId}]`);
            return;
        }

        this.retryCount++;
        this.metrics.reconnections++;

        try {
            console.log(`🔄 Tentando reconectar [${this.connectionId}] - Tentativa ${this.retryCount}...`);

            await this.disconnect();
            await this._sleep(this.retryDelay * this.retryCount);
            await this.connect();

            this.retryCount = 0; // Reset no sucesso
            console.log(`✅ Reconexão bem-sucedida [${this.connectionId}]`);

        } catch (error) {
            console.error(`❌ Falha na reconexão [${this.connectionId}]:`, error.message);

            if (this.retryCount < this.maxRetries) {
                setTimeout(() => this._attemptReconnect(), this.retryDelay * this.retryCount * 1000);
            }
        }
    }

    async disconnect() {
        try {
            // ✅ Parar health check
            if (this.healthCheckInterval) {
                clearInterval(this.healthCheckInterval);
                this.healthCheckInterval = null;
            }

            if (this.connection) {
                if (this.pool) {
                    // Fechar pool
                    await this.pool.end();
                    console.log(`👋 Pool de conexões fechado [${this.connectionId}]`);
                } else {
                    // Fechar conexão única
                    if (this.config.driver === 'postgres') {
                        await this.connection.end();
                    } else {
                        await this.connection.end();
                    }
                    console.log(`👋 Conexão única fechada [${this.connectionId}]`);
                }

                // ✅ Atualizar métricas
                if (this.metrics.lastConnected) {
                    this.metrics.totalUptime += Date.now() - this.metrics.lastConnected;
                }

                this.connection = null;
                this.pool = null;
                this.isConnected = false;

                this.emit('disconnected', {
                    connectionId: this.connectionId,
                    timestamp: Date.now(),
                    totalUptime: this.metrics.totalUptime
                });
            }
        } catch (error) {
            console.error(`❌ Erro durante desconexão [${this.connectionId}]:`, error.message);
            throw error;
        }
    }

    // ✅ Métodos de pool melhorados
    async getConnection() {
        if (!this.isConnected) {
            throw new Error('Conexão não estabelecida');
        }

        if (this.pool) {
            if (['mysql', 'mariadb'].includes(this.config.driver)) {
                return await this.pool.getConnection();
            } else {
                return await this.pool.connect();
            }
        }
        return this.connection;
    }

    async releaseConnection(connection) {
        if (this.pool && connection && connection.release) {
            connection.release();
        }
    }

    // ✅ Estatísticas melhoradas do pool
    getPoolStats() {
        const baseStats = {
            connectionId: this.connectionId,
            isConnected: this.isConnected,
            driver: this.config.driver,
            metrics: {...this.metrics},
            lastHealthCheck: this.lastHealthCheck
        };

        if (this.pool && ['mysql', 'mariadb'].includes(this.config.driver)) {
            return {
                ...baseStats,
                pool: {
                    totalConnections: this.pool._allConnections?.length || 0,
                    freeConnections: this.pool._freeConnections?.length || 0,
                    queueLength: this.pool._connectionQueue?.length || 0,
                    acquiringConnections: this.pool._acquiringConnections?.length || 0,
                    activeConnections: (this.pool._allConnections?.length || 0) - (this.pool._freeConnections?.length || 0)
                }
            };
        } else if (this.pool && this.config.driver === 'postgres') {
            return {
                ...baseStats,
                pool: {
                    totalCount: this.pool.totalCount,
                    idleCount: this.pool.idleCount,
                    waitingCount: this.pool.waitingCount,
                    activeCount: this.pool.totalCount - this.pool.idleCount
                }
            };
        }

        return baseStats;
    }

    // ✅ Métodos utilitários
    generateConnectionId() {
        return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    _handleConnectionError(error) {
        this.emit('connectionError', {
            connectionId: this.connectionId,
            error: error.message,
            code: error.code,
            timestamp: Date.now()
        });
    }

    _handleDisconnect() {
        this.isConnected = false;
        this.emit('disconnect', {
            connectionId: this.connectionId,
            timestamp: Date.now()
        });

        // Tentar reconectar automaticamente se configurado
        if (this.config.autoReconnect !== false) {
            setTimeout(() => this._attemptReconnect(), this.retryDelay);
        }
    }

    // ✅ Método para verificar se está conectado
    async ping() {
        try {
            if (this.pool) {
                const connection = await this.getConnection();

                if (this.config.driver === 'postgres') {
                    await connection.query('SELECT 1');
                } else {
                    await connection.execute('SELECT 1');
                }

                this.releaseConnection(connection);
            } else {
                if (this.config.driver === 'postgres') {
                    await this.connection.query('SELECT 1');
                } else {
                    await this.connection.execute('SELECT 1');
                }
            }

            return true;
        } catch (error) {
            return false;
        }
    }

    // ✅ Informações da conexão
    getConnectionInfo() {
        return {
            connectionId: this.connectionId,
            driver: this.config.driver,
            host: this.config.host,
            port: this.config.port,
            database: this.config.database,
            isConnected: this.isConnected,
            hasPool: !!this.pool,
            metrics: this.metrics,
            lastHealthCheck: this.lastHealthCheck
        };
    }
}

export default Connection;
