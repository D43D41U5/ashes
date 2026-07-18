import tseslint from 'typescript-eslint'

// Globals interdits dans /sim (déterminisme + pureté Web Worker). Liste
// partagée entre le code et les tests — les tests n'en assouplissent que
// `process` (vitest tourne sous Node, le banc de calibrage lit process.env).
const simRestrictedGlobals = [
  {
    name: 'Date',
    message: '/sim est déterministe : pas d’horloge. Le temps est le numéro de tick.',
  },
  {
    name: 'performance',
    message: '/sim est déterministe : pas d’horloge. Le temps est le numéro de tick.',
  },
  {
    name: 'setTimeout',
    message: '/sim est déterministe : pas de timers. La boucle de tick est pilotée de l’extérieur.',
  },
  {
    name: 'setInterval',
    message: '/sim est déterministe : pas de timers. La boucle de tick est pilotée de l’extérieur.',
  },
  {
    name: 'setImmediate',
    message: '/sim est déterministe : pas de timers. La boucle de tick est pilotée de l’extérieur.',
  },
  {
    name: 'queueMicrotask',
    message: '/sim est déterministe : pas d’ordonnancement asynchrone. La boucle de tick est pilotée de l’extérieur.',
  },
  {
    name: 'requestAnimationFrame',
    message: '/sim est déterministe : pas d’horloge de rendu. La boucle de tick est pilotée de l’extérieur.',
  },
  {
    name: 'fetch',
    message: '/sim est pur : aucune E/S.',
  },
  {
    name: 'crypto',
    message: '/sim est déterministe : crypto.getRandomValues est de l’aléatoire non seedé. Utiliser le PRNG de rng.ts.',
  },
  {
    name: 'process',
    message: '/sim doit tourner dans un Web Worker : pas d’API Node (process).',
  },
  {
    name: 'Buffer',
    message: '/sim doit tourner dans un Web Worker : pas d’API Node (Buffer).',
  },
]

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'scratchpad/**'] },
  ...tseslint.configs.recommended,

  // ── Garde-fou n°1 du projet : /sim est PUR (GDD §11) ──────────────────
  // /sim doit tourner à l'identique dans un Web Worker (mode Veillée) et
  // sur Node (multi), et être rejouable de façon déterministe (replay log).
  // Donc : aucun import de rendu, de réseau ou d'API Node, et aucune
  // source de non-déterminisme (Math.random, Date, horloges).
  {
    files: ['packages/sim/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['phaser', 'phaser/*'],
              message: '/sim est pur : aucune dépendance au rendu (Phaser vit dans /client).',
            },
            {
              group: ['colyseus', 'colyseus/*', '@colyseus/*'],
              message: '/sim est pur : aucune dépendance au réseau (Colyseus vit dans /server).',
            },
            {
              group: [
                'node:*',
                'fs',
                'path',
                'os',
                'http',
                'https',
                'net',
                'crypto',
                'child_process',
                'worker_threads',
                'stream',
                'util',
              ],
              message: '/sim doit tourner dans un Web Worker : aucune API Node.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...simRestrictedGlobals],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: '/sim est déterministe : utiliser le PRNG seedé (rng.ts).',
        },
        // La spec ECMAScript ne garantit PAS le même résultat d'un moteur JS
        // à l'autre pour les fonctions Math approximées — or un replay
        // enregistré dans un navigateur (Veillée) doit rejouer au bit près
        // sur Node (multi). Autorisés car exacts IEEE 754 : + - * /,
        // Math.sqrt, abs, floor, ceil, round, trunc, sign, min, max, imul,
        // fround, et les constantes (Math.PI, Math.SQRT1_2…).
        ...[
          'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
          'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
          'exp', 'expm1', 'log', 'log2', 'log10', 'log1p',
          'pow', 'hypot', 'cbrt',
        ].map((property) => ({
          object: 'Math',
          property,
          message: `/sim doit rejouer au bit près navigateur/Node : Math.${property} n'est pas déterministe entre moteurs JS. Utiliser une approximation maison ou une table (voir eslint.config.js pour la liste des opérations exactes).`,
        })),
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "BinaryExpression[operator='**']",
          message: '/sim doit rejouer au bit près navigateur/Node : `**` (comme Math.pow) n’est pas déterministe entre moteurs JS. Pour un exposant entier, multiplier explicitement.',
        },
        {
          selector: "AssignmentExpression[operator='**=']",
          message: '/sim doit rejouer au bit près navigateur/Node : `**=` (comme Math.pow) n’est pas déterministe entre moteurs JS. Pour un exposant entier, multiplier explicitement.',
        },
        {
          // Ferme le contournement `globalThis.Math.random()` / `globalThis.Date.now()`.
          selector: "MemberExpression[object.name='globalThis']",
          message: '/sim est pur et déterministe : ne pas passer par globalThis pour contourner les restrictions.',
        },
      ],
    },
  },

  // Les bancs de test de /sim tournent sous vitest (Node) : `process.env`
  // y est légitime (ex. SCENARIO_DAYS pour le banc de calibrage). C'est le
  // SEUL assouplissement — le reste des garde-fous s'applique aussi aux
  // tests, pour que le code de test reste copiable dans la sim sans risque.
  {
    files: ['packages/sim/src/**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...simRestrictedGlobals.filter((g) => g.name !== 'process'),
      ],
    },
  },
)
