import mysql from 'mysql2/promise';
import mariadb from 'mariadb';
import pg from 'pg';

class Connection {
    constructor(config) {
        this.config = config;
        this.connection = null; // Conexão única
        this.pool = null; // Pool de conexões
        this.isConnected = false;
        this.connectionId = null;

        this.maxRetries = 3
        this.retryDelay = 1000;
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
        try {
            console.log(`🏁 Driver: ${this.config.driver.toUpperCase()} - Conectando ao banco de dados ${this.config.database}... [ID: ${this.connectionId}]`);

            await this._connectWithRetry();
            this.isConnected = true;

            this.emit('connected', {
                connectionId: this.connectionId,
                driver: this.config.driver,
                timestamp: Date.now()
            });

            console.log(`✅ Conexão estabelecida com sucesso [ID: ${this.connectionId}]`);
            return this.connection;

        } catch (error) {
            this.emit('connectionError', {
                connectionId: this.connectionId,
                error: error.message,
                timestamp: Date.now()
            });

            console.error(`❌ Falha na conexão [ID: ${this.connectionId}]:`, error.message);
            throw error;
        }
    }


    // ✅ Conexão MySQL
    async _connectMySQL() {
        try {
            if (this.config.max) {
                this.pool = mysql.createPool(this.config);
            } else {
                this.connection = await mysql.createConnection(this.config);
            }
            this.connectionId = this._generateConnectionId();
            this.isConnected = true;
        } catch (error) {
            this.isConnected = false;
            this.connectionId = null;
        }
    }

    // ✅ Conexão MariaDB
    async _connectMariaDB() {
        try {
            if (this.config.max) {
                this.pool = mariadb.createPool(this.config);
            } else {
                this.connection = await mariadb.createConnection(this.config);
            }
            this.connectionId = this._generateConnectionId();
            this.isConnected = true;
        } catch (e) {
            this.isConnected = false;
            this.connectionId = null;
        }
    }

    // ✅ Conexão PostgreSQL
    async _connectPostgreSQL() {
        try {
            const pgConfig = {
                ...this.config,
                ...(this.config.options && ({options: this.config.options}))
            };

            if (this.config.max) {
                this.pool = new pg.Pool(this.config);
            } else {
                const client = new pg.Client(pgConfig);
                await client.connect();
                this.connection = client;
            }

            this.connectionId = this._generateConnectionId();
            this.isConnected = true;
        } catch (e) {
            this.isConnected = false;
            this.connectionId = null;
        }
    }

    async disconnect() {
        try {
            if (this.pool) {
                await this.pool.end();
                this.pool = null;
            } else {
                await this.connection.end();
                await this.connection.end();
                this.connection = null;
            }
            this.isConnected = false;
        } catch (error) {
            throw error;
        }
    }

    async release(connection) {
        if (this.pool && connection && connection.release) await connection.release();
    }

    async getConnection() {
        if (!this.isConnected) throw new Error('Conexão não estabelecida');
        if (this.pool) {
            if (['mysql', 'mariadb'].includes(this.config.driver)) return await this.pool.getConnection();
            else return await this.pool.connect();
        }
        return this.connection;
    }

    getConnectionInfo() {
        return {
            connectionId: this.connectionId,
            driver: this.config.driver,
            host: this.config.host,
            port: this.config.port,
            schema: this.config.schema,
            database: this.config.database,
            isConnected: this.isConnected,
            hasPool: !!this.pool,
        };
    }


    _generateConnectionId() {
        return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
}

export default Connection;
