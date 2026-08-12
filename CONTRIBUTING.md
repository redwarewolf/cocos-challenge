# Contribuir a este repo

Convenciones usadas de acá en adelante para ramas, commits y PRs. No son universales — son las que
se acordaron para este repo puntual, para que el historial quede prolijo y trazable a los issues.

## Ramas

```
<tipo>/pj/issue-<NNN>-<slug-corto>
```

- `tipo`: el mismo taxonomy que en los commits (ver abajo).
- `pj`: siglas del autor, en minúscula (los nombres de rama de git no admiten mayúsculas de forma
  consistente entre sistemas de archivos, por eso acá van en minúscula aunque en el commit vayan en
  mayúscula).
- `issue-<NNN>`: número de issue de GitHub, con 3 dígitos.
- `slug-corto`: 2-4 palabras describiendo el cambio, en minúscula y separadas por guiones.

Ejemplos reales: `test/pj/issue-001-tests-automatizados`, `ci/pj/issue-003-pipeline-ci`.

## Commits

Subject:

```
<tipo>/PJ/Issue-<NNN>: <resumen imperativo>
```

Mismo esquema que la rama, pero con `PJ`/`Issue` en mayúscula inicial — así queda igual de legible en
`git log` que en el nombre de rama, sin las restricciones de caracteres que tiene un ref de git.

El body (cuando el cambio lo amerita) es una lista de bullets explicando el **por qué**, no solo el
qué — el diff ya muestra el qué. Cerrá el issue correspondiente con `Closes #<NNN>` al final.

Ejemplo real:

```
ci/PJ/Issue-003: Pipeline de CI (lint, type-check, tests, e2e y build) en cada PR

- .github/workflows/ci.yml corre en push/PR a main: npm ci (con cache de
  npm vía setup-node), eslint sin --fix (falla si hay algo para
  corregir en vez de arreglarlo en silencio), tsc --noEmit, unit tests
  + cobertura, e2e con Testcontainers, y el build de producción.
- El e2e no necesita ningún secret: resuelve su propia DB efímera
  (Testcontainers) en el runner, nunca toca la base real de Cocos, y
  los runners de GitHub Actions ya traen Docker disponible.
- Badge de estado del build + sección "CI" en el README.

Closes #3
```

### Tipos

Conventional Commits, el que corresponda según qué es lo que predomina en el cambio:

| Tipo | Cuándo |
|---|---|
| `feat` | funcionalidad nueva o cambio de comportamiento visible para el usuario de la API |
| `fix` | corrección de un bug |
| `test` | agregar o modificar tests, sin cambiar comportamiento de producción |
| `ci` | pipelines, workflows, configuración de integración continua |
| `docs` | README, CONTRIBUTING, comentarios, sin cambios de código |
| `chore` | tareas de mantenimiento que no encajan en las anteriores (deps, configs) |
| `refactor` | reestructurar código sin cambiar comportamiento externo |

## Pull Requests

- Un PR por issue. Va a la rama que sigue la convención de arriba.
- El body usa el [template](.github/pull_request_template.md) (se autocompleta al abrir el PR):
  `Closes #<NNN>`, test plan como checklist, y notas para el reviewer si hay algo no obvio.
- `main` tiene branch protection: no se puede pushear directo, todo pasa por PR, y el check de CI
  (`.github/workflows/ci.yml`) tiene que estar en verde antes de poder mergear.
- Este es (por ahora) un repo de un solo colaborador, así que no hay revisión obligatoria de otra
  persona ni `CODEOWNERS` configurado — si se suman más colaboradores, ahí sí conviene agregar
  revisión obligatoria y un `CODEOWNERS` por área (`src/orders/`, `src/valuation/`, etc.).
- Al mergear, borrar la rama (el botón de GitHub ya lo hace solo si se tildó esa opción).
