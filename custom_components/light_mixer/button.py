from __future__ import annotations

from homeassistant.components.button import ButtonEntity
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
    async_add_entities([LightMixerResetButton(coordinator)])


class LightMixerResetButton(ButtonEntity):
    _attr_has_entity_name = True
    _attr_name = "Reset all inputs"
    _attr_should_poll = False

    def __init__(self, coordinator: LightMixerCoordinator) -> None:
        self._coordinator = coordinator
        self._attr_unique_id = f"{coordinator.entry_id}_reset"

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._coordinator.entry_id)},
            name=self._coordinator.name,
        )

    async def async_press(self) -> None:
        await self._coordinator.async_reset_inputs()
