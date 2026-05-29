from __future__ import annotations

from homeassistant.components.number import NumberEntity, NumberMode
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
        LightMixerWeight(coordinator, "layer1"),
        LightMixerWeight(coordinator, "layer2"),
        LightMixerWeight(coordinator, "layer3"),
        LightMixerTransition(coordinator),
    ])


class LightMixerWeight(NumberEntity, RestoreEntity):
    """Per-layer fader (0.0 → 1.0) that scales the layer's contribution to the mix."""

    _attr_has_entity_name = True
    _attr_native_min_value = 0.0
    _attr_native_max_value = 1.0
    _attr_native_step = 0.01
    _attr_mode = NumberMode.SLIDER
    _attr_should_poll = False
    _attr_native_value = 1.0

    def __init__(self, coordinator: LightMixerCoordinator, layer: str) -> None:
        self._coordinator = coordinator
        self._layer = layer
        self._attr_unique_id = f"{coordinator.entry_id}_weight_{layer}"
        num = layer[-1]
        self._attr_name = f"Layer {num} fader"

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._coordinator.entry_id)},
            name=self._coordinator.name,
        )

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self._coordinator.register_reset_listener(self._on_reset)
        last_state = await self.async_get_last_state()
        if last_state and last_state.state not in ("unknown", "unavailable"):
            self._attr_native_value = float(last_state.state)
            self._coordinator.update_weight(self._layer, self._attr_native_value)

    async def async_will_remove_from_hass(self) -> None:
        self._coordinator.unregister_reset_listener(self._on_reset)

    def _on_reset(self) -> None:
        self._attr_native_value = 1.0
        self.async_write_ha_state()

    async def async_set_native_value(self, value: float) -> None:
        self._attr_native_value = value
        self._coordinator.update_weight(self._layer, value)
        self.async_write_ha_state()
        # 0.0 becomes None so the transition kwarg is omitted entirely from the service call
        await self._coordinator.async_apply(
            transition=self._coordinator._mix_transition or None
        )


class LightMixerTransition(NumberEntity, RestoreEntity):
    """Default transition duration applied to every mix output call."""

    _attr_has_entity_name = True
    _attr_name = "Mix transition"
    _attr_native_min_value = 0.0
    _attr_native_max_value = 10.0
    _attr_native_step = 0.1
    _attr_native_unit_of_measurement = "s"
    _attr_mode = NumberMode.BOX
    _attr_should_poll = False
    _attr_native_value = 1.0

    def __init__(self, coordinator: LightMixerCoordinator) -> None:
        self._coordinator = coordinator
        self._attr_unique_id = f"{coordinator.entry_id}_mix_transition"

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._coordinator.entry_id)},
            name=self._coordinator.name,
        )

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state and last_state.state not in ("unknown", "unavailable"):
            self._attr_native_value = float(last_state.state)
            self._coordinator.update_mix_transition(self._attr_native_value)

    async def async_set_native_value(self, value: float) -> None:
        self._attr_native_value = value
        self._coordinator.update_mix_transition(value)
        self.async_write_ha_state()
