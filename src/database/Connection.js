import mysql from 'mysql2/promise';
import pg from 'pg';

class Connection {
    constructor(config) {
        this.config = config;
        this.connection = null;
        this.pool = null;
    }

    async connect() {
        if (this.config.driver === 'mysql') {
            // Configuração MySQL
            const mysqlConfig = {
                host: this.config.host,
                user: this.config.username,
                password: this.config.password,
                database: this.config.database,
                port: this.config.port || 3306,

                // Configurações de SSL
                ...(this.config.ssl && { ssl: this.config.ssl }),

                // Configurações de timeout
                ...(this.config.connectionTimeoutMillis && {
                    connectTimeout: this.config.connectionTimeoutMillis
                }),
                ...(this.config.acquireTimeout && {
                    acquireTimeout: this.config.acquireTimeout
                }),
                ...(this.config.timeout && {
                    timeout: this.config.timeout
                }),

                // Configurações adicionais do MySQL
                charset: this.config.charset || 'utf8mb4',
                timezone: this.config.timezone || 'local',
                dateStrings: this.config.dateStrings || false,
                debug: this.config.debug || false,
                trace: this.config.trace || true,
                multipleStatements: this.config.multipleStatements || false,

                // Configurações de reconexão
                reconnect: this.config.reconnect !== false, // true por padrão
                maxReconnects: this.config.maxReconnects || 3,
                reconnectDelay: this.config.reconnectDelay || 2000,
            };

            if (this.config.max) {
                // Usar pool de conexões
                this.pool = mysql.createPool({
                    ...mysqlConfig,

                    // Configurações específicas do pool
                    connectionLimit: this.config.max || 10,
                    queueLimit: this.config.queueLimit || 0,

                    // Timeouts específicos do pool
                    acquireTimeout: this.config.acquireTimeout || 60000,
                    timeout: this.config.timeout || 60000,

                    // Configurações de idle
                    idleTimeout: this.config.idleTimeoutMillis || 30000,
                    maxIdle: this.config.maxIdle || this.config.max,

                    // Configurações de retry
                    retryDelay: this.config.retryDelay || 200,

                    // Pool events
                    removeNodeErrorCount: this.config.removeNodeErrorCount || 5,
                    restoreNodeTimeout: this.config.restoreNodeTimeout || 0,
                });

                // Event listeners para o pool
                this.pool.on('connection', (connection) => {
                    console.log('🔗 Nova conexão MySQL estabelecida:', connection.threadId);
                });

                this.pool.on('error', (err) => {
                    console.error('❌ Erro no pool MySQL:', err);
                });

                this.pool.on('enqueue', () => {
                    console.log('⏳ Requisição enfileirada no pool MySQL');
                });

                this.connection = this.pool;
            } else {
                // Conexão única
                this.connection = await mysql.createConnection(mysqlConfig);

                // Event listeners para conexão única
                this.connection.on('error', (err) => {
                    console.error('❌ Erro na conexão MySQL:', err);
                    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
                        console.log('🔄 Tentando reconectar...');
                        this.handleDisconnect();
                    }
                });
            }

        } else if (this.config.driver === 'postgres') {
            // Configuração PostgreSQL (mantida igual)
            const pgConfig = {
                host: this.config.host,
                user: this.config.username,
                password: this.config.password,
                database: this.config.database,
                port: this.config.port || 5432,
                ...(this.config.ssl !== undefined && { ssl: this.config.ssl }),
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
                    idleTimeoutMillis: this.config.idleTimeoutMillis || 30000,
                    connectionTimeoutMillis: this.config.connectionTimeoutMillis || 5000
                });
                this.connection = this.pool;
            } else {
                const client = new pg.Client(pgConfig);
                await client.connect();
                this.connection = client;
            }
        }

        return this.connection;
    }

    // Método para reconexão automática do MySQL
    async handleDisconnect() {
        if (this.config.driver === 'mysql' && !this.pool) {
            try {
                await this.connect();
                console.log('✅ Reconectado ao MySQL com sucesso');
            } catch (error) {
                console.error('❌ Falha na reconexão MySQL:', error);
                setTimeout(() => this.handleDisconnect(), 2000);
            }
        }
    }

    async disconnect() {
        if (this.connection) {
            if (this.pool) {
                // Fechar pool
                await this.pool.end();
                console.log('👋 Pool de conexões fechado');
            } else {
                // Fechar conexão única
                if (this.config.driver === 'mysql') {
                    await this.connection.end();
                } else {
                    await this.connection.end();
                }
                console.log('👋 Conexão única fechada');
            }
            this.connection = null;
            this.pool = null;
        }
    }

    // Método para obter uma conexão do pool
    async getConnection() {
        if (this.pool) {
            if (this.config.driver === 'mysql') {
                return await this.pool.getConnection();
            } else {
                return await this.pool.connect();
            }
        }
        return this.connection;
    }

    // Método para liberar uma conexão do pool
    async releaseConnection(connection) {
        if (this.pool && connection && connection.release) {
            connection.release();
        }
    }

    // Método para obter estatísticas do pool (MySQL)
    getPoolStats() {
        if (this.pool && this.config.driver === 'mysql') {
            return {
                totalConnections: this.pool._allConnections?.length || 0,
                activeConnections: this.pool._freeConnections?.length || 0,
                queueLength: this.pool._connectionQueue?.length || 0,
                acquiringConnections: this.pool._acquiringConnections?.length || 0
            };
        } else if (this.pool && this.config.driver === 'postgres') {
            return {
                totalCount: this.pool.totalCount,
                idleCount: this.pool.idleCount,
                waitingCount: this.pool.waitingCount,
                activeCount: this.pool.totalCount - this.pool.idleCount
            };
        }
        return null;
    }
}

export default Connection;
