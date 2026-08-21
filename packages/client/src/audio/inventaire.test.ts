import { describe, expect, it } from 'vitest'
import { FAMILLES, INVENTAIRE, SONORES, faitsDeFamille, type FamilleId } from './inventaire'

/**
 * L'inventaire n'a de valeur que s'il est ENTIER et LISIBLE : un fait rangé dans une famille
 * qui n'existe pas disparaît du banc d'écoute, donc ne se tranche jamais — et c'est exactement
 * le trou que ce chantier vient boucher. Les gardes balaient tout l'espace (62 faits), elles
 * ne piochent pas des cas.
 */
describe('l’inventaire des 73 faits', () => {
  const ids = new Set<string>(FAMILLES.map((f) => f.id))

  it('AUCUN fait ne tombe dans une famille non déclarée (sinon il sort du banc en silence)', () => {
    expect(FAMILLES.length).toBeGreaterThan(0) // la prémisse : il y a bien des familles
    const orphelins = Object.entries(INVENTAIRE)
      .filter(([, f]) => !ids.has(f.famille))
      .map(([type, f]) => `${type} → « ${f.famille} »`)
    expect(orphelins).toEqual([])
  })

  it('les familles PARTITIONNENT les 73 faits — chacune en porte, aucune n’est vide', () => {
    const comptes = FAMILLES.map((f) => ({ id: f.id, n: faitsDeFamille(f.id).length }))
    expect(comptes.filter((c) => c.n === 0)).toEqual([]) // pas de section vide à l'écran
    const somme = comptes.reduce((t, c) => t + c.n, 0)
    expect(somme).toBe(Object.keys(INVENTAIRE).length)
    // 68 → 73 le 2026-08-18 : la Brume (5 faits, spec brume.md) ; 73 → 76 le 2026-08-19 :
    // les trois faits du blizzard (météo R9) ; 76 → 77 : `crop_frozen` (flore-froid F5) ;
    // 77 → 80 le 2026-08-21 : la pression croissante des Cendreux (`cendreux_cri`,
    // `presage_horde`, `charnier_brule` — spec 2026-08-21).
    // 80 → 81 le 2026-08-21 : `refugee_rumeur` (annales.md R12) — MUET décidé : il tombe sur
    // le même geste que `refugees_fed`, qui parle déjà. Le renseignement se LIT.
    expect(somme).toBe(81)
  })

  it('chaque fait DIT ce qu’il raconte — pas son identifiant', () => {
    // On tranche des faits de jeu à l'oreille, pas des symboles : un `quoi` vide ou recopié
    // depuis le type (les identifiants portent des `_`, le français non) ne se lit pas.
    const muets = Object.entries(INVENTAIRE)
      .filter(([, f]) => f.quoi.trim().length < 8 || f.quoi.includes('_'))
      .map(([type]) => type)
    expect(muets).toEqual([])
  })

  it('l’état publié est bien l’état ACTUEL : 44 voix, 34 silences décidés', () => {
    // Un compte, pas un jugement. `sound.test.ts` vérifie séparément que ces 38 sonnent
    // VRAIMENT (et que les 26 se taisent vraiment) — ici on garde seulement la proportion.
    // 34 → 35 le 2026-07-29 : `node_depleted` sort du silence (l'arbre qui tombe craque).
    // 35 → 36 le 2026-07-30 : `door_toggled` naît sonore (spec construction R26) — c'est le seul
    // retour d'un geste dont l'écran ne montre presque rien.
    // 62 → 63 faits et 36 → 37 voix le 2026-07-31 : `cendreux_prowl` naît (spec cendreux R11bis).
    // 63 → 64 faits et 37 → 38 voix le 2026-07-31 : `reveil_etouffe` naît (spec cendreux R21) —
    // le feu qui étouffe un réveil est la PARADE, et une parade muette ne s'apprend pas.
    // La nuit bascule d'espèce avec les actes, et un Cendreux ne hurle pas : il lui fallait sa
    // propre voix, sinon l'acte III aurait sonné le cor du loup sur une chose qui traîne les pieds.
    // 64 → 66 faits et 38 → 39 voix le 2026-07-31 : `village_stage_up` (voix — le fait
    // saillant du chantier villages-PNJ, jumeau grave de `fire_upgraded`) et
    // `settler_arrived` (muet, comme le `member_joined` qu'il accompagne toujours).
    // 66 → 67 faits et 27 → 28 SILENCES le 2026-08-01 : `recipe_revealed` naît MUET (D2).
    // 67 → 68 faits et 39 → 40 voix le 2026-08-16 : `bird_flush` naît SONORE (forêts-vivantes §3) —
    // la nuée qui gicle est un signal de chasse, une dénonciation muette ne dénoncerait rien.
    // Une matière ramassée ouvre souvent plusieurs recettes d'un coup, et poser une station
    // en révèle une poignée dans le même tick : un son par ligne ferait une rafale. Si la
    // découverte doit s'entendre, ce sera d'UNE voix par salve — une décision à part.
    // 68 → 73 faits, 40 → 43 voix et 28 → 30 silences le 2026-08-18 : LA BRUME naît (spec
    // brume.md). L'annonce et la levée sonnent (le §9bis exige que tout se signale, et tant
    // que la nappe n'a pas de rendu l'oreille est le seul préavis), le filon a sa voix
    // (l'ouverture qui monte) ; le retrait de la nappe et celui du filon sont muets — une
    // menace qui s'en va ne sonne pas (le principe de `horde_dispersed`), et `filon_retire`
    // est un fait de plomberie client (dématérialiser le nœud), pas un moment.
    // 73 → 76 faits et 30 → 33 SILENCES le 2026-08-19 : le blizzard (météo R9) naît MUET trois
    // fois (`blizzard_annonce`/`_entre`/`_passe`) — le vent est une nappe du chantier audio
    // météo, pas un one-shot d'événement ; sa voix se décidera au banc, avec le rendu.
    // 76 → 77 faits et 43 → 44 voix le 2026-08-19 : `crop_frozen` naît SONORE (spec
    // `flore-froid.md` F5) — c'est la seule PERTE que le froid inflige, et une perte
    // silencieuse ne s'apprend pas : un joueur qui ne l'entend pas ne comprend pas
    // pourquoi sa parcelle est vide au matin. Triangle qui descend, bref et bas (une
    // rangée de parcelles gèle d'un coup).
    // 77 → 80 faits et 44 → 47 voix le 2026-08-21 : la pression croissante des Cendreux.
    // `cendreux_cri` SONNE (le seul moment où un mort a une voix — un appel muet
    // n'appellerait rien) ; `presage_horde` SONNE (le préavis de la veille est LE
    // télégraphiage, §9bis — patron de `brume_annonce`) ; `charnier_brule` SONNE (la
    // confirmation du geste — le principe de `reveil_etouffe`).
    expect(SONORES.length).toBe(47)
    // 33 → 34 le 2026-08-21 : `refugee_rumeur` naît MUET (annales.md R12) — le geste de
    // nourrir parle déjà, le renseignement se lit dans la chronique.
    expect(Object.keys(INVENTAIRE).length - SONORES.length).toBe(34)
  })

  it('PLUS AUCUNE famille n’est entièrement muette, sauf celle qui l’est par décision', () => {
    // Le fait qui a ouvert le chantier : le social et la saison étaient des pans ENTIERS de
    // silence, et c'est le cœur du jeu. Cette garde interdit qu'on y retombe — si une famille
    // redevient muette d'un bout à l'autre, quelqu'un doit venir dire que c'est voulu.
    const muettes = FAMILLES.filter((f) => faitsDeFamille(f.id).every((x) => x.fait.voix === 'muet')).map((f) => f.id)
    expect(muettes).toEqual(['plomberie'])
  })

  it('chaque famille porte une question et une reco (le banc les affiche)', () => {
    const creuses = FAMILLES.filter((f) => !f.titre.trim() || !f.propos.trim() || !f.reco.trim()).map((f) => f.id)
    expect(creuses).toEqual([])
  })

  it('`faitsDeFamille` rend exactement les faits de la famille demandée', () => {
    for (const id of ids as Set<FamilleId>) {
      const rendus = faitsDeFamille(id)
      expect(rendus.length).toBeGreaterThan(0)
      expect(rendus.every((r) => r.fait.famille === id)).toBe(true)
    }
  })
})
