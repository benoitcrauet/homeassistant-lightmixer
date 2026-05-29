from __future__ import annotations

from homeassistant.components.light import (
    ATTR_BRIGHTNESS,
    ATTR_COLOR_TEMP_KELVIN,
    ATTR_RGB_COLOR,
    ATTR_TRANSITION,
    ColorMode,
    LightEntity,
)
from .const import LAYER_TYPE_COLOR_TEMP, LAYER_TYPE_DIM
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import DOMAIN
from .coordinator import LightMixerCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: LightMixerCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([
        LightMixerSource(coordinator, "layer1"),
        LightMixerSource(coordinator, "layer2"),
        LightMixerSource(coordinator, "layer3"),
    ])


# ── Virtual input source ───────────────────────────────────────────────────────

class LightMixerSource(LightEntity, RestoreEntity):
    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_min_color_temp_kelvin = 2000
    _attr_max_color_temp_kelvin = 6500

    def __init__(self, coordinator: LightMixerCoordinator, side: str) -> None:
        self._coordinator = coordinator
        self._side = side
        self._attr_unique_id = f"{coordinator.entry_id}_{side}"
        self._attr_name = side.capitalize()
        self._is_on = False
        self._color_mode: str = ColorMode.COLOR_TEMP
        self._brightness: int = 255
        self._rgb_color: tuple[int, int, int] = (255, 255, 255)
        self._color_temp_kelvin: int = 4000

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._coordinator.entry_id)},
            name=self._coordinator.name,
        )

    @property
    def supported_color_modes(self) -> set[str]:
        # Dynamic: depends on the layer type configured in the coordinator
        layer_type = self._coordinator.get_layer_type(self._side)
        if layer_type == LAYER_TYPE_DIM:
            return {ColorMode.BRIGHTNESS}
        if layer_type == LAYER_TYPE_COLOR_TEMP:
            return {ColorMode.COLOR_TEMP}
        return {ColorMode.RGB, ColorMode.COLOR_TEMP}

    @property
    def is_on(self) -> bool:
        return self._is_on

    @property
    def color_mode(self) -> str:
        # If the stored mode is no longer valid (e.g. layer type changed), fall back gracefully
        supported = self.supported_color_modes
        if self._color_mode in supported:
            return self._color_mode
        if ColorMode.COLOR_TEMP in supported:
            return ColorMode.COLOR_TEMP
        return ColorMode.BRIGHTNESS

    @property
    def brightness(self) -> int:
        return self._brightness

    @property
    def rgb_color(self) -> tuple[int, int, int]:
        return self._rgb_color

    @property
    def color_temp_kelvin(self) -> int:
        return self._color_temp_kelvin

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self._coordinator.register_listener(self.async_write_ha_state)
        self._coordinator.register_reset_listener(self._on_reset)
        last_state = await self.async_get_last_state()
        if last_state:
            self._is_on = last_state.state == "on"
            attrs = last_state.attributes
            if attrs.get("color_mode") in {ColorMode.RGB, ColorMode.COLOR_TEMP}:
                self._color_mode = attrs["color_mode"]
            # HA sets colour attributes to None for non-applicable modes, so use `is not None`
            if attrs.get("brightness") is not None:
                self._brightness = attrs["brightness"]
            if attrs.get("rgb_color") is not None:
                self._rgb_color = tuple(attrs["rgb_color"])
            if attrs.get("color_temp_kelvin") is not None:
                self._color_temp_kelvin = attrs["color_temp_kelvin"]
            self._coordinator.update_source(
                self._side,
                self._is_on,
                color_mode=self._color_mode,
                rgb_color=self._rgb_color,
                color_temp_kelvin=self._color_temp_kelvin,
                brightness=self._brightness,
            )

    async def async_will_remove_from_hass(self) -> None:
        self._coordinator.unregister_listener(self.async_write_ha_state)
        self._coordinator.unregister_reset_listener(self._on_reset)

    def _on_reset(self) -> None:
        self._is_on = False
        self._color_mode = ColorMode.COLOR_TEMP
        self._rgb_color = (255, 255, 255)
        self._color_temp_kelvin = 4000
        self._brightness = 255
        self.async_write_ha_state()

    async def async_turn_on(self, **kwargs) -> None:
        self._is_on = True
        layer_type = self._coordinator.get_layer_type(self._side)

        if layer_type == LAYER_TYPE_DIM:
            if ATTR_BRIGHTNESS in kwargs:
                self._brightness = kwargs[ATTR_BRIGHTNESS]
            effective_color_mode = ColorMode.BRIGHTNESS
            self._rgb_color = (255, 255, 255)
        elif layer_type == LAYER_TYPE_COLOR_TEMP:
            if ATTR_COLOR_TEMP_KELVIN in kwargs:
                self._color_temp_kelvin = kwargs[ATTR_COLOR_TEMP_KELVIN]
            if ATTR_BRIGHTNESS in kwargs:
                self._brightness = kwargs[ATTR_BRIGHTNESS]
            self._color_mode = ColorMode.COLOR_TEMP
            effective_color_mode = ColorMode.COLOR_TEMP
        else:
            # Full mode: last-written attribute determines the active color mode
            if ATTR_RGB_COLOR in kwargs:
                self._rgb_color = kwargs[ATTR_RGB_COLOR]
                self._color_mode = ColorMode.RGB
            if ATTR_COLOR_TEMP_KELVIN in kwargs:
                self._color_temp_kelvin = kwargs[ATTR_COLOR_TEMP_KELVIN]
                self._color_mode = ColorMode.COLOR_TEMP
            if ATTR_BRIGHTNESS in kwargs:
                self._brightness = kwargs[ATTR_BRIGHTNESS]
            effective_color_mode = self._color_mode

        if self._brightness is None:
            self._brightness = 255

        self._coordinator.update_source(
            self._side,
            True,
            color_mode=effective_color_mode,
            rgb_color=self._rgb_color,
            color_temp_kelvin=self._color_temp_kelvin,
            brightness=self._brightness,
        )
        self.async_write_ha_state()
        await self._coordinator.async_apply(transition=kwargs.get(ATTR_TRANSITION))

    async def async_turn_off(self, **kwargs) -> None:
        self._is_on = False
        self._coordinator.update_source(self._side, False)
        self.async_write_ha_state()
        await self._coordinator.async_apply(transition=kwargs.get(ATTR_TRANSITION))
