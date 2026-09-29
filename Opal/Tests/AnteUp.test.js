// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const Court = require('../Source/Protocol/CourtData');
const GotNext = require('../Source/Protocol/GotNext');
const Roster = require('../Source/Protocol/Roster');
const Slots = require('../Source/Protocol/Slots');
const Courts = require('../Source/Protocol/Courts');
const Tables = require('../Source/Activity/CourtTables');
const Markers = require('../Source/Activity/StageSpots/GamblingCourts2K19');
const Policy = require('../../Shared/AnteUp');
const Zlib = require('node:zlib');
const FieldList = require('../Source/Codec/FieldList');
const Frame = require('../Source/Codec/Frame');
const Userdata = require('../Source/Protocol/Userdata');
const Position = require('../Source/Protocol/Position');
require('../Source/Core/Log').SetLevel(0);

function Decode(FrameData) {
    Assert.equal(FrameData.readUInt32LE(0), FrameData.length);
    Assert.equal(FrameData.readUInt32BE(24), 0x2c4d49e3);
    Assert.equal(FrameData.readUInt32BE(28), FrameData.length - 32);
    const B = FrameData.subarray(32),
        Fields = new Map();
    let At = 31;
    for (let Bit = 0; Bit < 116; Bit++) {
        if (!(B[16 + (Bit >> 3)] & (0x80 >> (Bit & 7)))) continue;
        let Length;
        if ([0, 2, 13, 67, 70, 102].includes(Bit)) Length = 4;
        else if ([65, 66, 68, 69, 101].includes(Bit)) Length = 16;
        else if ([103, 104].includes(Bit)) Length = 2;
        else if (Bit === 1) Length = 64;
        else if ([11, 15, 37, 58, 108].includes(Bit)) Length = 1;
        else if (Bit === 12 || (Bit >= 17 && Bit <= 21) || (Bit >= 38 && Bit <= 42)) Length = 8;
        else if ((Bit >= 32 && Bit <= 36) || (Bit >= 53 && Bit <= 57)) Length = 4 + B.readUInt32LE(At);
        else if (Bit >= 59 && Bit <= 61) Length = 72;
        else if (Bit >= 62 && Bit <= 64) Length = 144;
        else Assert.fail(`unexpected bit ${Bit}`);
        Assert.ok(At + Length <= B.length);
        Fields.set(Bit, B.subarray(At, At + Length));
        At += Length;
    }
    Assert.equal(At, B.length, 'no shifted/trailing values');
    return Fields;
}

Test('every stage court carries recap winner/loser lines ending on the post-game spots', () => {
    const World = Tables.For('stage');
    const Vec = (Value) => [0, 4, 8].map((Offset) => Value.readFloatLE(Offset));
    for (const Marker of Markers.GamblingCourts) {
        const Raw = World.Courts.find((CourtValue) => CourtValue.Name === Marker.name);
        const Found = {
            Raw,
            Groups: Courts.GroupsFor(Raw, World.Room, World.SeqBase).filter((G) => G.Kind === 'gotnext'),
        };
        for (const { Frame: FrameData } of [Court.BuildStageCourt(Marker), Court.BuildStageCourtOccupancy(Marker)]) {
            const Fields = Decode(FrameData);
            for (const [Bits, Expected] of [
                [[65, 66, 67], (I) => GotNext.WinnerPoint(Raw, I)],
                [[68, 69, 70], (I) => GotNext.LoserPoint(Found, I, Raw.TeamSize)],
            ]) {
                const Base = Vec(Fields.get(Bits[0])),
                    Step = Vec(Fields.get(Bits[1]));
                for (let I = 0; I < Raw.TeamSize; I++) {
                    const Point = Expected(I);
                    Base.forEach((Value, Axis) =>
                        Assert.ok(
                            Math.abs(Value + Step[Axis] * I - Point[Axis]) < 0.01,
                            `${Marker.name} bits ${Bits} player ${I}`,
                        ),
                    );
                }
                Assert.equal(
                    Fields.get(Bits[2]).readInt32LE(),
                    Math.round(Position.FacingUnitsForSpot(Expected(0), Raw.Pos)),
                );
            }
        }
    }
});

Test('all stage placement and occupancy frames carry the shared price index', () => {
    for (const Marker of Markers.GamblingCourts) {
        Court.ClearStageTeams(Marker.name);
        for (const F of [Court.BuildStageCourt(Marker), Court.BuildStageCourtOccupancy(Marker)]) {
            Assert.equal(Decode(F.Frame).get(108)[0], Policy.ByName(Marker.name).index);
        }
    }
});

Test('native rosters preserve 1v1, 2v2, 3v3 sides, identity and little-endian player ids', () => {
    for (const Size of [1, 2, 3]) {
        const M = Markers.GamblingCourts.find((C) => C.TeamSize === Size);
        const Home = Array.from({ length: Size }, (_, I) => 0x01100001349dd023n + BigInt(I));
        const Away = Array.from({ length: Size }, (_, I) => 0x011000014f494918n + BigInt(I));
        const { Guid, Frame: FrameData } = Court.PrepareStageTeams(M.name, Home, Away);
        const F = Decode(FrameData);
        Assert.equal(Guid, Court.StageGuidFor(M.name));
        Assert.equal(F.get(0).readUInt32LE(), { 1: 6, 2: 5, 3: 4 }[Size]);
        Assert.equal(F.get(15)[0], Size);
        Assert.equal(F.get(37)[0], Size);
        Home.forEach((Id, I) => Assert.equal(F.get(38 + I).readBigUInt64LE(), Id));
        Away.forEach((Id, I) => Assert.equal(F.get(17 + I).readBigUInt64LE(), Id));
        Assert.notEqual(F.get(12).readBigUInt64LE(), 0n);
        Assert.equal(F.get(13).readUInt32LE(), 2, 'native online setup requires state 2');
        Assert.equal(F.get(101).length, 16);
        Assert.ok(F.get(101).some((Byte) => Byte !== 0));
        Assert.equal(F.get(103).readUInt16LE(), require('../Source/Activity/Activities').Relay.Local.Port);
        const Octets = require('../Source/Activity/Activities').Relay.Local.Ip.split('.').map(Number);
        Assert.deepEqual([...F.get(102)], Octets.reverse(), 'flat little-endian IPv4 DWORD, not a field-list endpoint');
        const Refresh = Decode(Court.BuildStageCourt(M).Frame);
        Assert.deepEqual(Refresh.get(101), F.get(101), 'refresh keeps this game token');
        Assert.deepEqual(Refresh.get(12), F.get(12), 'refresh keeps this game match id');
        Assert.equal(Decode(Court.BuildStageCourt(M).Frame).get(37)[0], Size, 'late-client refresh retains teams');
        Court.ClearStageTeams(M.name);
    }
});

Test('native game-ready barrier requires every frozen participant and survives refresh', () => {
    for (const Size of [1, 2, 3]) {
        const Marker = Markers.GamblingCourts.find((C) => C.TeamSize === Size);
        const Home = Array.from({ length: Size }, (_, I) => BigInt(100 + I));
        const Away = Array.from({ length: Size }, (_, I) => BigInt(200 + I));
        Court.PrepareStageTeams(Marker.name, Home, Away);
        try {
            Assert.equal(Court.MarkStageGameConnected(Marker.name, 999n).Accepted, false);
            const Ids = [...Home, ...Away];
            for (const Id of Ids.slice(0, -1)) {
                Assert.equal(Court.MarkStageGameConnected(Marker.name, Id).Advanced, false);
                Assert.equal(Court.MarkStageGameConnected(Marker.name, Id).Advanced, false);
                Assert.equal(Decode(Court.BuildStageCourt(Marker).Frame).get(13).readUInt32LE(), 2);
            }
            Assert.equal(Court.MarkStageGameConnected(Marker.name, Ids.at(-1)).Advanced, true);
            Assert.equal(Decode(Court.BuildStageCourt(Marker).Frame).get(13).readUInt32LE(), 3);
            Assert.equal(Decode(Court.BuildStageCourtOccupancy(Marker).Frame).get(13).readUInt32LE(), 3);
            Assert.equal(Court.MarkStageGameConnected(Marker.name, Ids.at(-1)).Advanced, false);
            const Previous = Decode(Court.BuildStageCourt(Marker).Frame);
            Court.PrepareStageTeams(Marker.name, Home, Away);
            const Next = Decode(Court.BuildStageCourt(Marker).Frame);
            Assert.equal(Next.get(13).readUInt32LE(), 2);
            Assert.notDeepEqual(Next.get(101), Previous.get(101), 'fresh session token excludes stale game sockets');
            Assert.notDeepEqual(Next.get(12), Previous.get(12), 'new game generation');
        } finally {
            Court.ClearStageTeams(Marker.name);
        }
        Assert.equal(Court.MarkStageGameConnected(Marker.name, Home[0]).Accepted, false);
    }
});

Test('duplicate, zero, unequal and oversized rosters are rejected', () => {
    for (const [H, A] of [
        [[1n], [1n]],
        [[0n], [2n]],
        [[1n, 2n], [3n]],
        [[], []],
        [
            [1n, 2n, 3n, 4n, 5n, 6n],
            [7n, 8n, 9n, 10n, 11n, 12n],
        ],
    ]) {
        Assert.throws(() => Court.ValidateTeams(H, A));
    }
});

let NextId = 1000;
function UserdataFrame(Profile) {
    const List = new FieldList.Builder()
        .AddBlob('COMPRESSED_DATA', Zlib.deflateSync(Profile))
        .AddU32('COMMAND', Userdata.UserdataCommand)
        .Build();
    return Frame.Build(0x9e3471ed, Buffer.alloc(8), List, Frame.InnerHeader.Object);
}
function Setup(Size, Events) {
    Roster.Players.clear();
    const World = Tables.For('stage');
    const Raw = World.Courts.find((C) => C.TeamSize === Size);
    Court.ClearStageTeams(Raw.Name);
    const Groups = Courts.GroupsFor(Raw, World.Room, World.SeqBase).filter((G) => G.Kind === 'gotnext');
    const Players = [];
    Groups.forEach((Group, Side) => {
        for (let I = 0; I < Size; I++) {
            const Id = NextId++;
            const Player = {
                Id: Id,
                Puid: 0x0110000100000000n + BigInt(Id),
                State: 2,
                MachineId: 0x68fan + BigInt(Id),
                ActivityName: 'stage',
                ActivityKey: 0xdb0b03f5,
                PlayerRevision: 1n,
                PlayerBody: Buffer.alloc(200),
                GotNext: { Court: Group.ObjectId, Slot: Side },
                Identifier: String(Id),
                Userdata: UserdataFrame(Buffer.alloc(223256, Id & 255)),
                Send(FrameData) {
                    Events.push({ To: this.Id, Frame: FrameData });
                    return true;
                },
                SendObject(FrameData) {
                    Events.push({ To: this.Id, Frame: FrameData });
                    return true;
                },
            };
            Player.PlayerBody.writeUInt32LE(GotNext.State.GotNext, 120);
            Slots.Occupy(Group.SlotObjectId, Player.Puid, Size, I);
            Roster.Add(Player);
            Players.push(Player);
        }
    });
    return {
        Raw,
        Groups,
        Players,
        Cleanup() {
            Players.forEach((P) => Slots.Release(P.Puid));
            Court.ClearStageTeams(Raw.Name);
            Roster.Players.clear();
        },
    };
}

function GameConnectedCommand(Raw) {
    const Packet = Buffer.alloc(68);
    Packet.writeUInt32LE(68);
    Packet.writeUInt32BE(0xce148fb1, 4);
    Packet.writeUInt32BE(23, 20);
    Packet.writeBigUInt64BE(Court.StageGuidFor(Raw.Name), 24);
    Packet.writeUInt32BE(0xb18f14ce, 36);
    Packet.writeUInt32BE(0x1423add2, 40);
    Packet.writeUInt32BE(0xdfc1471f, 44);
    return Packet;
}

function GameEndCommand(Raw, Result, Score = 0) {
    const List = new FieldList.Builder()
        .AddU32('COMMAND', GotNext.EndCommand)
        .AddU32(GotNext.EndField.Score, Score)
        .AddU32(GotNext.EndField.Result, Result)
        .Build();
    const Packet = Buffer.alloc(36 + List.length);
    Packet.writeUInt32LE(Packet.length);
    Packet.writeUInt32BE(0xce148fb1, 4);
    Packet.writeUInt32BE(77, 20);
    Packet.writeBigUInt64BE(Court.StageGuidFor(Raw.Name), 24);
    Packet.writeUInt32BE(List.length, 32);
    List.copy(Packet, 36);
    return Packet;
}

function PostGamePosition(Events, Puid) {
    const Hit = Events.find(
        (EventData) =>
            EventData.Frame.length >= 43 &&
            EventData.Frame.readUInt32BE(4) === Position.UpdateListPacket &&
            EventData.Frame.readBigUInt64BE(23) === Puid,
    );
    Assert.ok(Hit, `missing immediate postgame position for ${Puid}`);
    return [Hit.Frame.readInt16BE(36), Hit.Frame.readInt16BE(38), Hit.Frame.readInt16BE(40)];
}

Test('native PLAYER machine IDs reach every court participant before GAME setup', () => {
    const Player = require('../Source/Protocol/PlayerObject');
    const Body = require('../Source/Protocol/PlayerBody');
    const Fs = require('node:fs'),
        Path = require('node:path');
    const Fixture = Buffer.from(
        Fs.readFileSync(Path.join(__dirname, 'Frames/Handshake2K19.txt'), 'utf8').trim().split(/\s+/)[3],
        'hex',
    );
    const Captured = Player.ExtractHandshakeBody(Fixture);
    for (const Size of [1, 2, 3]) {
        const Events = [],
            S = Setup(Size, Events);
        try {
            for (const P of S.Players) {
                P.PlayerBody = Player.StampIdentity(Captured.Body, Captured.PlayerId, P.Puid).Body;
                const Decoded = Body.Decode(P.PlayerBody);
                P.PlayerBody.writeUInt32LE(GotNext.State.GotNext, Decoded.Offsets.get(2));
                Assert.equal(P.PlayerBody.readBigUInt64LE(Decoded.Offsets.get(1)), 0n);
            }
            Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), true);
            for (const Recipient of S.Players) {
                const Frames = Events.filter(
                    (E) => E.To === Recipient.Id && E.Frame.readUInt32BE(24) === Player.PlayerClass,
                );
                Assert.equal(Frames.length, Size * 2);
                const Machines = new Set();
                for (const { Frame: FrameData } of Frames) {
                    const BodyData = FrameData.subarray(32),
                        Decoded = Body.Decode(BodyData);
                    const Owner = S.Players.find((P) => P.Puid === BodyData.readBigUInt64LE(Decoded.Offsets.get(0)));
                    Assert.ok(Owner);
                    const Machine = BodyData.readBigUInt64LE(Decoded.Offsets.get(1));
                    Assert.equal(Machine, Owner.MachineId);
                    Assert.notEqual(Machine, 0n);
                    Assert.equal(BodyData.readUInt32LE(Decoded.Offsets.get(2)), GotNext.State.Playing);
                    Machines.add(Machine);
                }
                Assert.equal(Machines.size, Size * 2, 'not just a two-player special case');
            }
        } finally {
            S.Cleanup();
        }
    }
});

Test('full courts get their native teams before PLAYING; repeat start is inert', () => {
    for (const Size of [1, 2, 3]) {
        const Events = [],
            S = Setup(Size, Events);
        try {
            Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), true);
            const CourtFrames = Events.slice(0, Size * 2);
            Assert.equal(
                CourtFrames.filter((E) => E.Frame.readUInt32BE(24) === 0x2c4d49e3).length,
                Size * 2,
                'online court setup precedes PLAYING',
            );
            const Fields = Decode(CourtFrames[0].Frame);
            for (const Delivery of CourtFrames) {
                const Sent = Decode(Delivery.Frame);
                Assert.equal(Sent.get(37)[0], Size, 'home roster count');
                Assert.equal(Sent.get(15)[0], Size, 'away roster count');
                S.Players.forEach((Player, Index) => {
                    const Side = Index < Size ? 0 : 1,
                        Seat = Index % Size;
                    const RosterBit = (Side === 0 ? 38 : 17) + Seat;
                    const ProfileBit = (Side === 0 ? 53 : 32) + Seat;
                    Assert.equal(Sent.get(RosterBit).readBigUInt64LE(), Player.Puid);
                    Assert.equal(Sent.get(59 + Side).readBigUInt64BE(8 + Seat * 8), Player.Puid);
                    Assert.deepEqual(
                        Zlib.inflateSync(Sent.get(ProfileBit).subarray(4)),
                        Userdata.Inflated(Player),
                        'every recipient gets the matching seat userdata',
                    );
                });
            }
            Assert.equal(Fields.get(11)[0], 1, 'native Online_SynchronizeMachines gate is enabled');
            S.Players.forEach((P, I) => {
                const Bit = I < Size ? 53 + I : 32 + I - Size;
                Assert.deepEqual(
                    Zlib.inflateSync(Fields.get(Bit).subarray(4)),
                    Userdata.Inflated(P),
                    'court profile belongs to that exact roster seat, without slicing or padding',
                );
            });
            const Refresh = Decode(
                Court.BuildStageCourtOccupancy(Markers.GamblingCourts.find((M) => M.name === S.Raw.Name)).Frame,
            );
            Assert.ok(!Refresh.has(32) && !Refresh.has(53), 'refresh must not free live game USERDATA pointers');
            const FullRefresh = Decode(
                Court.BuildStageCourt(Markers.GamblingCourts.find((M) => M.name === S.Raw.Name)).Frame,
            );
            Assert.equal(FullRefresh.get(11)[0], 1, 'full court refresh preserves the online gate');
            for (const Snapshot of [Refresh, FullRefresh]) {
                for (let Side = 0; Side < 2; Side++) {
                    for (let Seat = 0; Seat < Size; Seat++) {
                        Assert.equal(
                            Snapshot.get(59 + Side).readBigUInt64BE(8 + Seat * 8),
                            S.Players[Side * Size + Seat].Puid,
                            'refresh preserves every occupied spot',
                        );
                    }
                }
                Assert.deepEqual(Snapshot.get(101), Fields.get(101), 'refresh keeps GAME token');
                Assert.equal(Snapshot.get(13).readUInt32LE(), 2);
            }
            for (const P of S.Players) {
                Assert.equal(P.PlayerBody.readUInt32LE(120), GotNext.State.Playing);
                Assert.equal(P.GotNext.Playing, true);
                Assert.equal(GotNext.Warp(P), false);
                P.PlayerBody.writeUInt32LE(GotNext.State.None, 120);
                Assert.equal(GotNext.Reapply(P), true);
                Assert.equal(P.PlayerBody.readUInt32LE(120), GotNext.State.Playing);
            }
            const Count = Events.length;
            Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), false);
            Assert.equal(Events.length, Count);
        } finally {
            S.Cleanup();
        }
    }
});

Test('a missing participant or failed team delivery cannot intentionally start a partial game', () => {
    for (const Mode of [
        'missing',
        'send-failure',
        'wrong-world',
        'no-userdata',
        'short-userdata',
        'oversized-userdata',
        'zero-machine',
        'duplicate-machine',
    ]) {
        const Events = [],
            S = Setup(1, Events);
        try {
            if (Mode === 'missing') Roster.Remove(S.Players[1]);
            if (Mode === 'zero-machine') S.Players[1].MachineId = 0n;
            if (Mode === 'duplicate-machine') S.Players[1].MachineId = S.Players[0].MachineId;
            if (Mode === 'wrong-world') S.Players[1].ActivityKey++;
            if (Mode === 'no-userdata') S.Players[1].Userdata = null;
            if (Mode === 'short-userdata') S.Players[1].Userdata = UserdataFrame(Buffer.alloc(100));
            if (Mode === 'oversized-userdata') S.Players[1].Userdata = UserdataFrame(Buffer.alloc(0x6d031));
            if (Mode === 'send-failure') S.Players[1].SendObject = () => false;
            Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), false);
            Assert.ok(S.Players.every((P) => P.PlayerBody.readUInt32LE(120) === GotNext.State.GotNext));
            Assert.ok(
                Events.every((E) => E.Frame.readUInt32BE(4) !== 0xce1c9e8c),
                'no PLAYING player frame is sent after any preparation failure',
            );
        } finally {
            S.Cleanup();
        }
    }
});

Test('native connection-complete command is acknowledged and tied to the seated game', () => {
    const Events = [],
        S = Setup(1, Events);
    try {
        GotNext.MaybeStartMatch(S.Players[0]);
        const Packet = Buffer.alloc(68);
        Packet.writeUInt32LE(68);
        Packet.writeUInt32BE(0xce148fb1, 4);
        Packet.writeUInt32BE(23, 20);
        Packet.writeBigUInt64BE(Court.StageGuidFor(S.Raw.Name), 24);
        Packet.writeUInt32BE(0xb18f14ce, 36);
        Packet.writeUInt32BE(0x1423add2, 40);
        Packet.writeUInt32BE(0xdfc1471f, 44);
        Assert.equal(GotNext.HandleGameConnected(S.Players[0], Packet), true);
        Assert.equal(S.Players[0].GotNext.GameConnected, true);
        Assert.equal(Events.at(-1).Frame.readUInt32BE(4), 0x2b84ffc2);
        Assert.equal(Events.at(-1).Frame.readUInt32BE(20), 23);
        Assert.equal(S.Players[1].GotNext.GameConnected, undefined);
        const Join = Buffer.from(Packet);
        Join.writeUInt32BE(0x1ef43563, 44);
        const Count = Events.length;
        Assert.equal(GotNext.Handle(S.Players[0], Join), true);
        Assert.equal(Events.length, Count + 1, 'duplicate join only acknowledges, never repeats court/start/warp');
        Assert.equal(S.Players[0].PlayerBody.readUInt32LE(120), GotNext.State.Playing);
        S.Players[1].GotNext.Playing = false;
        GotNext.HandleGameConnected(S.Players[1], Packet);
        Assert.equal(S.Players[1].GotNext.GameConnected, undefined);
        S.Players[1].GotNext.Playing = true;
        Events.length = 0;
        GotNext.HandleGameConnected(S.Players[1], Packet);
        const ReadyFrames = Events.filter((E) => E.Frame.readUInt32BE(24) === Court.CourtClass);
        Assert.equal(ReadyFrames.length, 2);
        Assert.ok(ReadyFrames.every((E) => Decode(E.Frame).get(13).readUInt32LE() === 3));
        const BeforeDuplicate = Events.length;
        GotNext.HandleGameConnected(S.Players[1], Packet);
        Assert.equal(Events.length, BeforeDuplicate + 1, 'duplicate readiness only acknowledges');
    } finally {
        S.Cleanup();
    }
});

Test('Ante-Up 1v1/2v2/3v3 opens the away line and applies native postgame winner/loser states', () => {
    for (const Size of [1, 2, 3]) {
        const Events = [],
            S = Setup(Size, Events);
        try {
            Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), true);
            const Connected = GameConnectedCommand(S.Raw);
            for (const Player of S.Players) Assert.equal(GotNext.HandleGameConnected(Player, Connected), true);

            Assert.deepEqual(
                Slots.SeatsOf(S.Groups[0].SlotObjectId),
                S.Players.slice(0, Size).map((Player) => Player.Puid),
                'home/winner line remains occupied during the game',
            );
            Assert.deepEqual(
                Slots.SeatsOf(S.Groups[1].SlotObjectId),
                new Array(Size).fill(0n),
                'away/challenger line opens only after every game connection is ready',
            );

            const WinningSide = Size % 2;
            const Winners = S.Players.slice(WinningSide * Size, WinningSide * Size + Size);
            const Packet = GameEndCommand(S.Raw, GotNext.EndResult.Won, 21);
            const BeforeEnd = Events.length;
            Assert.equal(GotNext.HandleGameEnd(Winners[0], Packet), true);
            Assert.equal(Court.GameTeams('stage', S.Raw.Name), null);
            Assert.deepEqual(
                Slots.SeatsOf(S.Groups[0].SlotObjectId),
                Winners.map((Player) => Player.Puid),
                'winning side is promoted to the home/winner line',
            );
            Assert.deepEqual(Slots.SeatsOf(S.Groups[1].SlotObjectId), new Array(Size).fill(0n));
            for (const Player of Winners) {
                Assert.equal(Player.PlayerBody.readUInt32LE(120), GotNext.State.GotNext, 'winners retain got-next');
                Assert.ok(Player.GotNext, 'winners retain the home court');
            }
            for (const Player of S.Players.filter((PlayerData) => !Winners.includes(PlayerData))) {
                Assert.equal(
                    Player.PlayerBody.readUInt32LE(120),
                    GotNext.State.None,
                    'losers return to WALKING to complete the end transition',
                );
                Assert.equal(Player.GotNext, null);
            }
            const Postgame = Events.slice(BeforeEnd);
            const Found = { Raw: S.Raw, Groups: S.Groups };
            Winners.forEach((Winner, Index) => {
                const At = PostGamePosition(Postgame, Winner.Puid);
                Assert.deepEqual(
                    At,
                    GotNext.WinnerPoint(S.Raw, Index).map(Math.round),
                    'winners are pinned in the on-court domino (player 0 on the court centre)',
                );
                if (Index === 0)
                    Assert.deepEqual(
                        At,
                        S.Raw.Pos.map(Math.round),
                        'the first winner is warped to the court marker centre',
                    );
            });
            const Losers = S.Players.filter((Player) => !Winners.includes(Player));
            Losers.forEach((Loser, Index) => {
                const At = PostGamePosition(Postgame, Loser.Puid);
                Assert.deepEqual(
                    At,
                    GotNext.LoserPoint(Found, Index, Losers.length).map(Math.round),
                    Size === 1
                        ? '1v1 loser is warped left of the basket'
                        : 'team-game losers are warped to the centred losing zone',
                );
            });

            const Before = Events.length;
            Assert.equal(GotNext.HandleGameEnd(Winners[0], Packet), true);
            Assert.equal(Events.length, Before + 1, 'a repeated result receives only its correlated ACK');
        } finally {
            S.Cleanup();
        }
    }
});

Test('Ante-Up draw clears both sides and returns every participant to WALKING', () => {
    const Events = [],
        S = Setup(2, Events);
    try {
        Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), true);
        const Connected = GameConnectedCommand(S.Raw);
        for (const Player of S.Players) GotNext.HandleGameConnected(Player, Connected);
        Assert.equal(GotNext.HandleGameEnd(S.Players[0], GameEndCommand(S.Raw, GotNext.EndResult.NoWinners)), true);
        Assert.deepEqual(Slots.SeatsOf(S.Groups[0].SlotObjectId), [0n, 0n]);
        Assert.deepEqual(Slots.SeatsOf(S.Groups[1].SlotObjectId), [0n, 0n]);
        Assert.ok(S.Players.every((Player) => Player.PlayerBody.readUInt32LE(120) === GotNext.State.None));
        Assert.ok(S.Players.every((Player) => Player.GotNext === null));
    } finally {
        S.Cleanup();
    }
});

Test('late USERDATA retries a full court once; corrupt data and later updates cannot restart it', () => {
    const Events = [],
        S = Setup(1, Events);
    try {
        const Peer = S.Players[1],
            Saved = Peer.Userdata;
        Peer.VconlineProfileReady = true;
        Peer.Userdata = null;
        Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), false);
        Assert.equal(Events.length, 0);
        const BadList = new FieldList.Builder()
            .AddBlob('COMPRESSED_DATA', Buffer.from('not zlib'))
            .AddU32('COMMAND', Userdata.UserdataCommand)
            .Build();
        Peer.Userdata = Frame.Build(0x9e3471ed, Buffer.alloc(8), BadList, Frame.InnerHeader.Object);
        Assert.equal(GotNext.MaybeStartMatch(Peer), false);
        Assert.equal(Events.length, 0);
        Userdata.Relay(Peer, Saved);
        Assert.ok(S.Players.every((P) => P.GotNext.Playing));
        const Count = Events.length;
        Userdata.Relay(Peer, Saved);
        Assert.equal(Events.length, Count, 'no new court profile allocations or PLAYING grants');
    } finally {
        S.Cleanup();
    }
});

Test('a public activity can have many observers without adding them to game teams', () => {
    const Events = [],
        S = Setup(1, Events);
    try {
        for (let I = 0; I < 128; I++) {
            Roster.Add({
                Id: NextId++,
                Puid: 0x0110000170000000n + BigInt(I),
                State: 2,
                ActivityKey: I < 100 ? 0xdb0b03f5 : 0x12345678,
                SendObject(FrameData) {
                    Events.push({ To: this.Id, Frame: FrameData });
                    return true;
                },
            });
        }
        Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), true);
        const RosterFrames = Events.filter((E) => E.Frame.readUInt32BE(4) === 0x9d32c5b4);
        Assert.equal(RosterFrames.length, 0, 'court start must not overwrite the public WORLD roster');
        const CourtList = Events.filter((E) => E.Frame.readUInt32BE(24) === 0x2c4d49e3);
        Assert.equal(CourtList.length, 102, 'participants plus same-activity observers only');
        for (const E of CourtList) {
            Assert.equal(Decode(E.Frame).get(15)[0], 1);
            Assert.equal(Decode(E.Frame).get(37)[0], 1);
        }
    } finally {
        S.Cleanup();
    }
});

Test('compressed game commands relay only to peers in the same active court', () => {
    const Events = [],
        S = Setup(1, Events);
    try {
        const ObserverEvents = [];
        const Observer = {
            Id: NextId++,
            Puid: 0x0110000177777777n,
            State: 2,
            MachineId: 0x7777n,
            ActivityName: 'stage',
            ActivityKey: 0xdb0b03f5,
            Identifier: 'observer',
            SendObject(FrameDataValue) {
                ObserverEvents.push(FrameDataValue);
                return true;
            },
        };
        Roster.Add(Observer);
        Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), true);
        Events.length = 0;
        ObserverEvents.length = 0;
        const Raw = Buffer.from('lockstep');
        const Body = new FieldList.Builder()
            .AddBlob(Userdata.GamePayloadField, Raw)
            .AddU32('COMMAND', Userdata.ReplayCommand)
            .Build();
        const FrameData = Frame.Build(0x9e3471ed, Buffer.alloc(8), Body, Frame.InnerHeader.Object);
        Assert.equal(Userdata.Relay(S.Players[0], FrameData), 1);
        Assert.equal(Events.length, 1);
        Assert.equal(Events[0].To, S.Players[1].Id);
        Assert.ok(!Events[0].Frame.equals(FrameData), 'server emits the native compressed delivery carrier');
        Assert.equal(Events[0].Frame.readBigUInt64LE(8), 0n, 'native server delivery has a zero source id');
        const Delivered = FieldList.Parse(Events[0].Frame, Frame.HeaderSize + 12);
        Assert.equal(FieldList.Find(Delivered, 'COMMAND').Data1, Userdata.ReplayCommand);
        const Compressed = FieldList.ReadBlob(Delivered, FieldList.Find(Delivered, Userdata.CompressedDataField));
        Assert.deepEqual(Zlib.inflateSync(Compressed), Raw);
        Assert.equal(ObserverEvents.length, 0, 'public-room observers never receive court lockstep');
    } finally {
        S.Cleanup();
    }
});

Test('explicit release after PLAYING frees the seat and prevents stale grant reapplication', () => {
    const Events = [],
        S = Setup(1, Events);
    try {
        Assert.equal(GotNext.MaybeStartMatch(S.Players[0]), true);
        const P = S.Players[0];
        Assert.equal(GotNext.Release(P), true);
        Assert.equal(P.GotNext, null);
        Assert.equal(P.PlayerBody.readUInt32LE(120), GotNext.State.None);
        Assert.equal(P.PlayerBody.readUInt32LE(124), 0);
        Assert.equal(GotNext.Reapply(P), false);
        Assert.deepEqual(Slots.Release(P.Puid), [], 'seat was already released');
        Assert.equal(S.Players[1].GotNext.Playing, true, 'do not invent a peer end-game event');
        Assert.equal(GotNext.Release(P), false, 'duplicate leave is harmless');
    } finally {
        S.Cleanup();
    }
});
