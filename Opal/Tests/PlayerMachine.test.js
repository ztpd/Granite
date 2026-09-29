// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const Fs = require('node:fs');
const Path = require('node:path');
const Body = require('../Source/Protocol/PlayerBody');
const Player = require('../Source/Protocol/PlayerObject');
const GotNext = require('../Source/Protocol/GotNext');
const Roster = require('../Source/Protocol/Roster');
require('../Source/Core/Log').SetLevel(0);

const Handshake = Buffer.from(
    Fs.readFileSync(Path.join(__dirname, 'Frames/Handshake2K19.txt'), 'utf8').trim().split(/\s+/)[3],
    'hex',
);
const Captured = Player.ExtractHandshakeBody(Handshake);
function Connection(Id, MachineValue) {
    return {
        Id: Id,
        Puid: Captured.PlayerId + BigInt(Id),
        MachineId: MachineValue,
        PlayerRevision: 1n,
        Identifier: `machine-test-${Id}`,
        PlayerBody: Player.StampIdentity(Captured.Body, Captured.PlayerId, Captured.PlayerId + BigInt(Id)).Body,
    };
}
function Machine(BodyData) {
    const Decoded = Body.Decode(BodyData);
    Assert.equal(Decoded.Ok, true, Decoded.Reason);
    return BodyData.readBigUInt64LE(Decoded.Offsets.get(Body.Field.MachineId));
}

Test('captured 2K19 zero machine becomes assigned u64 without changing any other field', () => {
    Assert.equal(Machine(Captured.Body), 0n);
    const Original = Buffer.from(Captured.Body);
    const Result = Body.SetMachineId(Captured.Body, 0x68fcn);
    Assert.equal(Result.Ok, true);
    Assert.equal(Result.Offset, 43, 'full 149-field captured body; sparse bodies need a field walk');
    Assert.equal(Machine(Result.Body), 0x68fcn);
    const Restored = Buffer.from(Result.Body);
    Restored.writeBigUInt64LE(0n, Result.Offset);
    Assert.deepEqual(Restored, Original, 'only the eight machine bytes may change');
    Assert.deepEqual(Captured.Body, Original, 'input buffer is not mutated');
});

Test('absent machine field is inserted with presence bit and preserves all later fields', () => {
    const At = Body.Decode(Captured.Body).Offsets.get(1);
    const Absent = Buffer.concat([Captured.Body.subarray(0, At), Captured.Body.subarray(At + 8)]);
    Absent[16] &= ~0x40;
    const Result = Body.SetMachineId(Absent, 0x68fdn);
    Assert.equal(Result.Ok, true);
    Assert.deepEqual(Result.Body, Body.SetMachineId(Captured.Body, 0x68fdn).Body);
});

Test('invalid machine allocations cannot produce a native PLAYER frame', () => {
    for (const Id of [undefined, null, 0n, -1n, 0x10000000000000000n]) {
        Assert.equal(Body.SetMachineId(Captured.Body, Id).Ok, false);
        Assert.equal(Player.FrameFor(Connection(1, Id)), null);
    }
    const Short = Buffer.alloc(12);
    Assert.equal(Body.SetMachineId(Short, 10n).Native, false);
    Assert.deepEqual(Short, Buffer.alloc(12), 'unknown layouts are never guessed');
});

Test('each participant has its own machine on normal, drain, and PLAYING publications', () => {
    Roster.Players.clear();
    const Players = [Connection(1, 0x68fcn), Connection(2, 0x68fdn)];
    for (const PlayerData of Players) {
        const First = Player.FrameFor(PlayerData);
        Assert.equal(Machine(First.subarray(32)), PlayerData.MachineId);
        Assert.equal(Machine(PlayerData.PlayerBody), PlayerData.MachineId);
        const Revision = PlayerData.PlayerRevision;
        Assert.equal(Machine(Player.DrainFrameFor(PlayerData).subarray(32)), PlayerData.MachineId);
        Assert.equal(PlayerData.PlayerRevision, Revision, 'drain must not trigger appearance rebuild');
        const Decoded = Body.Decode(PlayerData.PlayerBody);
        PlayerData.PlayerBody.writeUInt32LE(GotNext.State.GotNext, Decoded.Offsets.get(2));
        PlayerData.PlayerBody.writeBigUInt64LE(0n, Decoded.Offsets.get(1));
        PlayerData.GotNext = {};
        const Sent = [];
        PlayerData.SendObject = (Frame) => {
            Sent.push(Frame);
            return true;
        };
        Assert.equal(GotNext.GrantPlaying(PlayerData), true);
        Assert.equal(Machine(Sent[0].subarray(32)), PlayerData.MachineId);
        Assert.equal(Sent[0].subarray(32).readUInt32LE(Decoded.Offsets.get(2)), GotNext.State.Playing);
    }
});

Test('same PUID reconnect cannot reuse the previous connection machine', () => {
    const PlayerData = Connection(1, 0x68fcn);
    Player.FrameFor(PlayerData);
    PlayerData.MachineId = 0x6901n;
    Assert.equal(Machine(Player.FrameFor(PlayerData).subarray(32)), 0x6901n);
    Assert.equal(Machine(PlayerData.PlayerBody), 0x6901n);
});
