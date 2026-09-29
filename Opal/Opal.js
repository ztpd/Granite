// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Log = require('./Source/Core/Log');
const Listener = require('./Source/Net/Listener');
const Capture = require('./Source/Net/Capture');
const VconlineRelay = require('./Source/Net/VconlineRelay');
const { LingerMs } = require('./Source/Protocol/Connection');

const Port = Number(process.env.OPAL_PORT) || 20054;

if (require.main === module) {
    if (process.argv.includes('--verbose')) Log.SetLevel(Log.Level.Verbose);

    Log.Info(`opal starting @ ${Log.Clock()}`);
    if (process.argv.includes('--capture')) Capture.Start();
    try {
        VconlineRelay.Start();
        Listener.Start({ port: Port });
        try {
            const CourtTables = require('./Source/Activity/CourtTables');
            const CourtData = require('./Source/Protocol/CourtData');
            const Park = CourtTables.For('neighborhood');
            const Stage = CourtTables.For('stage');
            Log.Info(
                `courts: park ${Park.Courts.length} (${CourtData.ParkFormat()}) / ` +
                    `stage ${Stage.Courts.length} bitstream, 32B envelope, ` +
                    `gotNextLocation ${process.env.OPAL_GOTNEXT_LOCATION === '1' ? 'ON' : 'off'}`,
            );
        } catch (_) {}
    } catch (E) {
        Log.Error(`opal could not start: ${E.message}`);
        process.exit(1);
    }

    let Stopping = false;
    process.on('SIGINT', () => {
        if (Stopping) process.exit(0);
        Stopping = true;

        Log.Info(`opal shutting down @ ${Log.Clock()}`);
        const Open = [...Listener.Connections.values()];
        for (const Connection of Open) Connection.Close('server shutting down');
        VconlineRelay.Stop();
        Capture.Stop();

        if (!Open.length) process.exit(0);
        Log.Verbose(
            `  letting ${Open.length} close ` + `${Open.length === 1 ? 'frame' : 'frames'} flush before exiting`,
        );
        const Timer = setTimeout(() => process.exit(0), LingerMs + 50);
        if (Timer.unref) Timer.unref();
    });
}

module.exports = { Listener, VconlineRelay };
