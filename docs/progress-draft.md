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
  "nextSteps": ["Primeiro passo.", "Segundo passo."]
}
```

- `headline`: a frase de abertura (até 400 caracteres). Obrigatória.
- `entries`: um item por entrega **visível** nos fatos, identificada pelo número da issue. Falta de texto
  para uma entrega visível, ou texto para uma issue que não está nos fatos, recusa a montagem e diz o número.
  - `hidden` é opcional: `true` esconde a entrega do e-mail, `false` mostra uma que o coletor escondeu. O
    coletor esconde sozinho o que foi entregue antes do período e o que é interno; uma entrega escondida
    pode ficar sem texto.
- `internal`: a linha sobre ajustes internos. Opcional; sem ela, o RoadS usa uma frase padrão com o total
  coletado. Com total zero, a linha não aparece.
- `difficulties`: o que trava ou atrasa e, em `needs`, o que é preciso e de quem. Pode ficar vazio (o e-mail
  diz que não há bloqueios).
- `nextSteps`: o que vem a seguir, em ordem. Cada item é um texto ou `{ "text": "..." }`.

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
- Sem `issue`, o print é geral e sai no fim, antes do uso do Claude.
- Só os arquivos listados saem; os demais são ignorados. Use só dados de teste e recorte a identidade de quem
  estava logado.

Com o Frontlights 0.16 ou mais novo, a pasta de prints é a da semana no OneDrive (`weekShots` na configuração):
`SCRUM\<ano>\<dd_mm da segunda>\summary`, a segunda-feira **seguinte** ao período do resumo, a da reunião em
que ele é apresentado. O plugin resolve e confere a pasta e a entrega ao comando de envio em `--shots-dir`.
Como a quarta e a sexta usam a mesma pasta, o `captions.json` de cada envio lista só os prints daquele resumo.

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
