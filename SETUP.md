# 🚀 Guia de Execução do Ambiente - JUDICI.A (Hackathon TJPA)

Para que o sistema funcione de ponta a ponta (com banco de dados, painel e Inteligência Artificial integrados), você precisará rodar 4 serviços em paralelo. 

Recomendamos abrir **4 abas de terminal** no seu editor de código (como o VS Code) ou no Git Bash, todas na pasta raiz do projeto.

---

### Passo 1: Subir o Banco de Dados (Docker)
Na **Aba 1** do terminal, inicie os containers do banco de dados (PostgreSQL) e integrações que rodam via Docker em segundo plano.
```bash
docker-compose up -d
```
*Dica: Verifique se o Docker Desktop está aberto e rodando no seu Windows antes de executar este comando.*

---

### Passo 2: Subir a Inteligência Artificial (Laya)
Na **Aba 2** do terminal, precisamos ativar o ambiente Python e rodar o servidor da IA na porta 8000.

1. Ative o ambiente virtual:
```bash
# No Windows (Git Bash / PowerShell)
.\.venv-laya\Scripts\activate
```
*(Confirme se apareceu o texto `(.venv-laya)` no começo da linha do terminal).*

2. Inicie o servidor do Laya:
```bash
laya-serve
```
*Sucesso:* O terminal exibirá que a aplicação iniciou no endereço `http://localhost:8000`. Deixe esta aba aberta executando.

---

### Passo 3: Subir o Backend (Node.js API)
Na **Aba 3** do terminal (garanta que o ambiente virtual **NÃO** está ativado aqui), instale as dependências e inicie a API principal.
```bash
npm install
npm run dev:backend
```
*Sucesso:* O servidor Node.js iniciará na porta `3000`. Ele agora consegue falar com o Laya (porta 8000) e com o banco de dados (Docker).

---

### Passo 4: Subir o Frontend (Telas do Sistema)
Na **Aba 4** do terminal, inicie o servidor de desenvolvimento das telas e do autoatendimento.
```bash
npm run dev:frontend
```
*Sucesso:* Ele fornecerá uma URL no terminal. Segure `Ctrl` e clique no link para abrir o JUDICI.A no seu navegador!

---

### 🛑 Solução de Problemas Comuns (Troubleshooting)

* **Erro `Decision service unavailable: fetch failed` ao clicar em Analisar:**
  Isso significa que o Passo 2 não foi feito corretamente. O Node.js não conseguiu achar o Laya rodando. Verifique se o terminal do `laya-serve` travou ou fechou acidentalmente.
  
* **Erro no Banco de Dados (Connection Refused):**
  Significa que o container do Docker caiu. Rode `docker-compose ps` para ver se ele está de pé, ou `docker-compose up -d` novamente.

* **Erro de porta ocupada (EADDRINUSE):**
  Algum processo antigo ficou preso na memória. Você precisará matar o terminal antigo (ícone de lixeira no VS Code) e rodar o script novamente.

