// QueryBuilder.js
import MySQLDriver from './drivers/MySQLDriver.js';
import PostgreSQLDriver from './drivers/PostgreSQLDriver.js';
import MariadbDriver from "./drivers/MariadbDriver.js";

class QueryBuilder {
    constructor(connection, driverType, config = {}) {
        this.connection = connection;
        this.driverType = driverType;
        this.config = config;
        this.driver = this.createDriver(driverType, config);

        // ✅ Sistema de ID único para rastreamento
        this.queryBuilderId = this.generateBuilderId();

        // ✅ Cache de queries compiladas
        this.queryCache = new Map();
        this.maxCacheSize = config?.maxQueryCache || 50;

        // ✅ Métricas do QueryBuilder
        this.metrics = {
            queriesBuilt: 0,
            cacheHits: 0,
            cacheMisses: 0,
            avgBuildTime: 0,
            complexQueries: 0,
            errors: 0
        };

        // ✅ Configurações de validação
        this.validation = {
            enabled: config.validation !== false,
            maxWhereConditions: config.maxWhereConditions || 50,
            maxJoins: config.maxJoins || 20,
            maxSelectFields: config.maxSelectFields || 100,
            maxGroupByFields: config.maxGroupByFields || 20,
            maxOrderByFields: config.maxOrderByFields || 10
        };

        // ✅ Sistema de debug avançado
        this.DEBUG = config.debug || false;
        this.debugLevel = config.debugLevel || 'info'; // info, warn, error

        // ✅ Estado de transação
        this.inTransaction = false;
        this.transactionDepth = 0;

        this.reset();

        if (this.DEBUG) console.log(`🔧 QueryBuilder inicializado [${this.queryBuilderId}] - Driver: ${driverType}`);
    }

    generateBuilderId() {
        return `qb_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    createDriver(driverType, config) {
        const drivers = {
            'mysql': MySQLDriver,
            'mariadb': MariadbDriver,
            'postgres': PostgreSQLDriver,
            'postgresql': PostgreSQLDriver
        };
        const DriverClass = drivers[driverType.toLowerCase()];
        if (!DriverClass) throw new Error(`Driver não suportado: ${driverType}. Drivers disponíveis: ${Object.keys(drivers).join(', ')}`);
        return new DriverClass(this.connection, config);
    }

    // ✅ Reset melhorado com validação de estado
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
        this.lastExecutionTime = null;
        this.currentOperation = null;

        // ✅ Estado de subconsultas
        this.subqueries = [];
        this.isSubquery = false;

        // ✅ Estado de CTE (Common Table Expressions)
        this.cteQueries = [];

        return this;
    }

    // ===============================
    // ✅ MÉTODOS SELECT MELHORADOS
    // ===============================

    select(fields = '*') {
        this._validateSelectFields(fields);

        if (typeof fields === 'string') {
            this.selectFields = fields === '*' ? ['*'] : [fields];
        } else if (Array.isArray(fields)) {
            this.selectFields = fields;
        } else if (typeof fields === 'object' && fields !== null) {
            // ✅ Suporte a objeto para alias: { nome: 'name', idade: 'age' }
            this.selectFields = Object.entries(fields).map(([field, alias]) =>
                `${this.driver.escapeIdentifier(field)} AS ${this.driver.escapeIdentifier(alias)}`
            );
        }

        this.currentOperation = 'SELECT';
        return this;
    }

    // ✅ Seleção com expressão SQL raw
    selectRaw(expression, alias = null) {
        this._validateNotEmpty(expression, 'Expressão SQL');

        if (alias) {
            this.selectFields = [`${expression} AS ${this.driver.escapeIdentifier(alias)}`];
        } else {
            this.selectFields = [expression];
        }

        return this;
    }

    // ✅ Funções de agregação melhoradas
    selectMax(field, alias = null) {
        this._validateFieldName(field);
        const maxField = `MAX(${this.driver.escapeIdentifier(field)})`;
        this.selectFields = [alias ? `${maxField} AS ${this.driver.escapeIdentifier(alias)}` : maxField];
        return this;
    }

    selectMin(field, alias = null) {
        this._validateFieldName(field);
        const minField = `MIN(${this.driver.escapeIdentifier(field)})`;
        this.selectFields = [alias ? `${minField} AS ${this.driver.escapeIdentifier(alias)}` : minField];
        return this;
    }

    selectAvg(field, alias = null) {
        this._validateFieldName(field);
        const avgField = `AVG(${this.driver.escapeIdentifier(field)})`;
        this.selectFields = [alias ? `${avgField} AS ${this.driver.escapeIdentifier(alias)}` : avgField];
        return this;
    }

    selectSum(field, alias = null) {
        this._validateFieldName(field);
        const sumField = `SUM(${this.driver.escapeIdentifier(field)})`;
        this.selectFields = [alias ? `${sumField} AS ${this.driver.escapeIdentifier(alias)}` : sumField];
        return this;
    }

    selectCount(field = '*', alias = 'count') {
        const fieldToCount = field === '*' ? '*' : this.driver.escapeIdentifier(field);
        const countField = `COUNT(${fieldToCount})`;
        this.selectFields = [alias ? `${countField} AS ${this.driver.escapeIdentifier(alias)}` : countField];
        return this;
    }

    // ✅ Suporte a window functions (PostgreSQL/MySQL 8.0+)
    selectWindow(expression, windowSpec, alias = null) {
        this._validateNotEmpty(expression, 'Expressão window');
        this._validateNotEmpty(windowSpec, 'Especificação window');

        const windowField = `${expression} OVER (${windowSpec})`;
        this.selectFields = [alias ? `${windowField} AS ${this.driver.escapeIdentifier(alias)}` : windowField];
        return this;
    }

    distinct() {
        this.distinctFlag = true;
        return this;
    }


    // ===============================
    // ✅ FROM MELHORADO
    // ===============================

    from(table, alias = null) {
        this._validateTableName(table);

        let tableName = table;

        // ✅ CORREÇÃO: Auto-schema para PostgreSQL
        if (this.driverType === 'postgres' && !table.includes('.') && !table.includes(' ') && !table.includes('(')) {
            const schema = this.config.schema || this.driver.schema || 'public';
            tableName = `${schema}.${table}`;
        }

        this.fromTable = alias
            ? `${this.driver.escapeIdentifier(tableName)} AS ${this.driver.escapeIdentifier(alias)}`
            : this.driver.escapeIdentifier(tableName);

        return this;
    }

    // ✅ FROM com subconsulta
    fromSubquery(subquery, alias) {
        this._validateNotEmpty(alias, 'Alias da subconsulta');

        if (typeof subquery === 'function') {
            const subBuilder = new QueryBuilder(this.connection, this.driverType, this.config);
            subBuilder.isSubquery = true;
            subquery(subBuilder);
            const subSql = subBuilder.buildSelectQuery();
            this.fromTable = `(${subSql}) AS ${this.driver.escapeIdentifier(alias)}`;
            this.params = [...this.params, ...subBuilder.params];
        } else if (typeof subquery === 'string') {
            this.fromTable = `(${subquery}) AS ${this.driver.escapeIdentifier(alias)}`;
        }

        return this;
    }

    // ===============================
    // ✅ JOIN METHODS MELHORADOS
    // ===============================

    join(table, condition, type = 'INNER', alias = null) {
        this._validateJoinCount();
        this._validateTableName(table);
        this._validateNotEmpty(condition, 'Condição do JOIN');

        const validJoinTypes = ['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS'];
        if (!validJoinTypes.includes(type.toUpperCase())) {
            throw new Error(`Tipo de JOIN inválido: ${type}. Tipos válidos: ${validJoinTypes.join(', ')}`);
        }

        let escapedTable = this.driver.escapeIdentifier(table);
        if (alias) {
            escapedTable += ` AS ${this.driver.escapeIdentifier(alias)}`;
        }

        this.joinClauses.push(`${type.toUpperCase()} JOIN ${escapedTable} ON ${condition}`);
        return this;
    }

    leftJoin(table, condition, alias = null) {
        return this.join(table, condition, 'LEFT', alias);
    }

    rightJoin(table, condition, alias = null) {
        return this.join(table, condition, 'RIGHT', alias);
    }

    fullJoin(table, condition, alias = null) {
        return this.join(table, condition, 'FULL', alias);
    }

    crossJoin(table, alias = null) {
        this._validateJoinCount();
        this._validateTableName(table);

        let escapedTable = this.driver.escapeIdentifier(table);
        if (alias) {
            escapedTable += ` AS ${this.driver.escapeIdentifier(alias)}`;
        }

        this.joinClauses.push(`CROSS JOIN ${escapedTable}`);
        return this;
    }

    // ✅ JOIN com subconsulta
    joinSubquery(subquery, alias, condition, type = 'INNER') {
        this._validateJoinCount();
        this._validateNotEmpty(alias, 'Alias do JOIN');
        this._validateNotEmpty(condition, 'Condição do JOIN');

        if (typeof subquery === 'function') {
            const subBuilder = new QueryBuilder(this.connection, this.driverType, this.config);
            subBuilder.isSubquery = true;
            subquery(subBuilder);
            const subSql = subBuilder.buildSelectQuery();
            this.joinClauses.push(`${type.toUpperCase()} JOIN (${subSql}) AS ${this.driver.escapeIdentifier(alias)} ON ${condition}`);
            this.params = [...this.params, ...subBuilder.params];
        }

        return this;
    }


    // ===============================
    // ✅ WHERE METHODS MELHORADOS
    // ===============================

    where(field, value = null, operator = '=') {
        this._validateWhereCount();

        if (typeof field === 'object' && field !== null) {
            Object.entries(field).forEach(([key, val]) => {
                this._addWhereClause(`${this.driver.escapeIdentifier(key)} = ?`, val);
            });
        } else if (typeof field === 'function') {
            // ✅ Suporte a closures para agrupamento
            this._addWhereGroup(field);
        } else if (value !== null && value !== undefined) {
            this._validateOperator(operator);
            this._addWhereClause(`${this.driver.escapeIdentifier(field)} ${operator} ?`, value);
        } else {
            // Raw condition
            this._addWhereClause(field);
        }

        return this;
    }

    orWhere(field, value = null, operator = '=') {
        if (this.whereClauses.length === 0) {
            return this.where(field, value, operator);
        }

        if (typeof field === 'object' && field !== null) {
            const conditions = [];
            const values = [];
            Object.entries(field).forEach(([key, val]) => {
                conditions.push(`${this.driver.escapeIdentifier(key)} = ?`);
                values.push(val);
            });
            this.whereClauses.push(`OR (${conditions.join(' AND ')})`);
            this.params.push(...values);
        } else if (typeof field === 'function') {
            this._addOrWhereGroup(field);
        } else if (value !== null && value !== undefined) {
            this._validateOperator(operator);
            this.whereClauses.push(`OR ${this.driver.escapeIdentifier(field)} ${operator} ?`);
            this.params.push(value);
        } else {
            this.whereClauses.push(`OR ${field}`);
        }

        return this;
    }

    // ✅ WHERE com subconsulta
    whereSubquery(field, operator, subquery) {
        this._validateWhereCount();
        this._validateFieldName(field);
        this._validateOperator(operator);

        if (typeof subquery === 'function') {
            const subBuilder = new QueryBuilder(this.connection, this.driverType, this.config);
            subBuilder.isSubquery = true;
            subquery(subBuilder);
            const subSql = subBuilder.buildSelectQuery();
            this._addWhereClause(`${this.driver.escapeIdentifier(field)} ${operator} (${subSql})`);
            this.params = [...this.params, ...subBuilder.params];
        }

        return this;
    }

    whereExists(subquery) {
        this._validateWhereCount();

        if (typeof subquery === 'function') {
            const subBuilder = new QueryBuilder(this.connection, this.driverType, this.config);
            subBuilder.isSubquery = true;
            subquery(subBuilder);
            const subSql = subBuilder.buildSelectQuery();
            this._addWhereClause(`EXISTS (${subSql})`);
            this.params = [...this.params, ...subBuilder.params];
        }

        return this;
    }

    whereNotExists(subquery) {
        this._validateWhereCount();

        if (typeof subquery === 'function') {
            const subBuilder = new QueryBuilder(this.connection, this.driverType, this.config);
            subBuilder.isSubquery = true;
            subquery(subBuilder);
            const subSql = subBuilder.buildSelectQuery();
            this._addWhereClause(`NOT EXISTS (${subSql})`);
            this.params = [...this.params, ...subBuilder.params];
        }

        return this;
    }

    whereIn(field, values) {
        this._validateWhereCount();
        this._validateFieldName(field);
        this._validateArrayValues(values, 'whereIn');

        const placeholders = values.map(() => '?').join(', ');
        this._addWhereClause(`${this.driver.escapeIdentifier(field)} IN (${placeholders})`);
        this.params.push(...values);
        return this;
    }

    whereNotIn(field, values) {
        this._validateWhereCount();
        this._validateFieldName(field);
        this._validateArrayValues(values, 'whereNotIn');

        const placeholders = values.map(() => '?').join(', ');
        this._addWhereClause(`${this.driver.escapeIdentifier(field)} NOT IN (${placeholders})`);
        this.params.push(...values);
        return this;
    }

    whereBetween(field, min, max) {
        this._validateWhereCount();
        this._validateFieldName(field);

        this._addWhereClause(`${this.driver.escapeIdentifier(field)} BETWEEN ? AND ?`, [min, max]);
        return this;
    }

    whereNotBetween(field, min, max) {
        this._validateWhereCount();
        this._validateFieldName(field);

        this._addWhereClause(`${this.driver.escapeIdentifier(field)} NOT BETWEEN ? AND ?`, [min, max]);
        return this;
    }

    whereNull(field) {
        this._validateWhereCount();
        this._validateFieldName(field);

        this._addWhereClause(`${this.driver.escapeIdentifier(field)} IS NULL`);
        return this;
    }

    whereNotNull(field) {
        this._validateWhereCount();
        this._validateFieldName(field);

        this._addWhereClause(`${this.driver.escapeIdentifier(field)} IS NOT NULL`);
        return this;
    }

    whereLike(field, value) {
        this._validateWhereCount();
        this._validateFieldName(field);

        this._addWhereClause(`${this.driver.escapeIdentifier(field)} LIKE ?`, value);
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
        this._validateWhereCount();
        this._validateFieldName(field);

        this._addWhereClause(`${this.driver.escapeIdentifier(field)} NOT LIKE ?`, value);
        return this;
    }

    // ✅ WHERE com expressão raw
    whereRaw(expression, bindings = []) {
        this._validateWhereCount();
        this._validateNotEmpty(expression, 'Expressão WHERE');

        this._addWhereClause(expression);
        if (Array.isArray(bindings)) {
            this.params.push(...bindings);
        } else if (bindings !== null && bindings !== undefined) {
            this.params.push(bindings);
        }

        return this;
    }


    // ===============================
    // ✅ GROUP BY E HAVING MELHORADOS
    // ===============================

    groupBy(fields) {
        this._validateGroupByCount();

        if (typeof fields === 'string') {
            this.groupByFields.push(this.driver.escapeIdentifier(fields));
        } else if (Array.isArray(fields)) {
            fields.forEach(field => {
                this._validateFieldName(field);
                this.groupByFields.push(this.driver.escapeIdentifier(field));
            });
        }
        return this;
    }

    groupByRaw(expression) {
        this._validateNotEmpty(expression, 'Expressão GROUP BY');
        this.groupByFields.push(expression);
        return this;
    }

    having(field, value = null, operator = '=') {
        if (typeof field === 'object' && field !== null) {
            Object.entries(field).forEach(([key, val]) => {
                // ✅ CORREÇÃO: Verificar se já existem cláusulas HAVING
                if (this.havingClauses.length > 0) {
                    this.havingClauses.push(`AND ${this.driver.escapeIdentifier(key)} = ?`);
                } else {
                    this.havingClauses.push(`${this.driver.escapeIdentifier(key)} = ?`);
                }
                this.params.push(val);
            });
        } else if (value !== null && value !== undefined) {
            this._validateOperator(operator);
            if (this.havingClauses.length > 0) {
                this.havingClauses.push(`AND ${this.driver.escapeIdentifier(field)} ${operator} ?`);
            } else {
                this.havingClauses.push(`${this.driver.escapeIdentifier(field)} ${operator} ?`);
            }
            this.params.push(value);
        } else {
            if (this.havingClauses.length > 0) {
                this.havingClauses.push(`AND ${field}`);
            } else {
                this.havingClauses.push(field);
            }
        }
        return this;
    }

    orHaving(field, value = null, operator = '=') {
        if (this.havingClauses.length === 0) {
            return this.having(field, value, operator);
        }

        if (typeof field === 'object' && field !== null) {
            const conditions = [];
            const values = [];
            Object.entries(field).forEach(([key, val]) => {
                conditions.push(`${this.driver.escapeIdentifier(key)} = ?`);
                values.push(val);
            });
            this.havingClauses.push(`OR (${conditions.join(' AND ')})`);
            this.params.push(...values);
        } else if (value !== null && value !== undefined) {
            this._validateOperator(operator);
            this.havingClauses.push(`OR ${this.driver.escapeIdentifier(field)} ${operator} ?`);
            this.params.push(value);
        } else {
            this.havingClauses.push(`OR ${field}`);
        }
        return this;
    }

    havingRaw(expression, bindings = []) {
        this._validateNotEmpty(expression, 'Expressão HAVING');

        if (this.havingClauses.length > 0) {
            this.havingClauses.push(`AND ${expression}`);
        } else {
            this.havingClauses.push(expression);
        }

        if (Array.isArray(bindings)) {
            this.params.push(...bindings);
        }

        return this;
    }


    // ===============================
    // ✅ ORDER BY MELHORADO
    // ===============================

    orderBy(field, direction = 'ASC') {
        this._validateOrderByCount();
        this._validateFieldName(field);

        const validDirections = ['ASC', 'DESC'];
        const upperDirection = direction.toUpperCase();

        if (!validDirections.includes(upperDirection)) {
            throw new Error(`Direção deve ser ASC ou DESC, recebido: ${direction}`);
        }

        this.orderByFields.push(`${this.driver.escapeIdentifier(field)} ${upperDirection}`);
        return this;
    }

    orderByRaw(expression) {
        this._validateOrderByCount();
        this._validateNotEmpty(expression, 'Expressão ORDER BY');

        this.orderByFields.push(expression);
        return this;
    }

    orderByRandom() {
        this._validateOrderByCount();
        this.orderByFields.push(this.driver.getRandomFunction());
        return this;
    }

    // ✅ ORDER BY com NULLS FIRST/LAST (PostgreSQL)
    orderByNulls(field, direction = 'ASC', nullsPosition = 'LAST') {
        this._validateOrderByCount();
        this._validateFieldName(field);

        const validDirections = ['ASC', 'DESC'];
        const validNullsPositions = ['FIRST', 'LAST'];

        if (!validDirections.includes(direction.toUpperCase())) {
            throw new Error(`Direção deve ser ASC ou DESC, recebido: ${direction}`);
        }

        if (!validNullsPositions.includes(nullsPosition.toUpperCase())) {
            throw new Error(`Posição de NULLs deve ser FIRST ou LAST, recebido: ${nullsPosition}`);
        }

        if (this.driverType === 'postgres') {
            this.orderByFields.push(`${this.driver.escapeIdentifier(field)} ${direction.toUpperCase()} NULLS ${nullsPosition.toUpperCase()}`);
        } else {
            // Fallback para outros bancos
            this.orderByFields.push(`${this.driver.escapeIdentifier(field)} ${direction.toUpperCase()}`);
        }

        return this;
    }


    // ===============================
    // ✅ LIMIT E OFFSET MELHORADOS
    // ===============================

    limit(count, offset = null) {
        this._validateLimit(count);

        this.limitValue = count;
        if (offset !== null) {
            this._validateOffset(offset);
            this.offsetValue = offset;
        }
        return this;
    }

    offset(count) {
        this._validateOffset(count);
        this.offsetValue = count;
        return this;
    }

    // ✅ Paginação simplificada
    paginate(page, perPage = 15) {
        this._validatePagination(page, perPage);

        const offset = (page - 1) * perPage;
        return this.limit(perPage, offset);
    }


    // ===============================
    // ✅ COMMON TABLE EXPRESSIONS (CTE)
    // ===============================

    with(name, query) {
        this._validateNotEmpty(name, 'Nome da CTE');

        if (this.driverType !== 'postgres' && this.driverType !== 'postgresql') {
            throw new Error('CTEs são suportadas apenas no PostgreSQL');
        }

        if (typeof query === 'function') {
            const cteBuilder = new QueryBuilder(this.connection, this.driverType, this.config);
            cteBuilder.isSubquery = true;
            query(cteBuilder);
            const cteSql = cteBuilder.buildSelectQuery();
            this.cteQueries.push(`${this.driver.escapeIdentifier(name)} AS (${cteSql})`);
            this.params = [...cteBuilder.params, ...this.params];
        }

        return this;
    }

    withRecursive(name, query) {
        this._validateNotEmpty(name, 'Nome da CTE recursiva');

        if (this.driverType !== 'postgres' && this.driverType !== 'postgresql') {
            throw new Error('CTEs recursivas são suportadas apenas no PostgreSQL');
        }

        if (typeof query === 'function') {
            const cteBuilder = new QueryBuilder(this.connection, this.driverType, this.config);
            cteBuilder.isSubquery = true;
            query(cteBuilder);
            const cteSql = cteBuilder.buildSelectQuery();
            this.cteQueries.push(`${this.driver.escapeIdentifier(name)} AS (${cteSql})`);
            this.params = [...cteBuilder.params, ...this.params];
        }

        return this;
    }


    // ===============================
    // ✅ UNION OPERATIONS
    // ===============================

    union(query, all = false) {
        if (typeof query === 'function') {
            const unionBuilder = new QueryBuilder(this.connection, this.driverType, this.config);
            unionBuilder.isSubquery = true;
            query(unionBuilder);
            const unionSql = unionBuilder.buildSelectQuery();

            const unionType = all ? 'UNION ALL' : 'UNION';
            this.subqueries.push(`${unionType} (${unionSql})`);
            this.params = [...this.params, ...unionBuilder.params];
        }

        return this;
    }

    unionAll(query) {
        return this.union(query, true);
    }


    // ===============================
    // ✅ BUILD E EXECUTE METHODS
    // ===============================

    buildSelectQuery() {
        const startTime = Date.now();

        try {
            // ✅ Cache de query
            const cacheKey = this._generateCacheKey();
            if (this.queryCache.has(cacheKey)) {
                this.metrics.cacheHits++;
                return this.queryCache.get(cacheKey);
            } else {
                this.metrics.cacheMisses++;
            }

            let sql = '';

            // ✅ CTEs (PostgreSQL)
            if (this.cteQueries.length > 0) {
                sql += `WITH ${this.cteQueries.join(', ')} `;
            }

            sql += 'SELECT ';

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

            // ✅ UNIONs
            if (this.subqueries.length > 0) {
                sql += ` ${this.subqueries.join(' ')}`;
            }

            // ✅ Adicionar ao cache
            if (this.queryCache.size < this.maxCacheSize) {
                this.queryCache.set(cacheKey, sql);
            }

            const buildTime = Date.now() - startTime;
            this._updateBuildMetrics(buildTime);

            return sql;

        } catch (error) {
            this.metrics.errors++;
            throw error;
        }
    }

    // ✅ Salvar a última query executada com métricas
    async executeQuery(sql, params) {
        const startTime = Date.now();

        try {
            const result = await this.driver.execute(sql, params);

            const executionTime = Date.now() - startTime;
            this.lastQuery = {sql, params, executionTime, timestamp: Date.now()};
            this.lastExecutionTime = executionTime;

            if (this.DEBUG) {
                this._logQueryExecution(sql, params, executionTime);
            }

            return result;

        } catch (error) {
            this.metrics.errors++;

            if (this.DEBUG) {
                this._logQueryError(sql, params, error);
            }

            throw error;
        }
    }


    // ===============================
    // ✅ MÉTODOS DE EXECUÇÃO MELHORADOS
    // ===============================

    async get() {
        this._validateQueryState();

        const sql = this.buildSelectQuery();
        const results = await this.executeQuery(sql, this.params);
        this.reset();
        return results;
    }

    async getWhere(table, where) {
        this._validateTableName(table);
        return this.from(table).where(where).get();
    }

    async first() {
        const results = await this.limit(1).get();
        return results.length > 0 ? results[0] : null;
    }

    async count(field = '*') {
        const originalSelect = [...this.selectFields];
        const originalLimit = this.limitValue;
        const originalOffset = this.offsetValue;

        const countField = field === '*' ? '*' : this.driver.escapeIdentifier(field);
        this.selectFields = [`COUNT(${countField}) as count`];
        this.limitValue = null;
        this.offsetValue = null;

        const result = await this.get();

        this.selectFields = originalSelect;
        this.limitValue = originalLimit;
        this.offsetValue = originalOffset;

        return parseInt(result[0].count) || 0;
    }

    // ✅ Exists check
    async exists() {
        const originalSelect = [...this.selectFields];
        const originalLimit = this.limitValue;

        this.selectFields = ['1'];
        this.limitValue = 1;

        const result = await this.get();

        this.selectFields = originalSelect;
        this.limitValue = originalLimit;

        return result.length > 0;
    }

    // ✅ Chunk processing para grandes datasets
    async chunk(size, callback) {
        this._validateChunkSize(size);
        this._validateCallback(callback);

        let offset = 0;
        let processedRows = 0;

        while (true) {
            const builderClone = this.clone();
            builderClone.limit(size, offset);

            const chunk = await builderClone.get();

            if (chunk.length === 0) {
                break;
            }

            const shouldContinue = await callback(chunk, Math.floor(offset / size) + 1);
            processedRows += chunk.length;

            if (shouldContinue === false) {
                break;
            }

            if (chunk.length < size) {
                break;
            }

            offset += size;
        }

        return processedRows;
    }


    // ===============================
    // ✅ INSERT METHODS MELHORADOS
    // ===============================

    async insert(table, data) {
        this._validateTableName(table);
        this._validateInsertData(data);

        if (Array.isArray(data)) {
            return this.insertBatch(table, data);
        }

        const fields = Object.keys(data);
        const values = Object.values(data);
        const escapedFields = fields.map(field => this.driver.escapeIdentifier(field));
        const placeholders = fields.map(() => '?').join(', ');

        let sql = `INSERT INTO ${this.driver.escapeIdentifier(table)} (${escapedFields.join(', ')})
                   VALUES (${placeholders})`;

        // ✅ RETURNING para PostgreSQL
        if (this.driverType === 'postgres' || this.driverType === 'postgresql') {
            sql += ' RETURNING *';
        }

        const result = await this.executeQuery(sql, values);
        this.reset();
        return result;
    }

    async insertBatch(table, data) {
        this._validateTableName(table);
        this._validateBatchData(data);

        const fields = Object.keys(data[0]);
        const escapedFields = fields.map(field => this.driver.escapeIdentifier(field));

        const values = [];
        const placeholders = [];

        data.forEach(row => {
            // ✅ Validar que todas as linhas têm os mesmos campos
            const rowFields = Object.keys(row);
            if (!this._arraysEqual(fields, rowFields)) {
                throw new Error('Todas as linhas do batch devem ter os mesmos campos');
            }

            const rowValues = fields.map(field => row[field]);
            values.push(...rowValues);
            placeholders.push(`(${fields.map(() => '?').join(', ')})`);
        });

        const sql = `INSERT INTO ${this.driver.escapeIdentifier(table)} (${escapedFields.join(', ')})
                     VALUES ${placeholders.join(', ')}`;

        const result = await this.executeQuery(sql, values);
        this.reset();
        return result;
    }

    // ✅ INSERT com ON DUPLICATE KEY UPDATE (MySQL) / ON CONFLICT (PostgreSQL)
    async insertOrUpdate(table, data, conflictColumns = null) {
        this._validateTableName(table);
        this._validateInsertData(data);

        if (this.driverType === 'mysql' || this.driverType === 'mariadb') {
            return this._insertOrUpdateMySQL(table, data);
        } else if (this.driverType === 'postgres' || this.driverType === 'postgresql') {
            return this._insertOrUpdatePostgreSQL(table, data, conflictColumns);
        } else {
            throw new Error('insertOrUpdate não suportado para este driver');
        }
    }

    async _insertOrUpdateMySQL(table, data) {
        const fields = Object.keys(data);
        const values = Object.values(data);
        const escapedFields = fields.map(field => this.driver.escapeIdentifier(field));
        const placeholders = fields.map(() => '?').join(', ');

        const updateClauses = fields.map(field =>
            `${this.driver.escapeIdentifier(field)} = VALUES(${this.driver.escapeIdentifier(field)})`
        );

        const sql = `INSERT INTO ${this.driver.escapeIdentifier(table)} (${escapedFields.join(', ')})
                     VALUES (${placeholders})
                     ON DUPLICATE KEY UPDATE ${updateClauses.join(', ')}`;

        const result = await this.executeQuery(sql, values);
        this.reset();
        return result;
    }

    async _insertOrUpdatePostgreSQL(table, data, conflictColumns) {
        if (!conflictColumns || !Array.isArray(conflictColumns)) {
            throw new Error('conflictColumns é obrigatório para PostgreSQL');
        }

        const fields = Object.keys(data);
        const values = Object.values(data);
        const escapedFields = fields.map(field => this.driver.escapeIdentifier(field));
        const placeholders = fields.map(() => '?').join(', ');

        const updateClauses = fields
            .filter(field => !conflictColumns.includes(field))
            .map(field => `${this.driver.escapeIdentifier(field)} = EXCLUDED.${this.driver.escapeIdentifier(field)}`);

        const escapedConflictColumns = conflictColumns.map(col => this.driver.escapeIdentifier(col));

        let sql = `INSERT INTO ${this.driver.escapeIdentifier(table)} (${escapedFields.join(', ')})
                   VALUES (${placeholders})
                   ON CONFLICT (${escapedConflictColumns.join(', ')})`;

        if (updateClauses.length > 0) {
            sql += ` DO UPDATE SET ${updateClauses.join(', ')}`;
        } else {
            sql += ' DO NOTHING';
        }

        sql += ' RETURNING *';

        const result = await this.executeQuery(sql, values);
        this.reset();
        return result;
    }

    async replace(table, data) {
        this._validateTableName(table);
        this._validateInsertData(data);

        if (this.driverType !== 'mysql' && this.driverType !== 'mariadb') {
            throw new Error('REPLACE só é suportado no MySQL/MariaDB');
        }

        const fields = Object.keys(data);
        const values = Object.values(data);
        const escapedFields = fields.map(field => this.driver.escapeIdentifier(field));
        const placeholders = fields.map(() => '?').join(', ');

        const sql = `REPLACE INTO ${this.driver.escapeIdentifier(table)} (${escapedFields.join(', ')})
                     VALUES (${placeholders})`;

        const result = await this.executeQuery(sql, values);
        this.reset();
        return result;
    }


    // ===============================
    // ✅ UPDATE METHODS MELHORADOS
    // ===============================

    set(field, value = null) {
        if (typeof field === 'object' && field !== null) {
            this.updateData = {...this.updateData, ...field};
        } else {
            this._validateFieldName(field);
            this.updateData = this.updateData || {};
            this.updateData[field] = value;
        }
        return this;
    }

    // ✅ SET com expressão raw
    setRaw(field, expression, bindings = []) {
        this._validateFieldName(field);
        this._validateNotEmpty(expression, 'Expressão SET');

        this.updateData = this.updateData || {};
        this.updateData[field] = {__raw: expression, __bindings: bindings};

        return this;
    }

    async update(table, data = null, where = null) {
        this._validateTableName(table);

        const updateData = data || this.updateData;
        this._validateUpdateData(updateData);

        if (where) {
            this.where(where);
        }

        const setClauses = [];
        const setValues = [];

        Object.entries(updateData).forEach(([field, value]) => {
            if (typeof value === 'object' && value !== null && value.__raw) {
                // ✅ Suporte a expressões raw
                setClauses.push(`${this.driver.escapeIdentifier(field)} = ${value.__raw}`);
                if (value.__bindings && Array.isArray(value.__bindings)) {
                    setValues.push(...value.__bindings);
                }
            } else {
                setClauses.push(`${this.driver.escapeIdentifier(field)} = ?`);
                setValues.push(value);
            }
        });

        let sql = `UPDATE ${this.driver.escapeIdentifier(table)}
                   SET ${setClauses.join(', ')}`;

        if (this.whereClauses.length > 0) {
            sql += ` WHERE ${this.whereClauses.join(' ')}`;
        }

        const allParams = [...setValues, ...this.params];

        // ✅ RETURNING para PostgreSQL
        if (this.driverType === 'postgres' || this.driverType === 'postgresql') {
            sql += ' RETURNING *';
        }

        const result = await this.executeQuery(sql, allParams);
        this.reset();
        return result;
    }

    // ✅ Increment/Decrement
    async increment(table, field, amount = 1, where = null) {
        this._validateTableName(table);
        this._validateFieldName(field);
        this._validateNumber(amount, 'Amount');

        if (where) {
            this.where(where);
        }

        let sql = `UPDATE ${this.driver.escapeIdentifier(table)}
                   SET ${this.driver.escapeIdentifier(field)} = ${this.driver.escapeIdentifier(field)} + ?`;

        if (this.whereClauses.length > 0) {
            sql += ` WHERE ${this.whereClauses.join(' ')}`;
        }

        const params = [amount, ...this.params];
        const result = await this.executeQuery(sql, params);
        this.reset();
        return result;
    }

    async decrement(table, field, amount = 1, where = null) {
        return this.increment(table, field, -Math.abs(amount), where);
    }


    // ===============================
    // ✅ DELETE METHODS MELHORADOS
    // ===============================

    async delete(table = null, where = null) {
        if (table) {
            this._validateTableName(table);
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

        // ✅ RETURNING para PostgreSQL
        if (this.driverType === 'postgres' || this.driverType === 'postgresql') {
            sql += ' RETURNING *';
        }

        const result = await this.executeQuery(sql, this.params);
        this.reset();
        return result;
    }

    async emptyTable(table) {
        this._validateTableName(table);

        let sql;
        if (this.driverType === 'postgres' || this.driverType === 'postgresql') {
            sql = `TRUNCATE TABLE ${this.driver.escapeIdentifier(table)} RESTART IDENTITY CASCADE`;
        } else {
            sql = `TRUNCATE TABLE ${this.driver.escapeIdentifier(table)}`;
        }

        const result = await this.executeQuery(sql, []);
        this.reset();
        return result;
    }


    // ===============================
    // ✅ TRANSACTION SUPPORT
    // ===============================

    async transaction(callback) {
        this._validateCallback(callback);

        const isNestedTransaction = this.inTransaction;

        if (!isNestedTransaction) await this.beginTransaction();

        try {
            this.transactionDepth++;
            const result = await callback(this);

            if (!isNestedTransaction) await this.commitTransaction();

            return result;
        } catch (error) {
            if (!isNestedTransaction) await this.rollbackTransaction();
            throw error;
        } finally {
            this.transactionDepth--;
            if (this.transactionDepth === 0) this.inTransaction = false;
        }
    }

    async beginTransaction() {
        if (this.inTransaction) throw new Error('Já existe uma transação iniciada.');
        await this.driver.beginTransaction();
        this.inTransaction = true;
        if (this.DEBUG) console.log('🔄 Transação iniciada na QueryBuilder');
    }


    async commitTransaction() {
        if (!this.inTransaction) throw new Error('Nenhuma transação está ativa para confirmar.');
        await this.driver.commitTransaction();
        this.inTransaction = false;
        if (this.DEBUG) console.log('✅ Transação confirmada na QueryBuilder');
    }


    async rollbackTransaction() {
        if (!this.inTransaction) throw new Error('Nenhuma transação está ativa para reverter.');
        await this.driver.rollbackTransaction();
        this.inTransaction = false;
        if (this.DEBUG) console.log('⛔ Transação revertida na QueryBuilder');
    }


    // ===============================
    // ✅ UTILITY METHODS MELHORADOS
    // ===============================

    async query(sql, params = []) {
        this._validateNotEmpty(sql, 'SQL');

        if (!Array.isArray(params)) {
            params = [params];
        }

        return await this.executeQuery(sql, params);
    }

    getCompiledSelect() {
        return this.buildSelectQuery();
    }

    getLastQuery() {
        return this.lastQuery;
    }

    // ✅ Clone do QueryBuilder
    clone() {
        const cloned = new QueryBuilder(this.connection, this.driverType, this.config);

        cloned.selectFields = [...this.selectFields];
        cloned.fromTable = this.fromTable;
        cloned.joinClauses = [...this.joinClauses];
        cloned.whereClauses = [...this.whereClauses];
        cloned.groupByFields = [...this.groupByFields];
        cloned.havingClauses = [...this.havingClauses];
        cloned.orderByFields = [...this.orderByFields];
        cloned.limitValue = this.limitValue;
        cloned.offsetValue = this.offsetValue;
        cloned.distinctFlag = this.distinctFlag;
        cloned.params = [...this.params];
        cloned.updateData = this.updateData ? {...this.updateData} : null;
        cloned.cteQueries = [...this.cteQueries];
        cloned.subqueries = [...this.subqueries];

        return cloned;
    }

    // ✅ Builder pattern para reutilização
    newQuery() {
        return this.builder();
    }

    // ===============================
    // ✅ MÉTODOS DE VALIDAÇÃO
    // ===============================

    _validateQueryState() {
        if (!this.fromTable && this.currentOperation === 'SELECT') {
            throw new Error('FROM é obrigatório para queries SELECT');
        }
    }

    _validateSelectFields(fields) {
        if (!this.validation.enabled) return;

        if (Array.isArray(fields) && fields.length > this.validation.maxSelectFields) {
            throw new Error(`Muitos campos SELECT (máximo: ${this.validation.maxSelectFields})`);
        }
    }

    _validateTableName(table) {
        if (!table || typeof table !== 'string' || table.trim().length === 0) {
            throw new Error('Nome da tabela é obrigatório e deve ser uma string não vazia');
        }
    }

    _validateFieldName(field) {
        if (!field || typeof field !== 'string' || field.trim().length === 0) {
            throw new Error('Nome do campo é obrigatório e deve ser uma string não vazia');
        }
    }

    _validateNotEmpty(value, name) {
        if (!value || (typeof value === 'string' && value.trim().length === 0)) {
            throw new Error(`${name} não pode estar vazio`);
        }
    }

    _validateOperator(operator) {
        const validOperators = ['=', '!=', '<>', '<', '>', '<=', '>=', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'BETWEEN', 'NOT BETWEEN'];
        if (!validOperators.includes(operator.toUpperCase())) {
            throw new Error(`Operador inválido: ${operator}. Operadores válidos: ${validOperators.join(', ')}`);
        }
    }

    _validateArrayValues(values, method) {
        if (!Array.isArray(values) || values.length === 0) {
            throw new Error(`${method} requer um array não vazio`);
        }
    }

    _validateWhereCount() {
        if (!this.validation.enabled) return;

        if (this.whereClauses.length >= this.validation.maxWhereConditions) {
            throw new Error(`Muitas condições WHERE (máximo: ${this.validation.maxWhereConditions})`);
        }
    }

    _validateJoinCount() {
        if (!this.validation.enabled) return;

        if (this.joinClauses.length >= this.validation.maxJoins) {
            throw new Error(`Muitos JOINs (máximo: ${this.validation.maxJoins})`);
        }
    }

    _validateGroupByCount() {
        if (!this.validation.enabled) return;

        if (this.groupByFields.length >= this.validation.maxGroupByFields) {
            throw new Error(`Muitos campos GROUP BY (máximo: ${this.validation.maxGroupByFields})`);
        }
    }

    _validateOrderByCount() {
        if (!this.validation.enabled) return;

        if (this.orderByFields.length >= this.validation.maxOrderByFields) {
            throw new Error(`Muitos campos ORDER BY (máximo: ${this.validation.maxOrderByFields})`);
        }
    }

    _validateLimit(limit) {
        if (!Number.isInteger(limit) || limit < 0) {
            throw new Error('LIMIT deve ser um número inteiro não negativo');
        }
    }

    _validateOffset(offset) {
        if (!Number.isInteger(offset) || offset < 0) {
            throw new Error('OFFSET deve ser um número inteiro não negativo');
        }
    }

    _validatePagination(page, perPage) {
        if (!Number.isInteger(page) || page < 1) {
            throw new Error('Página deve ser um número inteiro maior que 0');
        }

        if (!Number.isInteger(perPage) || perPage < 1 || perPage > 1000) {
            throw new Error('Itens por página deve ser um número inteiro entre 1 e 1000');
        }
    }

    _validateInsertData(data) {
        if (!data || (typeof data !== 'object' && !Array.isArray(data))) {
            throw new Error('Dados para inserção são obrigatórios');
        }

        if (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0) {
            throw new Error('Dados para inserção não podem estar vazios');
        }
    }

    _validateBatchData(data) {
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('insertBatch requer um array não vazio');
        }

        const firstRowFields = Object.keys(data[0]);
        if (firstRowFields.length === 0) {
            throw new Error('Primeira linha do batch não pode estar vazia');
        }
    }

    _validateUpdateData(data) {
        if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
            throw new Error('Dados para atualização são obrigatórios');
        }
    }

    _validateNumber(value, name) {
        if (typeof value !== 'number' || isNaN(value)) {
            throw new Error(`${name} deve ser um número válido`);
        }
    }

    _validateChunkSize(size) {
        if (!Number.isInteger(size) || size < 1 || size > 10000) {
            throw new Error('Tamanho do chunk deve ser um número inteiro entre 1 e 10000');
        }
    }

    _validateCallback(callback) {
        if (typeof callback !== 'function') {
            throw new Error('Callback deve ser uma função');
        }
    }


    // ===============================
    // ✅ MÉTODOS AUXILIARES
    // ===============================

    _addWhereClause(condition, value = null) {
        const connector = this.whereClauses.length > 0 ? 'AND' : '';

        if (connector) {
            this.whereClauses.push(`${connector} ${condition}`);
        } else {
            this.whereClauses.push(condition);
        }

        if (value !== null && value !== undefined) {
            if (Array.isArray(value)) {
                this.params.push(...value);
            } else {
                this.params.push(value);
            }
        }
    }

    _addWhereGroup(callback) {
        const groupBuilder = this.clone();
        groupBuilder.whereClauses = [];
        groupBuilder.params = [];

        callback(groupBuilder);

        if (groupBuilder.whereClauses.length > 0) {
            const groupCondition = groupBuilder.whereClauses.join(' ');
            this._addWhereClause(`(${groupCondition})`);
            this.params.push(...groupBuilder.params);
        }
    }

    _addOrWhereGroup(callback) {
        const groupBuilder = this.clone();
        groupBuilder.whereClauses = [];
        groupBuilder.params = [];

        callback(groupBuilder);

        if (groupBuilder.whereClauses.length > 0) {
            const groupCondition = groupBuilder.whereClauses.join(' ');
            this.whereClauses.push(`OR (${groupCondition})`);
            this.params.push(...groupBuilder.params);
        }
    }

    _generateCacheKey() {
        const keyData = {
            select: this.selectFields,
            from: this.fromTable,
            joins: this.joinClauses,
            where: this.whereClauses,
            groupBy: this.groupByFields,
            having: this.havingClauses,
            orderBy: this.orderByFields,
            limit: this.limitValue,
            offset: this.offsetValue,
            distinct: this.distinctFlag,
            cte: this.cteQueries,
            unions: this.subqueries
        };

        return JSON.stringify(keyData);
    }

    _arraysEqual(arr1, arr2) {
        if (arr1.length !== arr2.length) return false;
        return arr1.every((value, index) => value === arr2[index]);
    }

    _updateBuildMetrics(buildTime) {
        this.metrics.queriesBuilt++;

        if (this.metrics.avgBuildTime === 0) {
            this.metrics.avgBuildTime = buildTime;
        } else {
            this.metrics.avgBuildTime = (this.metrics.avgBuildTime * 0.9) + (buildTime * 0.1);
        }

        // ✅ Detectar queries complexas
        const complexity = this.joinClauses.length + this.whereClauses.length + this.groupByFields.length + this.havingClauses.length + this.subqueries.length;
        if (complexity > 10) {
            this.metrics.complexQueries++;
        }
    }

    _logQueryExecution(sql, params, executionTime) {
        const logLevel = executionTime > 1000 ? 'warn' : 'info';

        if (this.debugLevel === 'info' || (this.debugLevel === 'warn' && logLevel === 'warn')) {
            console.log(`🔍 Query executada [${this.queryBuilderId}] - ${executionTime}ms:`);
            console.log(`📝 SQL: ${sql}`);
            if (params.length > 0) {
                console.log(`📋 Params: ${JSON.stringify(params)}`);
            }
        }
    }

    _logQueryError(sql, params, error) {
        console.error(`❌ Erro na query [${this.queryBuilderId}]:`);
        console.error(`📝 SQL: ${sql}`);
        if (params.length > 0) {
            console.error(`📋 Params: ${JSON.stringify(params)}`);
        }
        console.error(`💥 Erro: ${error.message}`);
    }


    // ===============================
    // ✅ MÉTODOS DE INFORMAÇÃO
    // ===============================

    getMetrics() {
        return {
            ...this.metrics,
            queryBuilderId: this.queryBuilderId,
            cacheSize: this.queryCache.size,
            maxCacheSize: this.maxCacheSize,
            validationEnabled: this.validation.enabled,
            inTransaction: this.inTransaction,
            transactionDepth: this.transactionDepth
        };
    }

    getDriverInfo() {
        return this.driver.getDriverInfo ? this.driver.getDriverInfo() : {
            type: this.driverType,
            instance: 'QueryBuilder'
        };
    }

    clearCache() {
        this.queryCache.clear();
        if (this.DEBUG) {
            console.log(`🧹 Cache do QueryBuilder limpo [${this.queryBuilderId}]`);
        }
    }

    getQueryCount() {
        return this.metrics.queriesBuilt;
    }

    getCurrentState() {
        return {
            selectFields: this.selectFields,
            fromTable: this.fromTable,
            joinCount: this.joinClauses.length,
            whereCount: this.whereClauses.length,
            groupByCount: this.groupByFields.length,
            havingCount: this.havingClauses.length,
            orderByCount: this.orderByFields.length,
            limitValue: this.limitValue,
            offsetValue: this.offsetValue,
            distinctFlag: this.distinctFlag,
            paramCount: this.params.length,
            inTransaction: this.inTransaction,
            currentOperation: this.currentOperation
        };
    }
}

export default QueryBuilder;
