import { describe, expect, it } from 'vitest'
import { ambientTint as ambientTint_, daylight as daylight_, lueurDeLune as lueurDeLune_, multiplicateurDuVoile, voileDeNuit, LUNAISON_JOURS, LUNE_PLEINE_JOUR, heureCanonique } from '../../render/lighting'

/**
 * LES COURBES DE CE FICHIER S'ÉPROUVENT SUR LE CADRAN CANONIQUE — le jour d'équinoxe, celui
 * sur lequel chaque keyframe a été calibrée. On réenveloppe donc les entrées marquées
 * `HeureSolaire` : ces bancs disent « à 20 h le ciel est or », pas « à 20 h le 105ᵉ jour ».
 * Ce que fait la SAISON de l'heure est éprouvé à part (« l'heure solaire suit la saison »).
 */
const lueurDeLune = (h: number, jour: number): number => lueurDeLune_(heureCanonique(h), jour)
const ambientTint = (h: number): { color: number; alpha: number } => ambientTint_(heureCanonique(h))
const daylight = (h: number): number => daylight_(heureCanonique(h))

import { ambianteDuCiel, intensitesDuCiel, intensiteDuFeu, facteurDuFeu, BRAISES_FACTEUR } from './dynamic-lighting'
import { addItems, makeInventory, FIRE, type Inventory, type Structure } from '@ashes/sim'

/**
 * LA LUNE NE DOIT JAMAIS ÉCLAIRER PLUS FORT QUE LE SOLEIL TANT QU'IL FAIT JOUR.
 *
 * Le défaut tenait dans un commentaire faux : la lune était dite « BEAUCOUP plus faible que
 * le soleil (~1.2) » — mais 0,32 était comparé au COEFFICIENT du soleil, pas à sa VALEUR.
 * Le soleil vaut `day × 1.2` et décroît ; la lune valait `(1 − day) × 0.32` et croissait.
 * Deux droites qui se croisent : à `daylight = 0,2105`, soit **de 19 h 56 à 6 h 22**, la lune
 * était la source dominante. À 20 h pile (`daylight = 0,2` exactement, c'est une clé de la
 * courbe), soleil 0,240 contre lune 0,256.
 *
 * Conséquence mesurée sur les captures : le contraste avatar/sol passait de 2,60:1 à midi à
 * **1,20:1 à 20 h**, avec INVERSION de polarité (l'avatar, plus clair que le sol au zénith,
 * devenait plus sombre) — les deux teintes opposées, ambre rasant et bleu lunaire,
 * s'annulant en gris neutre. À l'heure exacte où le jeu dit de rentrer au feu, on se perdait
 * soi-même dans le décor. (Audit UX 2026-08-20.)
 *
 * On balaie donc TOUT le domaine plutôt que trois heures choisies : c'est un rapport entre
 * deux nombres, il se prouve sur son domaine entier.
 */
describe('les deux sources du ciel', () => {
  it('le SOLEIL domine partout où il fait encore jour — balayage exhaustif de la journée', () => {
    const fautes: string[] = []
    for (let h = 0; h < 24; h += 0.05) {
      const d = daylight(h)
      const { soleil, lune } = intensitesDuCiel(d)
      // « Il fait encore jour » = le soleil éclaire. Sous ce seuil on est de nuit, et il est
      // normal — voulu — que la lune soit la seule source.
      if (d > 0.15 && lune > soleil) fautes.push(`${h.toFixed(2)}h (jour ${d.toFixed(3)}) : lune ${lune.toFixed(3)} > soleil ${soleil.toFixed(3)}`)
    }
    expect(fautes).toEqual([])
  })

  it('20 h — l’heure exacte du défaut : le soleil repasse devant', () => {
    const { soleil, lune } = intensitesDuCiel(daylight(20))
    expect(daylight(20)).toBeCloseTo(0.2, 5) // la clé de courbe qui rendait le défaut net
    expect(soleil).toBeGreaterThan(lune)
    expect(lune).toBe(0) // à 20 h il fait encore jour : la lune n'est pas levée
  })

  it('la LUNE existe quand même — sinon la nuit tombe à l’aplat noir', () => {
    const minuit = intensitesDuCiel(daylight(0))
    expect(minuit.soleil).toBe(0)
    expect(minuit.lune).toBeGreaterThan(0.3) // pleine force : le relief bleuté des houppiers
  })

  it('elle monte SANS MARCHE entre le crépuscule et la nuit', () => {
    // Une lune qui s'allumerait d'un coup se verrait comme un interrupteur. On vérifie la
    // continuité sur le passage : aucun saut de plus d'un dixième entre deux crans voisins.
    let precedent = intensitesDuCiel(0.3).lune
    for (let d = 0.3; d >= 0; d -= 0.005) {
      const { lune } = intensitesDuCiel(d)
      expect(Math.abs(lune - precedent)).toBeLessThan(0.1)
      precedent = lune
    }
  })

  it('et le soleil garde sa pleine force à midi', () => {
    expect(intensitesDuCiel(daylight(12)).soleil).toBeCloseTo(1.2, 5)
  })
})

/**
 * ═══ L'AMBIANTE FAIT LA NUIT DES SPRITES — LE VOILE NE LA FAIT QUE DU SOL ═══
 *
 * En rendu éclairé (le mode nominal), le voile passe SOUS les sprites : `voileDeNuit` avait
 * beau tomber au noir à la nouvelle lune, les arbres, les bêtes et l'avatar gardaient l'ancien
 * `AMBIENT_NIGHT`, qui ne connaissait pas la lune. On mesure donc ici ce que l'œil voit — le
 * PIXEL rendu d'un albédo moyen — et des DEUX côtés à la fois : sprite et sol.
 */
describe('l’ambiante suit la lune', () => {
  const ALBEDO = 140 // un albédo moyen : la peau, le bois, une pierre — le cas nominal
  const canaux = (c: number): [number, number, number] => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]
  /** Le pixel d'un sprite d'albédo moyen sous une ambiante multiplicative (pipeline Light2D,
   *  hors toute source directe : le cas de qui s'éloigne du Feu). */
  const spriteSousAmbiante = (amb: number) => canaux(amb).map((m) => Math.round((ALBEDO * m) / 255))
  /** Le même albédo, mais sur le SOL : lui prend sa nuit du voile, en MULTIPLY. */
  const solSousLeVoile = (h: number, jour: number) =>
    canaux(multiplicateurDuVoile(voileDeNuit(ambientTint(h), lueurDeLune(h, jour)))).map((m) => Math.round((ALBEDO * m) / 255))

  const NOUVELLE = LUNE_PLEINE_JOUR + LUNAISON_JOURS / 2

  it('nouvelle lune : le sprite tombe EXACTEMENT sur son sol', () => {
    // Le cœur du correctif, et il est vérifiable au niveau près parce que l'ambiante DÉRIVE du
    // voile au lieu d'être écrite à côté. Avant : sol (9, 9, 15) sous un sprite à (28, 36, 52).
    const lueur = lueurDeLune(0, NOUVELLE)
    expect(lueur).toBe(0) // à la nouvelle lune, elle traverse le ciel de jour : la nuit n'en a aucune
    const sprite = spriteSousAmbiante(ambianteDuCiel(daylight(0), lueur))
    expect(sprite).toEqual(solSousLeVoile(0, NOUVELLE))
    expect(Math.max(...sprite), `sprite ${sprite}`).toBeLessThan(20) // « proche du noir »
  })

  it('…et la pleine lune reste l’étalon, au niveau près', () => {
    // « La lumière actuelle à minuit doit être notre PLEINE lune » (Alexis) : à son transit,
    // l'ambiante est EXACTEMENT celle d'avant que la lune existe.
    expect(ambianteDuCiel(daylight(1), lueurDeLune(1, LUNE_PLEINE_JOUR))).toBe(0x33415f)
    const aMinuit = spriteSousAmbiante(ambianteDuCiel(daylight(0), lueurDeLune(0, LUNE_PLEINE_JOUR)))
    const etalon = spriteSousAmbiante(0x33415f)
    expect(Math.max(...aMinuit.map((v, i) => Math.abs(v - (etalon[i] ?? 0)))), `${aMinuit}`).toBeLessThanOrEqual(1)
  })

  it('LE CONTRÔLE — la phase ne touche JAMAIS au plein jour', () => {
    // À la nouvelle lune, la lune transite en plein MIDI (sa phase EST son heure). Sans la
    // rampe `MOON_DAWN`, une nuit noire aurait assombri le jour 72 à midi. Balayage exhaustif
    // de la lunaison entière : partout où il fait jour, la lune ne change rien du tout.
    const fautes: string[] = []
    for (let j = 0; j < LUNAISON_JOURS; j += 0.5) {
      for (let h = 0; h < 24; h += 0.25) {
        const d = daylight(h)
        if (d <= 0.15) continue // sous ce seuil il fait nuit : c'est là que la lune a le droit
        const avec = ambianteDuCiel(d, lueurDeLune(h, LUNE_PLEINE_JOUR + j))
        if (avec !== ambianteDuCiel(d, 1)) fautes.push(`${h} h, jour +${j}`)
      }
    }
    expect(fautes).toEqual([])
  })

  it('la nuit se ferme SANS MARCHE d’une phase à l’autre', () => {
    // Même exigence que sur le voile : une ambiante qui descendrait par paliers se verrait
    // comme un interrupteur. Balayage de la lunaison à minuit, sur le pixel rendu.
    let pire = 0
    let ou = 0
    for (let j = 0.05; j < LUNAISON_JOURS; j += 0.05) {
      const a = spriteSousAmbiante(ambianteDuCiel(daylight(0), lueurDeLune(0, LUNE_PLEINE_JOUR + j)))
      const b = spriteSousAmbiante(ambianteDuCiel(daylight(0), lueurDeLune(0, LUNE_PLEINE_JOUR + j - 0.05)))
      const d = Math.max(...a.map((v, i) => Math.abs(v - (b[i] ?? 0))))
      if (d > pire) { pire = d; ou = j }
    }
    expect(pire, `pire marche au jour +${ou.toFixed(2)}`).toBeLessThanOrEqual(2)
  })

  it('et une nuit de pleine lune s’assombrit quand la lune SE COUCHE', () => {
    // Conséquence assumée : la lueur suit l'ALTITUDE, donc la fin d'une nuit de pleine lune
    // (elle se couche à l'aube) se referme comme une nuit sans lune. C'est ce que le voile du
    // sol fait déjà — les deux chaînes parlent de la même lune.
    const tot = spriteSousAmbiante(ambianteDuCiel(daylight(1), lueurDeLune(1, LUNE_PLEINE_JOUR)))
    const tard = spriteSousAmbiante(ambianteDuCiel(daylight(4.5), lueurDeLune(4.5, LUNE_PLEINE_JOUR)))
    expect(Math.max(...tard)).toBeLessThan(Math.max(...tot))
  })
})

/**
 * ═══ UN FEU ÉTEINT N'ÉCLAIRE PLUS — le défaut du 2026-08-26 ═══
 *
 * *(« mon feu vient de s'éteindre et je vois toujours sa lumière » — Alexis.)*
 *
 * Le feu a QUATRE lumières : les particules (`FireFx`), la flaque au sol (`FireGroundGlow`),
 * le trou du voile de nuit / le reflet sur l'eau (`WorldScene.litFires`), et le point light
 * qui sculpte les VOLUMES (ici). Les trois premières consultaient `fireStateAt` ; la
 * quatrième, jamais. Un feu qui venait de mourir laissait donc les fûts autour baignés
 * d'ambre au-dessus de bûches froides : le sol s'éteignait, la canopée non.
 *
 * On prouve l'ÉCHELLE (`facteurDuFeu`) sur de VRAIES structures, aux trois états — c'est elle
 * que la boucle de rendu applique, et elle seule décide aussi du `continue` (facteur ≤ 0). Et
 * on prouve que le facteur traverse bien `intensiteDuFeu`, plafond compris : sans ça la marche
 * serait mesurée sur une fonction que personne n'appelle.
 *
 * CE QUI FERAIT ROUGIR (sans quoi ces ✓ ne valent rien) : redonner au feu éteint un facteur
 * non nul, désaccorder la marche des braises entre les couches, ou remonter le facteur AVANT
 * `Math.min(..., PLAFOND_DU_FEU)` — où le plafond le mangerait aux heures sombres.
 */
describe('la lumière d’un feu suit son état', () => {
  const AX = { respiration: false, coeurBlanc: false, lisere: true, compose: true }
  /** Un feu LIBRE (`villageId` 0) : le Foyer, lui, vaut `'lit'` d'office tant que S16 n'est pas
   *  fait — un montage de Foyer rendrait ces tests verts sans rien prouver. */
  const feu = (fuel: Inventory, emberUntil?: number): Structure =>
    ({ id: 1, type: 'fire', tx: 0, ty: 0, villageId: 0, ownerId: 1, access: 'public', hp: 10, fuel, emberUntil }) as Structure

  it('les trois crans : allumé 1, braises 0,4, éteint 0', () => {
    const avecBois = makeInventory(FIRE.FUEL_SLOTS)
    addItems(avecBois, { wood: 3 })
    expect(facteurDuFeu(100, feu(avecBois))).toBe(1)
    // Plus de bois, dans la fenêtre des braises → le cran intermédiaire.
    expect(facteurDuFeu(100, feu(makeInventory(FIRE.FUEL_SLOTS), 150))).toBe(BRAISES_FACTEUR)
    // La fenêtre est passée : ÉTEINT. C'est le cas d'Alexis, et le seul qui doit rendre 0.
    expect(facteurDuFeu(200, feu(makeInventory(FIRE.FUEL_SLOTS), 150))).toBe(0)
  })

  it('le facteur atteint bien l’intensité de la source — plafond compris', () => {
    // Balayage de la journée : la marche doit tenir à TOUTE heure, y compris là où le plafond
    // mord (nuit + liseré), et pas seulement à l'heure choisie par le test.
    const fautes: string[] = []
    for (let h = 0; h < 24; h += 0.25) {
      const d = daylight(h)
      const allume = intensiteDuFeu(d, 0.5, 1, AX, 1)
      if (intensiteDuFeu(d, 0.5, 1, AX, 0) !== 0) fautes.push(`${h} h : éteint éclaire encore`)
      if (Math.abs(intensiteDuFeu(d, 0.5, 1, AX, BRAISES_FACTEUR) - allume * BRAISES_FACTEUR) > 1e-9) {
        fautes.push(`${h} h : les braises ne valent pas ${BRAISES_FACTEUR} × l’allumé`)
      }
      if (!(allume > 0)) fautes.push(`${h} h : l’allumé n’éclaire pas — la sonde ne mesure rien`)
    }
    expect(fautes).toEqual([])
  })
})
