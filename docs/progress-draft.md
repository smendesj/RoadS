# Arquivo de textos do Resumo

O Resumo é o e-mail curto, em linguagem simples, sobre o andamento do produto. Quem conduz o
Frontlights escreve **só os textos**; o resto vem de fontes que não se inventam:

| Parte do e-mail | De onde vem |
| --- | --- |
| Quais entregas existem, a situação de cada uma, datas e links | coletor de fatos do GitHub (`facts.json`) |
| Mensagens e tokens, dia a dia | coletor de uso do Claude (`usage.json`) |
| Títulos, frases, dificuldades, próximos passos, frase de abertura | **o arquivo de textos** (este guia) |
| Prints | arquivos na pasta de prints, listados em `captions.json` |
| Conta e senha temporária do primeiro acesso | arquivo local (`access`), nunca no repositório |

A situação de cada entrega (Concluído, Em validação, Em andamento, Bloqueado, Próximo) vem sempre dos
fatos: um texto não consegue mudá-la.

## O arquivo de textos

Um JSON, gravado onde o Frontlights pedir (`{draft}`):

```json
{
  "headline": "Duas entregas ficaram prontas e uma está em andamento.",
  "entries": [
    { "issue": 101, "title": "Título curto da entrega", "summary": "Uma frase sobre o que mudou para quem usa." },
    { "issue": 102, "title": "Outra entrega", "summary": "Outra frase.", "hidden": true }
  ],
  "internal": "Também houve ajustes internos de organização.",
  "difficulties": [{ "text": "O que está travando.", "needs": "O que é preciso para destravar, e de quem." }],
  "nextSteps": ["Primeiro passo.", "Segundo passo."],
  "sprint": [{ "issue": 974, "summary": "Uma frase simples sobre o que falta desta parte da sprint." }]
}
```

- `headline`: a frase de abertura (até 400 caracteres). Obrigatória.
- `entries`: um item por entrega **visível** nos fatos, identificada pelo número da issue. Falta de texto
  para uma entrega visível, ou texto para uma issue que não está nos fatos, recusa a montagem e diz o número.
  - `hidden` é opcional: `true` esconde a entrega do e-mail, `false` mostra uma que o coletor escondeu. O
    coletor esconde sozinho o que foi entregue antes do período e o que é interno; uma entrega escondida
    pode ficar sem texto.
  - **Epic é cabeçalho, não entrega.** Uma issue `type:epic` só agrupa: nunca tem entrada nem print. A entrega é a
    issue mais alta que não é epic (a "raiz de trabalho"), e os fatos trazem o epic acima dela em `entries[].epic`
    (o mais próximo, com as entregas dele prontas) e `entries[].epicPath` (a cadeia inteira, do mais externo ao mais
    próximo). Use isso para agrupar no texto, em linguagem simples ("MVP · 1A: ..."), sem número de issue.
  - **Entrega feita de partes.** Uma entrega pode ser uma issue com sub-issues, e estas com outras sub-issues. O
    coletor conta as **folhas** da árvore inteira, em qualquer nível, e o e-mail e a visão semanal mostram
    sozinhos, logo abaixo da frase, algo como "3 de 8 partes prontas" (sem número de issue). **Não repita essa
    contagem no texto.** Use a frase para dizer, em linguagem simples, o que de fato ficou pronto no período: a
    matéria-prima está em `entries[].slices` dos fatos, com `closed` (as partes fechadas no período, com a data)
    e `blocked` (as partes bloqueadas, que valem uma linha em `difficulties`). `slices` é só evidência: não vai
    para o rascunho montado, e os títulos dali precisam ser reescritos como qualquer outro. Uma entrega com
    parte pronta nunca aparece como "Próximo", mesmo sem PR nem commit: se a evidência diz "Leitura das
    sub-issues cortada", a contagem pode estar abaixo do real, e o texto não deve afirmar um total.
- `internal`: a linha sobre ajustes internos. Opcional; sem ela, o RoadS usa uma frase padrão com o total
  coletado. Com total zero, a linha não aparece.
- `difficulties`: o que trava ou atrasa e, em `needs`, o que é preciso e de quem. Pode ficar vazio (o e-mail
  diz que não há bloqueios).
- `nextSteps`: o que vem a seguir, em ordem. Cada item é um texto ou `{ "text": "..." }`. Os próximos passos
  saem do bloco `sprint` dos fatos (o que falta de cada capa), não de uma lista de issues paradas.
- `sprint`: uma frase simples (até 30 palavras) por **capa da sprint**, pelo número da issue da capa. Opcional:
  sem frase, a capa aparece só com o título que tem no GitHub. Frase para uma issue que não é capa nos fatos
  recusa a montagem e diz o número.

## A sprint e os dois números do topo

O e-mail e a visão semanal abrem com dois números, que o RoadS calcula sozinho (o redator **não os repete** no
texto):

- **Concluído: N sub-issues em M issues**: tudo que foi entregue no período, esteja ou não na sprint. M é o
  número de entregas visíveis e concluídas; N soma, por entrega, as partes prontas (uma entrega sem partes conta 1).
  O que a pessoa esconde ou muda na tela entra na conta.
- **Em andamento: N sub-issues em K issues**: o que **falta** das capas da sprint. Uma capa é um item do Project
  (do repositório) com Status Development, epic ou não: o coletor lê a árvore inteira dela e conta as folhas que
  ainda não estão prontas; uma capa sem filhas é a sua única parte. K é o número de capas com algo por fazer. Uma
  capa que está na sprint e já tem parte pronta conta nos dois números.

Não existe número de "Em validação" nesse topo (o chip saiu). **Capa da sprint não é entrega**: não pede texto por
entrega nem print, e aparece no bloco "Em andamento na sprint", logo depois das entregas, com o título, a frase
do arquivo de textos, "12 de 17 sub-issues" e o que resta ("Restam: ..."). Os fatos trazem tudo isso em `sprint`
(e `delivered`, só como evidência); a visão semanal soma as entregas dos resumos enviados na semana (cada issue uma
vez) e mostra o bloco do **último** resumo da semana.

## Regras de linguagem

- Português simples, para quem não lê issues técnicas: sem siglas, sem nomes de arquivo, sem número de issue
  ou de pull request no texto.
- Título: até 8 palavras. Uma frase por entrega, até 30 palavras, dizendo o que mudou para quem usa, não como.
- Nunca afirme algo que não esteja nos fatos coletados ou nos registros locais das issues.
- Os próximos passos devem refletir a sprint da semana quando houver; sem ela, saem só dos fatos.

O RoadS avisa na tela, ao salvar, de termos técnicos e frases longas; o texto que a pessoa editar lá não é
sobrescrito por um novo envio.

## Prints

Cada entrega que aparece no e-mail e não está em **Próximo** precisa de **pelo menos um print** que a mostre.
Quando não há uma tela do produto para mostrar, vale uma imagem do que mudou: um trecho de código, uma tabela
do banco, um diagrama. Sem esse print, a montagem é recusada e a mensagem diz o número da issue que falta (o
plugin confere antes, e o RoadS confere de novo ao receber).

Até **40** prints por resumo, cada um JPEG ou PNG com no máximo **1 MB** (cerca de 1920 px de largura, para que
código e tabelas fiquem legíveis em tela cheia). Eles ficam na pasta de prints com um `captions.json` que
**lista, na ordem do e-mail**, os que devem sair, cada um com a entrega que mostra (`issue`):

```json
[
  { "file": "101-tela.png", "caption": "Uma frase simples sobre o que a tela mostra.", "issue": 101 },
  { "file": "102-codigo.jpg", "caption": "O trecho que mudou para a segunda entrega.", "issue": 102 },
  { "file": "geral.png", "caption": "Uma visão geral, sem entrega." }
]
```

- `issue` é o número inteiro da issue de uma entrega deste resumo. O print sai logo abaixo dessa entrega, no
  e-mail e no resumo semanal.
  Para uma entrega feita de partes, o print de qualquer parte entra com o número da **entrega** (a raiz de
  trabalho, a que está nos fatos), nunca com o de uma sub-issue nem o de um epic: o RoadS só conhece as entregas.
- Sem `issue`, o print é geral e sai no fim, antes do uso do Claude.
- Só os arquivos listados saem; os demais são ignorados. Use só dados de teste e recorte a identidade de quem
  estava logado.

A pasta de prints é a da semana no OneDrive (`weekShots` na configuração do plugin), com uma subpasta por
resumo: `SCRUM\<ano>\<dd_mm da segunda>\summary\<dd_mm do último dia do período>`.

- **A segunda** é a da reunião em que o resumo é apresentado: a segunda-feira **seguinte à semana em que o
  período TERMINA**, no calendário de São Paulo. O fim do período é exclusivo (um período que termina na segunda
  às 00:00 é da semana que acabou), e o início não conta: um resumo que começa no sábado, onde o anterior parou,
  é da semana em que termina.
- **Quem diz a data é o RoadS.** O `GET` do resumo devolve `weekMeeting` (`AAAA-MM-DD`, sempre uma segunda-feira)
  para a janela que ele mostra, pela mesma regra que agrupa a visão semanal. Para qualquer outro período a regra
  é a mesma, e o plugin a calcula.
- **A subpasta** leva o **último dia** do período, o do seu último instante (o fim é exclusivo: um período que
  termina na quinta às 00:00 tem a quarta como último dia). `07_10` para o resumo de quarta, `09_10` para o de
  sexta, com o seu `captions.json` e os seus prints. A quarta e a sexta de uma semana usam a mesma segunda, mas cada uma
  tem a sua subpasta: o `captions.json` de uma nunca sobrescreve o da outra.

O plugin resolve e confere a pasta e a entrega ao comando de envio em `--shots-dir`.

Cada print sobe sozinho para o RoadS antes do rascunho, que viaja só com o nome de cada print. Os prints ficam
num armazenamento privado do RoadS; o e-mail os mostra pelo link do resumo, como a imagem de uso.

## Comandos

O envio é o comando da configuração local do projeto (`pushCommand`), que roda `scripts/progress/push.ts`
com `--assemble` e `--shots-dir`. Para conferir sem enviar, junte `--dry-run`:

```powershell
node --experimental-strip-types scripts/progress/push.ts --draft <textos.json> --assemble --shots-dir <pasta> --dry-run
```

O comando lê os fatos e o uso nos caminhos padrão (`.frontlights/progress/facts.json` e `usage.json`), e a
conta de acesso do campo `access` de `.frontlights/progress/config.json` (arquivo local, ignorado pelo Git):

```json
{ "usageLabel": "Título da imagem de uso", "access": { "account": "pessoa@exemplo.com", "password": "senha-temporária" } }
```

## Prints depois do envio

Um resumo enviado fica congelado, mas pode **ganhar** prints depois, para a apresentação da semana: prints de
uma entrega dele ou prints **gerais**, de nenhuma entrega (um plano para a semana, por exemplo). Nada mais muda:
o texto, as situações, os números e os prints que ele já tinha continuam iguais. O e-mail que já saiu não é
reenviado.

```powershell
node --experimental-strip-types scripts/progress/attach.ts --report <id do resumo> --shots-dir <pasta> --dry-run
node --experimental-strip-types scripts/progress/attach.ts --report <id do resumo> --shots-dir <pasta>
```

O id é o que aparece no endereço `/resumo/<id>`. A pasta segue as regras dos prints acima. Um print com `issue`
precisa de uma entrega visível do resumo; sem `issue`, ele é geral e sai no fim, antes do uso do Claude. Rodar
de novo não duplica nada: o que já estava lá é pulado.
