# MicroBase ORM JavaScript ES6
[![NPM Version](https://img.shields.io/npm/v/@04l3x4ndr3/microbase-orm.svg)](https://www.npmjs.com/package/@04l3x4ndr3/microbase-orm)
[![NPM Downloads](https://img.shields.io/npm/dm/@04l3x4ndr3/microbase-orm.svg)](https://www.npmjs.com/package/@04l3x4ndr3/microbase-orm)
[![GitHub License](https://img.shields.io/github/license/04l3x4ndr3/microbase-orm.svg)](https://github.com/04l3x4ndr3/microbase-orm/blob/main/LICENSE)
[![GitHub Issues](https://img.shields.io/github/issues/04l3x4ndr3/microbase-orm.svg)](https://github.com/04l3x4ndr3/microbase-orm/issues)
[![Build Status](https://img.shields.io/github/actions/workflow/status/04l3x4ndr3/microbase-orm/ci.yml?branch=main)](https://github.com/04l3x4ndr3/microbase-orm/actions)
[![Node.js Version](https://img.shields.io/node/v/@04l3x4ndr3/microbase-orm)](https://www.npmjs.com/package/@04l3x4ndr3/microbase-orm)

Um micro ORM em JavaScript puro ES6 inspirado no Query Builder do CodeIgniter 3, com suporte completo para MySQL/MariaDB e PostgreSQL.

## 📋 Características

- ✅ **Interface Fluente**: Sintaxe limpa e intuitiva para construção de queries
- ✅ **Multi-Database**: Suporte nativo para MySQL/MariaDB e PostgreSQL
- ✅ **Segurança**: Proteção contra SQL Injection com prepared statements
- ✅ **ES6 Moderno**: Código JavaScript moderno com async/await
- ✅ **Zero Dependências Externas**: Apenas drivers nativos do Node.js
- ✅ **Inspirado no CodeIgniter**: Métodos familiares para desenvolvedores PHP

## 📦 Instalação
```shell
  npm install 04l3x4ndr3/microbase-orm
```

# Instalar dependências para MySQL
```shell
  npm install mysql2
```
# Instalar dependências para MariaDB
```shell
  npm install mariadb
```

# Instalar dependências para PostgreSQL
```shell
  npm install pg
```

# Ou instalar ambos
```shell
  npm install mysql2 pg mariadb
```

## 🚀 Uso Rápido
```javascript
 import Database from './Database.js';
// Configuração 
const db = new Database({ 
    driver: 'mysql', // ou 'postgres' ou 'mariadb' 
    host: 'localhost',
    username: 'usuario',
    password: 'senha',
    database: 'meu_banco', 
    port: 3306 // ou 5432 para PostgreSQL 
});

// Conectar
await db.connect();

// SELECT simples
const usuarios = await db.select('*').from('usuarios').get();

// Desconectar
 await db.disconnect();
```
## 🔧 Configuração

### MySQL/MariaDB
```javascript 
const config = { 
    driver: 'mysql',
    host: 'localhost',
    username: 'root',
    password: 'senha',
    database: 'meu_banco', 
    port: 3306 
};
```

### PostgreSQL
```javascript 
const config = {
    driver: 'postgres',
    host: 'localhost',
    username: 'postgres',
    password: 'senha', 
    database: 'meu_banco',
    port: 5432 
};
```

## 📖 Documentação da API

### Métodos SELECT

#### select(campos)
```javascript 
// Selecionar todos os campos 
await db.select('*').from('usuarios').get();

// Selecionar campos específicos 
await db.select(['nome', 'email']).from('usuarios').get();

// Selecionar com string 
await db.select('nome, email').from('usuarios').get();
```

#### Funções de Agregação
```javascript 
// Máximo 
await db.selectMax('idade').from('usuarios').get(); 
await db.selectMax('idade', 'idade_maxima').from('usuarios').get();

// Mínimo 
await db.selectMin('idade').from('usuarios').get();

// Média
await db.selectAvg('salario').from('usuarios').get();

// Soma
await db.selectSum('vendas').from('usuarios').get();
```

#### distinct()
```javascript
 await db.select('cidade').distinct().from('usuarios').get();
```

### Métodos WHERE

#### where(campo, valor, operador)
```javascript 
// Igualdade simples 
await db.select('*').from('usuarios').where('ativo', 1).get();

// Com operador 
await db.select('*').from('usuarios').where('idade', 18, '>').get();

// Objeto de condições
await db.select('*').from('usuarios').where({ ativo: 1, cidade: 'São Paulo' }).get();
```

#### orWhere()
```javascript 
await db.select('*') .from('usuarios') .where('cidade', 'São Paulo') .orWhere('cidade', 'Rio de Janeiro') .get();
```

#### whereIn() / whereNotIn()
```javascript await db.select('*') .from('usuarios') .whereIn('id', [1, 2, 3, 4, 5]) .get();
await db.select('*') .from('usuarios') .whereNotIn('status', ['bloqueado', 'suspenso']) .get();
```

#### whereLike()
```javascript await db.select('*') .from('usuarios') .whereLike('nome', '%João%') .get();
await db.select('*') .from('usuarios') .whereNotLike('email', '%spam%') .get();
```

### Métodos JOIN
```javascript 
// INNER JOIN 
await db.select('u.nome, p.descricao') 
        .from('usuarios u') 
        .join('perfis p', 'u.perfil_id = p.id') .get();

// LEFT JOIN
await db.select('u.nome, p.descricao') 
        .from('usuarios u') 
        .leftJoin('perfis p', 'u.perfil_id = p.id') 
        .get();

// RIGHT JOIN
await db.select('u.nome, p.descricao') 
        .from('usuarios u') 
        .rightJoin('perfis p', 'u.perfil_id = p.id')
        .get();
```

### GROUP BY e HAVING
```javascript 
await db.select(['cidade', 'COUNT(*) as total']) 
        .from('usuarios')
        .groupBy('cidade').having('total', 10, '>') 
        .get();

// Múltiplos campos 
await db.select(['cidade', 'estado', 'COUNT(*) as total']) 
        .from('usuarios')
        .groupBy(['cidade', 'estado']) 
        .get();
```

### ORDER BY
```javascript 
// Ordenação simples 
await db.select('*') 
        .from('usuarios') 
        .orderBy('nome', 'ASC') 
        .get();

// Múltiplas ordenações
await db.select('*') 
        .from('usuarios')
        .orderBy('cidade', 'ASC') 
        .orderBy('nome', 'DESC') 
        .get();

// Ordenação aleatória
await db.select('*') 
        .from('usuarios') 
        .orderByRandom() .limit(5)
        .get();
```
### LIMIT e OFFSET
```javascript 
// Limit simples
await db.select('*')
        .from('usuarios')
        .limit(10)
        .get();

// Limit com offset 
await db.select('*')
        .from('usuarios')
        .limit(10, 20)
        .get();

// Ou usando offset separadamente
await db.select('*')
        .from('usuarios')
        .limit(10)
        .offset(20)
        .get();
```

### Métodos de Execução

#### get()
```javascript 
const resultados = await db.select('*').from('usuarios').get();
```

#### first()
```javascript 
const usuario = await db.select('*').from('usuarios').where('id', 1).first();
```

#### count()
```javascript
 const total = await db.select('*').from('usuarios').where('ativo', 1).count();
```

#### getWhere()
```javascript 
const usuarios = await db.getWhere('usuarios', { ativo: 1, cidade: 'São Paulo' });
```

### Métodos INSERT

#### insert()
```javascript
 // Insert simples 
 await db.insert('usuarios', { nome: 'João Silva', email: 'joao@email.com', ativo: 1 });

// Insert em lote 
await db.insert('usuarios', [
    { nome: 'João', email: 'joao@email.com' }, 
    { nome: 'Maria', email: 'maria@email.com' },
    { nome: 'Pedro', email: 'pedro@email.com' } 
]);
```
#### replace() (apenas MySQL)
```javascript
 await db.replace('usuarios', { id: 1, nome: 'João Santos', email: 'joao.santos@email.com' });
```

### Métodos UPDATE

#### update()
```javascript
// Update com WHERE 
await db.update('usuarios', { nome: 'João Santos' }, { id: 1 } );

// Update usando query builder 
await db.from('usuarios') 
        .where('ativo', 0) 
        .update('usuarios', { status: 'inativo' });

// Usando set() 
await db.from('usuarios') 
        .set('nome', 'João Santos') 
        .set('email', 'joao.santos@email.com') 
        .where('id', 1) 
        .update('usuarios');
```

### Métodos DELETE

#### delete()
```javascript
// Delete simples
await db.delete('usuarios', { id: 1 });

// Delete com query builder
await db.from('usuarios')
        .where('ativo', 0)
        .where('ultimo_login', '2023-01-01', '<')
        .delete();
```

#### emptyTable()
```javascript
 await db.emptyTable('logs'); // TRUNCATE TABLE
```

### Métodos Utilitários

#### query()
```javascript
// Query SQL direta 
const resultado = await db.query('SELECT * FROM usuarios WHERE id = ?', [1]);
```

#### getCompiledSelect()
```javascript
 const sql = db.select('*')
        .from('usuarios')
        .where('ativo', 1)
        .getCompiledSelect();

console.log(sql); // SELECT * FROM `usuarios` WHERE `ativo` = ?
```

## 💡 Exemplos Avançados

### Consulta Complexa
```javascript
const relatorio = await db.select([ 
            'u.nome',
            'u.email', 
            'p.descricao as perfil',
            'COUNT(v.id) as total_vendas', 
            'SUM(v.valor) as valor_total' 
        ])
        .from('usuarios u') 
        .leftJoin('perfis p', 'u.perfil_id = p.id') 
        .leftJoin('vendas v', 'u.id = v.usuario_id') 
        .where('u.ativo', 1)
        .whereIn('u.cidade', ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte'])
        .groupBy(['u.id', 'u.nome', 'u.email', 'p.descricao']) 
        .having('total_vendas', 0, '>')
        .orderBy('valor_total', 'DESC') 
        .limit(50) 
        .get();
```
### Transações (usando conexão direta)
```javascript
await db.connect();
const connection = db.connection;

// Para MySQL 
await connection.beginTransaction();
try {
    await db.insert('usuarios', { nome: 'João' }); 
    await db.insert('perfis', { usuario_id: 1, tipo: 'admin' }); 
    await connection.commit(); 
} catch (error) {
    await connection.rollback(); throw error; 
}
```

### Builder Reutilizável
```javascript
// Criar um builder base
const usuariosAtivos = db.builder()
    .from('usuarios')
    .where('ativo', 1);

// Usar o builder base para diferentes consultas
const administradores = await usuariosAtivos
    .where('perfil', 'admin')
    .get();

const vendedores = await db.builder()
    .from('usuarios')
    .where('ativo', 1)
    .where('perfil', 'vendedor')
    .get();
```

## 🗂️ Estrutura de Pastas

```
projeto/
├── Database.js              # Classe principal
├── QueryBuilder.js          # Construtor de queries
├── database/
│   └── Connection.js        # Gerenciador de conexões
├── drivers/
│   ├── MySQLDriver.js       # Driver MySQL/MariaDB
│   └── PostgreSQLDriver.js  # Driver PostgreSQL
└── examples/
    └── usage.js             # Exemplos de uso
```

## 🔒 Segurança
- **Prepared Statements**: Todas as queries usam prepared statements
- **Escape de Identificadores**: Nomes de tabelas e campos são automaticamente escapados
- **Validação de Tipos**: Validação automática de tipos de dados
- **Sanitização**: Valores são sanitizados antes da execução

## 🧪 Testando

```javascript
// Teste de conexão
import Database from './Database.js';

async function testarConexao() {
        const db = new Database({
        driver: 'mysql',
        host: 'localhost',
        username: 'root',
        password: 'senha',
        database: 'teste'
    });

    try {
        await db.connect();
        console.log('✅ Conexão estabelecida com sucesso!');
        
        const resultado = await db.query('SELECT 1 as teste');
        console.log('✅ Query executada:', resultado);
        
    } catch (error) {
        console.error('❌ Erro:', error.message);
    } finally {
        await db.disconnect();
    }
}

testarConexao();
```
## 🤝 Contribuindo
1. Faça um fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -am 'Adiciona nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

## 📝 Licença
Este projeto está sob a licença MIT. Veja o arquivo LICENSE para mais detalhes.
## 🙏 Agradecimentos
- Inspirado no [CodeIgniter 3 Query Builder](https://codeigniter.com/userguide3/database/query_builder.html)
- Comunidade Node.js pelos excelentes drivers de banco de dados

**Nota**: Este é um projeto educacional/experimental. Para uso em produção, considere ORMs estabelecidos como Sequelize, TypeORM ou Prisma.


