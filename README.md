<!-- markdownlint-disable MD033 -->

# homebridge-kasa

[![NPM Version](https://img.shields.io/npm/v/homebridge-kasa.svg)](https://www.npmjs.com/package/homebridge-kasa)

Kasa smart home plugin for [Homebridge](https://github.com/nfarina/homebridge).

Originally forked from [plasticrake/homebridge-tplink-smarthome](https://github.com/plasticrake/homebridge-tplink-smarthome).

## Supported Protocols

- **Legacy XOR** - UDP/TCP on port 9999 (classic Kasa devices)
- **KLAP v2** - HTTP-based with AES-encrypted sessions (newer firmware)
- **AES** - HTTP-based with AES-CBC via RSA handshake (Tapo-protocol devices)
- **TPAP** - HTTP-based with SPAKE2+ authentication (recent KP125M firmware)

## Models Supported

- **Plugs:** EP25, EP40, HS100, HS103, HS105, HS107, HS110, HS300, KP105, KP115, KP125M, KP303, KP400
- **Switches:** ES20M, HS200, HS210, HS220, HS230
- **Bulbs:** KL50, KL120, KL125, LB100, LB110, LB120, LB130, LB200, LB230
- **Lightstrips:** KL400, KL430

More models may be supported than listed. If you have another model working please let me know so I can add it here.

## HomeKit

| Model                                           | Service   | Characteristics                                                                                                                                                                                    |
| ----------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HS100, HS103, HS105, HS107, KP105, KP303, KP400 | Outlet    | On<br/>OutletInUse (based on On state)                                                                                                                                                             |
| HS110, HS300, KP115, KP125M                     | Outlet    | On<br/>OutletInUse (based on energy monitoring)<br/>Volts (Custom)<br/>Amperes (Custom)<br/>Watts (Custom)<br/>VoltAmperes (Custom)<br/>KilowattHours (Custom)<br/>KilowattVoltAmpereHour (Custom) |
| EP25, EP40                                      | Outlet    | On<br/>OutletInUse (based on On state)                                                                                                                                                             |
| HS200, HS210                                    | Switch    | On                                                                                                                                                                                                 |
| HS220, HS230                                    | Lightbulb | On<br/>Brightness                                                                                                                                                                                  |
| KL50, LB100, LB110, LB200                       | Lightbulb | On<br/>Brightness<br/>Watts (Custom)                                                                                                                                                               |
| LB120, KL120                                    | Lightbulb | On<br/>Brightness<br/>ColorTemperature<br/>Watts (Custom)                                                                                                                                          |
| KL125, KL400, KL430, LB130, LB230               | Lightbulb | On<br/>Brightness<br/>ColorTemperature<br/>Hue<br/>Saturation<br/>Watts (Custom)                                                                                                                   |
| ES20M                                           | Lightbulb | On<br/>Brightness                                                                                                                                                                                  |

## Installation

### Manual Installation

1. **Node v18 or greater is required.** Check by running: `node --version`
2. Install Homebridge: ([instructions](https://github.com/homebridge/homebridge#installation))
3. **Homebridge v1.6.0 or greater is required.** Check by running `homebridge --version`
4. Install this plugin using: `npm install -g homebridge-kasa`
5. Update your configuration file. See the sample below.

### Homebridge Config UI X Installation

Check out [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x) for easier setup. This plugin can be installed from the **Plugins** tab by searching.

## Updating

- `npm update -g homebridge-kasa`

## Configuration

### Sample Configuration

#### Minimal (legacy devices only)

If you only have older Kasa devices that haven't been firmware-updated, no credentials are needed:

```json
"platforms": [{
  "platform": "TplinkSmarthome",
  "name": "TplinkSmarthome"
}]
```

#### With Kasa credentials (recommended)

Newer devices (e.g. KP125M) and firmware-updated devices (e.g. HS103 with recent firmware) use authenticated KLAP, AES, or TPAP protocols and require your Kasa account credentials to be discovered. Without credentials, only legacy devices on port 9999 will be found.

```json
"platforms": [{
  "platform": "TplinkSmarthome",
  "name": "TplinkSmarthome",
  "kasaUsername": "you@example.com",
  "kasaPassword": "your-kasa-password"
}]
```

#### All options with defaults

See [config.ts](src/config.ts) for documentation on these options. It is recommended to use [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x) to setup the configuration if you don't want to manually edit JSON files.

```json
"platforms": [{
  "platform": "TplinkSmarthome",
  "name": "TplinkSmarthome",

  "kasaUsername": "",
  "kasaPassword": "",

  "addCustomCharacteristics": true,
  "inUseThreshold": 0,
  "switchModels": ["HS200", "HS210"],

  "discoveryPort": 0,
  "broadcast": "255.255.255.255",
  "pollingInterval": 10,
  "deviceTypes": ["bulb", "plug"],
  "macAddresses": [],
  "excludeMacAddresses": [],
  "devices": [],

  "timeout": 15,
  "transport": "tcp",
  "waitTimeUpdate": 100
}]
```

##### MAC Addresses

MAC Addresses are normalized, special characters are removed and made uppercase for comparison. So any format should work: `AA:BB:CC:00:11:22` or `aaBbcc001122` are valid. Glob-style pattern matching is supported: `?` will match a single character and `*` matches zero or more. To specify all MAC addresses that start with `AA` you could use `AA*`

<img src="https://user-images.githubusercontent.com/1383980/30236344-5ca0e866-94cc-11e7-9cf7-bb5632291082.png" align="right" alt="Eve Screenshot - Custom Characteristics" width=250>

### Custom Characteristics in Eve

Devices that support energy monitoring (HS110, etc) will have extra characteristics that are viewable in the Eve app (such as Watts). Turn this off by setting `addCustomCharacteristics` false.

### Discovery and Broadcast

This plugin discovers devices using two methods:

- **Legacy UDP broadcast** (port 9999) for older devices. This is also how the Kasa app finds older devices.
- **Authenticated HTTP subnet scan** (port 80) for newer/updated devices using KLAP v2, AES, or TPAP. Requires `kasaUsername` and `kasaPassword` to be configured. This includes Matter-capable models like the KP125M.

Try setting the `broadcast` configuration to your subnet broadcast address (e.g. `192.168.1.255`) if you're having discovery issues. This is used by both discovery methods. Some users have reported that rebooting their router or changing some router settings have fixed discovery issues.

### Manually Specifying Devices

If you have a network setup where UDP broadcast is not working, you can manually specify the devices you'd like this plugin to use. This will send the discovery message directly to these devices in addition to the UDP broadcast. **Note that your device must have a static IP to work.**

```js
"platforms": [{
  "platform": "TplinkSmarthome",
  "name": "TplinkSmarthome",

  "devices": [
    { "host": "192.168.0.100" },
    { "host": "192.168.0.101" },
    { "host": "192.168.0.102", "port": "9999" } // port defaults to "9999" but can be overriden
  ]
}]
```

### Accessory Names

Note the name in Homebridge/HomeKit may be out of sync from the Kasa app. This is a [Homebridge/HomeKit limitation](https://github.com/nfarina/homebridge#limitations). You can rename your accessory through the Home app.

## Troubleshooting

### UUID Errors

`Error: Cannot add a bridged Accessory with the same UUID as another bridged Accessory`
If you get an error about duplicate UUIDs you'll have to either remove your cached configuration files or manually edit them to remove the offending entry. By default they are stored in `~/.homebridge/accessories`. In some cases you may also need to remove `~/.homebridge/persist` and re-pair homebridge to your home.

You can remove them by running:

- `rm -rf ~/.homebridge/accessories`
- `rm -rf ~/.homebridge/persist`

## Credits

Thanks to George Georgovassilis and Thomas Baust for [reverse engineering the HS1XX protocol](https://blog.georgovassilis.com/2016/05/07/controlling-the-tp-link-hs100-wi-fi-smart-plug/).

TPAP support is based on protocol research and implementations from [python-kasa](https://github.com/python-kasa/python-kasa/pull/1592) and the MIT-licensed [ioBroker.tapo](https://github.com/TA2k/ioBroker.tapo) project.
