#!/usr/bin/env node
// Régénère `docs/decisions.md` — l'index du journal des décisions.
//
// Le journal est découpé par THÈME (docs/decisions/*.md), mais les ~90 renvois du code et des
// docs citent une DATE (« voir docs/decisions.md, 2026-07-05 »), jamais un fichier. L'index
// chronologique est ce qui garde ces renvois résolubles : un `grep` de la date y donne le thème.
//
// Usage : node tools/decisions-index.mjs   (après avoir ajouté une entrée dans son fichier de thème)

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs')

/** Les cinq volets, dans l'ordre où ils s'affichent. La lettre est la clef de l'index. */
const VOLETS = [
  { lettre: 'M', fichier: 'monde-worldgen', nom: 'Monde & worldgen', quoi: 'worldgen, relief, eau, biomes, lieux, cendre, étages' },
  { lettre: 'R', fichier: 'rendu-da', nom: 'Rendu & DA', quoi: 'lumière, couleur, sprites, FX, art du sol, son' },
  { lettre: 'G', fichier: 'gameplay-systemes', nom: 'Gameplay & systèmes', quoi: 'faune, combat, récolte, craft, saisons, météo, construction, design' },
  { lettre: 'I', fichier: 'interface-outillage', nom: 'Interface & outillage', quoi: 'HUD, menus, encyclopédie, carte, smoke, bancs, process' },
  { lettre: 'A', fichier: 'architecture-infra', nom: 'Architecture & infra', quoi: 'pureté et déterminisme de /sim, protocole, serveur, persistance, perf' },
]

/** Une entrée = une ligne `- AAAA-MM-JJ — …` ou un bloc `## AAAA-MM-JJ — …`. */
const DATEE = /^(- |## )(20\d\d-\d\d-\d\d) — (.*)$/

/** L'intitulé lisible : on retire le crochet de domaine et le gras, on borne la longueur. */
function intitule(reste) {
  const sansTag = reste.replace(/^\[[^\]]*\]\s*/, '')
  const texte = (sansTag || reste).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
  return texte.length > 96 ? texte.slice(0, 95).trimEnd() + '…' : texte
}

const entrees = []
let octets = 0
for (const v of VOLETS) {
  const brut = readFileSync(join(DOCS, 'decisions', `${v.fichier}.md`), 'utf8')
  v.octets = Buffer.byteLength(brut)
  v.n = 0
  octets += v.octets
  for (const ligne of brut.split('\n')) {
    const m = DATEE.exec(ligne)
    if (!m) continue
    v.n++
    entrees.push({ date: m[2], lettre: v.lettre, titre: intitule(m[3]) })
  }
}

// Tri chronologique STABLE : à date égale, on garde l'ordre de lecture des volets.
entrees.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

const ko = (o) => `${Math.round(o / 1024)} Ko`
const tableau = [
  '| | Volet | Ce qu\'on y trouve | Entrées | Poids |',
  '|---|---|---|---|---|',
  ...VOLETS.map((v) => `| **${v.lettre}** | [${v.nom}](decisions/${v.fichier}.md) | ${v.quoi} | ${v.n} | ${ko(v.octets)} |`),
].join('\n')

const sortie = `# Journal des décisions

ADR léger : une ligne par décision, en ajout seul (on ne réécrit pas l'histoire ; une décision annulée est notée comme nouvelle décision). Les **14 décisions fondatrices** sont dans \`ashes-gdd.md\` §14 — ce journal commence après elles.

Format : \`AAAA-MM-JJ — [domaine] Décision. (pourquoi, en quelques mots)\`

**Le journal est découpé par THÈME** (2026-09-07) : les entrées vivent dans \`docs/decisions/\`, cinq
volets, chacun en ajout seul et en ordre chronologique. Ce fichier-ci est l'INDEX.

${tableau}

**Où ajouter une entrée neuve** : à la fin du volet qui lui correspond, puis
\`node tools/decisions-index.mjs\` pour régénérer cet index — ne pas l'éditer à la main.

**Où retrouver une décision** : les renvois du code citent une date (« voir \`docs/decisions.md\`,
2026-07-05 »). \`grep 2026-07-05 docs/decisions.md\` donne les entrées de ce jour, intitulé compris ;
la lettre de la ligne qui correspond donne le volet, donc le fichier. Un jour chargé en aligne
plusieurs — le jour fondateur en compte 41 — et l'index les groupe **par volet**, pas dans l'ordre
du journal d'origine.

⚠ **Les renvois de voisinage ne survivent pas à la coupe.** 32 entrées disent « ci-dessus », « le
correctif précédent », « SUPERSEDE l'entrée ci-dessus » — la supersession s'encodait par la position
dans la colonne unique. Pour 11 d'entre elles, l'antécédent est parti dans un autre volet : il se
retrouve ici, à la même date, jamais à la ligne du dessus dans son volet.

---

## Index chronologique — ${entrees.length} entrées, ${ko(octets)}

${entrees.map((e) => `- ${e.date} · **${e.lettre}** · ${e.titre}`).join('\n')}
`

writeFileSync(join(DOCS, 'decisions.md'), sortie)
console.log(`docs/decisions.md régénéré — ${entrees.length} entrées, ${VOLETS.length} volets, ${ko(Buffer.byteLength(sortie))}`)
