import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**'] },
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
                'events',
                'stream',
                'util',
              ],
              message: '/sim doit tourner dans un Web Worker : aucune API Node.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
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
          name: 'fetch',
          message: '/sim est pur : aucune E/S.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: '/sim est déterministe : utiliser le PRNG seedé (rng.ts).',
        },
      ],
    },
  },
)
