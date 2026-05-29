from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .coordinator import LightMixerCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: LightMixerCoordinator = hass.data[DOMAIN][entry.entry_id]
    entities = [
        LightMixerTally(coordinator, "layer1"),
        LightMixerTally(coordinator, "layer2"),
        LightMixerTally(coordinator, "layer3"),
    ]
    async_add_entities(entities)

    # Single callback drives all three tallies; avoids three separate listener registrations
    def on_state_change() -> None:
        for entity in entities:
            entity.async_write_ha_state()

    coordinator.register_listener(on_state_change)


class LightMixerTally(BinarySensorEntity):
    """ON when the layer is actively routed to the output (mode-dependent)."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_icon = "mdi:record-circle"

    def __init__(self, coordinator: LightMixerCoordinator, layer: str) -> None:
        self._coordinator = coordinator
        self._layer = layer
        self._attr_unique_id = f"{coordinator.entry_id}_{layer}_tally"
        self._attr_name = f"{layer.capitalize()} tally"

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._coordinator.entry_id)},
            name=self._coordinator.name,
        )

    @property
    def is_on(self) -> bool:
        return {
            "layer1": self._coordinator.is_layer1_active,
            "layer2": self._coordinator.is_layer2_active,
            "layer3": self._coordinator.is_layer3_active,
        }[self._layer]
