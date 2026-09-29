// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');
const Fs = require('fs');
const Path = require('path');
const Packets = require('../Source/Protocol/Packets');
const Worlds = require('../Source/Protocol/Worlds');
const Objects = require('../Source/Codec/ObjectFrame');
const Log = require('../Source/Core/Log');
const Listener = require('../Source/Net/Listener');
const Names = require('../Source/Core/Names');
const Gambling = require('../Source/Protocol/Gambling');
const Activities = require('../Source/Activity/Activities');
const MyCourt = require('../Source/Protocol/MyCourt');
const ChangeServer = require('../Source/Protocol/ChangeServer');
const Roster = require('../Source/Protocol/Roster');

const Checks = [
    ['Connect', 0x9d32c5b4],
    ['ObjectData', 0x9c72247c],
    ['ObjectDataList', 0x771f7646],
    ['ObjectUpdate', 0x01ae543f],
    ['ObjectUpdateList', 0x618ec78c],
    ['ClientUpdate', 0xfef2dd68],
    ['RequestAck', 0x2b84ffc2],
    ['Movement', 0xce1c9e8c],
    ['ChangeServer', 0x9ffcdad0],
    ['StateUpdate', 0x7433cf29],
];
for (const [Name, Id] of Checks) Assert.strictEqual(Packets.Evidence2K19[Name], Id);
Assert.strictEqual(Packets.EngineName(0x618ec78c), 'TK_WORLD::SERVER::HandleObjectUpdateListPacket');
Assert.strictEqual(Worlds.Evidence2K19.WorldKeys.BOULEVARD, 0x19b63986);
Assert.strictEqual(Worlds.Evidence2K19.WorldKeys.GAMBLING, 0x1d389fb9);
Assert.strictEqual(Worlds.Evidence2K19.WorldKeys.SLAMBALL, 0x3aa40b83);
Assert.strictEqual(Worlds.Evidence2K19.WorldKeys.CRIB, 0x7eb406e1);
Assert.strictEqual(Worlds.Evidence2K19.ActivityKeys.Mycourt, 0xfeac4070);
Assert.strictEqual(Worlds.Evidence2K19.ServerTypes.Mycourt, 0xc1e9be6a);
Assert.strictEqual(Gambling.WorldKey, 0x1d389fb9);
Assert.strictEqual(Gambling.ActivityKey, 0xdb0b03f5);
Assert.strictEqual(Names.Crc('GAMBLING_ID'), 0xdcff2a93);
Assert.strictEqual(Gambling.Services.CurrentLimits.Id, 0x5095f4be);
Assert.strictEqual(Gambling.Services.PlaceBet.Id, 0x5d0ecd48);
Assert.strictEqual(Gambling.Services.PrizeWheelSpin.Id, 0x399bf790);
Assert.strictEqual(Gambling.WireFields.PlaceBet.GamblingId, 0xdcff2a93);
Assert.ok(Gambling.IsGambling({ WorldKey: Gambling.WorldKey }));
Assert.ok(Gambling.IsGambling({ ActivityKey: Gambling.ActivityKey }));
Assert.ok(!Gambling.IsGambling({ WorldKey: Worlds.Evidence2K19.WorldKeys.BOULEVARD }));
Assert.strictEqual(Objects.LegacyFlags2K19[0x2c4d49e3], 147);
Assert.strictEqual(Objects.Classes[0x36bf2a26].Flags, 9);
Assert.strictEqual(Objects.Classes[MyCourt.RoomClass].Name, 'MYCOURT_ROOM');
Assert.strictEqual(MyCourt.RoomClassSize, 7952);
Assert.strictEqual(MyCourt.RoomRuntime.RelatedIds, 176);
Assert.strictEqual(MyCourt.RoomRuntime.FinalValueDirty, 7944);
Assert.strictEqual(MyCourt.RoomFields.length, 29);
Assert.strictEqual(Activities.Lookup(0xfeac4070, 0x7eb406e1).Name, 'mycourt');
Assert.strictEqual(ChangeServer.ServerTypeFor({ ServerType: 0, WorldKey: 0x7eb406e1 }), Worlds.ServerType.MyCourt);
Assert.strictEqual(
    ChangeServer.ServerTypeFor({ ServerType: 'MyCourt', WorldKey: 0x7eb406e1 }),
    Worlds.ServerType.MyCourt,
);

const RoomPayload = Buffer.alloc(20);
RoomPayload.writeBigUInt64BE(0x1234n, 0);
RoomPayload.writeBigUInt64BE(1n, 8);
const RoomFrame = Objects.Build({
    PacketId: MyCourt.ObjectDataPacket,
    ConnectionId: null,
    ObjectId: 0xaa01n,
    ClassCrc: MyCourt.RoomClass,
    Payload: RoomPayload,
});
const DecodedPayload = Objects.BuildPayload({
    key: 0xaa01n,
    version: 2n,
    ClassCrc: MyCourt.RoomClass,
    Bits: [3, 5, 6],
    Values: (() => {
        const Values = Buffer.alloc(10);
        Values[0] = 1;
        Values[1] = 1;
        Values.writeBigUInt64LE(0x0110000100000666n, 2);
        return Values;
    })(),
});
const DecodedFrame = Objects.Build({
    PacketId: MyCourt.ObjectDataPacket,
    ConnectionId: null,
    ObjectId: 0xaa01n,
    ClassCrc: MyCourt.RoomClass,
    Payload: DecodedPayload,
});
const DecodedRoom = MyCourt.ParseRoom(DecodedFrame);
Assert.strictEqual(DecodedRoom.FlagCount, 29);
Assert.deepStrictEqual(DecodedRoom.Flags, [3, 5, 6]);
Assert.strictEqual(DecodedRoom.Room.Complete, true);
Assert.strictEqual(DecodedRoom.Room.Fields.IsValid, 1);
Assert.strictEqual(DecodedRoom.Room.Fields.RelatedCount, 1);
Assert.strictEqual(DecodedRoom.Room.Fields.RelatedId0, 0x0110000100000666n);
const BootstrapConnection = {
    Puid: 0x0110000100000666n,
    SessionId: 1008n,
};
const Bootstrap = MyCourt.BuildBootstrap(BootstrapConnection);
const BootstrapRoom = MyCourt.ParseRoom(Bootstrap);
Assert.strictEqual(Bootstrap.length, 68, '2K19 MyCourt bootstrap uses the 32-byte object envelope');
Assert.strictEqual(BootstrapRoom.ObjectId, 0x000003f0000d4d06n);
Assert.deepStrictEqual(BootstrapRoom.Flags, [0, 1, 2]);
Assert.strictEqual(BootstrapRoom.Room.Fields.WorldTime, MyCourt.InitialWorldTime);
Assert.strictEqual(BootstrapRoom.Room.Fields.OwnerId, BootstrapConnection.Puid);
Assert.strictEqual(BootstrapRoom.Room.Fields.State, MyCourt.InitialState);
const BootstrapWrites = [];
const BootstrapLive = {
    Id: 8999,
    State: 2,
    Closed: false,
    ActivityName: 'mycourt',
    ActivityKey: 0xfeac4070,
    Puid: BootstrapConnection.Puid,
    SessionId: BootstrapConnection.SessionId,
    Identifier: 'bootstrap-owner',
    MyCourtBootstrapSent: false,
    MyCourtBootstrapTimer: null,
    SendObject: (Frame) => (BootstrapWrites.push(Frame), true),
};
MyCourt.Rooms.clear();
Assert.ok(MyCourt.PublishBootstrap(BootstrapLive));
Assert.strictEqual(BootstrapWrites.length, 1);
Assert.strictEqual(MyCourt.Rooms.size, 1);
MyCourt.ClearConnection(BootstrapLive);
Assert.strictEqual(MyCourt.Rooms.size, 0, 'an own-court bootstrap cannot leak to the next player');
const WrongFixedBlock = Objects.BuildPayload({
    key: 0xaa01n,
    version: 2n,
    ClassCrc: MyCourt.RoomClass,
    Bits: [12],
    Values: Buffer.from([0, 0, 0, 1, 0]),
});
Assert.strictEqual(
    MyCourt.DecodeRoomPayload(WrongFixedBlock),
    null,
    'the fixed customization block cannot accept an arbitrary length',
);
Assert.deepStrictEqual(MyCourt.ExtractTemplateFrame(RoomFrame), RoomFrame);
Assert.deepStrictEqual(
    MyCourt.ExtractTemplateFrame(`out-1 out ${RoomFrame.length} ${RoomFrame.toString('hex')} 9c72247c`),
    RoomFrame,
);
const Sent = [];
const Source = {
    Id: 9001,
    State: 2,
    Closed: false,
    ActivityName: 'mycourt',
    ActivityKey: 0xfeac4070,
    Puid: 0x0110000100000666n,
    Identifier: 'room-source',
    SendObject: (B) => (Sent.push(B), true),
};
const Peer = {
    Id: 9002,
    State: 2,
    Closed: false,
    ActivityName: 'mycourt',
    ActivityKey: 0xfeac4070,
    Puid: 0x0110000100000667n,
    Identifier: 'room-peer',
    SendObject: (B) => (Sent.push(B), true),
};
const Other = {
    Id: 9003,
    State: 2,
    Closed: false,
    ActivityName: 'stage',
    ActivityKey: 0xdb0b03f5,
    Puid: 0x0110000100000668n,
    Identifier: 'other',
    SendObject: (B) => (Sent.push(B), true),
};
Assert.strictEqual(
    MyCourt.Relay(Source, Buffer.alloc(4)),
    false,
    'short object traffic must be ignored without throwing',
);
Roster.Add(Source);
Roster.Add(Peer);
Roster.Add(Other);
MyCourt.Rooms.clear();
Assert.ok(MyCourt.Relay(Source, RoomFrame, MyCourt.ObjectDataPacket));
Assert.strictEqual(Sent.length, 2);
Assert.deepStrictEqual(Sent[0], RoomFrame, 'room bytes are echoed to the owner without re-encoding');
Assert.deepStrictEqual(Sent[1], RoomFrame, 'room bytes are forwarded to peers without re-encoding');
const Late = {
    Id: 9004,
    State: 2,
    Closed: false,
    ActivityName: 'mycourt',
    ActivityKey: 0xfeac4070,
    Puid: 0x0110000100000669n,
    Identifier: 'late',
    SendObject: (B) => (Sent.push(B), true),
};
Assert.strictEqual(MyCourt.ReplayTo(Late), 1);
Assert.deepStrictEqual(Sent[2], RoomFrame, 'late MyCourt entrants receive the same complete frame');
Assert.strictEqual(Sent.length, 3, 'room objects do not leak across activities');
const RoomList = Buffer.alloc(16 + 7 + 9 + RoomPayload.length);
RoomList.writeUInt32LE(RoomList.length, 0);
RoomList.writeUInt32BE(MyCourt.ObjectDataListPacket, 4);
RoomList[16] = 1;
RoomList.writeUInt32BE(MyCourt.RoomClass, 17);
RoomList.writeBigUInt64BE(0xaa01n, 23);
RoomList.writeUInt8(RoomPayload.length, 31);
RoomPayload.copy(RoomList, 32);
Assert.ok(MyCourt.ListContainsRoom(RoomList));
Assert.strictEqual(MyCourt.ParseRoomList(RoomList).Records[0].ObjectId, 0xaa01n);
Assert.ok(MyCourt.Relay(Source, RoomList, MyCourt.ObjectDataListPacket));
Assert.deepStrictEqual(Sent[3], RoomList, 'room state inside an object list is echoed intact');
Assert.deepStrictEqual(Sent[4], RoomList, 'room state inside an object list is relayed intact');
MyCourt.ClearConnection(Source);
Roster.Players.clear();
Assert.strictEqual(Log.Colour.Info, '\x1b[38;2;162;213;210m');
Assert.strictEqual(Log.Colour.Verbose, '\x1b[38;2;181;126;220m');
Assert.strictEqual(Log.Colour.Error, '\x1b[38;2;229;57;53m');
Assert.ok(
    !/[\u{1F300}-\u{1FAFF}]/u.test(Fs.readFileSync(Path.join(__dirname, '..', 'Opal.js'), 'utf8')),
    'opal entrypoint must not contain emoji logging',
);

const PlayerBodies = require('../Source/Protocol/PlayerBody');
{
    const Frame = Buffer.from(
        Fs.readFileSync(Path.join(__dirname, 'Frames', 'Handshake2K19.txt'), 'utf8')
            .trim()
            .split(/\s+/)[3],
        'hex',
    );
    const Id = Frame.readBigUInt64BE(24);
    Assert.strictEqual(Frame.readUInt32BE(32), 0x2c5d2702, 'fixture is a PLAYER handshake');

    let Terminator = -1;
    for (let O = 42; O + 16 <= Frame.length; O += 16) {
        if (Frame.readUInt32BE(O) === 0 && Frame.readUInt32BE(O + 4) === 0) {
            Terminator = O;
            break;
        }
    }
    let Body = null;
    for (let O = 42; O < Terminator; O += 16) {
        if (Frame.readUInt32BE(O + 4) !== 0x36182e83) continue;
        const Start = Terminator + 16 + Frame.readUInt32BE(O + 8);
        const Length = Frame.readUInt32BE(O + 12);
        if (Length < 58 || Start + Length > Frame.length) continue;
        if (Frame.readBigUInt64BE(Start) !== Id) continue;
        Body = Buffer.from(Frame.subarray(Start, Start + Length));
        break;
    }
    Assert.ok(Body, 'the PLAYER DATA blob was located in the captured handshake');
    Assert.ok(PlayerBodies.IsPresent(Body, PlayerBodies.ShowField), 'real 2K19 clients send field 84 present');

    const Shown = PlayerBodies.SetShow(Buffer.from(Body));
    Assert.ok(Shown.Ok, 'field 84 is reachable in a real body: ' + (Shown.Reason || ''));
    Assert.strictEqual(Shown.Was, 0, 'the client itself sends field 84 as 0, which is why peers stay hidden');
    Assert.strictEqual(Shown.Inserted, false, 'no insert is needed for a real body');
    Assert.strictEqual(
        Shown.Body.readUInt8(Shown.Offset),
        1,
        'Opal must publish field 84 as 1 so ProcessPlayerServerObject calls actor vtable +208',
    );
    Assert.strictEqual(Shown.Body.length, Body.length, 'setting field 84 does not resize the body');

    Assert.strictEqual(
        Shown.Body.readBigUInt64LE(PlayerBodies.ValuesStart),
        Id,
        'field 0 (PUID, object+128) is untouched',
    );
    const Generation = PlayerBodies.InspectGeneration(Shown.Body);
    Assert.ok(Generation.GenerationOk, 'the body still decodes after field 84 is set');
    Assert.strictEqual(
        Generation.FakePlayerFlag,
        0,
        'field 82 (object+485) still selects REMOTE_PLAYERMANAGER::AddPlayer',
    );
    Assert.strictEqual(Generation.Puid, Id, 'the generation contract still reads the same PUID');

    const At = Shown.Offset;
    const Without = Buffer.concat([Shown.Body.subarray(0, At), Shown.Body.subarray(At + 1)]);
    Without[16 + (PlayerBodies.ShowField >> 3)] &= ~(0x80 >> (PlayerBodies.ShowField & 7));
    const Inserted = PlayerBodies.SetShow(Without);
    Assert.ok(Inserted.Ok && Inserted.Inserted, 'an absent field 84 is inserted');
    Assert.strictEqual(Inserted.Offset, At, 'it is inserted at the offset the codec expects');
    Assert.ok(Inserted.Body.equals(Shown.Body), 'the reconstructed body matches byte for byte');
}

Assert.ok(Fs.existsSync(Listener.DefaultCertificate.Key), 'local fallback key exists');
Assert.ok(Fs.existsSync(Listener.DefaultCertificate.Certificate), 'local fallback cert exists');

process.stdout.write('Opal 2K19 evidence checks passed\n');
