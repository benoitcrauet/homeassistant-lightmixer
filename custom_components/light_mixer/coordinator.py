from __future__ import annotations

from homeassistant.components.light import ColorMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.util.color import color_temperature_to_rgb

from .const import (
    CONF_DESTINATION,
    DEFAULT_LAYER_TYPE,
    DEFAULT_PRIORITY_ORDER,
    LAYER_TYPE_COLOR_TEMP,
    LAYER_TYPE_DIM,
    MODE_LAST_SET,
    MODE_LAYER1, MODE_LAYER2, MODE_LAYER3,
    MODE_MIX,
    MODE_OFF,
    MODE_PRIORITY,
)

# Template for a freshly initialised layer — always copy with dict(), never mutate directly
_DEFAULT_LAYER: dict = {
    "is_on": False,
    "color_mode": ColorMode.COLOR_TEMP,
    "rgb_color": (255, 255, 255),
    "color_temp_kelvin": 4000,
    "brightness": 255,
}

_MIX_MODES = (MODE_MIX,)


class LightMixerCoordinator:
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry_id = entry.entry_id
        self.name = entry.title
        self.destination: str = entry.data.get(CONF_DESTINATION, "")

        self._layer1: dict = dict(_DEFAULT_LAYER)
        self._layer2: dict = dict(_DEFAULT_LAYER)
        self._layer3: dict = dict(_DEFAULT_LAYER)

        self._weight1: float = 1.0
        self._weight2: float = 1.0
        self._weight3: float = 1.0

        self._type1: str = DEFAULT_LAYER_TYPE
        self._type2: str = DEFAULT_LAYER_TYPE
        self._type3: str = DEFAULT_LAYER_TYPE

        self._mode: str = MODE_MIX
        self._priority_order: str = DEFAULT_PRIORITY_ORDER
        self._last_set: str = "layer1"
        self._mix_transition: float = 1.0

        self._listeners: list = []
        self._reset_listeners: list = []

        # Serialise service calls: only one async_apply in flight at a time.
        # If state changes while a call is pending, _apply_dirty triggers a re-run
        # immediately after the current call completes, using the latest state.
        self._apply_running: bool = False
        self._apply_dirty: bool = False
        self._apply_transition: float | None = None

    # ── State updates ─────────────────────────────────────────────────────────

    def update_source(
        self,
        side: str,
        is_on: bool,
        color_mode: str | None = None,
        rgb_color: tuple[int, int, int] | None = None,
        color_temp_kelvin: int | None = None,
        brightness: int | None = None,
    ) -> None:
        state = {"layer1": self._layer1, "layer2": self._layer2, "layer3": self._layer3}[side]
        state["is_on"] = is_on
        if color_mode is not None:
            state["color_mode"] = color_mode
        if rgb_color is not None:
            state["rgb_color"] = rgb_color
        if color_temp_kelvin is not None:
            state["color_temp_kelvin"] = color_temp_kelvin
        if brightness is not None:
            state["brightness"] = brightness
        # Always track the last-touched layer, even on turn_off, for MODE_LAST_SET
        self._last_set = side
        self._notify_listeners()

    def update_weight(self, layer: str, value: float) -> None:
        if layer == "layer1":
            self._weight1 = value
        elif layer == "layer2":
            self._weight2 = value
        elif layer == "layer3":
            self._weight3 = value
        self._notify_listeners()

    def update_mode(self, mode: str) -> None:
        self._mode = mode
        self._notify_listeners()

    def update_priority_order(self, order: str) -> None:
        self._priority_order = order
        self._notify_listeners()

    def update_destination(self, entity_id: str) -> None:
        self.destination = entity_id
        self._notify_listeners()

    def update_mix_transition(self, value: float) -> None:
        self._mix_transition = value

    def update_layer_type(self, layer: str, layer_type: str) -> None:
        if layer == "layer1":
            self._type1 = layer_type
        elif layer == "layer2":
            self._type2 = layer_type
        elif layer == "layer3":
            self._type3 = layer_type
        # Align the stored color_mode with the new type constraints
        state = {"layer1": self._layer1, "layer2": self._layer2, "layer3": self._layer3}[layer]
        if layer_type == LAYER_TYPE_DIM:
            state["color_mode"] = ColorMode.BRIGHTNESS
            state["rgb_color"] = (255, 255, 255)
        elif layer_type == LAYER_TYPE_COLOR_TEMP:
            if state["color_mode"] == ColorMode.RGB:
                state["color_mode"] = ColorMode.COLOR_TEMP
        self._notify_listeners()

    def get_layer_type(self, layer: str) -> str:
        return {"layer1": self._type1, "layer2": self._type2, "layer3": self._type3}[layer]

    # ── Listeners ─────────────────────────────────────────────────────────────

    def register_listener(self, callback) -> None:
        self._listeners.append(callback)

    def unregister_listener(self, callback) -> None:
        if callback in self._listeners:
            self._listeners.remove(callback)

    def register_reset_listener(self, callback) -> None:
        self._reset_listeners.append(callback)

    def unregister_reset_listener(self, callback) -> None:
        if callback in self._reset_listeners:
            self._reset_listeners.remove(callback)

    def _notify_listeners(self) -> None:
        for callback in self._listeners:
            callback()

    # ── Reset ─────────────────────────────────────────────────────────────────

    async def async_reset_inputs(self) -> None:
        """Reset layers and weights to defaults. Mode, priority order, destination and transition are untouched."""
        self._layer1 = dict(_DEFAULT_LAYER)
        self._layer2 = dict(_DEFAULT_LAYER)
        self._layer3 = dict(_DEFAULT_LAYER)
        self._weight1 = 1.0
        self._weight2 = 1.0
        self._weight3 = 1.0
        self._last_set = "layer1"
        for callback in self._reset_listeners:
            callback()
        self._notify_listeners()
        await self.async_apply()

    # ── Tally (routing-based) ─────────────────────────────────────────────────

    def _get_priority_layers(self) -> list[str]:
        mapping = {"L1": "layer1", "L2": "layer2", "L3": "layer3"}
        return [mapping[x] for x in self._priority_order.split(">")]

    def _priority_winner(self) -> str | None:
        states = {"layer1": self._layer1, "layer2": self._layer2, "layer3": self._layer3}
        for layer in self._get_priority_layers():
            if states[layer]["is_on"]:
                return layer
        return None

    def _tally(self, layer: str) -> bool:
        if self._mode == MODE_OFF:
            return False
        if self._mode in _MIX_MODES:
            weight = {"layer1": self._weight1, "layer2": self._weight2, "layer3": self._weight3}[layer]
            state = {"layer1": self._layer1, "layer2": self._layer2, "layer3": self._layer3}[layer]
            return weight > 0 and state["is_on"]
        if self._mode == MODE_LAST_SET:
            return self._last_set == layer
        if self._mode == MODE_PRIORITY:
            return self._priority_winner() == layer
        return self._mode == layer  # layer1 / layer2 / layer3 solo modes

    @property
    def is_layer1_active(self) -> bool:
        return self._tally("layer1")

    @property
    def is_layer2_active(self) -> bool:
        return self._tally("layer2")

    @property
    def is_layer3_active(self) -> bool:
        return self._tally("layer3")

    # ── Apply output ──────────────────────────────────────────────────────────

    async def async_apply(self, transition: float | None = None) -> None:
        """Compute the mix and push it to the destination light.

        Serialised: only one service call in flight at a time. If state changes
        during an active call, the loop reruns immediately after with the latest
        state rather than firing a concurrent call that could arrive out of order.
        """
        if not self.destination:
            return

        if self._apply_running:
            self._apply_dirty = True
            self._apply_transition = transition
            return

        self._apply_running = True
        current_transition = transition
        try:
            while True:
                self._apply_dirty = False
                result = self._compute_mix()

                if result is None:
                    await self.hass.services.async_call(
                        "light", "turn_off", {"entity_id": self.destination}
                    )
                else:
                    data: dict = {"entity_id": self.destination, "brightness": result["brightness"]}
                    if "color_temp_kelvin" in result:
                        data["color_temp_kelvin"] = result["color_temp_kelvin"]
                    else:
                        data["rgb_color"] = result["rgb_color"]
                    if current_transition is not None and current_transition > 0:
                        data["transition"] = current_transition
                    await self.hass.services.async_call("light", "turn_on", data)

                if not self._apply_dirty:
                    break
                current_transition = self._apply_transition
        finally:
            self._apply_running = False
            self._apply_dirty = False

    # ── Mix computation ───────────────────────────────────────────────────────

    def _source_output(self, state: dict) -> dict | None:
        if not state["is_on"]:
            return None
        result: dict = {"brightness": state["brightness"]}
        if state["color_mode"] == ColorMode.COLOR_TEMP:
            result["color_temp_kelvin"] = state["color_temp_kelvin"]
        else:
            result["rgb_color"] = state["rgb_color"]
        return result

    def _effective_rgb(self, state: dict) -> tuple[float, float, float]:
        """Return brightness-scaled RGB (0–255 range) for colour blending."""
        if not state["is_on"]:
            return (0.0, 0.0, 0.0)
        br = state["brightness"] / 255
        if state["color_mode"] == ColorMode.COLOR_TEMP:
            r, g, b = color_temperature_to_rgb(state["color_temp_kelvin"])
        else:
            r, g, b = state["rgb_color"]
        return (r * br, g * br, b * br)

    def _compute_mix(self) -> dict | None:  # noqa: C901
        if self._mode == MODE_OFF:
            return None

        if self._mode == MODE_LAYER1:
            return self._source_output(self._layer1)
        if self._mode == MODE_LAYER2:
            return self._source_output(self._layer2)
        if self._mode == MODE_LAYER3:
            return self._source_output(self._layer3)

        if self._mode == MODE_LAST_SET:
            state = {"layer1": self._layer1, "layer2": self._layer2, "layer3": self._layer3}[self._last_set]
            return self._source_output(state)

        if self._mode == MODE_PRIORITY:
            for layer in self._get_priority_layers():
                state = {"layer1": self._layer1, "layer2": self._layer2, "layer3": self._layer3}[layer]
                result = self._source_output(state)
                if result is not None:
                    return result
            return None

        # ── mix: HTP brightness + weighted colour blend ───────────────────────
        # eff_i          = fader_i × brightness_i
        # brightness_out = max(eff_i)                 — HTP, no discontinuity at fader=0
        # color_out      = contribution-weighted average of each layer's colour
        #
        # All ON layers are in the pool regardless of fader; fader=0 → eff=0 and
        # can never win the max, so the result is continuous at the boundary.
        all_layers = [
            (self._layer1, self._weight1),
            (self._layer2, self._weight2),
            (self._layer3, self._weight3),
        ]
        on_layers = [(s, w) for s, w in all_layers if s["is_on"]]

        if not on_layers:
            return None

        eff = [(s["brightness"] * w, s) for s, w in on_layers]
        total_eff = sum(e for e, _ in eff)

        if total_eff == 0:
            return None

        # HTP: the layer with the highest effective contribution sets the brightness
        mixed_brightness = round(max(e for e, _ in eff))
        if mixed_brightness < 1:
            return None

        # Colour: weighted average; pure color_temp path avoids an RGB round-trip
        all_color_temp = all(s["color_mode"] == ColorMode.COLOR_TEMP for _, s in eff)

        if all_color_temp:
            mixed_temp = round(sum(
                s["color_temp_kelvin"] * e / total_eff for e, s in eff
            ))
            return {"color_temp_kelvin": mixed_temp, "brightness": mixed_brightness}

        out_r = out_g = out_b = 0.0
        for e, s in eff:
            cw = e / total_eff
            if s["color_mode"] == ColorMode.COLOR_TEMP:
                r, g, b = color_temperature_to_rgb(s["color_temp_kelvin"])
            else:
                r, g, b = s["rgb_color"]
            out_r += cw * r
            out_g += cw * g
            out_b += cw * b

        # Normalise to 0–255 by dividing by the peak channel, preserving hue
        peak = max(out_r, out_g, out_b)
        if peak == 0:
            return None

        return {
            "rgb_color": (
                round(out_r / peak * 255),
                round(out_g / peak * 255),
                round(out_b / peak * 255),
            ),
            "brightness": mixed_brightness,
        }
