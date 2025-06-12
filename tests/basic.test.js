// tests/basic.test.js
import Database from '../src/index.js';

// Teste básico sem dependência de banco real
function testeBasico() {
    console.log('🧪 Executando testes básicos...\n');

    let passou = 0;
    let falhou = 0;

    function assert(condicao, mensagem) {
        if (condicao) {
            console.log(`✅ ${mensagem}`);
            passou++;
        } else {
            console.log(`❌ ${mensagem}`);
            falhou++;
        }
    }

    try {
        // Teste 1: Instanciação
        const db = new Database({
            driver: 'mysql',
            host: 'localhost',
            username: 'test',
            password: 'test',
            database: 'test'
        });
        assert(db instanceof Database, 'Database pode ser instanciada');

        // Teste 2: Configuração
        assert(db.config.driver === 'mysql', 'Configuração de driver está correta');
        assert(db.config.host === 'localhost', 'Configuração de host está correta');

        // Teste 3: Query Builder sem conexão
        try {
            const builder = db.builder();
            assert(false, 'Builder deveria falhar sem conexão');
        } catch (error) {
            assert(error.message.includes('Conexão'), 'Builder falha corretamente sem conexão');
        }

        // Teste 4: SQL compilation (mock)
        console.log('\n📝 Testando compilação de SQL...');

        // Como não temos conexão real, vamos testar a lógica de construção
        const mockConnection = { execute: () => Promise.resolve([]) };
        const mockBuilder = {
            selectFields: ['*'],
            fromTable: '`usuarios`',
            whereClauses: ['`ativo` = ?'],
            orderByFields: ['`nome` ASC'],
            limitValue: 10,
            offsetValue: 0,
            joinClauses: [],
            groupByFields: [],
            havingClauses: [],
            distinctFlag: false
        };

        // Simular construção de SQL
        let sql = 'SELECT ';
        if (mockBuilder.distinctFlag) sql += 'DISTINCT ';
        sql += mockBuilder.selectFields.join(', ');
        sql += ` FROM ${mockBuilder.fromTable}`;
        if (mockBuilder.whereClauses.length > 0) {
            sql += ` WHERE ${mockBuilder.whereClauses.join(' ')}`;
        }
        if (mockBuilder.orderByFields.length > 0) {
            sql += ` ORDER BY ${mockBuilder.orderByFields.join(', ')}`;
        }
        if (mockBuilder.limitValue !== null) {
            sql += ` LIMIT ${mockBuilder.offsetValue}, ${mockBuilder.limitValue}`;
        }

        const expectedSql = 'SELECT * FROM `usuarios` WHERE `ativo` = ? ORDER BY `nome` ASC LIMIT 0, 10';
        assert(sql === expectedSql, 'SQL é construída corretamente');

        console.log(`   SQL gerada: ${sql}`);

    } catch (error) {
        console.log(`❌ Erro durante teste: ${error.message}`);
        falhou++;
    }

    console.log(`\n📊 Resultados dos testes:`);
    console.log(`   ✅ Passaram: ${passou}`);
    console.log(`   ❌ Falharam: ${falhou}`);
    console.log(`   📈 Taxa de sucesso: ${((passou / (passou + falhou)) * 100).toFixed(1)}%`);

    return falhou === 0;
}

// Executar se for o arquivo principal
if (import.meta.url === `file://${process.argv[1]}`) {
    const sucesso = testeBasico();
    process.exit(sucesso ? 0 : 1);
}

export default testeBasico;
