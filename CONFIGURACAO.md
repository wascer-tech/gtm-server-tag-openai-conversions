# OpenAI Ads Conversions By Wascer (ChatGPT): guia de configuração

Documento em português para quem vai configurar a tag dentro de um container
server-side. O `README.md` ao lado cobre a instalação em inglês, para a Community
Gallery. Aqui a gente entra em cada campo e explica de onde o dado sai.

Antes de tudo, uma ideia que vale para o documento inteiro: esta tag roda **no
container server-side**, e ela lê o **evento que chegou nele**. Quem manda esse
evento é o GA4 do navegador, ou um client de dados, ou uma chamada direta do seu
backend. Sempre que você ler "o evento que chegou", é disso que estamos falando.

---

# Parte 1: instalação passo a passo

## Como as duas tags se encaixam

A Wascer tem duas tags de OpenAI Ads:

- **Wascer OpenAI Ads Pixel**, no **container web**, dentro do navegador. Guia em
  `openai-ads-pixel-wascer/CONFIGURACAO.md`.
- **OpenAI Ads Conversions By Wascer (ChatGPT)**, no **container server-side**. É esta.

O servidor pega o que o navegador perde: bloqueador de anúncio, aba fechada antes
da confirmação, e principalmente a compra que só existe no seu backend. Rodando
as duas com o mesmo identificador de evento, a OpenAI conta **uma** conversão.

Se você ainda não instalou o pixel, instale primeiro. É mais rápido e serve de
referência para conferir se o mapeamento está certo.

## Antes de começar

1. Um **container server-side** provisionado na Wascer, já recebendo eventos.
2. **Pixel ID** e **API key** do OpenAI Ads Manager.
3. O client do GA4 configurado no container server, que é quem entrega o evento
   para esta tag.

## Passo 1: pegar as credenciais

Entre no **OpenAI Ads Manager**, abra a aba **Conversions** e crie ali o Pixel ID
e a Conversions API key. A documentação da OpenAI diz literalmente: "You can
provision a Pixel ID and Conversions API key from the conversions tab in Ads
Manager."

O Pixel ID é o mesmo das duas tags. A API key é só desta, e ela sai apenas no
header `Authorization` da chamada para a OpenAI. Ela nunca vai para a Wascer
Store nem para o log.

## Passo 2: importar o template

No **container server-side**:

1. Menu lateral, **Modelos**.
2. Bloco **Modelos de tag**, botão **Novo**.
3. Menu **⋮** no canto superior direito, **Importar**.
4. Selecione o `template.tpl` desta pasta.
5. **Salvar**.

> Confira que você está no container server, e não no web. O template só aparece
> na lista se o contexto do container bater.

## Passo 3: criar a tag

1. **Tags**, **Novo**, **Configuração da tag**.
2. Escolha **OpenAI Ads Conversions By Wascer (ChatGPT)** na seção **Personalizado**.
3. Preencha o essencial:

| Campo | Valor |
|---|---|
| OpenAI Pixel ID | o do passo 1 |
| API key | a do passo 1 |
| Event name | **Standard event** |
| Event | `order_created` para compra |
| Action source | `web` |
| Validate without saving | **ligado**, por enquanto |

Deixe o **Validate without saving** ligado até terminar de testar. Com ele, a
OpenAI valida o payload, responde, e joga fora. Nada entra na sua conta.

## Passo 4: o acionador

Em container server-side, o acionador olha o evento que chegou. Crie um
**Evento personalizado** com o nome do evento do GA4. Para a compra, nome do
evento `purchase`.

Cada evento de conversão é uma tag, com seu acionador. O mapeamento natural:

| Evento que chega do GA4 | Event a escolher na tag |
|---|---|
| `view_item` | `contents_viewed` |
| `add_to_cart` | `items_added` |
| `begin_checkout` | `checkout_started` |
| `purchase` | `order_created` |
| `sign_up` | `registration_completed` |
| `generate_lead` | `lead_created` |

Evite acionar em todos os eventos. Cada disparo é uma requisição para a OpenAI.

## Passo 5: fazer o `user_data` chegar até aqui

Este é o passo que mais gente pula, e é o que faz o campo `user` sair vazio.

O `user_data` **não viaja sozinho** do navegador para o container server. Quem
manda é a tag do GA4 no **container web**, e só quando você configura o **User
Provided Data** nela:

1. No container web, abra a tag de configuração do GA4.
2. Vá em **Dados fornecidos pelo usuário**.
3. Ligue e aponte para as variáveis de email, telefone e endereço do seu site.

Feito isso, o `user_data` passa a chegar no container server e o mapeamento
automático desta tag encontra o que precisa.

Alternativa, quando o evento vem direto do seu backend: preencha a tabela manual
do grupo **User data**, ou ligue a **Wascer Store**, explicada na parte 2.

## Passo 6: fazer o `event_id` viajar

Sem isso, o pixel e o servidor viram duas conversões separadas.

O jeito mais direto é o campo **Event ID**, no grupo Configuration desta tag.
Aponte ele para a mesma variável que você usou no campo **Event ID** do pixel.
Para compra, o id da transação resolve.

Se preferir deixar o valor viajar pelo evento, no container web adicione na tag
do GA4 um parâmetro de evento chamado `event_id` com essa mesma variável.

A ordem que a tag segue é esta:

1. O campo **Event ID** da configuração, quando preenchido.
2. Uma linha chamada `event_id` ou `id` na tabela de **Event data**.
3. O `event_id` do evento que chegou no container.
4. Um id gerado na hora.

O id gerado não tem como ser deduplicado. Com o log do console ligado, a tag
avisa quando cai nesse caso.

## Passo 7: testar no Preview

1. Ligue também o **log do console**, no grupo Advanced.
2. Abra o **Visualizar** do container server e dispare o evento no site.
3. Na aba do evento, abra o console do container e leia o corpo que a tag montou.

O que conferir, nesta ordem:

- a tag concluiu como *Success*
- o `user` tem os identificadores que você espera
- o `data` tem `amount`, `currency` e os `contents`
- a resposta da OpenAI voltou 2xx

Se a tag falhar **sem** requisição nenhuma, é a validação local barrando. O
motivo está escrito no console, e a lista completa do que ela confere está na
parte 2.

## Passo 8: publicar

Desligue o **Validate without saving** e o log do console, dispare uma conversão
de verdade e confira no Ads Manager. Aí sim **Enviar** e **Publicar**.

Com o pixel também no ar, dispare os dois com o mesmo identificador e confirme
que aparece **uma** conversão.

## Passo 9: Wascer Store, quando fizer sentido

Opcional, e o diferencial desta tag. Ligue se você tem conversão chegando por
webhook do backend, sem cookie e sem nada do navegador. A Store guarda os
identificadores quando eles aparecem e devolve quando faltam. Detalhes na parte 2.

---

# Parte 2: referência dos campos

## Configuration

| Campo | O que faz |
|---|---|
| OpenAI Pixel ID | Identifica o seu pixel. Sai da aba de conversões do OpenAI Ads Manager. |
| API key | Autentica a chamada. Sai do mesmo lugar. Vai apenas no header `Authorization` da requisição para a OpenAI, e nunca para a Wascer Store nem para o log. |
| Event name | Escolhe entre evento padrão e evento seu. |
| Event | O evento padrão. Cada um tem um tipo de dado fixo, e a tabela no fim deste documento mostra qual. |
| Custom event name | O nome do seu evento, quando você escolhe custom. Letras, números, underscore e hífen, até 64 caracteres. |
| Event ID | O identificador que casa este evento com o do pixel. Aponte para a mesma variável que você usou no pixel. Vazio, a tag procura o `event_id` do evento que chegou e, se não achar, gera um que não deduplica. |
| Action source | De onde veio a conversão. `web` é o padrão. Com `web`, a OpenAI exige `source_url`, e a tag pega isso do `page_location` do evento. `app_installed` e `app_opened` exigem `mobile_app`. |
| Validate without saving | Liga o modo de teste. A OpenAI valida o payload, responde, e joga fora. Use enquanto estiver montando a tag, porque nada entra na sua conta. |

---

## Event data

**Sim, ele pega do evento que chegou**, quando o checkbox "Map amount, currency
and items from the incoming event" está ligado. É o padrão.

O que ele lê, nesta ordem:

1. **Itens**: `items` do evento. Se não achar, tenta `ecommerce.items`. É o
   formato do GA4, então cada item vira um `contents[]` assim:

   | Campo do GA4 | Vai para |
   |---|---|
   | `item_id` | `id` |
   | `item_name` | `name` |
   | `quantity` | `quantity` |
   | `price` | `amount`, convertido para a unidade menor da moeda |
   | `content_type` | `content_type`, com `product` como padrão |

2. **Moeda**: `currency` do evento. Se não vier, usa a moeda do primeiro item que
   tiver uma.

3. **Valor**: `value` do evento, convertido para a unidade menor. Se o evento não
   trouxer `value`, a tag **soma os itens** (`quantity` vezes `amount`).

### A conversão de moeda

A OpenAI recebe valor em unidade menor. R$ 25,99 vira `2599`. O GA4 manda em
unidade regular, então a tag multiplica. O multiplicador respeita a moeda:

- 100 para a maioria, incluindo BRL, USD e EUR
- 1 para moedas sem centavos: JPY, KRW, CLP, ISK, VND e outras
- 1000 para moedas de três casas: BHD, JOD, KWD, OMR, TND e outras

Ou seja, `value: 2599` em JPY continua `2599`, e não vira 259900.

### A tabela manual

Na tabela **Event data fields** você escreve o nome do campo de um lado e aponta
a variável do outro, igual aos parâmetros de evento do GA4 e igual à tag do
pixel. O que está na tabela **vence** o mapeamento automático.

Nomes que a tag trata:

| Nome | Uso |
|---|---|
| `amount` | Valor já em unidade menor. Use quando você tem o número em centavos. |
| `value` | Valor em unidade regular, tipo `25.99`. A tag converte. `amount_major` faz o mesmo. |
| `currency` | Código ISO da moeda. |
| `plan_id` | Identificador do plano. |
| `items` | Lista de itens pronta, se você montar por variável. `contents` faz o mesmo. |

Se `amount` e `value` aparecerem juntos, `amount` ganha.

**Campos que não cabem no tipo do evento são descartados**, com um aviso no
console. `plan_id` só vale em `subscription_created`, `trial_started` e `custom`.
`items` não vale em eventos de ação do usuário como `lead_created`. Isso é
proteção: a OpenAI recusa o lote inteiro quando um evento traz campo inválido.

**Qualquer outro nome que você escrever sai como está.** Aqui isso pesa mais do
que no pixel: um campo que a OpenAI não espera derruba o lote todo, que pode ter
até mil eventos, não só o disparo da vez. Confira na documentação antes, e use o
**Validate without saving** para testar sem gravar nada.

### Regra que bloqueia o envio

`amount` sem `currency` não passa. A tag barra antes de gastar a requisição e
escreve o motivo no console.

---

## User data

**Também sai do evento que chegou**, quando "Map user data from the incoming
event" está ligado.

| De onde | Vai para | Tratamento |
|---|---|---|
| `user_data.email`, `user_data.email_address`, `user_data.sha256_email_address` ou `email` | `email_sha256` | trim, minúscula e SHA-256 |
| `user_id` | `external_id_sha256` | trim e SHA-256 |
| `user_data.address.city` | `city` | minúscula, cortado em 128 caracteres |
| `user_data.address.postal_code` | `zip_code` | trim, cortado em 32 caracteres |
| `user_data.address.country` | `country` | maiúscula |
| `ip_override` | `ip_address` | vai cru, sem hash |
| `user_agent` | `user_agent` | vai cru, sem hash |
| cookie `__obref` | `obref` | vai cru, sem hash |

Quando `address` vem como lista, a tag usa o primeiro endereço.

**Valor já hasheado passa direto.** A tag reconhece uma string de 64 caracteres
hexadecimais e não hasheia de novo, então você pode mandar o email em texto puro
ou já hasheado, tanto faz.

### O ponto de atenção do GA4

O `user_data` **não viaja sozinho** do navegador para o container server-side. A
tag do GA4 no container web só manda esses campos quando você configura o User
Provided Data nela. Se o `user_data` não chegar, o mapeamento automático não tem
o que ler, e aí você preenche pela tabela manual ou liga a Wascer Store.

### A tabela manual

Mesma lógica do Event data: o que você digita vence o automático. Aceita `obref`,
`email_sha256`, `external_id_sha256`, `country`, `city`, `zip_code`,
`ip_address` e `user_agent`. Email e external id continuam passando pelo hash.

---

## Wascer Store

### O que ela resolve

Um `order_created` que chega por webhook do seu backend não tem cookie, não tem
`oppref`, não tem nada do navegador. Hoje essa conversão não é atribuída a
ninguém. A Store guarda os identificadores quando eles aparecem, e devolve
quando faltam.

### Onde fica o token

**Não existe token, e não tem nada para você configurar.** Esta é a resposta
direta da sua pergunta.

A Store roda dentro do próprio container que está processando o evento. A
infraestrutura da Wascer injeta três headers em toda requisição que entra:

- `x-url-api`, o endereço da Store daquele container
- `x-container-identifier`, que identifica o container
- `x-user-id`, que identifica o dono

A tag lê esses três headers e repassa. É esse o modelo de autenticação: quem
está dentro do container fala com a Store do container, e não alcança a de mais
ninguém. Não há chave para gerar, guardar ou rotacionar.

O único pré-requisito é a flag `enable_database` estar ligada no seu container.
Com ela desligada, a Store responde erro e a tag segue sem enriquecer.

### Como funciona na prática

| Campo | O que faz |
|---|---|
| Enrich events with the Wascer Store | Liga a integração. Vem desligada. |
| Collection | O agrupamento dos documentos. Padrão `openai_ads`. Trocar a collection é começar do zero, porque ela faz parte da chave. |
| Store key | Qual identificador serve de chave do documento. `obref` é o padrão. |
| Fill missing identifiers from the Store | Liga a leitura. |
| Save identifiers to the Store for later events | Liga a escrita. |

**Na escrita**, a tag grava só o que existe, e só estes campos: `oppref`,
`email_sha256`, `external_id_sha256`, `country`, `city` e `zip_code`. **IP e user
agent nunca são gravados**, porque são dado de requisição e envelhecem mal.
Quando não há nenhum identificador no evento, ela nem chama a Store.

**Na leitura**, a tag preenche **apenas o que está vazio**. Ela nunca sobrescreve
um dado que já veio.

A ordem de precedência, do mais forte para o mais fraco:

1. a tabela manual do template, porque você mandou explicitamente
2. o dado do evento que chegou
3. a Store

**O documento vive 90 dias**, e o prazo é renovado a cada escrita. Cliente que
volta ao site continua reconhecido.

**A escrita é um merge, não uma substituição.** Gravar só o email não apaga o
`oppref` que já estava lá.

### Escolhendo a chave

- **obref**: identificador de navegador que a própria tag mantém em cookie.
  Cobre o caso comum de compra dias depois do clique. Precisa do cookie `__obref`
  ligado, senão não há chave.
- **external_id**: o seu id de usuário, já hasheado. Bom quando o cliente faz
  login, porque atravessa dispositivos.
- **custom**: você escolhe, por variável. Serve para chavear por id de pedido ou
  por email hasheado.

Se a chave resolver vazia, a tag pula a Store inteira e registra no console. O
evento vai para a OpenAI do mesmo jeito.

### A Store nunca derruba o evento

Erro, timeout, 404 ou flag desligada: a tag segue e manda para a OpenAI sem
enriquecimento. A leitura espera no máximo 5 segundos. A escrita sai depois do
envio e não segura o resultado da tag.

---

## Cookies

### O que muda ao marcar cada um

**Set the __oppref cookie.** O `oppref` é o identificador de atribuição que a
OpenAI coloca na URL de destino quando alguém clica no anúncio. Ele aparece uma
vez, na landing page, e some nas páginas seguintes. Marcando essa opção, a tag
guarda o valor num cookie de 30 dias, e todo evento posterior daquele visitante
continua carregando a atribuição. Sem o cookie, só o primeiro evento é atribuído.

**Set the __obref cookie.** É o identificador de navegador. Se ainda não existir,
a tag **gera um** e grava por 365 dias. Ele serve para dois fins: vai no `user`
do evento, e é a chave padrão da Wascer Store. Deixar desligado com a Store
chaveada por `obref` significa Store sem chave, e portanto sem enriquecimento.

Os dois cookies só são escritos quando há valor. A tag não cria cookie vazio.

### Cookie options

| Campo | O que faz |
|---|---|
| Cookie domain | `auto` deduz o domínio raiz a partir do `page_location` do evento, então o cookie vale para o site inteiro e para os subdomínios. Preencha manualmente só se precisar de um escopo diferente. |
| Cookie SameSite | `Lax` é o padrão e cobre o caso normal. `None` só faz sentido em fluxo cross-site, e exige `Secure`, que a tag já força. |
| Click ID cookie expiration | Duração do `__oppref` em dias. Padrão 30. Valor inválido ou zero volta para o padrão. |
| Browser ID cookie expiration | Duração do `__obref` em dias. Padrão 365. |

Os dois cookies saem sempre com `Secure` e com `path` na raiz. Como são escritos
**pelo servidor**, num domínio que é seu, eles duram muito mais do que cookie
criado por JavaScript, que os navegadores hoje limitam a poucos dias.

---

## Consent

Um campo só, com duas posições:

- **Send every event**: a tag manda sempre. Use quando o consentimento é tratado
  antes, no container web, ou quando a operação não exige.
- **Only send when ad storage is granted**: a tag olha o consentimento que veio
  no evento. Ela lê `consent_state.ad_storage` e, se não achar, cai no sinal
  `x-ga-gcs` que o GA4 manda. Sem concessão, a tag **não envia nada** e reporta
  sucesso, para não ficar marcada como erro no container.

Vale notar: sem informação nenhuma de consentimento no evento, esse modo trata
como negado. É a leitura conservadora.

---

## Advanced

**Log the request payload to the server container console.** Escreve no console
do container o que a tag montou: a URL, o corpo enviado, o status e o corpo da
resposta, e as chamadas à Store. É o que você abre no Preview quando algo não bate.
Não deixe ligado em produção, porque enche o log.

**Report success without waiting for the OpenAI response.** Por padrão a tag
espera a resposta e marca sucesso ou falha conforme o status. Ligando essa opção,
ela marca sucesso na hora e a resposta chega depois, só para o log. Serve quando
o tempo da tag importa mais do que saber o resultado. O custo é que uma recusa da
OpenAI passa a aparecer só no console, e não no status da tag.

---

## O que a tag confere antes de enviar

Ela valida localmente e, se algo estiver errado, escreve o motivo no console e
falha **sem gastar requisição**:

- pixel id e API key preenchidos
- evento com id e timestamp
- `action_source` preenchido, e `source_url` presente quando ele é `web`
- `custom_event_name` presente quando o evento é custom
- `amount` acompanhado de `currency`, no evento e em cada item
- `content_type` como texto em cada item

Ela também ignora requisições vindas da página de preview do Tag Manager, para
não sujar seus dados enquanto você testa.

---

## Deduplicação com o pixel

A OpenAI conta uma conversão só quando o evento do navegador e o do servidor
chegam com o mesmo identificador. O pixel manda como `event_id` e esta tag manda
como `id`. Alimente os dois com o mesmo valor.

O campo **Event ID** da configuração é onde você faz isso, e ele vence tudo o
mais. Sem ele, a tag procura uma linha `event_id` ou `id` na tabela de Event
data, depois o `event_id` do evento que chegou, e só então **gera um**. O id
gerado não tem como ser deduplicado.

---

## Eventos e o tipo de dado de cada um

| Tipo | Eventos | Campos aceitos além de `type` |
|---|---|---|
| `contents` | `page_viewed`, `contents_viewed`, `items_added`, `checkout_started`, `order_created` | `amount`, `currency`, `contents` |
| `customer_action` | `app_installed`, `app_opened`, `lead_created`, `registration_completed`, `appointment_scheduled` | `amount`, `currency` |
| `plan_enrollment` | `subscription_created`, `trial_started` | `plan_id`, `amount`, `currency`, `contents` |
| `custom` | `custom` | `plan_id`, `amount`, `currency`, `contents` |

`app_installed` e `app_opened` existem apenas no servidor, e exigem
`action_source` em `mobile_app`. O pixel de navegador não aceita esses dois.

---

## Roteiro de teste

1. Ligue **Validate without saving** e **o log do console**.
2. Abra o Preview do container e dispare o evento. Confira no console o corpo que
   a tag montou.
3. Confira se `user` tem os identificadores que você espera. Se estiver vazio,
   o `user_data` provavelmente não está chegando do container web.
4. Desligue o validate e dispare de verdade. Confira a conversão no Ads Manager.
5. Com o pixel também instalado, dispare os dois com o mesmo `event_id` e
   confirme que aparece **uma** conversão, e não duas.
6. Para testar a Store: dispare um `page_viewed` com email, depois um
   `order_created` sem identificador nenhum, e veja o segundo sair com `oppref` e
   `email_sha256` que vieram da Store.

---

## Quando não funciona

**A tag falha e não sai requisição nenhuma.** É a validação local. O motivo está
no console do container, e sempre é um dos itens da lista acima. O mais comum é
`amount` sem `currency`.

**O `user` sai vazio.** Quase sempre é o passo 5 da instalação: o User Provided
Data não está configurado na tag do GA4 do container web. Confirme abrindo o
evento no Preview e olhando se `user_data` existe no que chegou.

**A OpenAI responde 401.** API key errada ou trocada com o Pixel ID.

**A OpenAI responde 400.** Algum campo não cabe no tipo do evento. A tabela de
eventos acima mostra o que cada tipo aceita. Lembre que um evento ruim reprova o
lote inteiro.

**Aparecem duas conversões.** O `id` daqui não está batendo com o `event_id` do
pixel. Confira no console qual valor a tag enviou.

**O evento é recusado por timestamp.** A OpenAI aceita evento dos últimos 7 dias
e no máximo 10 minutos no futuro. Fila de webhook parada estoura esse limite.

**A Store não enriquece nada.** Três suspeitos: a flag `enable_database` está
desligada no container, a chave resolveu vazia, ou ainda não houve escrita
anterior para aquela chave. O console em modo debug mostra a URL chamada e o que
voltou.

**Nada chega em produção, mas funciona no Preview.** A tag ignora de propósito as
requisições vindas da página de preview do Tag Manager, então o inverso é o
esperado. Se o Preview funciona e a produção não, confira se a versão foi
publicada.

---

## Referências

- Conversions API da OpenAI: https://developers.openai.com/ads/conversions-api
- Eventos suportados: https://developers.openai.com/ads/supported-events
- Pixel de navegador: https://developers.openai.com/ads/measurement-pixel
