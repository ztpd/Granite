// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Fs = require('fs');
const Path = require('path');
const Log = require('../Core/Log');
const { performance: Perf } = require('node:perf_hooks');

let Stream = null;
let Count = 0;
let File = null;

function Start(Directory) {
    if (Stream) return File;
    const Dir = Directory || Path.join(__dirname, '..', '..', 'Capture');
    Fs.mkdirSync(Dir, { recursive: true });

    const Stamp = new Date().toISOString().replace(/[:.]/g, '-');
    File = Path.join(Dir, `frames-${Stamp}.txt`);
    Stream = Fs.createWriteStream(File, { flags: 'a' });
    Log.Info(`capturing inbound frames to ${File}`);
    return File;
}

function Record(ConnectionId, Bytes) {
    if (!Stream) return;
    Count++;
    const PacketId = Bytes.length >= 8 ? Bytes.readUInt32BE(4).toString(16).padStart(8, '0') : '????????';
    Stream.write(`${ConnectionId} ${PacketId} ${Bytes.length} ${Bytes.toString('hex')}\n`);
}

function RecordOutbound(ConnectionId, Bytes) {
    if (!Stream || !Buffer.isBuffer(Bytes)) return;
    Count++;
    const PacketId = Bytes.length >= 8 ? Bytes.readUInt32BE(4).toString(16).padStart(8, '0') : '????????';
    Stream.write(`out-${ConnectionId} out ${Bytes.length} ${Bytes.toString('hex')} ${PacketId}\n`);
}

function RecordRelay(Direction, Endpoint, Bytes) {
    if (!Stream || !Buffer.isBuffer(Bytes)) return;
    Count++;
    Stream.write(
        `relay-${Direction} relay ${Bytes.length} ${Bytes.toString('hex')} ` +
            `${Endpoint.address}:${Endpoint.port} t=${Perf.now().toFixed(3)}\n`,
    );
}

function Stop() {
    if (!Stream) return;
    Stream.end();
    Log.Info(`captured ${Count} frames to ${File}`);
    Stream = null;
}

function Active() {
    return Stream !== null;
}

module.exports = { Start, Record, RecordOutbound, RecordRelay, Stop, Active };
