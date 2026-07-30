import { describe, expect, it } from 'vitest'
import {
  CHAT_MAX_LEN,
  createEmptyMap,
  createSim,
  grantItems,
  spawnEntity,
  step,
  TERRAIN_GRASS,
  type PlayerAction,
  type SimState,
} from '@ashes/sim'
import { ACTION_FORMES, isJoinMessage, sanitizeAction, sanitizeChat, sanitizeInput, type Genre } from './validate'

/** L'enveloppe réseau d'une action, telle qu'elle arrive du socket. */
const env = (action: unknown): unknown => ({ type: 'action', action })

describe('validate — vraisemblance des inputs (L1)', () => {
  const wellFormed = { type: 'input', seq: 5, dx: 1, dy: -1, sprint: true, sneak: false, block: false }

  it('accepte un input bien formé au seq croissant, et coerce les booléens', () => {
    const out = sanitizeInput({ ...wellFormed, sprint: 1, block: undefined }, 4)
    expect(out).toEqual({ seq: 5, dx: 1, dy: -1, sprint: true, sneak: false, block: false })
  })

  it('rejette les axes hors {-1,0,1}', () => {
    expect(sanitizeInput({ ...wellFormed, dx: 2 }, 0)).toBeNull()
    expect(sanitizeInput({ ...wellFormed, dy: 0.5 }, 0)).toBeNull()
    expect(sanitizeInput({ ...wellFormed, dx: 'left' }, 0)).toBeNull()
  })

  it('rejette un seq non strictement croissant (rejeu, doublon réseau)', () => {
    expect(sanitizeInput({ ...wellFormed, seq: 5 }, 5)).toBeNull()
    expect(sanitizeInput({ ...wellFormed, seq: 4 }, 5)).toBeNull()
    expect(sanitizeInput({ ...wellFormed, seq: 6 }, 5)).not.toBeNull()
  })

  it('rejette une mauvaise forme (pas un input, seq non fini)', () => {
    expect(sanitizeInput(null, 0)).toBeNull()
    expect(sanitizeInput('input', 0)).toBeNull()
    expect(sanitizeInput({ type: 'action' }, 0)).toBeNull()
    expect(sanitizeInput({ ...wellFormed, seq: Number.NaN }, 0)).toBeNull()
  })

  it("valide l'ENVELOPPE d'une action", () => {
    expect(sanitizeAction(env({ type: 'harvest', nodeId: 3 }))).toEqual({ type: 'harvest', nodeId: 3 })
    expect(sanitizeAction({ type: 'action' })).toBeNull()
    expect(sanitizeAction(env({ noType: true }))).toBeNull()
    expect(sanitizeAction({ type: 'input', seq: 1 })).toBeNull()
    expect(sanitizeAction(null)).toBeNull()
  })

  it('reconnaît le message join', () => {
    expect(isJoinMessage({ type: 'join', protocolVersion: 1 })).toBe(true)
    expect(isJoinMessage({ type: 'input' })).toBe(false)
    expect(isJoinMessage(null)).toBe(false)
  })

  it('assainit un message de chat : rogne, borne, rejette le vide', () => {
    expect(sanitizeChat({ type: 'chat', text: '  salut voisin  ' })).toBe('salut voisin')
    expect(sanitizeChat({ type: 'chat', text: '   ' })).toBeNull() // vide après rognage
    expect(sanitizeChat({ type: 'chat', text: 42 })).toBeNull()
    expect(sanitizeChat({ type: 'input', text: 'x' })).toBeNull()
    expect(sanitizeChat(null)).toBeNull()
    // Borné à CHAT_MAX_LEN.
    const long = 'a'.repeat(CHAT_MAX_LEN + 50)
    expect(sanitizeChat({ type: 'chat', text: long })?.length).toBe(CHAT_MAX_LEN)
  })

  it('aplatit les caractères de contrôle du chat (le panneau est sur UNE ligne)', () => {
    expect(sanitizeChat({ type: 'chat', text: 'salut\nles\rvoisins\t!' })).toBe('salut les voisins !')
    expect(sanitizeChat({ type: 'chat', text: '\n\n\n' })).toBeNull() // que du contrôle → vide
  })
})

/**
 * LES DEUX FAILLES MESURÉES à cette frontière, chacune reproduite par le message exact
 * qui la déclenchait. Fuzz de 772 payloads sur `sanitizeAction` → `step` : 5 exceptions
 * (mort du PROCESSUS serveur entier, tous les joueurs éjectés) et 51 payloads mettant un
 * NaN dans l'état déterministe (divergence de replay SILENCIEUSE, invariant n°2).
 */
describe('validate — la forme du fond d\'une action (les payloads hostiles mesurés)', () => {
  it('refuse une action dont un champ REQUIS manque — le vecteur NaN', () => {
    // `{type:'attack'}` mettait NaN dans entity.x et entity.y. Enveloppe pourtant parfaite.
    expect(sanitizeAction(env({ type: 'attack' }))).toBeNull()
    expect(sanitizeAction(env({ type: 'attack', dx: 1 }))).toBeNull() // dy manque
    expect(sanitizeAction(env({ type: 'attack_charge' }))).toBeNull()
    expect(sanitizeAction(env({ type: 'attack_release', dy: 0 }))).toBeNull()
    expect(sanitizeAction(env({ type: 'harvest' }))).toBeNull() // nodeId manque
    expect(sanitizeAction(env({ type: 'build', structure: 'wall' }))).toBeNull() // tx/ty manquent
  })

  it('refuse un nombre non fini ou du mauvais genre — le vecteur crash', () => {
    // `{toString:'nope'}` levait « Cannot convert object to primitive value » DANS le tick.
    expect(sanitizeAction(env({ type: 'attack', dx: { toString: 'nope' }, dy: 0 }))).toBeNull()
    expect(sanitizeAction(env({ type: 'cancel_craft', index: { toString: 'nope' } }))).toBeNull()
    for (const mauvais of [Number.NaN, Infinity, -Infinity, '3', null, [], {}, true]) {
      expect(sanitizeAction(env({ type: 'attack', dx: mauvais, dy: 0 }))).toBeNull()
      expect(sanitizeAction(env({ type: 'harvest', nodeId: mauvais }))).toBeNull()
    }
  })

  it('refuse une valeur hors de la table exhaustive de /sim — le second crash', () => {
    // `material:'or'` déréférençait WALL_TIERS['or'] → undefined['wall'] → TypeError.
    expect(sanitizeAction(env({ type: 'build', structure: 'wall', tx: 4, ty: 4, material: 'or' }))).toBeNull()
    expect(sanitizeAction(env({ type: 'build', structure: 'donjon', tx: 4, ty: 4 }))).toBeNull()
    expect(sanitizeAction(env({ type: 'craft', recipeId: 'excalibur' }))).toBeNull()
    expect(sanitizeAction(env({ type: 'eat', item: 'ambroisie' }))).toBeNull()
    expect(sanitizeAction(env({ type: 'set_access', structureId: 1, access: 'royal' }))).toBeNull()
    // …mais accepte les valeurs légales.
    expect(sanitizeAction(env({ type: 'build', structure: 'wall', tx: 4, ty: 4, material: 'stone' }))).toEqual({
      type: 'build',
      structure: 'wall',
      tx: 4,
      ty: 4,
      material: 'stone',
    })
  })

  it('refuse les entiers absurdes (case, quantité, identifiant)', () => {
    expect(sanitizeAction(env({ type: 'set_active_slot', slot: -1 }))).toBeNull()
    expect(sanitizeAction(env({ type: 'set_active_slot', slot: 1.5 }))).toBeNull()
    expect(sanitizeAction(env({ type: 'move_slot', from: 0, to: 1e9 }))).toBeNull()
    expect(sanitizeAction(env({ type: 'split_slot', from: 0, to: 1, count: 0 }))).toBeNull()
    expect(sanitizeAction(env({ type: 'split_slot', from: 0, to: 1, count: -5 }))).toBeNull()
    expect(sanitizeAction(env({ type: 'give', targetEntityId: 2, item: 'wood', count: -1 }))).toBeNull()
    expect(sanitizeAction(env({ type: 'place_campfire', tx: -3, ty: 0 }))).toBeNull()
  })

  it('refuse un type inconnu, et les clés du prototype', () => {
    for (const t of ['nawak', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '']) {
      expect(sanitizeAction(env({ type: t }))).toBeNull()
    }
  })

  it('refuse en bloc les actions de DÉBOGAGE (aucune surface de debug au réseau)', () => {
    expect(sanitizeAction(env({ type: 'debug_teleport', x: 5, y: 5 }))).toBeNull()
    expect(sanitizeAction(env({ type: 'debug_god', on: true }))).toBeNull()
    expect(sanitizeAction(env({ type: 'debug_set_season_day', day: 59 }))).toBeNull()
    expect(sanitizeAction(env({ type: 'debug_grant', item: 'wood' }))).toBeNull()
    expect(sanitizeAction(env({ type: 'debug_set_hour', hour: 3 }))).toBeNull()
  })

  it('ne laisse passer QUE les champs déclarés (ni clé parasite, ni __proto__)', () => {
    const out = sanitizeAction(env({ type: 'harvest', nodeId: 7, aimX: 1.5, tricheur: 'oui', __proto__: { x: 1 } }))
    expect(out).toEqual({ type: 'harvest', nodeId: 7, aimX: 1.5 })
    expect(Object.hasOwn(out as object, 'tricheur')).toBe(false)
    // L'objet rendu est NEUF : muter la source après coup ne touche pas l'action retenue.
    expect(Object.getPrototypeOf(out as object)).toBe(Object.prototype)
  })

  it('valide les objets IMBRIQUÉS d\'un transfer (SlotRef)', () => {
    const ok = { type: 'transfer', kind: 'structure', containerId: 3, from: { side: 'player', slot: 0 }, to: { side: 'container', slot: 1, zone: 'fuel' }, count: 2 }
    expect(sanitizeAction(env(ok))).toEqual(ok)
    // `side` hors des deux valeurs légales, `zone` inventée, `slot` non entier : refus.
    expect(sanitizeAction(env({ ...ok, from: { side: 'dieu', slot: 0 } }))).toBeNull()
    expect(sanitizeAction(env({ ...ok, to: { side: 'container', slot: 1, zone: 'coffre' } }))).toBeNull()
    expect(sanitizeAction(env({ ...ok, from: { side: 'player', slot: Number.NaN } }))).toBeNull()
    expect(sanitizeAction(env({ ...ok, from: 'player' }))).toBeNull()
    expect(sanitizeAction(env({ ...ok, kind: 'banque' }))).toBeNull()
  })

  it('laisse passer les actions LÉGITIMES du client (aucune régression de jeu)', () => {
    const legitimes: PlayerAction[] = [
      { type: 'light_fire' },
      { type: 'drop_held' },
      { type: 'upgrade_fire' },
      { type: 'harvest_release' },
      { type: 'feed_fire' }, // structureId optionnel, absent
      { type: 'bandage' }, // targetEntityId optionnel, absent
      { type: 'attack', dx: 1, dy: 0 },
      { type: 'attack_charge', dx: -0.7071, dy: 0.7071, hold: true },
      { type: 'attack_release', dx: 0, dy: -1 },
      { type: 'harvest', nodeId: 42, aimX: 12.25, aimY: 30.5 },
      { type: 'harvest', nodeId: 42, whole: true },
      { type: 'harvest_charge_start', nodeId: 7, hold: true },
      { type: 'craft', recipeId: 'axe' },
      { type: 'cancel_craft', index: 0 },
      { type: 'eat', item: 'berries', slot: 3 },
      { type: 'build', structure: 'roof', tx: 11, ty: 11 },
      { type: 'place_campfire', tx: 10, ty: 10 },
      { type: 'place_component', tx: 11, ty: 11 },
      { type: 'set_active_slot', slot: 0 },
      { type: 'move_slot', from: 0, to: 4 },
      { type: 'split_slot', from: 0, to: 4, count: 10 },
      { type: 'give', targetEntityId: 2, item: 'cooked_meat', count: 1 },
      { type: 'found_village', structureId: 1 },
      { type: 'loot_corpse', corpseId: 3 },
    ]
    for (const a of legitimes) expect(sanitizeAction(env(a)), JSON.stringify(a)).toEqual(a)
  })
})

/**
 * LE TEST DE PROPRIÉTÉ — le seul qui prouve la chose intéressante : quoi qu'un client
 * envoie, ce qui FRANCHIT la frontière ne peut ni faire lever le tick ni salir l'état
 * déterministe. On rejoue le corpus du fuzz, cette fois à travers `sanitizeAction`.
 */
describe('validate — propriété : rien de non fini ne franchit la frontière', () => {
  const NOMBRES = [Number.NaN, Infinity, -Infinity, -1, -1e9, 0, 1e9, 2 ** 53, 0.5, 1e308]
  const AUTRES: unknown[] = ['pas-un-nombre', null, true, [], { toString: 'nope' }, { valueOf: null }]
  const CHAINES = ['__proto__', 'constructor', 'toString', 'inconnu', '', 'a'.repeat(500)]
  /** Des champs qui n'appartiennent à AUCUNE action : ils doivent être ignorés, jamais recopiés. */
  const ETRANGERS = ['__proto__', 'constructor', 'tricheur', 'seq', 'protocolVersion']
  /**
   * LES TYPES À FUZZER — DÉRIVÉS de la table des formes, jamais recopiés.
   *
   * C'était une liste écrite à la main de trente-huit noms, et elle a dérivé au premier ajout :
   * `toggle_door` (spec construction R26) est né dans /sim, déclaré dans `FORMES`, et n'a JAMAIS
   * été fuzzé — le corpus l'ignorait. Seule l'assertion de compte l'a rattrapé (« 38 valides pour
   * 39 formes »), ce qui est précisément la garde-de-la-garde qu'il fallait ; mais une liste qui
   * demande à un test de compte de la rappeler à l'ordre est une liste à supprimer.
   *
   * On y ajoute ce qui N'EST PAS une action de jeu, et qui doit être refusé en bloc : les
   * `debug_*`, un nom inventé, et `__proto__`.
   */
  const TYPES = [
    ...Object.keys(ACTION_FORMES),
    'debug_teleport', 'debug_god', 'debug_grant', 'nawak', '__proto__',
  ]

  /** Un monde minuscule avec un joueur pourvu — assez pour que les actions MORDENT. */
  function monde(): { sim: SimState; id: number } {
    const sim = createSim(1, { map: createEmptyMap(48, 48, TERRAIN_GRASS) })
    const id = spawnEntity(sim, 20, 20)
    grantItems(sim, id, { wood: 50, stone: 20, hammer: 1, berries: 10 })
    return { sim, id }
  }

  /** Tout nombre non fini atteignable dans l'état (profondeur bornée). */
  function nonFinis(v: unknown, chemin: string, vus: Set<unknown>, out: string[], prof = 0): void {
    if (out.length >= 4 || prof > 6) return
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) out.push(`${chemin} = ${v}`)
      return
    }
    if (v === null || typeof v !== 'object' || vus.has(v)) return
    vus.add(v)
    if (Array.isArray(v)) {
      for (let i = 0; i < Math.min(v.length, 200); i++) nonFinis(v[i], `${chemin}[${i}]`, vus, out, prof + 1)
      return
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) nonFinis(x, `${chemin}.${k}`, vus, out, prof + 1)
  }

  /**
   * Une valeur LÉGALE pour un genre — de quoi bâtir un payload valide par action, dérivé de
   * la table elle-même. C'est ce qui manquait à la première version du corpus : elle ne
   * produisait que `{type}` nu ou `{type, unSeulChamp}`, donc elle ne pouvait STRUCTURELLEMENT
   * pas fabriquer `{type:'build', structure:'wall', tx:0, ty:0, material:'or'}` — une action
   * valide PLUS un champ illégal, qui est exactement la forme du crash de `build`.
   */
  function valeurLegale(genre: Genre): unknown {
    switch (genre.g) {
      case 'entier':
        return genre.min
      case 'reel':
        return 0
      case 'booleen':
        return true
      case 'clef':
        return Object.keys(genre.table)[0]
      case 'objet':
        return Object.fromEntries(
          Object.entries(genre.forme)
            .filter(([, c]) => c.requis)
            .map(([nom, c]) => [nom, valeurLegale(c.genre)]),
        )
    }
  }

  /** Le payload valide MINIMAL d'une action (ses champs requis, et eux seuls). */
  function baseValide(type: string): Record<string, unknown> {
    const forme = ACTION_FORMES[type]
    if (!forme) return { type }
    const base: Record<string, unknown> = { type }
    for (const [nom, champ] of Object.entries(forme)) if (champ.requis) base[nom] = valeurLegale(champ.genre)
    return base
  }

  const HOSTILES: unknown[] = [...NOMBRES, ...AUTRES, ...CHAINES]

  it('aucun payload hostile ne fait lever le tick ni ne salit l\'état', () => {
    const payloads: Record<string, unknown>[] = []
    for (const type of TYPES) {
      payloads.push({ type }) // le payload NU : tous les champs manquants
      const base = baseValide(type)
      payloads.push({ ...base }) // le témoin : l'action valide, qui doit PASSER
      // Les champs PROPRES de l'action (là où une corruption a une chance de mordre), plus
      // quelques champs ÉTRANGERS (qui doivent être ignorés, pas recopiés dans l'action).
      const propres = Object.keys(ACTION_FORMES[type] ?? {})
      for (const champ of [...propres, ...ETRANGERS]) {
        for (const v of HOSTILES) {
          payloads.push({ type, [champ]: v }) // nu + un champ hostile
          payloads.push({ ...base, [champ]: v }) // VALIDE sauf ce champ — la forme du crash `build`
        }
      }
      // Et le retrait d'un champ requis à la fois — le vecteur NaN d'`attack`.
      for (const champ of Object.keys(base)) {
        if (champ === 'type') continue
        const ampute = { ...base }
        delete ampute[champ]
        payloads.push(ampute)
      }
    }
    expect(payloads.length).toBeGreaterThan(5_000) // le corpus est réellement large

    let franchis = 0
    let valides = 0
    const { sim, id } = monde()
    for (const p of payloads) {
      const action = sanitizeAction(env(p))
      if (action === null) continue
      franchis += 1
      // Ce qui franchit part dans le MÊME monde, tick après tick : on cumule les dégâts
      // au lieu de les diluer dans un état neuf à chaque essai.
      expect(() => step(sim, [{ entityId: id, dx: 0, dy: 0, action }]), JSON.stringify(p)).not.toThrow()
      const sales: string[] = []
      nonFinis(sim, 'sim', new Set(), sales)
      expect(sales, `${JSON.stringify(p)} → ${sales.join(', ')}`).toEqual([])
      // Rien d'étranger n'a été recopié dans ce qui franchit.
      for (const e of ETRANGERS) expect(Object.hasOwn(action, e), `${e} recopié depuis ${JSON.stringify(p)}`).toBe(false)
    }
    // GARDES DU TEST LUI-MÊME : sans eux, une frontière qui refuserait TOUT passerait au vert.
    for (const type of TYPES) {
      if (!ACTION_FORMES[type]) continue
      if (sanitizeAction(env(baseValide(type))) !== null) valides += 1
    }
    expect(valides).toBe(Object.keys(ACTION_FORMES).length) // CHAQUE action de jeu a un payload qui passe
    expect(franchis).toBeGreaterThan(100)
  }, 60_000)
})
