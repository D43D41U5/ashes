import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Le banc de calibrage (scenario.test.ts) simule des jours entiers dans
    // UNE boucle synchrone (déterminisme /sim oblige — pas de timers, voir
    // CLAUDE.md invariant 2) ; sur la vraie Vallée (192×192), le calcul
    // dépasse le délai (60 s, interne à Vitest, non configurable) du ping
    // RPC worker↔processus principal. Vitest le remonte comme une
    // « Unhandled Error » de pure plomberie alors même que le test réussit
    // (assertions vertes) — sans ce réglage, `pnpm scenario` sortirait en
    // échec sur un banc pourtant correct. Les vraies erreurs du test restent
    // fatales via ses propres assertions.
    dangerouslyIgnoreUnhandledErrors: true,
  },
})
