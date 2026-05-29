DOMAIN = "light_mixer"
CONF_DESTINATION = "destination"

# Mode strings are persisted via RestoreEntity — do not rename without a migration
MODE_MIX           = "mix"
MODE_LAST_SET      = "last_set"
MODE_PRIORITY      = "priority"
MODE_LAYER1        = "layer1"
MODE_LAYER2        = "layer2"
MODE_LAYER3        = "layer3"
MODE_OFF           = "off"

MODES = [
    MODE_MIX,
    MODE_LAST_SET,
    MODE_PRIORITY,
    MODE_LAYER1,
    MODE_LAYER2,
    MODE_LAYER3,
    MODE_OFF,
]

LAYER_TYPE_FULL       = "full"
LAYER_TYPE_COLOR_TEMP = "color_temp"
LAYER_TYPE_DIM        = "dim"
LAYER_TYPES           = [LAYER_TYPE_FULL, LAYER_TYPE_COLOR_TEMP, LAYER_TYPE_DIM]
DEFAULT_LAYER_TYPE    = LAYER_TYPE_FULL

PRIORITY_ORDERS = [
    "L1>L2>L3",
    "L1>L3>L2",
    "L2>L1>L3",
    "L2>L3>L1",
    "L3>L1>L2",
    "L3>L2>L1",
]
DEFAULT_PRIORITY_ORDER = "L1>L2>L3"
