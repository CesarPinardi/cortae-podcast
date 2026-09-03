# Consistência entre R2 e D1

O Cortaê não tenta fazer uma transação distribuída entre R2 e D1. A fronteira de publicação usa uma estratégia de compensação e verificação:

- cada upload grava uma chave R2 nova, com UUID, e nunca sobrescreve uma chave já publicada;
- o `audio_etag` retornado pelo R2 é persistido junto com a referência D1;
- a publicação só troca o estado D1 se a chave, o tamanho e o ETag ainda corresponderem ao upload verificado;
- a entrega pública confere o ETag novamente e recusa mídia publicada alterada;
- se a associação D1 perder a corrida, o objeto R2 recém-criado é removido.

Assim, o aplicativo não remove nem altera o objeto referenciado por um episódio publicado. Uma falha externa de armazenamento é detectada na publicação ou na entrega, em vez de servir bytes diferentes do enclosure registrado.
