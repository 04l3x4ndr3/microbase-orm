# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [1.0.4] - 2025-06-11
- Suporte completo para MariaDB

## [1.0.0] - 2025-06-11

### Adicionado
- Implementação inicial do micro ORM
- Suporte completo para MySQL/MariaDB
- Suporte completo para PostgreSQL
- Query Builder inspirado no CodeIgniter 3
- Métodos SELECT com agregações (MAX, MIN, AVG, SUM)
- Métodos WHERE com operadores diversos
- Suporte a JOINs (INNER, LEFT, RIGHT)
- Métodos GROUP BY e HAVING
- Métodos ORDER BY com suporte a ordenação aleatória
- Métodos LIMIT e OFFSET
- Métodos INSERT com suporte a lotes
- Métodos UPDATE com query builder
- Métodos DELETE e TRUNCATE
- Escape automático contra SQL Injection
- Arquitetura modular com drivers separados
- Documentação completa
- Exemplos de uso

### Características
- Interface fluente para construção de queries
- Prepared statements para segurança
- Suporte a transações através da conexão direta
- Zero dependências externas (apenas drivers de banco)
- Código ES6 moderno com async/await

## [Não Lançado]

### Planejado
- Suporte a SQLite
- Sistema de migrations
- Validações de schema
- Pool de conexões
- Cache de queries
- Logging avançado
- Testes automatizados completos
