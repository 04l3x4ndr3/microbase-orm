import mysql from 'mysql2/promise';
import mariadb from 'mariadb';
import pg from 'pg';

class Connection {
    constructor(config) {
        this.config = config;
        this.connection = null;
        this.pool = null;
    }

    async connect() {
        console.log(`🏁 Driver: ${this.config.driver.toUpperCase()} - Conectando ao banco de dados ${this.config.database}...`);

        switch (this.config.driver.toLowerCase()) {
            case 'mysql':
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
                        timeout: this.config.timeout || 60000
                    });

                    pool.on('connection', (connection) => {
                        console.log(`🔗 Nova conexão MySQL estabelecida:`, connection.threadId);
                    });

                    pool.on('error', (err) => {
                        console.error('❌ Erro no pool MySQL:', err);
                    });

                    pool.on('enqueue', () => {
                        console.log('⏳ Requisição enfileirada no pool MySQL');
                    });

                    this.pool = pool;
                    this.connection = pool;
                } else {
                    const connection = await mysql.createConnection(mysqlConfig);
                    connection.on('error', (err) => {
                        console.error(`❌ Erro na conexão MySQL:`, err);
                        if (err.code === 'PROTOCOL_CONNECTION_LOST') {
                            console.log('🔄 Tentando reconectar...');
                            this.handleDisconnect();
                        }
                    });
                    this.connection = connection;
                }
                break;

            case 'mariadb':
                const mariadbConfig = {
                    host: this.config.host,
                    user: this.config.username,
                    password: this.config.password,
                    database: this.config.database,
                    port: this.config.port || 3306,
                    multipleStatements: this.config.multipleStatements || false,
                    allowUserPasswords: true,
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
                    });

                    pool.on('connection', (connection) => {
                        console.log(`🔗 Nova conexão MariaDB estabelecida.`);
                    });

                    pool.on('error', (err) => {
                        console.error('❌ Erro no pool MariaDB:', err);
                    });

                    this.pool = pool;
                    this.connection = pool;
                } else {
                    const connection = await mariadb.createConnection(mariadbConfig);
                    connection.on('error', (err) => {
                        console.error(`❌ Erro na conexão MariaDB:`, err);
                    });
                    this.connection = connection;
                }
                break;

            case 'postgres':
                // Configurações do PostgreSQL (sem alterações).
                const pgConfig = {
                    host: this.config.host,
                    user: this.config.username,
                    password: this.config.password,
                    database: this.config.database,
                    port: this.config.port || 5432,
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
                        idleTimeoutMillis: this.config.idleTimeoutMillis || 30000,
                        connectionTimeoutMillis: this.config.connectionTimeoutMillis || 5000
                    });
                    this.connection = this.pool;
                } else {
                    const client = new pg.Client(pgConfig);
                    await client.connect();
                    this.connection = client;
                }
                break;
        }

        return this.connection;
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
            if (['mysql', 'mariadb'].includes(this.config.driver)) {
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
        if (this.pool && ['mysql', 'mariadb'].includes(this.config.driver)) {
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
