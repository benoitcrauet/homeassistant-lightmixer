from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import (
    DEFAULT_LAYER_TYPE,
    DEFAULT_PRIORITY_ORDER,
    DOMAIN,
    LAYER_TYPES,
    MODE_MIX,
    MODES,
    PRIORITY_ORDERS,
)
from .coordinator import LightMixerCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: LightMixerCoordinator = hass.data[DOMAIN][entry.entry_id]

    # Exclude lights belonging to this entry to prevent a mixer routing to itself
    registry = er.async_get(hass)
    light_options = sorted([
        e.entity_id
        for e in registry.entities.values()
        if e.domain == "light" and e.config_entry_id != entry.entry_id
    ])

    async_add_entities([
        LightMixerModeSelect(coordinator),
        LightMixerPriorityOrderSelect(coordinator),
        LightMixerDestinationSelect(coordinator, light_options),
        LightMixerLayerTypeSelect(coordinator, "layer1"),
        LightMixerLayerTypeSelect(coordinator, "layer2"),
        LightMixerLayerTypeSelect(coordinator, "layer3"),
    ])


class LightMixerModeSelect(SelectEntity, RestoreEntity):
    _attr_has_entity_name = True
    _attr_name = "Mode"
    _attr_options = MODES
    _attr_should_poll = False

    def __init__(self, coordinator: LightMixerCoordinator) -> None:
        self._coordinator = coordinator
        self._attr_unique_id = f"{coordinator.entry_id}_mode"
        self._attr_current_option = MODE_MIX

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._coordinator.entry_id)},
            name=self._coordinator.name,
        )

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state and last_state.state in MODES:
            self._attr_current_option = last_state.state
            self._coordinator.update_mode(last_state.state)

    async def async_select_option(self, option: str) -> None:
        self._attr_current_option = option
        self._coordinator.update_mode(option)
        self.async_write_ha_state()
        await self._coordinator.async_apply()


class LightMixerPriorityOrderSelect(SelectEntity, RestoreEntity):
    _attr_has_entity_name = True
    _attr_name = "Priority order"
    _attr_options = PRIORITY_ORDERS
    _attr_should_poll = False

    def __init__(self, coordinator: LightMixerCoordinator) -> None:
        self._coordinator = coordinator
        self._attr_unique_id = f"{coordinator.entry_id}_priority_order"
        self._attr_current_option = DEFAULT_PRIORITY_ORDER

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._coordinator.entry_id)},
            name=self._coordinator.name,
        )

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state and last_state.state in PRIORITY_ORDERS:
            self._attr_current_option = last_state.state
            self._coordinator.update_priority_order(last_state.state)

    async def async_select_option(self, option: str) -> None:
        self._attr_current_option = option
        self._coordinator.update_priority_order(option)
        self.async_write_ha_state()
        await self._coordinator.async_apply()


class LightMixerDestinationSelect(SelectEntity, RestoreEntity):
    _attr_has_entity_name = True
    _attr_name = "Destination"
    _attr_should_poll = False

    def __init__(self, coordinator: LightMixerCoordinator, options: list[str]) -> None:
        self._coordinator = coordinator
        self._attr_unique_id = f"{coordinator.entry_id}_destination"
        self._attr_options = options
        self._attr_current_option = coordinator.destination if coordinator.destination in options else None

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._coordinator.entry_id)},
            name=self._coordinator.name,
        )

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state and last_state.state in self._attr_options:
            self._attr_current_option = last_state.state
            self._coordinator.update_destination(last_state.state)

    async def async_select_option(self, option: str) -> None:
        self._attr_current_option = option
        self._coordinator.update_destination(option)
        self.async_write_ha_state()
        await self._coordinator.async_apply()


class LightMixerLayerTypeSelect(SelectEntity, RestoreEntity):
    """Selects the colour capability type for a layer (full / color_temp / dim).

    Changing the type constrains the layer's supported_color_modes, which HA
    uses to determine which colour controls to show in the UI.
    """

    _attr_has_entity_name = True
    _attr_options = LAYER_TYPES
    _attr_should_poll = False

    def __init__(self, coordinator: LightMixerCoordinator, layer: str) -> None:
        self._coordinator = coordinator
        self._layer = layer
        num = layer[-1]
        self._attr_unique_id = f"{coordinator.entry_id}_layer_type_{layer}"
        self._attr_name = f"Layer {num} type"
        self._attr_current_option = DEFAULT_LAYER_TYPE

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._coordinator.entry_id)},
            name=self._coordinator.name,
        )

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state and last_state.state in LAYER_TYPES:
            self._attr_current_option = last_state.state
            self._coordinator.update_layer_type(self._layer, last_state.state)

    async def async_select_option(self, option: str) -> None:
        self._attr_current_option = option
        self._coordinator.update_layer_type(self._layer, option)
        self.async_write_ha_state()
        await self._coordinator.async_apply()
