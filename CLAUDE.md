# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projet

**Light Mixer** est une intégration custom Home Assistant qui crée un mélangeur de lumières virtuel 3 canaux (comme une régie vidéo/lumière). Elle expose trois sources de lumière virtuelles (layer1, layer2, layer3) avec des sliders de poids indépendants, calcule un mix selon le mode choisi, et envoie le résultat vers une lumière physique de destination.

## Environnement de développement

```bash
# Activer le venv (Python 3.13)
source venv/bin/activate

# Le venv contient homeassistant pour l'autocomplétion et les types
pip install homeassistant
```

Le dossier est synchronisé via SynologyDrive — **ne pas stocker le venv dans le dossier synchronisé** (risque de wipe au conflit de sync).

## Déploiement

L'intégration tourne sur un Home Assistant Supervised distant. Le dossier à copier est `custom_components/light_mixer/` vers `/config/custom_components/light_mixer/` sur le HA.

Après modification des fichiers : **Paramètres → Intégrations → Light Mixer → ⋮ → Recharger** (pas besoin de reboot complet, sauf ajout de nouveaux fichiers de plateforme).

**Si ajout d'un nouveau fichier de plateforme** (ex: `sensor.py`) : reboot complet nécessaire car HA doit découvrir la nouvelle plateforme.

## Architecture

### Flux de données

```
LightMixerSource (layer1) ──[weight1]──┐
LightMixerSource (layer2) ──[weight2]──┤──→ LightMixerCoordinator ──→ light.turn_on (destination)
LightMixerSource (layer3) ──[weight3]──┤         ↑                          ↓
LightMixerModeSelect       ────────────┘    _compute_mix()         LightMixerOutput (RO mirror)
LightMixerPriorityOrder    ────────────┘                           LightMixerDestinationSensor
```

Le **coordinator** (`coordinator.py`) est le cœur : il centralise l'état de toutes les entrées, calcule le mix, et appelle le service `light.turn_on`/`turn_off` sur la lumière de destination.

### Entités créées par instance

| Fichier | Entité | Type | Rôle |
|---|---|---|---|
| `light.py` | Layer1, Layer2, Layer3 | `LightEntity` | Sources virtuelles RGB + color temp |
| `light.py` | Output | `LightEntity` (RO) | Miroir lecture seule du résultat calculé |
| `number.py` | Weight Layer1/2/3 | `NumberEntity` | Poids de mixage 0.0→1.0 (défaut 1.0) |
| `number.py` | Mix transition | `NumberEntity` | Durée de transition (défaut 1s) |
| `select.py` | Mode | `SelectEntity` | Algorithme de mix (9 modes) |
| `select.py` | Priority order | `SelectEntity` | Ordre de priorité entre layers (6 permutations) |
| `select.py` | Destination | `SelectEntity` | Lumière physique cible (dynamique) |
| `binary_sensor.py` | Layer1/2/3 Tally | `BinarySensorEntity` | ON si le layer est routé vers la sortie |
| `sensor.py` | Destination status | `SensorEntity` | État temps réel de la lumière destination |
| `button.py` | Reset all inputs | `ButtonEntity` | Reset layers + poids à leurs valeurs d'init |

### Algorithme de mix (`coordinator._compute_mix`)

**Mode `mix` — HTP brightness + moyenne pondérée couleur :**
- `eff_i = fader_i × brightness_i`
- Brightness : `max(eff_i)` sur tous les layers ON — **HTP (Highest Takes Precedence)**
- Couleur : moyenne pondérée RGB par `eff_i / Σ(eff_i)` — inchangé
- Pool = tous les layers `is_on=True` (fader=0 → eff=0, ne peut pas gagner le max → zéro discontinuité)
- Un layer OFF n'impacte pas le mix ; un layer ON à fader=0 est muté mais présent dans le pool
- Exemples : 3×100% f=1 → 100% ; seul layer 100% f=0.5 → 50% ; L1=100% f=1 + L2=100% f=0 → 100% (HTP)

**Mode `last_set` :**
- La source modifiée en dernier a le contrôle total

**Mode `priority` :**
- Selon l'ordre défini dans `priority_order` ; le premier layer ON prend le contrôle

**Modes `layer1` / `layer2` / `layer3` :**
- Force la sortie sur ce seul layer, quel que soit son poids

**Mode `off` :**
- Toujours éteindre la destination

### Tally (routing-based)

Un layer est considéré actif (tally ON) si sa contribution est non nulle dans la sortie finale :
- Mode `mix` : tally ON si `fader > 0` ET layer ON
- Mode `last_set` : seul le dernier layer modifié a tally ON
- Mode `priority` : seul le layer prioritaire actif a tally ON
- Mode `layerX` : seul ce layer a tally ON
- Mode `off` : tous les tallys OFF

### Persistance

Toutes les entités utilisent `RestoreEntity` pour survivre aux reboots. Attention : les attributs HA peuvent être `None` pour des champs non applicables (ex: `rgb_color` est `None` quand la lumière était en mode `COLOR_TEMP`). Toujours utiliser `attrs.get("key") is not None` avant d'affecter.

### Mécanisme de callbacks

Le coordinator a deux listes de listeners :
- `_listeners` : appelés à chaque changement d'état actif — utilisés par les `binary_sensor` (tally), `sensor` (destination status) et l'entité `LightMixerOutput`
- `_reset_listeners` : appelés uniquement sur `async_reset_inputs()` — utilisés par les entités light (layer1/2/3) et les weight sliders pour resetter leur état interne et appeler `async_write_ha_state()`

Les entités s'enregistrent dans `async_added_to_hass` et se désenregistrent dans `async_will_remove_from_hass`.

### Output light (lecture seule)

`LightMixerOutput` est une `LightEntity` en lecture seule qui reflète `coordinator.cached_output` (résultat du dernier `_compute_mix()`). Les appels `turn_on`/`turn_off` sont des no-ops. Utile pour déboguer la chaîne : si l'output montre rouge mais la destination n'est pas rouge, le problème est dans la communication avec la lumière physique.

### Destination status sensor

`LightMixerDestinationSensor` suit l'état en temps réel de la lumière physique destination via `async_track_state_change_event`. Se re-subscribe automatiquement si la destination change. Expose : état (on/off/unavailable/unknown), brightness, couleur RGB, color_temp.

### Destination dynamique

La lumière de destination est sélectionnable via une `SelectEntity` dont les options sont peuplées au setup depuis le registre d'entités HA (toutes les lumières sauf celles de cette instance du mixer). La liste se rafraîchit au rechargement de l'intégration ou au reboot HA.

## Constantes importantes (`const.py`)

```python
MODES = ["mix", "last_set", "priority", "layer1", "layer2", "layer3", "off"]

PRIORITY_ORDERS = ["L1>L2>L3", "L1>L3>L2", "L2>L1>L3",
                   "L2>L3>L1", "L3>L1>L2", "L3>L2>L1"]
DEFAULT_PRIORITY_ORDER = "L1>L2>L3"
```

Les valeurs string des modes sont stockées dans l'état HA (RestoreEntity) — **ne pas les renommer sans migration**.

## Traductions

Fichiers dans `translations/en.json` et `translations/fr.json`. La structure `entity.select.mode.state.*` doit correspondre exactement aux valeurs string des modes dans `const.py`.

## Card Lovelace custom (`www/light-mixer-card.js`)

Fichier à copier vers `/config/www/light-mixer-card.js` sur le HA, puis enregistrer comme ressource Lovelace :
**Paramètres → Tableaux de bord → ⋮ → Ressources → Ajouter** → `/local/light-mixer-card.js` (type : module JavaScript).

### Configuration de la carte

```yaml
type: custom:light-mixer-card
device_id: <device_id de l'instance Light Mixer>   # requis
layout: vertical        # ou 'horizontal'  (défaut: vertical)
show_weights: true      # afficher les sliders de mix (défaut: true)
show_mode: true         # afficher le sélecteur de mode (défaut: true)
show_priority: true     # afficher le sélecteur d'ordre de priorité (défaut: true)
show_tally: true        # afficher les LEDs tally (défaut: true)
show_reset: true        # afficher le bouton reset (défaut: true)
clickable_inputs: true  # clic sur les inputs ouvre le dialog HA (défaut: true)
clickable_output: true  # clic sur l'output ouvre le dialog HA (défaut: true)
```

Le `device_id` se trouve dans : **Paramètres → Appareils et services → Light Mixer → [instance] → URL** (dernier segment).

### Fonctionnement interne

- **Découverte des entités** : la carte itère `hass.entities` en filtrant par `device_id`, puis catégorise par suffix de l'entity_id (`_layer1`, `_layer2`, `_layer3`, `_weight_layer1`, `_mode`, `_priority_order`, `_output`, `_destination_status`, `_layer1_tally`, etc.). Aucune config manuelle des entités n'est nécessaire.
- **SVG dynamique** : forme en coudes angulaires (Option B), 3 branches convergeant vers un trunk commun. Les branches prennent la couleur de leur layer (RGB ou color_temp via `kelvinToRgb`). Le trunk (partie commune) prend la couleur du résultat calculé via `LightMixerOutput`.
- **Tally LEDs** : petite LED rouge (`.tally-dot`) en haut à droite de chaque icône d'input. Allumée si le tally du layer correspondant est ON.
- **Sliders de poids** : `input[type=range]` 0→1. En layout vertical : horizontaux sous chaque layer. En layout horizontal : verticaux (faders). La valeur HA n'est pas mise à jour pendant le drag (`:focus` guard), validée au `change` via `number.set_value`.
- **Clic sur une lumière** → dispatch `hass-more-info` (ouvre le dialog HA natif). Configurable via `clickable_inputs` / `clickable_output`.
- **Bouton Reset** → `button.press` sur l'entité reset du coordinator.
- **Éditeur visuel** : `getConfigElement()` expose un éditeur dans le card picker HA avec auto-découverte des devices Light Mixer disponibles.
- **Enregistrement card picker** : `window.customCards` registration pour apparaître dans "Ajouter une carte".
