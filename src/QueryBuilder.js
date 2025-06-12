// QueryBuilder.js
import MySQLDriver from './drivers/MySQLDriver.js';
import PostgreSQLDriver from './drivers/PostgreSQLDriver.js';
import MariadbDriver from "./drivers/MariadbDriver.js";

class QueryBuilder {
    constructor(connection, driverType, config = {}) {
        this.connection = connection;
        this.config = config;
        this.driver = this.createDriver(driverType, config);
        this.reset();
    }

    createDriver(driverType, config) {
        switch (driverType) {
            case 'mysql':
                return new MySQLDriver(this.connection, config);
            case 'mariadb':
                return new MariadbDriver(this.connection, config);
            case 'postgres':
                return new PostgreSQLDriver(this.connection, config);
            default:
                throw new Error(`Driver não suportado: ${driverType}`);
        }
    }

    reset() {
        this.selectFields = ['*'];
        this.fromTable = '';
        this.joinClauses = [];
        this.whereClauses = [];
        this.groupByFields = [];
        this.havingClauses = [];
        this.orderByFields = [];
        this.limitValue = null;
        this.offsetValue = null;
        this.distinctFlag = false;
        this.params = [];
        this.updateData = null;
        this.lastQuery = null;
        return this;
    }

    // SELECT methods
    select(fields = '*') {
        if (typeof fields === 'string') {
            this.selectFields = fields === '*' ? ['*'] : [fields];
        } else if (Array.isArray(fields)) {
            this.selectFields = fields;
        }
        return this;
    }

    selectMax(field, alias = null) {
        const maxField = `MAX(${this.driver.escapeIdentifier(field)})`;
        this.selectFields = [alias ? `${maxField} AS ${this.driver.escapeIdentifier(alias)}` : maxField];
        return this;
    }

    selectMin(field, alias = null) {
        const minField = `MIN(${this.driver.escapeIdentifier(field)})`;
        this.selectFields = [alias ? `${minField} AS ${this.driver.escapeIdentifier(alias)}` : minField];
        return this;
    }

    selectAvg(field, alias = null) {
        const avgField = `AVG(${this.driver.escapeIdentifier(field)})`;
        this.selectFields = [alias ? `${avgField} AS ${this.driver.escapeIdentifier(alias)}` : avgField];
        return this;
    }

    selectSum(field, alias = null) {
        const sumField = `SUM(${this.driver.escapeIdentifier(field)})`;
        this.selectFields = [alias ? `${sumField} AS ${this.driver.escapeIdentifier(alias)}` : sumField];
        return this;
    }

    distinct() {
        this.distinctFlag = true;
        return this;
    }

    // FROM method
    from(table) {
        // Se for PostgreSQL e não tiver schema especificado, usar o schema da configuração
        if (this.config.driver === 'postgres' && !table.includes('.')) {
            const schema = this.driver.schema || 'public';
            this.fromTable = this.driver.escapeIdentifier(`${schema}.${table}`);
        } else {
            this.fromTable = this.driver.escapeIdentifier(table);
        }
        return this;
    }

    // Salvar a última query executada
    async executeQuery(sql, params) {
        this.lastQuery = {sql, params};
        return await this.driver.execute(sql, params);
    }

    // JOIN methods
    join(table, condition, type = 'INNER') {
        const escapedTable = this.driver.escapeIdentifier(table);
        this.joinClauses.push(`${type} JOIN ${escapedTable} ON ${condition}`);
        return this;
    }

    leftJoin(table, condition) {
        return this.join(table, condition, 'LEFT');
    }

    rightJoin(table, condition) {
        return this.join(table, condition, 'RIGHT');
    }

    // WHERE methods
    where(field, value = null, operator = '=') {
        if (typeof field === 'object') {
            Object.entries(field).forEach(([key, val]) => {
                // Se já existem condições WHERE, adiciona AND antes da nova condição
                if (this.whereClauses.length > 0) {
                    this.whereClauses.push(`AND ${this.driver.escapeIdentifier(key)} = ?`);
                } else {
                    this.whereClauses.push(`${this.driver.escapeIdentifier(key)} = ?`);
                }
                this.params.push(val);
            });
        } else if (value !== null) {
            // Se já existem condições WHERE, adiciona AND antes da nova condição
            if (this.whereClauses.length > 0) {
                this.whereClauses.push(`AND ${this.driver.escapeIdentifier(field)} ${operator} ?`);
            } else {
                this.whereClauses.push(`${this.driver.escapeIdentifier(field)} ${operator} ?`);
            }
            this.params.push(value);
        } else {
            // Se já existem condições WHERE, adiciona AND antes da nova condição
            if (this.whereClauses.length > 0) {
                this.whereClauses.push(`AND ${field}`);
            } else {
                this.whereClauses.push(field);
            }
        }
        return this;
    }


    orWhere(field, value = null, operator = '=') {
        if (this.whereClauses.length === 0) {
            return this.where(field, value, operator);
        }

        if (typeof field === 'object') {
            const conditions = [];
            Object.entries(field).forEach(([key, val]) => {
                conditions.push(`${this.driver.escapeIdentifier(key)} = ?`);
                this.params.push(val);
            });
            this.whereClauses.push(`OR (${conditions.join(' AND ')})`);
        } else if (value !== null) {
            this.whereClauses.push(`OR ${this.driver.escapeIdentifier(field)} ${operator} ?`);
            this.params.push(value);
        } else {
            this.whereClauses.push(`OR ${field}`);
        }
        return this;
    }

    whereIn(field, values) {
        if (!Array.isArray(values) || values.length === 0) {
            throw new Error('whereIn requer um array não vazio');
        }
        const placeholders = values.map(() => '?').join(', ');
        this.whereClauses.push(`${this.driver.escapeIdentifier(field)} IN (${placeholders})`);
        this.params.push(...values);
        return this;
    }

    whereNotIn(field, values) {
        if (!Array.isArray(values) || values.length === 0) {
            throw new Error('whereNotIn requer um array não vazio');
        }
        const placeholders = values.map(() => '?').join(', ');
        this.whereClauses.push(`${this.driver.escapeIdentifier(field)} NOT IN (${placeholders})`);
        this.params.push(...values);
        return this;
    }

    whereLike(field, value) {
        this.whereClauses.push(`${this.driver.escapeIdentifier(field)} LIKE ?`);
        this.params.push(value);
        return this;
    }

    orWhereLike(field, value) {
        if (this.whereClauses.length === 0) {
            return this.whereLike(field, value);
        }
        this.whereClauses.push(`OR ${this.driver.escapeIdentifier(field)} LIKE ?`);
        this.params.push(value);
        return this;
    }

    whereNotLike(field, value) {
        this.whereClauses.push(`${this.driver.escapeIdentifier(field)} NOT LIKE ?`);
        this.params.push(value);
        return this;
    }

    // GROUP BY and HAVING
    groupBy(fields) {
        if (typeof fields === 'string') {
            this.groupByFields.push(this.driver.escapeIdentifier(fields));
        } else if (Array.isArray(fields)) {
            this.groupByFields.push(...fields.map(field => this.driver.escapeIdentifier(field)));
        }
        return this;
    }

    having(field, value = null, operator = '=') {
        if (typeof field === 'object') {
            Object.entries(field).forEach(([key, val]) => {
                this.havingClauses.push(`${this.driver.escapeIdentifier(key)} = ?`);
                this.params.push(val);
            });
        } else if (value !== null) {
            this.havingClauses.push(`${this.driver.escapeIdentifier(field)} ${operator} ?`);
            this.params.push(value);
        } else {
            this.havingClauses.push(field);
        }
        return this;
    }

    orHaving(field, value = null, operator = '=') {
        if (this.havingClauses.length === 0) {
            return this.having(field, value, operator);
        }

        if (typeof field === 'object') {
            const conditions = [];
            Object.entries(field).forEach(([key, val]) => {
                conditions.push(`${this.driver.escapeIdentifier(key)} = ?`);
                this.params.push(val);
            });
            this.havingClauses.push(`OR (${conditions.join(' AND ')})`);
        } else if (value !== null) {
            this.havingClauses.push(`OR ${this.driver.escapeIdentifier(field)} ${operator} ?`);
            this.params.push(value);
        } else {
            this.havingClauses.push(`OR ${field}`);
        }
        return this;
    }

    // ORDER BY
    orderBy(field, direction = 'ASC') {
        const validDirections = ['ASC', 'DESC'];
        if (!validDirections.includes(direction.toUpperCase())) {
            throw new Error('Direção deve ser ASC ou DESC');
        }
        this.orderByFields.push(`${this.driver.escapeIdentifier(field)} ${direction.toUpperCase()}`);
        return this;
    }

    orderByRandom() {
        this.orderByFields.push(`${this.driver.getRandomFunction()}`);
        return this;
    }

    // LIMIT and OFFSET
    limit(count, offset = null) {
        this.limitValue = count;
        if (offset !== null) {
            this.offsetValue = offset;
        }
        return this;
    }

    offset(count) {
        this.offsetValue = count;
        return this;
    }

    // BUILD and EXECUTE methods
    buildSelectQuery() {
        let sql = 'SELECT ';

        if (this.distinctFlag) {
            sql += 'DISTINCT ';
        }

        sql += this.selectFields.join(', ');

        if (this.fromTable) {
            sql += ` FROM ${this.fromTable}`;
        }

        if (this.joinClauses.length > 0) {
            sql += ` ${this.joinClauses.join(' ')}`;
        }

        if (this.whereClauses.length > 0) {
            sql += ` WHERE ${this.whereClauses.join(' ')}`;
        }

        if (this.groupByFields.length > 0) {
            sql += ` GROUP BY ${this.groupByFields.join(', ')}`;
        }

        if (this.havingClauses.length > 0) {
            sql += ` HAVING ${this.havingClauses.join(' ')}`;
        }

        if (this.orderByFields.length > 0) {
            sql += ` ORDER BY ${this.orderByFields.join(', ')}`;
        }

        if (this.limitValue !== null) {
            sql += ` ${this.driver.getLimitSyntax(this.limitValue, this.offsetValue || 0)}`;
        }

        return sql;
    }

    async get() {
        const sql = this.buildSelectQuery();
        const results = await this.executeQuery(sql, this.params);
        this.reset();
        return results;
    }

    async getWhere(table, where) {
        return this.from(table).where(where).get();
    }

    async first() {
        const results = await this.limit(1).get();
        return results.length > 0 ? results[0] : null;
    }

    async count() {
        const originalSelect = this.selectFields;
        this.selectFields = ['COUNT(*) as count'];
        const result = await this.get();
        this.selectFields = originalSelect;
        return result[0].count;
    }

    // INSERT methods
    async insert(table, data) {
        if (Array.isArray(data)) {
            return this.insertBatch(table, data);
        }

        const fields = Object.keys(data);
        const values = Object.values(data);
        const escapedFields = fields.map(field => this.driver.escapeIdentifier(field));
        const placeholders = fields.map(() => '?').join(', ');

        let sql = `INSERT INTO ${this.driver.escapeIdentifier(table)} (${escapedFields.join(', ')})
                   VALUES (${placeholders})`;

        // Se for PostgreSQL, adicionar RETURNING *
        if (this.config.driver === 'postgres') sql += ' RETURNING *';

        const result = await this.driver.execute(sql, values);

        this.reset();
        return result;
    }

    async insertBatch(table, data) {
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('insertBatch requer um array não vazio');
        }

        const fields = Object.keys(data[0]);
        const escapedFields = fields.map(field => this.driver.escapeIdentifier(field));

        const values = [];
        const placeholders = [];

        data.forEach(row => {
            const rowValues = fields.map(field => row[field]);
            values.push(...rowValues);
            placeholders.push(`(${fields.map(() => '?').join(', ')})`);
        });

        const sql = `INSERT INTO ${this.driver.escapeIdentifier(table)} (${escapedFields.join(', ')})
                     VALUES ${placeholders.join(', ')}`;

        const result = await this.driver.execute(sql, values);
        this.reset();
        return result;
    }

    async replace(table, data) {
        const fields = Object.keys(data);
        const values = Object.values(data);
        const escapedFields = fields.map(field => this.driver.escapeIdentifier(field));
        const placeholders = fields.map(() => '?').join(', ');

        const sql = `REPLACE INTO ${this.driver.escapeIdentifier(table)} (${escapedFields.join(', ')})
                     VALUES (${placeholders})`;

        const result = await this.driver.execute(sql, values);
        this.reset();
        return result;
    }

    // UPDATE methods
    set(field, value = null) {
        if (typeof field === 'object') {
            this.updateData = {...this.updateData, ...field};
        } else {
            this.updateData = this.updateData || {};
            this.updateData[field] = value;
        }
        return this;
    }

    async update(table, data = null, where = null) {
        const updateData = data || this.updateData;

        if (!updateData || Object.keys(updateData).length === 0) {
            throw new Error('Dados para atualização são obrigatórios');
        }

        if (where) {
            this.where(where);
        }

        const setClauses = Object.keys(updateData).map(field =>
            `${this.driver.escapeIdentifier(field)} = ?`
        );
        const setValues = Object.values(updateData);

        let sql = `UPDATE ${this.driver.escapeIdentifier(table)}
                   SET ${setClauses.join(', ')}`;

        if (this.whereClauses.length > 0) {
            sql += ` WHERE ${this.whereClauses.join(' ')}`;
        }

        const allParams = [...setValues, ...this.params];
        const result = await this.driver.execute(sql, allParams);
        this.reset();
        return result;
    }

    // DELETE methods
    async delete(table = null, where = null) {
        if (table) {
            this.fromTable = this.driver.escapeIdentifier(table);
        }

        if (where) {
            this.where(where);
        }

        if (!this.fromTable) {
            throw new Error('Tabela é obrigatória para operação DELETE');
        }

        let sql = `DELETE
                   FROM ${this.fromTable}`;

        if (this.whereClauses.length > 0) {
            sql += ` WHERE ${this.whereClauses.join(' ')}`;
        }

        const result = await this.driver.execute(sql, this.params);
        this.reset();
        return result;
    }

    async emptyTable(table) {
        const sql = `TRUNCATE TABLE ${this.driver.escapeIdentifier(table)}`;
        const result = await this.driver.execute(sql);
        this.reset();
        return result;
    }

    // UTILITY methods
    async query(sql, params = []) {
        return await this.driver.execute(sql, params);
    }

    getCompiledSelect() {
        return this.buildSelectQuery();
    }

    getLastQuery() {
        return this.lastQuery;
    }
}

export default QueryBuilder;
