// src/index.js
import Database from './Database.js';
import QueryBuilder from './QueryBuilder.js';
import Connection from './database/Connection.js';
import MySQLDriver from './drivers/MySQLDriver.js';
import PostgreSQLDriver from './drivers/PostgreSQLDriver.js';

// Exportação principal
export default Database;

// Exportações nomeadas para uso avançado
export {
    Database,
    QueryBuilder,
    Connection,
    MySQLDriver,
    PostgreSQLDriver
};

// Versão do pacote
export const version = '1.0.0';