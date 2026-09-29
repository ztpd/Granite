// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Log = require('../Core/Log');
const { Hex } = require('../Core/Crc32');
const Packets = require('./Packets');

const Packet = Packets.Wire('REQUEST_ACK');

const HighestId = 16;

const IntervalMs = 2000;
const Bursts = 45;

function Build(RequestId) {
    const Frame = Buffer.alloc(24);
    Frame.writeUInt32LE(Frame.length, 0);
    Frame.writeUInt32BE(Packet >>> 0, 4);
    Frame.writeBigUInt64BE(BigInt(RequestId), 16);
    return Frame;
}

function BuildCorrelated(RequestBuffer) {
    const Out = Buffer.alloc(32, 0);
    Out.writeUInt32LE(Out.length, 0);
    Out.writeUInt32BE(Packet >>> 0, 4);
    if (RequestBuffer && RequestBuffer.length >= 24) {
        const Sequence = RequestBuffer.readUInt32BE(20) >>> 0;
        const SessionToken = RequestBuffer.readUInt32BE(8) >>> 0;
        Out.writeUInt32BE(Sequence, 20);
        Out.writeUInt32LE(SessionToken, 24);
        Out.writeUInt32BE(Sequence, 28);
    }
    return Out;
}

function AckCorrelated(Connection, RequestBuffer) {
    if (!Connection || Connection.Closed) return false;
    try {
        return Connection.Send(BuildCorrelated(RequestBuffer));
    } catch (_) {
        return false;
    }
}

function AckAll(Connection) {
    let Sent = 0;
    for (let Id = 1; Id <= HighestId; Id++) {
        if (Connection.Send(Build(Id))) Sent++;
    }
    return Sent;
}

function Start(Connection) {
    if (Connection.AckTimer) {
        Log.Verbose(`  request acks already running for connection ${Connection.Id}, not stacking`);
        return;
    }

    const Sent = AckAll(Connection);
    Log.Verbose(
        `  request ids 1..${HighestId} acknowledged for ${Connection.Identifier}, ` +
            `${Sent} frames, repeating every ${IntervalMs}ms`,
    );

    let Burst = 0;
    Connection.AckTimer = setInterval(() => {
        if (Connection.Closed || Connection.Socket.destroyed || ++Burst >= Bursts) {
            Stop(Connection);
            return;
        }
        AckAll(Connection);
    }, IntervalMs);

    if (Connection.AckTimer.unref) Connection.AckTimer.unref();
}

function Stop(Connection) {
    if (!Connection.AckTimer) return;
    clearInterval(Connection.AckTimer);
    Connection.AckTimer = null;
}

module.exports = { Packet, HighestId, IntervalMs, Bursts, Build, BuildCorrelated, AckCorrelated, AckAll, Start, Stop };
