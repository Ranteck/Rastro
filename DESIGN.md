---
name: Rastro
description: Dashboard del central de Rastro. Cada persona y cada pendiente es una lámina de anuario con su evidencia.
colors:
  papel: "#f5f4f6"
  papel-tibio: "#faf6f5"
  papel-frio: "#eef3ef"
  tinta: "#16181a"
  tinta-secundaria: "#4a4d52"
  hairline: "#c9c7c4"
  sello: "#dcddf3"
  sello-tinta: "#16181a"
  placa: "#16181a"
  placa-texto: "#ff7b5c"
  foco: "#16181a"
  papel-oscuro: "#141517"
  papel-tibio-oscuro: "#1a1716"
  papel-frio-oscuro: "#121816"
  tinta-oscuro: "#ecebee"
  tinta-secundaria-oscuro: "#b8bac1"
  hairline-oscuro: "#3d3e42"
  sello-oscuro: "#3b3d63"
  sello-tinta-oscuro: "#ecebee"
  placa-oscuro: "#ecebee"
  placa-texto-oscuro: "#a8200f"
  foco-oscuro: "#ecebee"
typography:
  display:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "92px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 500
    lineHeight: 1.2
  title-sm:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: 1.25
  lead:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 400
    lineHeight: 1.35
  body-lg:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    letterSpacing: "0.14em"
  data:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "14px"
    fontWeight: 400
    letterSpacing: "0.04em"
  data-lg:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "17px"
    fontWeight: 400
    letterSpacing: "0.04em"
rounded:
  none: "0px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  base: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
  3xl: "64px"
  cruz: "14px"
  lamina: "28px"
  barra: "72px"
components:
  barra:
    backgroundColor: "{colors.papel}"
    textColor: "{colors.tinta}"
    height: "{spacing.barra}"
    padding: "0 32px"
  pestana:
    textColor: "{colors.tinta-secundaria}"
    typography: "{typography.label}"
    height: "44px"
    padding: "0 12px"
  pestana-activa:
    textColor: "{colors.tinta}"
  token-persona:
    textColor: "{colors.tinta}"
    rounded: "{rounded.none}"
    padding: "4px 8px"
  boton:
    textColor: "{colors.tinta}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    height: "44px"
    padding: "0 16px"
  boton-primario:
    backgroundColor: "{colors.tinta}"
    textColor: "{colors.papel}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    height: "44px"
    padding: "0 16px"
  boton-primario-hover:
    backgroundColor: "{colors.tinta-secundaria}"
  etiqueta-mock:
    textColor: "{colors.tinta}"
    rounded: "{rounded.none}"
    padding: "4px 8px"
  lamina:
    textColor: "{colors.tinta}"
    rounded: "{rounded.none}"
    padding: "{spacing.lamina}"
  placa-alerta:
    backgroundColor: "{colors.placa}"
    textColor: "{colors.papel}"
    rounded: "{rounded.none}"
    padding: "{spacing.lamina}"
  sello:
    backgroundColor: "{colors.sello}"
    textColor: "{colors.sello-tinta}"
    size: "150px"
  bloque-codigo:
    textColor: "{colors.tinta}"
    rounded: "{rounded.none}"
    padding: "12px 16px"
---

# Design System: Rastro

## Overview

**Creative North Star: "Lámina de anuario"**

Rastro se lee como la sección de láminas de un anuario de diseño. Cada persona y cada pendiente es una lámina registrada: un rectángulo de borde fino sobre papel, con cruces de registro en las cuatro esquinas, como una prueba de imprenta. Lo que está resuelto en el código y nadie cerró lleva un sello impreso encima del borde. Ese sello es lo único que tiene color, lo único redondo y lo único que se mueve.

El sistema es de tinta sobre papel. No hay sombras, no hay radios y no hay rellenos de color para ordenar la información: la jerarquía sale del tamaño de la letra, del peso de la línea (hairline o tinta) y de la inversión. La alerta de desvío no es un cartel rojo: es una placa que invierte el papel, tinta de fondo y texto en color de papel, con la palabra en bermellón. Los datos (SHA, horas, ramas, conteos) van en mono porque son evidencia, y la prosa va en un solo grotesco.

Tiene que leerse desde lejos en un proyector, en claro y en oscuro. Por eso el cuerpo es grande, los datos de las láminas suben de tamaño y los pares de texto y fondo cumplen contraste AA en los dos temas. El sistema rechaza de forma explícita el dashboard SaaS de sidebar gris, tarjetas KPI y gráficos de dona.

**Key Characteristics:**
- Tinta sobre papel: un solo acento (el sello lavanda) y un solo color de alerta (el bermellón de la placa).
- Láminas de borde de 1px con cruces de registro de 14px en las cuatro esquinas.
- Radio 0 en todas las cajas. La única curva es el sello.
- Sin sombras. La profundidad sale de la inversión y de la superposición del sello sobre el borde.
- Un grotesco para leer y una mono en mayúsculas para etiquetar y dar evidencia.
- El estado se dibuja con forma (lleno, hueco, raya, punteado), no con color.
- Claro y oscuro son el mismo mundo: papel entintado, tinta clara y sello lavanda apagado.

## Colors

Una paleta casi acromática de papel y tinta, con un lavanda reservado a un solo significado y un bermellón que solo existe adentro de la placa de alerta.

### Primary
- **Lavanda de sello** (`colors.sello`, en oscuro `colors.sello-oscuro`): el disco del sello "resuelto sin cerrar". No aparece en ningún otro lugar de la interfaz. Su texto y sus trazos van en `colors.sello-tinta`.

### Secondary
- **Bermellón de placa** (`colors.placa-texto`, en oscuro `colors.placa-texto-oscuro`): la palabra DESVÍO y el borde en hover de una lámina en alerta. Siempre sobre la placa, nunca sobre papel. En claro es un bermellón claro sobre tinta; en oscuro es un bermellón profundo sobre la placa clara.

### Neutral
- **Papel** (`colors.papel`): el fondo de la página y de la barra fija.
- **Papel tibio** (`colors.papel-tibio`) y **papel frío** (`colors.papel-frio`): la deriva del papel. Dos gradientes radiales fijos entibian la esquina superior derecha y enfrían la inferior izquierda. Es apenas perceptible; no son superficies.
- **Tinta** (`colors.tinta`): el texto, los trazos de las cruces, las marcas de estado, las barras del Gantt, las reglas que abren una tabla, el botón primario y el anillo de foco (`colors.foco`).
- **Tinta secundaria** (`colors.tinta-secundaria`): metadatos, etiquetas de dato, pestañas inactivas y el hover del botón primario.
- **Hairline** (`colors.hairline`): el borde de las láminas y de los botones, y los separadores entre filas.
- **Placa** (`colors.placa`): el fondo de la alerta. Vale lo mismo que la tinta del tema, por eso en oscuro la placa es clara.

Los valores `-oscuro` del frontmatter son el tema oscuro del mismo token. En el código cada token tiene un solo nombre y cambia de valor por preferencia del sistema o por elección manual.

### Named Rules
**La Regla del Sello Único.** El lavanda significa "resuelto sin cerrar" y nada más. No se usa para fondos, estados, hovers ni decoración. Si aparece lavanda en pantalla, hay algo resuelto que nadie cerró.

**La Regla de la Placa.** La alerta se dice invirtiendo, no pintando. Adentro de la placa todo el texto va en color de papel, nunca en gris, y solo la palabra de alerta va en bermellón. Las cruces de registro también pasan a color de papel.

**La Regla de los Pares.** Todo par de texto y fondo que la interfaz combina cumple 4.5:1 en claro y en oscuro. Un color nuevo entra recién cuando su par pasa esa prueba en los dos temas.

## Typography

**Display Font:** Schibsted Grotesk (con system-ui, sans-serif)
**Body Font:** Schibsted Grotesk (con system-ui, sans-serif)
**Label/Mono Font:** JetBrains Mono (con ui-monospace, monospace)

**Character:** Un solo grotesco en dos pesos (400 y 500) hace todo el trabajo de lectura, del número de 92px al cuerpo. La mono es la voz de la evidencia: en mayúsculas espaciadas nombra, y en caja normal muestra el dato tal como viene del repo.

### Hierarchy
- **Display** (400, 92px, interlineado 1, tracking -0.02em, cifras tabulares): el número que manda en la vista. El % fuera del plan y la cantidad de personas con desvío.
- **Headline** (500, 40px, interlineado 1.1, tracking -0.02em): el título de la vista. El nombre de la persona, "Pendientes", el entregable del plan.
- **Title** (500, 28px, interlineado 1.2): el nombre de una lámina de persona, el título de una sección como el Gantt y el encabezado de la lámina protagonista.
- **Title chico** (500, 22px, interlineado 1.25): el encabezado de una lámina de pendiente común.
- **Lead** (400, 26px, interlineado 1.35, medida máxima 60ch): el texto de la lámina protagonista. A 500 y con interlineado 1.25 es la cantidad de resueltos sin cerrar en Mi día.
- **Body grande** (400, 18px, interlineado 1.5, medida máxima 70ch): el texto que se lee de corrido adentro de una lámina y en los estados vacíos o de error.
- **Body** (400, 17px, interlineado 1.5): el texto base de listas y filas.
- **Label** (mono 400, 13px, tracking 0.14em, mayúsculas): encabezados de columna, nombres de dato, estados, pestañas y botones.
- **Data** (mono 400, 14px, tracking 0.04em): SHA, ramas, horas, fechas y costos. Adentro de una lámina sube a 17px para que el dato no sea lo más chico de la lámina en un proyector.

### Named Rules
**La Regla de la Evidencia en Mono.** Lo que viene del repo o del reloj va en mono: SHA, rama, hora, conteo, comando. Lo que escribe una persona o resume el LLM va en grotesco. Así se distingue de un vistazo el dato de la afirmación.

**La Regla del Piso de 13.** La mono nunca baja de 13px. Las etiquetas van a 13px con tracking 0.14em y los datos a 14px o más.

**La Regla de las Cifras.** Las cifras tabulares van solo en el número display. En la prosa, la coma y el punto con ancho de cifra dejan el texto espaciado.

**La Regla de la Etiqueta con Dato.** Una etiqueta en mono mayúscula nombra un dato, una columna o un estado. Los títulos de vista van solos, sin una etiqueta chica encima.

## Layout

La página es una hoja a todo el ancho: no hay contenedor centrado ni sidebar. Una barra fija de 72px arriba lleva la marca, las pestañas, la persona y el tema; el contenido arranca debajo con 32px de margen en los cuatro lados, también en pantallas angostas. El ancho de lectura lo limita la medida del texto (70ch, y 60ch en la lámina protagonista), no un ancho máximo de página.

El ritmo de espaciado es 4, 8, 12, 16, 24, 32, 48 y 64px. Entre láminas van 32px. Entre secciones de una vista van de 48 a 64px. Adentro de una lámina, 4px separan un título de su metadato y de 16 a 24px separan bloques.

Hay tres estructuras que se repiten:

- **Grilla de láminas.** Columnas automáticas con un mínimo de 340px (440px para las sugerencias, que llevan código) y 32px de separación. La lámina protagonista ocupa la fila completa.
- **Grilla de 12 columnas.** El resumen del día va en cuatro columnas de 3. Pasa a dos columnas hasta 960px y a una hasta 560px.
- **Filas con hairline.** La bitácora, las tareas del plan y el Gantt son filas separadas por hairlines, abiertas arriba por una regla de tinta. La bitácora usa cuatro columnas (hora 72px, vínculo 148px, texto flexible, evidencia hasta 280px) y se apila hasta 960px.

La barra crece en vez de esconder cosas: hasta 1024px pasa a dos filas (124px) con las pestañas abajo, y hasta 720px las pestañas hacen wrap (168px) para que todas queden a la vista. El Gantt tiene scroll horizontal propio, con 56px mínimos por día. Los botones y las pestañas miden al menos 44px de alto; los links de evidencia van en línea con su dato.

### Named Rules
**La Regla de la Cruz en el Margen.** Las cruces de registro viven en el padding de la lámina. El padding es siempre el doble de la cruz (28px para una cruz de 14px) o más, así una cruz nunca tapa contenido.

## Elevation & Depth

El sistema es plano. No hay ninguna sombra en el build: ni en reposo, ni en hover, ni en la barra fija, que se separa del contenido con un hairline. La profundidad se dice de dos maneras. La primera es la inversión: la placa de alerta es la única superficie rellena y pesa por contraste. La segunda es la superposición: el sello sale 24px por afuera de la esquina superior derecha de su lámina y pisa el borde, como un sello estampado después de imprimir.

El movimiento sigue la misma lógica. Los hovers son un cambio instantáneo de borde (de hairline a tinta), sin transición. El único movimiento del sistema es el anillo de texto del sello, que gira una vuelta cada 25s, lineal y sin fin, y se detiene con `prefers-reduced-motion`.

### Named Rules
**La Regla del Papel Plano.** Ninguna superficie se levanta. Lo que importa más se invierte o se sella; no se le pone sombra.

## Shapes

Todo es rectangular. El radio es 0 para todos los elementos, sin excepción entre las cajas: láminas, botones, pestañas, tokens, bloques de código y barras del Gantt. La única curva del sistema es el sello, un disco con dos anillos finos, un tilde de trazo recto y el texto en círculo.

La línea tiene tres pesos con significado:

- **Hairline de 1px** en color hairline: bordes de lámina y de botón, separadores de fila.
- **Regla de 1px en tinta**: abre una tabla o una columna, bordea la lámina protagonista y el bloque de código, y une una razón inferida con su entrada.
- **Trazo de 2px en tinta**: la pestaña activa, la etiqueta de mock, la marca hueca y la barra punteada.

Las cruces de registro son dos trazos de 1px y 14px de largo en cada esquina de la lámina, centrados sobre el vértice interior. Las marcas de estado son figuras de 12px: un cuadrado lleno, un cuadrado hueco y una raya.

### Named Rules
**La Regla de la Forma por Estado.** El estado se distingue por forma y no por color. Lleno es detectado o hecho, hueco es inferido o pendiente, raya es sin tarea o sacada, y la tarea sacada lleva además el nombre tachado. En el Gantt, contorno es plan, relleno es real y punteado es fuera del plan.

**La Regla del Punteado.** La línea punteada significa una sola cosa: trabajo que no estaba en el plan. No se usa como separador ni como borde decorativo.

## Components

Los componentes son impresos antes que táctiles: bordes finos, texto en mono, ningún relleno salvo en la acción principal y en la alerta.

### Buttons
- **Shape:** rectángulo sin radio (0px), 44px de alto mínimo, 16px de padding horizontal.
- **Secundario (por defecto):** fondo transparente, borde hairline de 1px, texto en tinta con el estilo de etiqueta (mono 13px, mayúsculas, tracking 0.14em). Lo usan "Reintentar", los links de vuelta y el botón de tema.
- **Primario:** relleno de tinta con texto en color de papel. Es la acción principal de una lámina: "Ver pendientes", "Copiar".
- **Hover / Focus:** en hover el borde pasa de hairline a tinta, y el primario aclara su relleno a tinta secundaria. Sin transición. El foco visible es un contorno de 2px en tinta separado 3px del elemento, igual para todo lo enfocable.

### Chips
- **Token de persona:** el nombre de la persona en la barra, en mono 13px sin mayúsculas, con borde hairline y 4px por 8px de padding. No es interactivo.
- **Etiqueta de mock:** mono 14px en mayúsculas con borde de 2px en tinta. Marca lo que todavía es visión ("MOCK · VISIÓN", "MODO EJEMPLOS"). Es el borde más pesado de la barra a propósito: lo que no es real tiene que verse.

### Cards / Containers
- **Lámina:** el contenedor del sistema. Sin radio, sin fondo propio (deja ver el papel), borde hairline de 1px, 28px de padding y cruces de registro en las cuatro esquinas. Rompe palabras largas para que un SHA o una ruta nunca desborden.
- **Lámina enlazada:** la lámina de persona es un link entero. En hover su borde pasa a tinta.
- **Lámina protagonista:** borde en tinta en vez de hairline, 48px de padding, fila completa y lugar reservado a la derecha para el sello. Su texto principal va a 26px.
- **Shadow Strategy:** ninguna. Ver Elevation & Depth.

### Inputs / Fields
El build no tiene campos de formulario. El único bloque de entrada y salida es el **bloque de código**: mono 15px con interlineado 1.5, borde de 1px en tinta, 12px por 16px de padding, con salto de línea conservado y enfocable por teclado. Va siempre acompañado de un botón primario "Copiar" y de un aviso en etiqueta que confirma la copia.

### Navigation
Una barra fija de 72px sobre papel, cerrada abajo por un hairline. De izquierda a derecha: la marca en mono, las pestañas, un espacio flexible, la etiqueta de modo si corresponde y el botón de tema. Las pestañas son links en estilo etiqueta, de 44px de alto, en tinta secundaria. La activa pasa a tinta y lleva una raya inferior de 2px. En pantallas angostas la barra suma filas y las pestañas hacen wrap; nunca se colapsan en un menú.

### Placa de alerta
Una lámina invertida: fondo de placa, texto en color de papel y cruces en color de papel. Lleva la palabra de alerta en mono 22px con tracking 0.14em, en bermellón. Se usa para la persona con desvío en Equipo y para el % fuera del plan cuando hay alerta. Sin alerta, el mismo número va suelto sobre el papel, sin lámina.

### Sello
Un disco lavanda de 150px (200px en el encabezado de Mi día) con dos anillos de 1px, un tilde de 3px de trazo recto y la frase "RESUELTO · SIN CERRAR ·" en mono 13px girando en círculo. Va estampado sobre la esquina superior derecha de su lámina, 24px por afuera del borde. Hasta 720px baja adentro de la lámina, alineado a la derecha. Es decorativo para lectores de pantalla: el tipo de pendiente siempre se escribe aparte como texto.

### Fila de bitácora
Hora en mono, marca de estado de 12px con su etiqueta, el nombre de la tarea y el texto en grotesco, la rama en mono y, al margen derecho, la evidencia. Cada evidencia es un par de etiqueta y dato; si tiene URL, el dato es un link subrayado en tinta. Una entrada inferida muestra su razón a 15px en tinta secundaria, unida a la fila por una regla vertical de 1px en tinta.

### Barras del Gantt
Barras de 14px de alto sobre una pista de una columna por día. La barra de plan es un contorno de 1px en tinta, la real es un relleno de tinta y va debajo, y la tarea fantasma es un contorno punteado de 2px. Una leyenda con las tres muestras va siempre arriba de la tabla.

## Do's and Don'ts

### Do:
- **Do** poné cada persona, pendiente o sugerencia en una lámina: borde de 1px, 28px de padding, radio 0 y cruces de registro de 14px en las cuatro esquinas.
- **Do** acompañá cada afirmación con su evidencia en mono (commit, rama, doc, sesión), con link cuando hay URL.
- **Do** marcá la alerta invirtiendo: placa de tinta, texto en color de papel y solo la palabra de alerta en bermellón.
- **Do** distinguí el estado por forma: lleno, hueco, raya y punteado.
- **Do** dejá que un número a 92px mande en la vista cuando hay un dato que tiene que leerse desde lejos.
- **Do** usá el borde en tinta, y no el hairline, para la lámina que es protagonista de la vista.
- **Do** probá todo par nuevo de texto y fondo a 4.5:1 en claro y en oscuro.
- **Do** etiquetá a la vista lo que es mock o visión con la etiqueta de borde de 2px.
- **Do** mantené en 44px o más el alto de botones y pestañas.

### Don't:
- **Don't** uses el lavanda para otra cosa que el sello de "resuelto sin cerrar".
- **Don't** armes un dashboard SaaS: nada de sidebar gris, tarjetas KPI ni gráficos de dona.
- **Don't** agregues sombras ni radios a las cajas. La única curva es el sello.
- **Don't** pongas texto gris adentro de la placa de alerta, ni bermellón afuera de ella.
- **Don't** bajes la mono de 13px.
- **Don't** uses la línea punteada para algo que no sea trabajo fuera del plan.
- **Don't** dejes que una cruz de registro pise contenido: el padding de la lámina es el doble de la cruz o más.
- **Don't** escondas las pestañas en un menú en pantallas angostas: la barra crece y las pestañas hacen wrap.
- **Don't** presentes un mock como si fuera real.
