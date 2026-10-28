# Painel do blog (Simone Afonso)

Página de login e formulário para publicar textos no blog. Endereço: https://painel.arqsimoneafonso.com.br

- Sem bibliotecas externas. Fala direto com o Supabase (login, banco e fotos).
- Não há senha no código. O login é validado pelo Supabase.
- `config.js` guarda a URL do projeto e a chave `anon` (públicas por natureza).
- A página não é indexada pelo Google (`noindex`) e tem CSP restritiva.

Configuração completa: veja `docs/CONFIGURACAO.md` no repositório do site.
Publicação: GitHub Pages, branch `main`, pasta raiz, com `CNAME` em `painel.arqsimoneafonso.com.br`.
