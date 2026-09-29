// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Logger = require('./Source/Core/Logger');
process.on('uncaughtException', (Failure) => {
    Logger.Error(`uncaught exception (kept running): ${Failure && Failure.stack ? Failure.stack : Failure}`);
});
process.on('unhandledRejection', (Reason) => {
    Logger.Error(`unhandled rejection (kept running): ${Reason && Reason.stack ? Reason.stack : Reason}`);
});

require('./Source/Server').Start();
