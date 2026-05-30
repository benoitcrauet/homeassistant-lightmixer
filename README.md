# Light Mixer — Home Assistant Integration

🇫🇷 *Version française ci-dessous.*

Light Mixer is a light mixing and routing integration: it exposes 3 independent virtual entities and sends the result to a single physical destination light.

<img width="484" height="314" alt="Screenshot 2026-05-29 at 10 07 14 PM" src="https://github.com/user-attachments/assets/d1394609-d815-48a4-94b7-616dd80d0d5d" /><img width="486" height="318" alt="Screenshot 2026-05-29 at 10 07 25 PM" src="https://github.com/user-attachments/assets/8517d33a-3d0c-4cfc-8b37-1f57d8e644d6" />
<img width="483" height="354" alt="Screenshot 2026-05-29 at 10 09 42 PM" src="https://github.com/user-attachments/assets/10a8f7e2-fdbd-43a8-9459-582e4cdede15" />

## Use case

Designed for combined rooms (e.g. a kitchenette in a living room), Light Mixer prevents scenes from two zones from overriding each other. Each zone controls its own virtual light, and the integration automatically decides what gets sent to the physical light.

## Modes

### Mix
Blends the colors of the 3 virtual lights and sends the result to the destination. Each source is weighted independently via three faders.

### Priority
Automatically routes the active virtual light based on a defined priority order (e.g. L3 > L2 > L1). Among the lights that are on, the highest priority one is always sent to the destination.

### Force
Unconditionally sends a chosen virtual light to the destination, bypassing the automatic routing.

### Off
Forces the destination entity to turn off.

## Lovelace Card

Light Mixer includes a Lovelace card for monitoring the state of your light routers. Optional controls can be enabled to configure the integration directly from the dashboard.

The card file (`light-mixer-card.js`) is automatically copied to `/config/www/` when the integration loads. You only need to register it once as a Lovelace resource:

**Settings → Dashboards → ⋮ → Resources → Add** → `/local/light-mixer-card.js` (type: JavaScript module)

Then add a card with type `custom:light-mixer-card` and set the `device_id` to your Light Mixer instance (found in the device URL).

## Usage tips

- Do not assign a room to the device itself — assign rooms to the 3 virtual entities instead, to avoid conflicts with `light.turn_off` on an entire area.
- Stop sending commands to the physical destination light: let Light Mixer exclusively manage that entity.

---

# Light Mixer — Intégration Home Assistant

Light Mixer est une intégration de mixage et routage de lumières : elle expose 3 entités virtuelles indépendantes et envoie le résultat vers une seule lumière physique de destination.

<img width="484" height="314" alt="Screenshot 2026-05-29 at 10 07 14 PM" src="https://github.com/user-attachments/assets/d1394609-d815-48a4-94b7-616dd80d0d5d" /><img width="486" height="318" alt="Screenshot 2026-05-29 at 10 07 25 PM" src="https://github.com/user-attachments/assets/8517d33a-3d0c-4cfc-8b37-1f57d8e644d6" />
<img width="483" height="354" alt="Screenshot 2026-05-29 at 10 09 42 PM" src="https://github.com/user-attachments/assets/10a8f7e2-fdbd-43a8-9459-582e4cdede15" />

## Cas d'usage

Conçue pour les pièces combinées (ex : kitchenette dans un salon), Light Mixer évite l'écrasement mutuel de scènes entre deux zones. Chaque zone contrôle sa propre lumière virtuelle, et l'intégration décide automatiquement ce qui est envoyé à la lumière physique.

## Modes de fonctionnement

### Mix
Mélange les couleurs des 3 lumières virtuelles et envoie le résultat à la destination. Le dosage de chaque source se règle via trois faders indépendants.

### Priorité
Route automatiquement la lumière virtuelle active selon un ordre de priorité défini (ex : L3 > L2 > L1). Parmi les sources allumées, c'est toujours la plus prioritaire qui est transmise à la destination.

### Forcé
Envoie inconditionnellement une lumière virtuelle choisie vers la destination, sans tenir compte du routage automatique.

### Off
Force l'extinction de l'entité de destination.

## Carte Lovelace

Light Mixer inclut une carte Lovelace de visualisation pour monitorer l'état des routeurs. Des contrôles optionnels peuvent être activés pour configurer l'intégration directement depuis le dashboard.

Le fichier de la carte (`light-mixer-card.js`) est automatiquement copié dans `/config/www/` au chargement de l'intégration. Il suffit de l'enregistrer une seule fois comme ressource Lovelace :

**Paramètres → Tableaux de bord → ⋮ → Ressources → Ajouter** → `/local/light-mixer-card.js` (type : module JavaScript)

Puis ajouter une carte de type `custom:light-mixer-card` avec le `device_id` de votre instance Light Mixer (visible dans l'URL de l'appareil).

## Conseils d'usage

- Ne pas assigner de pièce au device directement, mais aux 3 entités virtuelles — pour éviter les conflits avec `light.turn_off` sur une zone entière.
- Ne plus envoyer de commandes à la lumière physique de destination : laisser Light Mixer gérer exclusivement cette entité.
