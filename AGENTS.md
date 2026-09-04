# Fluxo de desenvolvimento

Para cada tarefa que alterar arquivos deste repositório, coordene estes agentes em sequência:

1. **Ideia:** use `gpt-5.6-sol` com esforço `high` para entender o pedido, investigar o contexto e propor a solução. Apresente a ideia ao usuário e aguarde aprovação explícita. A ideia termina quando o usuário der o OK.
2. **Desenvolvimento:** após o OK, crie uma branch com o prefixo `codex/` e dispare um agente com `gpt-5.6-luna` e esforço `max`. Esse agente implementa a solução, executa as verificações relevantes, faz um commit somente com as mudanças da tarefa, envia a branch e abre o pull request. O desenvolvimento termina quando o PR estiver aberto e as verificações passarem.
3. **Revisão:** assim que o desenvolvimento terminar, dispare outro agente com `gpt-5.6-sol` e esforço `low` para revisar o PR. O revisor deve responder com `OK` ou apontar problemas concretos.
4. **Correções:** se houver problemas, devolva-os ao mesmo agente de desenvolvimento. Após as correções, repita a revisão com o agente revisor até receber `OK`.
5. **Merge:** após o `OK` do revisor, volte ao mesmo agente de desenvolvimento para completar o merge do PR.

Se qualquer etapa não puder ser concluída, informe o bloqueio e a causa ao usuário.

## Agent skills

### Issue tracker

Issues e specs deste repo vivem no GitHub Issues; use a CLI `gh` para operações. Veja `docs/agents/issue-tracker.md`.

### Triage labels

Use os labels canônicos `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human` e `wontfix`. Veja `docs/agents/triage-labels.md`.

### Domain docs

Este é um repo single-context; leia `CONTEXT.md` na raiz e `docs/adr/` quando relevante. Veja `docs/agents/domain.md`.
