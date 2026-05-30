from __future__ import annotations

import shutil
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .coordinator import LightMixerCoordinator

PLATFORMS = ["binary_sensor", "button", "light", "number", "select", "sensor"]

_CARD_FILENAME = "light-mixer-card.js"


async def _async_copy_card(hass: HomeAssistant) -> None:
    source = Path(__file__).parent / "www" / _CARD_FILENAME
    dest_dir = Path(hass.config.config_dir) / "www"
    dest = dest_dir / _CARD_FILENAME

    dest_dir.mkdir(exist_ok=True)

    if not dest.exists() or dest.read_bytes() != source.read_bytes():
        await hass.async_add_executor_job(shutil.copy2, str(source), str(dest))


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    await _async_copy_card(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    await _async_copy_card(hass)
    # One coordinator per entry, stored in hass.data and shared across all platforms
    coordinator = LightMixerCoordinator(hass, entry)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data[DOMAIN].pop(entry.entry_id)
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    if not hass.config_entries.async_entries(DOMAIN):
        dest = Path(hass.config.config_dir) / "www" / _CARD_FILENAME
        await hass.async_add_executor_job(dest.unlink, True)
