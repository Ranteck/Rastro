# Intención: Rastro
Autor: Denis Hugo Perafan · Estado: aceptado · Fecha: 2026-10-09

## Problema
Challenge del Flock AI Day 2026: un asistente que junte lo que se hizo en código, tareas y
documentación, detecte pendientes y arme un resumen con evidencia y próximos pasos, para reducir la
supervisión manual de lo que ya está resuelto.

El líder pregunta "¿esto está?" por cosas ya resueltas, la daily se arma a mano, el trabajo sin
ticket no se ve y nadie mide lo que se repite. Mis skills (daily-flock, jira-summary) resuelven
parte, pero dependen de que yo las invoque.

## Resultado esperado
- Una CLI que se activa en momentos concretos y usa `claude -p` headless: post-commit (solo anota
  el evento), fin de sesión de Claude Code y `rastro daily` a demanda o por cron.
- Bitácora del día a día con evidencia (link al commit, PR o doc), separada por rama y tarea.
- Pendientes ("está resuelto en el código; nadie cerró el ticket") con próximos pasos.
- Seguimiento contra un plan que se arma solo desde una propuesta, o sugiriendo ideas: al final del
  día avisa qué quedó sin resolver y detecta desde el principio divergencias o desvíos.
- Sugerencias de automatización cuando alguien repite una acción varias veces.
- Conectores para publicar: un central propio, que recibe lo de cada persona y sirve un dashboard
  con todo lo anterior (Gantt plan vs. real incluido), y Notion, como ya hace daily-flock.
- Para el AI Day: todo funcional salvo el Gantt, que es mock. Tiene que poder continuarse después.

## Usuarios y sistemas afectados
Desarrollador (primero yo), líder, cliente y dirección. Git, tareas, Notion, Claude Code y terminal.

## Restricciones
- No es vigilancia: no corre todo el tiempo y cada persona decide qué comparte.
- Detección determinística; el LLM solo resume y propone.
- La IA (`claude -p` en la demo) tiene que poder reemplazarse por una API propia o un LLM local ~1B.
- Reutilizar daily-flock, jira-summary y el flujo con Notion.
- TypeScript en modo estricto. Entrega: AI Day, 2026-10-09.

## Fuera de alcance
Para el AI Day: agente por máquina, merge y dedupe entre personas, sincronización con clientes, LLM
local y modelo de negocio.

## Preguntas abiertas
- Conectores en la demo: ¿Notion real ahora mismo, o una imagen mock?
- ¿Qué muestra la vista de equipo del dashboard?

## Cambios
2026-10-09: Entra en alcance el central propio, que recibe lo que publica cada Rastro y sirve la UI;
Notion queda como conector. Motivo: el challenge pide memoria de equipo. OK de Denis.
