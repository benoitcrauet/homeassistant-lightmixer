# Light Mixer — Home Assistant Custom Integration

A virtual **3-channel light mixer** for Home Assistant, inspired by broadcast and stage lighting consoles. It exposes three virtual light sources (layers), lets you weight them independently, and sends the blended result to any physical light entity.

---

## Features

- **3 virtual input layers** — each is a full HA `LightEntity` you can control like any light (automations, voice, dashboard)
- **Per-layer fader** (weight 0 → 1) to dial in each layer's contribution
- **7 mix modes** — from live mix to hard priority switching
- **3 layer types** — Full (RGB + color temp), Color Temp only, Dim only
- **HTP brightness mixing** — Highest Takes Precedence, identical to stage consoles; no discontinuity artefacts
- **Weighted colour blending** — output colour is the contribution-weighted average of all active layers
- **Tally indicators** — binary sensors that tell you which layer is actually routed to the output
- **Read-only output mirror** — a virtual light that reflects the computed mix for debugging
- **Destination status sensor** — real-time state tracking of the physical target light
- **Reset button** — restores all layers and faders to defaults in one tap
- **Custom Lovelace card** — visual mixer with configurable layout (vertical / horizontal), arc brightness gauges, tally LEDs, and an SVG routing diagram

---

## Architecture

```
LightMixerSource (layer1) ──[weight1]──┐
LightMixerSource (layer2) ──[weight2]──┼──→ LightMixerCoordinator ──→ light.turn_on (destination)
LightMixerSource (layer3) ──[weight3]──┘         │
                                                  ├── LightMixerOutput     (read-only mirror)
LightMixerModeSelect       ────────────────────→  └── LightMixerDestinationSensor
LightMixerPriorityOrder    ────────────────────→
```

The **coordinator** is the single source of truth. Every entity (layers, weights, mode, priority) reports its state to the coordinator, which recomputes the mix and fires a single `light.turn_on` / `light.turn_off` service call against the destination.

---

## Installation

### Manual

1. Copy the `custom_components/light_mixer/` folder into your HA config:
   ```
   /config/custom_components/light_mixer/
   ```
2. Copy `www/light-mixer-card.js` into your HA www folder:
   ```
   /config/www/light-mixer-card.js
   ```
3. Restart Home Assistant (required the first time to discover all platforms).

### HACS *(not yet listed)*

The integration is not yet in the HACS default repository. You can add it as a custom repository:

1. HACS → Integrations → ⋮ → Custom repositories
2. URL: `https://github.com/benoitcrauet/light-mixer`
3. Category: **Integration**

---

## Setup

1. **Settings → Devices & Services → Add Integration → Light Mixer**
2. Fill in:
   | Field | Description |
   |---|---|
   | **Name** | Display name for this mixer instance (e.g. `Living Room`) |
   | **Destination** | The physical light entity to control |
3. Click **Submit** — the device and all entities are created immediately.

> You can create multiple independent mixer instances (one per room, one per fixture, etc.).

---

## Lovelace Card

### Register the resource

**Settings → Dashboards → ⋮ → Resources → Add**

| Field | Value |
|---|---|
| URL | `/local/light-mixer-card.js` |
| Resource type | JavaScript module |

### Add the card

```yaml
type: custom:light-mixer-card
device_id: <device_id>   # Settings → Devices → Light Mixer → [instance] → URL (last segment)
```

### Full configuration

```yaml
type: custom:light-mixer-card
device_id: <device_id>
layout: vertical          # 'vertical' (default) or 'horizontal'
show_weights: true        # show per-layer fader sliders
show_mode: true           # show the mode selector
show_priority: true       # show the priority order selector
show_tally: true          # show tally LEDs on layer icons
show_reset: true          # show the Reset button
clickable_inputs: true    # clicking a layer opens its HA dialog
clickable_output: true    # clicking the output opens the destination light dialog
```

The card auto-discovers all entities belonging to the device — no manual entity mapping needed.

---

## Mix Modes

| Mode | Description |
|---|---|
| **mix** | **HTP brightness** (highest fader×brightness wins) + **weighted colour blend** across all ON layers. No discontinuity at fader=0. |
| **last_set** | The most recently changed layer has full control. |
| **priority** | Layers are evaluated in the configured priority order; the first ON layer wins. |
| **layer1 / layer2 / layer3** | Hard-route output to exactly that layer, ignoring everything else. |
| **off** | Always turn the destination off. |

### HTP brightness — why?

Classic stage consoles use **Highest Takes Precedence** for intensity: the layer with the highest effective contribution (`fader × brightness`) determines the output level. Averaging over active layers causes an artefact — when a fader slides to exactly 0 the layer drops out of the average, making the output *jump* upward. HTP is monotone so there is no such discontinuity.

Colour is still blended as a contribution-weighted average, so you get smooth colour transitions while brightness behaves predictably.

---

## Layer Types

Each layer can be restricted to a subset of colour capabilities, matching the type of fixture or automation behind it:

| Type | Exposed colour modes | Typical use |
|---|---|---|
| **full** | RGB + Color temperature | Any colour-capable light |
| **color_temp** | Color temperature only | Tunable white fixtures |
| **dim** | Brightness only | Single-channel dimmers |

Change a layer's type via **Settings → Devices → Light Mixer → [instance] → Layer N type**.

---

## Entities

Each mixer instance creates the following entities:

| Entity | Type | Description |
|---|---|---|
| `light.<name>_layer1/2/3` | Light | Virtual input sources — control like any HA light |
| `light.<name>_output` | Light (read-only) | Mirror of the computed mix output |
| `number.<name>_weight_layer1/2/3` | Number (0–1) | Per-layer fader |
| `number.<name>_mix_transition` | Number (s) | Transition duration sent to the destination |
| `select.<name>_mode` | Select | Mix algorithm |
| `select.<name>_priority_order` | Select | Layer priority order (6 permutations) |
| `select.<name>_destination` | Select | Target physical light (can be changed at runtime) |
| `select.<name>_layer1/2/3_type` | Select | Layer capability type |
| `binary_sensor.<name>_layer1/2/3_tally` | Binary sensor | ON when the layer is routed to the output |
| `sensor.<name>_destination_status` | Sensor | Real-time state of the physical destination light |
| `button.<name>_reset` | Button | Reset all layers + faders to defaults |

### Tally logic (per mode)

| Mode | Tally ON condition |
|---|---|
| `mix` | Layer is ON **and** fader > 0 |
| `last_set` | Layer was the last to be modified |
| `priority` | Layer is the highest-priority ON layer |
| `layer1/2/3` | Only that specific layer |
| `off` | Never |

---

## Automation examples

### Follow a schedule (layer 1 = warm evening light)

```yaml
automation:
  - alias: Evening warm light
    trigger:
      - platform: sun
        event: sunset
    action:
      - service: light.turn_on
        target:
          entity_id: light.living_room_layer1
        data:
          color_temp_kelvin: 2700
          brightness_pct: 80
```

### Emergency override via priority mode

```yaml
automation:
  - alias: Alert — full red
    trigger:
      - platform: state
        entity_id: binary_sensor.alarm
        to: "on"
    action:
      - service: select.select_option
        target:
          entity_id: select.living_room_mode
        data:
          option: layer3
      - service: light.turn_on
        target:
          entity_id: light.living_room_layer3
        data:
          rgb_color: [255, 0, 0]
          brightness_pct: 100
```

---

## Development

```bash
# Clone
git clone https://github.com/benoitcrauet/light-mixer.git
cd light-mixer

# Python environment (outside the sync folder to avoid conflicts)
python3 -m venv venv
source venv/bin/activate
pip install homeassistant   # for type stubs and autocompletion

# Serve the Lovelace card locally for development
python3 -m http.server 7821 --directory www
# Card available at http://localhost:7821/light-mixer-card.js
```

### Deployment (HA Supervised)

```bash
# Copy integration
scp -r custom_components/light_mixer/ ha:/config/custom_components/

# Copy card
scp www/light-mixer-card.js ha:/config/www/

# Then in HA: Settings → Integrations → Light Mixer → ⋮ → Reload
# (full restart only needed when adding new platform files)
```

---

## Project structure

```
custom_components/light_mixer/
├── __init__.py          # Integration setup, hass.data registration
├── coordinator.py       # Core: state aggregation + mix computation + HA service calls
├── light.py             # Virtual input layers + read-only output entity
├── number.py            # Weight sliders + transition duration
├── select.py            # Mode, priority order, destination, layer type selectors
├── binary_sensor.py     # Tally indicators
├── sensor.py            # Destination status sensor
├── button.py            # Reset button
├── config_flow.py       # UI config flow (name + destination)
├── const.py             # All constants and mode/type definitions
├── manifest.json
├── strings.json
└── translations/
    ├── en.json
    └── fr.json

www/
└── light-mixer-card.js  # Custom Lovelace card (single file, no build step)
```

---

## License

MIT
