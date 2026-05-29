from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_state_change_event

from .const import DOMAIN
from .coordinator import LightMixerCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: LightMixerCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([LightMixerDestinationSensor(coordinator)])


class LightMixerDestinationSensor(SensorEntity):
    """Mirrors the real-time state of the physical destination light.

    Subscribes to state-change events on the destination entity so updates
    are pushed immediately rather than polled. Re-subscribes automatically
    when the destination is changed at runtime.
    """

    _attr_has_entity_name = True
    _attr_name = "Destination status"
    _attr_should_poll = False
    _attr_icon = "mdi:lightbulb-question-outline"

    def __init__(self, coordinator: LightMixerCoordinator) -> None:
        self._coordinator = coordinator
        self._attr_unique_id = f"{coordinator.entry_id}_destination_status"
        self._tracked_dest: str | None = None  # which entity we currently have a subscription on
        self._unsubscribe_dest = None

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._coordinator.entry_id)},
            name=self._coordinator.name,
        )

    @property
    def native_value(self) -> str:
        dest = self._coordinator.destination
        if not dest:
            return "not_configured"
        state = self.hass.states.get(dest)
        if state is None:
            return "unavailable"
        return state.state

    @property
    def extra_state_attributes(self) -> dict:
        dest = self._coordinator.destination
        if not dest:
            return {}
        attrs: dict = {"entity_id": dest}
        state = self.hass.states.get(dest)
        if state is not None:
            attrs["friendly_name"] = state.attributes.get("friendly_name", dest)
            if state.state == "on":
                for key in ("brightness", "color_temp_kelvin", "rgb_color", "color_mode"):
                    if key in state.attributes:
                        attrs[key] = state.attributes[key]
        return attrs

    async def async_added_to_hass(self) -> None:
        self._coordinator.register_listener(self._on_coordinator_update)
        self._subscribe_destination(self._coordinator.destination)

    async def async_will_remove_from_hass(self) -> None:
        self._coordinator.unregister_listener(self._on_coordinator_update)
        self._unsubscribe_destination()

    def _on_coordinator_update(self) -> None:
        dest = self._coordinator.destination
        # Re-subscribe if the destination entity changed
        if dest != self._tracked_dest:
            self._subscribe_destination(dest)
        self.async_write_ha_state()

    def _on_destination_state_change(self, event) -> None:
        self.async_write_ha_state()

    def _subscribe_destination(self, dest: str | None) -> None:
        self._unsubscribe_destination()
        self._tracked_dest = dest
        if dest:
            self._unsubscribe_dest = async_track_state_change_event(
                self.hass, [dest], self._on_destination_state_change
            )

    def _unsubscribe_destination(self) -> None:
        if self._unsubscribe_dest is not None:
            self._unsubscribe_dest()
            self._unsubscribe_dest = None
