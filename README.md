# Granite

This project was developed by me (@vjei) and glory (@beforeglory), this is the base of every project above 2K18, and since everyone decided to leak this source and profit, we're going to release it for free. It was developed in four days, and matchmaking took nearly 4 hours, this is the FIRST proper above 2K18 server in the world. It doesn't matter who it is, this is the base for everyone's work above 2K18.

Join discord.gg/celestialclient

A private server stack for NBA 2K19 on PC.

| Component | Path | Description |
| --- | --- | --- |
| Granite Server | `Granite/Server` | HTTPS web services: login, sessions, store, virtual currency, MyCareer, MyTeam, Pro-Am, user content and matchmaking. |
| Opal | `Opal` | Secure websocket world server for the neighborhood, stage, MyCourt and squads, plus the UDP game relay. |
| Module | `Granite/Module` | Native DLL loaded into the game. Redirects 2K web traffic to Granite and installs the crash handler. |
| Injector / Launcher | `Granite/Injector`, `Granite/Launcher` | Native tools that start the game and load `Module.dll`. |
| Shared | `Shared` | Ante-Up court pricing used by both servers. |

## Requirements

- Node.js 18 or newer
- Visual Studio 2022 with the C++ desktop workload to build the native projects

A self-signed TLS certificate is included in `Granite/Server/Storage/Certificate` and is used by both Granite and Opal.

## Running

```bat
StartServers.bat
```

Or start each server on its own:

```bat
cd Granite\Server
npm start

cd Opal
npm start
```

Every address defaults to `127.0.0.1`. To host for other players, replace it with your server's address in:

- `Granite/Server/Config.json` (`PublicHost`)
- `Granite/Server/Source/Services/World/Connect.js` (`Host`)
- `Granite/Module/Module.cpp` (`RedirectHost`, then rebuild `Module.dll`)
- `StartServers.bat` (`PUBLIC_IP`)

Granite reads `Granite/Server/Config.json`. Both servers accept these environment overrides:

| Variable | Purpose |
| --- | --- |
| `GRANITE_PORT`, `GRANITE_HOST` | Granite listen address |
| `OPAL_PORT` | Opal websocket port |
| `OPAL_RELAY_PORT`, `OPAL_RELAY_HOST`, `OPAL_RELAY_BIND`, `OPAL_PUBLIC_HOST` | Relay and advertised addresses |
| `OPAL_SSL`, `OPAL_KEY_NAME`, `OPAL_CERT_NAME` | Certificate used by Opal |
| `GRANITE_LOCKSTEP_BUFFER_FRAMES`, `OPAL_LOCKSTEP_DELAY_FRAMES`, `OPAL_LOCKSTEP_HZ` | Lockstep tuning (the two frame counts must match) |
| `GRANITE_VC_STATIC` | Use a fixed 100000 VC wallet |

Pass `--verbose` for detailed logging and `--capture` to record traffic.

Stage court placement is tuned in `Opal/Source/Activity/StageSpots/StageSpots.txt`.

## Data

The repository ships the endpoint table and the store catalog. Runtime state is created on first use and is not tracked: sessions, owned items, career progress, user content, arbitration results and captures. CDN files belong in `Granite/Server/Storage/Cdn`.

`Granite/Server/Tools/ImportStoreCatalog.py` rebuilds `Storage/Inventory/AutomaticCatalog.json` from a game manifest:

```bat
python Granite\Server\Tools\ImportStoreCatalog.py <manifest> Granite\Server\Storage\Inventory\AutomaticCatalog.json
```

## Building the native projects

```bat
msbuild Granite\Granite.sln -p:Configuration=Release -p:Platform=x64
```

Output is written to `Granite/Build`.

## Tests

```bat
cd Granite\Server
npm test

cd Opal
npm test
```

The native test project is `Granite/Module/Tests/CrashHandlerTests.vcxproj`. It expects a Release `Module.dll` in `Granite/Build/Release`.

## License

Copyright (c) 2026 Celestial. Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). You may use, modify and share this project for personal, hobby, research and other noncommercial purposes. Commercial use is not permitted.

MinHook (`Granite/Module/MinHook`) is copyright Tsuda Kageyu and is distributed under its own BSD 2-Clause license, included in `MinHook.h`.
